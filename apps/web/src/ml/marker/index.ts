/**
 * Span-marker v1: "you may have written about this".
 *
 *   markCoverage(text, bank) -> { questionId, start, end, exactSpan }[]
 *
 * Input: her text and the question bank. Output: only ids and the exact spans of her own words, each one checked by code.
 * It never writes, paraphrases, summarises, labels, scores or fills an answer, and it never points at a sensitive group.
 * A missing mark never means "you didn't write about this".
 *
 * Off by default. Nothing in this branch shows a mark to a survivor: the checklist that would (P2) does not exist yet.
 *
 * INTEGRATION CONTRACT for P2 (what the checklist must do before it may show a mark):
 *   1. Call runMarker(text, INTAKE_MARK_BANK, { optedIn, entryId }) only; it returns null unless the build has
 *      MATRA_MARKER=on AND she opted in. Never call markCoverage from a screen.
 *   2. The marker's gate (plan 8.7) is not met: see tools/eval/span-marker/results/REPORT.md. Do not turn the flag on for
 *      survivors until it passes on a fresh held-out split and counsel has answered Q-069.
 *   3. Run it on the baseline narrative only (her free recall, after it is sealed), never while she is typing: a mark that
 *      appears as she writes is a prompt, and prompts are what the prompt log exists to constrain (CHATBOT_LEGAL).
 *   4. Show, under a question, only "you may have written about this" with the exactSpan quoted. Nothing is pre-filled, no
 *      value, no label, no strength. She can open the question, dismiss the mark, or mark it "covered by my own words"
 *      (which never counts as an answer). A missing mark never means "you did not write about this". The wording needs
 *      advocate review before it ships.
 *   5. Log every shown mark and every choice with markLog.addDecision({ markId, action, at }); persist markLog.snapshot()
 *      in the draft slot and seal it with the record next to the prompt log. Nothing in the log is sent anywhere else.
 *   6. Re-run and re-check the validator output after any edit to her text: offsets belong to the exact text that was marked.
 *   7. Wipe: markLog clears on Quick exit and lock already (onWipe).
 */
import { sha256Hex } from '../verify';
import { bankFingerprint } from './bank';
import { ENABLED_QUESTIONS } from './enabled';
import { MARKER_IN_BUILD } from './flag';
import { markLog, type MarkRun } from './log';
import { RULES_ENGINE_ID, RULES_ENGINE_VERSION, rulesCandidates, type RulesOptions } from './rules';
import { validateMarks, type ValidationResult } from './validate';
import type { Mark, MarkBank } from './types';

const ENABLED_SET: ReadonlySet<string> = new Set(ENABLED_QUESTIONS);

export { ENABLED_QUESTIONS } from './enabled';
export type { Mark, MarkBank, MarkCandidate, MarkGroup, DropReason, DropCounts } from './types';
export { MARKER_IN_BUILD } from './flag';
export { buildBank, groupOf, NEUTRAL_IDS, SENSITIVE_PREFIXES } from './bank';
export { validateMarks } from './validate';
export { markLog, createMarkLog, type MarkRun, type MarkDecision } from './log';

export interface MarkOptions extends RulesOptions {
  /**
   * Questions allowed to produce marks. Default: ENABLED_QUESTIONS, the ones that cleared the eval gate on the dev split.
   * Pass null for every neutral question (the eval harness does, to measure each one).
   */
  enabled?: ReadonlySet<string> | null;
}

/** The marks for her text. Pure and synchronous; no flag check (the eval and tests call this directly). */
export function markCoverage(text: string, bank: MarkBank, opts: MarkOptions = {}): Mark[] {
  return markWithStats(text, bank, opts).marks;
}

/** Same as markCoverage, with the validator's drop counts (the eval harness reports them). */
export function markWithStats(text: string, bank: MarkBank, opts: MarkOptions = {}): ValidationResult {
  const enabled = opts.enabled === undefined ? ENABLED_SET : opts.enabled;
  return validateMarks(text, bank, rulesCandidates(text, bank, opts), enabled);
}

/**
 * Run the marker and write the run to the local log (plan 8.11). Returns null when the marker is not in this build or
 * the caller has not got her opt-in: the checklist then behaves exactly as without it.
 */
export async function runMarker(
  text: string,
  bank: MarkBank,
  o: { optedIn: boolean; entryId?: string; now?: Date; log?: typeof markLog; force?: boolean },
): Promise<{ marks: Mark[]; run: MarkRun } | null> {
  if (!(o.force || MARKER_IN_BUILD) || !o.optedIn) return null;
  const startedAt = new Date().toISOString();
  const res = markWithStats(text, bank, { now: o.now });
  const enc = new TextEncoder();
  const [bankHash, narrativeHash] = await Promise.all([sha256Hex(enc.encode(bankFingerprint(bank))), sha256Hex(enc.encode(text))]);
  const runId = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const run: MarkRun = {
    runId,
    engine: RULES_ENGINE_ID,
    engineVersion: RULES_ENGINE_VERSION,
    backend: 'rules',
    bankVersion: bank.version,
    bankHash,
    narrativeHash,
    startedAt,
    finishedAt: new Date().toISOString(),
    droppedByValidator: res.dropped,
    droppedByReason: res.droppedByReason,
    marks: res.marks.map((m, i) => ({ markId: `${runId}:${i}`, questionId: m.questionId, ...(o.entryId ? { entryId: o.entryId } : {}), start: m.start, end: m.end })),
  };
  (o.log ?? markLog).addRun(run);
  return { marks: res.marks, run };
}
