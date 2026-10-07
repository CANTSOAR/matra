/**
 * Sealed matching — a reimplementation (from the paper, not the AGPL code) of the Callisto protocol:
 *   Rajan, Qin, Archer, Boneh, Lepoint, Varia, "Callisto: A Cryptographic Approach to Detecting Serial Perpetrators
 *   of Sexual Misconduct", ACM COMPASS 2018 (P1). See docs/research/callisto.md §4 and docs/SECURITY_WHITEPAPER.md.
 *
 * NOT AUDITED. Do not use with real survivor data before an independent cryptographic review.
 *
 * ── Protocol (threshold t = 2) ───────────────────────────────────────────────────────────────────────
 *   x_id   = normalizeMatchIdentifier(kind, value)            e.g. "instagram:bad_guy", "phone:+12015550100"
 *   input  = utf8("matra/match/v1|" || x_id)
 *   OPRF   : RFC 9497 VOPRF, suite ristretto255-SHA512, with the server key split additively between two
 *            independent key holders A and B (k = k_A + k_B). The client blinds once, sends the same blinded element
 *            to A and B, verifies EACH holder's DLEQ proof against its published public key, adds the two evaluated
 *            elements and unblinds:  P̂ = Finalize(input, blind, Eval_A + Eval_B) = VOPRF_{k_A + k_B}(input).
 *            Neither holder alone learns anything about x_id or can compute P̂ (offline dictionary attacks over phone
 *            numbers need BOTH keys).
 *   KDF    : HKDF-SHA256(ikm = P̂, salt = "matra/match/v1") with distinct info labels →
 *              π  (tag, 32 bytes)      — what the server stores and groups on
 *              a  (slope)              ∈ F_p, p = 2^256 + 297 (Callisto's field)
 *              k  (intercept / secret) ∈ F_p; the per-perpetrator line is Y = a·X + k
 *            K_P = HKDF(I2OSP(k, 33), info "entry-key") is the per-perpetrator AES-256-GCM key.
 *   Share  : x = HKDF(survivorSecret, info "x|" || π) mod p, y = a·x + k mod p.
 *            survivorSecret is a deterministic PRF of her master key (see survivorShareX), so the SAME survivor
 *            naming the SAME person always produces the SAME point (she cannot match herself, exactly like P1's
 *            U = H(user id)), but x differs per perpetrator, so her points are unlinkable across perpetrators
 *            (an improvement over P1's single U per user; research §4.5 "per-user secret, not user ID").
 *   Entry  : ke  = fresh AES key;     bundle = AES-GCM(ke, MatchContactBundle, AAD = "bundle|" || π)
 *            ce  = AES-GCM(K_P, ke, AAD = "ce|" || π)
 *            c_j = SealTo(pk_counselor_j, {π, x, y, ce})    (RSA-OAEP-256 + AES-256-GCM hybrid, AAD binds π and j)
 *            Sent to the server: { π, bundle, c_1..c_n, label (her own, under her master key) }.
 *   Reveal : the server releases {bundle, c_j} ONLY for tags that have entries from ≥ 2 distinct survivor accounts,
 *            and only to counselor j. The counselor opens two seals, interpolates the line at 0 → k → K_P, opens
 *            ce_i → ke_i → bundle_i. Malformed or tampered shares are found by trying pairs (P1 "Algorithm 1") and
 *            checking every point against the recovered line + AEAD.
 *
 * ── Deviations from P1 (deliberate) ──────────────────────────────────────────────────────────────────
 *   • VOPRF with per-holder DLEQ proofs (P1 used a plain OPRF): a malicious key holder cannot silently return a
 *     wrong evaluation to block matches or tag a user (research A9).
 *   • Additive 2-of-2 key split, verified here: Σ Eval_i then Finalize == VOPRF under k_A + k_B (see tests).
 *   • Per-survivor-per-perpetrator x instead of U = H(user id) (see above).
 *   • No assignment-data (DLOC) ciphertext: Matra has one counselor tier; `state` rides inside the bundle.
 *   • The counselor key is the counselor's existing RSA-OAEP-3072 identity key (WebCrypto), not libsodium box.
 *   • Name-only matching is NOT supported: full names are rejected by the normalizer (names are not unique enough).
 *   • The survivor does not keep cU = E(kU, ke); she keeps her own label (with the canonical identifier, so she can
 *     re-submit after a key rotation, research A5) under her master key instead.
 */
