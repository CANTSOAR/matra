import type { StoryEntry, Suggestion, SuggestionKind } from './types';
import { hash, sentenceAt, sentences, type Sent } from './text';

export type Confidence = Suggestion['confidence'];

/** A suggestion before de-duplication across mentions. */
export interface Candidate {
  kind: SuggestionKind;
  target: string;
  value: unknown;
  confidence: Confidence;
  label: string;
  entryId: string;
  start: number;
  end: number;
  /** De-duplication key (normalized value). Same kind+target+key → one suggestion with several sources. */
  key: string;
  /** Distinguishes several suggestions from one span. */
  sub?: string;
}

export interface Ctx {
  entry: StoryEntry;
  text: string;
  sents: Sent[];
  /** Reference date for relative expressions ("last friday"): when she wrote this piece. */
  ref: Date;
  out: Candidate[];
  /** Spans already explained by a more specific rule (e.g. "the next morning" inside a disclosure). */
  consumed: Array<[number, number]>;
  /** Quoted speech spans [start, end) including the quote marks. */
  quotes: Array<[number, number]>;
}

export function makeCtx(entry: StoryEntry, now: Date): Ctx {
  const created = Date.parse(entry.createdAt);
  const ref = Number.isFinite(created) ? new Date(created) : now;
  return { entry, text: entry.text, sents: sentences(entry.text), ref, out: [], consumed: [], quotes: findQuotes(entry.text) };
}

export function sentOf(ctx: Ctx, idx: number): Sent {
  return sentenceAt(ctx.sents, idx);
}

export function emit(ctx: Ctx, c: Omit<Candidate, 'entryId'>): void {
  if (c.end <= c.start) return;
  ctx.out.push({ ...c, entryId: ctx.entry.id });
}

export function consume(ctx: Ctx, start: number, end: number): void {
  ctx.consumed.push([start, end]);
}

export function isConsumed(ctx: Ctx, start: number, end: number): boolean {
  return ctx.consumed.some(([s, e]) => start < e && end > s);
}

export function inQuote(ctx: Ctx, idx: number): boolean {
  return ctx.quotes.some(([s, e]) => idx > s && idx < e);
}

/** Matches of a global regex over the entry text. */
export function* matches(ctx: Ctx, re: RegExp): Generator<RegExpExecArray> {
  let flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
  if (!flags.includes('d')) flags += 'd';
  const r = new RegExp(re.source, flags);
  let m: RegExpExecArray | null;
  while ((m = r.exec(ctx.text))) {
    if (m[0] === '') {
      r.lastIndex++;
      continue;
    }
    yield m;
  }
}

/** [start, end] of capture group `g` (matches() always sets the `d` flag), or undefined if it didn't participate. */
export function group(m: RegExpExecArray, g: number | string): [number, number] | undefined {
  const ind = m.indices;
  if (!ind) return undefined;
  const r = typeof g === 'number' ? ind[g] : ind.groups?.[g];
  return r ? [r[0], r[1]] : undefined;
}

const QUOTE_RE = /“[^”\n]{1,400}”|"[^"\n]{1,400}"|(?<![\p{L}])'[^'\n]{2,120}'(?![\p{L}])|‘[^’\n]{2,200}’(?![\p{L}])/gu;

function findQuotes(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  QUOTE_RE.lastIndex = 0;
  while ((m = QUOTE_RE.exec(text))) out.push([m.index, m.index + m[0].length]);
  return out;
}

export function candidateId(c: Candidate): string {
  return `${c.kind}-${hash(`${c.entryId}|${c.start}|${c.end}|${c.target}|${c.sub ?? ''}`)}`;
}
