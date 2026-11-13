/**
 * @matra/crypto — isomorphic (browser + Node ≥ 20) WebCrypto helpers that
 * implement the zero-knowledge vault.
 *
 * Key hierarchy
 *   passphrase ──PBKDF2-SHA256(600k, salt)──► 512 bits (ikm)
 *        ├─ HKDF("matra/auth")   → authKey   (sent to server, which stores only a slow hash)
 *        ├─ key version 1: HKDF("matra/master") → masterKey (AES-256-GCM, never leaves the device)
 *        │                 HKDF("matra/match-x") → matchKey (HMAC, sealed-match share x-coordinates)
 *        └─ key version 2: HKDF("matra/kek") → KEK_pass, which unwraps the account secret
 *   account secret AS (64 bytes) = master (32) ‖ matchX (32). For an account that moves from version 1 to 2, AS is
 *   exactly the bytes version 1 derived, so nothing is re-encrypted. In version 2 the server stores
 *   AES-GCM(KEK_pass, AS) and, if she set one up, AES-GCM(KEK_rec, AS) where KEK_rec comes from her recovery code
 *   (./recovery.ts). Changing the passphrase then only re-wraps AS.
 *   masterKey wraps: the user's RSA-OAEP private key, and every per-record / per-blob key.
 *   Sharing: a record key is re-wrapped to the attorney's RSA public key.
 */
import type { Envelope, WrappedKey } from '@matra/shared';

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const DEFAULT_KDF_ITERATIONS = 600_000;

// ───────────── encoding ─────────────

