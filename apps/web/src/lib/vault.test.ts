import { beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import type { EvidenceItem, IntakeRecord } from '@matra/shared';
import { ApiError, type ApiClient } from '../api/client';
import { draftToRecord, emptyDraft } from '../intake';
import { DEFAULT_KDF_ITERATIONS, decryptJSON, deriveKeys, newKdfSalt, sealSlot, unwrapKeyWithMaster } from '@matra/crypto';
import {
  DRAFT_PROBLEM_ID,
  RETRY_DELAY_MS,
  UnreadableVaultError,
  VAULT_INTEGRITY_STOP,
  VAULT_UNAVAILABLE_STOP,
  VaultIntegrityError,
  VaultUnavailableError,
  foldInLateEvidence,
  isCleanFinal,
  loadSpace,
  loadVault,
  resumeFrom,
  sealPayload,
  vaultError,
  vaultProblemNotice,
  type OpenedRecord,
  type VaultPayload,
} from './vault';
import { storedRecord, vaultApi, type StoredRecord } from '../test/fakeVault';
import type { WorkingData } from './session';
import type { LoadedDraftSlot } from './draftSlot';

const file = (blobId: string): EvidenceItem => ({
  id: `e-${blobId}`,
  kind: 'photo',
  fileName: `${blobId}.jpg`,
  mimeType: 'image/jpeg',
  sizeBytes: 3,
  sha256: '0'.repeat(64),
  blobId,
  metadataStripped: true,
});

describe('loadVault fails closed', () => {
  // a dropped request is tried once more after this delay (lib/vault.ts retryOnce); no need to wait in tests
  beforeAll(() => {
    RETRY_DELAY_MS.value = 0;
  });
  const draft = (n: number) => ({ answers: { n } }) as unknown as NonNullable<WorkingData['draft']>;
  const final = { kind: 'final', record: { story: 'mine' }, savedAt: '2026-01-01T00:00:00Z' };
  /** three saved versions, each superseding the last (legacy draft records, as every autosave was before slots) */
  async function three() {
    const { masterKey } = await deriveKeys('vault test passphrase words', newKdfSalt(), Math.min(DEFAULT_KDF_ITERATIONS, 1000));
    const stored = [
      await storedRecord(masterKey, { kind: 'draft', draft: draft(1), savedAt: '2026-01-01T00:00:00Z' }, { id: 'r1' }),
      await storedRecord(masterKey, { kind: 'draft', draft: draft(2), savedAt: '2026-01-01T00:01:00Z' }, { id: 'r2', supersedes: 'r1' }),
      await storedRecord(masterKey, final, { id: 'r3', supersedes: 'r2' }),
    ];
    return { masterKey, stored };
  }
  /** what loadVault throws (or null) */
  const thrown = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

  it('one dropped request is tried once more before anything stops; two in a row stop it', async () => {
    const { masterKey, stored } = await three();
    const api = vaultApi(stored);
    const get = api.getRecord.bind(api);
    let calls = 0;
    api.getRecord = async (id: string) => {
      if (id === 'r3' && calls++ === 0) throw new ApiError(0, 'offline', 'network');
      return get(id);
    };
    expect((await loadVault(api, masterKey)).problems).toEqual([]);
    expect(calls).toBe(2);
    api.getRecord = async (id: string) => {
      if (id === 'r3') throw new ApiError(503, 'down');
      return get(id);
    };
    expect(await thrown(loadVault(api, masterKey))).toBeInstanceOf(VaultUnavailableError);
  });

  it('a 404 or 403 on the list or her draft’s route is "couldn’t reach us" (a proxy or a deploy), never "doesn’t match"', async () => {
    const { masterKey, stored } = await three();
    for (const status of [404, 403]) {
      const api = vaultApi(stored);
      api.listRecords = async () => {
        throw new ApiError(status, 'Not Found');
      };
      const e = await thrown(loadVault(api, masterKey));
      expect(e).toBeInstanceOf(VaultUnavailableError);
      expect((e as VaultUnavailableError).problems).toEqual([{ kind: 'unavailable', id: 'list' }]);
      const api2 = vaultApi(stored, {
        slot: async () => {
          throw new ApiError(status, 'Not Found');
        },
      });
      expect(((await thrown(loadSpace(api2, masterKey))) as VaultUnavailableError).problems).toEqual([{ kind: 'unavailable', id: DRAFT_PROBLEM_ID }]);
    }
  });

  it('a clean vault opens, every record checked against its stored hash and its ledger entry', async () => {
    const { masterKey, stored } = await three();
    const vault = await loadVault(vaultApi(stored), masterKey);
    expect(vault.map((r) => r.meta.id)).toEqual(['r3', 'r2', 'r1']);
    expect(vault.problems).toEqual([]);
    expect(vault.every((r) => r.verified && r.ledgerEntry?.subjectId === r.meta.id)).toBe(true);
  });

  it('a record that can’t be fetched: VaultUnavailableError, "couldn’t reach us" copy', async () => {
    const { masterKey, stored } = await three();
    const api = vaultApi(stored);
    api.getRecord = async (id: string) => {
      if (id === 'r3') throw new ApiError(0, 'offline', 'network');
      return vaultApi(stored).getRecord(id);
    };
    const e = await thrown(loadVault(api, masterKey));
    expect(e).toBeInstanceOf(VaultUnavailableError);
    expect((e as VaultUnavailableError).problems).toEqual([{ kind: 'unavailable', id: 'r3' }]);
    expect((e as Error).message).toBe(VAULT_UNAVAILABLE_STOP);
    expect((e as Error).message).toMatch(/couldn’t reach Matra/);
  });

  const integrityCases: Array<[string, 'gcm' | 'hash' | 'ledger' | 'shape', (s: StoredRecord[], mk: CryptoKey) => Promise<void> | void]> = [
    ['its ciphertext was changed', 'gcm', (s) => {
      const env = s[2]!.record.envelope;
      s[2]!.record.envelope = { ...env, ct: env.ct.slice(0, -8) + 'AAAAAAA=' };
    }],
    ['its key was swapped for another record’s', 'gcm', (s) => {
      s[2]!.record.ownerWrappedKey = s[0]!.record.ownerWrappedKey;
    }],
    ['the hash the server stored doesn’t match the envelope (verified=false now blocks)', 'hash', (s) => {
      s[2]!.record.contentHash = 'f'.repeat(64);
    }],
    ['its ledger entry attests a different hash', 'ledger', (s) => {
      s[2]!.ledger.contentHash = 'f'.repeat(64);
    }],
    ['its ledger entry is about another record', 'ledger', (s) => {
      s[2]!.ledger.subjectId = 'r1';
    }],
    ['the ledger has no entry it names', 'ledger', (s) => {
      s[2]!.ledger.id = 'l-elsewhere';
    }],
    ['it decrypts, but isn’t a record this app wrote', 'shape', async (s, mk) => {
      const fake = await storedRecord(mk, { kind: 'note', text: 'hello' }, { id: 'r3', supersedes: 'r2' });
      s[2] = fake;
    }],
    ['a sealed account without its record', 'shape', async (s, mk) => {
      s[2] = await storedRecord(mk, { kind: 'final', savedAt: 'x' }, { id: 'r3', supersedes: 'r2' });
    }],
  ];
  for (const [what, reason, damage] of integrityCases)
    it(`${what}: VaultIntegrityError (${reason}), "doesn’t match what you saved" copy`, async () => {
      const { masterKey, stored } = await three();
      await damage(stored, masterKey);
      const e = await thrown(loadVault(vaultApi(stored), masterKey));
      expect(e).toBeInstanceOf(VaultIntegrityError);
      expect((e as VaultIntegrityError).problems).toEqual([{ kind: 'integrity', reason, id: 'r3' }]);
      expect((e as Error).message).toBe(VAULT_INTEGRITY_STOP);
      expect((e as Error).message).toMatch(/doesn’t match what you saved/);
    });

  it('a ledger that can’t be reached is "unavailable", not an integrity problem', async () => {
    const { masterKey, stored } = await three();
    const api = vaultApi(stored);
    api.getLedgerEntry = async () => {
      throw new ApiError(503, 'down');
    };
    expect(await thrown(loadVault(api, masterKey))).toBeInstanceOf(VaultUnavailableError);
    // and without the ledger check (the caller asked for none) it opens
    expect(await loadVault(api, masterKey, { withLedger: false })).toHaveLength(3);
  });

  it('records the server leaves out: a listed record it won’t serve, or one a listed record supersedes, is "missing"', async () => {
    const { masterKey, stored } = await three();
    const api = vaultApi(stored);
    api.getRecord = async (id: string) => {
      if (id === 'r3') throw new ApiError(404, 'not found');
      return vaultApi(stored).getRecord(id);
    };
    const e = await thrown(loadVault(api, masterKey));
    expect(e).toBeInstanceOf(VaultIntegrityError);
    expect((e as VaultIntegrityError).problems).toEqual([{ kind: 'missing', id: 'r3' }]);
    // r2 left out of the list: r3 still names it
    const e2 = await thrown(loadVault(vaultApi([stored[0]!, stored[2]!]), masterKey));
    expect((e2 as VaultIntegrityError).problems).toEqual([{ kind: 'missing', id: 'r2' }]);
  });

  it('when both kinds happen, integrity wins (trying again won’t fix it)', async () => {
    const { masterKey, stored } = await three();
    stored[2]!.record.contentHash = 'f'.repeat(64);
    const api = vaultApi(stored);
    api.getRecord = async (id: string) => {
      if (id === 'r1') throw new ApiError(500, 'oops');
      return vaultApi(stored).getRecord(id);
    };
    const e = await thrown(loadVault(api, masterKey));
    expect(e).toBeInstanceOf(VaultIntegrityError);
    expect((e as VaultIntegrityError).unreadable).toBe(2);
  });

  it('a list that fails is unavailable; a signed-out session (401) is passed through as it is', async () => {
    const { masterKey, stored } = await three();
    const api = vaultApi(stored);
    api.listRecords = async () => {
      throw new ApiError(502, 'bad gateway');
    };
    expect(await thrown(loadVault(api, masterKey, { allowPartial: true }))).toBeInstanceOf(VaultUnavailableError);
    api.listRecords = async () => {
      throw new ApiError(401, 'Your session has ended.');
    };
    const e = await thrown(loadVault(api, masterKey));
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).status).toBe(401);
  });

  it('allowPartial (read-only screens): what passed, plus problems; the notice says what is left out and why', async () => {
    const { masterKey, stored } = await three();
    stored[2]!.record.contentHash = 'f'.repeat(64);
    const api = vaultApi(stored);
    api.getRecord = async (id: string) => {
      if (id === 'r2') throw new ApiError(0, 'offline', 'network');
      return vaultApi(stored).getRecord(id);
    };
    const vault = await loadVault(api, masterKey, { allowPartial: true });
    expect(vault.map((r) => r.meta.id)).toEqual(['r1']);
    expect(vault.problems).toEqual([
      { kind: 'unavailable', id: 'r2' },
      { kind: 'integrity', reason: 'hash', id: 'r3' },
    ]);
    // what a resume would pick is the oldest version: which is why no screen that resumes may load partially
    expect(resumeFrom(null, vault).draft).toEqual(draft(1));
    const notice = vaultProblemNotice(vault.problems)!;
    expect(notice).toMatch(/^One saved version of your space doesn’t match what you saved, so it is left out here\. Nothing was changed\./);
    expect(notice).toMatch(/We couldn’t reach Matra to open one saved version of your space just now\./);
    expect(notice).toMatch(/may not be your newest save/);
    expect(vaultProblemNotice([])).toBeNull();
    expect(vaultProblemNotice([{ kind: 'unavailable', id: 'a' }, { kind: 'unavailable', id: 'b' }])).toMatch(/^We couldn’t reach Matra to open 2 saved versions/);
  });

  it('vaultError: VaultIntegrityError for integrity or missing, VaultUnavailableError otherwise', () => {
    expect(vaultError([{ kind: 'unavailable', id: 'a' }])).toBeInstanceOf(VaultUnavailableError);
    expect(vaultError([{ kind: 'missing', id: 'a' }])).toBeInstanceOf(VaultIntegrityError);
    expect(vaultError([{ kind: 'unavailable', id: 'a' }, { kind: 'integrity', reason: 'gcm', id: 'b' }])).toBeInstanceOf(VaultIntegrityError);
    // both are the same base class the rest of the app already knows (friendlyError shows the message as is)
    expect(vaultError([{ kind: 'unavailable', id: 'a' }])).toBeInstanceOf(UnreadableVaultError);
  });
});

