/**
 * Her draft, in its draft slot (packages/shared/src/slots.ts): one encrypted envelope, saved over as she writes, never a
 * ledger entry. Sealing (lib/sealStory.ts) saves the slot first, then writes a WORM 'final' record holding only
 * `{kind, record, savedAt}` (lib/vault.ts sealPayload), then marks the slot with `sealedRecordId`, so she resumes from it
 * to add to a sealed version later. Her unsent text stays in the slot. Any later save drops `sealedRecordId`: the draft
 * then has changes the seal doesn't.
 *
 * The slot is the only place her answers, unsent text and (with sealed matching on) the fingerprints of identifiers
 * already sealed for matching are kept. None of it is ever shared: a share or report release wraps the key of a sealed
 * 'final' record, never the slot's.
 */
import { useSyncExternalStore } from 'react';
import { openSlot, sealSlot, slotName } from '@matra/crypto';
import type { DraftMode, EvidenceItem } from '@matra/shared';
import { ApiError, type ApiClient } from '../api/client';
import type { IntakeDraft } from '../integration/intakeAdapter';
import { mirror, typedText } from '../dev/mirror';

/** The label her draft slot's opaque name is made from. */
export const DRAFT_SLOT = 'draft';

export interface DraftSlot {
  kind: 'draft';
  slotVersion: 1;
  /** her answers and story pieces; absent when the slot only holds sealed-match fingerprints */
  draft?: IntakeDraft;
  /** details of the files she added (the files themselves are separate encrypted blobs) */
  evidence: EvidenceItem[];
  /** set only by the save right after sealing: this draft is what that sealed record was made from */
  sealedRecordId?: string;
  /** sealed matching on only: fingerprints of identifiers already sealed, so a re-seal never resubmits a withdrawn one */
  escrowedHashes?: string[];
  savedAt: string;
}

export interface LoadedDraftSlot {
  value: DraftSlot;
  /** the slot's version tag (a save must name it) */
  version: string;
  updatedDay: string;
}

export interface DraftSlotState {
  /** her draft slot, or null when she has none (or it didn't open: see `unreadable`) */
  slot: LoadedDraftSlot | null;
  /** her slot is stored but didn't open: nothing is saved over it (lib/vault.ts loadSpace fails closed on it) */
  unreadable: boolean;
  /** why it didn't open: it doesn't decrypt under her key, or it isn't a draft this app wrote */
  unreadableReason?: 'gcm' | 'shape';
  /** the version a save must name (that of an unreadable slot too); null when she has no slot */
  version: string | null;
  draftMode: DraftMode;
}

/** A save named a version that is no longer current: her draft was saved from another device or tab since this one read it. */
export class SlotConflictError extends Error {
  readonly friendly = true;
  constructor() {
    super('A newer version of your draft was saved from another device or tab.');
    this.name = 'SlotConflictError';
  }
}

// ── the server's MATRA_DRAFT_MODE, learned from every slot read and write (only the copy depends on it) ──
let draftMode: DraftMode = 'slot';
const listeners = new Set<() => void>();

export function setDraftMode(mode: DraftMode): void {
  if (mode === draftMode) return;
  draftMode = mode;
  for (const l of listeners) l();
}

/** The server's draft mode as last learned (every slot read and write teaches it). */
export function currentDraftMode(): DraftMode {
  return draftMode;
}

/** Whether earlier drafts are kept ('keep-versions') or each save replaces the last ('slot'), for honest copy. */
export function useDraftMode(): DraftMode {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => draftMode,
  );
}

const MATCHING_STEPS = ['person.escrow', 'person.matchContact'];

/**
 * A build without sealed matching (MATRA_MATCHING=off) can't show or change the sealed-match answers an earlier build
 * may have saved (who she chose to match, how a counselor may reach her), so it never keeps them: they leave the draft
 * on the first save.
 */
export function withoutMatchingAnswers(draft: IntakeDraft): IntakeDraft {
  if (__MATRA_MATCHING__) return draft;
  const keep = <T,>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).filter(([k]) => !MATCHING_STEPS.includes(k)));
  const { pending, space, ...rest } = draft;
  const out: IntakeDraft = { ...rest, answers: keep(draft.answers) };
  if (pending && !MATCHING_STEPS.includes(pending.stepId)) out.pending = pending;
  if (space) out.space = space.pending ? { ...space, pending: keep(space.pending) } : space;
  return out;
}

