/**
 * Which questions a mark may point at.
 *
 * Default deny: a question can be marked only if it is listed as neutral below AND no sensitive rule matches it.
 * The sensitive rules are checked first and cannot be overridden by the bank a caller passes in, so a mis-tagged bank
 * can never turn on a mark under force, substances, drugging, strangulation, injuries or sexual acts (PLAN_REVIEW finding 7).
 *
 * ADVOCATE / COUNSEL REVIEW: this list decides what software is allowed to point at in a survivor's words. Moving any
 * question to neutral needs counsel's answer on Q-069 and an advocate's read. Changing it changes `bankVersion` in the log.
 */
import type { MarkBank, MarkBankQuestion, MarkGroup } from './types';

/** Plain factual groups. Marks may point at these and nothing else. */
export const NEUTRAL_IDS: readonly string[] = [
  'when.date',
  'when.time',
  'where.place',
  'where.address',
  'where.area',
  'people.told',
  'people.witnesses',
  'prior.any',
  'evidence.upload',
];

/**
 * Never marked, by prefix or exact id. Beyond the finding-7 groups (force, substances and incapacitation, strangulation,
 * injuries, sexual acts, consent) this holds everything near them: what she saw, heard, felt or was told in the moment,
 * the person responsible, medical care and exams, physical items (which include clothing and a condom), safety, and
 * whether it happened more than once. Kept conservative on purpose.
 */
export const SENSITIVE_PREFIXES: readonly string[] = [
  'details.',
  'medical.',
  'recall.',
  'context.',
  'person.',
  'safety.',
  'evidence.physical',
  'when.repeated',
  'when.lastDate',
  'when.ongoing',
];

export function groupOf(id: string): MarkGroup {
  if (SENSITIVE_PREFIXES.some((p) => id === p || id.startsWith(p))) return 'sensitive';
  if (NEUTRAL_IDS.includes(id)) return 'neutral';
  return 'excluded';
}

/** Engine targets that count as a neutral question other than itself. */
const EXTRA_TARGETS: Record<string, readonly string[]> = { 'prior.any': ['prior.any', 'prior.list'] };

/** A bank from a list of question ids (the intake script's step ids). Unknown ids are tagged by groupOf, so new ones start excluded. */
export function buildBank(ids: readonly string[], version: string): MarkBank {
  const questions: MarkBankQuestion[] = [...new Set(ids)].sort().map((id) => {
    const q: MarkBankQuestion = { id, group: groupOf(id) };
    if (EXTRA_TARGETS[id]) q.targets = EXTRA_TARGETS[id];
    return q;
  });
  return { version, questions };
}

/** The question an engine target belongs to: an exact id/target match first, then the longest id that prefixes the target. */
export function questionForTarget(bank: MarkBank, target: string): MarkBankQuestion | undefined {
  const exact = bank.questions.find((q) => (q.targets ?? [q.id]).includes(target));
  if (exact) return exact;
  const t = target.replace(/\[.*$/, '');
  const base = t.split('.').slice(0, 2).join('.');
  return bank.questions.find((q) => q.id === base);
}

/** Stable text form of a bank, for hashing and for the log. */
export function bankFingerprint(bank: MarkBank): string {
  return JSON.stringify([bank.version, bank.questions.map((q) => [q.id, q.group, q.targets ?? []])]);
}
