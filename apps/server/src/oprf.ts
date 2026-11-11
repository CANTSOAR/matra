/**
 * One OPRF key holder for sealed matching (RFC 9497 VOPRF, ristretto255-SHA512), threshold version.
 *
 * The matching key k is Shamir-shared among m independent holders (packages/crypto threshold.ts; dealt by
 * src/oprf-ceremony.ts). Holder i keeps ONE share k_i and evaluates the client's blinded element with it, returning a
 * DLEQ proof against its own published share public key pk_i. Any t holders' answers combine (on the survivor's device)
 * into one evaluation under k; fewer than t learn nothing about the identifier and cannot compute a tag, so an offline
 * dictionary attack over phone numbers / handles needs t shares (docs/threat-model.md W2, W14).
 *
 * This class depends only on its share, a QuotaStore and an opaque subject string, so the same code runs:
 *   • in-process (development, tests, single-host demo): the subject is the user id, quotas live in the app DB;
 *   • as a standalone holder process (src/holder.ts): the subject is the app server's HMAC'd token subject (holders
 *     never see user ids), quotas live in the holder's own SQLite file.
 *
 * Rate limits (per subject, per holder): `perDay` evaluations per UTC day and `lifetime` evaluations in total. Every
 * identifier costs one evaluation at each holder that answers. Holder quotas are keyed by the holder's index AND its
 * share public key, so a key rotation starts every holder's counters afresh (re-sealing under the new key must not hit
 * limits spent under the old one) even at a standalone holder whose DB the app server cannot clear.
 *
 * Per-holder counters alone do not bound an account: nothing ties one blinded element to the same t holders, so an
 * account could send each guess to a different t-subset (2-of-3: A→{1,2}, B→{1,3}, C→{2,3}) and get ⌊m·L/t⌋
 * identifiers instead of L. The app server therefore also charges the ACCOUNT once per distinct blinded element
 * (AccountOprfBudget below) before relaying to any holder.
 */
import { createHash } from 'node:crypto';
import { fromBase64, oprfBlindEvaluate, oprfPublicKey, toBase64, type OprfKeyPair } from '@matra/crypto';
import type { OprfEvaluateResponse } from '@matra/shared';
import type { DB } from './db.js';

export interface OprfLimits {
  perDay: number;
  lifetime: number;
}

export const DEFAULT_OPRF_LIMITS: OprfLimits = { perDay: 10, lifetime: 50 };

export type EvaluateResult =
  | { ok: true; response: OprfEvaluateResponse }
  | { ok: false; code: 'rate_limited_daily' | 'rate_limited_lifetime' | 'invalid_element' };

export interface QuotaRow { day: string; dayCount: number; lifetimeCount: number }

/** Per-(subject, holder) counters. Only today's count and a lifetime total — no per-evaluation timestamps. */
export interface QuotaStore {
  get(subject: string, holder: string): QuotaRow | undefined;
  put(subject: string, holder: string, row: QuotaRow): void;
}

/** QuotaStore over an `oprf_quota (user_id, holder, day, day_count, lifetime_count)` table in any SQLite DB. */
export class SqliteQuotaStore implements QuotaStore {
  private readonly getQ;
  private readonly putQ;
  constructor(db: DB) {
    this.getQ = db.prepare('SELECT day, day_count, lifetime_count FROM oprf_quota WHERE user_id = ? AND holder = ?');
    this.putQ = db.prepare(
      `INSERT INTO oprf_quota (user_id, holder, day, day_count, lifetime_count) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, holder) DO UPDATE SET day = excluded.day, day_count = excluded.day_count, lifetime_count = excluded.lifetime_count`,
    );
  }
  get(subject: string, holder: string): QuotaRow | undefined {
    const q = this.getQ.get(subject, holder) as { day: string; day_count: number; lifetime_count: number } | undefined;
    return q && { day: q.day, dayCount: q.day_count, lifetimeCount: q.lifetime_count };
  }
  put(subject: string, holder: string, row: QuotaRow): void {
    this.putQ.run(subject, holder, row.day, row.dayCount, row.lifetimeCount);
  }
}

export class OprfKeyHolder {
  readonly publicKey: string;

