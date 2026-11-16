/**
 * Her private evidence slot: what the evidence reader keeps about each file that must never travel with a sealed record,
 * a share or a PDF. One encrypted, overwritable slot (packages/shared/src/slots.ts) under its own opaque name, saved over,
 * never a ledger entry, never shared.
 *
 *   originalSha256 + salt   the plain hash of the original file and the random salt of its commitment (./commitment.ts).
 *                           Only the commitment is ever sent anywhere.
 *   originalBlobId          the second encrypted file, when she chose to keep the original (off by default)
 *   ocr                     the text read from the file, exactly as printed, when she asked for it
 *
 * Keyed by the evidence item's `id` (EvidenceItem.id, chosen on her device before the file is uploaded). The slot is the
 * only place any of this is stored.
 *
 * Not written when the server keeps every draft save as a permanent record (MATRA_DRAFT_MODE=keep-versions): there each
 * slot write is also filed as an undeletable, ledgered record, which would make her OCR text and salts permanent and would
 * not be a record shape her space can read. Then the evidence reader's private details are simply not kept, and the screen
 * says so (PrivateStoreUnavailable).
 */
import { openSlot, padSlotPlaintext, sealSlot, slotName } from '@matra/crypto';
import { SLOT_MAX_BYTES } from '@matra/shared';
import { ApiError, type ApiClient } from '../api/client';
import { currentDraftMode, setDraftMode } from '../lib/draftSlot';
import { isHex64 } from './commitment';
import type { ExifString } from './imageFacts';

export const EVIDENCE_PRIVATE_SLOT = 'evidence-private';
const GCM_TAG = 16;

export interface PrivateOcr {
  /** the text exactly as the engine read it: no cleanup, correction or summary */
  text: string;
  engine: string;
  at: string;
}

export interface PrivateItem {
  /** both or neither: files added before the evidence reader have no original hash, only (maybe) text */
  originalSha256?: string;
  salt?: string;
  /** SHA-256(salt || originalSha256): the only value of these ever sent to the server (it is recomputable from the two) */
  commitment?: string;
  originalSize?: number;
  originalType?: string;
  /** when she added the file, from her device's clock */
  importedAt?: string;
  /** the file looked like a screenshot (name, no camera data, a screen's size): a label, not a finding */
  screenshotLikely?: boolean;
  /** the second encrypted file holding her unstripped original, when she chose to keep it (off by default) */
  originalBlobId?: string;
  /**
   * Written BEFORE the original is uploaded, and kept until `originalBlobId` is saved: `ciphertextSha256` is the SHA-256 of its
   * ciphertext (what the server records as the blob's content hash), and `blobId` is added as soon as the upload returns one.
   * It exists so an original whose link was never saved can still be recognised as hers, from HER record and not from what
   * the server reports: `blobId` is what the screen goes by; `ciphertextSha256` is only a lead the data export may follow, and
   * only after decrypting the blob and checking its bytes against `originalSha256` (lib/export.ts).
   */
  originalPending?: { ciphertextSha256: string; blobId?: string };
  /** set on a redacted copy: the id of the exhibit it was made from (the original is never changed) */
  derivedFrom?: string;
  /** date strings the original file's metadata held, as written (kept only in a build with "dates found in your files") */
  metadataDates?: ExifString[];
  ocr?: PrivateOcr;
}

/*
 * These details are NOT fields of the sealed record (IntakeRecord.evidence): that list is shared word for word under the
 * consent text in packages/shared/src/consent.ts, and changing what a share holds needs counsel and advocate review. They
 * stay in this slot, which is never shared.
 */

export interface PrivateEvidence {
  kind: 'evidence-private';
  v: 1;
  /** keyed by EvidenceItem.id */
  items: Record<string, PrivateItem>;
  savedAt: string;
}

export const emptyPrivate = (): PrivateEvidence => ({ kind: 'evidence-private', v: 1, items: {}, savedAt: new Date(0).toISOString() });

