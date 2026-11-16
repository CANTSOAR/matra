/**
 * Vault helpers: sealing / opening encrypted records, evidence upload. Sealed matching lives in lib/matching.ts; her
 * draft lives in its draft slot (lib/draftSlot.ts), never in a record.
 * Record payload (encrypted with encryptJSON under a per-record key wrapped by masterKey):
 *   { kind: 'final', record, savedAt }     her sealed account: exactly these three fields, nothing else, because
 *                                          sharing it with an attorney or releasing it to a counselor hands over the
 *                                          whole envelope
 *   { kind: 'profile', profile, savedAt }  her preferences
 * Records written before draft slots may also be { kind: 'draft', draft, evidence } (every autosave), or a 'final'
 * that also carries `draft` and `escrowedHashes`. They are WORM, so they stay; they are read only to resume an account
 * that has no draft slot yet, and are never shown as versions or shared (isCleanFinal).
 *
 * 'profile' records hold her personal preferences (e.g. the name she'd like to be called). They are encrypted like
 * every other record — the server never sees the name — and `loadVault` leaves them out by default, so screens that
 * work with drafts and sealed accounts never see them. Use getProfile / saveProfile below.
 */
import {
  decryptBlob,
  decryptBytes,
  encryptBlob,
  encryptJSON,
  generateContentKey,
  randomId,
  sha256Hex,
  unwrapKeyWithMaster,
  wrapKeyWithMaster,
} from '@matra/crypto';
import type { BlobMeta, EvidenceItem, EvidenceKind, IntakeRecord, LedgerEntry, VaultRecord, VaultRecordMeta } from '@matra/shared';
import { ApiError, envelopeHash, type ApiClient } from '../api/client';
import type { IntakeDraft } from '../integration/intakeAdapter';
import { stripMetadata } from './metadata';
import { loadDraftSlot, withoutMatchingAnswers, type DraftSlotState, type LoadedDraftSlot } from './draftSlot';
import type { WorkingData } from './session';
import { mirror, typedText } from '../dev/mirror';

/** Her personal preferences, stored only inside an encrypted 'profile' vault record. */
export interface VaultProfile {
  /** What she'd like to be called in the app. Optional; any nickname. Never sent to the server in plaintext. */
  preferredName?: string;
  updatedAt: string;
}

/** A record's decrypted payload, as written now or by an earlier version of the app. */
export interface VaultPayload {
  kind: 'draft' | 'final' | 'profile';
  profile?: VaultProfile;
  record?: IntakeRecord;
  savedAt: string;
  /** legacy only (written before draft slots): her answers, in a 'draft' record or alongside a sealed 'final' */
  draft?: IntakeDraft;
  /** legacy only: evidence details in a 'draft' record (final records carry them in record.evidence) */
  evidence?: EvidenceItem[];
  /** legacy only: fingerprints of identifiers sealed for matching (now kept in the draft slot) */
  escrowedHashes?: string[];
}

/** What may be sealed as a record now: her sealed account or her preferences. Drafts go to the draft slot. */
export type SealPayload =
  | { kind: 'final'; record: IntakeRecord; savedAt: string }
  | { kind: 'profile'; profile: VaultProfile; savedAt: string };

/**
 * The exact plaintext of a sealed record: only the fields of its kind, so nothing else (her draft, unsent words, matching
 * fingerprints) can ever ride along into an envelope she may later share.
 */
function sealedPlaintext(p: SealPayload): SealPayload {
  if (p.kind === 'final') {
    if (!p.record) throw new Error('A sealed account needs its record.');
    return { kind: 'final', record: p.record, savedAt: p.savedAt };
  }
  if (p.kind === 'profile') return { kind: 'profile', profile: p.profile, savedAt: p.savedAt };
  throw new Error('Only a sealed account or preferences can be sealed; drafts are saved to the draft slot.');
}

const CLEAN_FINAL_KEYS = new Set(['kind', 'record', 'savedAt']);

/**
 * Whether this sealed version holds only her account (`{kind, record, savedAt}`), so it may be shared or released. One
 * sealed before draft slots may also hold her draft and matching fingerprints; it is never shared, and she seals again.
 */
