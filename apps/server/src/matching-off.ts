/**
 * Sealed matching, off (MATRA_MATCHING=off, the pilot default; @matra/shared matching-mode.ts).
 *
 * Off means the app server holds nothing that belongs to matching and answers nothing about it:
 *   - index.ts skips the OPRF, phone and matcher loaders, and createApp({ matching: false }) deals no ephemeral key,
 *     writes no matching_meta row and runs no matcher sync loop;
 *   - every matching route (MATCHING_ROUTE_PREFIXES) answers 404 `matching_disabled`, signed in or not;
 *   - counselor accounts can't be registered;
 *   - a server told "off" but also given a matching secret refuses to start (MATCHING_ONLY_VARS): someone expected
 *     matching to run, and a key share sitting unused next to the app is still a key share;
 *   - leftover matching rows in the database (from an earlier "on") are a warning in development and a refusal in
 *     production, so an operator can't switch matching off without deciding what happens to people's sealed entries.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { parseMatchingMode, type MatchingMode } from '@matra/shared';
import Database from 'better-sqlite3';
import type { DB } from './db.js';

/** Every API route that exists only for sealed matching, staged release to counselors, or the counselor portal. */
export const MATCHING_ROUTE_PREFIXES = ['/api/matching', '/api/escrow', '/api/counselor', '/api/report-requests', '/api/report-releases'];

/**
 * Environment variables only sealed matching reads. Any of them set (non-empty) with MATRA_MATCHING=off is refused:
 * the OPRF key shares (and the retired additive keys) and holder settings, the holder-token key, the matcher and its
 * keys, the phone-token key, and the SMS provider (Twilio) used only by the matching phone step.
 */
export const MATCHING_ONLY_VARS: RegExp[] = [
  /^MATRA_OPRF_SHARE/, // MATRA_OPRF_SHARE_<i>, _<i>_FILE, MATRA_OPRF_SHARE_PUBKEYS
  /^MATRA_OPRF_KEY_[AB](_FILE)?$/, // the retired additive keys (fatal with matching on too, config.ts)
  /^MATRA_OPRF_HOLDER_URLS$/,
  /^MATRA_OPRF_THRESHOLD$/, // public pins (not secrets), but only an "on" build or server reads them; the off web build refuses them too
  /^MATRA_ATTESTATION_PLATFORM_PUBKEY$/,
  /^MATRA_MATCHER_MEASUREMENT$/,
  /^MATRA_HOLDER_TOKEN_KEY/,
  /^MATRA_MATCHER_(URL|KEY|KEY_FILE|TOKEN|TOKEN_FILE)$/,
  /^MATRA_ATTESTATION_PLATFORM_KEY(_FILE)?$/,
  /^MATRA_PHONE_HASH_KEY(_FILE)?$/,
  /^MATRA_SMS_/, // the SMS provider and its caps: only the matching phone step sends codes
  /^TWILIO_/,
];

type Env = Record<string, string | undefined>;

/** Names of the matching-only variables that are set (non-empty) in `env`, sorted. */
export function matchingOnlyVarsSet(env: Env): string[] {
  return Object.keys(env)
    .filter((k) => (env[k] ?? '').trim() !== '' && MATCHING_ONLY_VARS.some((re) => re.test(k)))
    .sort();
}

/**
 * MATRA_MATCHING for the app server. Production must set it ("off" for the pilot). Outside production it defaults to
 * "off". With "off", any matching-only variable is a fatal configuration error.
 */
export function loadMatchingMode(env: Env = process.env): MatchingMode {
  const production = env.NODE_ENV === 'production';
  const mode = parseMatchingMode(env.MATRA_MATCHING);
  if (!mode && production)
    throw new Error(
      'MATRA_MATCHING must be set in production: "off" (the pilot: sealed matching left out) or "on" (see docs/DEPLOY.md).',
    );
  const resolved = mode ?? 'off';
  if (resolved === 'off') {
    const set = matchingOnlyVarsSet(env);
    if (set.length)
      throw new Error(
        `MATRA_MATCHING is off${mode ? '' : ' (the default)'}, but ${set.join(', ')} ${set.length > 1 ? 'are' : 'is'} set. ` +
          'Those are only for sealed matching: remove them, or set MATRA_MATCHING=on.',
      );
  }
  return resolved;
}

/** The one answer every matching route gives when matching is off. */
export const MATCHING_DISABLED = { error: 'Sealed matching isn’t part of this service.', code: 'matching_disabled' } as const;

