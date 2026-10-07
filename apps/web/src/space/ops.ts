/**
 * Pure draft operations for the story space. Nothing here alters her words: entries are stored
 * exactly as given, and suggestions only change the draft when she says "Keep" or edits them.
 */
import { randomId } from '@matra/crypto';
import { isBlank, stepById, type AnswerValue, type IntakeDraft } from '../intake/draft';
import type { SpaceState } from '../intake/draft';
import type { StoryEntry, Suggestion, SuggestionDecision } from '../understand/types';
import { applySuggestion } from './adapters';
import type { TopicId } from './topics';

const touch = (d: IntakeDraft, patch: Partial<IntakeDraft>): IntakeDraft => ({
  ...d,
  ...patch,
  updatedAt: new Date().toISOString(),
});

export function patchSpace(d: IntakeDraft, patch: Partial<SpaceState>): IntakeDraft {
  return touch(d, { space: { ...(d.space ?? {}), ...patch } });
}

export function newEntry(text: string, source: StoryEntry['source'], now: Date = new Date()): StoryEntry {
  return { id: randomId(), createdAt: now.toISOString(), text, source };
}

/** Adds her words verbatim (no trimming, no normalising). Blank text is ignored. */
export function addEntry(d: IntakeDraft, text: string, source: StoryEntry['source'], now?: Date): IntakeDraft {
  if (text.trim() === '') return d;
  const next = touch(d, { entries: [...(d.entries ?? []), newEntry(text, source, now)] });
  return source === 'typed' ? patchSpace(next, { composer: undefined }) : next;
}

/**
 * She changed her own words (a draft only — sealed versions stay as they were). Blank text is ignored;
 * the new text is kept exactly as she typed it.
 */
export function editEntry(d: IntakeDraft, id: string, text: string, now: Date = new Date()): IntakeDraft {
  if (text.trim() === '') return d;
  const list = d.entries ?? [];
  const cur = list.find((e) => e.id === id);
  if (!cur || cur.text === text) return d;
  return touch(d, { entries: list.map((e) => (e.id === id ? { ...e, text, editedAt: now.toISOString() } : e)) });
}

export function removeEntry(d: IntakeDraft, id: string): IntakeDraft {
  return touch(d, { entries: (d.entries ?? []).filter((e) => e.id !== id) });
}

export function setComposer(d: IntakeDraft, text: string): IntakeDraft {
  return patchSpace(d, { composer: text || undefined });
}

function decide(d: IntakeDraft, id: string, decision: SuggestionDecision): IntakeDraft {
  return patchSpace(d, { decisions: { ...(d.space?.decisions ?? {}), [id]: decision } });
}

export function keepSuggestion(d: IntakeDraft, s: Suggestion): IntakeDraft {
  return decide(applySuggestion(d, s), s.id, 'accepted');
}

export function editSuggestion(d: IntakeDraft, s: Suggestion, edited: unknown): IntakeDraft {
  return decide(applySuggestion(d, s, edited), s.id, 'edited');
}

export function dismissSuggestion(d: IntakeDraft, s: Suggestion): IntakeDraft {
  const dismissed = d.dismissedSuggestions ?? [];
  const next = touch(d, { dismissedSuggestions: dismissed.includes(s.id) ? dismissed : [...dismissed, s.id] });
  return decide(next, s.id, 'dismissed');
}

/** True if keeping this suggestion would change nothing (she already said it some other way). */
export function alreadyThere(d: IntakeDraft, s: Suggestion): boolean {
  try {
    return JSON.stringify(applySuggestion(d, s).answers) === JSON.stringify(d.answers);
  } catch {
    return false;
  }
}

/** Suggestions still waiting for her: not decided, not dismissed, not already in the draft. */
export function openSuggestions(d: IntakeDraft, all: Suggestion[]): Suggestion[] {
  const decided = d.space?.decisions ?? {};
  const dismissed = new Set(d.dismissedSuggestions ?? []);
  return all.filter((s) => !decided[s.id] && !dismissed.has(s.id) && !alreadyThere(d, s));
}

// ───────────── topics ─────────────

