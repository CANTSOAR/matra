import { describe, expect, it } from 'vitest';
import type { EvidenceItem, IntakeRecord } from '@matra/shared';
import type { ApiClient } from '../api/client';
import { draftToRecord, emptyDraft } from '../intake';
import { MatchingError, PHONE_VERIFICATION_NEEDED, foldInLateEvidence, hasUnsealedMatches, lodgeEscrow } from './vault';
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