export function isCleanFinal(payload: VaultPayload): boolean {
  return payload.kind === 'final' && !!payload.record && Object.keys(payload).every((k) => CLEAN_FINAL_KEYS.has(k));
}

/** Shown instead of sharing a sealed version saved before draft slots (it also holds her draft). */
export const LEGACY_FINAL_NOTICE =
  'Your sealed account was saved in an older format that also keeps your working notes with it. To share only your account, open My story and seal it again first. The earlier version stays as it was.';

export interface OpenedRecord {
  meta: VaultRecord;
  payload: VaultPayload;
  key: CryptoKey;
  /**
   * recomputed envelope hash matches the server's contentHash (and the ledger's, if fetched). Always true now: a record
   * that doesn't match is never opened (loadVault fails closed, or leaves it out with `allowPartial`).
   */
  verified: boolean;
  ledgerEntry?: LedgerEntry;
  supersededBy?: string;
}

export async function sealPayload(api: ApiClient, masterKey: CryptoKey, input: SealPayload, supersedes?: string) {
  const payload = sealedPlaintext(input);
  const key = await generateContentKey();
  const envelope = await encryptJSON(payload, key);
  const ownerWrappedKey = await wrapKeyWithMaster(key, masterKey);
  mirror(
    payload.kind === 'final' ? 'Her story (sealed)' : 'Her preferences',
    typedText(payload.kind === 'final' ? payload.record : payload),
    `Encrypted here (AES-256-GCM, a new key per version). The server gets the envelope (${envelope.ct.length} base64 characters), the key wrapped by her own key, and a hash.`,
  );
  const res = await api.createRecord({ envelope, ownerWrappedKey, supersedes });
  return { ...res, key };
}

// ───────────── loading her space: fail closed ─────────────

/**
 * Why part of her space couldn't be used (PR 6, "loadVault fails closed"):
 *   unavailable  a request didn't get through (network, server error): "couldn't reach us"
 *   integrity    it came back but doesn't match what she saved: "doesn't match what you saved"
 *     gcm          the record's key or ciphertext doesn't decrypt under her key (AES-GCM authentication failed)
 *     hash         the envelope's SHA-256 differs from the content hash the server stored or listed
 *     ledger       the ledger entry the record names is missing, or attests a different hash, subject or type
 *     shape        it decrypts, but isn't a record (or draft) this app wrote
 *   missing      something her space points to isn't served: a listed record the server won't return, a record a
 *                listed one supersedes, or the sealed version her draft says it became. A cheap check for records the
 *                server leaves out of the list; it can't see one nothing points to (that needs envelope v2's
 *                per-account sequence, PR 4, as do the aad, commit and sig reasons).
 */
export type VaultProblemKind = 'unavailable' | 'integrity' | 'missing';
export type IntegrityReason = 'gcm' | 'hash' | 'ledger' | 'shape';
export interface VaultProblem {
  kind: VaultProblemKind;
  /** integrity only */
  reason?: IntegrityReason;
  /** the record id, 'list' (the list itself), or DRAFT_PROBLEM_ID (her draft slot) */
  id: string;
}
export const DRAFT_PROBLEM_ID = 'draft';

/**
 * Her space didn't load cleanly, so nothing is shown as complete or saved on top of it. The message is the calm copy
 * for the worst problem (friendlyError shows it as is). VaultIntegrityError and VaultUnavailableError say which.
 */
export class UnreadableVaultError extends Error {
  readonly friendly = true;
  constructor(
    readonly problems: VaultProblem[],
    message: string,
  ) {
    super(message);
    this.name = 'UnreadableVaultError';
  }
  /** how many things didn't load */
  get unreadable(): number {
    return this.problems.length;
  }
}
/** Something came back but doesn't match what she saved (integrity or missing). */
export class VaultIntegrityError extends UnreadableVaultError {
  constructor(problems: VaultProblem[]) {
    super(problems, VAULT_INTEGRITY_STOP);
    this.name = 'VaultIntegrityError';
  }
}
/** A request didn't get through; trying again later may be all it takes. */
export class VaultUnavailableError extends UnreadableVaultError {
  constructor(problems: VaultProblem[]) {
    super(problems, VAULT_UNAVAILABLE_STOP);
    this.name = 'VaultUnavailableError';
  }
}