import { ristretto255, ristretto255_oprf } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type {
  CounselorSeal,
  CreateMatchEntryRequest,
  Envelope,
  EscrowEntry,
  IdentifierKind,
  MatchContactBundle,
  MatchingConfig,
  OprfEvaluateRequest,
  OprfEvaluateResponse,
} from '@matra/shared';
import {
  decryptJSON,
  encryptJSON,
  fromBase64,
  generateContentKey,
  toBase64,
  toHex,
  unwrapKeyWithPrivate,
  wrapKeyForRecipient,
} from './index';

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = globalThis.crypto.subtle;
const Point = ristretto255.Point;
const Fn = Point.Fn;
const OPRF = ristretto255_oprf;

export const MATCH_DOMAIN = 'matra/match/v1';
export const MATCH_THRESHOLD = 2 as const;
/** Callisto's prime field for the Shamir line (2^256 + 297 is prime). */
export const FIELD_P = (1n << 256n) + 297n;
const FIELD_BYTES = 33;

// ═══════════════════════════════ identifier normalization ═══════════════════════════════
// Ideas ported (reimplemented) from callisto-core reporting/validators.py: profile-URL → canonical handle for
// Facebook (incl. profile.php?id= and /people/), Instagram, Twitter/X (reserved paths), plus TikTok, Snapchat,
// LinkedIn; phones to E.164; emails canonicalised. Name-only matching is dropped.

export type MatchKind = MatchContactBundle['identifier']['kind'];
export type NormalizedIdentifier =
  | { ok: true; kind: MatchKind; canonical: string; platform?: string }
  | { ok: false; reason: 'empty' | 'name_not_unique' | 'unrecognized' };

/** Plain-language explanations for a rejected identifier (shown to the survivor). */
export const MATCH_REJECT_COPY: Record<'empty' | 'name_not_unique' | 'unrecognized', string> = {
  empty: 'Nothing was entered.',
  name_not_unique: 'Names aren’t unique enough to match safely, so names are never used for sealed matching.',
  unrecognized:
    'We couldn’t recognise this as an email, a phone number, or a profile on a supported app, so it can’t be matched safely.',
};

const PLATFORM_ALIASES: Record<string, string> = {
  instagram: 'instagram', ig: 'instagram', insta: 'instagram',
  facebook: 'facebook', fb: 'facebook',
  twitter: 'x', x: 'x', 'x (twitter)': 'x', 'twitter/x': 'x',
  tiktok: 'tiktok', 'tik tok': 'tiktok',
  snapchat: 'snapchat', snap: 'snapchat',
  linkedin: 'linkedin',
  discord: 'discord',
  telegram: 'telegram',
  whatsapp: 'whatsapp',
};

const HANDLE_RULES: Record<string, RegExp> = {
  instagram: /^[a-z0-9._]{1,30}$/,
  x: /^[a-z0-9_]{1,15}$/,
  tiktok: /^[a-z0-9._]{2,24}$/,
  snapchat: /^[a-z][a-z0-9._-]{2,14}$/,
  facebook: /^[a-z0-9]{5,50}$/, // dots are ignored by Facebook and stripped before this check
  linkedin: /^[\p{L}\p{N}-]{3,100}$/u,
  discord: /^[a-z0-9._]{2,32}$/,
  telegram: /^[a-z0-9_]{5,32}$/,
};

const RESERVED: Record<string, Set<string>> = {
  instagram: new Set(['p', 'reel', 'reels', 'tv', 'explore', 'accounts', 'direct', 'about', 'developer', 'legal', 'stories']),
  x: new Set(['home', 'search', 'i', 'intent', 'share', 'hashtag', 'settings', 'explore', 'notifications', 'messages', 'compose', 'login', 'signup', 'tos', 'privacy']),
  facebook: new Set(['pages', 'groups', 'events', 'watch', 'marketplace', 'gaming', 'share', 'sharer', 'sharer.php', 'login', 'help', 'photo', 'photo.php', 'story.php', 'permalink.php', 'hashtag', 'search', 'profile.php', 'people']),
};

function canonHandle(platform: string, raw: string): string | null {
  let h = raw.normalize('NFKC').trim().replace(/^@+/, '').replace(/\s+/g, '').toLowerCase();
  if (platform === 'facebook') {
    if (/^\d{5,20}$/.test(h)) return `facebook:id:${h}`;
    h = h.replace(/\./g, '');
  }
  if (RESERVED[platform]?.has(h)) return null;
  const rule = HANDLE_RULES[platform];
  if (!rule || !rule.test(h)) return null;
  return `${platform}:${h}`;
}