describe('loadSpace: her draft slot counts, and is checked against the records', () => {
  async function withSlot(value: unknown, stored?: (mk: CryptoKey) => Promise<StoredRecord[]>) {
    const { masterKey } = await deriveKeys('vault test passphrase words', newKdfSalt(), 1000);
    const recs = stored ? await stored(masterKey) : [];
    const sealed = await sealSlot(value, masterKey);
    const api = vaultApi(recs, { slot: async () => ({ slot: { ...sealed, version: 'v1', updatedDay: '2026-01-01' }, draftMode: 'slot' }) });
    return { masterKey, api, recs };
  }
  const slotValue = (extra: object = {}) => ({ kind: 'draft', slotVersion: 1, draft: { answers: {} }, evidence: [], savedAt: '2026-01-02T00:00:00Z', ...extra });

  it('a clean space: records, slot, no problems', async () => {
    const { masterKey, api } = await withSlot(slotValue({ sealedRecordId: 'f1' }), async (mk) => [
      await storedRecord(mk, { kind: 'final', record: {}, savedAt: 'x' }, { id: 'f1' }),
    ]);
    const space = await loadSpace(api, masterKey);
    expect(space.problems).toEqual([]);
    expect(space.slot.slot?.value.sealedRecordId).toBe('f1');
    expect(space.vault.map((r) => r.meta.id)).toEqual(['f1']);
  });

  it('her draft says it became a sealed version the server didn’t list: "missing" (the server hid her newest seal)', async () => {
    const { masterKey, api } = await withSlot(slotValue({ sealedRecordId: 'f2' }), async (mk) => [
      await storedRecord(mk, { kind: 'final', record: {}, savedAt: 'x' }, { id: 'f1' }),
    ]);
    const e = await loadSpace(api, masterKey).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(VaultIntegrityError);
    expect((e as VaultIntegrityError).problems).toEqual([{ kind: 'missing', id: 'f2' }]);
  });

  it('another tab sealed between the list and the draft read: listed once more, it loads cleanly (no "doesn’t match")', async () => {
    const { masterKey } = await deriveKeys('vault test passphrase words', newKdfSalt(), 1000);
    const f1 = await storedRecord(masterKey, { kind: 'final', record: {}, savedAt: 'x' }, { id: 'f1' });
    const f2 = await storedRecord(masterKey, { kind: 'final', record: {}, savedAt: 'y' }, { id: 'f2', supersedes: 'f1' });
    const sealed = await sealSlot(slotValue({ sealedRecordId: 'f2' }), masterKey);
    const stored = [f1];
    const api = vaultApi(stored, { slot: async () => ({ slot: { ...sealed, version: 'v2', updatedDay: '2026-01-01' }, draftMode: 'slot' }) });
    const list = api.listRecords.bind(api);
    let lists = 0;
    api.listRecords = async () => {
      // the other tab's seal lands right after this tab's first list
      if (lists++ === 0) {
        const first = await list();
        stored.push(f2);
        return first;
      }
      return list();
    };
    const space = await loadSpace(api, masterKey);
    expect(space.problems).toEqual([]);
    expect(space.vault.map((r) => r.meta.id)).toEqual(['f2', 'f1']);
  });

  it('a slot that doesn’t decrypt, or isn’t a draft, is an integrity problem; one that can’t be fetched is unavailable', async () => {
    const { masterKey, api } = await withSlot({ kind: 'something else' });
    expect(((await loadSpace(api, masterKey).catch((x: unknown) => x)) as VaultIntegrityError).problems).toEqual([
      { kind: 'integrity', reason: 'shape', id: DRAFT_PROBLEM_ID },
    ]);
    const other = await deriveKeys('someone else entirely', newKdfSalt(), 1000);
    expect(((await loadSpace(api, other.masterKey).catch((x: unknown) => x)) as VaultIntegrityError).problems).toEqual([
      { kind: 'integrity', reason: 'gcm', id: DRAFT_PROBLEM_ID },
    ]);
    api.getSlot = async () => {
      throw new ApiError(0, 'offline', 'network');
    };
    expect(await loadSpace(api, masterKey).catch((x: unknown) => x)).toBeInstanceOf(VaultUnavailableError);
    // read-only: the rest, with the draft marked as not loaded (nothing may be saved over it)
    const partial = await loadSpace(api, masterKey, { allowPartial: true });
    expect(partial.problems).toEqual([{ kind: 'unavailable', id: DRAFT_PROBLEM_ID }]);
    expect(partial.slot).toMatchObject({ slot: null, unreadable: true });
    expect(vaultProblemNotice(partial.problems)).toMatch(/We couldn’t reach Matra to open your draft just now/);
  });
});

