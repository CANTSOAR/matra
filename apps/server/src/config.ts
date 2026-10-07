import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { generateOprfKey, oprfPublicKey, toHex, type OprfKeyPair } from '@matra/crypto';

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

/**
 * OPRF key share for sealed matching, holder 'a' or 'b' (see src/oprf.ts).
 * Production: set MATRA_OPRF_KEY_A and MATRA_OPRF_KEY_B (64 hex chars: a 32-byte little-endian ristretto255 scalar),
 * or MATRA_OPRF_KEY_A_FILE / MATRA_OPRF_KEY_B_FILE pointing at a file containing that hex. The two shares should be
 * generated, stored and backed up by DIFFERENT people/systems; nobody should ever hold both.
 *   Generate one: node -e "import('@matra/crypto').then(c=>console.log(c.toHex(c.generateOprfKey().secretKey)))"
 * Otherwise (dev and demo deploys): generated once and persisted to apps/server/data/oprf-key-{a,b}.key (mode 0600),
 * with a warning. MATRA_REQUIRE_OPRF_KEYS=1 makes a missing key fatal in production.
 * Changing either share breaks matching against existing entries (survivors keep their identifiers in their own
 * vault so they can re-submit after a rotation).
 */
export function loadOprfKey(holder: 'a' | 'b'): OprfKeyPair {
  const H = holder.toUpperCase();
  const fromHex = (hex: string, where: string): OprfKeyPair => {
    const h = hex.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(h)) throw new Error(`${where} must be 64 hex characters`);
    const secretKey = Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
    return { secretKey, publicKey: oprfPublicKey(secretKey) };
  };
  const env = process.env[`MATRA_OPRF_KEY_${H}`];
  if (env) return fromHex(env, `MATRA_OPRF_KEY_${H}`);
  const envFile = process.env[`MATRA_OPRF_KEY_${H}_FILE`];
  if (envFile) return fromHex(fs.readFileSync(envFile, 'utf8'), `MATRA_OPRF_KEY_${H}_FILE`);
  // Demo deployments (Render / Docker) don't set these yet: generate + persist next to the DB, loudly. A real-data
  // deployment must set both, generated and held by different people (docs/SECURITY_WHITEPAPER.md §4a).
  if (process.env.NODE_ENV === 'production' && process.env.MATRA_REQUIRE_OPRF_KEYS === '1')
    throw new Error(`MATRA_OPRF_KEY_${H} (or MATRA_OPRF_KEY_${H}_FILE) must be set`);
  const file = path.join(DATA_DIR, `oprf-key-${holder}.key`);
  if (fs.existsSync(file)) return fromHex(fs.readFileSync(file, 'utf8'), file);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const k = generateOprfKey();
  fs.writeFileSync(file, toHex(k.secretKey), { mode: 0o600 });
  console.warn(`[matra] WARNING: MATRA_OPRF_KEY_${H} not set — generated a dev OPRF key share at ${file}. Set it in production.`);
  return k;
}

/** Sealed-matching OPRF rate limits per survivor account and key holder (MATRA_OPRF_PER_DAY, MATRA_OPRF_LIFETIME). */
export function loadOprfLimits(): { perDay: number; lifetime: number } {
  const n = (v: string | undefined, d: number) => (v && Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return { perDay: n(process.env.MATRA_OPRF_PER_DAY, 10), lifetime: n(process.env.MATRA_OPRF_LIFETIME, 50) };
}
