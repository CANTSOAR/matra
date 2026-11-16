/**
 * The synthetic eval set for the span-marker.
 *
 * Every line of tools/eval/data/span-marker.{dev,test}.jsonl is a short, clearly fictional account written for this
 * eval: invented names and places, factual and non-graphic, never real survivor text and never scraped. A line is
 *
 *   { id, split, category, text, gold: [{ q, span }], forbid: [{ q, span }] }
 *
 *   gold    the (question id, exact words) pairs a good marker finds
 *   forbid  the same, for statements that must NOT be marked (a negated, hypothetical, reported or someone else's act)
 *
 * `q` may name two questions with `|` (for example `where.place|where.address`): the bank's own wording overlaps ("describe the
 * place" / "the address or the name of the place"), so a named venue or a street is accepted under either, and a mark for
 * either counts. Used only for those two questions.
 *
 * Spans are stored as the exact words, and resolved to offsets here (first occurrence), so a typo in the data fails loudly
 * instead of silently mislabelling. `dev` may be used while building the marker; `test` is held out and frozen: nothing
 * is tuned on it (see the header of run.mts).
 */
export type Category = 'plain' | 'fragmented' | 'spelling' | 'negation' | 'hypothetical' | 'reported' | 'other-actor' | 'sensitive-trap' | 'no-marks';

export const CATEGORIES: readonly Category[] = ['plain', 'fragmented', 'spelling', 'negation', 'hypothetical', 'reported', 'other-actor', 'sensitive-trap', 'no-marks'];
/** Categories whose `forbid` entries measure a false mark on something she did not say happened. */
export const FALSE_MARK_CATEGORIES: readonly Category[] = ['negation', 'hypothetical', 'reported', 'other-actor'];

export interface LabelSpan {
  /** The question. `a|b` in the data means either question is right for this span (see below). */
  q: string;
  /** All accepted questions (always includes q). */
  qs: string[];
  start: number;
  end: number;
}
export interface EvalItem {
  id: string;
  split: 'dev' | 'test';
  category: Category;
  text: string;
  gold: LabelSpan[];
  forbid: LabelSpan[];
}

interface RawLine {
  id: string;
  split: string;
  category: string;
  text: string;
  gold: Array<{ q: string; span: string }>;
  forbid: Array<{ q: string; span: string }>;
}

function resolve(line: RawLine, l: { q: string; span: string }): LabelSpan {
  // First occurrence only: a phrase repeated later in the same account is not labelled. That slightly lowers measured precision
  // (a correct mark on the later copy counts as false) and slightly flatters the false-mark rate (a wrong mark on it is not seen).
  const start = line.text.indexOf(l.span);
  if (start < 0) throw new Error(`${line.id}: label span not found in the text: ${JSON.stringify(l.span)}`);
  const qs = l.q.split('|');
  return { q: qs[0], qs, start, end: start + l.span.length };
}

export function parseJsonl(raw: string, expectSplit?: 'dev' | 'test'): EvalItem[] {
  const items: EvalItem[] = [];
  const seen = new Set<string>();
  for (const [i, ln] of raw.split('\n').entries()) {
    if (!ln.trim()) continue;
    let line: RawLine;
    try {
      line = JSON.parse(ln) as RawLine;
    } catch (e) {
      throw new Error(`line ${i + 1}: not valid JSON (${(e as Error).message})`);
    }
    if (seen.has(line.id)) throw new Error(`duplicate id ${line.id}`);
    seen.add(line.id);
    if (!CATEGORIES.includes(line.category as Category)) throw new Error(`${line.id}: unknown category ${line.category}`);
    if (line.split !== 'dev' && line.split !== 'test') throw new Error(`${line.id}: split must be dev or test`);
    if (expectSplit && line.split !== expectSplit) throw new Error(`${line.id}: is in the ${expectSplit} file but says ${line.split}`);
    items.push({
      id: line.id,
      split: line.split,
      category: line.category as Category,
      text: line.text,
      gold: (line.gold ?? []).map((g) => resolve(line, g)),
      forbid: (line.forbid ?? []).map((g) => resolve(line, g)),
    });
  }
  return items;
}
