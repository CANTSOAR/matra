/**
 * Sealed matching — a reimplementation (from the paper, not the AGPL code) of the Callisto protocol:
 *   Rajan, Qin, Archer, Boneh, Lepoint, Varia, "Callisto: A Cryptographic Approach to Detecting Serial Perpetrators
 *   of Sexual Misconduct", ACM COMPASS 2018 (P1). See docs/research/callisto.md §4 and docs/SECURITY_WHITEPAPER.md.
 *
 * NOT AUDITED. Do not use with real survivor data before an independent cryptographic review.
 *
 * ── Protocol (threshold t = 2) ───────────────────────────────────────────────────────────────────────
 *   x_id   = normalizeMatchIdentifier(kind, value)            e.g. "instagram:bad_guy", "phone:+12015550100"
 *   input  = utf8("matra/match/v2|" || x_id)
 *   OPRF   : RFC 9497 VOPRF, suite ristretto255-SHA512, with the server key split additively between two
 *            independent key holders A and B (k = k_A + k_B). The client blinds once, sends the same blinded element
 *            to A and B, verifies EACH holder's DLEQ proof against its published (build-time pinned) public key, refuses
 *            degenerate key pairs (pk_A = pk_B, an identity key, pk_A + pk_B = identity), adds the two evaluated
 *            elements and unblinds:  P̂ = Finalize(input, blind, Eval_A + Eval_B) = VOPRF_{k_A + k_B}(input).
 *            Neither holder alone learns anything about x_id or can compute P̂ (offline dictionary attacks over phone
 *            numbers need BOTH keys).
 *   KDF    : HKDF-SHA256(salt = "matra/match/v2") with distinct info labels:
 *              a  (slope)              = HKDF(P̂, "slope")     ∈ F_p, p = 2^256 + 297 (Callisto's field)
 *              k  (intercept / secret) = HKDF(P̂, "intercept") ∈ F_p; the per-perpetrator line is Y = a·X + k
 *              π  (tag, 32 bytes)      = HKDF(I2OSP(k, 33), "tag")        — bound to the line's intercept
 *              K_P                     = HKDF(I2OSP(k, 33), "entry-key")  — the per-perpetrator AES-256-GCM key
 *   Share  : x = HMAC(matchKey, "x|π") mod p (48 bytes), y = a·x + k mod p. matchKey is a dedicated HMAC key
 *            HKDF-derived from her passphrase material ("matra/match-x", deriveKeys), so the SAME survivor naming the
 *            SAME person always produces the SAME point (she cannot match herself, exactly like P1's U = H(user id)),
 *            but x differs per perpetrator, so her points are unlinkable across perpetrators (research §4.5).
 *   Entry  : ke  = fresh AES key;     bundle = AES-GCM(ke, pad(MatchContactBundle), AAD = "bundle|" || π)
 *            ce  = AES-GCM(K_P, ke, AAD = "ce|" || π)
 *            c_j = SealTo(pk_counselor_j, {π, x, y, ce})    (RSA-OAEP-256 + AES-256-GCM hybrid, AAD binds π and j)
 *            Sent to the server: { π, bundle, c_1..c_n, label (hers, under her master key, padded) }.
 *            Counselors j come from the organization-signed roster when the build pins the roster key.
 *   Reveal : the server releases {bundle, c_j} ONLY for tags that have entries from ≥ 2 distinct survivor accounts,
 *            each older than the release delay, and only to counselor j. The counselor opens the seals, tries EVERY
 *            pair, keeps only lines whose intercept reproduces π (so a Sybil "decoy line" sealed under the real tag can
 *            never be taken for the real one), derives K_P from that k and opens EVERY entry's ce with it — a decoy
 *            cannot hide real reports in either order. Extra lines, foreign self-consistent lines, off-line points,
 *            duplicated shares and differing identifiers are reported as alerts.
 *
 * ── Deviations from P1 (deliberate) ──────────────────────────────────────────────────────────────────
 *   • VOPRF with per-holder DLEQ proofs (P1 used a plain OPRF): a malicious key holder cannot silently return a
 *     wrong evaluation to block matches or tag a user (research A9).
 *   • Additive 2-of-2 key split, verified here: Σ Eval_i then Finalize == VOPRF under k_A + k_B (see tests).
 *   • Per-survivor-per-perpetrator x instead of U = H(user id) (see above).
 *   • No assignment-data (DLOC) ciphertext: Matra has one counselor tier; `state` rides inside the bundle.
 *   • The counselor key is the counselor's existing RSA-OAEP-3072 identity key (WebCrypto), not libsodium box.
 *   • Name-only matching is NOT supported: full names are rejected by the normalizer (names are not unique enough).
 *   • The survivor does not keep cU = E(kU, ke); she keeps her own label under her master key instead, holding the
 *     canonical identifier, her contact preferences and her share {π, x, y, ce}, so her client can re-seal after a
 *     key rotation (research A5) and add seals for counselors who join later — without re-typing anything.
 *   • The tag is derived from the intercept (not directly from P̂), so reconstruction can verify the line (H1).
 */
