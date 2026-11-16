/**
 * Shared types for the span-marker ("you may have written about this").
 *
 * The marker's whole output is `Mark[]`: a question id plus the exact span of HER text, checked by code. It never
 * writes, paraphrases, scores or fills an answer (CHATBOT_LEGAL; plan 8.3; PLAN_REVIEW findings 7 and 10).
 */

/**
 * - neutral: a plain factual group (when, where, who she told, who was there, earlier reports, files she has). The
 *   only groups a mark may point at.
 * - sensitive: force, substances or drugging, strangulation, injuries, sexual acts, and anything near them. Never marked,
 *   whatever an engine says (PLAN_REVIEW finding 7: marking them is software inferring what happened).
 * - excluded: not a topic at all (contact details, goals, notices). Never marked.
 */
export type MarkGroup = 'neutral' | 'sensitive' | 'excluded';

export interface MarkBankQuestion {
  id: string;
  group: MarkGroup;
  /** Engine targets that count as this question (default: its own id). e.g. prior.any is marked by the prior.list target. */
  targets?: readonly string[];
}

export interface MarkBank {
  /** Changes whenever a question is added, removed or moves group. Logged with every run. */
  version: string;
  questions: readonly MarkBankQuestion[];
}

/** What an engine proposes. Offsets index into the exact text that was passed in. */
export interface MarkCandidate {
  questionId: string;
  start: number;
  end: number;
  /** The engine's own claim of what the span says; the validator compares it with the text. */
  exactSpan: string;
}

/** A mark that passed the validator. */
export interface Mark {
  questionId: string;
  start: number;
  end: number;
  /** Always equal to text.slice(start, end): her words, unchanged. */
  exactSpan: string;
}

export type DropReason =
  | 'unknown-question'
  | 'sensitive-group'
  | 'excluded-group'
  | 'disabled-question'
  | 'bad-offsets'
  | 'not-exact-substring'
  | 'empty-or-whitespace'
  | 'too-long'
  | 'negated'
  | 'hypothetical'
  | 'quoted'
  | 'reported-speech'
  | 'other-actor'
  | 'sensitive-context'
  | 'ambiguous-clause'
  | 'split-character'
  | 'duplicate'
  | 'over-limit';

export type DropCounts = Partial<Record<DropReason, number>>;