/** Shown instead of a screen that would show or save from her space, when part of it didn't match what she saved. */
export const VAULT_INTEGRITY_STOP =
  'Something stored for your space doesn’t match what you saved, so we stopped here rather than show it or save over it. Nothing was changed. You could try again, or sign out and back in. If this keeps happening, Home still shows what did open, and you can download a copy of it there.';
/** Shown instead of such a screen when part of her space couldn't be fetched. */
export const VAULT_UNAVAILABLE_STOP =
  'We couldn’t reach Matra to open all of your space just now, so we stopped here rather than show you something older than your newest save. Nothing was changed. Check your connection, then try again in a moment.';

/** The error for these problems: integrity wins over unavailable, since trying again won't fix it. */
export function vaultError(problems: VaultProblem[]): UnreadableVaultError {
  return problems.some((p) => p.kind !== 'unavailable') ? new VaultIntegrityError(problems) : new VaultUnavailableError(problems);
}

/**
 * A banner for read-only screens that load with `allowPartial` (Home, Download my data): what is left out and why.
 * Null when nothing is.
 */
export function vaultProblemNotice(problems: VaultProblem[] | undefined): string | null {
  const ps = problems ?? [];
  if (!ps.length) return null;
  const versions = (list: VaultProblem[]) => list.filter((p) => p.id !== DRAFT_PROBLEM_ID).length;
  const what = (list: VaultProblem[]) => {
    const n = versions(list);
    const draft = list.some((p) => p.id === DRAFT_PROBLEM_ID);
    const v = n === 0 ? '' : n === 1 ? 'one saved version of your space' : `${n} saved versions of your space`;
    return [v, draft ? 'your draft' : ''].filter(Boolean).join(' and ');
  };
  const bad = ps.filter((p) => p.kind !== 'unavailable');
  const away = ps.filter((p) => p.kind === 'unavailable');
  const parts: string[] = [];
  if (bad.length) {
    const many = versions(bad) + (bad.some((p) => p.id === DRAFT_PROBLEM_ID) ? 1 : 0) > 1;
    parts.push(`${cap(what(bad))} ${many ? 'don’t' : 'doesn’t'} match what you saved, so ${many ? 'they are' : 'it is'} left out here. Nothing was changed.`);
  }
  if (away.length) parts.push(`We couldn’t reach Matra to open ${what(away)} just now.`);
  parts.push('What you see here may not be your newest save. You could try again in a moment, or sign out and back in.');
  return parts.join(' ');
}
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * A failed request, as a problem. A signed-out session (401) isn't one: it is thrown as it is. A 404/403 is `missing`
 * only for a record the server listed (it listed it, then won't serve it). On the list or her draft's route it can't
 * mean that (the draft route answers 200 with null when she has none), so it is a misrouted proxy or a deploy in
 * progress: `unavailable`, with the "couldn't reach us" copy.
 */
function requestProblem(e: unknown, id: string, listedRecord = false): VaultProblem {
  if (e instanceof ApiError) {
    if (e.status === 401) throw e;
    if (listedRecord && (e.status === 404 || e.status === 403)) return { kind: 'missing', id };
  }
  return { kind: 'unavailable', id };
}

/** Worth one more try: no answer, a server error, rate limiting, or a reply that wasn't ours (a captive portal). */
function transient(e: unknown): boolean {
  if (!(e instanceof ApiError)) return true;
  return e.status === 0 || e.status === 429 || e.status >= 500;
}
/** Wait before trying a dropped request again (exported for tests). */
export const RETRY_DELAY_MS = { value: 400 };
/** One dropped request on a flaky phone network shouldn't stop a whole screen: try a transient failure once more. */
async function retryOnce<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (!transient(e)) throw e;
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS.value));
    return f();
  }
}
/** Run `f` over `items` with at most `limit` in flight (her space can hold hundreds of records). */
async function mapLimit<T, R>(items: T[], limit: number, f: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const k = next++;
        out[k] = await f(items[k]!);
      }
    }),
  );
  return out;
}

