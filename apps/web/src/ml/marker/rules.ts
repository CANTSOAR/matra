/**
 * The v1 engine: the existing rule-based extraction in src/understand (PLAN_REVIEW finding 10), reduced to what a mark
 * needs. Each suggestion's value, label and confidence are thrown away; what is kept is the step it points at and the
 * spans of her own words it came from. No model, no download, nothing new on her device.
 */
import { questionForTarget } from './bank';
import { understand } from '../../understand';
import type { MarkBank, MarkCandidate } from './types';

export const RULES_ENGINE_ID = 'understand-rules';
/** Bump when src/understand changes in a way that moves marks (the eval is re-run on every change). */
export const RULES_ENGINE_VERSION = 'rules-1';

export interface RulesOptions {
  /** Reference date for relative expressions ("last friday"). Marks never carry the resolved value. */
  now?: Date;
}

/**
 * The extraction rules slow down sharply on very long, unpunctuated text (100,000 characters of "a-" took 20 s). A normal
 * account, even a 2,000-word one (about 11,000 characters), is read whole. Beyond WHOLE_LIMIT the text is read in pieces of
 * about PIECE characters, cut at a sentence end or a space, and the offsets are put back. A mention that straddles a cut is
 * missed, which only means no mark.
 */
export const WHOLE_LIMIT = 12000;
export const PIECE = 4000;

export function pieces(text: string): Array<[number, number]> {
  if (text.length <= WHOLE_LIMIT) return [[0, text.length]];
  const out: Array<[number, number]> = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + PIECE);
    if (end < text.length) {
      const window = text.slice(start + PIECE - 800, end);
      const cut = Math.max(window.search(/[.!?…\n][^.!?…\n]*$/), -1);
      const sp = window.lastIndexOf(' ');
      const rel = cut >= 0 ? cut + 1 : sp >= 0 ? sp : -1;
      if (rel >= 0) end = start + PIECE - 800 + rel;
      // never cut inside a surrogate pair
      if (end < text.length && end > start && /[\ud800-\udbff]/.test(text[end - 1])) end--;
    }
    if (end <= start) end = Math.min(text.length, start + PIECE);
    out.push([start, end]);
    start = end;
  }
  return out;
}

export function rulesCandidates(text: string, bank: MarkBank, opts: RulesOptions = {}): MarkCandidate[] {
  if (typeof text !== 'string' || text.trim() === '') return [];
  const now = opts.now ?? new Date();
  const out: Array<MarkCandidate> = [];
  for (const [from, to] of pieces(text)) {
    const piece = text.slice(from, to);
    if (piece.trim() === '') continue;
    const suggestions = understand([{ id: 'marker', createdAt: now.toISOString(), text: piece, source: 'typed' }], { now });
    for (const s of suggestions) {
      const q = questionForTarget(bank, s.target);
      // an engine target with no question in this bank (or a sensitive one) is still passed on, so the validator counts the drop
      const questionId = q?.id ?? s.target;
      for (const src of s.sources) out.push({ questionId, start: from + src.start, end: from + src.end, exactSpan: text.slice(from + src.start, from + src.end) });
    }
  }
  return out;
}
