import { describe, expect, it } from 'vitest';
import type { EvidenceItem, IntakeRecord } from '@matra/shared';
import type { ApiClient } from '../api/client';
import { draftToRecord, emptyDraft } from '../intake';
import { DEFAULT_KDF_ITERATIONS, deriveKeys, newKdfSalt } from '@matra/crypto';
import { MatchingError, PHONE_VERIFICATION_NEEDED, foldInLateEvidence, hasUnsealedMatches, loadVault, lodgeEscrow, resumeFrom, sealPayload, unreadableNotice } from './vault';
import type { WorkingData } from './session';

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

describe('loadVault: records that fail to open are counted, not dropped silently', () => {
  it('reports how many saved versions could not be opened, so a resumed draft is never silently an older one', async () => {
    const { masterKey } = await deriveKeys('vault test passphrase words', newKdfSalt(), Math.min(DEFAULT_KDF_ITERATIONS, 1000));
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
        if (id === 'r2') throw new Error('network');
        const r = records.find((x) => x.id === id);
        // r3's ciphertext was damaged: it no longer decrypts
        return { record: id === 'r3' ? { ...r, envelope: { ...r.envelope, ct: r.envelope.ct.slice(0, -8) + 'AAAAAAA=' } } : r };
      },
    } as unknown as ApiClient;
    const draft = (n: number) => ({ answers: { n } }) as unknown as NonNullable<WorkingData['draft']>;
    const first = await sealPayload(api, masterKey, { kind: 'draft', draft: draft(1), savedAt: '2026-01-01T00:00:00Z' });
    const second = await sealPayload(api, masterKey, { kind: 'draft', draft: draft(2), savedAt: '2026-01-01T00:01:00Z' }, first.record.id);
    await sealPayload(api, masterKey, { kind: 'draft', draft: draft(3), savedAt: '2026-01-01T00:02:00Z' }, second.record.id);

    const vault = await loadVault(api, masterKey, { withLedger: false });
    expect(vault.map((r) => r.meta.id)).toEqual(['r1']);
    expect(vault.unreadable).toBe(2);
    // what she would resume from is the oldest version: the screen must say so
    expect(resumeFrom(vault).draft).toEqual(draft(1));
    expect(unreadableNotice(vault.unreadable)).toMatch(/couldn’t open 2 saved versions.*may not be your newest save/);
    expect(unreadableNotice(1)).toMatch(/one saved version/);
    expect(unreadableNotice(0)).toBeNull();
  });
});

describe('foldInLateEvidence', () => {
  const draft = { answers: { mine: true } } as unknown as WorkingData['draft'];
  const story: WorkingData = { draft, evidence: [file('a')], savedDraftRecordId: 'r1' };

  it('adds files saved after the story opened, keeps her draft, and follows the newer draft record', () => {
    const mem: WorkingData = { draft: null, evidence: [file('a'), file('b')], savedDraftRecordId: 'r2' };
    const next = foldInLateEvidence(story, mem)!;
    expect(next.evidence.map((e) => e.blobId)).toEqual(['a', 'b']);
    expect(next.draft).toBe(draft);
    expect(next.savedDraftRecordId).toBe('r2');
  });

  it('returns null when nothing is new (including the story’s own saves)', () => {
    expect(foldInLateEvidence(story, null)).toBeNull();
    expect(foldInLateEvidence(story, { ...story, savedDraftRecordId: 'r9' })).toBeNull();
    expect(foldInLateEvidence(story, { draft: null, evidence: [] })).toBeNull();
  });

  it('never drops a file the story has that the in-memory copy lacks', () => {
    const mem: WorkingData = { draft: null, evidence: [file('c')] };
    const next = foldInLateEvidence(story, mem)!;
    expect(next.evidence.map((e) => e.blobId)).toEqual(['a', 'c']);
    expect(next.savedDraftRecordId).toBe('r1');
  });
});

describe('lodgeEscrow: phone verify-then-forget gate (W13)', () => {
  // A record that opted one person's email into a sealed match, with a safe way to reach her.
  const record = {
    ...draftToRecord(emptyDraft(new Date('2026-01-01T00:00:00Z'))),
    perpetrators: [{ name: 'R.', escrowOptIn: true, identifiers: [{ kind: 'email', value: 'someone@example.com' }] }],
  } as unknown as IntakeRecord;
  const contact = { method: 'text', detail: '(201) 555-0100' };
  const api = (status: { required: boolean; verified: boolean }) => {
    const calls: string[] = [];
    const fake = {
      phoneVerificationStatus: async () => (calls.push('status'), status),
      matchingConfig: async () => {
        calls.push('config');
        throw new Error('stop here');
      },
    } as unknown as ApiClient;
    return { fake, calls };
  };

  it('asks for a phone confirmation before contacting any key holder, and seals nothing', async () => {
    const { fake, calls } = api({ required: true, verified: false });
    const err = await lodgeEscrow(fake, {} as CryptoKey, record, [], { contact }).catch((e) => e);
    expect(err).toBeInstanceOf(MatchingError);
    expect(err.code).toBe('phone_verification_required');
    expect(err.message).toBe(PHONE_VERIFICATION_NEEDED);
    expect(calls).toEqual(['status']);
  });

  it('goes on to seal once verified (or when the server does not require it)', async () => {
    for (const st of [{ required: true, verified: true }, { required: false, verified: false }]) {
      const { fake, calls } = api(st);
      await expect(lodgeEscrow(fake, {} as CryptoKey, record, [], { contact })).rejects.toThrow('stop here');
      expect(calls).toEqual(['status', 'config']);
    }
  });

  it('knows when her sealed record still has something to seal', async () => {
    expect(await hasUnsealedMatches(record)).toBe(true);
    expect(await hasUnsealedMatches(undefined)).toBe(false);
    const { fake } = api({ required: false, verified: false });
    expect(await lodgeEscrow(fake, {} as CryptoKey, { ...record, perpetrators: [] }, ['x'])).toEqual(['x']);
  });
});