const PAYLOAD_KINDS = new Set(['draft', 'final', 'profile']);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A payload this app (or an earlier version of it) wrote. */
function isVaultPayload(p: unknown): p is VaultPayload {
  if (!isObject(p) || typeof p.kind !== 'string' || !PAYLOAD_KINDS.has(p.kind) || typeof p.savedAt !== 'string') return false;
  if (p.kind === 'final') return isObject(p.record);
  if (p.kind === 'profile') return isObject(p.profile);
  // a legacy draft record, or (MATRA_DRAFT_MODE=keep-versions) a draft slot kept as a record
  return isObject(p.draft) || Array.isArray(p.evidence);
}

/**
 * Fetch, decrypt and check one record: the envelope opens under her key, it is a payload this app wrote, its hash is
 * the one the server listed and stored, and (withLedger) the ledger entry it names attests that hash for this record.
 */
async function checkRecord(api: ApiClient, masterKey: CryptoKey, listed: VaultRecordMeta, withLedger: boolean): Promise<OpenedRecord | VaultProblem> {
  const id = listed.id;
  const integrity = (reason: IntegrityReason): VaultProblem => ({ kind: 'integrity', reason, id });
  let record: VaultRecord;
  try {
    record = (await retryOnce(() => api.getRecord(id))).record;
  } catch (e) {
    return requestProblem(e, id, true);
  }
  if (!isObject(record) || record.id !== id || !isObject(record.envelope) || !isObject(record.ownerWrappedKey)) return integrity('shape');
  let bytes: Uint8Array;
  let key: CryptoKey;
  try {
    key = await unwrapKeyWithMaster(record.ownerWrappedKey, masterKey);
    bytes = await decryptBytes(record.envelope, key);
  } catch {
    return integrity('gcm');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return integrity('shape');
  }
  if (!isVaultPayload(payload)) return integrity('shape');
  const recomputed = await envelopeHash(record.envelope);
  if (recomputed !== record.contentHash || recomputed !== listed.contentHash) return integrity('hash');
  let ledgerEntry: LedgerEntry | undefined;
  if (withLedger) {
    try {
      ledgerEntry = (await retryOnce(() => api.getLedgerEntry(record.ledgerEntryId))).entry;
    } catch (e) {
      const p = requestProblem(e, id, true);
      return p.kind === 'missing' ? integrity('ledger') : p;
    }
    if (!ledgerEntry || ledgerEntry.contentHash !== recomputed || ledgerEntry.subjectId !== id || ledgerEntry.type !== 'record.sealed')
      return integrity('ledger');
  }
  return { meta: record, payload, key, verified: true, ledgerEntry };
}

const isProblem = (x: OpenedRecord | VaultProblem): x is VaultProblem => 'kind' in x && !('payload' in x);

/** Open one record, checked like loadVault does; throws VaultIntegrityError / VaultUnavailableError if it doesn't pass. */
export async function openRecord(api: ApiClient, masterKey: CryptoKey, id: string, withLedger = true): Promise<OpenedRecord> {
  const { records } = await api.listRecords();
  const listed = records.find((r) => r.id === id);
  if (!listed) throw vaultError([{ kind: 'missing', id }]);
  const r = await checkRecord(api, masterKey, listed, withLedger);
  if (isProblem(r)) throw vaultError([r]);
  return r;
}

/**
 * The opened records, newest first, plus what didn't pass (`problems`; `unreadable` is how many). Only with
 * `allowPartial` can there be any: those records are left out, so whatever is "latest" may be an older version.
 * `listed` is every id the server listed.
 */
export type LoadedVault = OpenedRecord[] & { problems: VaultProblem[]; unreadable: number; listed: string[] };

export interface LoadVaultOptions {
  /** include 'profile' (preferences) records; left out by default */
  includeProfile?: boolean;
  /** check each record's ledger entry (default true) */
  withLedger?: boolean;
  /**
   * Read-only screens only (Home, Download my data, her preferences): return what did pass, with `problems`, instead of
   * throwing. Anything that saves, seals, shares or resumes loads without it: writes require a clean load.
   */
  allowPartial?: boolean;
}

/**
 * Load, decrypt and check every record in the vault, newest first, marking superseded versions. Fails closed: if any
 * record doesn't pass (see VaultProblem), throws VaultIntegrityError or VaultUnavailableError, unless `allowPartial`.
 * A list request that fails always throws (there is nothing to show).
 */
