/**
 * Phone verification by SMS for sealed matching (W13 Sybil friction, W19; docs/design/WEEKEND_MVP.md §3.4).
 *
 * A survivor proves she controls a phone that can get texts before she can lodge a sealed-matching entry. The app
 * server then keeps ONLY a keyed hash of the canonical number (`phoneToken`, HMAC under MATRA_PHONE_HASH_KEY, a key
 * held outside the database) in `phone_tokens`, a table with no user id, no timestamps and no rowid, so one phone can
 * enable at most a few accounts. Never the number, never the code. Pending challenges live in memory for 10 minutes.
 *
 * Providers sit behind `SmsVerifier` so the real one is configuration:
 *   - MockSmsVerifier: development and demos. It sends nothing and VERIFIES NOTHING about the phone: the code is
 *     returned to the caller (`demoCode`, shown on screen in dev/demo mode) and, when asked, printed to the console as a
 *     dev "outbox". Production refuses to start with it unless MATRA_DEMO_MODE=1 (config.ts assertMockAllowed).
 *   - TwilioVerifySmsVerifier: Twilio Verify v2 (Twilio generates, sends and checks the code; we never see it), with an
 *     optional Twilio Lookup v2 line-type check that refuses VoIP numbers before sending (MATRA_SMS_REJECT_VOIP, on by
 *     default). WRITTEN AND TYPE-CHECKED AGAINST TWILIO'S PUBLISHED API, TESTED ONLY AGAINST A STUBBED fetch, NEVER
 *     AGAINST THE REAL SERVICE. Twilio sees the phone number and when it was verified (a third party; Q-013).
 */
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export type SmsCheckResult = 'approved' | 'wrong_code' | 'expired';

/**
 * A provider refused this number (`phone_not_supported`, e.g. VoIP or not a mobile line), could not be reached or could
 * not check the number (`sms_unavailable`), or hit its own per-number send limit (`rate_limited`).
 */
export class SmsError extends Error {
  constructor(
    public code: 'phone_not_supported' | 'sms_unavailable' | 'rate_limited',
    message: string,
  ) {
    super(message);
    this.name = 'SmsError';
  }
}

export interface SmsVerifier {
  readonly name: 'mock' | 'twilio';
  /** Sends a code to an E.164 number. demoCode only from the mock (shown on screen in dev/demo mode). */
  start(phoneE164: string): Promise<{ providerRef: string; demoCode?: string }>;
  check(providerRef: string, phoneE164: string, code: string): Promise<SmsCheckResult>;
}

/**
 * Caps on code requests (POST /api/matching/verification/start), all in memory. Each send costs money (Verify + a
 * Lookup query), so besides the per-account limits there is a per-IP limit and a global hourly/daily cap against SMS
 * pumping (scripted free accounts sending codes to premium-rate numbers). Env overrides: config.ts loadPhoneVerification.
 */
export interface PhoneSendLimits {
  perAccountPerDay: number;
  /** per (account, phone): never across accounts, so it can't reveal or block someone else's use of a number */
  perAccountPhonePerHour: number;
  perIpPerHour: number;
  globalPerHour: number;
  globalPerDay: number;
}
export const PHONE_SEND_LIMITS: PhoneSendLimits = { perAccountPerDay: 5, perAccountPhonePerHour: 3, perIpPerHour: 10, globalPerHour: 200, globalPerDay: 1000 };

/** How long a code (and the in-memory challenge holding the number) lives. */
export const SMS_CODE_TTL_MS = 10 * 60_000;

/** "+12015550100" → "+1•••0100": enough for a developer to tell numbers apart in the dev outbox, never the whole number. */
export const maskPhone = (e164: string) => `${e164.slice(0, 2)}•••${e164.slice(-4)}`;