export function setTopicPending(d: IntakeDraft, values: Record<string, AnswerValue>): IntakeDraft {
  return patchSpace(d, { pending: Object.keys(values).length ? values : undefined });
}

/**
 * Save one page of a topic.
 * - 'save': blank answers count as skipped (as in the interview).
 * - 'skip': skip every question on the page; anything saved before is kept.
 * - 'keep' ("That's enough for now"): keep what she typed, mark nothing as skipped.
 */
export function savePage(
  d: IntakeDraft,
  stepIds: string[],
  values: Record<string, AnswerValue>,
  mode: 'save' | 'skip' | 'keep' = 'save',
): IntakeDraft {
  const skipAll = mode === 'skip';
  const answers = { ...d.answers };
  const skipped = mode === 'keep' ? [...d.skipped] : d.skipped.filter((id) => !stepIds.includes(id));
  for (const id of stepIds) {
    const step = stepById(id);
    if (!step || step.kind === 'info') continue;
    if (skipAll) {
      // "Skip" never erases something she saved before.
      if (answers[id] === undefined) skipped.push(id);
      continue;
    }
    const v = values[id];
    if (mode === 'keep') {
      if (v !== undefined && !isBlank(v)) {
        answers[id] = v;
        const i = skipped.indexOf(id);
        if (i !== -1) skipped.splice(i, 1);
      }
      continue;
    }
    if (v !== undefined && !isBlank(v)) answers[id] = v;
    else {
      if (v !== undefined) delete answers[id]; // she cleared it
      if (answers[id] === undefined) skipped.push(id);
    }
  }
  const pending = { ...(d.space?.pending ?? {}) };
  for (const id of stepIds) delete pending[id];
  const visited = mode === 'keep' ? d.visited : Array.from(new Set([...d.visited, ...stepIds]));
  return patchSpace(touch(d, { answers, skipped, visited }), {
    pending: Object.keys(pending).length ? pending : undefined,
  });
}

export function skipTopic(d: IntakeDraft, id: TopicId): IntakeDraft {
  const list = d.space?.skippedTopics ?? [];
  return patchSpace(d, { skippedTopics: list.includes(id) ? list : [...list, id] });
}

export function unskipTopic(d: IntakeDraft, id: TopicId): IntakeDraft {
  const list = d.space?.skippedTopics ?? [];
  return list.includes(id) ? patchSpace(d, { skippedTopics: list.filter((x) => x !== id) }) : d;
}

// ───────────── safety ─────────────

export function answerSafety(d: IntakeDraft, value: 'yes' | 'no' | 'unsure' | undefined): IntakeDraft {
  const answers = { ...d.answers };
  let skipped = d.skipped.filter((x) => x !== 'safety.now');
  if (value) answers['safety.now'] = value;
  else {
    delete answers['safety.now'];
    skipped = [...skipped, 'safety.now'];
  }
  const visited = Array.from(new Set([...d.visited, 'safety.now', ...(value === 'yes' ? ['safety.help'] : [])]));
  return touch(d, { answers, skipped, visited });
}

/** She has seen the help screen (after "No" / "Not sure") and chose to keep going. */
export function continuePastHelp(d: IntakeDraft): IntakeDraft {
  return touch(d, { visited: Array.from(new Set([...d.visited, 'safety.help', 'privacy', 'howItWorks'])) });
}

/** Where the safety gate stands: still to ask, showing help, or done. */
export function safetyStage(d: IntakeDraft): 'ask' | 'help' | 'done' {
  const v = d.answers['safety.now'];
  if (v === undefined && !d.skipped.includes('safety.now')) return 'ask';
  if ((v === 'no' || v === 'unsure') && !d.visited.includes('safety.help')) return 'help';
  return 'done';
}

/** Moving to the one-question-at-a-time interview: start after what she has already done here. */
export function toInterview(d: IntakeDraft): IntakeDraft {
  const next = patchSpace(d, { mode: 'interview' });
  if (safetyStage(d) === 'done' && d.stepId === 'safety.now') return { ...next, stepId: 'privacy' };
  return next;
}
