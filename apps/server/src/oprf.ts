/**
 * OPRF key holders for sealed matching (RFC 9497 VOPRF, ristretto255-SHA512).
 *
 * The matching key is split additively: k = k_A + k_B. Holder A and holder B each keep ONE share and evaluate the
 * client's blinded element independently, with a DLEQ proof against their own published public key. Nobody — not the
 * app server, not either holder — can compute the matching function alone, so an offline dictionary attack over
 * phone numbers / handles needs both keys (docs/threat-model.md).
 *
 * MVP deployment: both holders run inside the API process, each with its own key (MATRA_OPRF_KEY_A / _B) and its own
 * quota counters. This class has no dependency on the rest of the app except an `oprf_quota` table and a user id, so
 * production can run each holder in a separate process / host / organisation (see docs/SECURITY_WHITEPAPER.md
 * "Deploying the key holders"). In that setup the holder authenticates the survivor with a short-lived token issued by
 * the app server, and keeps its own quota store.
 *
 * Rate limits (per verified-adult survivor account, per holder): `perDay` evaluations per UTC day and `lifetime`
 * evaluations in total. Every identifier costs one evaluation at each holder.
 */
import { fromBase64, oprfBlindEvaluate, oprfPublicKey, toBase64, type OprfKeyPair } from '@matra/crypto';
import type { OprfEvaluateResponse } from '@matra/shared';
import type { DB } from './db.js';

export type HolderId = 'a' | 'b';

export interface OprfLimits {
  perDay: number;
  lifetime: number;
}

export const DEFAULT_OPRF_LIMITS: OprfLimits = { perDay: 10, lifetime: 50 };

export type EvaluateResult =
  | { ok: true; response: OprfEvaluateResponse }
  | { ok: false; code: 'rate_limited_daily' | 'rate_limited_lifetime' | 'invalid_element' };

export class OprfKeyHolder {
  readonly publicKey: string;
  private readonly getQuota;
  private readonly putQuota;

  constructor(
    readonly id: HolderId,
    private readonly key: OprfKeyPair,
    db: DB,
    readonly limits: OprfLimits = DEFAULT_OPRF_LIMITS,
  ) {
    if (toBase64(oprfPublicKey(key.secretKey)) !== toBase64(key.publicKey)) throw new Error(`OPRF key ${id}: public key mismatch`);
    this.publicKey = toBase64(key.publicKey);
    this.getQuota = db.prepare('SELECT day, day_count, lifetime_count FROM oprf_quota WHERE user_id = ? AND holder = ?');
    this.putQuota = db.prepare(
      `INSERT INTO oprf_quota (user_id, holder, day, day_count, lifetime_count) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, holder) DO UPDATE SET day = excluded.day, day_count = excluded.day_count, lifetime_count = excluded.lifetime_count`,
    );
  }

  /** Evaluate one blinded element for `userId` (caller has already checked the account is a verified-adult survivor). */
  evaluate(userId: string, blindedB64: string): EvaluateResult {
    const today = new Date().toISOString().slice(0, 10);
    const q = this.getQuota.get(userId, this.id) as { day: string; day_count: number; lifetime_count: number } | undefined;
    const dayCount = q && q.day === today ? q.day_count : 0;
    const lifetime = q?.lifetime_count ?? 0;
    if (lifetime >= this.limits.lifetime) return { ok: false, code: 'rate_limited_lifetime' };
    if (dayCount >= this.limits.perDay) return { ok: false, code: 'rate_limited_daily' };
    let out: { evaluated: Uint8Array; proof: Uint8Array };
    try {
      out = oprfBlindEvaluate(this.key, fromBase64(blindedB64));
    } catch {
      return { ok: false, code: 'invalid_element' }; // not a valid (non-identity) ristretto255 element: not counted
    }
    // Only the current day's count and a lifetime total are kept — no per-evaluation timestamps.
    this.putQuota.run(userId, this.id, today, dayCount + 1, lifetime + 1);
    return { ok: true, response: { evaluated: toBase64(out.evaluated), proof: toBase64(out.proof) } };
  }
}