/**
 * Development / demo provider. 6-digit codes from crypto.randomInt; keeps only HMAC(code) under a per-process random
 * key, in memory, for 10 minutes. `log` prints "[matra] DEV SMS to +1•••0100: code 123456" (the dev outbox) and is only
 * turned on outside production (index.ts).
 */
export class MockSmsVerifier implements SmsVerifier {
  readonly name = 'mock' as const;
  private readonly key = randomBytes(32);
  private readonly pending = new Map<string, { mac: Buffer; phoneMac: Buffer; expiresAt: number }>();
  constructor(private readonly opts: { log?: boolean } = {}) {}

  private mac(kind: string, v: string) {
    return createHmac('sha256', this.key).update(`${kind}|${v}`).digest();
  }

  async start(phoneE164: string) {
    const now = Date.now();
    for (const [k, v] of this.pending) if (v.expiresAt <= now) this.pending.delete(k);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const providerRef = randomBytes(16).toString('hex');
    this.pending.set(providerRef, { mac: this.mac('code', code), phoneMac: this.mac('phone', phoneE164), expiresAt: now + SMS_CODE_TTL_MS });
    if (this.opts.log) console.log(`[matra] DEV SMS to ${maskPhone(phoneE164)}: code ${code}`);
    return { providerRef, demoCode: code };
  }

  async check(providerRef: string, phoneE164: string, code: string): Promise<SmsCheckResult> {
    const p = this.pending.get(providerRef);
    if (!p || p.expiresAt <= Date.now()) {
      this.pending.delete(providerRef);
      return 'expired';
    }
    if (!timingSafeEqual(p.phoneMac, this.mac('phone', phoneE164))) return 'wrong_code';
    if (!timingSafeEqual(p.mac, this.mac('code', code))) return 'wrong_code';
    this.pending.delete(providerRef);
    return 'approved';
  }
}

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  verifyServiceSid: string;
  /** Send only to numbers Twilio Lookup v2 line type intelligence reports as `mobile` (fails closed). Default true. */
  rejectVoip?: boolean;
  fetchImpl?: typeof fetch;
  /** Tests only. */
  verifyBaseUrl?: string;
  lookupBaseUrl?: string;
}

/**
 * Twilio Verify v2 (https://www.twilio.com/docs/verify/api). UNTESTED AGAINST THE REAL SERVICE: see the file header.
 *   start: [Lookup v2 GET /v2/PhoneNumbers/{e164}?Fields=line_type_intelligence → only type `mobile` goes on]
 *          then POST /v2/Services/{sid}/Verifications  To, Channel=sms  → providerRef = the verification sid
 *          (429: Twilio's own per-number send limit → SmsError rate_limited)
 *   check: POST /v2/Services/{sid}/VerificationCheck  VerificationSid, Code → status approved | pending | canceled…
 *          (404: the verification expired, was approved already, or ran out of attempts; 429: too many checks → expired)
 * Line type intelligence is a paid Lookup add-on; it has to be enabled on the Twilio account. The check fails closed:
 * a missing result (add-on not enabled), a lookup error_code (unprovisioned, no coverage) or any type other than
 * `mobile` (VoIP, landline, tollFree, premium, pager, personal, unknown, …) never gets a code.
 */
export class TwilioVerifySmsVerifier implements SmsVerifier {
  readonly name = 'twilio' as const;
  private readonly fetchImpl: typeof fetch;
  private readonly verifyBase: string;
  private readonly lookupBase: string;
  private warnedLookup = false;
  constructor(private readonly cfg: TwilioConfig) {
    this.fetchImpl = cfg.fetchImpl ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
    this.verifyBase = cfg.verifyBaseUrl ?? 'https://verify.twilio.com';
    this.lookupBase = cfg.lookupBaseUrl ?? 'https://lookups.twilio.com';
  }

  private headers(form: boolean): Record<string, string> {
    const basic = Buffer.from(`${this.cfg.accountSid}:${this.cfg.authToken}`).toString('base64');
    return { Authorization: `Basic ${basic}`, ...(form && { 'Content-Type': 'application/x-www-form-urlencoded' }) };
  }