function asUrl(v: string): URL | null {
  let s = v.trim();
  if (!/^https?:\/\//i.test(s)) {
    if (!/^(?:[a-z0-9-]+\.)*(instagram\.com|instagr\.am|facebook\.com|fb\.com|fb\.me|twitter\.com|x\.com|tiktok\.com|snapchat\.com|linkedin\.com)(?:[/?#]|$)/i.test(s))
      return null;
    s = `https://${s}`;
  }
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

/** Profile URL → canonical "platform:handle" (or null if it isn't a single person's profile). */
export function canonicalFromProfileUrl(value: string): string | null {
  const url = asUrl(value);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^(?:www|m|mobile|web|en-gb|en)\./, '');
  let segs: string[];
  try {
    segs = url.pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p));
  } catch {
    return null;
  }
  const s0 = segs[0]?.toLowerCase();
  switch (host) {
    case 'instagram.com':
    case 'instagr.am':
      if (s0 === 'stories' && segs[1]) return canonHandle('instagram', segs[1]);
      return s0 ? canonHandle('instagram', s0) : null;
    case 'facebook.com':
    case 'fb.com':
    case 'fb.me': {
      if (s0 === 'profile.php') {
        const id = url.searchParams.get('id');
        return id && /^\d{5,20}$/.test(id) ? `facebook:id:${id}` : null;
      }
      if (s0 === 'people') {
        const id = segs.find((p) => /^\d{5,20}$/.test(p));
        return id ? `facebook:id:${id}` : null;
      }
      return s0 ? canonHandle('facebook', s0) : null;
    }
    case 'twitter.com':
    case 'x.com':
      return s0 ? canonHandle('x', s0) : null;
    case 'tiktok.com':
      return s0?.startsWith('@') ? canonHandle('tiktok', s0) : null;
    case 'snapchat.com':
      if (s0 === 'add' && segs[1]) return canonHandle('snapchat', segs[1]);
      return s0?.startsWith('@') ? canonHandle('snapchat', s0) : null;
    case 'linkedin.com':
      return s0 === 'in' && segs[1] ? canonHandle('linkedin', segs[1]) : null;
    default:
      return null;
  }
}

/** E.164 ("+12015550100") or null. 10-digit numbers are assumed to be US/Canada (NANP), as Callisto did. */
export function toE164(value: string): string | null {
  let s = value.normalize('NFKC').replace(/(?:ext\.?|x)\s*\d+\s*$/i, '').replace(/[^\d+]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  let digits: string;
  if (s.startsWith('+')) digits = s.slice(1).replace(/\+/g, '');
  else if (s.length === 10) digits = `1${s}`;
  else if (s.length === 11 && s.startsWith('1')) digits = s;
  else return null;
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  if (digits.startsWith('1') && digits.length !== 11) return null;
  return `+${digits}`;
}

export function canonicalEmail(value: string): string | null {
  const v = value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '').replace(/^mailto:/, '');
  const m = /^([^@]+)@([^@]+\.[^@]+)$/.exec(v);
  if (!m) return null;
  let [, local, domain] = m as unknown as [string, string, string];
  local = local.split('+')[0]!;
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return local ? `${local}@${domain}` : null;
}

/**
 * Canonicalise an identifier so that two survivors typing the same person in different forms produce the same
 * OPRF input. Full names are refused (`name_not_unique`).
 */
export function normalizeMatchIdentifier(kind: IdentifierKind, value: string, platform?: string): NormalizedIdentifier {
  const v = (value ?? '').trim();
  if (!v) return { ok: false, reason: 'empty' };
  if (kind === 'full_name') return { ok: false, reason: 'name_not_unique' };
  const email = (): NormalizedIdentifier | null => {
    const e = canonicalEmail(v);
    return e ? { ok: true, kind: 'email', canonical: `email:${e}` } : null;
  };
  const phone = (): NormalizedIdentifier | null => {
    const p = toE164(v);
    return p ? { ok: true, kind: 'phone', canonical: `phone:${p}` } : null;
  };
  const social = (): NormalizedIdentifier | null => {
    const fromUrl = canonicalFromProfileUrl(v);
    if (fromUrl) return { ok: true, kind: 'social', canonical: fromUrl, platform: fromUrl.split(':')[0] };
    const plat = PLATFORM_ALIASES[(platform ?? '').trim().toLowerCase()];
    if (plat === 'whatsapp') return phone();
    if (!plat || /[/:]/.test(v)) return null;
    const c = canonHandle(plat, v);
    return c ? { ok: true, kind: 'social', canonical: c, platform: plat } : null;
  };
  const r =
    kind === 'email' ? email()
    : kind === 'phone' ? phone()
    : kind === 'social_handle' ? social()
    : (canonicalFromProfileUrl(v) && social()) || (v.includes('@') && !v.startsWith('@') ? email() : null) || phone();
  return r ?? { ok: false, reason: 'unrecognized' };
}

export function matchInput(canonical: string): Uint8Array {
  return enc.encode(`${MATCH_DOMAIN}|${canonical}`);
}

// ═══════════════════════════════ OPRF (RFC 9497 VOPRF, ristretto255-SHA512) ═══════════════════════════════

export interface OprfKeyPair { secretKey: Uint8Array; publicKey: Uint8Array }

/** Key holder: fresh VOPRF key pair. */
export function generateOprfKey(): OprfKeyPair {
  return OPRF.voprf.generateKeyPair();
}

/** Key holder: public key for a stored secret key (validates the scalar). */
export function oprfPublicKey(secretKey: Uint8Array): Uint8Array {
  const k = Fn.fromBytes(secretKey);
  if (Fn.is0(k)) throw new Error('OPRF secret key must be non-zero');
  return Point.BASE.multiply(k).toBytes();
}

/** Key holder: evaluate one blinded element, with a DLEQ proof. Throws on an invalid / identity element. */
export function oprfBlindEvaluate(key: OprfKeyPair, blinded: Uint8Array): { evaluated: Uint8Array; proof: Uint8Array } {
  return OPRF.voprf.blindEvaluate(key.secretKey, key.publicKey, blinded);
}

/** Test / migration helper: the effective key k_A + k_B. Never computed in production (no party holds both). */
export function combineOprfKeys(a: OprfKeyPair, b: OprfKeyPair): OprfKeyPair {
  const sk = Fn.toBytes(Fn.add(Fn.fromBytes(a.secretKey), Fn.fromBytes(b.secretKey)));
  return { secretKey: sk, publicKey: oprfPublicKey(sk) };
}

export interface MatchBlind { input: Uint8Array; blind: Uint8Array; blinded: Uint8Array }

/** Client: blind the canonical identifier. Keep `blind` in memory only. */
export function blindMatchIdentifier(canonical: string): MatchBlind {
  const input = matchInput(canonical);
  const { blind, blinded } = OPRF.voprf.blind(input);
  return { input, blind, blinded };
}

export interface HolderEvaluation { publicKey: Uint8Array; evaluated: Uint8Array; proof: Uint8Array }

/**
 * Client: verify each key holder's DLEQ proof, then combine. Returns the 64-byte OPRF output under k_A + k_B.
 * Throws if either proof is invalid (a holder used a key other than its published one).
 */
export function finalizeSplitOprf(b: MatchBlind, ...holders: HolderEvaluation[]): Uint8Array {
  if (holders.length < 2) throw new Error('need evaluations from both key holders');
  let sum: InstanceType<typeof Point> | undefined;
  for (const h of holders) {
    // voprf.finalize verifies the DLEQ proof against h.publicKey (and throws if it fails); its output is discarded.
    OPRF.voprf.finalize(b.input, b.blind, h.evaluated, b.blinded, h.publicKey, h.proof);
    const p = Point.fromBytes(h.evaluated);
    sum = sum ? sum.add(p) : p;
  }
  // RFC 9497 Finalize is mode-independent (unblind + Hash(len‖input‖len‖element‖"Finalize")); the blinded element was
  // built with the VOPRF-mode hash-to-group, so this equals VOPRF_{Σk}(input).
  return OPRF.oprf.finalize(b.input, b.blind, sum!.toBytes());
}

// ═══════════════════════════════ per-perpetrator values ═══════════════════════════════

export interface PerpetratorSecrets {
  /** π: hex, 32 bytes */
  tag: string;
  slope: bigint;
  intercept: bigint;
}

const kdf = (ikm: Uint8Array, label: string, len: number) =>
  hkdf(sha256, ikm, enc.encode(MATCH_DOMAIN), enc.encode(`${MATCH_DOMAIN}/${label}`), len);

export const mod = (a: bigint, p = FIELD_P) => ((a % p) + p) % p;
const bytesToBig = (b: Uint8Array) => BigInt(`0x${toHex(b) || '0'}`);

/** 48 bytes reduced mod p: statistical distance from uniform ≤ 2^-127. */
function toField(b: Uint8Array): bigint {
  return mod(bytesToBig(b));
}

export function fieldToHex(n: bigint): string {
  return mod(n).toString(16).padStart(FIELD_BYTES * 2, '0');
}

export function hexToField(h: string): bigint {
  if (!/^[0-9a-f]{66}$/.test(h)) throw new Error('bad field element');
  const n = BigInt(`0x${h}`);
  if (n >= FIELD_P) throw new Error('field element out of range');
  return n;
}

export function derivePerpetratorSecrets(oprfOutput: Uint8Array): PerpetratorSecrets {
  return {
    tag: toHex(kdf(oprfOutput, 'tag', 32)),
    slope: toField(kdf(oprfOutput, 'slope', 48)),
    intercept: toField(kdf(oprfOutput, 'intercept', 48)),
  };
}

async function entryKeyFromIntercept(k: bigint): Promise<CryptoKey> {
  const raw = kdf(enc.encode(fieldToHex(k)), 'entry-key', 32);
  return subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// fixed (key, iv, plaintext) triple → AES-GCM acts as a PRF of the master key. Only this one message is ever
// encrypted under this IV; every other master-key encryption uses a fresh random 96-bit IV (collision ≈ 2^-96).
const SURVIVOR_SECRET_IV = enc.encode('matra/x-v1\0\0'); // 12 bytes
const SURVIVOR_SECRET_PT = enc.encode(`${MATCH_DOMAIN}/survivor-secret`);

/**
 * Her share's x coordinate for one perpetrator tag: deterministic for (her, this person), pseudorandom otherwise.
 * Requires only her master key (no extra stored secret).
 */
export async function survivorShareX(masterKey: CryptoKey, tag: string): Promise<bigint> {
  const secret = new Uint8Array(
    await subtle.encrypt({ name: 'AES-GCM', iv: SURVIVOR_SECRET_IV as BufferSource }, masterKey, SURVIVOR_SECRET_PT as BufferSource),
  );
  const x = toField(kdf(secret, `x|${tag}`, 48));
  if (x === 0n) throw new Error('degenerate share'); // probability ≈ 2^-256
  return x;
}

// ═══════════════════════════════ field arithmetic / Shamir (t = 2) ═══════════════════════════════

function modPow(b: bigint, e: bigint, p = FIELD_P): bigint {
  let r = 1n;
  b = mod(b, p);
  while (e > 0n) {
    if (e & 1n) r = (r * b) % p;
    b = (b * b) % p;
    e >>= 1n;
  }
  return r;
}
const inv = (a: bigint) => {
  if (mod(a) === 0n) throw new Error('no inverse');
  return modPow(a, FIELD_P - 2n);
};

export function shareY(s: PerpetratorSecrets, x: bigint): bigint {
  return mod(s.slope * x + s.intercept);
}

/** The line through two points with distinct x: returns { slope, intercept }. */
export function lineThrough(p1: { x: bigint; y: bigint }, p2: { x: bigint; y: bigint }): { slope: bigint; intercept: bigint } {
  if (mod(p1.x - p2.x) === 0n) throw new Error('shares must come from two different survivors');
  const slope = mod((p2.y - p1.y) * inv(p2.x - p1.x));
  return { slope, intercept: mod(p1.y - slope * p1.x) };
}

// ═══════════════════════════════ AEAD with associated data ═══════════════════════════════

async function sealAad(key: CryptoKey, plaintext: Uint8Array, aad: string): Promise<Envelope> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: enc.encode(aad) as BufferSource },
    key,
    plaintext as BufferSource,
  );
  return { v: 1, alg: 'A256GCM', iv: toBase64(iv), ct: toBase64(ct) };
}

