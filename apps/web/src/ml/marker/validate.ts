/**
 * The single choke point between any engine and anything she can see or any log. Whatever proposes marks (the rule
 * engine today, a model later), its output goes through validateMarks, and anything that fails a check is dropped and
 * counted. Nothing is repaired, shifted or "fixed up": a mark is either exactly right or it is gone.
 *
 * Checks, in order:
 *   1. the question is in the bank, and its group is neutral (never sensitive: PLAN_REVIEW finding 7; never excluded);
 *      the sensitive prefixes in bank.ts are re-applied here even if the bank passed in says otherwise
 *      and, when a list of enabled questions is given, that the question cleared the eval gate (plan 8.7: a question whose
 *      precision is under the bar has its marks switched off)
 *   2. offsets are integers with 0 <= start < end <= text.length, and both ends sit on a grapheme boundary (a mark never
 *      cuts a surrogate pair, a combining accent or an emoji sequence)
 *   3. exactSpan === text.slice(start, end), character for character (so it is her exact words)
 *   4. the span is not blank, and not a whole paragraph (it must point at a phrase)
 *   5. the clause guards (negation.ts): negated, hypothetical, quoted, reported speech, someone else's action
 *   6. no overlapping duplicate for the same question; at most MAX_MARKS_PER_QUESTION per question. The per-question limit and
 *      MAX_CANDIDATES_PER_QUESTION are applied BEFORE the clause guards, so a long text cannot make every candidate pay for them
 */
import { groupOf } from './bank';
import { boundaryChecker } from './grapheme';
import { dropReasonFor, quoteRanges } from './negation';
import type { DropCounts, DropReason, Mark, MarkBank, MarkCandidate } from './types';

export const MAX_MARKS_PER_QUESTION = 2;
/** A mark points at a phrase, not a passage. */
export const MAX_SPAN_CHARS = 160;
/** Candidates per question that reach the clause guards (reading order). The rest are dropped as over-limit. */
export const MAX_CANDIDATES_PER_QUESTION = 25;

export interface ValidationResult {
  marks: Mark[];
  dropped: number;
  droppedByReason: DropCounts;
}

export function validateMarks(text: string, bank: MarkBank, candidates: readonly MarkCandidate[], enabled?: ReadonlySet<string> | null): ValidationResult {
  const byQuestion = new Map(bank.questions.map((q) => [q.id, q]));
  const droppedByReason: DropCounts = {};
  const drop = (r: DropReason) => {
    droppedByReason[r] = (droppedByReason[r] ?? 0) + 1;
  };
  const kept: Mark[] = [];
  const keptCount = new Map<string, number>();
  const evaluated = new Map<string, number>();
  const isBoundary = boundaryChecker(text);
  let quotes: Array<[number, number]> | undefined;
  // reading order, so "at most two per question" keeps the earliest and results do not depend on engine order
  const ordered = [...candidates].sort((a, b) => a.start - b.start || a.end - b.end || (a.questionId < b.questionId ? -1 : 1));
  for (const c of ordered) {
    const q = typeof c.questionId === 'string' ? byQuestion.get(c.questionId) : undefined;
    if (!q) {
      drop('unknown-question');
      continue;
    }
    // the bank's own tag AND the built-in rules: the stricter wins
    const builtIn = groupOf(q.id);
    if (q.group === 'sensitive' || builtIn === 'sensitive') {
      drop('sensitive-group');
      continue;
    }
    if (q.group !== 'neutral' || builtIn !== 'neutral') {
      drop('excluded-group');
      continue;
    }
    if (enabled && !enabled.has(c.questionId)) {
      drop('disabled-question');
      continue;
    }
    if (!Number.isInteger(c.start) || !Number.isInteger(c.end) || c.start < 0 || c.end <= c.start || c.end > text.length) {
      drop('bad-offsets');
      continue;
    }
    if (typeof c.exactSpan !== 'string' || text.slice(c.start, c.end) !== c.exactSpan) {
      drop('not-exact-substring');
      continue;
    }
    if (!/\S/.test(c.exactSpan)) {
      drop('empty-or-whitespace');
      continue;
    }
    if (c.exactSpan.length > MAX_SPAN_CHARS) {
      drop('too-long');
      continue;
    }
    if (!isBoundary(c.start) || !isBoundary(c.end)) {
      drop('split-character');
      continue;
    }
    if (kept.some((m) => m.questionId === c.questionId && m.start < c.end && c.start < m.end)) {
      drop('duplicate');
      continue;
    }
    const nKept = keptCount.get(c.questionId) ?? 0;
    const nEval = evaluated.get(c.questionId) ?? 0;
    if (nKept >= MAX_MARKS_PER_QUESTION || nEval >= MAX_CANDIDATES_PER_QUESTION) {
      drop('over-limit');
      continue;
    }
    evaluated.set(c.questionId, nEval + 1);
    quotes ??= quoteRanges(text);
    const reason = dropReasonFor(text, c.start, c.end, c.questionId, quotes);
    if (reason) {
      drop(reason);
      continue;
    }
    keptCount.set(c.questionId, nKept + 1);
    kept.push({ questionId: c.questionId, start: c.start, end: c.end, exactSpan: c.exactSpan });
  }
  const dropped = Object.values(droppedByReason).reduce((n, v) => n + (v ?? 0), 0);
  return { marks: kept, dropped, droppedByReason };
}