  constructor(
    readonly index: number,
    private readonly share: OprfKeyPair,
    private readonly quota: QuotaStore,
    readonly limits: OprfLimits = DEFAULT_OPRF_LIMITS,
  ) {
    if (!Number.isInteger(index) || index < 1) throw new Error(`OPRF holder index must be a positive integer (got ${index})`);
    if (toBase64(oprfPublicKey(share.secretKey)) !== toBase64(share.publicKey)) throw new Error(`OPRF share ${index}: public key mismatch`);
    this.publicKey = toBase64(share.publicKey);
  }

  /** Quota key: index and share key, so counters spent under an old key never block re-sealing under a new one. */
  get quotaId(): string {
    return `${this.index}:${this.publicKey}`;
  }

  /** Evaluate one blinded element for `subject` (the caller has already checked the subject is an eligible survivor). */
  evaluate(subject: string, blindedB64: string): EvaluateResult {
    const holder = this.quotaId;
    const today = new Date().toISOString().slice(0, 10);
    const q = this.quota.get(subject, holder);
    const dayCount = q && q.day === today ? q.dayCount : 0;
    const lifetime = q?.lifetimeCount ?? 0;
    if (lifetime >= this.limits.lifetime) return { ok: false, code: 'rate_limited_lifetime' };
    if (dayCount >= this.limits.perDay) return { ok: false, code: 'rate_limited_daily' };
    let out: { evaluated: Uint8Array; proof: Uint8Array };
    try {
      out = oprfBlindEvaluate(this.share, fromBase64(blindedB64));
    } catch {
      return { ok: false, code: 'invalid_element' }; // not a valid (non-identity) ristretto255 element: not counted
    }
    this.quota.put(subject, holder, { day: today, dayCount: dayCount + 1, lifetimeCount: lifetime + 1 });
    return { ok: true, response: { evaluated: toBase64(out.evaluated), proof: toBase64(out.proof) } };
  }
}

/** The quota row holder id the app server uses for the account-level budget (never a holder's `index:publicKey`). */
export const ACCOUNT_QUOTA_ID = 'account';

/**
 * Account-level OPRF budget, enforced by the app server before it calls (or relays to) any holder, in both modes.
 *
 * Charges the account ONE unit (daily + lifetime, same limits as a holder) per distinct blinded element B: the first
 * holder call for a new B is charged, further calls for the same B that UTC day (the other holders, retries) are free.
 * So an account gets L identifiers whichever t-subsets it asks, not ⌊m·L/t⌋.
 *
 * Which B were charged today is kept as SHA-256(B) per account, in memory only, and dropped at the UTC day change.
 * B is a uniformly random group element (blinded), so its hash says nothing about the identifier. A restart forgets
 * the set: at worst an honest survivor is charged once more for the identifier she was sealing at that moment. A unit
 * is spent even if every holder then turns out to be unavailable (no refund: refunds would reopen the race above).
 */
export class AccountOprfBudget {
  private charged = new Map<string, Set<string>>();
  private day = '';
  constructor(
    private readonly quota: QuotaStore,
    readonly limits: OprfLimits,
  ) {}

  /** Charge `subject` for `blindedB64` unless it was already charged today. Synchronous: no interleaving between check and charge. */
  charge(subject: string, blindedB64: string, now = new Date()): { ok: true } | { ok: false; code: 'rate_limited_daily' | 'rate_limited_lifetime' } {
    const today = now.toISOString().slice(0, 10);
    if (today !== this.day) {
      this.charged = new Map();
      this.day = today;
    }
    const h = createHash('sha256').update(blindedB64).digest('base64');
    const mine = this.charged.get(subject);
    if (mine?.has(h)) return { ok: true };
    const q = this.quota.get(subject, ACCOUNT_QUOTA_ID);
    const dayCount = q && q.day === today ? q.dayCount : 0;
    const lifetime = q?.lifetimeCount ?? 0;
    if (lifetime >= this.limits.lifetime) return { ok: false, code: 'rate_limited_lifetime' };
    if (dayCount >= this.limits.perDay) return { ok: false, code: 'rate_limited_daily' };
    this.quota.put(subject, ACCOUNT_QUOTA_ID, { day: today, dayCount: dayCount + 1, lifetimeCount: lifetime + 1 });
    if (mine) mine.add(h);
    else this.charged.set(subject, new Set([h]));
    return { ok: true };
  }

  /** Account deleted, or keys rotated: forget the in-memory set (the DB rows are deleted by the caller). */
  forget(subject?: string): void {
    if (subject === undefined) this.charged.clear();
    else this.charged.delete(subject);
  }
}