import { ed25519, ristretto255, ristretto255_oprf } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type {
  AddMatchSealsRequest,
  CounselorRosterPayload,
  CounselorSeal,
  CreateMatchEntryRequest,
  Envelope,
  EscrowEntry,
  MatchContactBundle,
  MatchingConfig,
  OprfEvaluateRequest,
  OprfEvaluateResponse,
  SignedCounselorRoster,
} from '@matra/shared';
import {
  decryptJSON,
  encryptBytes,
  encryptJSON,
  fromBase64,
  generateContentKey,
  matchKeyFor,
  toBase64,
  toHex,
  unwrapKeyWithPrivate,
  wrapKeyForRecipient,
} from './index';
import type { NormalizedIdentifier } from './normalize';

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = globalThis.crypto.subtle;
const Point = ristretto255.Point;
const Fn = Point.Fn;
const OPRF = ristretto255_oprf;

export const MATCH_DOMAIN = 'matra/match/v2';
export const MATCH_THRESHOLD = 2 as const;
/** Callisto's prime field for the Shamir line (2^256 + 297 is prime). */
export const FIELD_P = (1n << 256n) + 297n;
const FIELD_BYTES = 33;

// Identifier normalization lives in ./normalize.ts (re-exported here).
export * from './normalize';

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

/**
 * Key holder (deploy helper): a VOPRF key pair derived from an arbitrary high-entropy secret string (e.g. a value a
 * hosting platform generated, like Render's `generateValue`). RFC 9497 DeriveKeyPair(seed = SHA-256(secret),
 * info = "matra/oprf-key/<holder>").
 */
export function oprfKeyFromSecret(secret: string, holder: 'a' | 'b'): OprfKeyPair {
  if (secret.length < 32) throw new Error('OPRF key secret must be at least 32 characters');
  return OPRF.voprf.deriveKeyPair(sha256(enc.encode(secret)), enc.encode(`matra/oprf-key/${holder}`));
}

export interface HolderEvaluation { publicKey: Uint8Array; evaluated: Uint8Array; proof: Uint8Array }

/**
 * Client: verify each key holder's DLEQ proof, then combine. Returns the 64-byte OPRF output under k_A + k_B.
 * Throws if either proof is invalid (a holder used a key other than its published one), and refuses degenerate key
 * configurations that would make the "split" key meaningless: the same key presented twice (k = 2·k_A, one party
 * holds everything), an identity key, or k_B = −k_A (the combined key is 0, so the output no longer depends on any
 * secret and anyone can compute every tag offline).
 */
