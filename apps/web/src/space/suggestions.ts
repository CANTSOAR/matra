/** Grouping and source snippets for "What I picked up". Pure. */
import type { SourceSpan, StoryEntry, Suggestion, SuggestionKind } from '../understand/types';
import type { TopicId } from './topics';

export interface SuggestionGroup {
  id: string;
  title: string;
  /** The topic where she can see or change this later. */
  topic: TopicId;
  kinds: SuggestionKind[];
}

export const SUGGESTION_GROUPS: SuggestionGroup[] = [
  { id: 'when', title: 'When', topic: 'whenWhere', kinds: ['incident_date', 'incident_time'] },
  { id: 'where', title: 'Where', topic: 'whenWhere', kinds: ['location', 'jurisdiction'] },
  { id: 'person', title: 'The person', topic: 'person', kinds: ['person_responsible', 'relationship', 'identifier'] },
  { id: 'told', title: 'People you told', topic: 'people', kinds: ['disclosure'] },
  { id: 'there', title: 'People who were there', topic: 'people', kinds: ['witness'] },
  { id: 'care', title: 'Care you got', topic: 'care', kinds: ['medical_care', 'forensic_exam', 'injury'] },
  { id: 'kept', title: "Things you've kept", topic: 'kept', kinds: ['evidence_mention'] },
  { id: 'reports', title: 'Earlier reports', topic: 'reports', kinds: ['prior_report'] },
  {
    id: 'details',
    title: 'Things you mentioned',
    topic: 'details',
    kinds: ['substances', 'force_or_threats', 'strangulation', 'words_spoken'],
  },
  { id: 'safety', title: 'Your safety', topic: 'safety', kinds: ['safety_concern'] },
];

export function groupOf(kind: SuggestionKind): SuggestionGroup {
  return SUGGESTION_GROUPS.find((g) => g.kinds.includes(kind)) ?? SUGGESTION_GROUPS[SUGGESTION_GROUPS.length - 1];
}

export function groupSuggestions(list: Suggestion[]): Array<{ group: SuggestionGroup; items: Suggestion[] }> {
  return SUGGESTION_GROUPS.map((group) => ({ group, items: list.filter((s) => groupOf(s.kind).id === group.id) })).filter(
    (g) => g.items.length > 0,
  );
}

export interface Snippet {
  entryId: string;
  before: string;
  match: string;
  after: string;
  /** Text was cut at the start / end. */
  clippedStart: boolean;
  clippedEnd: boolean;
}

/**
 * The bit of her own words a suggestion came from, with a little context either side.
 * Her text is sliced, never changed.
 */
export function snippetFor(entries: StoryEntry[], span: SourceSpan, context = 48): Snippet | undefined {
  const e = entries.find((x) => x.id === span.entryId);
  if (!e) return undefined;
  const start = Math.max(0, Math.min(span.start, e.text.length));
  const end = Math.max(start, Math.min(span.end, e.text.length));
  let from = Math.max(0, start - context);
  let to = Math.min(e.text.length, end + context);
  // Prefer to cut at a space, so words are not chopped in half.
  if (from > 0) {
    const sp = e.text.lastIndexOf(' ', from);
    from = sp === -1 ? 0 : sp + 1;
  }
  if (to < e.text.length) {
    const sp = e.text.lastIndexOf(' ', to);
    if (sp > end) to = sp;
  }
  // Stay inside her paragraph: a snippet never spills over a line break.
  const nlBefore = e.text.lastIndexOf('\n', start - 1);
  if (nlBefore >= from) from = nlBefore + 1;
  const nlAfter = e.text.indexOf('\n', end);
  if (nlAfter !== -1 && nlAfter < to) to = nlAfter;
  return {
    entryId: e.id,
    before: e.text.slice(from, start),
    match: e.text.slice(start, end),
    after: e.text.slice(end, to),
    clippedStart: from > 0,
    clippedEnd: to < e.text.length,
  };
}
