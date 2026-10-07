/**
 * Vault helpers: sealing / opening encrypted records, evidence upload, escrow.
 * Record payload (encrypted with encryptJSON under a per-record key wrapped by masterKey):
 *   { kind: 'draft' | 'final' | 'profile', draft?, record?, evidence?, escrowedHashes?, profile? }
 *
 * 'profile' records hold her personal preferences (e.g. the name she'd like to be called). They are encrypted like
 * every other record — the server never sees the name — and `loadVault` leaves them out by default, so screens that
 * work with drafts and sealed accounts never see them. Use getProfile / saveProfile below.
 */
import {
  decryptBlob,
  decryptJSON,
  encryptBlob,
  encryptJSON,
  normalizeMatchIdentifier,
  submitMatchEntry,
  generateContentKey,
  randomId,
  sha256Hex,
  unwrapKeyWithMaster,
  wrapKeyWithMaster,
} from '@matra/crypto';
import type { BlobMeta, EvidenceItem, EvidenceKind, IntakeRecord, LedgerEntry, MatchContactPreferences, VaultRecord } from '@matra/shared';
import { envelopeHash, type ApiClient } from '../api/client';
import type { IntakeDraft } from '../integration/intakeAdapter';
import { stripMetadata } from './metadata';

/** Her personal preferences, stored only inside an encrypted 'profile' vault record. */
export interface VaultProfile {
  /** What she'd like to be called in the app. Optional; any nickname. Never sent to the server in plaintext. */
  preferredName?: string;
  updatedAt: string;
}