export async function loadVault(
  api: ApiClient,
  masterKey: CryptoKey,
  { includeProfile = false, withLedger = true, allowPartial = false }: LoadVaultOptions = {},
): Promise<LoadedVault> {
  let records: VaultRecordMeta[];
  try {
    records = (await retryOnce(() => api.listRecords())).records;
  } catch (e) {
    throw vaultError([requestProblem(e, 'list')]);
  }
  const results = await mapLimit(records, 6, (r) => checkRecord(api, masterKey, r, withLedger));
  const problems = results.filter(isProblem);
  // a record names an earlier version the server didn't list (the server checks supersedes is hers when it is saved)
  const ids = new Set(records.map((r) => r.id));
  for (const r of records) if (r.supersedes && !ids.has(r.supersedes)) problems.push({ kind: 'missing', id: r.supersedes });
  if (problems.length && !allowPartial) throw vaultError(problems);
  const list = results.filter((x): x is OpenedRecord => !isProblem(x) && (includeProfile || x.payload.kind !== 'profile'));
  const supersededBy = new Map<string, string>();
  for (const r of list) if (r.meta.supersedes) supersededBy.set(r.meta.supersedes, r.meta.id);
  for (const r of list) r.supersededBy = supersededBy.get(r.meta.id);
  list.sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt));
  return Object.assign(list, { problems, unreadable: problems.length, listed: records.map((r) => r.id) });
}

/** Her records and her draft slot, loaded together and checked against each other. */
export interface LoadedSpace {
  vault: LoadedVault;
  slot: DraftSlotState;
  /** everything that didn't pass, records and draft (empty unless `allowPartial`) */
  problems: VaultProblem[];
}

/**
 * loadVault plus her draft slot (lib/draftSlot.ts), failing closed the same way. The draft counts: a slot that is stored
 * but doesn't open is an integrity problem, one that can't be fetched is unavailable, and a draft marked as the source
 * of a sealed version the server didn't list is `missing` (it hid her newest seal).
 */
export async function loadSpace(api: ApiClient, masterKey: CryptoKey, opts: LoadVaultOptions = {}): Promise<LoadedSpace> {
  return loadSpaceOnce(api, masterKey, opts, false);
}

async function loadSpaceOnce(api: ApiClient, masterKey: CryptoKey, opts: LoadVaultOptions, again: boolean): Promise<LoadedSpace> {
  const [vault, slotOrProblem] = await Promise.all([
    loadVault(api, masterKey, { ...opts, allowPartial: true }),
    retryOnce(() => loadDraftSlot(api, masterKey)).catch((e: unknown) => requestProblem(e, DRAFT_PROBLEM_ID)),
  ]);
  const problems = [...vault.problems];
  let slot: DraftSlotState;
  if ('kind' in slotOrProblem && !('slot' in slotOrProblem)) {
    problems.push(slotOrProblem);
    // not known: nothing may be saved over it
    slot = { slot: null, unreadable: true, version: null, draftMode: 'slot' };
  } else {
    slot = slotOrProblem as DraftSlotState;
    if (slot.unreadable) problems.push({ kind: 'integrity', reason: slot.unreadableReason ?? 'gcm', id: DRAFT_PROBLEM_ID });
    const sealedId = slot.slot?.value.sealedRecordId;
    if (sealedId && !vault.listed.includes(sealedId)) {
      // Another tab may have sealed between this list and this draft read: list once more, and if it is there now,
      // load again rather than calling it a mismatch.
      if (!again) {
        const now = await retryOnce(() => api.listRecords()).catch(() => null);
        if (now?.records.some((r) => r.id === sealedId)) return loadSpaceOnce(api, masterKey, opts, true);
      }
      problems.push({ kind: 'missing', id: sealedId });
    }
  }
  if (problems.length && !opts.allowPartial) throw vaultError(problems);
  return { vault, slot, problems };
}

export function latestOf(list: OpenedRecord[], kind: VaultPayload['kind']): OpenedRecord | undefined {
  return list.find((r) => r.payload.kind === kind && !r.supersededBy) ?? list.find((r) => r.payload.kind === kind);
}

export function finals(list: OpenedRecord[]): OpenedRecord[] {
  return list.filter((r) => r.payload.kind === 'final' && r.payload.record);
}

