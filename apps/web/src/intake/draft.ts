/**
 * In-progress intake state. Plain JSON — the app shell encrypts and persists it
 * so she can stop and resume. This module never stores anything itself.
 */
import { randomId } from '@matra/crypto';
import type { StoryEntry, SuggestionDecision } from '../understand/types';
import { PHASES, STEPS, UI, type PhaseId, type ScriptStep } from './script';

export type Tri = 'yes' | 'no' | 'unsure';

export interface DateAnswer {
  mode: 'date' | 'text' | 'unsure';
  /** ISO yyyy-mm-dd when mode === 'date' */
  date?: string;
  approximate?: boolean;
  /** Her own words when mode === 'text' */
  text?: string;
}

export interface GroupItem {
  id: string;
  values: Record<string, string>;
}

/**
 * - text / longtext / choice / select / date → string (stored verbatim)
 * - multi → string[]
 * - approxDate → DateAnswer
 * - form → Record<string, string>
 * - group → GroupItem[]
 * - escrow → Record<personItemId, Tri>
 * - evidence → 'requested'
 */
export type AnswerValue = string | string[] | DateAnswer | GroupItem[] | Record<string, string>;

export interface IntakeDraft {
  draftVersion: 1;
  startedAt: string;
  updatedAt: string;
  /** Step she is currently on. */
  stepId: string;
  /** Committed answers keyed by script step id. Absent = not answered / skipped. */
  answers: Record<string, AnswerValue>;
  /** Steps she explicitly chose to skip. */
  skipped: string[];
  /** Steps she has seen (drives which sections she can jump back to). */
  visited: string[];
  /** She has reached the review screen at least once. */
  reachedReview: boolean;
  /** Unsubmitted text in the current answer box, so nothing typed is lost on a break. */
  pending?: { stepId: string; value: AnswerValue };
  /**
   * Her story, piece by piece, exactly as she typed it (or a voice transcript she reviewed).
   * Never altered by software. Encrypted with the rest of the draft.
   */
  entries?: StoryEntry[];
  /** Suggestion ids she marked "Not right" — never shown again, even after re-running understanding. */
  dismissedSuggestions?: string[];
  /** State of the "dump first" story space (src/space). Absent for drafts made only with the interview. */
  space?: SpaceState;
}

export interface SpaceState {
  /** Which way she prefers to tell it. Default: the open story space. */
  mode?: 'space' | 'interview';
  /** Suggestion id → what she decided (accepted / edited / dismissed). */
  decisions?: Record<string, SuggestionDecision>;
  /** Topic cards she chose to skip as a whole. */
  skippedTopics?: string[];
  /** Unsent text in the "Start anywhere" box, so nothing typed is lost on a break. */
  composer?: string;
  /** Unsaved answers in an open topic, so nothing typed is lost on a break. */
  pending?: Record<string, AnswerValue>;
}

export function emptyDraft(now: Date = new Date()): IntakeDraft {
  const iso = now.toISOString();
  return {
    draftVersion: 1,
    startedAt: iso,
    updatedAt: iso,
    stepId: STEPS[0].id,
    answers: {},
    skipped: [],
    visited: [STEPS[0].id],
    reachedReview: false,
  };
}

// Built lazily: script.ts and draft.ts import each other.
let stepIndex: Map<string, ScriptStep> | undefined;
export function stepById(id: string): ScriptStep | undefined {
  stepIndex ??= new Map(STEPS.map((s) => [s.id, s]));
  return stepIndex.get(id);
}

export function isVisible(d: IntakeDraft, step: ScriptStep): boolean {
  return !step.showIf || step.showIf(d);
}

/** Answer for a step, or undefined if unanswered OR the step is currently hidden by a showIf. */
export function answerOf(d: IntakeDraft, id: string): AnswerValue | undefined {
  const step = stepById(id);
  if (!step || !isVisible(d, step)) return undefined;
  return d.answers[id];
}

export function visibleSteps(d: IntakeDraft): ScriptStep[] {
  return STEPS.filter((s) => isVisible(d, s));
}

export function currentStep(d: IntakeDraft): ScriptStep {
  const s = stepById(d.stepId);
  if (s && isVisible(d, s)) return s;
  // Script changed or step hidden: fall forward to the next visible step.
  const idx = STEPS.findIndex((x) => x.id === d.stepId);
  const after = STEPS.slice(Math.max(idx, 0)).find((x) => isVisible(d, x));
  return after ?? STEPS[0];
}

export function nextStepId(d: IntakeDraft, fromId: string): string | undefined {
  const idx = STEPS.findIndex((s) => s.id === fromId);
  return STEPS.slice(idx + 1).find((s) => isVisible(d, s))?.id;
}