/** Express middleware for MATCHING_ROUTE_PREFIXES when matching is off: 404 before any auth or body handling. */
export function matchingDisabled(_req: Request, res: Response, _next: NextFunction): void {
  res.status(404).json(MATCHING_DISABLED);
}

/** Rows a previous "on" left behind: survivors' sealed entries, and reports released to counselors. */
export function leftoverMatchingRows(db: DB): { matchEntries: number; reportReleases: number } {
  const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    matchEntries: n('SELECT COUNT(*) AS n FROM match_entries'),
    reportReleases: n('SELECT COUNT(*) AS n FROM report_releases'),
  };
}

/**
 * Matching off over a database that still has matching rows: production refuses to start (an operator has to decide,
 * with counsel, what happens to them first); development warns. Nothing is deleted here.
 */
export function checkLeftoverMatchingRows(db: DB, production: boolean): void {
  const { matchEntries, reportReleases } = leftoverMatchingRows(db);
  if (!matchEntries && !reportReleases) return;
  const msg =
    `MATRA_MATCHING is off, but this database still holds ${matchEntries} sealed-match entr${matchEntries === 1 ? 'y' : 'ies'} ` +
    `and ${reportReleases} report release${reportReleases === 1 ? '' : 's'} from when matching was on. They stay unreachable, and nothing is deleted; housekeeping ends any live release for her (and deletes the counselor's copy of its keys).`;
  if (production) throw new Error(`${msg} Refusing to start in production: decide what happens to them first (docs/DEPLOY.md).`);
  console.warn(`[matra] WARNING: ${msg}`);
}

/**
 * The same refusal, made BEFORE the database is migrated: a production server set to off over a database that holds
 * matching rows stops with the file exactly as the operator left it (migrations v12 and v13 haven't run, so nothing
 * has been rebuilt or cleared and the file can still be restored by an older server). Reads the file read-only; a file
 * that doesn't exist yet, or has no matching tables yet, passes. checkLeftoverMatchingRows still runs after migration.
 */
export function preflightLeftoverMatchingRows(dbPath: string, production: boolean): void {
  if (!production || dbPath === ':memory:' || !fs.existsSync(dbPath)) return;
  let db: InstanceType<typeof Database> | undefined;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const has = (t: string) => !!db!.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t);
    const n = (t: string) => (has(t) ? (db!.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n : 0);
    const matchEntries = n('match_entries');
    const reportReleases = n('report_releases');
    if (matchEntries || reportReleases)
      throw new Error(
        `MATRA_MATCHING is off, but ${dbPath} still holds ${matchEntries} sealed-match entr${matchEntries === 1 ? 'y' : 'ies'} and ${reportReleases} report release${reportReleases === 1 ? '' : 's'} from when matching was on. ` +
          'Refusing to start in production before touching the database (no migration has run): decide what happens to them first (docs/DEPLOY.md).',
      );
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('MATRA_MATCHING is off')) throw e;
    // unreadable here (locked, a hot WAL we can't open read-only): the check after migration still applies
  } finally {
    db?.close();
  }
}

/** Written by the web build next to index.html (apps/web/vite.config.ts BUILD_INFO_FILE). */
export const WEB_BUILD_INFO = 'matra-build.json';

/**
 * The MATRA_MATCHING a built web app was made with. Throws if the build has no (or an unreadable) matra-build.json: a
 * build from before the switch existed, or one not made by `vite build`, can't be shown to match this server.
 */
export function webBuildMatching(webDir: string): MatchingMode {
  const file = path.join(webDir, WEB_BUILD_INFO);
  let mode: MatchingMode | undefined;
  try {
    mode = parseMatchingMode((JSON.parse(fs.readFileSync(file, 'utf8')) as { matching?: string }).matching);
  } catch {
    mode = undefined;
  }
  if (!mode) throw new Error(`The web app in ${webDir} has no readable ${WEB_BUILD_INFO}, so its MATRA_MATCHING is unknown. Rebuild it (npm run build).`);
  return mode;
}

/**
 * Refuse to serve a web build made for the other mode. An "on" build in front of an "off" server would still ask her the
 * sealed-match questions and seal escrowOptIn: true into her record; an "off" build in front of an "on" server would
 * leave every matching route live with no app that explains it.
 */
export function assertWebBuildMatches(webDir: string, server: MatchingMode): void {
  const built = webBuildMatching(webDir);
  if (built !== server)
    throw new Error(
      `The web app in ${webDir} was built with MATRA_MATCHING=${built}, but this server runs with MATRA_MATCHING=${server}. ` +
        'Build and run with the same value.',
    );
}
