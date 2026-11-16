import { describe, expect, it } from 'vitest';
import { decryptJSON, deriveKeys, newKdfSalt, unwrapKeyWithMaster } from '@matra/crypto';
import type { GetSlotResponse, PutSlotRequest, VaultSlot } from '@matra/shared';
import { ApiError, type ApiClient } from '../api/client';
import { draftToRecord, emptyDraft, type IntakeDraft } from '../intake';
import { SlotConflictError, loadDraftSlot, saveDraftSlot } from './draftSlot';
import { DraftNotSavedError, sealStory } from './sealStory';

/** Records and slots in memory, with the server's compare-and-swap; `failPut` makes chosen slot writes fail. */
function server() {
  const records: any[] = [];
  const slots = new Map<string, VaultSlot>();
  let puts = 0;
  let n = 0;
  const state = { failPut: (_i: number) => false };
  const api = {
    async createRecord(req: any) {
      const rec = { id: `r${records.length + 1}`, ownerId: 'u', supersedes: req.supersedes, contentHash: 'h', createdAt: new Date().toISOString(), ledgerEntryId: 'l', envelope: req.envelope, ownerWrappedKey: req.ownerWrappedKey };
      records.push(rec);
      return { record: rec, ledgerEntry: { seq: records.length, timestamp: rec.createdAt } };
    },
    async getSlot(name: string): Promise<GetSlotResponse> {
      return { slot: slots.get(name) ?? null, draftMode: 'slot' };
    },
    async putSlot(name: string, req: PutSlotRequest) {
      if (state.failPut(++puts)) throw new ApiError(0, 'We could not reach the server.', 'network');
      const cur = slots.get(name);
      if ((cur?.version ?? null) !== req.expectedVersion) throw new ApiError(409, 'stale', 'slot_conflict');
      const version = (++n).toString(16).padStart(32, '0');
      slots.set(name, { name, envelope: req.envelope, wrappedKey: req.wrappedKey, version, updatedDay: '2026-11-15' });
      return { version, updatedDay: '2026-11-15', draftMode: 'slot' };
    },
  } as unknown as ApiClient;
  return { api, records, state };
}

const NOW = new Date('2026-11-15T10:00:00Z');
const draftWith = (...words: string[]): IntakeDraft => ({
  ...emptyDraft(NOW),
  answers: { 'safety.now': 'yes' },
  entries: words.map((text, i) => ({ id: `e${i}`, text, createdAt: NOW.toISOString(), source: 'typed' })),
  space: { composer: 'UNSENT words she typed but did not add.' },
}) as unknown as IntakeDraft;

async function opened(api: ApiClient, records: any[], masterKey: CryptoKey) {
  void api;
  const r = records[records.length - 1];
  return decryptJSON<Record<string, unknown>>(r.envelope, await unwrapKeyWithMaster(r.ownerWrappedKey, masterKey));
}

