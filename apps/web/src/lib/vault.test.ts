import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@matra/shared';
import { foldInLateEvidence } from './vault';
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
