/**
 * The app server's view of the m OPRF key holders (threshold OPRF, see src/oprf.ts and packages/crypto threshold.ts).
 *
 * The browser only ever talks to the app server (CSP connect-src 'self'), so the app server sits in the path of every
 * evaluation: it calls the holder in-process, or proxies to a remote holder process. Either way it only ever sees the
 * blinded element and the holder's evaluation + proof, never the identifier or the OPRF output (the client unblinds).
 *
 * Two backends:
 *   • InProcessHolderPool — every share is loaded into this process (development, tests, single-host demo). Gives NO
 *     separation against the operator: whoever runs the process holds t shares (W14).
 *   • RemoteHolderPool — each holder is a separate process (src/holder-server.ts), ideally at a separate institution.
 *     The app server authenticates each call with a short-lived Ed25519-signed holder token:
 *         token   = base64url(payload) "." base64url(Ed25519(MATRA_HOLDER_TOKEN_KEY, "matra/holder-token/v1|" ‖ payload))
 *         payload = {"sub": hex HMAC-SHA256(pepper, "holder-sub|" ‖ userId), "aud": <holder index>, "exp": now+60 s, "jti"}
 *     The holder pins the token public key, checks aud = its own index, exp, and refuses a replayed jti. `sub` is a
 *     stable pseudonym, so the holder can keep per-survivor quotas without ever learning a user id. The holder TRUSTS
 *     the app server's statement that `sub` is an eligible survivor (adult, and later phone-verified): it cannot check
 *     that itself. A compromised app server can therefore spend any holder's quota under fresh pseudonyms — the
 *     quotas bound honest-server abuse, they are not a defence against the app server (docs/threat-model.md W14).
 */
import { createHmac, createPrivateKey, createPublicKey, randomBytes, sign, verify, type KeyObject } from 'node:crypto';
import { oprfPublicKey, toBase64, type ShareKey } from '@matra/crypto';
import type { OprfHolderInfo } from '@matra/shared';
import type { DB } from './db.js';
import { OprfKeyHolder, SqliteQuotaStore, type EvaluateResult, type OprfLimits } from './oprf.js';

export type PoolEvaluateResult = EvaluateResult | { ok: false; code: 'holder_unavailable' };

export interface HolderPool {
  readonly t: number;
  readonly m: number;
  /** Share public keys in index order 1..m (from the shares in-process; from pinned config in remote mode). */
  publicKeys(): OprfHolderInfo[];
  evaluate(index: number, userId: string, blindedB64: string): Promise<PoolEvaluateResult>;
}

export class InProcessHolderPool implements HolderPool {
  readonly m: number;
  private readonly holders: OprfKeyHolder[];
  constructor(
    readonly t: number,
    shares: ShareKey[],
    db: DB,
    limits: OprfLimits,
  ) {
    const quota = new SqliteQuotaStore(db);
    this.holders = [...shares].sort((a, b) => a.index - b.index).map((s) => new OprfKeyHolder(s.index, s, quota, limits));
    this.m = this.holders.length;
  }
  publicKeys(): OprfHolderInfo[] {
    return this.holders.map((h) => ({ index: h.index, publicKey: h.publicKey }));
  }
  async evaluate(index: number, userId: string, blindedB64: string): Promise<PoolEvaluateResult> {
    const h = this.holders.find((x) => x.index === index);
    if (!h) return { ok: false, code: 'holder_unavailable' };
    return h.evaluate(userId, blindedB64);
  }
}

// ───────────── holder tokens ─────────────

export const HOLDER_TOKEN_DOMAIN = 'matra/holder-token/v1';
export const HOLDER_TOKEN_HEADER = 'X-Matra-Holder-Token';
const TOKEN_TTL_S = 60;

export interface HolderTokenPayload { sub: string; aud: number; exp: number; jti: string }

// Raw 32-byte Ed25519 seed / public key ⇄ node KeyObject (fixed RFC 8410 DER prefixes).
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
export function holderTokenPrivateKey(seed: Uint8Array): KeyObject {
  if (seed.length !== 32) throw new Error('holder token key must be 32 bytes');
  return createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
}
export function holderTokenPublicKey(raw: Uint8Array): KeyObject {
  if (raw.length !== 32) throw new Error('holder token public key must be 32 bytes');
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}
/** Raw 32-byte public key for a token signing seed (what holders pin as MATRA_HOLDER_TOKEN_PUBKEY, base64). */
export function holderTokenPublicKeyFromSeed(seed: Uint8Array): Uint8Array {
  const der = createPublicKey(holderTokenPrivateKey(seed)).export({ format: 'der', type: 'spki' });
  return new Uint8Array(der.subarray(der.length - 32));
}

/** Pseudonymous, stable subject for a user at the holders (they never see user ids). */
export function holderSubject(pepper: Buffer, userId: string): string {
  return createHmac('sha256', pepper).update(`holder-sub|${userId}`).digest('hex');
}

const b64url = (b: Uint8Array | string) => Buffer.from(b).toString('base64url');

export function signHolderToken(key: KeyObject, p: Omit<HolderTokenPayload, 'exp' | 'jti'> & Partial<HolderTokenPayload>): string {
  const payload = JSON.stringify({
    sub: p.sub,
    aud: p.aud,
    exp: p.exp ?? Math.floor(Date.now() / 1000) + TOKEN_TTL_S,
    jti: p.jti ?? randomBytes(16).toString('hex'),
  } satisfies HolderTokenPayload);
  const sig = sign(null, Buffer.from(`${HOLDER_TOKEN_DOMAIN}|${payload}`), key);
  return `${b64url(payload)}.${b64url(sig)}`;
}