/** What this build keeps in the slot: without sealed matching, no fingerprints and no sealed-match answers. */
function forThisBuild(v: DraftSlot): DraftSlot {
  if (__MATRA_MATCHING__) return v;
  const { escrowedHashes: _e, ...rest } = v;
  return { ...rest, ...(rest.draft && { draft: withoutMatchingAnswers(rest.draft) }) };
}

/** Read her draft slot. Network and server errors throw; a slot that doesn't open is reported, not thrown. */
export async function loadDraftSlot(api: ApiClient, masterKey: CryptoKey): Promise<DraftSlotState> {
  const res = await api.getSlot(await slotName(masterKey, DRAFT_SLOT));
  setDraftMode(res.draftMode);
  if (!res.slot) return { slot: null, unreadable: false, version: null, draftMode: res.draftMode };
  const unreadable = (unreadableReason: 'gcm' | 'shape'): DraftSlotState => ({
    slot: null,
    unreadable: true,
    unreadableReason,
    version: res.slot!.version,
    draftMode: res.draftMode,
  });
  let value: DraftSlot;
  try {
    value = await openSlot<DraftSlot>(res.slot, masterKey);
  } catch (e) {
    return unreadable(e instanceof SyntaxError ? 'shape' : 'gcm');
  }
  if (value?.kind !== 'draft' || !Array.isArray(value.evidence) || typeof value.savedAt !== 'string') return unreadable('shape');
  return {
    slot: { value: forThisBuild(value), version: res.slot.version, updatedDay: res.slot.updatedDay },
    unreadable: false,
    version: res.slot.version,
    draftMode: res.draftMode,
  };
}

/**
 * Save her draft over the slot, if `expectedVersion` is still its version (null = she has none yet). Returns the new
 * version (a random tag, so nothing counts her saves).
 * Throws SlotConflictError when another device or tab saved first.
 */
export async function saveDraftSlot(
  api: ApiClient,
  masterKey: CryptoKey,
  content: Omit<DraftSlot, 'kind' | 'slotVersion' | 'savedAt'>,
  expectedVersion: string | null,
): Promise<{ version: string; savedAt: string }> {
  const savedAt = new Date().toISOString();
  const value = forThisBuild({ kind: 'draft', slotVersion: 1, ...content, savedAt });
  const sealed = await sealSlot(value, masterKey);
  mirror(
    'Her story (draft, saved as she goes)',
    typedText(value.draft ?? {}),
    `Encrypted here and padded to a 16 KiB step (${sealed.envelope.ct.length} base64 characters). The server keeps only this newest copy, under a name it can't read, with no ledger entry.`,
  );
  try {
    const res = await api.putSlot(await slotName(masterKey, DRAFT_SLOT), { ...sealed, expectedVersion });
    setDraftMode(res.draftMode);
    return { version: res.version, savedAt };
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && e.code === 'slot_conflict') throw new SlotConflictError();
    throw e;
  }
}

/**
 * Read, change and save the slot, reading it again once if another save got there first. For changes that apply to
 * whatever the newest draft is (more file details, sealed-match fingerprints), never for saving an edited draft over
 * someone else's. Refuses (UnreadableDraftError) when her slot is stored but didn't open.
 */
export async function updateDraftSlot(
  api: ApiClient,
  masterKey: CryptoKey,
  change: (current: DraftSlot | null) => Omit<DraftSlot, 'kind' | 'slotVersion' | 'savedAt'>,
): Promise<{ version: string; value: Omit<DraftSlot, 'kind' | 'slotVersion' | 'savedAt'> }> {
  for (let attempt = 0; ; attempt++) {
    const cur = await loadDraftSlot(api, masterKey);
    if (cur.unreadable) throw new UnreadableDraftError();
    const value = change(cur.slot?.value ?? null);
    try {
      return { version: (await saveDraftSlot(api, masterKey, value, cur.version)).version, value };
    } catch (e) {
      if (!(e instanceof SlotConflictError) || attempt >= 1) throw e;
    }
  }
}

/** Her draft slot is stored but didn't open, so nothing is saved over it. */
export class UnreadableDraftError extends Error {
  readonly friendly = true;
  constructor() {
    super('We couldn’t open your saved draft just now. It is still stored. You could try again in a moment, or sign out and back in.');
    this.name = 'UnreadableDraftError';
  }
}