async function openAad(key: CryptoKey, env: Envelope, aad: string): Promise<Uint8Array> {
  return new Uint8Array(
    await subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(env.iv) as BufferSource, additionalData: enc.encode(aad) as BufferSource },
      key,
      fromBase64(env.ct) as BufferSource,
    ),
  );
}

// ═══════════════════════════════ entry (survivor side) ═══════════════════════════════

/** Plaintext inside a counselor seal. */
export interface SealedShare {
  v: 1;
  tag: string;
  x: string;
  y: string;
  ce: Envelope;
}

export async function buildMatchEntry(args: {
  secrets: PerpetratorSecrets;
  x: bigint;
  bundle: MatchContactBundle;
  counselors: Array<{ userId: string; publicKey: JsonWebKey }>;
}): Promise<Pick<CreateMatchEntryRequest, 'tag' | 'bundle' | 'seals'>> {
  const { secrets, x, bundle, counselors } = args;
  if (!counselors.length) throw new Error('no counselor available to receive matches');
  const tag = secrets.tag;
  const ke = await generateContentKey();
  const bundleEnv = await sealAad(ke, enc.encode(JSON.stringify(bundle)), `bundle|${tag}`);
  const keRaw = new Uint8Array(await subtle.exportKey('raw', ke));
  const ce = await sealAad(await entryKeyFromIntercept(secrets.intercept), keRaw, `ce|${tag}`);
  const share: SealedShare = { v: 1, tag, x: fieldToHex(x), y: fieldToHex(shareY(secrets, x)), ce };
  const seals: CounselorSeal[] = [];
  for (const c of counselors) seals.push(await sealShareToCounselor(share, c));
  return { tag, bundle: bundleEnv, seals };
}