/**
 * Holder side: verify signature, audience and expiry, and refuse a replayed jti (kept in memory for 2 minutes, longer
 * than any token lives). Returns the payload, or null for anything wrong (the caller answers 401 without detail).
 */
export class HolderTokenVerifier {
  private readonly seen = new Map<string, number>();
  constructor(
    private readonly key: KeyObject,
    private readonly index: number,
  ) {}
  verify(token: string | undefined, nowMs = Date.now()): HolderTokenPayload | null {
    if (!token || token.length > 1024) return null;
    const [p, s, extra] = token.split('.');
    if (!p || !s || extra !== undefined) return null;
    const payload = Buffer.from(p, 'base64url').toString('utf8');
    if (!verify(null, Buffer.from(`${HOLDER_TOKEN_DOMAIN}|${payload}`), this.key, Buffer.from(s, 'base64url'))) return null;
    let v: HolderTokenPayload;
    try {
      v = JSON.parse(payload);
    } catch {
      return null;
    }
    if (typeof v.sub !== 'string' || !/^[0-9a-f]{64}$/.test(v.sub) || typeof v.jti !== 'string' || v.jti.length > 64) return null;
    if (v.aud !== this.index || typeof v.exp !== 'number' || v.exp * 1000 <= nowMs || v.exp * 1000 > nowMs + 5 * 60_000) return null;
    for (const [j, until] of this.seen) if (until <= nowMs) this.seen.delete(j);
    if (this.seen.has(v.jti)) return null;
    this.seen.set(v.jti, nowMs + 120_000);
    return v;
  }
}

// ───────────── remote pool ─────────────

export interface RemoteHolderConfig {
  /** base URL of holder i at urls[i-1] */
  urls: string[];
  /** pinned base64 share public key of holder i at publicKeys[i-1] */
  publicKeys: string[];
  /** 32-byte Ed25519 seed (MATRA_HOLDER_TOKEN_KEY) */
  tokenKey: Uint8Array;
}

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

export class RemoteHolderPool implements HolderPool {
  readonly m: number;
  private readonly key: KeyObject;
  constructor(
    readonly t: number,
    private readonly cfg: RemoteHolderConfig,
    private readonly pepper: Buffer,
    private readonly timeoutMs = 3000,
  ) {
    if (cfg.urls.length !== cfg.publicKeys.length) throw new Error('MATRA_OPRF_HOLDER_URLS and MATRA_OPRF_SHARE_PUBKEYS must list the same number of holders');
    this.m = cfg.urls.length;
    this.key = holderTokenPrivateKey(cfg.tokenKey);
  }
  publicKeys(): OprfHolderInfo[] {
    return this.cfg.publicKeys.map((publicKey, i) => ({ index: i + 1, publicKey }));
  }
  private url(index: number, p: string) {
    return this.cfg.urls[index - 1]!.replace(/\/+$/, '') + p;
  }
  async evaluate(index: number, userId: string, blindedB64: string): Promise<PoolEvaluateResult> {
    if (!Number.isInteger(index) || index < 1 || index > this.m) return { ok: false, code: 'holder_unavailable' };
    const token = signHolderToken(this.key, { sub: holderSubject(this.pepper, userId), aud: index });
    try {
      const r = await fetch(this.url(index, '/evaluate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [HOLDER_TOKEN_HEADER]: token },
        body: JSON.stringify({ blinded: blindedB64 }),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });
      const body = (await r.json().catch(() => null)) as { evaluated?: unknown; proof?: unknown; code?: unknown } | null;
      if (r.status === 200 && body && typeof body.evaluated === 'string' && typeof body.proof === 'string' && B64.test(body.evaluated) && B64.test(body.proof))
        return { ok: true, response: { evaluated: body.evaluated, proof: body.proof } };
      if (r.status === 429 && (body?.code === 'rate_limited_daily' || body?.code === 'rate_limited_lifetime')) return { ok: false, code: body.code };
      if (r.status === 400 && body?.code === 'invalid_element') return { ok: false, code: 'invalid_element' };
      return { ok: false, code: 'holder_unavailable' };
    } catch {
      return { ok: false, code: 'holder_unavailable' };
    }
  }
  /**
   * Startup check: each reachable holder's GET /key must equal its pinned share public key (refuse to start otherwise).
   * An unreachable holder only warns: any t of m are enough to keep sealing.
   */
  async verifyKeys(): Promise<{ reachable: number }> {
    let reachable = 0;
    for (let i = 1; i <= this.m; i++) {
      let got: string | undefined;
      try {
        const r = await fetch(this.url(i, '/key'), { signal: AbortSignal.timeout(this.timeoutMs), redirect: 'error' });
        got = ((await r.json()) as { publicKey?: string }).publicKey;
      } catch {
        console.warn(`[matra] WARNING: OPRF key holder ${i} is not reachable; sealing needs ${this.t} of ${this.m}.`);
        continue;
      }
      if (got !== this.cfg.publicKeys[i - 1])
        throw new Error(`OPRF key holder ${i} serves a public key that differs from MATRA_OPRF_SHARE_PUBKEYS. Refusing to start.`);
      reachable++;
    }
    return { reachable };
  }
}

/** Public key of a share, base64 (helper for config / ceremony output). */
export const sharePublicKeyB64 = (secretKey: Uint8Array) => toBase64(oprfPublicKey(secretKey));