describe('sealStory: a seal never loses her words', () => {
  it('saves the exact draft first, seals only the record, then marks the slot; unsent text stays in the slot only', async () => {
    const { masterKey } = await deriveKeys('seal story test', newKdfSalt(), 1000);
    const { api, records } = server();
    const first = await saveDraftSlot(api, masterKey, { draft: draftWith('FIRST'), evidence: [] }, null); // an earlier autosave
    const draft = draftWith('FIRST', 'SECOND'); // SECOND was added after that autosave
    const res = await sealStory({ api, masterKey, draft, evidence: [], record: draftToRecord(draft, NOW), slotVersion: first.version, escrowed: [] });
    expect(res.marked).toBe(true);
    const slot = await loadDraftSlot(api, masterKey);
    expect(slot.slot!.value.sealedRecordId).toBe(res.sealed.record.id);
    expect(slot.slot!.value.draft!.entries!.map((e) => e.text)).toEqual(['FIRST', 'SECOND']);
    // her unsent words are still in her (never shared) slot after the seal ...
    expect(slot.slot!.value.draft!.space!.composer).toBe('UNSENT words she typed but did not add.');
    // ... and never in the sealed envelope, which is exactly her account
    const sealed = await opened(api, records, masterKey);
    expect(Object.keys(sealed).sort()).toEqual(['kind', 'record', 'savedAt']);
    expect(JSON.stringify(sealed)).not.toContain('UNSENT');
  });

  it('if the draft can’t be saved first, nothing is sealed and she is told (the browser repro: every slot write fails)', async () => {
    const { masterKey } = await deriveKeys('seal story test', newKdfSalt(), 1000);
    const { api, records, state } = server();
    state.failPut = () => true;
    const draft = draftWith('FIRST', 'SECOND');
    const attempt = sealStory({ api, masterKey, draft, evidence: [], record: draftToRecord(draft, NOW), slotVersion: null, escrowed: [] });
    await expect(attempt).rejects.toBeInstanceOf(DraftNotSavedError);
    await expect(attempt).rejects.toThrow(/nothing was sealed/);
    expect(records).toHaveLength(0);
  });

  it('if sealing fails after the draft was saved, it reports the new version, so her next save is not a false conflict', async () => {
    const { masterKey } = await deriveKeys('seal story test', newKdfSalt(), 1000);
    const { api } = server();
    (api as unknown as { createRecord: () => Promise<never> }).createRecord = async () => {
      throw new ApiError(500, 'Something went wrong');
    };
    const draft = draftWith('FIRST', 'SECOND');
    let saved: string | null = null;
    await expect(
      sealStory({ api, masterKey, draft, evidence: [], record: draftToRecord(draft, NOW), slotVersion: null, escrowed: [], onDraftSaved: (v) => (saved = v) }),
    ).rejects.toThrow();
    expect(saved).toBe((await loadDraftSlot(api, masterKey)).version);
    await expect(saveDraftSlot(api, masterKey, { draft, evidence: [] }, saved)).resolves.toBeDefined();
  });

  it('two tabs: the stale one is refused before sealing (409), and the newer draft is untouched', async () => {
    const { masterKey } = await deriveKeys('seal story test', newKdfSalt(), 1000);
    const { api, records } = server();
    const opened0 = await saveDraftSlot(api, masterKey, { draft: draftWith('FIRST'), evidence: [] }, null);
    // tab B saves after both tabs opened at opened0
    await saveDraftSlot(api, masterKey, { draft: draftWith('FIRST', 'FROM TAB B'), evidence: [] }, opened0.version);
    // tab A has never saved since, and seals
    const draftA = draftWith('FIRST', 'FROM TAB A');
    await expect(
      sealStory({ api, masterKey, draft: draftA, evidence: [], record: draftToRecord(draftA, NOW), slotVersion: opened0.version, escrowed: [] }),
    ).rejects.toBeInstanceOf(SlotConflictError);
    expect(records).toHaveLength(0);
    expect((await loadDraftSlot(api, masterKey)).slot!.value.draft!.entries!.map((e) => e.text)).toEqual(['FIRST', 'FROM TAB B']);
  });

  it('if marking the slot after the seal fails once, it retries; if it keeps failing, it says so and the slot still has every word', async () => {
    const { masterKey } = await deriveKeys('seal story test', newKdfSalt(), 1000);
    const draft = draftWith('FIRST', 'SECOND');
    // the mark (2nd write) fails once, then the retry lands
    const once = server();
    once.state.failPut = (i) => i === 2;
    const ok = await sealStory({ api: once.api, masterKey, draft, evidence: [], record: draftToRecord(draft, NOW), slotVersion: null, escrowed: [] });
    expect(ok.marked).toBe(true);
    // every write after the first fails: sealed, not marked, and the slot (saved before sealing) has SECOND
    const always = server();
    always.state.failPut = (i) => i >= 2;
    const res = await sealStory({ api: always.api, masterKey, draft, evidence: [], record: draftToRecord(draft, NOW), slotVersion: null, escrowed: [] });
    expect(res).toMatchObject({ marked: false, markProblem: 'error' });
    expect(always.records).toHaveLength(1);
    always.state.failPut = () => false;
    const slot = await loadDraftSlot(always.api, masterKey);
    expect(slot.version).toBe(res.slotVersion); // the caller can keep saving from here
    expect(slot.slot!.value.draft!.entries!.map((e) => e.text)).toEqual(['FIRST', 'SECOND']);
  });

  it('with sealed matching: fingerprints lodged at the seal go into the mark; lodging runs only after the draft is safe', async () => {
    const { masterKey } = await deriveKeys('seal story test', newKdfSalt(), 1000);
    const { api, state } = server();
    const order: string[] = [];
    state.failPut = (i) => void order.push(`put${i}`) as unknown as boolean;
    const draft = draftWith('FIRST');
    const res = await sealStory({
      api, masterKey, draft, evidence: [], record: draftToRecord(draft, NOW), slotVersion: null, escrowed: ['old'],
      lodge: async (before) => (order.push('lodge'), [...before, 'new']),
    });
    expect(order).toEqual(['put1', 'lodge', 'put2']);
    expect(res.escrowed).toEqual(['old', 'new']);
  });
});
