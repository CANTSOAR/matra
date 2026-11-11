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
 * identifier costs one evaluation at each holder that answers.
 */
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

  /** Evaluate one blinded element for `subject` (the caller has already checked the subject is an eligible survivor). */
  evaluate(subject: string, blindedB64: string): EvaluateResult {
    const holder = String(this.index);
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