export function finalizeSplitOprf(b: MatchBlind, ...holders: HolderEvaluation[]): Uint8Array {
  if (holders.length !== 2) throw new Error('need evaluations from exactly two key holders');
  const pks = holders.map((h) => Point.fromBytes(h.publicKey));
  if (pks.some((p) => p.is0())) throw new Error('OPRF key holder public key is the identity');
  if (pks[0]!.equals(pks[1]!)) throw new Error('OPRF key holders A and B must use different keys');
  if (pks[0]!.add(pks[1]!).is0()) throw new Error('OPRF key holder keys cancel out (k_A + k_B = 0)');
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
  /** π: hex, 32 bytes — derived from the intercept, so a line that doesn't pass through this group's k can't verify */
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

/** I2OSP(n, 33): big-endian, fixed length. */
export function i2osp33(n: bigint): Uint8Array {
  const out = new Uint8Array(FIELD_BYTES);
  let v = mod(n);
  for (let i = FIELD_BYTES - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** π = HKDF(I2OSP(k, 33), "tag"). Binding the tag to the line's intercept is what defeats decoy lines (H1). */
export function tagFromIntercept(k: bigint): string {
  return toHex(kdf(i2osp33(k), 'tag', 32));
}

export function derivePerpetratorSecrets(oprfOutput: Uint8Array): PerpetratorSecrets {
  const intercept = toField(kdf(oprfOutput, 'intercept', 48));
  return {
    tag: tagFromIntercept(intercept),
    slope: toField(kdf(oprfOutput, 'slope', 48)),
    intercept,
  };
}

/** K_P = HKDF(I2OSP(k, 33), "entry-key"). */
async function entryKeyFromIntercept(k: bigint): Promise<CryptoKey> {
  const raw = kdf(i2osp33(k), 'entry-key', 32);
  return subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/**
 * Her share's x coordinate for one perpetrator tag: deterministic for (her, this person), pseudorandom otherwise.
 * x = HMAC(matchKey, "x|1|π") ‖ HMAC(matchKey, "x|2|π")[0..16] mod p, where matchKey is the dedicated HKDF-derived
 * HMAC key from deriveKeys ("matra/match-x"). Accepts that HMAC key directly, or the master key it was derived with.
 */
export async function survivorShareX(key: CryptoKey, tag: string): Promise<bigint> {
  const mk = key.algorithm.name === 'HMAC' ? key : matchKeyFor(key);
  if (!mk) throw new Error('sealed-match key unavailable: sign in again');
  const mac = async (i: number) =>
    new Uint8Array(await subtle.sign('HMAC', mk, enc.encode(`${MATCH_DOMAIN}/x|${i}|${tag}`) as BufferSource));
  const bytes = new Uint8Array(48);
  bytes.set(await mac(1), 0);
  bytes.set((await mac(2)).subarray(0, 16), 32);
  const x = toField(bytes);
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

export function shareY(s: Pick<PerpetratorSecrets, 'slope' | 'intercept'>, x: bigint): bigint {
  return mod(s.slope * x + s.intercept);
}

/** The line through two points with distinct x: returns { slope, intercept }. */
export function lineThrough(p1: { x: bigint; y: bigint }, p2: { x: bigint; y: bigint }): { slope: bigint; intercept: bigint } {
  if (mod(p1.x - p2.x) === 0n) throw new Error('shares must come from two different survivors');
  const slope = mod((p2.y - p1.y) * inv(p2.x - p1.x));
  return { slope, intercept: mod(p1.y - slope * p1.x) };
}

// ═══════════════════════════════ padding + AEAD with associated data ═══════════════════════════════

/** Padding bucket: 1 KiB, then whole multiples of 1 KiB. */
export const PAD_BUCKET = 1024;

/**
 * JSON, right-padded with spaces to the next bucket (L5): ciphertext length then says only "≤ 1 KiB" (or which KiB),
 * not how long her name, notes or the identifier are. JSON.parse ignores the trailing whitespace.
 */
export function padJson(value: unknown): Uint8Array {
  const raw = enc.encode(JSON.stringify(value));
  const size = Math.max(PAD_BUCKET, Math.ceil(raw.length / PAD_BUCKET) * PAD_BUCKET);
  const out = new Uint8Array(size).fill(0x20);
  out.set(raw, 0);
  return out;
}

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
  v: 2;
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
}): Promise<Pick<CreateMatchEntryRequest, 'tag' | 'bundle' | 'seals'> & { share: SealedShare }> {
  const { secrets, x, bundle, counselors } = args;
  if (!counselors.length) throw new Error('no counselor available to receive matches');
  const tag = secrets.tag;
  const ke = await generateContentKey();
  const bundleEnv = await sealAad(ke, padJson(bundle), `bundle|${tag}`);
  const keRaw = new Uint8Array(await subtle.exportKey('raw', ke));
  const ce = await sealAad(await entryKeyFromIntercept(secrets.intercept), keRaw, `ce|${tag}`);
  const share: SealedShare = { v: 2, tag, x: fieldToHex(x), y: fieldToHex(shareY(secrets, x)), ce };
  const seals: CounselorSeal[] = [];
  for (const c of counselors) seals.push(await sealShareToCounselor(share, c));
  return { tag, bundle: bundleEnv, seals, share };
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
  if (s.v !== 2 || s.tag !== tag) throw new Error('seal tag mismatch');
  hexToField(s.x);
  hexToField(s.y);
  return s;
}

/**
 * Warning signs found while reconstructing. Any of them means "possible decoy or tampering — check before contacting
 * anyone" (the counselor UI shows them prominently):
 *   multiple_lines       two or more different lines through this group's k each verify (someone who knows the
 *                        perpetrator's identifier sealed points on a second line: a Sybil decoy)
 *   foreign_line         a pair of entries is self-consistent on a line whose intercept does NOT derive this tag
 *                        (a decoy line built to hide the real reports — it is ignored, but the attempt is shown)
 *   off_line_share       an entry opens with this group's key but its point is not on the main line
 *   duplicate_share      the same share (same x) appears in more than one entry (a replayed / duplicated entry)
 *   identifier_mismatch  bundles carry different canonical identifiers
 */
export type ReconstructAlert = 'multiple_lines' | 'foreign_line' | 'off_line_share' | 'duplicate_share' | 'identifier_mismatch';

export interface ReconstructedBundle {
  entryId: string;
  bundle: MatchContactBundle;
  /** her share's x coordinate (hex) — equal x means the same survivor */
  x: string;
  /** the point lies on the line most entries agree on */
  onLine: boolean;
}

export type ReconstructResult =
  | {
      ok: true;
      tag: string;
      /** one per distinct survivor share (deduplicated by x), in entry order */
      bundles: ReconstructedBundle[];
      /** number of distinct verified survivors (distinct x) — what the "N people" badge shows */
      people: number;
      /** entries whose seal, share or ciphertext did not verify (malformed, tampered, or a decoy) */
      failed: string[];
      /** entries that verified but repeat another entry's share (same x); not shown */
      duplicates: string[];
      /** distinct canonical identifiers found in the bundles (normally exactly one) */
      canonicals: string[];
      alerts: ReconstructAlert[];
    }
  | { ok: false; reason: 'too_few_shares' | 'could_not_reconstruct'; failed: string[]; alerts: ReconstructAlert[] };

/**
 * Counselor: open seals, find the line(s) whose intercept k reproduces the group's tag (π = HKDF(k)), derive
 * K_P = HKDF(k), then open EVERY entry's ciphertext with K_P directly. Because the tag is bound to k, a decoy line
 * (a pair of Sybil entries sealing a fake line under the real tag) can never be accepted as "the" key, and cannot
 * hide the real reports whatever order the entries come in. All pairs are tried; extra or foreign lines are reported
 * as alerts. Everything runs on the counselor's device with her private key.
 */
export async function reconstructMatchGroup(
  tag: string,
  entries: Array<{ entryId: string; seal: CounselorSeal; bundle: Envelope }>,
  privateKey: CryptoKey,
  counselorId: string,
): Promise<ReconstructResult> {
  const opened: Array<{ entryId: string; x: bigint; y: bigint; ce: Envelope; bundle: Envelope }> = [];
  const failed: string[] = [];
  const alerts = new Set<ReconstructAlert>();
  for (const e of entries) {
    try {
      const s = await openCounselorSeal(e.seal, privateKey, counselorId, tag);
      opened.push({ entryId: e.entryId, x: hexToField(s.x), y: hexToField(s.y), ce: s.ce, bundle: e.bundle });
    } catch {
      failed.push(e.entryId);
    }
  }
  const distinctX = new Set(opened.map((o) => o.x));
  if (distinctX.size < MATCH_THRESHOLD) return { ok: false, reason: 'too_few_shares', failed, alerts: [] };

  const openCe = async (key: CryptoKey, o: (typeof opened)[number]) => openAad(key, o.ce, `ce|${tag}`);
  const canOpen = (key: CryptoKey, o: (typeof opened)[number]) => openCe(key, o).then(() => true, () => false);

  // 1. Every pair with distinct x: does its line's intercept derive this tag?
  const lines = new Map<string, { slope: bigint; intercept: bigint }>();
  let k: bigint | undefined;
  for (let i = 0; i < opened.length; i++) {
    for (let j = i + 1; j < opened.length; j++) {
      const a = opened[i]!;
      const b = opened[j]!;
      if (a.x === b.x) continue;
      const line = lineThrough(a, b);
      if (tagFromIntercept(line.intercept) === tag) {
        k = line.intercept; // unique: the tag is a collision-resistant function of k
        lines.set(`${line.slope}|${line.intercept}`, line);
      } else {
        // Not this group's line. If the pair is nevertheless self-consistent (both ce open under the key its own line
        // implies), someone deliberately sealed points on a different line under this tag: a decoy.
        const key = await entryKeyFromIntercept(line.intercept);
        if ((await canOpen(key, a)) && (await canOpen(key, b))) alerts.add('foreign_line');
      }
    }
  }
  if (k === undefined)
    return { ok: false, reason: 'could_not_reconstruct', failed: [...failed, ...opened.map((o) => o.entryId)], alerts: [...alerts] };
  if (lines.size > 1) alerts.add('multiple_lines');

  // The main line: the verified line with the most points on it.
  const onLineOf = (l: { slope: bigint; intercept: bigint }, o: (typeof opened)[number]) => mod(l.slope * o.x + l.intercept) === o.y;
  const main = [...lines.values()].sort((l1, l2) => opened.filter((o) => onLineOf(l2, o)).length - opened.filter((o) => onLineOf(l1, o)).length)[0]!;

  // 2. Open every entry with K_P directly (not only the points on one line).
  const key = await entryKeyFromIntercept(k);
  const bundles: ReconstructedBundle[] = [];
  const duplicates: string[] = [];
  const seenX = new Set<bigint>();
  for (const o of opened) {
    try {
      const keRaw = await openCe(key, o);
      const ke = await subtle.importKey('raw', keRaw as BufferSource, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      const bundle = JSON.parse(dec.decode(await openAad(ke, o.bundle, `bundle|${tag}`))) as MatchContactBundle;
      if (seenX.has(o.x)) {
        duplicates.push(o.entryId);
        alerts.add('duplicate_share');
        continue;
      }
      seenX.add(o.x);
      const onLine = onLineOf(main, o);
      if (!onLine) alerts.add('off_line_share');
      bundles.push({ entryId: o.entryId, bundle, x: fieldToHex(o.x), onLine });
    } catch {
      failed.push(o.entryId);
    }
  }
  const canonicals = [...new Set(bundles.map((b) => b.bundle.identifier?.canonical ?? ''))];
  if (canonicals.length > 1) alerts.add('identifier_mismatch');
  return { ok: true, tag, bundles, people: bundles.length, failed, duplicates, canonicals, alerts: [...alerts] };
}

// ═══════════════════════════════ counselor roster (organization-signed) ═══════════════════════════════

export const ROSTER_DOMAIN = 'matra/counselor-roster/v1';

/** Canonical roster JSON: counselors sorted by userId, keys in fixed order, RSA public keys reduced to {kty, n, e}. */
export function canonicalRosterPayload(
  counselors: Array<{ userId: string; publicKey: JsonWebKey }>,
  issuedAt = new Date().toISOString(),
): string {
  const list = [...counselors]
    .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0))
    .map((c) => {
      if (c.publicKey.kty !== 'RSA' || !c.publicKey.n || !c.publicKey.e) throw new Error('counselor key must be an RSA public key');
      return { userId: c.userId, publicKey: { kty: 'RSA' as const, n: c.publicKey.n, e: c.publicKey.e } };
    });
  const payload: CounselorRosterPayload = { v: 1, issuedAt, counselors: list };
  return JSON.stringify(payload);
}

/** Organization (offline, CLI): sign the verified counselor roster with the org's Ed25519 secret key (32 bytes). */
export function signCounselorRoster(
  counselors: Array<{ userId: string; publicKey: JsonWebKey }>,
  orgSecretKey: Uint8Array,
  issuedAt?: string,
): SignedCounselorRoster {
  const payload = canonicalRosterPayload(counselors, issuedAt);
  const signature = ed25519.sign(enc.encode(`${ROSTER_DOMAIN}|${payload}`), orgSecretKey);
  return { payload, signature: toBase64(signature) };
}

export function rosterPublicKey(orgSecretKey: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(orgSecretKey);
}

export function generateRosterKey(): { secretKey: Uint8Array; publicKey: Uint8Array } {
  return ed25519.keygen();
}

/** Verify a signed roster against the pinned org public key. Returns the payload, or null if anything is off. */
export function verifyCounselorRoster(signed: SignedCounselorRoster | undefined, orgPublicKey: Uint8Array): CounselorRosterPayload | null {
  if (!signed) return null;
  try {
    const sig = fromBase64(signed.signature);
    if (sig.length !== 64 || !ed25519.verify(sig, enc.encode(`${ROSTER_DOMAIN}|${signed.payload}`), orgPublicKey)) return null;
    const p = JSON.parse(signed.payload) as CounselorRosterPayload;
    if (p.v !== 1 || !Array.isArray(p.counselors)) return null;
    return p;
  } catch {
    return null;
  }
}

/**
 * Which counselors the survivor's client may seal to. With a pinned roster key: ONLY counselors in the org-signed
 * roster, with exactly the RSA key the roster lists (the app server cannot add a counselor or swap a key); throws if
 * the roster is missing or its signature is invalid. Without a pinned key (development): the server's list, with a
 * console warning.
 */
let warnedUnpinned = false;
export function counselorsToSealTo(
  config: MatchingConfig,
  pinnedRosterKey?: string,
): Array<{ userId: string; publicKey: JsonWebKey }> {
  const all = config.counselors.map((c) => ({ userId: c.userId, publicKey: c.publicKey }));
  if (!pinnedRosterKey) {
    if (!warnedUnpinned) console.warn('[matra] sealed matching: no pinned counselor-roster key in this build; trusting the server’s counselor list (development only).');
    warnedUnpinned = true;
    return all;
  }
  const roster = verifyCounselorRoster(config.roster, fromBase64(pinnedRosterKey));
  if (!roster) throw new Error('the counselor list is not signed by the organization key this app trusts');
  const listed = new Map(roster.counselors.map((c) => [c.userId, c.publicKey]));
  return all.filter((c) => {
    const r = listed.get(c.userId);
    return !!r && r.n === c.publicKey.n && r.e === c.publicKey.e;
  });
}

// ═══════════════════════════════ client orchestration ═══════════════════════════════

/** Network calls the survivor's client needs (implemented by the web ApiClient, and by tests with supertest/fetch). */
export interface MatchTransport {
  config(): Promise<MatchingConfig>;
  evaluate(holder: 'a' | 'b', req: OprfEvaluateRequest): Promise<OprfEvaluateResponse>;
  createEntry(req: CreateMatchEntryRequest): Promise<{ entry: EscrowEntry }>;
  listEntries?(): Promise<{ entries: EscrowEntry[] }>;
  addSeals?(entryId: string, req: AddMatchSealsRequest): Promise<{ entry: EscrowEntry }>;
}

/** Build-time pins (production builds set both; see docs/SECURITY_WHITEPAPER.md §4a). */
export interface MatchPins {
  /** base64 public keys of OPRF key holders A and B */
  keys?: { a: string; b: string };
  /** base64 Ed25519 public key of the organization that signs the counselor roster */
  rosterKey?: string;
}

/**
 * Everything she needs to re-seal this entry later without re-typing anything (after a key rotation, M5) and to add
 * seals for counselors who join later (M6). Encrypted under her master key, padded (L5); only she can read it.
 */
export interface MatchLabel {
  v: 2;
  label: string;
  identifier: { kind: MatchContactBundle['identifier']['kind']; canonical: string; platform?: string };
  contact: MatchContactBundle['contact'];
  consentStatement: string;
  state?: string;
  keyEpoch: number;
  share: SealedShare;
}

export const encryptLabel = (label: MatchLabel, masterKey: CryptoKey) => encryptBytes(padJson(label), masterKey);

export async function decryptLabel(env: Envelope, masterKey: CryptoKey): Promise<MatchLabel | { label: string } | null> {
  try {
    return await decryptJSON<MatchLabel | { label: string }>(env, masterKey);
  } catch {
    return null;
  }
}

function checkPinnedKeys(config: MatchingConfig, pins?: MatchPins) {
  if (pins?.keys && (pins.keys.a !== config.keyHolders.a.publicKey || pins.keys.b !== config.keyHolders.b.publicKey))
    throw new Error('matching key holder keys do not match the keys pinned in this app');
}

/**
 * Full survivor-side submission for ONE identifier. `pins.keys`, when given, must equal the key holders' published
 * keys, and `pins.rosterKey` restricts sealing to the org-signed counselor roster — production builds pin both so the
 * app server cannot substitute keys or counselors it controls.
 */
export async function submitMatchEntry(
  t: MatchTransport,
  args: {
    masterKey: CryptoKey;
    identifier: Extract<NormalizedIdentifier, { ok: true }>;
    contact: MatchContactBundle['contact'];
    consentStatement: string;
    state?: string;
    /** what she sees in her list ("Ryan · phone number") */
    label: string;
    config?: MatchingConfig;
    pins?: MatchPins;
    /** re-seal: the older entry this one replaces (deleted by the server in the same transaction) */
    replacesEntryId?: string;
  },
): Promise<{ entry: EscrowEntry; tag: string }> {
  const config = args.config ?? (await t.config());
  checkPinnedKeys(config, args.pins);
  const counselors = counselorsToSealTo(config, args.pins?.rosterKey);
  if (!counselors.length) throw new Error('no counselor available to receive matches');
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
  const built = await buildMatchEntry({ secrets, x, bundle, counselors });
  const label: MatchLabel = {
    v: 2,
    label: args.label,
    identifier: {
      kind: args.identifier.kind,
      canonical: args.identifier.canonical,
      ...(args.identifier.platform && { platform: args.identifier.platform }),
    },
    contact: args.contact,
    consentStatement: args.consentStatement,
    ...(args.state && { state: args.state }),
    keyEpoch: config.keyEpoch,
    share: built.share,
  };
  const { entry } = await t.createEntry({
    tag: built.tag,
    bundle: built.bundle,
    seals: built.seals,
    labelEnvelope: await encryptLabel(label, args.masterKey),
    ...(args.replacesEntryId && { replacesEntryId: args.replacesEntryId }),
  });
  return { entry, tag: secrets.tag };
}

/**
 * Run on sign-in (survivor). Keeps her sealed entries matchable as the deployment changes:
 *   • entries sealed under an older OPRF key epoch are re-sealed under the current keys from her encrypted label (M5);
 *   • entries missing a seal for a counselor now on the (signed) roster get one, from the share kept in her label (M6).
 * Seals for counselors who left the roster are deleted by the server. Nothing here reveals whether anything matched.
 */
export async function refreshMatchEntries(
  t: MatchTransport,
  args: { masterKey: CryptoKey; pins?: MatchPins; config?: MatchingConfig },
): Promise<{ resealed: number; sealsAdded: number; skipped: number }> {
  if (!t.listEntries || !t.addSeals) throw new Error('transport cannot refresh entries');
  const out = { resealed: 0, sealsAdded: 0, skipped: 0 };
  const { entries } = await t.listEntries();
  if (!entries.length) return out;
  const config = args.config ?? (await t.config());
  checkPinnedKeys(config, args.pins);
  const counselors = counselorsToSealTo(config, args.pins?.rosterKey);
  if (!counselors.length) return out;
  for (const e of entries) {
    const label = await decryptLabel(e.labelEnvelope, args.masterKey);
    if (!label || !('v' in label) || label.v !== 2) {
      out.skipped++;
      continue;
    }
    if ((e.keyEpoch ?? 0) !== config.keyEpoch) {
      await submitMatchEntry(t, {
        masterKey: args.masterKey,
        identifier: { ok: true, kind: label.identifier.kind, canonical: label.identifier.canonical, ...(label.identifier.platform && { platform: label.identifier.platform }) },
        contact: label.contact,
        consentStatement: label.consentStatement,
        ...(label.state && { state: label.state }),
        label: label.label,
        config,
        ...(args.pins && { pins: args.pins }),
        replacesEntryId: e.id,
      });
      out.resealed++;
      continue;
    }
    const have = new Set(e.counselorIds ?? []);
    const missing = counselors.filter((c) => !have.has(c.userId));
    if (!missing.length) continue;
    const seals: CounselorSeal[] = [];
    for (const c of missing) seals.push(await sealShareToCounselor(label.share, c));
    await t.addSeals(e.id, { seals });
    out.sealsAdded += seals.length;
  }
  return out;
}

/** Encrypt a note to oneself. */
export const encryptToSelf = (value: unknown, masterKey: CryptoKey) => encryptJSON(value, masterKey);
export const decryptFromSelf = <T>(env: Envelope, masterKey: CryptoKey) => decryptJSON<T>(env, masterKey);