export function toBase64(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function toHex(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomBytes(n: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export function randomId(): string {
  return toHex(randomBytes(16));
}

export async function sha256Hex(data: Uint8Array | ArrayBuffer | string): Promise<string> {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  return toHex(await subtle.digest('SHA-256', bytes as BufferSource));
}

// ───────────── passphrase → keys ─────────────

export interface DerivedKeys {
  /** base64; send to server for authentication */
  authKey: string;
  /** AES-GCM key; keep in memory only */
  masterKey: CryptoKey;
  /**
   * HMAC-SHA256 key (non-extractable), HKDF-derived from the same passphrase material with its own label. Used only
   * for her sealed-match share x-coordinates (matching.ts survivorShareX). Also registered against `masterKey`, so code
   * that only holds the master key can find it (matchKeyFor).
   */
  matchKey: CryptoKey;
}

// masterKey → matchKey, for the lifetime of the in-memory key objects only (never persisted).
const MATCH_KEYS = new WeakMap<CryptoKey, CryptoKey>();

/** The sealed-match HMAC key derived alongside `masterKey` by deriveKeys (undefined for keys from elsewhere). */
export function matchKeyFor(masterKey: CryptoKey): CryptoKey | undefined {
  return MATCH_KEYS.get(masterKey);
}

export function newKdfSalt(): string {
  return toBase64(randomBytes(16));
}

/** Size of the account secret AS = master key bytes (32) ‖ match-x key bytes (32). */
export const ACCOUNT_SECRET_BYTES = 64;

/** What a passphrase gives on its own, before the server has said which key version the account uses. */
export interface PassphraseKeys {
  /** base64; send to server for authentication */
  authKey: string;
  /** the PBKDF2 output as a non-extractable HKDF key (version 1 derives the vault keys from it) */
  ikm: CryptoKey;
  /** KEK_pass: AES-256-GCM, non-extractable; wraps the account secret in key version 2 */
  kek: CryptoKey;
}

const hkdf = (info: string) => ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(info) });

export async function derivePassphraseKeys(
  passphrase: string,
  kdfSaltB64: string,
  iterations = DEFAULT_KDF_ITERATIONS,
): Promise<PassphraseKeys> {
  const base = await subtle.importKey('raw', enc.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(kdfSaltB64) as BufferSource, iterations },
    base,
    512,
  );
  const ikm = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveBits', 'deriveKey']);
  new Uint8Array(bits).fill(0);
  const authBits = await subtle.deriveBits(hkdf('matra/auth'), ikm, 256);
  const kek = await subtle.deriveKey(hkdf('matra/kek'), ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { authKey: toBase64(authBits), ikm, kek };
}

/**
 * Key version 1's account secret as bytes: the same HKDF outputs deriveKeys imports as keys (WebCrypto deriveKey of a
 * 256-bit key equals deriveBits(256) with the same parameters; crypto.test.ts checks it). Used once, when an account
 * moves to version 2. The caller wipes the result.
 */
export async function legacyAccountSecret(ikm: CryptoKey): Promise<Uint8Array> {
  const out = new Uint8Array(ACCOUNT_SECRET_BYTES);
  out.set(new Uint8Array(await subtle.deriveBits(hkdf('matra/master'), ikm, 256)), 0);
  out.set(new Uint8Array(await subtle.deriveBits(hkdf('matra/match-x'), ikm, 256)), 32);
  return out;
}

/** Import an account secret as the (non-extractable) vault keys, and register the pair for matchKeyFor. */
export async function importAccountSecret(accountSecret: Uint8Array): Promise<{ masterKey: CryptoKey; matchKey: CryptoKey }> {
  if (accountSecret.length !== ACCOUNT_SECRET_BYTES) throw new Error('Account secret must be 64 bytes');
  const masterKey = await subtle.importKey('raw', accountSecret.slice(0, 32) as BufferSource, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  const matchKey = await subtle.importKey('raw', accountSecret.slice(32) as BufferSource, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, [
    'sign',
  ]);
  MATCH_KEYS.set(masterKey, matchKey);
  return { masterKey, matchKey };
}

/** AES-256-GCM(kek, AS): what the server stores as wrapped_account_key (KEK_pass) or recovery_wrapped_key (KEK_rec). */
export async function wrapAccountSecret(accountSecret: Uint8Array, kek: CryptoKey): Promise<Envelope> {
  if (accountSecret.length !== ACCOUNT_SECRET_BYTES) throw new Error('Account secret must be 64 bytes');
  return encryptBytes(accountSecret, kek);
}

/** Throws if the KEK is wrong or the envelope was changed (GCM tag). The caller wipes the result. */
export async function unwrapAccountSecret(wrapped: Envelope, kek: CryptoKey): Promise<Uint8Array> {
  const as = await decryptBytes(wrapped, kek);
  if (as.length !== ACCOUNT_SECRET_BYTES) {
    as.fill(0);
    throw new Error('Not an account secret');
  }
  return as;
}

/**
 * The vault keys for an account. Version 1 (no `wrappedAccountKey`): derived from the passphrase, as since the first
 * release. Version 2: AS unwrapped with KEK_pass (throws on a wrong passphrase), imported, and wiped.
 */
export async function unlockAccount(
  keys: PassphraseKeys,
  wrappedAccountKey?: Envelope,
): Promise<{ masterKey: CryptoKey; matchKey: CryptoKey }> {
  if (wrappedAccountKey) {
    const as = await unwrapAccountSecret(wrappedAccountKey, keys.kek);
    try {
      return await importAccountSecret(as);
    } finally {
      as.fill(0);
    }
  }
  const masterKey = await subtle.deriveKey(hkdf('matra/master'), keys.ikm, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  const matchKey = await subtle.deriveKey(hkdf('matra/match-x'), keys.ikm, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
  MATCH_KEYS.set(masterKey, matchKey);
  return { masterKey, matchKey };
}

/** Passphrase → auth key + vault keys in one step. Pass `wrappedAccountKey` for a key-version-2 account. */
export async function deriveKeys(
  passphrase: string,
  kdfSaltB64: string,
  iterations = DEFAULT_KDF_ITERATIONS,
  wrappedAccountKey?: Envelope,
): Promise<DerivedKeys> {
  const keys = await derivePassphraseKeys(passphrase, kdfSaltB64, iterations);
  return { authKey: keys.authKey, ...(await unlockAccount(keys, wrappedAccountKey)) };
}

// ───────────── symmetric content encryption ─────────────

export async function generateContentKey(): Promise<CryptoKey> {
  return subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function encryptBytes(plaintext: Uint8Array, key: CryptoKey): Promise<Envelope> {
  const iv = randomBytes(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plaintext as BufferSource);
  return { v: 1, alg: 'A256GCM', iv: toBase64(iv), ct: toBase64(ct) };
}

export async function decryptBytes(envelope: Envelope, key: CryptoKey): Promise<Uint8Array> {
  const pt = await subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(envelope.iv) as BufferSource },
    key,
    fromBase64(envelope.ct) as BufferSource,
  );
  return new Uint8Array(pt);
}

export async function encryptJSON(value: unknown, key: CryptoKey): Promise<Envelope> {
  return encryptBytes(enc.encode(JSON.stringify(value)), key);
}

export async function decryptJSON<T>(envelope: Envelope, key: CryptoKey): Promise<T> {
  return JSON.parse(dec.decode(await decryptBytes(envelope, key))) as T;
}

/** Binary blob format for evidence uploads: 12-byte IV || AES-GCM ciphertext. */
export async function encryptBlob(plaintext: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plaintext as BufferSource));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return out;
}

export async function decryptBlob(blob: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  const pt = await subtle.decrypt(
    { name: 'AES-GCM', iv: blob.subarray(0, 12) as BufferSource },
    key,
    blob.subarray(12) as BufferSource,
  );
  return new Uint8Array(pt);
}

// ───────────── key wrapping ─────────────

/** Wrap a content key under the owner's master key. */
export async function wrapKeyWithMaster(contentKey: CryptoKey, masterKey: CryptoKey): Promise<WrappedKey> {
  const raw = new Uint8Array(await subtle.exportKey('raw', contentKey));
  const e = await encryptBytes(raw, masterKey);
  return { v: 1, alg: 'A256GCM-KW', iv: e.iv, data: e.ct };
}

export async function unwrapKeyWithMaster(wrapped: WrappedKey, masterKey: CryptoKey): Promise<CryptoKey> {
  if (wrapped.alg !== 'A256GCM-KW' || !wrapped.iv) throw new Error('Not a master-wrapped key');
  const raw = await decryptBytes({ v: 1, alg: 'A256GCM', iv: wrapped.iv, ct: wrapped.data }, masterKey);
  return subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

// ───────────── asymmetric identity (for sharing) ─────────────

const RSA_PARAMS: RsaHashedKeyGenParams = {
  name: 'RSA-OAEP',
  modulusLength: 3072,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
};

export interface IdentityKeys {
  publicKey: JsonWebKey;
  privateKey: CryptoKey;
  wrappedPrivateKey: Envelope;
}

/** Create the user's sharing keypair; the private key is returned wrapped under masterKey. */
export async function generateIdentity(masterKey: CryptoKey): Promise<IdentityKeys> {
  const kp = await subtle.generateKey(RSA_PARAMS, true, ['encrypt', 'decrypt']);
  const publicKey = await subtle.exportKey('jwk', kp.publicKey);
  const privJwk = await subtle.exportKey('jwk', kp.privateKey);
  const wrappedPrivateKey = await encryptJSON(privJwk, masterKey);
  return { publicKey, privateKey: kp.privateKey, wrappedPrivateKey };
}

export async function unwrapPrivateKey(wrappedPrivateKey: Envelope, masterKey: CryptoKey): Promise<CryptoKey> {
  const jwk = await decryptJSON<JsonWebKey>(wrappedPrivateKey, masterKey);
  return subtle.importKey('jwk', jwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
}

/** Re-wrap a content key so only the holder of `recipientPublicKey` can open it. */
export async function wrapKeyForRecipient(contentKey: CryptoKey, recipientPublicKey: JsonWebKey): Promise<WrappedKey> {
  const pub = await subtle.importKey('jwk', recipientPublicKey, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const raw = await subtle.exportKey('raw', contentKey);
  const data = await subtle.encrypt({ name: 'RSA-OAEP' }, pub, raw);
  return { v: 1, alg: 'RSA-OAEP-256', data: toBase64(data) };
}

export async function unwrapKeyWithPrivate(wrapped: WrappedKey, privateKey: CryptoKey): Promise<CryptoKey> {
  if (wrapped.alg !== 'RSA-OAEP-256') throw new Error('Not a recipient-wrapped key');
  const raw = await subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, fromBase64(wrapped.data) as BufferSource);
  return subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/** Short human-comparable fingerprint of a public key (for out-of-band verification with an attorney). */
export async function publicKeyFingerprint(jwk: JsonWebKey): Promise<string> {
  const h = await sha256Hex(`${jwk.kty}|${jwk.n}|${jwk.e}`);
  return h.slice(0, 32).toUpperCase().match(/.{4}/g)!.join('-');
}

// ───────────── sealed matching ─────────────
// The old "blind escrow" (client PBKDF2 hash + server HMAC pepper) was replaced by the Callisto-style protocol in
// ./matching.ts: a split-key RFC 9497 VOPRF, per-perpetrator Shamir shares, and counselor-only threshold decryption.
export * from './matching';
export * from './recovery';
export * from './ledger';
export * from './directory';