describe('foldInLateEvidence', () => {
  const draft = { answers: { mine: true } } as unknown as WorkingData['draft'];
  const story: WorkingData = { draft, evidence: [file('a')], slotVersion: 'v1' };

  it('adds files saved after the story opened, keeps her draft, and follows the newer slot save', () => {
    const mem: WorkingData = { draft: null, evidence: [file('a'), file('b')], slotVersion: 'v2' };
    const next = foldInLateEvidence(story, mem)!;
    expect(next.evidence.map((e) => e.blobId)).toEqual(['a', 'b']);
    expect(next.draft).toBe(draft);
    expect(next.slotVersion).toBe('v2');
  });

  it('returns null when nothing is new (including the story’s own saves)', () => {
    expect(foldInLateEvidence(story, null)).toBeNull();
    expect(foldInLateEvidence(story, { ...story, slotVersion: 'v9' })).toBeNull();
    expect(foldInLateEvidence(story, { draft: null, evidence: [] })).toBeNull();
  });

  it('never drops a file the story has that the in-memory copy lacks', () => {
    const mem: WorkingData = { draft: null, evidence: [file('c')] };
    const next = foldInLateEvidence(story, mem)!;
    expect(next.evidence.map((e) => e.blobId)).toEqual(['a', 'c']);
    expect(next.slotVersion).toBe('v1');
  });
});

