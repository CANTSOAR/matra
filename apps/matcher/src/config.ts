/**
 * Matcher process settings (src/server.ts). Secrets follow the app server's pattern (docs/design/WEEKEND_MVP.md §1.3):
 * NAME (value) or NAME_FILE (path outside the matcher's DB directory); required in production, generated once into a
 * dev file otherwise.
 *
 *   MATRA_MATCHER_KEY / _FILE                 32-byte secret: the matcher's routing (P-256) and signing keys
 *   MATRA_MATCHER_TOKEN / _FILE               bearer token the app server uses (≥ 32 chars)
 *   MATRA_ATTESTATION                         simulated (default) | nitro | confidential-space (not implemented)
 *   MATRA_ATTESTATION_PLATFORM_KEY / _FILE    simulated platform only: the dev Ed25519 "platform" key (32 bytes hex)
 *   MATRA_MATCHER_DB_PATH                     its own SQLite file (default apps/matcher/data/matcher.db)
 *   MATRA_MATCH_RELEASE_DELAY_HOURS           default 72 (as on the app server)
 *   MATRA_COUNSELOR_ROSTER_PUBKEY             base64 org roster key: only a roster it signed is accepted. Required in
 *                                             production (unset, the matcher would take the app server's word for who
 *                                             the counselors are and where they're licensed: W18)
 *   MATRA_DEMO_MODE=1                         lets production run with the simulated attester and without a roster key
 *                                             (fictional data only)
 *   PORT (default 4320), HOST (default 127.0.0.1; production 0.0.0.0)
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fromBase64, matcherKeysFromSeed, platformPublicKey, toHex } from '@matra/crypto';
import { MATCHER_ROOT, computeMeasurement } from './measure.js';
import { SimulatedAttester, UnimplementedAttester, type AttestationProvider } from './attestation.js';

export type Env = Record<string, string | undefined>;
export const MATCHER_DATA_DIR = path.join(MATCHER_ROOT, 'data');

const isProduction = (env: Env) => env.NODE_ENV === 'production';
const isInside = (dir: string, file: string) => {
  const rel = path.relative(dir, file);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** A secret: NAME or NAME_FILE (outside dbDir); production: required; development: generated once into devFile. */
export function loadMatcherSecret(name: string, o: { env: Env; dbDir: string; devFile: string; label: string; minLength?: number }): string {
  if (o.env[name]) return o.env[name]!.trim();
  const file = o.env[`${name}_FILE`];
  if (file) {
    if (isInside(path.resolve(o.dbDir), path.resolve(file))) throw new Error(`${name}_FILE must be outside the matcher's database directory`);
    return fs.readFileSync(file, 'utf8').trim();
  }
  if (isProduction(o.env)) throw new Error(`${name} (or ${name}_FILE) must be set in production: ${o.label} is never generated automatically.`);
  if (fs.existsSync(o.devFile)) return fs.readFileSync(o.devFile, 'utf8').trim();
  fs.mkdirSync(path.dirname(o.devFile), { recursive: true });
  const v = toHex(randomBytes(32));
  fs.writeFileSync(o.devFile, v, { mode: 0o600 });
  console.warn(`[matcher] WARNING: ${name} not set — generated a DEV ${o.label} at ${o.devFile}.`);
  return v;
}

const hex32 = (v: string, name: string) => {
  if (!/^[0-9a-fA-F]{64}$/.test(v)) throw new Error(`${name} must be 64 hex characters`);
  return Uint8Array.from(v.toLowerCase().match(/../g)!.map((b) => parseInt(b, 16)));
};

/**
 * The attestation provider for this deployment. Simulated in production is refused unless MATRA_DEMO_MODE=1
 * (the same rule as the app server's assertMockAllowed).
 */
export function loadAttester(o: { env: Env; keys: ReturnType<typeof matcherKeysFromSeed>; platformSecretKey?: Uint8Array; measurement?: string }): AttestationProvider {
  const kind = o.env.MATRA_ATTESTATION || 'simulated';
  if (kind === 'nitro' || kind === 'confidential-space') return new UnimplementedAttester(kind);
  if (kind !== 'simulated') throw new Error(`MATRA_ATTESTATION must be simulated, nitro or confidential-space, got "${kind}"`);
  if (isProduction(o.env) && o.env.MATRA_DEMO_MODE !== '1')
    throw new Error(
      'matcher attestation (simulated) is a mock/simulated provider and cannot run in production. Configure a real provider, or set MATRA_DEMO_MODE=1 for a fictional-data demo.',
    );
  if (!o.platformSecretKey) throw new Error('the simulated attester needs a platform key');
  return new SimulatedAttester({ platformSecretKey: o.platformSecretKey, measurement: o.measurement ?? computeMeasurement(), keys: o.keys });
}

export function loadMatcherSettings(env: Env = process.env) {
  const dbPath = env.MATRA_MATCHER_DB_PATH || path.join(MATCHER_DATA_DIR, 'matcher.db');
  const dbDir = path.dirname(path.resolve(dbPath));
  const secret = (name: string, label: string, dev: string) => loadMatcherSecret(name, { env, dbDir, devFile: path.join(MATCHER_DATA_DIR, dev), label });
  const keys = matcherKeysFromSeed(hex32(secret('MATRA_MATCHER_KEY', 'matcher key', 'matcher.key'), 'MATRA_MATCHER_KEY'));
  const token = secret('MATRA_MATCHER_TOKEN', 'app-server token', 'matcher-token.key');
  if (token.length < 32) throw new Error('MATRA_MATCHER_TOKEN must be at least 32 characters');
  const kind = env.MATRA_ATTESTATION || 'simulated';
  const platformSecretKey =
    kind === 'simulated' ? hex32(secret('MATRA_ATTESTATION_PLATFORM_KEY', 'simulated platform key', 'attestation-platform.key'), 'MATRA_ATTESTATION_PLATFORM_KEY') : undefined;
  const attester = loadAttester({ env, keys, platformSecretKey });
  const raw = env.MATRA_MATCH_RELEASE_DELAY_HOURS;
  const delay = raw === undefined || raw === '' ? 72 : Number(raw);
  if (!Number.isFinite(delay) || delay < 0) throw new Error('MATRA_MATCH_RELEASE_DELAY_HOURS must be a number ≥ 0');
  const rosterKey = env.MATRA_COUNSELOR_ROSTER_PUBKEY ? fromBase64(env.MATRA_COUNSELOR_ROSTER_PUBKEY.trim()) : undefined;
  if (rosterKey && rosterKey.length !== 32) throw new Error('MATRA_COUNSELOR_ROSTER_PUBKEY must be a base64 Ed25519 public key (32 bytes)');
  if (!rosterKey && isProduction(env) && env.MATRA_DEMO_MODE !== '1')
    throw new Error(
      'MATRA_COUNSELOR_ROSTER_PUBKEY must be set in production: without it the matcher would use the app server’s own counselor list and licensed states. Set MATRA_DEMO_MODE=1 only for a fictional-data demo.',
    );
  return {
    dbPath,
    keys,
    token,
    attester,
    platformPublicKey: platformSecretKey ? platformPublicKey(platformSecretKey) : undefined,
    releaseDelayMs: delay * 3_600_000,
    rosterKey,
    port: Number(env.PORT) || 4320,
    demoMode: env.MATRA_DEMO_MODE === '1',
  };
}
