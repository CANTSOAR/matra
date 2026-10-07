/**
 * Thin seam between the story space and two modules built in parallel by other agents:
 *   - src/understand  (on-device extraction: understand / applySuggestion / withEntries)
 *   - src/voice       (on-device transcription: VoiceCapture / isVoiceSupported / preloadTranscriber)
 *
 * `import.meta.glob` resolves to {} when a module does not exist yet, so this file builds either way and
 * switches to the real module automatically the moment it lands. Everything marked TEMP is a minimal
 * stand-in, only used while the real module is missing.
 */
import { createElement, lazy, Suspense, type ComponentType } from 'react';
import { Loading } from '../components/common';
import type { IntakeRecord } from '@matra/shared';
import type { ApiClient } from '../api/client';
import * as vault from '../lib/vault';
import { asGroup, asList, asRecord, newGroupItem, stepById, type AnswerValue, type IntakeDraft } from '../intake/draft';
import type { StoryEntry, Suggestion } from '../understand/types';
import type { TranscriptResult } from '../voice/types';

export interface UnderstandOptions {
  now?: Date;
  dismissed?: string[];
}

interface UnderstandModule {
  understand(entries: StoryEntry[], opts?: UnderstandOptions): Suggestion[];
  applySuggestion(draft: IntakeDraft, s: Suggestion, edited?: unknown): IntakeDraft;
  withEntries(record: IntakeRecord, entries: StoryEntry[]): IntakeRecord;
}

export interface VoiceCaptureProps {
  onTranscript: (r: TranscriptResult, audio: Blob) => void;
  onCancel: () => void;
}

interface VoiceModule {
  VoiceCapture: ComponentType<VoiceCaptureProps>;
  isVoiceSupported(): boolean;
  preloadTranscriber(onProgress?: (pct: number) => void): Promise<void>;
}

const understandMods = import.meta.glob<Partial<UnderstandModule>>('../understand/index.ts', { eager: true });
// Voice is NOT eager: its code (recorder, transcription client) loads only when she taps to talk. The model itself
// is a separate, one-time download the voice module asks her about first.
const voiceLoaders = import.meta.glob<Partial<VoiceModule>>('../voice/index.ts');
const realUnderstand = understandMods['../understand/index.ts'];
const loadVoice = voiceLoaders['../voice/index.ts'] as (() => Promise<Partial<VoiceModule>>) | undefined;

/** Which adapters are real (for tests, the report, and a dev hint). */
export const adapterStatus = {
  understand: typeof realUnderstand?.understand === 'function',
  applySuggestion: typeof realUnderstand?.applySuggestion === 'function',
  withEntries: typeof realUnderstand?.withEntries === 'function',
  voice: typeof loadVoice === 'function',
};

// ───────────── understand ─────────────

/** TEMP: finds nothing. The real engine proposes dates, places, people… from her words, on this device. */
function tempUnderstand(): Suggestion[] {
  return [];
}

/**
 * Write a value into the draft at a suggestion target: a step id, optionally followed by a sub-key —
 * ".key" for a form field, "[i].key" for an item of a repeatable group. Multi-select values are merged.
 * Also used as the TEMP applySuggestion.
 */