/** An in-memory records API: enough for sealPayload and loadVault. */
function recordsApi() {
  const records: any[] = [];
  const api = {
    async createRecord(req: any) {
      const rec = { id: `r${records.length + 1}`, ownerId: 'u1', supersedes: req.supersedes, contentHash: 'h',
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, records.length)).toISOString(), ledgerEntryId: 'l', envelope: req.envelope, ownerWrappedKey: req.ownerWrappedKey };
      records.push(rec);
      return { record: rec, ledgerEntry: { seq: records.length, timestamp: rec.createdAt } };
    },
    async listRecords() {
      return { records };
    },
    async getRecord(id: string) {
      return { record: records.find((x) => x.id === id) };
    },
  } as unknown as ApiClient;
  return { api, records };
}

const keys = () => deriveKeys('seal only the record', newKdfSalt(), 1000);

describe('sealPayload: a sealed account holds only the record', () => {
  it('a sealed final decrypts to exactly kind, record and savedAt, even if a caller passes more', async () => {
    const { masterKey } = await keys();
    const { api, records } = recordsApi();
    const record = draftToRecord(emptyDraft());
    const extra = { kind: 'final', record, savedAt: '2026-02-01T00:00:00Z', draft: emptyDraft(), escrowedHashes: ['ab'], evidence: [] };
    await sealPayload(api, masterKey, extra as unknown as Parameters<typeof sealPayload>[2]);
    const sent = records[0];
    const plaintext = await decryptJSON<Record<string, unknown>>(sent.envelope, await unwrapKeyWithMaster(sent.ownerWrappedKey, masterKey));
    expect(Object.keys(plaintext).sort()).toEqual(['kind', 'record', 'savedAt']);
    expect(plaintext).toEqual({ kind: 'final', record, savedAt: '2026-02-01T00:00:00Z' });
  });

  it('never seals a draft as a record (drafts go to the draft slot)', async () => {
    const { masterKey } = await keys();
    const { api, records } = recordsApi();
    const draft = { kind: 'draft', draft: emptyDraft(), savedAt: 'x' } as unknown as Parameters<typeof sealPayload>[2];
    await expect(sealPayload(api, masterKey, draft)).rejects.toThrow(/draft slot/);
    expect(records).toHaveLength(0);
  });

  it('isCleanFinal: only {kind, record, savedAt} may be shared; a legacy final with her draft may not', () => {
    const record = draftToRecord(emptyDraft());
    expect(isCleanFinal({ kind: 'final', record, savedAt: 'x' })).toBe(true);
    expect(isCleanFinal({ kind: 'final', record, savedAt: 'x', draft: emptyDraft() })).toBe(false);
    expect(isCleanFinal({ kind: 'final', record, savedAt: 'x', escrowedHashes: [] })).toBe(false);
    expect(isCleanFinal({ kind: 'draft', savedAt: 'x' })).toBe(false);
    expect(isCleanFinal({ kind: 'final', savedAt: 'x' })).toBe(false);
  });
});

