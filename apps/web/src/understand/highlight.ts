import type { SourceSpan, StoryEntry } from './types';

/** A span to mark, optionally tagged with the suggestion it came from. */
export type HighlightSpan = SourceSpan & { id?: string };

export interface Segment {
  text: string;
  start: number;
  end: number;
  /** True if any span covers this segment. */
  marked: boolean;
  /** Suggestion ids whose spans cover this segment (empty when untagged or unmarked). */
  ids: string[];
}

/**
 * Split an entry's text into consecutive segments so the UI can render her words with the
 * parts a suggestion came from marked. Joining every segment's `text` gives back `entry.text` exactly.
 * Spans for other entries are ignored; overlapping spans are split at their boundaries.
 */
export function highlight(entry: StoryEntry, spans: HighlightSpan[]): Segment[] {
  const text = entry.text;
  const own = spans
    .filter((s) => s.entryId === entry.id)
    .map((s) => ({ ...s, start: Math.max(0, Math.min(text.length, s.start)), end: Math.max(0, Math.min(text.length, s.end)) }))
    .filter((s) => s.end > s.start);
  const cuts = new Set<number>([0, text.length]);
  for (const s of own) {
    cuts.add(s.start);
    cuts.add(s.end);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (b <= a) continue;
    const covering = own.filter((s) => s.start <= a && s.end >= b);
    const ids = [...new Set(covering.map((s) => s.id).filter((x): x is string => !!x))];
    const seg: Segment = { text: text.slice(a, b), start: a, end: b, marked: covering.length > 0, ids };
    const prev = out[out.length - 1];
    // Merge neighbours with identical marking so the UI gets as few pieces as possible.
    if (prev && prev.marked === seg.marked && prev.ids.join('|') === seg.ids.join('|')) {
      prev.text += seg.text;
      prev.end = b;
    } else out.push(seg);
  }
  if (!out.length) out.push({ text, start: 0, end: text.length, marked: false, ids: [] });
  return out;
}
