/**
 * "What the server sees" inspector: the app server's side (dev / demo only; docs/design/WEEKEND_MVP.md §4.3).
 *
 *   GET /api/dev/inspector → InspectorSnapshot (@matra/shared inspector.ts)
 *
 * Mounted only when MATRA_INSPECTOR=1 and the process is not production, or is a fictional-data demo
 * (MATRA_DEMO_MODE=1): inspectorEnabled(). It is unauthenticated on purpose (a viewer watches it next to the app) and
 * shows every account's ciphertext and metadata, which is why production never mounts it.
 *
 * What it shows, for this process:
 *   requests  the last 200 requests in a ring buffer IN MEMORY: time, method, route pattern, status, and a summary of
 *             the body (field names, values cut to 48 characters; authKey, recoveryAuthKey, phone, code, passphrase are
 *             replaced by why they are never stored). No headers, no IP, no query string. Its own polling is left out.
 *             The buffer exists only while the inspector is on; without it, bodies are never kept (privacy.ts).
 *   tables    the latest 20 rows of each table that holds survivor data, exactly as stored, values cut the same way.
 *   memory    the rate-limit keys held in memory (keyed hashes, with expiry) and how many phone challenges are pending.
 * plus whatever each OPRF key holder (GET /debug/state) and the matcher (GET /v1/debug/state) say they hold.
 */
import type { Request, Response } from 'express';
import { inspectValue, type InspectorProcess, type InspectorRequest, type InspectorTable } from '@matra/shared';
import type { DB } from './db.js';
import type { RateLimiter } from './auth.js';

const RING = 200;
export const INSPECTOR_ROUTE = '/api/dev/inspector';

/** The in-memory ring buffer of recent requests (only while the inspector is on). */
export class RequestRecorder {
  private readonly buf: InspectorRequest[] = [];
  middleware() {
    return (req: Request, res: Response, next: () => void) => {
      if (req.path === INSPECTOR_ROUTE || req.path === '/api/health') return next();
      res.on('finish', () => {
        const route = typeof req.route?.path === 'string' ? (req.route.path as string) : '(unmatched)';
        this.push({ at: new Date().toISOString(), method: req.method, route, status: res.statusCode, ...bodySummary(req.body) });
      });
      next();
    };
  }
  push(r: InspectorRequest): void {
    this.buf.push(r);
    if (this.buf.length > RING) this.buf.splice(0, this.buf.length - RING);
  }
  /** Newest first. */
  recent(): InspectorRequest[] {
    return [...this.buf].reverse();
  }
}

function bodySummary(body: unknown): { body?: InspectorRequest['body'] } {
  if (body === undefined || body === null) return {};
  if (Buffer.isBuffer(body)) return body.length ? { body: { ciphertext: inspectValue(new Uint8Array(body)) } } : {};
  if (typeof body === 'object' && !Object.keys(body as object).length) return {};
  return { body: inspectValue(body) };
}

/** App-server tables shown, in the order a viewer meets them in the demo, each with what it is (and is not). */
const APP_TABLES: Array<[table: string, caption: string]> = [
  ['users', 'Accounts: an alias, a role, a salted hash of a key derived from her passphrase on her device, her public key, and her private key wrapped by a key only her passphrase can open.'],
  ['records', 'Her story: one encrypted envelope per saved version, her content key wrapped by her own key, and a hash. Nothing readable.'],
  ['blobs', 'Evidence files: ciphertext bytes (first bytes shown), size and hash. Metadata was stripped and the file encrypted on her device.'],
  ['shares', 'Shares with an attorney: the consent text she agreed to, the record id, and her content key wrapped to the attorney’s public key.'],
  ['phone_tokens', 'Phone verification: a keyed hash of the number and how many accounts it turned on. Never the number.'],
  ['oprf_quota', 'Sealed-match budget per account (the "account" row) or per in-process key holder: counts only.'],
  ['match_entries', 'Sealed-match entries: a tag (useless without the threshold OPRF), encrypted bundles, her encrypted label, and routing states sealed to the matcher.'],
  ['match_seals', 'Each entry’s key share, encrypted to each counselor on the signed roster.'],
  ['match_groups', 'Tags that two or more survivors sealed. The server learns that a tag repeats, never the identifier behind it.'],
  ['match_assignments', 'Which ONE counselor the matcher gave each group to, and why (the reason names states).'],
  ['conflict_checks', 'The assigned counselor’s conflict check, before any contact details are released.'],
  ['report_requests', 'A counselor’s request for a survivor’s full report, and her answer.'],
  ['report_releases', 'A report she agreed to release: her content key wrapped to that counselor’s public key, never the report.'],
  ['counselor_notes', 'Counselor outreach notes, encrypted on the counselor’s device.'],
  ['audit_events', 'Her own activity trail: text the server writes about actions (never her story).'],
  ['ledger', 'The tamper-evident ledger: ids, hashes and times only.'],
  ['sessions', 'Signed-in sessions: a hash of the session token and its expiry.'],
  ['matching_meta', 'Pinned OPRF public keys, the key epoch, and the organization-signed counselor roster.'],
  ['attorney_profiles', 'Attorneys’ public profiles (what survivors choose from).'],
  ['counselor_profiles', 'Legal Options Counselors’ public profiles and licensed states.'],
];