describe('resumeFrom: her draft slot first, then (no slot yet) the records saved before slots', () => {
  const opened = (id: string, createdAt: string, payload: VaultPayload): OpenedRecord =>
    ({ meta: { id, createdAt } as OpenedRecord['meta'], payload, key: {} as CryptoKey, verified: true }) as OpenedRecord;
  // one fixed time: emptyDraft() stamps startedAt/updatedAt with now, so two calls can straddle a millisecond
  const d = (n: number) => ({ ...emptyDraft(new Date('2026-01-01T00:00:00Z')), answers: { n: String(n) } }) as unknown as NonNullable<WorkingData['draft']>;
  const record = draftToRecord(emptyDraft());
  const slot = (value: Partial<LoadedDraftSlot['value']>): LoadedDraftSlot => ({
    value: { kind: 'draft', slotVersion: 1, evidence: [], savedAt: '2026-03-01T00:00:00Z', ...value },
    version: 'v3',
    updatedDay: '2026-03-01',
  });

  it('resumes from the slot after a seal, so she can add to the sealed version later', () => {
    const final = opened('f1', '2026-02-01T00:00:00Z', { kind: 'final', record, savedAt: 'x' });
    const r = resumeFrom(slot({ draft: d(7), evidence: [file('a')], sealedRecordId: 'f1' }), [final]);
    expect(r).toMatchObject({ from: 'slot', draft: d(7), final });
    expect(r.evidence.map((e) => e.blobId)).toEqual(['a']);
  });

  it('with no slot: a legacy draft record newer than the seal, else the answers a legacy seal kept', () => {
    const legacyFinal = opened('f1', '2026-02-01T00:00:00Z', { kind: 'final', record, draft: d(1), escrowedHashes: ['h1'], savedAt: 'x' });
    const newerDraft = opened('d1', '2026-02-02T00:00:00Z', { kind: 'draft', draft: d(2), evidence: [file('b')], savedAt: 'x' });
    expect(resumeFrom(null, [newerDraft, legacyFinal])).toMatchObject({ from: 'legacy', draft: d(2) });
    expect(resumeFrom(null, [legacyFinal])).toMatchObject({ from: 'legacy', draft: d(1) });
    expect(resumeFrom(null, [])).toMatchObject({ from: 'none', draft: undefined, evidence: [], escrowedHashes: [] });
  });

  it('without sealed matching, drops the matching answers and fingerprints an earlier build saved', () => {
    const g = globalThis as { __MATRA_MATCHING__?: boolean };
    const was = g.__MATRA_MATCHING__;
    g.__MATRA_MATCHING__ = false;
    onTestFinished(() => void (g.__MATRA_MATCHING__ = was));
    const withMatching = { ...d(1), answers: { 'person.escrow': { p1: 'yes' }, 'person.matchContact': { method: 'text', detail: '555-0100' }, 'about.name': 'J' } } as unknown as NonNullable<WorkingData['draft']>;
    const legacyFinal = opened('f1', '2026-02-01T00:00:00Z', { kind: 'final', record, draft: withMatching, escrowedHashes: ['h1'], savedAt: 'x' });
    for (const r of [resumeFrom(null, [legacyFinal]), resumeFrom(slot({ draft: withMatching, escrowedHashes: ['h2'] }), [legacyFinal])]) {
      expect(Object.keys(r.draft!.answers)).toEqual(['about.name']);
      expect(r.escrowedHashes).toEqual([]);
    }
  });

  it('with sealed matching on, keeps them: fingerprints from the slot, or (no slot yet) from a legacy seal', () => {
    const g = globalThis as { __MATRA_MATCHING__?: boolean };
    const was = g.__MATRA_MATCHING__;
    g.__MATRA_MATCHING__ = true;
    onTestFinished(() => void (g.__MATRA_MATCHING__ = was));
    const legacyFinal = opened('f1', '2026-02-01T00:00:00Z', { kind: 'final', record, draft: d(1), escrowedHashes: ['h1'], savedAt: 'x' });
    expect(resumeFrom(null, [legacyFinal]).escrowedHashes).toEqual(['h1']);
    expect(resumeFrom(slot({ draft: d(2), escrowedHashes: ['h2'] }), [legacyFinal]).escrowedHashes).toEqual(['h2']);
    expect(resumeFrom(slot({ draft: d(2) }), [legacyFinal]).escrowedHashes).toEqual(['h1']);
  });
});
