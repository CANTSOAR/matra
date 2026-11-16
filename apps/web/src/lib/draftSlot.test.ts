import { afterEach, describe, expect, it } from 'vitest';
import { deriveKeys, fromBase64, newKdfSalt, sealSlot, slotName } from '@matra/crypto';
import { SLOT_BUCKET_BYTES, type DraftMode, type GetSlotResponse, type PutSlotRequest, type VaultSlot } from '@matra/shared';
import { ApiError, type ApiClient } from '../api/client';
import { emptyDraft, type IntakeDraft } from '../intake/draft';
import {
  SlotConflictError,
  UnreadableDraftError,
  loadDraftSlot,
  saveDraftSlot,
  setDraftMode,
  updateDraftSlot,
  withoutMatchingAnswers,
} from './draftSlot';

const g = globalThis as { __MATRA_MATCHING__?: boolean };
const initial = g.__MATRA_MATCHING__;
afterEach(() => {
  g.__MATRA_MATCHING__ = initial;
  setDraftMode('slot');
});

let versions = 0;
const newVersion = () => (++versions).toString(16).padStart(32, '0');

/** The slot routes, in memory, with the server's compare-and-swap. */
function slotServer(draftMode: DraftMode = 'slot') {
  const slots = new Map<string, VaultSlot>();
  const puts: Array<{ name: string; req: PutSlotRequest }> = [];
  let beforePut: (() => void) | undefined;
  const api = {
    async getSlot(name: string): Promise<GetSlotResponse> {
      return { slot: slots.get(name) ?? null, draftMode };
    },
    async putSlot(name: string, req: PutSlotRequest) {
      beforePut?.();
      beforePut = undefined;
      puts.push({ name, req });
      const cur = slots.get(name);
      if ((cur?.version ?? null) !== req.expectedVersion) throw new ApiError(409, 'A newer draft was saved from another device or tab.', 'slot_conflict');
      const version = newVersion();
      slots.set(name, { name, envelope: req.envelope, wrappedKey: req.wrappedKey, version, updatedDay: '2026-11-14' });
      return { version, updatedDay: '2026-11-14', draftMode };
    },
  } as unknown as ApiClient;
  return { api, slots, puts, onNextPut: (f: () => void) => (beforePut = f) };
}

const keys = () => deriveKeys('draft slot web test', newKdfSalt(), 1000);
const withAnswers = (answers: Record<string, unknown>, extra: Partial<IntakeDraft> = {}): IntakeDraft =>
  ({ ...emptyDraft(), answers, ...extra }) as IntakeDraft;