/** The latest `limit` rows of a table, exactly as stored (values cut by inspectValue). */
export function tableSnapshot(db: DB, table: string, caption: string, limit = 20): InspectorTable {
  if (!/^[a-z_]+$/.test(table)) throw new Error('bad table name');
  let rows: unknown[];
  try {
    rows = db.prepare(`SELECT * FROM ${table} ORDER BY rowid DESC LIMIT ?`).all(limit);
  } catch {
    rows = db.prepare(`SELECT * FROM ${table} LIMIT ?`).all(limit); // WITHOUT ROWID tables
  }
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  return { name: table, caption, total, rows: rows.map((r) => inspectValue(r) as Record<string, ReturnType<typeof inspectValue>>) };
}

export function limiterTable(caption: string, limiters: Array<[name: string, limiter: RateLimiter]>): InspectorTable {
  const rows = limiters.flatMap(([name, l]) =>
    l.entries().map((e) => ({ limiter: name, key: inspectValue(e.key), count: e.count, expiresAt: new Date(e.resetAt).toISOString() })),
  );
  return { name: 'rate limits (memory)', caption, total: rows.length, rows: rows.slice(0, 20) };
}

/** What this app server holds (its own column in the inspector). */
export function appProcess(o: {
  db: DB;
  recorder: RequestRecorder;
  limiters: Array<[name: string, limiter: RateLimiter]>;
  pendingPhoneChallenges: number;
  holdersInProcess: boolean;
}): InspectorProcess {
  const tables = APP_TABLES.map(([t, c]) => tableSnapshot(o.db, t, c));
  tables.push(
    limiterTable(
      'Rate limits held in memory only: a daily-salted HMAC of the client address (never the IP), or an account id; each expires within 24 hours.',
      o.limiters,
    ),
    {
      name: 'phone challenges (memory)',
      caption: 'Pending phone codes. Each holds the number in memory for at most 10 minutes (to check the code), never on disk.',
      total: o.pendingPhoneChallenges,
      rows: [],
    },
  );
  return {
    name: 'App server',
    role: 'app',
    note: o.holdersInProcess
      ? 'Receives only ciphertext, hashes and blinded elements. The OPRF key shares run INSIDE this process (development): no separation.'
      : 'Receives only ciphertext, hashes and blinded elements. Relays blinded elements to the key holders and sealed entries to the matcher.',
    requests: o.recorder.recent(),
    tables,
  };
}

/**
 * Where the database holds `text` (case-insensitive), in full values: every column of every table, blobs included.
 * For the Server view's "look for something she typed" box.
 */
export function findInDb(db: DB, text: string): Array<{ table: string; column: string; rows: number }> {
  const needle = text.toLowerCase();
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as Array<{ name: string }>;
  const found: Array<{ table: string; column: string; rows: number }> = [];
  for (const { name } of tables) {
    if (!/^[A-Za-z0-9_]+$/.test(name)) continue;
    const cols = db.prepare(`SELECT name FROM pragma_table_info(?)`).all(name) as Array<{ name: string }>;
    for (const { name: col } of cols) {
      if (!/^[A-Za-z0-9_]+$/.test(col)) continue;
      const n = (db.prepare(`SELECT COUNT(*) AS n FROM "${name}" WHERE instr(lower(CAST("${col}" AS TEXT)), ?) > 0`).get(needle) as { n: number }).n;
      if (n) found.push({ table: name, column: col, rows: n });
    }
  }
  return found;
}

/** Ask a remote service for its own description; a stopped service shows as an error, not a failure of the page. */
export async function fetchProcess(url: string, fallback: Pick<InspectorProcess, 'name' | 'role' | 'note'>, token?: string): Promise<InspectorProcess> {
  try {
    const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(1500) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as InspectorProcess;
  } catch (e) {
    return { ...fallback, error: `not reachable (${(e as Error).message})`, tables: [] };
  }
}
