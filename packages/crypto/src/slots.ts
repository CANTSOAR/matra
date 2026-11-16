/**
 * Draft slots (packages/shared/src/slots.ts): opaque names and padded envelopes.
 *
 *   name     = hex HMAC-SHA256(slotNameKey, "matra/slot/v1|" + label), slotNameKey = HKDF(AS, "matra/slot-name/v1")
 *              (./index.ts). The server sees 64 hex characters, never "draft" or "expenses".
 *   envelope = AES-256-GCM under a fresh content key K_s per write; K_s wrapped under her master key, as for records.
 *              The JSON plaintext is padded with trailing spaces (JSON.parse ignores them) so the ciphertext, tag
 *              included, is a whole number of SLOT_BUCKET_BYTES.
 */
import { SLOT_BUCKET_BYTES, type Envelope, type WrappedKey } from '@matra/shared';
import { decryptBytes, encryptBytes, generateContentKey, slotNameKeyFor, toHex, unwrapKeyWithMaster, wrapKeyWithMaster } from './index';

const enc = new TextEncoder();
const dec = new TextDecoder();
const GCM_TAG_BYTES = 16;
const SPACE = 0x20;

/** Her opaque name for the slot `label` (for example 'draft'). Throws for a master key no unlock path made. */
export async function slotName(masterKey: CryptoKey, label: string): Promise<string> {
  const key = slotNameKeyFor(masterKey);
  if (!key) throw new Error('No slot-name key for this master key: unlock the account with deriveKeys / unlockAccount / importAccountSecret.');
  return toHex(await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(`matra/slot/v1|${label}`)));
}

/** The JSON bytes of `value`, padded with spaces so that ciphertext + tag fills whole buckets. */
export function padSlotPlaintext(value: unknown): Uint8Array {
  const json = enc.encode(JSON.stringify(value));
  const total = Math.ceil((json.length + GCM_TAG_BYTES) / SLOT_BUCKET_BYTES) * SLOT_BUCKET_BYTES - GCM_TAG_BYTES;
  const out = new Uint8Array(total).fill(SPACE);
  out.set(json, 0);
  return out;
}

/** Encrypt a slot value under a fresh key wrapped by her master key. */
export async function sealSlot(value: unknown, masterKey: CryptoKey): Promise<{ envelope: Envelope; wrappedKey: WrappedKey }> {
  const key = await generateContentKey();
  const envelope = await encryptBytes(padSlotPlaintext(value), key);
  return { envelope, wrappedKey: await wrapKeyWithMaster(key, masterKey) };
}

/** Open a slot. Throws when the key or ciphertext doesn't open (wrong account, or changed on the server). */
export async function openSlot<T>(slot: { envelope: Envelope; wrappedKey: WrappedKey }, masterKey: CryptoKey): Promise<T> {
  const key = await unwrapKeyWithMaster(slot.wrappedKey, masterKey);
  return JSON.parse(dec.decode(await decryptBytes(slot.envelope, key))) as T;
}