/** SealTo(pk_counselor, {π, x, y, ce}): RSA-OAEP-256 wraps a fresh AES-256-GCM key; AAD binds π and the counselor. */
export async function sealShareToCounselor(share: SealedShare, counselor: { userId: string; publicKey: JsonWebKey }): Promise<CounselorSeal> {
  const kc = await generateContentKey();
  return {
    counselorId: counselor.userId,
    wrappedKey: await wrapKeyForRecipient(kc, counselor.publicKey),
    envelope: await sealAad(kc, enc.encode(JSON.stringify(share)), `seal|${share.tag}|${counselor.userId}`),
  };
}

// ═══════════════════════════════ reveal (counselor side) ═══════════════════════════════

/**
 * Open one seal addressed to `counselorId`. The group's tag is part of the AAD, so a seal the server moved from
 * another group (or addressed to another counselor) fails to open.
 */
export async function openCounselorSeal(seal: CounselorSeal, privateKey: CryptoKey, counselorId: string, tag: string): Promise<SealedShare> {
  const kc = await unwrapKeyWithPrivate(seal.wrappedKey, privateKey);
  const s = JSON.parse(dec.decode(await openAad(kc, seal.envelope, `seal|${tag}|${counselorId}`))) as SealedShare;
  if (s.v !== 1 || s.tag !== tag) throw new Error('seal tag mismatch');
  hexToField(s.x);
  hexToField(s.y);
  return s;
}

