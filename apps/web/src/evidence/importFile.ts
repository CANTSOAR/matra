/**
 * Adding a file (PR 31): everything that happens on her device before anything is sent.
 *
 *   1. hash her ORIGINAL bytes (before stripping) and make a salted commitment to that hash (./commitment.ts)
 *   2. read what the file says about itself (size in pixels, camera fields) and flag a likely screenshot (./screenshot.ts)
 *   3. strip hidden details if the type can be stripped (JPEG, PNG, WebP only: lib/metadata.ts), hash the copy
 *   4. if she chose to keep the original and it differs from the copy: encrypt it as a second file (off by default)
 *   5. save the plain hash and the salt in her PRIVATE evidence slot, first, together with a RESERVATION for the original
 *      (the hash of its ciphertext), then upload the original, then link it (originalBlobId) in the slot, then encrypt the
 *      copy and upload it with ONLY the commitment (the plain hash and the salt never leave her device unencrypted)
 *
 * There is no way to delete a file once it is on the server (blobs are write-once; the only route that removes any is
 * deleting the whole account), so a stored original can never be "taken back", and she is never told one was not kept unless
 * the server provably refused it. The blob's id is written into the reservation the moment the upload returns it, so if the
 * full link then fails, her own record still names it; after a dropped connection or a timeout the reservation stays, the
 * blob list is checked, and she is told a copy may still be stored. Nothing is hidden or renamed because of what the server
 * reports about a blob (see exhibits.ts, privateStore.ts originalBlobIds).
 *
 * It does not interpret the file: no caption, no objects, no faces.
 */
import { encryptBlob, generateContentKey, randomId, sha256Hex, wrapKeyWithMaster } from '@matra/crypto';
import type { EvidenceItem, EvidenceKind, LedgerEntry, WrappedKey } from '@matra/shared';
import { ApiError, type ApiClient } from '../api/client';
import { mirror } from '../dev/mirror';
import { stripMetadata } from '../lib/metadata';
import { commit, hashOriginal, newSalt } from './commitment';
import { unstrippedWarning } from './formats';
import { readImageFacts } from './imageFacts';
import { loadPrivate, setPrivateItem, type PrivateItem } from './privateStore';
import { currentDraftMode } from '../lib/draftSlot';
import { screenshotSignals } from './screenshot';
import { DATES_FOUND_IN_BUILD } from './datesFlag';

export function evidenceKindFor(file: { type: string; name: string }, screenshotLikely = false): EvidenceKind {
  const t = file.type.toLowerCase();
  if (t.startsWith('image/')) return screenshotLikely || /screen\s?shot|screen_shot|screenshot/i.test(file.name) ? 'screenshot' : 'photo';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (t === 'application/pdf' || t.startsWith('text/') || t.includes('document')) return 'document';
  return 'other';
}

/** Said whenever she asked to keep the original and it was not kept: she may be about to delete the one on her phone. */
export const ORIGINAL_NOT_KEPT = ' Your original was NOT kept here either, so please keep it on your device.';
/**
 * Said when the original went up but could not be linked to its file: it cannot be taken off the server from here, so she is
 * told a locked copy may be there. (For advocates to review.)
 */
export const ORIGINAL_KEEP_ON_DEVICE = ' Please keep your original on your device.';
export const ORIGINAL_NOT_SEEN = ' We checked and could not see a copy of your original in your space. Please keep it on your device.';
export const ORIGINAL_MAY_BE_STORED =
  ' A locked copy of your original may still be stored in your space. Only you can open it, it is not shared, and it is listed with this file in your export, but this version of Matra cannot remove it.';

export interface ImportOptions {
  description?: string;
  capturedAt?: string;
  /** keep her original (with its hidden details) as a second encrypted file. Off unless she turns it on. */
  keepOriginal?: boolean;
  /** this file is a copy made from another exhibit (a redacted copy): the exhibit's id */
  derivedFrom?: string;
}