/** Where she picks her story back up, and what goes with it. */
export interface ResumePoint {
  draft?: IntakeDraft;
  /** file details to keep with the draft (the sealed version's are merged in by the caller) */
  evidence: EvidenceItem[];
  /** her latest sealed version, if any */
  final?: OpenedRecord;
  /** sealed matching on: fingerprints already sealed */
  escrowedHashes: string[];
  /** where it came from: her draft slot, or (an account with no slot yet) the records saved before slots */
  from: 'slot' | 'legacy' | 'none';
}

/**
 * Where to pick the intake back up: her draft slot. It is kept after sealing, so adding evidence or a detail after
 * sealing never means starting over. An account with no slot yet (it last saved before draft slots) resumes from those
 * records instead: the newest legacy draft record if it is newer than the latest seal, otherwise the answers a legacy
 * seal kept beside it. Its next save then makes the slot. Matching answers and fingerprints are dropped in a build
 * without sealed matching (draftSlot.ts withoutMatchingAnswers).
 */
export function resumeFrom(slot: LoadedDraftSlot | null, list: OpenedRecord[]): ResumePoint {
  const final = latestOf(list, 'final');
  const legacyEscrowed = final?.payload.escrowedHashes ?? [];
  const forBuild = (r: ResumePoint): ResumePoint =>
    __MATRA_MATCHING__ ? r : { ...r, draft: r.draft && withoutMatchingAnswers(r.draft), escrowedHashes: [] };
  if (slot)
    return forBuild({
      draft: slot.value.draft,
      evidence: slot.value.evidence,
      final,
      escrowedHashes: slot.value.escrowedHashes ?? legacyEscrowed,
      from: 'slot',
    });
  const draftRecord = latestOf(list, 'draft');
  const draftIsNewer = !!draftRecord && !draftRecord.supersededBy && (!final || draftRecord.meta.createdAt > final.meta.createdAt);
  const draft = (draftIsNewer ? draftRecord.payload.draft : undefined) ?? final?.payload.draft;
  return forBuild({
    draft,
    evidence: (draftIsNewer ? draftRecord.payload.evidence : undefined) ?? [],
    final,
    escrowedHashes: legacyEscrowed,
    from: draft ? 'legacy' : 'none',
  });
}

/** File details an older draft record kept (legacy), so a file added then still has its name. */
export function legacyDraftEvidence(list: OpenedRecord[]): EvidenceItem[] {
  return list.filter((r) => r.payload.kind === 'draft').flatMap((r) => r.payload.evidence ?? []);
}

// ───────────── profile (preferences) ─────────────

/** The latest encrypted profile record, if she has one. */
export async function getProfile(api: ApiClient, masterKey: CryptoKey): Promise<{ profile: VaultProfile; recordId: string } | null> {
  // Read-only: an older name is shown at worst. Saving a new one doesn't build on the old (it replaces it).
  const list = await loadVault(api, masterKey, { includeProfile: true, withLedger: false, allowPartial: true });
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
  mirror(
    'Evidence file',
    `${file.name} (${formatBytes(bytes.byteLength)}${stripped ? ', location and camera data removed here' : ''})`,
    `Encrypted here. The server gets ${formatBytes(ct.byteLength)} of ciphertext and its hash; not the file name.`,
  );
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

/**
 * The story's working copy, plus any files the in-memory working data has that it doesn't (details saved by the
 * Evidence page after the story opened). Her draft stays the story's own; the slot version follows the newer save.
 * Returns null when there is nothing new.
 */
export function foldInLateEvidence(story: WorkingData, mem: WorkingData | null): WorkingData | null {
  if (!mem) return null;
  const known = new Set(story.evidence.map((e) => e.blobId ?? e.id));
  if (mem.evidence.every((e) => known.has(e.blobId ?? e.id))) return null;
  return {
    ...story,
    evidence: mergeEvidence(story.evidence, mem.evidence),
    slotVersion: mem.slotVersion !== undefined ? mem.slotVersion : story.slotVersion,
  };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function shortHash(h: string, n = 12): string {
  return h.length > n * 2 ? `${h.slice(0, n)}…${h.slice(-6)}` : h;
}
