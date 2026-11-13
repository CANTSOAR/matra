/**
 * Machine-readable verification data inside the incident summary PDF, for the in-browser checker (/verify).
 *
 * Stored as JSON in a custom entry of the PDF's document information dictionary (`/MatraVerification`, UTF-16 hex
 * string), which PDF readers keep but do not print. It holds only what the printed "Integrity & Chain of Custody" and
 * "Evidence Inventory" sections already show: the record id, the sealed record's ciphertext hash and ledger entry, and
 * each evidence file's name, size and SHA-256. The record ciphertext hash is also printed, so a PDF whose metadata was
 * stripped (printed and scanned, or re-saved by another program) can still be checked by typing it in.
 *
 * This is not a signature: anyone can edit a PDF, including this entry. The checker therefore says what it checks
 * (files against this list, the sealed account against the ledger) and that the printed words are checked in the
 * attorney portal, which decrypts the sealed account itself.
 */
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import type { IntakeRecord } from '@matra/shared';
import type { BriefOptions } from './types';

export const VERIFICATION_INFO_KEY = 'MatraVerification';
export { VERIFY_PATH, verifyPageUrl } from './format';

export interface SummaryVerification {
  v: 1;
  kind: 'matra-incident-summary';
  generatedAt: string;
  recordId?: string;
  /** SHA-256 hex of the sealed record ciphertext (the ledger's record.sealed contentHash) */
  recordContentHash?: string;
  ledgerEntryId?: string;
  ledgerSeq?: number;
  /** files as listed in the Evidence Inventory: SHA-256 of each file as sealed (after metadata removal) */
  evidence: Array<{ fileName: string; sha256: string; sizeBytes?: number }>;
}

export function summaryVerification(record: IntakeRecord, opts: BriefOptions, generatedAt: Date): SummaryVerification {
  return {
    v: 1,
    kind: 'matra-incident-summary',
    generatedAt: generatedAt.toISOString(),
    ...(opts.recordId && { recordId: opts.recordId }),
    ...((opts.recordContentHash ?? opts.ledgerEntry?.contentHash) && { recordContentHash: opts.recordContentHash ?? opts.ledgerEntry?.contentHash }),
    ...(opts.ledgerEntry && { ledgerEntryId: opts.ledgerEntry.id, ledgerSeq: opts.ledgerEntry.seq }),
    evidence: record.evidence
      .filter((e) => /^[0-9a-f]{64}$/.test(e.sha256))
      .map((e) => ({ fileName: e.fileName, sha256: e.sha256, sizeBytes: e.sizeBytes })),
  };
}

/** Write the verification JSON into the document information dictionary (call after the standard metadata). */
export function embedVerification(doc: PDFDocument, v: SummaryVerification): void {
  const info = doc.context.lookup(doc.context.trailerInfo.Info, PDFDict);
  info.set(PDFName.of(VERIFICATION_INFO_KEY), PDFHexString.fromText(JSON.stringify(v)));
}

const isHash = (h: unknown): h is string => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h);

/** Read it back from a PDF's bytes. null when the file is not a PDF, or carries no (well-formed) Matra entry. */
export async function readVerification(bytes: Uint8Array): Promise<SummaryVerification | null> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
    const info = doc.context.lookup(doc.context.trailerInfo.Info);
    if (!(info instanceof PDFDict)) return null;
    const raw = info.lookup(PDFName.of(VERIFICATION_INFO_KEY));
    if (!(raw instanceof PDFHexString) && !(raw instanceof PDFString)) return null;
    const v = JSON.parse(raw.decodeText()) as Partial<SummaryVerification>;
    if (v.v !== 1 || v.kind !== 'matra-incident-summary' || !Array.isArray(v.evidence)) return null;
    if (v.recordContentHash !== undefined && !isHash(v.recordContentHash)) return null;
    return {
      v: 1,
      kind: v.kind,
      generatedAt: String(v.generatedAt ?? ''),
      ...(typeof v.recordId === 'string' && { recordId: v.recordId }),
      ...(v.recordContentHash && { recordContentHash: v.recordContentHash }),
      ...(typeof v.ledgerEntryId === 'string' && { ledgerEntryId: v.ledgerEntryId }),
      ...(typeof v.ledgerSeq === 'number' && { ledgerSeq: v.ledgerSeq }),
      evidence: v.evidence
        .filter((e) => e && isHash(e.sha256))
        .map((e) => ({ fileName: String(e.fileName ?? 'file'), sha256: e.sha256, ...(typeof e.sizeBytes === 'number' && { sizeBytes: e.sizeBytes }) })),
    };
  } catch {
    return null;
  }
}
