import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { generateOprfKey, oprfKeyFromSecret, oprfPublicKey, toHex, type OprfKeyPair } from '@matra/crypto';

/** apps/server/data */
export const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

/** apps/web/dist — the production build of the web app (`npm run build`). */
export const WEB_DIST_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');

export function resolveDbPath(): string {
  return process.env.MATRA_DB_PATH || path.join(DATA_DIR, 'matra.db');
}

/**
 * Server pepper (HMAC key for fake prelogin salts of unknown usernames).
 * Production: set MATRA_PEPPER (≥ 32 chars, e.g. `openssl rand -hex 32`).
 * Dev: generated once and persisted to apps/server/data/pepper.key (mode 0600).
 */
export function loadPepper(): Buffer {
  const env = process.env.MATRA_PEPPER;
  if (env) {
    if (env.length < 32) throw new Error('MATRA_PEPPER must be at least 32 characters');
    return Buffer.from(env, 'utf8');
  }
  if (process.env.NODE_ENV === 'production') throw new Error('MATRA_PEPPER must be set in production');
  const file = path.join(DATA_DIR, 'pepper.key');
  if (fs.existsSync(file)) return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const pepper = randomBytes(32);
  fs.writeFileSync(file, pepper.toString('hex'), { mode: 0o600 });
  console.warn(`[matra] WARNING: MATRA_PEPPER not set — generated a dev pepper at ${file}. Set MATRA_PEPPER in production.`);
  return pepper;
}

type Env = Record<string, string | undefined>;

const isInside = (dir: string, file: string) => {
  const rel = path.relative(dir, file);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};
const real = (p: string) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

/**
 * OPRF key share for sealed matching, holder 'a' or 'b' (see src/oprf.ts).
 *
 * MATRA_OPRF_KEY_A / MATRA_OPRF_KEY_B: either 64 hex chars (a 32-byte little-endian ristretto255 scalar) or any
 * high-entropy secret of ≥ 32 characters (e.g. a value Render generated), from which the key is derived
 * (oprfKeyFromSecret). Or MATRA_OPRF_KEY_A_FILE / _B_FILE: a file holding either form. The files must live OUTSIDE
 * the database directory (a copy of the DB volume must never also be a copy of both keys) and must be different files.
 * The two shares should be generated, stored and backed up by DIFFERENT people/systems; nobody should hold both.
 *   Generate one: node -e "import('@matra/crypto').then(c=>console.log(c.toHex(c.generateOprfKey().secretKey)))"
 *
 * NODE_ENV=production (or MATRA_REQUIRE_OPRF_KEYS=1): a missing key is FATAL — never auto-generated, because a key
 * generated next to the database would put both shares (and therefore an offline dictionary attack over every phone
 * number and handle, research A7 / review "dict.mts") on the same disk as the tags.
 * Development: generated once and persisted to apps/server/data/oprf-key-{a,b}.key (mode 0600), with a warning.
 *
 * Changing either share changes the matching function. The server refuses to start with keys that differ from the
 * ones recorded in the database unless MATRA_OPRF_ROTATE=1 (see app.ts); survivors' clients then re-seal.
 */
export function loadOprfKey(holder: 'a' | 'b', env: Env = process.env): OprfKeyPair {
  const H = holder.toUpperCase();
  const production = env.NODE_ENV === 'production';
  const required = production || env.MATRA_REQUIRE_OPRF_KEYS === '1';
  const parse = (value: string, where: string): OprfKeyPair => {
    const v = value.trim();
    if (/^[0-9a-fA-F]{64}$/.test(v)) {
      const secretKey = Uint8Array.from(v.toLowerCase().match(/../g)!.map((b) => parseInt(b, 16)));
      try {
        return { secretKey, publicKey: oprfPublicKey(secretKey) };
      } catch {
        // Most random 32-byte values (e.g. `openssl rand -hex 32`) are not canonical ristretto255 scalars; treat such
        // a value as a secret to derive the key from rather than refusing to start.
        return oprfKeyFromSecret(v, holder);
      }
    }
    if (v.length >= 32) return oprfKeyFromSecret(v, holder);
    throw new Error(`${where} must be 64 hex characters or a secret of at least 32 characters`);
  };
  const value = env[`MATRA_OPRF_KEY_${H}`];
  if (value) return parse(value, `MATRA_OPRF_KEY_${H}`);
  const file = env[`MATRA_OPRF_KEY_${H}_FILE`];
  if (file) {
    const keyPath = real(file);
    const dbDir = real(path.dirname(path.resolve(env.MATRA_DB_PATH || path.join(DATA_DIR, 'matra.db'))));
    if (isInside(dbDir, keyPath) || (production && isInside(real(DATA_DIR), keyPath)))
      throw new Error(`MATRA_OPRF_KEY_${H}_FILE must be outside the database directory (${dbDir}): a copy of the DB volume must never include the OPRF keys`);
    const other = env[`MATRA_OPRF_KEY_${holder === 'a' ? 'B' : 'A'}_FILE`];
    if (other && real(other) === keyPath) throw new Error('MATRA_OPRF_KEY_A_FILE and MATRA_OPRF_KEY_B_FILE must be different files');
    return parse(fs.readFileSync(keyPath, 'utf8'), `MATRA_OPRF_KEY_${H}_FILE`);
  }
  if (required)
    throw new Error(
      `MATRA_OPRF_KEY_${H} (or MATRA_OPRF_KEY_${H}_FILE, outside the database directory) must be set${production ? ' in production' : ''}. ` +
        'OPRF key shares are never generated automatically in production (see docs/DEPLOY.md).',
    );
  const devFile = path.join(DATA_DIR, `oprf-key-${holder}.key`);
  if (fs.existsSync(devFile)) return parse(fs.readFileSync(devFile, 'utf8'), devFile);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const k = generateOprfKey();
  fs.writeFileSync(devFile, toHex(k.secretKey), { mode: 0o600 });
  console.warn(`[matra] WARNING: MATRA_OPRF_KEY_${H} not set — generated a DEV OPRF key share at ${devFile}. Production refuses to start without it.`);
  return k;
}

/**
 * Sealed-matching release / rotation settings.
 *   MATRA_MATCH_RELEASE_DELAY_HOURS (default 72): a group is released to counselors only once the entries that make
 *     it a match are at least this old (Sybil + counselor guessing mitigation, review M2). 0 disables (tests, e2e).
 *   MATRA_OPRF_ROTATE=1: accept OPRF key holder keys that differ from the ones recorded in the DB (a deliberate
 *     rotation): the key epoch is incremented, and survivors' clients re-seal their entries on next sign-in.
 */
export function loadMatchingSettings(env: Env = process.env): { releaseDelayHours: number; allowKeyRotation: boolean } {
  const raw = env.MATRA_MATCH_RELEASE_DELAY_HOURS;
  const n = raw === undefined || raw === '' ? 72 : Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error('MATRA_MATCH_RELEASE_DELAY_HOURS must be a number ≥ 0');
  return { releaseDelayHours: n, allowKeyRotation: env.MATRA_OPRF_ROTATE === '1' };
}

/** Sealed-matching OPRF rate limits per survivor account and key holder (MATRA_OPRF_PER_DAY, MATRA_OPRF_LIFETIME). */
export function loadOprfLimits(): { perDay: number; lifetime: number } {
  const n = (v: string | undefined, d: number) => (v && Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return { perDay: n(process.env.MATRA_OPRF_PER_DAY, 10), lifetime: n(process.env.MATRA_OPRF_LIFETIME, 50) };
}
