/**
 * Matcher attestation and routing seal (matcher-service; docs/design/WEEKEND_MVP.md §3.5, docs/threat-model.md W18).
 *
 * The matcher (apps/matcher) is a separate service that decides which matched groups exist, when they are released, and
 * which ONE counselor gets each, from routing data the app server cannot read. Two pieces live here, so the survivor's
 * client, the app server and the matcher share one implementation:
 *
 * ── Attestation document ─────────────────────────────────────────────────────────────────────────────────────────
 *   payload   = canonical JSON { v: 1, platform, measurement, encKey, signKey, nonce, issuedAt }
 *   signature = Ed25519(platformKey, "matra/attestation/v1|" + payload)
 *   The verifier picks the nonce (64 hex), checks the signature against the PINNED platform key, the nonce, freshness,
 *   and that `measurement` (the hash of the matcher build) equals the PINNED expected value; only then does it use
 *   `encKey`. Tonight's platform is 'simulated': the "platform key" is a dev Ed25519 key and the measurement is a file
 *   hash computed by the matcher process itself. That proves nothing about what really runs: whoever holds the dev
 *   platform key can sign any measurement. It is the shape of the real check (AWS Nitro: a COSE document signed by the
 *   Nitro PKI over PCR0; GCP Confidential Space: an OIDC token over the image digest) so that swapping in the real
 *   verifier is configuration plus one function. `allowSimulated: false` refuses it outright.
 *
 * ── Routing seal (standard ECIES from WebCrypto primitives) ──────────────────────────────────────────────────────
 *   eph       = fresh ECDH P-256 key pair
 *   Z         = ECDH(eph, encKey)                                        (32-byte x coordinate)
 *   K         = HKDF-SHA256(Z, salt = ephPub ‖ recipientPub (raw 65-byte points), info = "matra/matcher-routing/v1")
 *   ct        = AES-256-GCM(K, pad(JSON MatchRoutingTag), AAD = "routing|" + tag)
 *   This is ECIES-KEM + DEM, not RFC 9180 HPKE (`@hpke/core` is the drop-in if a reviewer prefers HPKE). The AAD binds
 *   the routing data to the entry's tag, so the app server cannot move one survivor's states onto another entry. The
 *   plaintext is padded to a fixed 256 bytes, so the ciphertext length does not say which states she gave.
 *
 * NOT AUDITED.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { p256 } from '@noble/curves/nist.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { AttestationDocument, AttestationPayload, MatchRoutingTag, RoutingEnvelope } from '@matra/shared';
import { fromBase64, randomBytes, toBase64, toHex } from './index';

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = globalThis.crypto.subtle;

export const ATTESTATION_DOMAIN = 'matra/attestation/v1';
export const ROUTING_INFO = 'matra/matcher-routing/v1';
/** Routing plaintext is padded to exactly this many bytes. */
export const ROUTING_PAD = 256;
/** Default maximum age of an attestation document the verifier accepts. */
export const ATTESTATION_MAX_AGE_MS = 5 * 60_000;

const HEX64 = /^[0-9a-f]{64}$/;
const STATE = /^[A-Z]{2}$/;

export type AttestationErrorCode =
  | 'malformed'
  | 'bad_signature'
  | 'wrong_nonce'
  | 'stale'
  | 'measurement_mismatch'
  | 'simulated_not_allowed'
  | 'unsupported_platform'
  | 'not_pinned';

/** The matcher's attestation did not verify. Nothing may be sealed to its key. */
export class AttestationError extends Error {
  constructor(
    readonly code: AttestationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AttestationError';
  }
}

/** A fresh verifier nonce (64 hex chars). */
export const newAttestationNonce = (): string => toHex(randomBytes(32));

const b64url = (b: Uint8Array) => toBase64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => fromBase64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));

/** A P-256 public JWK reduced to {kty, crv, x, y} (throws on anything else). */
function p256PublicJwk(k: JsonWebKey): { kty: 'EC'; crv: 'P-256'; x: string; y: string } {
  if (k?.kty !== 'EC' || k.crv !== 'P-256' || typeof k.x !== 'string' || typeof k.y !== 'string') throw new Error('not a P-256 public key');
  return { kty: 'EC', crv: 'P-256', x: k.x, y: k.y };
}

/** Raw uncompressed point 04 ‖ x ‖ y of a P-256 public JWK (validated as a curve point). */
function rawPoint(k: JsonWebKey): Uint8Array {
  const j = p256PublicJwk(k);
  const x = fromB64url(j.x);
  const y = fromB64url(j.y);
  if (x.length !== 32 || y.length !== 32) throw new Error('not a P-256 public key');
  const raw = new Uint8Array(65);
  raw[0] = 4;
  raw.set(x, 1);
  raw.set(y, 33);
  p256.Point.fromBytes(raw).assertValidity();
  return raw;
}

