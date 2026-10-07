import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/** apps/server/data */
export const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

export function resolveDbPath(): string {
  return process.env.MATRA_DB_PATH || path.join(DATA_DIR, 'matra.db');
}

/**
 * Server pepper (HMAC key for escrow hashes and fake prelogin salts).
 * Production: set MATRA_PEPPER (≥ 32 chars, e.g. `openssl rand -hex 32`).
 * Dev: generated once and persisted to apps/server/data/pepper.key (mode 0600).
 * Changing the pepper breaks escrow matching against existing entries.
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