export type ReconstructResult =
  | {
      ok: true;
      tag: string;
      bundles: Array<{ entryId: string; bundle: MatchContactBundle }>;
      /** entries whose share or ciphertext did not verify (malformed, tampered, or not on the line) */
      failed: string[];
    }
  | { ok: false; reason: 'too_few_shares' | 'could_not_reconstruct'; failed: string[] };

/**
 * Counselor: open seals, recover the per-perpetrator key from any two consistent shares (P1 Algorithm 1), then open
 * every bundle. Everything runs on the counselor's device with her private key.
 */
export async function reconstructMatchGroup(
  tag: string,
  entries: Array<{ entryId: string; seal: CounselorSeal; bundle: Envelope }>,
  privateKey: CryptoKey,
  counselorId: string,
): Promise<ReconstructResult> {
  const opened: Array<{ entryId: string; x: bigint; y: bigint; ce: Envelope; bundle: Envelope }> = [];
  const failed: string[] = [];
  for (const e of entries) {
    try {
      const s = await openCounselorSeal(e.seal, privateKey, counselorId, tag);
      opened.push({ entryId: e.entryId, x: hexToField(s.x), y: hexToField(s.y), ce: s.ce, bundle: e.bundle });
    } catch {
      failed.push(e.entryId);
    }
  }
  const distinctX = new Set(opened.map((o) => o.x));
  if (distinctX.size < MATCH_THRESHOLD) return { ok: false, reason: 'too_few_shares', failed };

  const openWith = async (key: CryptoKey, o: (typeof opened)[number]) => {
    const keRaw = await openAad(key, o.ce, `ce|${tag}`);
    const ke = await subtle.importKey('raw', keRaw as BufferSource, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    return JSON.parse(dec.decode(await openAad(ke, o.bundle, `bundle|${tag}`))) as MatchContactBundle;
  };

  for (let i = 0; i < opened.length; i++) {
    for (let j = i + 1; j < opened.length; j++) {
      const a = opened[i]!;
      const b = opened[j]!;
      if (a.x === b.x) continue;
      const line = lineThrough(a, b);
      const key = await entryKeyFromIntercept(line.intercept);
      try {
        await openWith(key, a);
        await openWith(key, b);
      } catch {
        continue; // at least one of this pair is bad; try another pair
      }
      const bundles: Array<{ entryId: string; bundle: MatchContactBundle }> = [];
      for (const o of opened) {
        const onLine = mod(line.slope * o.x + line.intercept) === o.y;
        try {
          if (!onLine) throw new Error('share not on line');
          bundles.push({ entryId: o.entryId, bundle: await openWith(key, o) });
        } catch {
          failed.push(o.entryId);
        }
      }
      return { ok: true, tag, bundles, failed };
    }
  }
  return { ok: false, reason: 'could_not_reconstruct', failed: [...failed, ...opened.map((o) => o.entryId)] };
}

// ═══════════════════════════════ client orchestration ═══════════════════════════════

/** Network calls the survivor's client needs (implemented by the web ApiClient, and by tests with supertest/fetch). */
export interface MatchTransport {
  config(): Promise<MatchingConfig>;
  evaluate(holder: 'a' | 'b', req: OprfEvaluateRequest): Promise<OprfEvaluateResponse>;
  createEntry(req: CreateMatchEntryRequest): Promise<{ entry: EscrowEntry }>;
}

/**
 * Full survivor-side submission for ONE identifier. `pinnedKeys` (base64), when given, must equal the key holders'
 * published keys — production builds should pin them so the app server cannot substitute keys it controls.
 */
export async function submitMatchEntry(
  t: MatchTransport,
  args: {
    masterKey: CryptoKey;
    identifier: Extract<NormalizedIdentifier, { ok: true }>;
    contact: MatchContactBundle['contact'];
    consentStatement: string;
    state?: string;
    labelEnvelope: Envelope;
    config?: MatchingConfig;
    pinnedKeys?: { a: string; b: string };
  },
): Promise<{ entry: EscrowEntry; tag: string }> {
  const config = args.config ?? (await t.config());
  if (args.pinnedKeys && (args.pinnedKeys.a !== config.keyHolders.a.publicKey || args.pinnedKeys.b !== config.keyHolders.b.publicKey))
    throw new Error('matching key holder keys do not match the pinned keys');
  if (!config.counselors.length) throw new Error('no counselor available to receive matches');
  const b = blindMatchIdentifier(args.identifier.canonical);
  const req = { blinded: toBase64(b.blinded) };
  const [ea, eb] = await Promise.all([t.evaluate('a', req), t.evaluate('b', req)]);
  const y = finalizeSplitOprf(
    b,
    { publicKey: fromBase64(config.keyHolders.a.publicKey), evaluated: fromBase64(ea.evaluated), proof: fromBase64(ea.proof) },
    { publicKey: fromBase64(config.keyHolders.b.publicKey), evaluated: fromBase64(eb.evaluated), proof: fromBase64(eb.proof) },
  );
  const secrets = derivePerpetratorSecrets(y);
  const x = await survivorShareX(args.masterKey, secrets.tag);
  const bundle: MatchContactBundle = {
    v: 1,
    identifier: { kind: args.identifier.kind, canonical: args.identifier.canonical },
    contact: args.contact,
    consent: { statement: args.consentStatement, at: new Date().toISOString() },
    ...(args.state && { state: args.state }),
  };
  const built = await buildMatchEntry({
    secrets,
    x,
    bundle,
    counselors: config.counselors.map((c) => ({ userId: c.userId, publicKey: c.publicKey })),
  });
  const { entry } = await t.createEntry({ ...built, labelEnvelope: args.labelEnvelope });
  return { entry, tag: secrets.tag };
}

/** Encrypt a note (or label) to oneself. */
export const encryptToSelf = (value: unknown, masterKey: CryptoKey) => encryptJSON(value, masterKey);
export const decryptFromSelf = <T>(env: Envelope, masterKey: CryptoKey) => decryptJSON<T>(env, masterKey);