  private async call(url: string, form?: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
    let r: Response;
    try {
      r = await this.fetchImpl(url, {
        method: form ? 'POST' : 'GET',
        headers: this.headers(!!form),
        ...(form && { body: new URLSearchParams(form).toString() }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new SmsError('sms_unavailable', 'The text message service could not be reached.');
    }
    const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: r.status, body };
  }

  async start(phoneE164: string) {
    const enc = encodeURIComponent(phoneE164);
    if (this.cfg.rejectVoip !== false) {
      const l = await this.call(`${this.lookupBase}/v2/PhoneNumbers/${enc}?Fields=line_type_intelligence`);
      if (l.status >= 300) throw new SmsError('sms_unavailable', 'The text message service could not check this number.');
      const lti = l.body.line_type_intelligence as { type?: string | null; error_code?: number | null } | null | undefined;
      // No result at all, or an error_code (e.g. 60600 unprovisioned / out of coverage): we can't tell what the line
      // is, so we don't send. Warn once, since a missing add-on would otherwise refuse everyone silently.
      if (!lti || lti.error_code != null || !lti.type) {
        if (!this.warnedLookup) {
          this.warnedLookup = true;
          console.warn(
            `[matra] WARNING: Twilio Lookup returned no line type (${lti?.error_code != null ? `error_code ${lti.error_code}` : 'no line_type_intelligence'}); phone verification refuses numbers it cannot check. Is the line type intelligence add-on enabled?`,
          );
        }
        throw new SmsError('sms_unavailable', 'The text message service could not check this number.');
      }
      if (lti.type === 'nonFixedVoip' || lti.type === 'fixedVoip')
        throw new SmsError('phone_not_supported', 'This looks like an internet (VoIP) number. Please use a number from a mobile carrier.');
      if (lti.type !== 'mobile') throw new SmsError('phone_not_supported', 'We can only send codes to mobile numbers. Please use a number from a mobile carrier.');
    }
    const r = await this.call(`${this.verifyBase}/v2/Services/${encodeURIComponent(this.cfg.verifyServiceSid)}/Verifications`, {
      To: phoneE164,
      Channel: 'sms',
    });
    if (r.status === 429) throw new SmsError('rate_limited', 'Several codes have been sent to this number recently. Please wait a while and try again.');
    if (r.status === 400) throw new SmsError('phone_not_supported', 'We couldn’t send a text to this number.');
    if (r.status >= 300 || typeof r.body.sid !== 'string') throw new SmsError('sms_unavailable', 'The text message service did not accept the request.');
    return { providerRef: r.body.sid };
  }

  async check(providerRef: string, _phoneE164: string, code: string): Promise<SmsCheckResult> {
    const r = await this.call(`${this.verifyBase}/v2/Services/${encodeURIComponent(this.cfg.verifyServiceSid)}/VerificationCheck`, {
      VerificationSid: providerRef,
      Code: code,
    });
    // 404: gone (expired, approved, out of attempts); 429: Twilio's own check limit for this verification (60202)
    if (r.status === 404 || r.status === 429) return 'expired';
    if (r.status >= 300) throw new SmsError('sms_unavailable', 'The text message service did not accept the request.');
    if (r.body.status === 'approved') return 'approved';
    if (r.body.status === 'pending') return 'wrong_code';
    return 'expired';
  }
}

/**
 * The only thing kept after a successful verification: hex HMAC-SHA256(MATRA_PHONE_HASH_KEY, "matra/phone-token/v1|" +
 * E.164). Whoever holds the key AND the database can test a guessed number (W19); neither alone can.
 */
export function phoneToken(hashKey: Uint8Array, e164: string): string {
  return createHmac('sha256', hashKey).update(`matra/phone-token/v1|${e164}`).digest('hex');
}