// ═══════════════════════════════ matcher keys ═══════════════════════════════

export interface MatcherKeys {
  /** P-256 private JWK (d, x, y): imported for ECDH by openRouting */
  encPrivateJwk: JsonWebKey;
  encPublicJwk: { kty: 'EC'; crv: 'P-256'; x: string; y: string };
  signSecretKey: Uint8Array;
  /** base64 Ed25519 public key */
  signPublicKey: string;
}

/**
 * The matcher's static keys from its 32-byte secret (MATRA_MATCHER_KEY): HKDF-SHA256 with distinct labels, the P-256
 * scalar reduced from 48 bytes (noble `randomSecretKey(seed)`, FIPS 186-5 A.4.1-style, bias ≤ 2^-128).
 */
export function matcherKeysFromSeed(seed: Uint8Array): MatcherKeys {
  if (seed.length < 32) throw new Error('matcher key must be at least 32 bytes');
  const d = p256.utils.randomSecretKey(hkdf(sha256, seed, undefined, enc.encode('matra/matcher/enc-key'), 48));
  const pub = p256.getPublicKey(d, false);
  const encPublicJwk = { kty: 'EC' as const, crv: 'P-256' as const, x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)) };
  const signSecretKey = hkdf(sha256, seed, undefined, enc.encode('matra/matcher/sign-key'), 32);
  return {
    encPrivateJwk: { ...encPublicJwk, d: b64url(d) },
    encPublicJwk,
    signSecretKey,
    signPublicKey: toBase64(ed25519.getPublicKey(signSecretKey)),
  };
}

// ═══════════════════════════════ attestation documents ═══════════════════════════════

/** Canonical payload JSON: fixed key order, encKey reduced to {kty, crv, x, y}. */
export function canonicalAttestationPayload(p: AttestationPayload): string {
  const out: AttestationPayload = {
    v: 1,
    platform: p.platform,
    measurement: p.measurement,
    encKey: p256PublicJwk(p.encKey),
    signKey: p.signKey,
    nonce: p.nonce,
    issuedAt: p.issuedAt,
  };
  return JSON.stringify(out);
}

/** Platform side (the simulated platform's dev key, or a test): sign a payload. */
export function signAttestation(p: AttestationPayload, platformSecretKey: Uint8Array): AttestationDocument {
  const payload = canonicalAttestationPayload(p);
  return { payload, signature: toBase64(ed25519.sign(enc.encode(`${ATTESTATION_DOMAIN}|${payload}`), platformSecretKey)) };
}

export const platformPublicKey = (platformSecretKey: Uint8Array): string => toBase64(ed25519.getPublicKey(platformSecretKey));

export interface VerifyAttestationOptions {
  /** base64 Ed25519 platform key. Omitted ONLY in unpinned development builds: then the signature is not checked. */
  platformKey?: string;
  /** hex measurement this verifier trusts. Omitted ONLY in unpinned development builds. */
  expectedMeasurement?: string;
  /** the nonce this verifier sent */
  nonce: string;
  maxAgeMs?: number;
  /** accept platform 'simulated' (development, or a demo build) */
  allowSimulated: boolean;
  now?: number;
}

export interface VerifiedAttestation {
  encKey: { kty: 'EC'; crv: 'P-256'; x: string; y: string };
  signKey: string;
  measurement: string;
  platform: AttestationPayload['platform'];
}

/**
 * Verify a matcher attestation document. Throws AttestationError (bad signature, wrong nonce, stale, measurement not
 * the pinned one, simulated when not allowed, malformed). Real platforms ('nitro', 'confidential-space') have no
 * verifier yet and are refused: their documents are not this format.
 */
export function verifyAttestation(doc: AttestationDocument | undefined, o: VerifyAttestationOptions): VerifiedAttestation {
  if (!doc || typeof doc.payload !== 'string' || typeof doc.signature !== 'string') throw new AttestationError('malformed', 'no attestation document');
  if (o.platformKey) {
    let ok = false;
    try {
      const sig = fromBase64(doc.signature);
      ok = sig.length === 64 && ed25519.verify(sig, enc.encode(`${ATTESTATION_DOMAIN}|${doc.payload}`), fromBase64(o.platformKey));
    } catch {
      ok = false;
    }
    if (!ok) throw new AttestationError('bad_signature', 'the attestation is not signed by the platform key this app trusts');
  }
  let p: AttestationPayload;
  try {
    p = JSON.parse(doc.payload) as AttestationPayload;
    if (p.v !== 1 || !HEX64.test(p.measurement) || typeof p.signKey !== 'string' || typeof p.issuedAt !== 'string') throw new Error();
    rawPoint(p.encKey);
    if (canonicalAttestationPayload(p) !== doc.payload) throw new Error();
  } catch {
    throw new AttestationError('malformed', 'the attestation document is malformed');
  }
  if (p.platform !== 'simulated') throw new AttestationError('unsupported_platform', `no verifier for attestation platform "${String(p.platform)}" yet`);
  if (!o.allowSimulated) throw new AttestationError('simulated_not_allowed', 'the matcher presented a simulated attestation, which this app does not accept');
  if (!HEX64.test(o.nonce) || p.nonce !== o.nonce) throw new AttestationError('wrong_nonce', 'the attestation does not answer this request');
  const age = (o.now ?? Date.now()) - Date.parse(p.issuedAt);
  if (!Number.isFinite(age) || age > (o.maxAgeMs ?? ATTESTATION_MAX_AGE_MS) || age < -60_000)
    throw new AttestationError('stale', 'the attestation is too old (or from the future)');
  if (o.expectedMeasurement !== undefined && p.measurement !== o.expectedMeasurement.toLowerCase())
    throw new AttestationError('measurement_mismatch', 'the matcher is not running the code this app trusts');
  return { encKey: p256PublicJwk(p.encKey), signKey: p.signKey, measurement: p.measurement, platform: p.platform };
}

