/**
 * On-device understanding of a survivor's free-form "dump".
 *
 * Contract between the extraction engine (src/understand) and the story UI (src/space).
 * Rules: runs entirely in the browser (no network), never rewrites her words, and
 * every suggestion is only a proposal she confirms, edits or dismisses.
 */

/** One verbatim piece of her story, in the order she added it. */
export interface StoryEntry {
  id: string;
  createdAt: string; // ISO
  /** Her words exactly as typed, or a transcript she reviewed and accepted. Never modified by software. */
  text: string;
  source: 'typed' | 'voice';
}

/** Where in her own words a suggestion came from (character offsets into StoryEntry.text). */
export interface SourceSpan {
  entryId: string;
  start: number;
  end: number;
}

export type SuggestionKind =
  | 'incident_date'
  | 'incident_time'
  | 'location'
  | 'jurisdiction'
  | 'person_responsible'
  | 'relationship'
  | 'identifier' // email / phone / @handle of the person responsible
  | 'witness'
  | 'disclosure' // someone she told afterwards
  | 'medical_care'
  | 'forensic_exam'
  | 'prior_report'
  | 'evidence_mention' // texts, screenshots, photos, clothing kept...
  | 'substances'
  | 'force_or_threats'
  | 'strangulation'
  | 'injury'
  | 'words_spoken'
  | 'safety_concern';

export interface Suggestion {
  id: string; // stable for the same kind + source span, so dismissals persist across re-runs
  kind: SuggestionKind;
  /** Warm, plain-language line shown to her, e.g. "It sounds like this happened around March 14." */
  label: string;
  /**
   * The intake draft answer this would fill: the step id from src/intake/script.ts,
   * optionally with a sub-key (e.g. "when.date", "person.list[0].name").
   */
  target: string;
  /** Proposed value in the shape that step expects (see src/intake/draft.ts AnswerValue). */
  value: unknown;
  confidence: 'high' | 'medium' | 'low';
  sources: SourceSpan[];
}

export type SuggestionDecision = 'accepted' | 'edited' | 'dismissed';
