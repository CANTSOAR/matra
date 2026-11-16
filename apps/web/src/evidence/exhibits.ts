/**
 * The exhibit list (PR 34): her files in the order she added them, numbered, with what a reader of the list needs: name,
 * date added, type, size and the salted fingerprint of the original. Built on her device from her own lists; exported as
 * CSV (and into the PDF through BriefOptions.exhibitFingerprints, and the data export zip).
 *
 * "Exhibit N" is only a position in her own list (so a redacted copy can say which file it was made from); it is not a court
 * exhibit number. A kept original (a second encrypted file) is not a separate exhibit: it belongs to the file it came from.
 */
import type { BlobMeta, EvidenceItem } from '@matra/shared';
import { EVIDENCE_KIND_LABELS } from '../brief/format';
import { formatBytes } from '../lib/vault';
import type { PrivateItem } from './privateStore';

export interface Exhibit {
  number: number;
  /** EvidenceItem.id */
  id: string;
  blobId: string;
  fileName: string;
  /** ISO time she added it (her device's clock when known, else when the server sealed it) */
  addedAt: string;
  kindLabel: string;
  mimeType: string;
  sizeBytes: number;
  /** the salted commitment to the original's hash; empty when none was made */
  fingerprint: string;
  description?: string;
  capturedAt?: string;
  screenshotLikely: boolean;
  /** the item id of the file this one is a redacted copy of */
  derivedFrom?: string;
  /** that file's exhibit number in THIS list (absent when the file is not in the list) */
  redactedCopyOf?: number;
  ocrText?: string;
}

type BlobLike = Pick<BlobMeta, 'id' | 'createdAt' | 'sizeBytes'>;

/**
 * THE numbering. Every place that shows or prints an exhibit number (the Evidence screen, the exhibit list and its CSV, the
 * data export, a redacted copy's label, the incident-summary PDF) takes it from this one function, called with the same
 * blobs, her files' details and her private details. Nothing else counts.
 *
 * Her files in the order the server sealed them (blobs arrive oldest first), numbered from 1. A blob that cannot be traced
 * to a file she has details for (another device saved its draft first, or an upload that was never finished) gets NO number
 * and is not listed: it is not one of her exhibits, so it must not take a number away from one. A kept original (a second
 * encrypted file) has no file details of its own, so it is never numbered either. A blob is hidden only for lacking a file
 * entry in HER encrypted details, never because of anything the server reports about it (its hash, size or time), so the
 * server cannot choose which of her files are listed. `derivedFrom` is turned into a number here, from this same list, so a
 * redacted copy always names the exhibit the reader sees.
 */
export function buildExhibits(
  blobs: readonly BlobLike[],
  items: readonly EvidenceItem[],
  priv: Readonly<Record<string, PrivateItem>>,
): Exhibit[] {
  const byBlob = new Map(items.filter((i) => i.blobId).map((i) => [i.blobId!, i]));
  const ordered = [...blobs].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
  const out: Exhibit[] = [];
  for (const b of ordered) {
    const item = byBlob.get(b.id);
    if (!item) continue;
    const p = priv[item.id];
    out.push({
      number: out.length + 1,
      id: item.id,
      blobId: b.id,
      fileName: item.fileName,
      addedAt: p?.importedAt || b.createdAt,
      kindLabel: EVIDENCE_KIND_LABELS[item.kind] ?? item.kind,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes || b.sizeBytes,
      fingerprint: p?.commitment ?? '',
      ...(item.description && { description: item.description }),
      ...(item.capturedAt && { capturedAt: item.capturedAt }),
      screenshotLikely: !!p?.screenshotLikely || item.kind === 'screenshot',
      ...(p?.derivedFrom && { derivedFrom: p.derivedFrom }),
      ...(p?.ocr?.text && { ocrText: p.ocr.text }),
    });
  }
  const numberOf = new Map(out.map((e) => [e.id, e.number]));
  return out.map((e) => {
    const n = e.derivedFrom ? numberOf.get(e.derivedFrom) : undefined;
    return n === undefined ? e : { ...e, redactedCopyOf: n };
  });
}

/** Stored file (blob id) -> exhibit number, for anything that prints a number beside a file (the PDF). */
export const exhibitNumbersByBlob = (list: readonly Exhibit[]): Record<string, number> => Object.fromEntries(list.map((e) => [e.blobId, e.number]));

export interface Numbering {
  exhibits: Exhibit[];
  /** file details that name a stored file the server did not list: not an exhibit, and not something to number around silently */
  missing: EvidenceItem[];
}

/** buildExhibits, plus the file details whose stored file is not in the server's list (so nobody renumbers around a gap unseen). */
export function numberExhibits(blobs: readonly BlobLike[], items: readonly EvidenceItem[], priv: Readonly<Record<string, PrivateItem>>): Numbering {
  const listed = new Set(blobs.map((b) => b.id));
  return { exhibits: buildExhibits(blobs, items, priv), missing: items.filter((i) => i.blobId && !listed.has(i.blobId)) };
}

/** Said, plainly, instead of a list or summary whose numbers could be wrong. */
export class MissingFilesError extends Error {
  readonly friendly = true;
  constructor(readonly names: string[]) {
    super(
      `We couldn’t find ${names.length === 1 ? 'a stored file' : 'some stored files'} that your story lists (${names.join(', ')}), so we can’t number your files reliably right now. Nothing was made. Please try again in a moment.`,
    );
    this.name = 'MissingFilesError';
  }
}

/** The commitments by item id, for the PDF's Evidence Inventory. */
export const fingerprintsById = (list: readonly Exhibit[]): Record<string, string> =>
  Object.fromEntries(list.filter((e) => e.fingerprint).map((e) => [e.id, e.fingerprint]));

/**
 * A cell that opens safely in a spreadsheet: quoted, and a leading = + - @ tab or CR (a formula, to a spreadsheet) is
 * neutralised with a leading apostrophe, so a file name cannot run anything on her screen or an advocate's.
 */
export function csvCell(v: string | number): string {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export const EXHIBIT_CSV_COLUMNS = ['Exhibit', 'File name', 'Date added', 'Type', 'Size', 'Salted fingerprint of the original'] as const;

/** The exhibit list as CSV: number, name, date added, type, size, salted-commitment fingerprint. CRLF line ends. */
export function exhibitListCsv(list: readonly Exhibit[]): string {
  const rows = list.map((e) => [e.number, e.fileName, e.addedAt, `${e.kindLabel} (${e.mimeType})`, `${formatBytes(e.sizeBytes)} (${e.sizeBytes} bytes)`, e.fingerprint]);
  return [EXHIBIT_CSV_COLUMNS.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') + '\r\n';
}

/** What a redacted copy of this exhibit is called, and what its description says. The original is not changed. */
export const redactedCopyLabel = (number: number): string => `Redacted copy of exhibit ${number}`;
export const redactedCopyDescription = (number: number): string => `${redactedCopyLabel(number)}. The original file is unchanged and is still in your space.`;
