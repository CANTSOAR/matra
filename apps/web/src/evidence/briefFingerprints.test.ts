import { describe, expect, it } from 'vitest';
import { briefSections } from '../brief/sections';
import { sampleRecord } from '../brief/fixtures';
import type { BriefBlock } from '../brief/types';

const table = (b: BriefBlock[]) => b.find((x) => x.kind === 'table') as Extract<BriefBlock, { kind: 'table' }>;

describe('Evidence Inventory in the PDF: salted fingerprints', () => {
  const evidence = briefSections(sampleRecord).find((s) => s.id === 'evidence')!;
  const first = sampleRecord.evidence[0]!;
  const fp = 'f'.repeat(64);

  it('is unchanged when no fingerprints are given', () => {
    expect(table(evidence.blocks).rows[0]!.detail).toEqual({ label: 'SHA-256', value: first.sha256, mono: true });
    expect(JSON.stringify(evidence)).not.toContain('Salted fingerprint');
  });

  it('lists the salted fingerprint beside the SHA-256 and says what it does and does not show; never a salt', () => {
    const withFp = briefSections(sampleRecord, { exhibitFingerprints: { [first.id]: fp } }).find((s) => s.id === 'evidence')!;
    const row = table(withFp.blocks).rows[0]!;
    expect(row.detail!.value).toContain(first.sha256);
    expect(row.detail!.value).toContain(`Salted fingerprint of the original file: ${fp}`);
    const note = withFp.blocks.map((b) => ('text' in b ? b.text : '')).join('\n');
    expect(note).toMatch(/can be checked only by someone she gives that value to/);
    expect(note).toMatch(/does not show that the copy listed above came from that file/);
    // files without a fingerprint are listed as before
    expect(table(withFp.blocks).rows[1]!.detail).toEqual({ label: 'SHA-256', value: sampleRecord.evidence[1]!.sha256, mono: true });
  });
});
