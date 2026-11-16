/**
 * Test helpers for the evidence reader: an in-memory ApiClient with the server's slot compare-and-swap and a blob store that
 * records every byte and header it is given (so a test can search everything the "server" received).
 */
import { deriveKeys, newKdfSalt, sha256Hex } from '@matra/crypto';
import type { BlobMeta, DraftMode, VaultSlot } from '@matra/shared';
import { ApiError, type ApiClient } from '../api/client';
import { setDraftMode } from '../lib/draftSlot';

export interface SeenUpload {
  ct: Uint8Array;
  wrappedKey: unknown;
  commitment?: string;
}

export function fakeApi(draftMode: DraftMode = 'slot') {
  const slots = new Map<string, VaultSlot>();
  const uploads: SeenUpload[] = [];
  const slotPuts: string[] = [];
  /** what the server's blob list shows */
  const listed: BlobMeta[] = [];
  let v = 0;
  const api = {
    async getSlot(name: string) {
      return { slot: slots.get(name) ?? null, draftMode };
    },
    async putSlot(name: string, req: { envelope: VaultSlot['envelope']; wrappedKey: VaultSlot['wrappedKey']; expectedVersion: string | null }) {
      slotPuts.push(name);
      if ((slots.get(name)?.version ?? null) !== req.expectedVersion) throw new ApiError(409, 'stale', 'slot_conflict');
      const version = (++v).toString(16).padStart(32, '0');
      slots.set(name, { name, envelope: req.envelope, wrappedKey: req.wrappedKey, version, updatedDay: '2026-11-16' });
      return { version, updatedDay: '2026-11-16', draftMode };
    },
    async uploadBlob(ct: Uint8Array, wrappedKey: unknown, commitment?: string) {
      uploads.push({ ct, wrappedKey, commitment });
      const n = uploads.length;
      const id = String(n).padStart(32, '0');
      const entry = (type: string, contentHash: string) => ({ seq: n, id: `e${n}${type}`, type, subjectId: id, contentHash, timestamp: '2026-11-16T00:00:00.000Z', prevHash: '0', entryHash: '1' });
      const blob = { id, sizeBytes: ct.length, contentHash: await sha256Hex(ct), ownerWrappedKey: wrappedKey, createdAt: '2026-11-16T00:00:00.000Z', ledgerEntryId: 'l' };
      listed.push({ ownerId: 'u', ...blob } as unknown as BlobMeta);
      return {
        blob,
        ledgerEntry: entry('blob.sealed', 'c'),
        ...(commitment && { commitmentEntry: entry('evidence.committed', commitment) }),
      };
    },
    async listBlobs() {
      return { blobs: [...listed] };
    },
  } as unknown as ApiClient;
  setDraftMode(draftMode);
  return { api, slots, uploads, slotPuts, listed };
}

export const testKeys = () => deriveKeys('evidence reader test passphrase', newKdfSalt(), 1000);

/** Every place a hash could be: hex of the bytes, base64 of the bytes, and the JSON of every other argument. */
export function everythingSent(uploads: SeenUpload[], slots: Map<string, VaultSlot>): string {
  const parts: string[] = [];
  for (const u of uploads) {
    parts.push(Array.from(u.ct, (b) => b.toString(16).padStart(2, '0')).join(''), JSON.stringify(u.wrappedKey), u.commitment ?? '');
  }
  for (const s of slots.values()) parts.push(JSON.stringify(s));
  return parts.join('\n');
}