export interface UploadedEvidence {
  item: EvidenceItem;
  /** what is kept privately about it (commitment, screenshot label, whether the original was kept); null if nothing was */
  details: PrivateItem | null;
  /** stripped plaintext, for an in-memory preview only */
  plaintext: Blob;
  note: string;
  /** set when the file was NOT cleaned: what was kept, in plain words */
  warning: string | null;
  /** set when the private details (original fingerprint, salt) could not be kept, and so no commitment was made */
  privateNote: string | null;
  ledgerEntry: LedgerEntry;
  commitmentEntry?: LedgerEntry;
}

/** The server answered "no" before storing anything (a validation or permission refusal). A dropped connection, a timeout or a server error is NOT this: the file may have arrived. */
const provablyNotStored = (e: unknown): boolean => e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408;

/** Is a blob with exactly this ciphertext hash listed? (A fresh random IV makes it unique to this attempt.) undefined when the list cannot be read. Only informs what she is told. */
async function copyIsListed(api: ApiClient, ciphertextSha256: string): Promise<boolean | undefined> {
  try {
    return (await api.listBlobs()).blobs.some((b) => b.contentHash === ciphertextSha256);
  } catch {
    return undefined;
  }
}

const omitPending = ({ originalPending: _p, ...rest }: PrivateItem): PrivateItem => rest;
const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

async function encryptForUpload(bytes: Uint8Array, masterKey: CryptoKey) {
  const key = await generateContentKey();
  return { ct: await encryptBlob(bytes, key), wrapped: await wrapKeyWithMaster(key, masterKey) };
}