export function prevStepId(d: IntakeDraft, fromId: string): string | undefined {
  const idx = STEPS.findIndex((s) => s.id === fromId);
  for (let i = idx - 1; i >= 0; i--) if (isVisible(d, STEPS[i])) return STEPS[i].id;
  return undefined;
}

export function firstStepOfPhase(d: IntakeDraft, phase: PhaseId): string | undefined {
  return STEPS.find((s) => s.phase === phase && isVisible(d, s))?.id;
}

export function firstStepAfterPhase(d: IntakeDraft, phase: PhaseId): string | undefined {
  const pIdx = PHASES.findIndex((p) => p.id === phase);
  const later = new Set(PHASES.slice(pIdx + 1).map((p) => p.id));
  return STEPS.find((s) => later.has(s.phase) && isVisible(d, s))?.id;
}

export function phaseIndex(phase: PhaseId): number {
  return PHASES.findIndex((p) => p.id === phase);
}

// ───────────── type guards ─────────────

export function asText(v: AnswerValue | undefined): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}
export function asList(v: AnswerValue | undefined): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
export function asDate(v: AnswerValue | undefined): DateAnswer | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) && 'mode' in v ? (v as DateAnswer) : undefined;
}
export function asRecord(v: AnswerValue | undefined): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || 'mode' in v) return {};
  return v as Record<string, string>;
}
export function asGroup(v: AnswerValue | undefined): GroupItem[] {
  return Array.isArray(v) ? v.filter((x): x is GroupItem => typeof x === 'object' && x !== null && 'values' in x) : [];
}

export function newGroupItem(): GroupItem {
  return { id: randomId(), values: {} };
}

export function isBlank(v: AnswerValue | undefined): boolean {
  if (v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) {
    return v.every((x) => (typeof x === 'string' ? x.trim() === '' : isBlank((x as GroupItem).values)));
  }
  const d = asDate(v);
  if (d) return d.mode === 'date' ? !d.date : d.mode === 'text' ? !(d.text ?? '').trim() : false;
  return Object.values(v as Record<string, string>).every((x) => (x ?? '').trim() === '');
}

// ───────────── human-readable answer (her words, verbatim) ─────────────

function optionLabel(options: Array<{ value: string; label: string }> | undefined, value: string): string {
  return options?.find((o) => o.value === value)?.label ?? value;
}

export function formatDate(d: DateAnswer): string {
  if (d.mode === 'unsure') return UI.date.notSureSaved;
  if (d.mode === 'text') return d.text ?? '';
  return (d.date ?? '') + (d.approximate ? UI.date.approxSuffix : '');
}

/** Lines to show for an answer. Free-text values are never altered. */
export function formatAnswer(step: ScriptStep, value: AnswerValue, d: IntakeDraft): string {
  switch (step.kind) {
    case 'text':
    case 'longtext':
    case 'date':
      return typeof value === 'string' ? value : '';
    case 'choice':
    case 'select':
      return typeof value === 'string' ? optionLabel(step.options, value) : '';
    case 'multi':
      return asList(value)
        .map((v) => optionLabel(step.options, v))
        .join(', ');
    case 'approxDate': {
      const da = asDate(value);
      return da ? formatDate(da) : '';
    }
    case 'form': {
      const r = asRecord(value);
      return step.fields
        .filter((f) => (r[f.key] ?? '').trim() !== '')
        .map((f) => `${f.label}: ${f.type === 'select' || f.type === 'choice' ? optionLabel(f.options, r[f.key]) : r[f.key]}`)
        .join('\n');
    }
    case 'group':
      return asGroup(value)
        .map((item, i) => {
          const lines = step.fields
            .filter((f) => (item.values[f.key] ?? '').trim() !== '')
            .map(
              (f) =>
                `  ${f.label}: ${f.type === 'select' || f.type === 'choice' ? optionLabel(f.options, item.values[f.key]) : item.values[f.key]}`,
            );
          return [`${step.itemLabel} ${i + 1}`, ...lines].join('\n');
        })
        .join('\n\n');
    case 'escrow': {
      const r = asRecord(value);
      const people = asGroup(d.answers['person.list']);
      const labels = { yes: UI.escrow.yes, no: UI.escrow.no, unsure: UI.escrow.unsure } as Record<string, string>;
      return people
        .map((p, i) => (r[p.id] ? `${p.values.name?.trim() || `Person ${i + 1}`}: ${labels[r[p.id]] ?? r[p.id]}` : ''))
        .filter(Boolean)
        .join('\n');
    }
    case 'evidence':
      return UI.evidence.requested;
    default:
      return '';
  }
}