export interface VaultPayload {
  kind: 'draft' | 'final' | 'profile';
  profile?: VaultProfile;
  draft?: IntakeDraft;
  record?: IntakeRecord;
  /** evidence attached while drafting (final records carry it in record.evidence) */
  evidence?: EvidenceItem[];
  /** local fingerprints of identifiers already sealed for matching (so re-sealing doesn't resubmit or undo a withdrawal) */
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

/**
 * Load and decrypt every record in the vault, newest first, marking superseded versions.
 * Profile (preferences) records are left out unless `includeProfile` is set.
 */
export async function loadVault(
  api: ApiClient,
  masterKey: CryptoKey,
  { includeProfile = false, withLedger = true }: { includeProfile?: boolean; withLedger?: boolean } = {},
): Promise<OpenedRecord[]> {
  const { records } = await api.listRecords();
  const opened = await Promise.all(records.map((r) => openRecord(api, masterKey, r.id, withLedger).catch(() => null)));
  const list = opened.filter((x): x is OpenedRecord => !!x && (includeProfile || x.payload.kind !== 'profile'));
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

/**
 * Where to pick the intake back up: a vault draft saved after the latest seal, otherwise the answers of the latest
 * sealed version (so adding evidence or a detail after sealing never means starting over).
 */
export function resumeFrom(list: OpenedRecord[]): { draft?: IntakeDraft; draftRecord?: OpenedRecord; final?: OpenedRecord } {
  const final = latestOf(list, 'final');
  const draftRecord = latestOf(list, 'draft');
  const draftIsNewer = !!draftRecord && !draftRecord.supersededBy && (!final || draftRecord.meta.createdAt > final.meta.createdAt);
  return {
    draft: (draftIsNewer ? draftRecord.payload.draft : undefined) ?? final?.payload.draft,
    draftRecord: draftIsNewer ? draftRecord : undefined,
    final,
  };
}

// ───────────── profile (preferences) ─────────────

/** The latest encrypted profile record, if she has one. */
export async function getProfile(api: ApiClient, masterKey: CryptoKey): Promise<{ profile: VaultProfile; recordId: string } | null> {
  const list = await loadVault(api, masterKey, { includeProfile: true, withLedger: false });
  const r = latestOf(list, 'profile');
  return r?.payload.profile ? { profile: r.payload.profile, recordId: r.meta.id } : null;
}

/** Encrypt and save her preferences as a new profile record (superseding the previous one, if any). */
export async function saveProfile(
  api: ApiClient,
  masterKey: CryptoKey,
  input: { preferredName?: string },
  supersedes?: string,
): Promise<{ profile: VaultProfile; recordId: string }> {
  const name = input.preferredName?.trim().slice(0, 60);
  const profile: VaultProfile = { ...(name && { preferredName: name }), updatedAt: new Date().toISOString() };
  const res = await sealPayload(api, masterKey, { kind: 'profile', profile, savedAt: profile.updatedAt }, supersedes);
  return { profile, recordId: res.record.id };
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

// ───────────── sealed matching (escrow) ─────────────

const ESCROW_KIND_LABEL: Record<string, string> = {
  email: 'email',
  phone: 'phone number',
  social: 'social media handle',
};

/**
 * The explanation she agrees to when she opts in. Stored verbatim (encrypted) in her contact bundle, so the counselor
 * sees exactly what she was told.
 */
export const MATCHING_CONSENT_STATEMENT =
  'If someone else names the same person, a trained legal options counselor — not the police, not your school — will ' +
  'reach out privately to talk about your options. You decide everything after that. Names are not used for matching. ' +
  'You will never see a match in this app. You can withdraw a sealed identifier at any time.';

/** How she said a counselor may reach her (the intake's person.matchContact answer). */
export interface MatchContactInput {
  method?: string;
  detail?: string;
  notes?: string;
}

/** Build contact preferences from her explicit answer, falling back to the safe-contact details in her record. */
export function matchContactFrom(record: IntakeRecord, input?: MatchContactInput): MatchContactPreferences | null {
  const s = record.survivor;
  const base = {
    ...(s.preferredName && { name: s.preferredName }),
    ...(s.preferredLanguage && { language: s.preferredLanguage }),
  };
  const detail = input?.detail?.trim();
  if (input?.method && detail) {
    const notes = input.notes?.trim() || s.safeContactNotes;
    const n = notes ? { notes } : {};
    if (input.method === 'email') return detail.includes('@') ? { ...base, ...n, methods: ['email'], email: detail } : null;
    if (input.method === 'phone' || input.method === 'call') return { ...base, ...n, methods: ['call'], phone: detail };
    if (input.method === 'text') return { ...base, ...n, methods: ['text'], phone: detail };
  }
  const methods: MatchContactPreferences['methods'] = [];
  if (s.phone && s.safeContact?.phone) methods.push('call');
  if (s.phone && s.safeContact?.text) methods.push('text');
  if (s.phone && s.safeContact?.voicemail) methods.push('voicemail');
  if (s.email && s.safeContact?.email) methods.push('email');
  if (!methods.length) return null;
  return {
    ...base,
    methods,
    ...(methods.some((m) => m !== 'email') && s.phone && { phone: s.phone }),
    ...(methods.includes('email') && s.email && { email: s.email }),
    ...(s.safeContactNotes && { notes: s.safeContactNotes }),
  };
}

export class MatchingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MatchingError';
  }
}

/** Local (vault-only) fingerprint of a canonical identifier, for de-duplication. Never sent to the server. */
const localKey = (canonical: string) => sha256Hex(`matra/match/v1/local|${canonical}`);

/**
 * Seal every opted-in perpetrator identifier for sealed matching (Callisto-style; see packages/crypto/src/matching.ts).
 * Names are never used. Returns the local fingerprints sealed so far (store them in the 'final' payload as
 * `escrowedHashes` — they are only ever kept encrypted in her own vault).
 *
 * `opts.contact` is how a legal options counselor may reach her if there is a match; without it, her safe-contact
 * details from the record are used. With neither, nothing is sealed and a MatchingError explains why.
 * The server always answers 'sealed' — survivors never see match results (anti-self-check).
 */
export async function lodgeEscrow(
  api: ApiClient,
  masterKey: CryptoKey,
  record: IntakeRecord,
  alreadyLodged: string[] = [],
  opts: { contact?: MatchContactInput; consentStatement?: string } = {},
): Promise<string[]> {
  const done = new Set(alreadyLodged);
  const todo: Array<{ label: string; id: Extract<ReturnType<typeof normalizeMatchIdentifier>, { ok: true }>; key: string }> = [];
  for (const p of record.perpetrators) {
    if (!p.escrowOptIn) continue;
    for (const raw of p.identifiers) {
      const id = normalizeMatchIdentifier(raw.kind, raw.value, raw.platform);
      if (!id.ok) continue; // names and unrecognised text are never sealed
      const key = await localKey(id.canonical);
      if (done.has(key) || todo.some((t) => t.key === key)) continue;
      const label = `${p.name?.trim() || 'A person you named'} · ${ESCROW_KIND_LABEL[id.kind] ?? 'identifier'}${id.platform ? ` (${id.platform})` : ''}`;
      todo.push({ label, id, key });
    }
  }
  if (!todo.length) return Array.from(done);
  const contact = matchContactFrom(record, opts.contact);
  if (!contact)
    throw new MatchingError('To use a sealed match, add a safe way for a legal options counselor to reach you (a phone number or email).');
  const config = await api.matchingConfig();
  if (!config.counselors.length) throw new MatchingError('Sealed matching isn’t available right now. Nothing was sealed.');
  const transport = {
    config: async () => config,
    evaluate: (h: 'a' | 'b', req: { blinded: string }) => api.oprfEvaluate(h, req),
    createEntry: (req: Parameters<ApiClient['createMatchEntry']>[0]) => api.createMatchEntry(req),
  };
  for (const t of todo) {
    // Her label keeps the canonical identifier (encrypted to her alone) so she can re-seal after a key rotation.
    const labelEnvelope = await encryptJSON({ label: t.label, canonical: t.id.canonical }, masterKey);
    try {
      await submitMatchEntry(transport, {
        masterKey,
        identifier: t.id,
        contact,
        consentStatement: opts.consentStatement ?? MATCHING_CONSENT_STATEMENT,
        state: record.incident.jurisdiction?.state ?? record.survivor.residenceState,
        labelEnvelope,
        config,
      });
    } catch (e) {
      if ((e as { code?: string }).code !== 'already_sealed') throw e;
    }
    done.add(t.key);
  }
  return Array.from(done);
}

/** Withdraw (delete) one of her sealed identifiers. */
export async function withdrawEscrow(api: ApiClient, entryId: string): Promise<void> {
  await api.withdrawMatchEntry(entryId);
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