/** The server keeps every slot write as a permanent record, so nothing private is written. */
export class PrivateStoreUnavailable extends Error {
  readonly friendly = true;
  constructor() {
    super('This copy of Matra keeps every save permanently, so it does not keep extra details about your files (their text, or the private fingerprint of the original).');
    this.name = 'PrivateStoreUnavailable';
  }
}
export class PrivateStoreUnreadable extends Error {
  readonly friendly = true;
  constructor() {
    super('We couldn’t open the extra details saved about your files just now. They are still stored. Try again in a moment.');
    this.name = 'PrivateStoreUnreadable';
  }
}
export class PrivateStoreFull extends Error {
  readonly friendly = true;
  constructor() {
    super('There is no more room for text read from files. Your files themselves are not affected.');
    this.name = 'PrivateStoreFull';
  }
}
export class PrivateStoreConflict extends Error {
  readonly friendly = true;
  constructor() {
    super('The details about your files were saved from another device or tab a moment ago. Please try again.');
    this.name = 'PrivateStoreConflict';
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Keeps only well-formed items; a field of the wrong shape drops that item rather than trusting it. */
function sanitize(v: unknown): PrivateEvidence | null {
  if (!isObject(v) || v.kind !== 'evidence-private' || v.v !== 1 || !isObject(v.items)) return null;
  const items: Record<string, PrivateItem> = {};
  for (const [id, raw] of Object.entries(v.items)) {
    if (!isObject(raw)) continue;
    const hashed = isHex64(raw.originalSha256) && isHex64(raw.salt);
    const ocr = isObject(raw.ocr) && typeof raw.ocr.text === 'string' ? { text: raw.ocr.text, engine: String(raw.ocr.engine ?? ''), at: String(raw.ocr.at ?? '') } : undefined;
    items[id] = {
      ...(hashed && { originalSha256: raw.originalSha256 as string, salt: raw.salt as string }),
      ...(isHex64(raw.commitment) && { commitment: raw.commitment }),
      ...(raw.screenshotLikely === true && { screenshotLikely: true }),
      ...(typeof raw.derivedFrom === 'string' && { derivedFrom: raw.derivedFrom }),
      ...(Array.isArray(raw.metadataDates) && {
        metadataDates: raw.metadataDates.filter(
          (d): d is ExifString => isObject(d) && typeof d.value === 'string' && (d.tag === 'DateTime' || d.tag === 'DateTimeOriginal' || d.tag === 'DateTimeDigitized'),
        ),
      }),
      ...(typeof raw.originalSize === 'number' && { originalSize: raw.originalSize }),
      ...(typeof raw.originalType === 'string' && { originalType: raw.originalType }),
      ...(typeof raw.importedAt === 'string' && { importedAt: raw.importedAt }),
      ...(typeof raw.originalBlobId === 'string' && { originalBlobId: raw.originalBlobId }),
      ...(isObject(raw.originalPending) && isHex64(raw.originalPending.ciphertextSha256) && { originalPending: { ciphertextSha256: raw.originalPending.ciphertextSha256, ...(typeof raw.originalPending.blobId === 'string' && { blobId: raw.originalPending.blobId }) } }),
      ...(ocr && { ocr }),
    };
  }
  return { kind: 'evidence-private', v: 1, items, savedAt: typeof v.savedAt === 'string' ? v.savedAt : '' };
}

export interface LoadedPrivate {
  value: PrivateEvidence;
  /** the slot's version tag (a save must name it); null when she has none yet */
  version: string | null;
  /** stored but did not open: nothing is saved over it */
  unreadable: boolean;
}

export async function loadPrivate(api: ApiClient, masterKey: CryptoKey): Promise<LoadedPrivate> {
  const res = await api.getSlot(await slotName(masterKey, EVIDENCE_PRIVATE_SLOT));
  setDraftMode(res.draftMode);
  if (!res.slot) return { value: emptyPrivate(), version: null, unreadable: false };
  try {
    const value = sanitize(await openSlot<unknown>(res.slot, masterKey));
    if (value) return { value, version: res.slot.version, unreadable: false };
  } catch {
    /* falls through */
  }
  return { value: emptyPrivate(), version: res.slot.version, unreadable: true };
}

/**
 * Read, change and save the slot (reading again once if another save got there first). `change` returns the new value.
 * Throws PrivateStoreUnavailable (keep-versions), PrivateStoreUnreadable, PrivateStoreFull or PrivateStoreConflict.
 */
export async function updatePrivate(api: ApiClient, masterKey: CryptoKey, change: (cur: PrivateEvidence) => PrivateEvidence): Promise<PrivateEvidence> {
  for (let attempt = 0; ; attempt++) {
    const cur = await loadPrivate(api, masterKey);
    if (currentDraftMode() === 'keep-versions') throw new PrivateStoreUnavailable();
    if (cur.unreadable) throw new PrivateStoreUnreadable();
    const value: PrivateEvidence = { ...change(cur.value), kind: 'evidence-private', v: 1, savedAt: new Date().toISOString() };
    if (padSlotPlaintext(value).length + GCM_TAG > SLOT_MAX_BYTES) throw new PrivateStoreFull();
    const sealed = await sealSlot(value, masterKey);
    try {
      const put = await api.putSlot(await slotName(masterKey, EVIDENCE_PRIVATE_SLOT), { ...sealed, expectedVersion: cur.version });
      setDraftMode(put.draftMode);
      return value;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.code === 'slot_conflict') {
        if (attempt >= 1) throw new PrivateStoreConflict();
        continue;
      }
      throw e;
    }
  }
}

/** Add or replace one file's private details. */
export const setPrivateItem = (api: ApiClient, masterKey: CryptoKey, itemId: string, item: PrivateItem): Promise<PrivateEvidence> =>
  updatePrivate(api, masterKey, (cur) => ({ ...cur, items: { ...cur.items, [itemId]: item } }));

/** Save the text read from a file (replaces any earlier reading). */
export const setPrivateOcr = (api: ApiClient, masterKey: CryptoKey, itemId: string, ocr: PrivateOcr): Promise<PrivateEvidence> =>
  updatePrivate(api, masterKey, (cur) => {
    return { ...cur, items: { ...cur.items, [itemId]: { ...cur.items[itemId], ocr } } };
  });

/**
 * Blobs her own record says are kept originals: the one an item links (`originalBlobId`) and the one it recorded when the
 * upload returned (`originalPending.blobId`). Nothing the server says about a blob (hash, size, time) puts a blob in this set.
 */
export function originalBlobIds(items: Readonly<Record<string, PrivateItem>>): Set<string> {
  const out = new Set<string>();
  for (const p of Object.values(items)) {
    if (p.originalBlobId) out.add(p.originalBlobId);
    if (p.originalPending?.blobId) out.add(p.originalPending.blobId);
  }
  return out;
}

/** Evidence item id -> salted commitment, for the PDF's Evidence Inventory (never the salt, never a plain hash). */
export const commitmentsById = (items: Readonly<Record<string, PrivateItem>>): Record<string, string> =>
  Object.fromEntries(Object.entries(items).flatMap(([id, p]) => (p.commitment ? [[id, p.commitment] as const] : [])));
