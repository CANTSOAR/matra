/**
 * Recovery code: a second secret, held only by the survivor, that can unwrap her account secret (index.ts, key
 * version 2) so she can set a new passphrase. Threat model W20; whitepaper §3.
 *
 *   code bytes (16, random) ‖ CRC-8 (1) ──Crockford base32──► 28 characters, shown as 7 groups of 4
 *   code bytes ──HKDF-SHA256(salt "matra/recovery/v1")──┬─ info "auth" → recoveryAuthKey (server stores only scrypt of it)
 *                                                       └─ info "kek"  → KEK_rec (AES-256-GCM, wraps AS)
 *
 * No slow hash (PBKDF2 / Argon2id) here: the code has 128 bits of entropy from the CSPRNG, so stretching would add
 * nothing. Slow hashing protects human-chosen secrets; that is W5 (the passphrase), which this does not change.
 *
 * The check byte is CRC-8 (polynomial x^8+x^2+x+1), not a cryptographic hash: it only catches typing mistakes before
 * any network call. A CRC of degree 8 detects every burst error of length ≤ 8 bits, and one mistyped base32 character
 * changes at most 5 adjacent bits, so EVERY single-character typo is caught (a truncated hash would miss 1 in 256).
 * It carries no secret: the code's strength is the 128 random bits alone.
 */
import { randomBytes, toBase64 } from './index';

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();

export const RECOVERY_CODE_BYTES = 16;
/** 17 bytes = 136 bits → 28 base32 characters (140 bits; the last 4 bits are zero). */
export const RECOVERY_CODE_LENGTH = 28;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford: no I, L, O, U

export class RecoveryCodeError extends Error {
  constructor(
    readonly reason: 'length' | 'character' | 'checksum',
    message: string,
  ) {
    super(message);
    this.name = 'RecoveryCodeError';
  }
}

function crc8(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

/** 16 code bytes → "7KQ2-M9XD-…" (7 groups of 4). */
export function formatRecoveryCode(codeBytes: Uint8Array): string {
  if (codeBytes.length !== RECOVERY_CODE_BYTES) throw new Error('A recovery code is 16 bytes');
  const all = new Uint8Array(RECOVERY_CODE_BYTES + 1);
  all.set(codeBytes);
  all[RECOVERY_CODE_BYTES] = crc8(codeBytes);
  let out = '';
  let acc = 0;
  let bits = 0;
  for (const b of all) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(acc << (5 - bits)) & 31];
  all.fill(0);
  return out.match(/.{4}/g)!.join('-');
}

/**
 * What she typed → the 16 code bytes. Case, spaces and hyphens don't matter; O reads as 0 and I / L as 1. Throws
 * RecoveryCodeError on a wrong length, a character outside the alphabet, or a failed check (a typo).
 */
export function parseRecoveryCode(input: string): Uint8Array {
  const s = input
    .toUpperCase()
    .replace(/[\s\-‐-―]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (s.length !== RECOVERY_CODE_LENGTH)
    throw new RecoveryCodeError('length', `A recovery code has ${RECOVERY_CODE_LENGTH} letters and numbers. This one has ${s.length}.`);
  const all = new Uint8Array(RECOVERY_CODE_BYTES + 1);
  let acc = 0;
  let bits = 0;
  let n = 0;
  for (const ch of s) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new RecoveryCodeError('character', `“${ch}” isn’t used in recovery codes. Check that character.`);
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      all[n++] = (acc >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
    acc &= (1 << bits) - 1;
  }
  // 140 bits read, 136 used: the 4 left over must be zero, or a character was mistyped
  const codeBytes = all.slice(0, RECOVERY_CODE_BYTES);
  const ok = acc === 0 && crc8(codeBytes) === all[RECOVERY_CODE_BYTES];
  all.fill(0);
  if (!ok) {
    codeBytes.fill(0);
    throw new RecoveryCodeError('checksum', 'That code doesn’t look right. One of the characters may be mistyped.');
  }
  return codeBytes;
}

/** A fresh code: 128 bits from the platform CSPRNG. The caller wipes `bytes` once it has derived the keys. */
export function generateRecoveryCode(): { bytes: Uint8Array; code: string } {
  const bytes = randomBytes(RECOVERY_CODE_BYTES);
  return { bytes, code: formatRecoveryCode(bytes) };
}

/** The last 4 characters (what she types to confirm she saved it). */
export function recoveryCodeTail(code: string): string {
  return code.replace(/-/g, '').slice(-4);
}

/** True when `typed` matches the code's last 4 characters (same normalisation as parsing). */
export function recoveryTailMatches(typed: string, code: string): boolean {
  const t = typed.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return t.length === 4 && t === recoveryCodeTail(code);
}

export interface RecoveryKeys {
  /** base64; the server stores only scrypt of it and compares it like a passphrase auth key */
  authKey: string;
  /** KEK_rec: AES-256-GCM, non-extractable */
  kek: CryptoKey;
}

export async function deriveRecoveryKeys(codeBytes: Uint8Array): Promise<RecoveryKeys> {
  if (codeBytes.length !== RECOVERY_CODE_BYTES) throw new Error('A recovery code is 16 bytes');
  const ikm = await subtle.importKey('raw', codeBytes as BufferSource, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const hk = (info: string) => ({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('matra/recovery/v1'), info: enc.encode(info) });
  const authBits = await subtle.deriveBits(hk('auth'), ikm, 256);
  const kek = await subtle.deriveKey(hk('kek'), ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { authKey: toBase64(authBits), kek };
}
