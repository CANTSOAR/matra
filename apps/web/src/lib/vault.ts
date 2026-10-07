/**
 * Vault helpers: sealing / opening encrypted records, evidence upload, escrow.
 * Record payload (encrypted with encryptJSON under a per-record key wrapped by masterKey):
 *   { kind: 'draft' | 'final', draft?, record?, evidence?, escrowedHashes? }
 */
import {
  decryptBlob,
  decryptJSON,
  encryptBlob,
  encryptJSON,
  escrowIdentifierHash,
  generateContentKey,
  randomId,
  sha256Hex,
  unwrapKeyWithMaster,
  wrapKeyWithMaster,
} from '@matra/crypto';
import type { BlobMeta, EvidenceItem, EvidenceKind, IntakeRecord, LedgerEntry, VaultRecord } from '@matra/shared';
import { envelopeHash, type ApiClient } from '../api/client';
import type { IntakeDraft } from '../integration/intakeAdapter';
import { stripMetadata } from './metadata';

export interface VaultPayload {
  kind: 'draft' | 'final';
  draft?: IntakeDraft;
  record?: IntakeRecord;
  /** evidence attached while drafting (final records carry it in record.evidence) */
  evidence?: EvidenceItem[];
  /** escrow identifier hashes already lodged (so re-sealing doesn't duplicate them) */
  escrowedHashes?: string[];
  savedAt: string;
}

export interface OpenedRecord {
  meta: VaultRecord;
  payload: VaultPayload;
  key: CryptoKey;
  /** recomputed envelope hash matches the server's contentHash (and the ledger's, if fetched) */
  verified: boolean;
  ledgerEntry?: LedgerEntry;
  supersededBy?: string;
}

export async function sealPayload(api: ApiClient, masterKey: CryptoKey, payload: VaultPayload, supersedes?: string) {
  const key = await generateContentKey();
  const envelope = await encryptJSON(payload, key);
  const ownerWrappedKey = await wrapKeyWithMaster(key, masterKey);
  const res = await api.createRecord({ envelope, ownerWrappedKey, supersedes });
  return { ...res, key };
}

export async function openRecord(api: ApiClient, masterKey: CryptoKey, id: string, withLedger = true): Promise<OpenedRecord> {
  const { record } = await api.getRecord(id);
  const key = await unwrapKeyWithMaster(record.ownerWrappedKey, masterKey);
  const payload = await decryptJSON<VaultPayload>(record.envelope, key);
  const recomputed = await envelopeHash(record.envelope);
  let ledgerEntry: LedgerEntry | undefined;
  if (withLedger && record.ledgerEntryId) {
    try {
      ledgerEntry = (await api.getLedgerEntry(record.ledgerEntryId)).entry;
    } catch {
      /* ledger lookup optional */
    }
  }
  const verified = recomputed === record.contentHash && (!ledgerEntry || ledgerEntry.contentHash === recomputed);
  return { meta: record, payload, key, verified, ledgerEntry };
}

/** Load and decrypt every record in the vault, newest first, marking superseded versions. */
export async function loadVault(api: ApiClient, masterKey: CryptoKey): Promise<OpenedRecord[]> {
  const { records } = await api.listRecords();
  const opened = await Promise.all(records.map((r) => openRecord(api, masterKey, r.id).catch(() => null)));
  const list = opened.filter((x): x is OpenedRecord => !!x);
  const supersededBy = new Map<string, string>();
  for (const r of list) if (r.meta.supersedes) supersededBy.set(r.meta.supersedes, r.meta.id);
  for (const r of list) r.supersededBy = supersededBy.get(r.meta.id);
  return list.sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt));
}

export function latestOf(list: OpenedRecord[], kind: VaultPayload['kind']): OpenedRecord | undefined {
  return list.find((r) => r.payload.kind === kind && !r.supersededBy) ?? list.find((r) => r.payload.kind === kind);
}

export function finals(list: OpenedRecord[]): OpenedRecord[] {
  return list.filter((r) => r.payload.kind === 'final' && r.payload.record);
}

// ───────────── evidence ─────────────

