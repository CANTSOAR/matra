/**
 * Merge a confirmed (or edited) suggestion into the intake draft. Pure: returns a new draft.
 * - scalar answers (choice / text / date) are set;
 * - longer "in your words" answers get her phrase appended (never replaced);
 * - multi-choice answers are unioned;
 * - forms are merged field by field;
 * - repeatable groups (people, witnesses, people told, reports) add a new item or fill in an existing one.
 * Steps hidden behind a follow-up (e.g. "Where did you get care?") get the answer that reveals them.
 */
import { asDate, asGroup, asList, asRecord, stepById, type AnswerValue, type DateAnswer, type GroupItem, type IntakeDraft } from '../intake/draft';
import type { Suggestion } from './types';

/** Which field identifies "the same person / report" in each repeatable group. */
const IDENTITY: Record<string, string> = {
  'person.list': 'name',
  'people.witnesses': 'name',
  'people.told': 'toWhom',
  'prior.list': 'agency',
};
/** Groups where an unnamed detail ("my coworker", a phone number) usually belongs to the item already there. */
const MERGE_UNNAMED = new Set(['person.list', 'prior.list']);

/** Answers that must be in place for a follow-up step to be shown (and kept by draftToRecord). */
const PREREQS: Record<string, Array<[string, string[]]>> = {
  'medical.facility': [['medical.care', ['yes']]],
  'medical.date': [['medical.care', ['yes']]],
  'medical.exam': [['medical.care', ['yes']]],
  'medical.kit': [['medical.care', ['yes']], ['medical.exam', ['yes']]],
  'prior.list': [['prior.any', ['yes', 'unsure']]],
  'when.lastDate': [['when.repeated', ['yes']]],
  'when.ongoing': [['when.repeated', ['yes', 'unsure']]],
};

function parseTarget(target: string): { stepId: string; index?: number; key?: string } {
  if (stepById(target)) return { stepId: target };
  const m = /^(.+?)\[(\d+)\](?:\.(.+))?$/.exec(target);
  if (m && stepById(m[1])) return { stepId: m[1], index: Number(m[2]), key: m[3] };
  const dot = target.lastIndexOf('.');
  if (dot > 0 && stepById(target.slice(0, dot))) return { stepId: target.slice(0, dot), key: target.slice(dot + 1) };
  return { stepId: target };
}

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase().replace(/^(?:my|our|the|a|an)\s+/, '').replace(/[.\s]+$/, '');

function toStrings(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (typeof x === 'string' && x.trim() !== '') out[k] = x;
  }
  return out;
}

function mergeGroup(stepId: string, items: GroupItem[], incoming: Record<string, string>, newId: string, index?: number): GroupItem[] {
  const idKey = IDENTITY[stepId];
  const conflicts = (it: GroupItem) =>
    Object.entries(incoming).some(([k, v]) => {
      const cur = it.values[k];
      return cur !== undefined && cur.trim() !== '' && norm(cur) !== norm(v);
    });
  let at = -1;
  if (index !== undefined && index < items.length) at = index;
  else if (idKey && incoming[idKey]) {
    at = items.findIndex((it) => norm(it.values[idKey]) === norm(incoming[idKey]));
    if (at < 0 && MERGE_UNNAMED.has(stepId)) at = items.findIndex((it) => !(it.values[idKey] ?? '').trim() && !conflicts(it));
  } else if (MERGE_UNNAMED.has(stepId)) {
    at = items.findIndex((it) => !conflicts(it));
  } else {
    // Same details already there? Then there's nothing to add.
    at = items.findIndex((it) => Object.entries(incoming).every(([k, v]) => norm(it.values[k]) === norm(v)));
  }
  if (at < 0) {
    let id = newId;
    while (items.some((it) => it.id === id)) id += '_';
    return [...items, { id, values: { ...incoming } }];
  }
  const it = items[at];
  const values = { ...it.values };
  for (const [k, v] of Object.entries(incoming)) {
    const cur = values[k];
    if (cur === undefined || cur.trim() === '') values[k] = v;
    else if (index !== undefined) values[k] = v; // she edited this exact item
    else if (isLongField(stepId, k) && !cur.includes(v)) values[k] = `${cur}\n\n${v}`;
  }
  return items.map((x, i) => (i === at ? { ...x, values } : x));
}

function isLongField(stepId: string, key: string): boolean {
  const step = stepById(stepId);
  if (!step || step.kind !== 'group') return false;
  return step.fields.find((f) => f.key === key)?.type === 'longtext';
}

function isDateAnswer(v: unknown): v is DateAnswer {
  return !!v && typeof v === 'object' && 'mode' in (v as object) && ['date', 'text', 'unsure'].includes((v as DateAnswer).mode);
}

export function applySuggestion(draft: IntakeDraft, s: Suggestion, editedValue?: unknown): IntakeDraft {
  const value = editedValue !== undefined ? editedValue : s.value;
  const { stepId, index, key } = parseTarget(s.target);
  const step = stepById(stepId);
  if (!step) return draft;
  const answers: Record<string, AnswerValue> = { ...draft.answers };
  const cur = answers[stepId];
  let next: AnswerValue | undefined;

  switch (step.kind) {
    case 'text':
    case 'date':
    case 'choice':
    case 'select':
      if (typeof value === 'string' && value.trim() !== '') next = value;
      break;
    case 'longtext': {
      if (typeof value !== 'string' || value.trim() === '') break;
      const existing = typeof cur === 'string' ? cur : '';
      next = existing.trim() === '' ? value : existing.includes(value) ? existing : `${existing}\n\n${value}`;
      break;
    }
    case 'multi': {
      const add = Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : typeof value === 'string' ? [value] : [];
      if (!add.length) break;
      const list = asList(cur);
      next = [...list, ...add.filter((x) => !list.includes(x))];
      break;
    }
    case 'approxDate':
      if (isDateAnswer(value)) next = { ...value };
      else if (typeof value === 'string' && value.trim() !== '') next = /^\d{4}-\d{2}-\d{2}$/.test(value) ? { mode: 'date', date: value } : { mode: 'text', text: value };
      else if (asDate(cur) === undefined) next = undefined;
      break;
    case 'form': {
      const incoming = key ? (typeof value === 'string' ? { [key]: value } : {}) : toStrings(value);
      if (!Object.keys(incoming).length) break;
      next = { ...asRecord(cur), ...incoming };
      break;
    }
    case 'group': {
      const incoming = key ? (typeof value === 'string' ? { [key]: value } : {}) : toStrings(value);
      if (!Object.keys(incoming).length) break;
      next = mergeGroup(stepId, asGroup(cur), incoming, `sg-${s.id}`, index);
      break;
    }
    case 'evidence':
      next = 'requested';
      break;
    case 'escrow':
      next = { ...asRecord(cur), ...toStrings(value) };
      break;
    default:
      break;
  }
  if (next === undefined) return draft;
  answers[stepId] = next;

  const touched = [stepId];
  for (const [pre, allowed] of PREREQS[stepId] ?? []) {
    const v = answers[pre];
    if (typeof v !== 'string' || !allowed.includes(v)) {
      answers[pre] = allowed[0];
      touched.push(pre);
    }
  }
  return {
    ...draft,
    answers,
    skipped: draft.skipped.filter((id) => !touched.includes(id)),
  };
}

/** Is this suggestion's value already in the draft (so the UI needn't offer it again)? */
export function isApplied(draft: IntakeDraft, s: Suggestion): boolean {
  const after = applySuggestion(draft, s);
  return JSON.stringify(after.answers) === JSON.stringify(draft.answers);
}