export function writeTarget(draft: IntakeDraft, target: string, value: unknown): IntakeDraft {
  // Step ids contain dots ("when.date"), so match the longest known step id prefix.
  const parts = target.split('.');
  let stepId = '';
  let rest = '';
  for (let i = parts.length; i > 0; i--) {
    const head = parts.slice(0, i).join('.');
    const m = /^([^[]+)(\[\d+\])?$/.exec(head);
    const candidate = m?.[1] ?? head;
    if (stepById(candidate)) {
      stepId = candidate;
      rest = (m?.[2] ?? '') + (i < parts.length ? '.' + parts.slice(i).join('.') : '');
      break;
    }
  }
  if (!stepId) return draft;
  const step = stepById(stepId)!;
  const answers = { ...draft.answers };
  const prev = answers[stepId];
  const group = /^\[(\d+)\]\.(.+)$/.exec(rest);
  const field = /^\.(.+)$/.exec(rest);
  if (group && step.kind === 'group') {
    const items = asGroup(prev).map((x) => ({ ...x, values: { ...x.values } }));
    const idx = Number(group[1]);
    while (items.length <= idx) items.push(newGroupItem());
    items[idx].values[group[2]] = String(value ?? '');
    answers[stepId] = items;
  } else if (field && step.kind === 'form') {
    answers[stepId] = { ...asRecord(prev), [field[1]]: String(value ?? '') };
  } else if (step.kind === 'multi') {
    const add = Array.isArray(value) ? value.map(String) : [String(value)];
    answers[stepId] = Array.from(new Set([...asList(prev), ...add]));
  } else {
    answers[stepId] = value as AnswerValue;
  }
  return {
    ...draft,
    answers,
    skipped: draft.skipped.filter((x) => x !== stepId),
    updatedAt: new Date().toISOString(),
  };
}

/** TEMP: keeps her words alongside the record and uses them as the account if nothing else was written. */
function tempWithEntries(record: IntakeRecord, entries: StoryEntry[]): IntakeRecord {
  if (!entries.length) return record;
  const words = entries.map((e) => e.text).join('\n\n');
  return {
    ...record,
    narrative: { ...record.narrative, freeRecall: record.narrative.freeRecall || words },
    entries,
  } as IntakeRecord;
}

export function understand(entries: StoryEntry[], opts: UnderstandOptions = {}): Suggestion[] {
  if (!entries.length) return [];
  const fn = realUnderstand?.understand ?? tempUnderstand;
  try {
    return fn(entries, opts) ?? [];
  } catch {
    // Understanding is a nicety; it must never get in the way of her telling her story.
    return [];
  }
}

export function applySuggestion(draft: IntakeDraft, s: Suggestion, edited?: unknown): IntakeDraft {
  if (realUnderstand?.applySuggestion) return realUnderstand.applySuggestion(draft, s, edited);
  return writeTarget(draft, s.target, edited === undefined ? s.value : edited);
}

export function withEntries(record: IntakeRecord, entries: StoryEntry[]): IntakeRecord {
  return (realUnderstand?.withEntries ?? tempWithEntries)(record, entries);
}

// ───────────── voice ─────────────

/** TEMP: shown until on-device voice lands. */
function TempVoiceCapture({ onCancel }: VoiceCaptureProps) {
  return createElement(
    'div',
    { className: 'space-voice-temp', role: 'status' },
    createElement('p', null, 'Voice coming soon. For now, you can type — even a few words is enough.'),
    createElement('button', { type: 'button', className: 'space-btn space-btn-quiet', onClick: onCancel }, 'Close'),
  );
}

const LazyVoiceCapture = loadVoice
  ? lazy(async () => ({ default: (await loadVoice()).VoiceCapture ?? TempVoiceCapture }))
  : TempVoiceCapture;

export const VoiceCapture: ComponentType<VoiceCaptureProps> = (props) =>
  createElement(Suspense, { fallback: createElement(Loading, { label: 'Getting voice ready…' }) }, createElement(LazyVoiceCapture, props));

export async function isVoiceSupported(): Promise<boolean> {
  try {
    return (await loadVoice?.())?.isVoiceSupported?.() ?? false;
  } catch {
    return false;
  }
}

export async function preloadTranscriber(onProgress?: (pct: number) => void): Promise<void> {
  await (await loadVoice?.())?.preloadTranscriber?.(onProgress);
}

// ───────────── matching (sealed escrow) ─────────────

export interface MatchContact {
  method?: string;
  detail?: string;
  notes?: string;
}

/**
 * Lodge the sealed-match codes for the people she opted in. Routed through here because the vault-level
 * matching function is being rebuilt (unique identifiers only + a counselor contact preference): rewire this
 * one call when its new signature lands. `contact` is how a legal options counselor may reach her on a match.
 */
export async function lodgeMatches(
  api: ApiClient,
  masterKey: CryptoKey,
  record: IntakeRecord,
  alreadyLodged: string[],
  contact: MatchContact | undefined,
): Promise<string[]> {
  // Only unique identifiers are ever matched; names are dropped before anything is sealed.
  const matchable: IntakeRecord = {
    ...record,
    perpetrators: record.perpetrators.map((p) => ({
      ...p,
      identifiers: p.identifiers.filter((i) => i.kind === 'email' || i.kind === 'phone' || i.kind === 'social_handle'),
    })),
  };
  return vault.lodgeEscrow(api, masterKey, matchable, alreadyLodged, { contact });
}
