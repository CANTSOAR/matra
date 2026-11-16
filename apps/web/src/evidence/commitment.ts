/**
 * Salted commitment to the hash of an original file (PLAN_REVIEW finding 1).
 *
 * The plain SHA-256 of a file is a fingerprint anyone holding the same bytes can recompute (the person who sent a message,
 * a platform, a mutual contact). If it were on the public ledger or sent to the server, that person could ask "was this
 * file imported into Matra, and when?". So the plain hash never leaves her encrypted record. What may reach the server (and
 * the ledger) is only
 *
 *     commitment = SHA-256( salt || SHA-256(original bytes) )          salt = 32 random bytes, per file
 *
 * as 64 hex characters. Without the salt nobody can test a guess against it. The salt and the plain hash are kept only in
 * her private evidence slot (./privateStore.ts), inside her encrypted envelope. She can show a court both, and it
 * recomputes the commitment: `printf '%s' "<saltHex><hashHex>" | xxd -r -p | shasum -a 256`.
 *
 * What it shows, and no more: that a file with exactly these bytes existed when the commitment was made. It does NOT show
 * that the stripped copy kept here came from that file (the copy is re-encoded in the browser and is not byte-identical).
 */
import { randomBytes, sha256Hex, toHex } from '@matra/crypto';

function fromHex(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const SALT_BYTES = 32;
const HEX64 = /^[0-9a-f]{64}$/;

export const isHex64 = (s: unknown): s is string => typeof s === 'string' && HEX64.test(s);

/** A new random salt (64 hex characters). One per file; never reused, never derived from the file. */
export function newSalt(): string {
  return toHex(randomBytes(SALT_BYTES));
}

/** SHA-256 of the file's bytes, hex. */
export const hashOriginal = (bytes: Uint8Array): Promise<string> => sha256Hex(bytes);

/** SHA-256(salt || originalSha256), both as raw bytes, hex out. Throws unless both inputs are 64 hex characters. */
export async function commit(saltHex: string, originalSha256: string): Promise<string> {
  if (!isHex64(saltHex)) throw new Error('The salt must be 64 hex characters.');
  if (!isHex64(originalSha256)) throw new Error('The hash must be 64 hex characters.');
  const out = new Uint8Array(SALT_BYTES + 32);
  out.set(fromHex(saltHex), 0);
  out.set(fromHex(originalSha256), SALT_BYTES);
  return sha256Hex(out);
}

/** Whether `commitment` is the commitment of this salt and hash. For her (and anyone she gives the salt to). */
export async function verifyCommitment(saltHex: string, originalSha256: string, commitment: string): Promise<boolean> {
  if (!isHex64(saltHex) || !isHex64(originalSha256) || !isHex64(commitment)) return false;
  return (await commit(saltHex, originalSha256)) === commitment;
}

/** Whether these original bytes are the ones committed to (hashes them, then checks with the salt). */
export async function verifyOriginal(saltHex: string, originalBytes: Uint8Array, commitment: string): Promise<boolean> {
  return verifyCommitment(saltHex, await hashOriginal(originalBytes), commitment);
}
