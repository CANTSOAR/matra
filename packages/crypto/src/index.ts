/**
 * @matra/crypto — isomorphic (browser + Node ≥ 20) WebCrypto helpers that
 * implement the zero-knowledge vault.
 *
 * Key hierarchy
 *   passphrase ──PBKDF2-SHA256(600k, salt)──► 512 bits
 *        ├─ HKDF("matra/auth")   → authKey   (sent to server, which stores only a slow hash)
 *        └─ HKDF("matra/master") → masterKey (AES-256-GCM, never leaves the device)
 *   masterKey wraps: the user's RSA-OAEP private key, and every per-record / per-blob key.
 *   Sharing: a record key is re-wrapped to the attorney's RSA public key.
 */
import type { Envelope, IdentifierKind, WrappedKey } from '@matra/shared';

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const DEFAULT_KDF_ITERATIONS = 600_000;
const ESCROW_SALT = enc.encode('matra/escrow/v1');
const ESCROW_ITERATIONS = 200_000;

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
}

export function newKdfSalt(): string {
  return toBase64(randomBytes(16));
}

export async function deriveKeys(
  passphrase: string,
  kdfSaltB64: string,
  iterations = DEFAULT_KDF_ITERATIONS,
): Promise<DerivedKeys> {
  const base = await subtle.importKey('raw', enc.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(kdfSaltB64) as BufferSource, iterations },
    base,
    512,
  );
  const ikm = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const hk = (info: string) => ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(info) });
  const authBits = await subtle.deriveBits(hk('matra/auth'), ikm, 256);
  const masterKey = await subtle.deriveKey(hk('matra/master'), ikm, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  return { authKey: toBase64(authBits), masterKey };
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

// ───────────── blind escrow ─────────────

/** Canonicalise an identifier so that two survivors typing the same person produce the same value. */
export function normalizeIdentifier(kind: IdentifierKind, value: string, platform?: string): string {
  let v = value.normalize('NFKC').trim().toLowerCase();
  switch (kind) {
    case 'email': {
      v = v.replace(/\s+/g, '');
      const [local, domain] = v.split('@');
      if (local && domain) {
        let l = local.split('+')[0];
        if (domain === 'gmail.com' || domain === 'googlemail.com') l = l.replace(/\./g, '');
        v = `${l}@${domain === 'googlemail.com' ? 'gmail.com' : domain}`;
      }
      break;
    }
    case 'phone': {
      let digits = v.replace(/\D/g, '');
      if (digits.length === 10) digits = `1${digits}`; // assume NANP
      v = digits;
      break;
    }
    case 'social_handle':
      v = `${(platform ?? 'unknown').trim().toLowerCase()}:${v.replace(/^@/, '').replace(/\s+/g, '')}`;
      break;
    case 'full_name':
      v = v.replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ');
      break;
    default:
      v = v.replace(/\s+/g, ' ');
  }
  return `${kind}|${v}`;
}

/**
 * Slow, salted hash of a normalised identifier. The server never sees the identifier;
 * it re-hashes this value with a secret pepper (HMAC) before storing it, so a database
 * leak alone does not allow dictionary attacks.
 */
export async function escrowIdentifierHash(kind: IdentifierKind, value: string, platform?: string): Promise<string> {
  const base = await subtle.importKey('raw', enc.encode(normalizeIdentifier(kind, value, platform)), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: ESCROW_SALT, iterations: ESCROW_ITERATIONS },
    base,
    256,
  );
  return toHex(bits);
}
