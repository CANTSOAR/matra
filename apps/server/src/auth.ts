/**
 * Zero-knowledge authentication.
 *
 * The client derives `authKey` from the passphrase (PBKDF2 → HKDF "matra/auth" — label defined in the crypto package); the
 * passphrase and the master key never reach the server. The server stores only
 * scrypt(authKey, per-user random salt) and compares with timingSafeEqual.
 */
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { DEFAULT_KDF_ITERATIONS } from '@matra/crypto';
import type { Role } from '@matra/shared';
import type { DB } from './db.js';
import { sha256Hex } from './ledger.js';

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SCRYPT_KEYLEN = 32;
const SCRYPT_OPTS: ScryptOptions = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function scrypt(password: Buffer, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTS, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashAuthKey(authKeyB64: string): Promise<{ hash: Buffer; salt: Buffer }> {
  const salt = randomBytes(16);
  return { hash: await scrypt(Buffer.from(authKeyB64, 'base64'), salt), salt };
}

export async function verifyAuthKey(authKeyB64: string, salt: Buffer, expected: Buffer): Promise<boolean> {
  const got = await scrypt(Buffer.from(authKeyB64, 'base64'), salt);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Burn the same CPU as a real verification so unknown usernames aren't distinguishable by timing. */
const DUMMY_SALT = randomBytes(16);
export async function dummyVerify(authKeyB64: string): Promise<void> {
  await scrypt(Buffer.from(authKeyB64, 'base64'), DUMMY_SALT);
}

/** Deterministic fake prelogin salt for unknown usernames: first 16 bytes of HMAC(pepper, username), base64. */
export function fakeKdfSalt(pepper: Buffer, username: string): { kdfSalt: string; kdfIterations: number } {
  const mac = createHmac('sha256', pepper).update(`prelogin|${username}`).digest();
  return { kdfSalt: mac.subarray(0, 16).toString('base64'), kdfIterations: DEFAULT_KDF_ITERATIONS };
}

// ───────────── sessions ─────────────

export function createSession(db: DB, userId: string): string {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    sha256Hex(token),
    userId,
    new Date(now).toISOString(),
    now + SESSION_TTL_MS,
  );
  return token;
}

export function deleteSession(db: DB, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256Hex(token));
}

export interface AuthedUser {
  id: string;
  username: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
      sessionToken?: string;
    }
  }
}

function bearer(req: Request): string | undefined {
  const h = req.get('authorization');
  if (!h) return undefined;
  const m = /^Bearer ([A-Za-z0-9_-]{20,128})$/.exec(h);
  return m?.[1];
}

export function requireAuth(db: DB) {
  const lookup = db.prepare(
    `SELECT u.id, u.username, u.role, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
  );
  const purge = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
  return (req: Request, res: Response, next: NextFunction) => {
    const token = bearer(req);
    if (!token) return res.status(401).json({ error: 'Authentication required', code: 'unauthorized' });
    const tokenHash = sha256Hex(token);
    const row = lookup.get(tokenHash) as (AuthedUser & { expires_at: number }) | undefined;
    if (!row) return res.status(401).json({ error: 'Session invalid or expired', code: 'unauthorized' });
    if (row.expires_at <= Date.now()) {
      purge.run(tokenHash);
      return res.status(401).json({ error: 'Session invalid or expired', code: 'session_expired' });
    }
    req.user = { id: row.id, username: row.username, role: row.role };
    req.sessionToken = token;
    next();
  };
}

export function requireRole(role: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.role !== role)
      return res.status(403).json({ error: `Only ${role} accounts can do this`, code: 'forbidden_role' });
    next();
  };
}

// ───────────── rate limiting ─────────────

/** Fixed-window in-memory limiter. Good enough for a single-process MVP. */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Returns true if allowed. */
  hit(key: string): boolean {
    const now = Date.now();
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    cur.count++;
    return cur.count <= this.max;
  }
}
