/**
 * Sealing her story, in an order that can never lose her words (My story, screens/Story.tsx):
 *
 *   1. Save the exact draft being sealed to her draft slot, with compare-and-swap. If that fails (another device or tab
 *      saved since: SlotConflictError; anything else: DraftNotSavedError), nothing is sealed and she is told.
 *   2. (Sealed matching on) lodge the identifiers she chose; the fingerprints come back.
 *   3. Seal the record: a WORM 'final' holding only {kind, record, savedAt}.
 *   4. Mark the slot with the sealed record's id (and the new fingerprints), retrying once. If that still fails, the
 *      result says so (`marked: false`) and the caller keeps her working copy and keeps saving it: her slot already
 *      holds every word from step 1, so nothing she sealed is missing from it either way.
 *
 * Her unsent text (an answer box, the "Start anywhere" box, an open topic) stays in the slot: the slot is never shared,
 * and the sealed record never contains it.
 */
import type { EvidenceItem, IntakeRecord, LedgerEntry, VaultRecordMeta } from '@matra/shared';
import type { ApiClient } from '../api/client';
import type { IntakeDraft } from '../integration/intakeAdapter';
import { SlotConflictError, saveDraftSlot } from './draftSlot';
import { sealPayload } from './vault';

/** Saving the draft before sealing failed for a reason other than a conflict: nothing was sealed. */
export class DraftNotSavedError extends Error {
  readonly friendly = true;
  constructor(readonly reason: unknown) {
    super('We couldn’t save your draft just now, so nothing was sealed. Your words are still here. Please try again in a moment.');
    this.name = 'DraftNotSavedError';
  }
}

export interface SealInput {
  api: ApiClient;
  masterKey: CryptoKey;
  draft: IntakeDraft;
  /** file details to keep with her draft (the record's own evidence is what gets sealed) */
  evidence: EvidenceItem[];
  record: IntakeRecord;
  /** the slot version this page last read or saved (null: she has no slot yet) */
  slotVersion: string | null;
  /** fingerprints already sealed for matching (empty when matching is off) */
  escrowed: string[];
  previousFinalId?: string;
  /** sealed matching on: lodge her chosen identifiers after the draft is safe and before sealing; returns fingerprints */
  lodge?: (escrowed: string[]) => Promise<string[]>;
  onStep?: (step: 'saving' | 'matching' | 'sealing' | 'marking') => void;
  /** her slot moved on (step 1 saved it): the caller's next save must name this version, even if sealing then fails */
  onDraftSaved?: (version: string) => void;
}

export interface SealResult {
  sealed: { record: VaultRecordMeta; ledgerEntry: LedgerEntry };
  escrowed: string[];
  /** her slot's version after the last write that succeeded */
  slotVersion: string;
  /** the slot now says which sealed record this draft became */
  marked: boolean;
  /** why it isn't (when `marked` is false): another device saved (conflict), or an error */
  markProblem?: 'conflict' | 'error';
}

export async function sealStory(o: SealInput): Promise<SealResult> {
  const keep = (escrowed: string[]) => (escrowed.length > 0 ? { escrowedHashes: escrowed } : {});
  // 1. Her draft, exactly as she is sealing it, is safe in her slot first.
  o.onStep?.('saving');
  let version: string;
  try {
    version = (await saveDraftSlot(o.api, o.masterKey, { draft: o.draft, evidence: o.evidence, ...keep(o.escrowed) }, o.slotVersion)).version;
    o.onDraftSaved?.(version);
  } catch (e) {
    if (e instanceof SlotConflictError) throw e;
    throw new DraftNotSavedError(e);
  }
  // 2. Sealed matching (on only).
  let escrowed = o.escrowed;
  if (o.lodge) {
    o.onStep?.('matching');
    escrowed = await o.lodge(escrowed);
  }
  // 3. The seal: only her account.
  o.onStep?.('sealing');
  const sealed = await sealPayload(o.api, o.masterKey, { kind: 'final', record: o.record, savedAt: new Date().toISOString() }, o.previousFinalId);
  // 4. Mark her slot with the seal it became (one retry).
  o.onStep?.('marking');
  const mark = { draft: o.draft, evidence: o.record.evidence, sealedRecordId: sealed.record.id, ...keep(escrowed) };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const saved = await saveDraftSlot(o.api, o.masterKey, mark, version);
      return { sealed, escrowed, slotVersion: saved.version, marked: true };
    } catch (e) {
      if (e instanceof SlotConflictError) return { sealed, escrowed, slotVersion: version, marked: false, markProblem: 'conflict' };
    }
  }
  return { sealed, escrowed, slotVersion: version, marked: false, markProblem: 'error' };
}