describe('draft slot', () => {
  it('saves over one opaque, padded slot and reads it back; the version changes with each save', async () => {
    const { masterKey } = await keys();
    const { api, slots, puts } = slotServer();
    const draft = withAnswers({ 'about.name': 'J' });
    const first = await saveDraftSlot(api, masterKey, { draft, evidence: [] }, null);
    const second = await saveDraftSlot(api, masterKey, { draft: withAnswers({ 'about.name': 'J.' }), evidence: [] }, first.version);
    expect(second.version).not.toBe(first.version);
    expect(slots.size).toBe(1);
    const name = await slotName(masterKey, 'draft');
    expect([...slots.keys()]).toEqual([name]);
    expect(name).not.toMatch(/draft/);
    for (const p of puts) expect(fromBase64(p.req.envelope.ct).length % SLOT_BUCKET_BYTES).toBe(0);

    const loaded = await loadDraftSlot(api, masterKey);
    expect(loaded).toMatchObject({ unreadable: false, version: second.version, draftMode: 'slot' });
    expect(loaded.slot!.value).toMatchObject({ kind: 'draft', slotVersion: 1, draft: { answers: { 'about.name': 'J.' } }, evidence: [] });
  });

  it('a save from a stale page is refused with SlotConflictError, and the newer draft stays', async () => {
    const { masterKey } = await keys();
    const { api } = slotServer();
    const v1 = (await saveDraftSlot(api, masterKey, { draft: withAnswers({ v: 'laptop' }), evidence: [] }, null)).version;
    await saveDraftSlot(api, masterKey, { draft: withAnswers({ v: 'laptop again' }), evidence: [] }, v1);
    // the phone read v1 too
    await expect(saveDraftSlot(api, masterKey, { draft: withAnswers({ v: 'phone' }), evidence: [] }, v1)).rejects.toBeInstanceOf(SlotConflictError);
    expect((await loadDraftSlot(api, masterKey)).slot!.value.draft!.answers).toEqual({ v: 'laptop again' });
  });

  it('updateDraftSlot reads again once after a conflict, so a file detail lands on the newest draft', async () => {
    const { masterKey } = await keys();
    const server = slotServer();
    await saveDraftSlot(server.api, masterKey, { draft: withAnswers({ v: 'one' }), evidence: [] }, null);
    // another tab saves between this read and this write
    const two = await sealSlot({ kind: 'draft', slotVersion: 1, draft: withAnswers({ v: 'two' }), evidence: [], savedAt: 'x' }, masterKey);
    const name = await slotName(masterKey, 'draft');
    server.onNextPut(() => server.slots.set(name, { name, ...two, version: newVersion(), updatedDay: '2026-11-14' }));
    const file = { id: 'e1', kind: 'photo', fileName: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 1, sha256: '0'.repeat(64), blobId: 'b1', metadataStripped: true } as const;
    const { version } = await updateDraftSlot(server.api, masterKey, (cur) => ({ ...cur!, evidence: [...cur!.evidence, file] }));
    expect(server.puts).toHaveLength(3); // the first write, the stale one, the retry
    const now = await loadDraftSlot(server.api, masterKey);
    expect(now.version).toBe(version);
    expect(now.slot!.value.draft!.answers).toEqual({ v: 'two' });
    expect(now.slot!.value.evidence.map((e) => e.blobId)).toEqual(['b1']);
  });

  it('a slot that does not open is reported, never treated as empty; updateDraftSlot refuses to save over it', async () => {
    const mine = await keys();
    const { api, slots } = slotServer();
    const stored = (await saveDraftSlot(api, mine.masterKey, { draft: withAnswers({ v: 'hers' }), evidence: [] }, null)).version;
    // her slot's ciphertext was damaged on the server: it no longer opens
    const name = await slotName(mine.masterKey, 'draft');
    const s = slots.get(name)!;
    slots.set(name, { ...s, envelope: { ...s.envelope, ct: s.envelope.ct.slice(0, -8) + 'AAAAAAA=' } });
    expect(await loadDraftSlot(api, mine.masterKey)).toMatchObject({ slot: null, unreadable: true, version: stored });
    await expect(updateDraftSlot(api, mine.masterKey, () => ({ evidence: [] }))).rejects.toBeInstanceOf(UnreadableDraftError);
  });

  it('learns the server’s MATRA_DRAFT_MODE for the copy', async () => {
    const { masterKey } = await keys();
    const { api } = slotServer('keep-versions');
    expect((await loadDraftSlot(api, masterKey)).draftMode).toBe('keep-versions');
  });

  it('without sealed matching: no fingerprints and no sealed-match answers are ever saved', async () => {
    g.__MATRA_MATCHING__ = false;
    const { masterKey } = await keys();
    const { api } = slotServer();
    const draft = withAnswers(
      { 'person.escrow': { p1: 'yes' }, 'person.matchContact': { method: 'text', detail: '555-0100' }, 'about.name': 'J' },
      { pending: { stepId: 'person.matchContact', value: { detail: 'sentinel-pending' } }, space: { pending: { 'person.matchContact': { detail: '5' }, 'about.name': 'Je' } } },
    );
    await saveDraftSlot(api, masterKey, { draft, evidence: [], escrowedHashes: ['h1'] }, null);
    const v = (await loadDraftSlot(api, masterKey)).slot!.value;
    expect(v.escrowedHashes).toBeUndefined();
    expect(Object.keys(v.draft!.answers)).toEqual(['about.name']);
    expect(v.draft!.pending).toBeUndefined();
    expect(v.draft!.space?.pending).toEqual({ 'about.name': 'Je' });
    // distinctive strings: a bare '555' also turns up in a timestamp's milliseconds one run in about a thousand
    expect(JSON.stringify(v)).not.toContain('sentinel');
    expect(JSON.stringify(v)).not.toContain('555-0100');
  });

  it('with sealed matching on, keeps both (her matching choices live only in her slot, never in a sealed record)', async () => {
    g.__MATRA_MATCHING__ = true;
    const { masterKey } = await keys();
    const { api } = slotServer();
    const draft = withAnswers({ 'person.matchContact': { method: 'text', detail: '555-0100' } });
    await saveDraftSlot(api, masterKey, { draft, evidence: [], escrowedHashes: ['h1'] }, null);
    const v = (await loadDraftSlot(api, masterKey)).slot!.value;
    expect(v.escrowedHashes).toEqual(['h1']);
    expect(withoutMatchingAnswers(draft)).toBe(draft);
    expect(v.draft!.answers).toEqual(draft.answers);
  });

});