export async function importEvidence(api: ApiClient, masterKey: CryptoKey, file: File, opts: ImportOptions = {}): Promise<UploadedEvidence> {
  const originalBytes = await bytesOf(file);
  const originalSha256 = await hashOriginal(originalBytes);
  const facts = file.type.toLowerCase().startsWith('image/') ? readImageFacts(originalBytes) : null;
  const shot = screenshotSignals({ fileName: file.name, mimeType: file.type || '', width: facts?.width, height: facts?.height, hasCameraData: facts?.hasCameraData ?? false });

  const { blob, stripped, note } = await stripMetadata(file);
  const bytes = stripped ? await bytesOf(blob) : originalBytes;
  const sha256 = await hashOriginal(bytes);

  // Can her private details be kept? (not when the server keeps every slot write as a permanent record, nor when the slot
  // she has does not open). If not, no commitment is made (a commitment she could never open is worth nothing) and no
  // original is kept: the original is listed in the private slot, so without it she could not find it again.
  let privateNote: string | null = null;
  try {
    const cur = await loadPrivate(api, masterKey);
    if (cur.unreadable) privateNote = 'We couldn’t open the extra details saved about your files, so no private fingerprint of this file’s original was kept.';
    else if (currentDraftMode() === 'keep-versions') privateNote = 'This copy of Matra keeps every save permanently, so it does not keep a private fingerprint of the original file.';
  } catch {
    privateNote = 'We couldn’t reach your saved details just now, so no private fingerprint of this file’s original was kept.';
  }

  const id = randomId();
  const salt = privateNote ? undefined : newSalt();
  const commitment = salt ? await commit(salt, originalSha256) : undefined;
  // there is a separate original to keep only when the copy differs from it (JPEG, PNG, WebP; everything else is kept as is)
  const wantsOriginal = !!opts.keepOriginal && stripped && sha256 !== originalSha256;
  if (wantsOriginal && privateNote) privateNote += ORIGINAL_NOT_KEPT;
  const keepOriginal = wantsOriginal && !!salt;

  mirror(
    'Evidence file',
    `${file.name} (${bytes.byteLength} bytes${stripped ? ', location and camera data removed here' : ''})`,
    `Encrypted here. The server gets the ciphertext and a scrambled (salted) commitment, never the file's plain hash or its name.`,
  );

  const importedAt = new Date().toISOString();
  let priv: PrivateItem | null = null;
  let finalNote = privateNote;
  if (salt) {
    priv = {
      originalSha256,
      salt,
      ...(commitment && { commitment }),
      originalSize: originalBytes.byteLength,
      originalType: file.type || 'application/octet-stream',
      importedAt,
      ...(shot.likely && { screenshotLikely: true }),
      // the original's own date strings, only in a build with "dates found in your files" (off by default)
      ...(DATES_FOUND_IN_BUILD && facts?.exifDates.length && { metadataDates: facts.exifDates }),
      ...(opts.derivedFrom && { derivedFrom: opts.derivedFrom }),
    };
    // Her original, encrypted now so that the reservation can name it BEFORE anything is uploaded.
    let kept: { ct: Uint8Array; wrapped: WrappedKey } | undefined;
    if (keepOriginal) {
      try {
        kept = await encryptForUpload(originalBytes, masterKey);
        priv = { ...priv, originalPending: { ciphertextSha256: await sha256Hex(kept.ct) } };
      } catch (e) {
        kept = undefined;
        finalNote = `We couldn’t keep the original (${(e as Error).message}).${ORIGINAL_NOT_KEPT}`;
      }
    }
    try {
      await setPrivateItem(api, masterKey, id, priv); // the reservation (and the commitment's salt) first
    } catch (e) {
      // not saved: do not commit to something she could not open, and do not keep an original she could not find again
      priv = null;
      return finish(undefined, `We couldn’t save the private fingerprint of this file’s original (${(e as Error).message}).${wantsOriginal ? ORIGINAL_NOT_KEPT : ''} The file itself is added.`);
    }
    if (kept && priv) {
      const ciphertextSha256 = priv.originalPending!.ciphertextSha256;
      const save = async (item: PrivateItem): Promise<boolean> => {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            await setPrivateItem(api, masterKey, id, item);
            return true;
          } catch {
            /* try once more */
          }
        }
        return false;
      };
      let uploaded: string | undefined;
      try {
        uploaded = (await api.uploadBlob(kept.ct, kept.wrapped)).blob.id;
      } catch (e) {
        if (provablyNotStored(e)) {
          // the server refused it before storing anything: take the reservation back (if that fails it names no blob: harmless)
          priv = omitPending(priv);
          await setPrivateItem(api, masterKey, id, priv).catch(() => undefined);
          finalNote = `We couldn’t keep the original (${(e as Error).message}).${ORIGINAL_NOT_KEPT}`;
        } else {
          // a dropped connection or a timeout: the file may have arrived. The reservation stays; look, and say only what we know.
          const seen = await copyIsListed(api, ciphertextSha256);
          finalNote = `We couldn’t confirm the original was saved (${(e as Error).message}).${seen === false ? ORIGINAL_NOT_SEEN : ORIGINAL_MAY_BE_STORED + ORIGINAL_KEEP_ON_DEVICE}`;
        }
      }
      if (uploaded) {
        // 1. note the blob in the reservation as soon as the upload returns it, so even if the full link below fails her own
        //    record still says which blob this was (never inferred from what the server reports)
        const recorded: PrivateItem = { ...priv, originalPending: { ciphertextSha256, blobId: uploaded } };
        if (await save(recorded)) priv = recorded;
        // 2. link it
        const linked: PrivateItem = { ...omitPending(priv), originalBlobId: uploaded };
        if (await save(linked)) priv = linked;
        else finalNote = `We couldn’t finish keeping the original.${ORIGINAL_MAY_BE_STORED}${ORIGINAL_KEEP_ON_DEVICE}`;
      }
    }
  }
  return finish(commitment, finalNote);

  async function finish(c: string | undefined, pn: string | null): Promise<UploadedEvidence> {
    const e = await encryptForUpload(bytes, masterKey);
    const res = await api.uploadBlob(e.ct, e.wrapped, c);
    const item: EvidenceItem = {
      id,
      kind: evidenceKindFor(file, shot.likely),
      fileName: file.name,
      mimeType: blob.type || file.type || 'application/octet-stream',
      sizeBytes: bytes.byteLength,
      sha256,
      blobId: res.blob.id,
      description: opts.description || undefined,
      capturedAt: opts.capturedAt || undefined,
      metadataStripped: stripped,
    };
    return {
      item,
      details: priv,
      plaintext: new Blob([bytes as BlobPart], { type: item.mimeType }),
      note,
      warning: unstrippedWarning(item.mimeType, stripped),
      privateNote: pn,
      ledgerEntry: res.ledgerEntry,
      ...(res.commitmentEntry && { commitmentEntry: res.commitmentEntry }),
    };
  }
}