export function evidenceKindFor(file: { type: string; name: string }): EvidenceKind {
  const t = file.type.toLowerCase();
  if (t.startsWith('image/')) return /screen\s?shot|screen_shot|screenshot/i.test(file.name) ? 'screenshot' : 'photo';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (t === 'application/pdf' || t.startsWith('text/') || t.includes('document')) return 'document';
  return 'other';
}

export interface UploadedEvidence {
  item: EvidenceItem;
  /** stripped plaintext, for an in-memory preview only */
  plaintext: Blob;
  note: string;
  ledgerEntry: LedgerEntry;
}

export async function uploadEvidence(
  api: ApiClient,
  masterKey: CryptoKey,
  file: File,
  extra: { description?: string; capturedAt?: string } = {},
): Promise<UploadedEvidence> {
  const { blob, stripped, note } = await stripMetadata(file);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const sha256 = await sha256Hex(bytes);
  const key = await generateContentKey();
  const ct = await encryptBlob(bytes, key);
  const wrapped = await wrapKeyWithMaster(key, masterKey);
  const res = await api.uploadBlob(ct, wrapped);
  const item: EvidenceItem = {
    id: randomId(),
    kind: evidenceKindFor(file),
    fileName: file.name,
    mimeType: blob.type || file.type || 'application/octet-stream',
    sizeBytes: bytes.byteLength,
    sha256,
    blobId: res.blob.id,
    description: extra.description || undefined,
    capturedAt: extra.capturedAt || undefined,
    metadataStripped: stripped,
  };
  return { item, plaintext: new Blob([bytes], { type: item.mimeType }), note, ledgerEntry: res.ledgerEntry };
}

/** Decrypt an evidence blob and check its SHA-256 against the recorded hash. */
export async function openEvidence(api: ApiClient, key: CryptoKey, blobId: string, expectedSha256?: string) {
  const ct = await api.downloadBlob(blobId);
  const pt = await decryptBlob(ct, key);
  const hash = await sha256Hex(pt);
  return { bytes: pt, hash, verified: expectedSha256 ? hash === expectedSha256 : undefined };
}

export async function blobKeyFor(meta: BlobMeta, masterKey: CryptoKey): Promise<CryptoKey> {
  return unwrapKeyWithMaster(meta.ownerWrappedKey, masterKey);
}

export function mergeEvidence(...lists: (EvidenceItem[] | undefined)[]): EvidenceItem[] {
  const out = new Map<string, EvidenceItem>();
  for (const l of lists) for (const e of l ?? []) out.set(e.blobId ?? e.id, e);
  return Array.from(out.values());
}

// ───────────── escrow ─────────────

/**
 * Lodge escrow hashes for every opted-in perpetrator identifier. Returns all hashes lodged so far.
 * The server always answers 'sealed' — survivors never see match results (anti-self-check). Matches are released
 * only as counts to a verified attorney she has an active share with.
 */
export async function lodgeEscrow(
  api: ApiClient,
  masterKey: CryptoKey,
  record: IntakeRecord,
  alreadyLodged: string[] = [],
): Promise<string[]> {
  const done = new Set(alreadyLodged);
  for (const p of record.perpetrators) {
    if (!p.escrowOptIn) continue;
    for (const id of p.identifiers) {
      if (!id.value?.trim()) continue;
      const hash = await escrowIdentifierHash(id.kind, id.value, id.platform);
      if (done.has(hash)) continue;
      const label = p.name?.trim() || `${id.kind.replace('_', ' ')}${id.platform ? ` (${id.platform})` : ''}`;
      // label encrypted directly with masterKey — only she can read it back
      const labelEnvelope = await encryptJSON({ label }, masterKey);
      await api.createEscrow({ identifierHash: hash, labelEnvelope });
      done.add(hash);
    }
  }
  return Array.from(done);
}

export async function escrowLabel(env: Parameters<typeof decryptJSON>[0], masterKey: CryptoKey): Promise<string> {
  try {
    return (await decryptJSON<{ label: string }>(env, masterKey)).label;
  } catch {
    return 'A person you named';
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function shortHash(h: string, n = 12): string {
  return h.length > n * 2 ? `${h.slice(0, n)}…${h.slice(-6)}` : h;
}