// ═══════════════════════════════ routing seal ═══════════════════════════════

const routingAad = (tag: string) => enc.encode(`routing|${tag}`);

async function routingKey(z: ArrayBuffer, ephRaw: Uint8Array, recipientRaw: Uint8Array): Promise<CryptoKey> {
  const salt = new Uint8Array(130);
  salt.set(ephRaw, 0);
  salt.set(recipientRaw, 65);
  const ikm = await subtle.importKey('raw', z, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(ROUTING_INFO) }, ikm, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

const cleanState = (s: string | undefined): string | undefined => {
  const v = s?.trim().toUpperCase();
  return v && STATE.test(v) ? v : undefined;
};

/** Survivor client: seal her routing tag to the matcher's (verified) key. */
export async function sealRouting(routing: MatchRoutingTag, matcherEncKey: JsonWebKey): Promise<RoutingEnvelope> {
  if (!HEX64.test(routing.tag)) throw new Error('routing tag must be 64 hex chars');
  const recipientRaw = rawPoint(matcherEncKey);
  const recipient = await subtle.importKey('jwk', p256PublicJwk(matcherEncKey), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const eph = (await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const ephRaw = new Uint8Array(await subtle.exportKey('raw', eph.publicKey));
  const z = await subtle.deriveBits({ name: 'ECDH', public: recipient }, eph.privateKey, 256);
  const key = await routingKey(z, ephRaw, recipientRaw);
  const body: MatchRoutingTag = {
    v: 1,
    tag: routing.tag,
    ...(cleanState(routing.incidentState) && { incidentState: cleanState(routing.incidentState) }),
    ...(cleanState(routing.survivorState) && { survivorState: cleanState(routing.survivorState) }),
  };
  const json = enc.encode(JSON.stringify(body));
  if (json.length > ROUTING_PAD) throw new Error('routing tag too long');
  const pt = new Uint8Array(ROUTING_PAD).fill(0x20);
  pt.set(json);
  const iv = randomBytes(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: routingAad(routing.tag) as BufferSource }, key, pt as BufferSource);
  const epk = p256PublicJwk((await subtle.exportKey('jwk', eph.publicKey)) as JsonWebKey);
  return { v: 1, epk, iv: toBase64(iv), ct: toBase64(ct) };
}

/**
 * Matcher side: open a routing envelope for the entry with `tag`. Throws if it was sealed to another key, altered, or
 * moved from another entry (the AAD carries the tag), or if the tag inside differs.
 */
export async function openRouting(env: RoutingEnvelope, matcherEncPrivateJwk: JsonWebKey, tag: string): Promise<MatchRoutingTag> {
  if (env?.v !== 1) throw new Error('unsupported routing envelope');
  const pub = p256PublicJwk(matcherEncPrivateJwk);
  const priv = await subtle.importKey('jwk', { ...pub, d: matcherEncPrivateJwk.d }, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const ephRaw = rawPoint(env.epk);
  const eph = await subtle.importKey('jwk', p256PublicJwk(env.epk), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const z = await subtle.deriveBits({ name: 'ECDH', public: eph }, priv, 256);
  const key = await routingKey(z, ephRaw, rawPoint(pub));
  const pt = await subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(env.iv) as BufferSource, additionalData: routingAad(tag) as BufferSource },
    key,
    fromBase64(env.ct) as BufferSource,
  );
  const r = JSON.parse(dec.decode(pt)) as MatchRoutingTag;
  if (r.v !== 1 || r.tag !== tag) throw new Error('routing tag does not belong to this entry');
  return {
    v: 1,
    tag: r.tag,
    ...(cleanState(r.incidentState) && { incidentState: cleanState(r.incidentState) }),
    ...(cleanState(r.survivorState) && { survivorState: cleanState(r.survivorState) }),
  };
}
