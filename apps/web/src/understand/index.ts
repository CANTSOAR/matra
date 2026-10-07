/**
 * On-device understanding of her story ("dump first").
 *
 * `understand()` reads her words and proposes structured details; nothing leaves the device and
 * her words are never changed. Each suggestion is only a proposal: she confirms, edits or dismisses it,
 * and `applySuggestion()` files a confirmed one into the intake draft.
 *
 * What it deliberately does NOT do: label what happened (no incident-type / legal classification
 * suggestions), treat her ("I", "me") as a person, or turn a negation ("I didn't go to the hospital")
 * into a "yes".
 */
import { candidateId, makeCtx, type Candidate } from './context';
import { clearDateCache, extractDatesAndTimes } from './dates';
import { extractFacts } from './facts';
import { extractPeople } from './people';
import { extractPlaces } from './places';
import { extractSpeech } from './speech';
import type { SourceSpan, StoryEntry, Suggestion } from './types';

export type { SourceSpan, StoryEntry, Suggestion, SuggestionDecision, SuggestionKind } from './types';
export { applySuggestion, isApplied } from './apply';
export { highlight, type HighlightSpan, type Segment } from './highlight';
export { withEntries } from './entries';

export interface UnderstandOptions {
  /** Fallback reference date when an entry's createdAt is missing or invalid. */
  now?: Date;
  /** Suggestion ids she dismissed; they are not offered again. */
  dismissed?: string[];
}

const RANK = { high: 3, medium: 2, low: 1 } as const;

/** Per-entry results, so re-running after each new piece only reads the new piece. */
const entryCache = new Map<string, Candidate[]>();

function extractEntry(entry: StoryEntry, now: Date): Candidate[] {
  const k = `${entry.id}\u0000${entry.createdAt}\u0000${Number.isFinite(Date.parse(entry.createdAt)) ? '' : now.toISOString().slice(0, 10)}\u0000${entry.text}`;
  const hit = entryCache.get(k);
  if (hit) return hit;
  const ctx = makeCtx(entry, now);
  // Order matters: specific rules first claim their spans (e.g. "the next morning" inside
  // "i texted my roommate the next morning"), so the general date pass doesn't misread them.
  extractFacts(ctx);
  extractPeople(ctx);
  extractSpeech(ctx);
  extractPlaces(ctx);
  extractDatesAndTimes(ctx);
  if (entryCache.size > 200) entryCache.clear();
  entryCache.set(k, ctx.out);
  return ctx.out;
}

/** Drop caches (tests / memory). */
export function resetUnderstandCache(): void {
  entryCache.clear();
  clearDateCache();
}

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

const LIMITS: Partial<Record<string, number>> = { 'when.date': 3, 'when.time': 3, 'where.place': 4, 'where.address': 3, 'where.area': 3 };

export function understand(entries: StoryEntry[], opts: UnderstandOptions = {}): Suggestion[] {
  const now = opts.now ?? new Date();
  const order = new Map(entries.map((e, i) => [e.id, i]));
  const all: Candidate[] = [];
  for (const e of entries) {
    if (typeof e.text !== 'string' || e.text.trim() === '') continue;
    all.push(...extractEntry(e, now));
  }

  // A toxicology detail only makes sense alongside a forensic exam she mentioned.
  const examYes = all.some((c) => c.target === 'medical.exam' && c.value === 'yes');

  // De-duplicate repeated mentions into one suggestion with several sources.
  const byKey = new Map<string, { c: Candidate; sources: SourceSpan[]; confidence: Suggestion['confidence'] }>();
  const pos = (c: { entryId: string; start: number }) => (order.get(c.entryId) ?? 0) * 1e9 + c.start;
  for (const c of [...all].sort((a, b) => pos(a) - pos(b))) {
    if (c.target === 'medical.kit' && !examYes) continue;
    const k = `${c.kind}|${c.target}|${c.key}`;
    const cur = byKey.get(k);
    const span = { entryId: c.entryId, start: c.start, end: c.end };
    if (!cur) byKey.set(k, { c, sources: [span], confidence: c.confidence });
    else {
      if (!cur.sources.some((s) => s.entryId === span.entryId && s.start === span.start && s.end === span.end)) cur.sources.push(span);
      if (RANK[c.confidence] > RANK[cur.confidence]) cur.confidence = c.confidence;
    }
  }

  let out: Suggestion[] = [...byKey.values()].map(({ c, sources, confidence }) => ({
    id: candidateId(c),
    kind: c.kind,
    label: c.label,
    target: c.target,
    value: clone(c.value),
    confidence,
    sources,
  }));

  // Keep only the strongest few for single-answer targets (dates, places), in reading order.
  for (const [target, n] of Object.entries(LIMITS)) {
    const these = out.filter((s) => s.target === target);
    if (these.length <= n!) continue;
    const keep = new Set(
      [...these]
        .sort((a, b) => RANK[b.confidence] - RANK[a.confidence] || b.sources.length - a.sources.length || pos(a.sources[0]) - pos(b.sources[0]))
        .slice(0, n)
        .map((s) => s.id),
    );
    out = out.filter((s) => s.target !== target || keep.has(s.id));
  }

  const dismissed = new Set(opts.dismissed ?? []);
  return out.filter((s) => !dismissed.has(s.id)).sort((a, b) => pos(a.sources[0]) - pos(b.sources[0]));
}
