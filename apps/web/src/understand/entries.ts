import type { IntakeRecord } from '@matra/shared';
import type { StoryEntry } from './types';

/**
 * Attach her story pieces (verbatim, in order) to a record. `freeRecall` becomes the pieces joined
 * with a blank line, so everything that reads `freeRecall` still sees her whole account.
 * With no non-blank entries the record is returned unchanged.
 */
export function withEntries(record: IntakeRecord, entries: StoryEntry[]): IntakeRecord {
  const kept = entries.filter((e) => e.text.trim() !== '');
  if (!kept.length) return record;
  return {
    ...record,
    narrative: {
      ...record.narrative,
      entries: kept.map((e) => ({ id: e.id, createdAt: e.createdAt, text: e.text, source: e.source })),
      freeRecall: kept.map((e) => e.text).join('\n\n'),
    },
  };
}
