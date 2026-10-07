// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { IntakeRecord } from '@matra/shared';
import { briefSections, generateIncidentSummary, VOICE_ENTRY_NOTE } from './index';
import { sampleBriefOptions, sampleRecord } from './fixtures';

const ENTRIES: NonNullable<IntakeRecord['narrative']['entries']> = [
  { id: 'a', createdAt: '2026-10-03T18:00:00.000Z', text: 'the hospital part first.\n\ni went to urgent care the day after.  ', source: 'typed' },
  { id: 'b', createdAt: '2026-10-05T09:30:00.000Z', text: 'um so it was like three weeks ago — he said “nobody will know” 😶', source: 'voice' },
  { id: 'c', createdAt: '2026-10-06T12:00:00.000Z', text: '   ', source: 'typed' },
];

function withEntries(entries = ENTRIES): IntakeRecord {
  return {
    ...sampleRecord,
    narrative: { ...sampleRecord.narrative, entries, freeRecall: entries.map((e) => e.text).join('\n\n') },
  };
}

describe('brief: story entries', () => {
  it('renders each entry verbatim, in order, with the date she added it', () => {
    const nar = briefSections(withEntries(), sampleBriefOptions).find((s) => s.id === 'narrative')!;
    const verb = nar.blocks.filter((b) => b.kind === 'verbatim');
    expect(verb.map((b) => b.kind === 'verbatim' && b.text)).toEqual([ENTRIES[0].text, ENTRIES[1].text]); // blank piece skipped
    expect(verb.map((b) => b.kind === 'verbatim' && b.label)).toEqual([
      'Part 1 of 2 — Added October 3, 2026, 18:00 UTC',
      'Part 2 of 2 — Added October 5, 2026, 09:30 UTC',
    ]);
  });

  it('marks spoken entries, and only those', () => {
    const nar = briefSections(withEntries(), sampleBriefOptions).find((s) => s.id === 'narrative')!;
    const kinds = nar.blocks.map((b) => (b.kind === 'note' ? `note:${b.text}` : b.kind));
    expect(VOICE_ENTRY_NOTE).toBe('Spoken, transcribed on her device, and reviewed by her before saving.');
    // note (intro), verbatim (typed), verbatim (voice), voice note
    expect(kinds.slice(1)).toEqual(['verbatim', 'verbatim', `note:${VOICE_ENTRY_NOTE}`]);
  });

  it('a single typed entry has no "Part" numbering and no voice note', () => {
    const one = [ENTRIES[0]];
    const nar = briefSections(withEntries(one)).find((s) => s.id === 'narrative')!;
    const v = nar.blocks.find((b) => b.kind === 'verbatim');
    expect(v && v.kind === 'verbatim' && v.label).toBe('Added October 3, 2026, 18:00 UTC');
    expect(nar.blocks.some((b) => b.kind === 'note' && b.text === VOICE_ENTRY_NOTE)).toBe(false);
  });

  it('falls back to freeRecall when there are no entries (older records)', () => {
    const nar = briefSections(sampleRecord).find((s) => s.id === 'narrative')!;
    const v = nar.blocks.find((b) => b.kind === 'verbatim');
    expect(v && v.kind === 'verbatim' && v.text).toBe(sampleRecord.narrative.freeRecall);
    expect(v && v.kind === 'verbatim' && v.label).toBeUndefined();
  });

  it('generates a PDF with entries', async () => {
    const bytes = await generateIncidentSummary(withEntries(), sampleBriefOptions);
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
  });
});
