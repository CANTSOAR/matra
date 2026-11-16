/**
 * Metrics and the release gate for the span-marker (plan section 8.7).
 *
 * Matching rule: a mark is correct when it is for the same question and overlaps a gold span by at least one character
 * (the plan's "span correctness: overlap with a gold span for the same question"). A gold span is found when any mark
 * for its question overlaps it. Precision = correct marks / all marks. Recall = gold spans found / gold spans.
 *
 * False-mark rate (negation, hypothetical, reported, other actor): the share of `forbid` entries that a mark for the same
 * question overlaps. These are statements that must not be marked at all, and the plan's gate is <= 2% for negation.
 */
import { FALSE_MARK_CATEGORIES, type Category, type EvalItem } from './dataset';

export interface PredMark {
  questionId: string;
  start: number;
  end: number;
  exactSpan: string;
}
export interface Prediction {
  marks: PredMark[];
  /** Validator drops by reason, for this item. */
  droppedByReason: Record<string, number>;
}
export type Predictor = (text: string) => Prediction;

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

export interface Counts {
  marks: number;
  correct: number;
  gold: number;
  found: number;
}
const zero = (): Counts => ({ marks: 0, correct: 0, gold: 0, found: 0 });
export const precision = (c: Counts) => (c.marks ? c.correct / c.marks : NaN);
export const recall = (c: Counts) => (c.gold ? c.found / c.gold : NaN);

export interface ItemResult {
  id: string;
  category: Category;
  predicted: PredMark[];
  falseMarks: PredMark[];
  missed: { q: string; start: number; end: number }[];
  forbidHits: { q: string; start: number; end: number }[];
}

export interface Report {
  split: string;
  items: number;
  overall: Counts;
  byQuestion: Record<string, Counts>;
  byCategory: Record<string, Counts & { forbid: number; forbidHits: number; itemsWithFalseMarks: number; items: number }>;
  falseMarkRate: Record<string, { forbid: number; hits: number; rate: number; upper95: number }>;
  droppedByReason: Record<string, number>;
  /** Marks on a sensitive or excluded question that reached the output (must be 0). */
  sensitiveMarks: number;
  /** Marks whose exactSpan is not text.slice(start, end), or offsets out of range (must be 0). */
  inventedSpans: number;
  perItem: ItemResult[];
}

/** Wilson 95% upper bound for a rate k/n (n small here, so the plain rate would look better than it is). */
export function wilsonUpper(k: number, n: number): number {
  if (!n) return NaN;
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  return (p + (z * z) / (2 * n) + z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
}

export function evaluate(items: EvalItem[], predict: Predictor, isNeutral: (q: string) => boolean, split = 'all'): Report {
  const overall = zero();
  const byQuestion: Report['byQuestion'] = {};
  const byCategory: Report['byCategory'] = {};
  const falseTally: Record<string, { forbid: number; hits: number }> = {};
  const droppedByReason: Record<string, number> = {};
  let sensitiveMarks = 0;
  let inventedSpans = 0;
  const perItem: ItemResult[] = [];

  for (const it of items) {
    const p = predict(it.text);
    for (const [r, n] of Object.entries(p.droppedByReason)) droppedByReason[r] = (droppedByReason[r] ?? 0) + n;
    const cat = (byCategory[it.category] ??= { ...zero(), forbid: 0, forbidHits: 0, itemsWithFalseMarks: 0, items: 0 });
    cat.items++;
    const falseMarks: PredMark[] = [];
    for (const m of p.marks) {
      if (!isNeutral(m.questionId)) sensitiveMarks++;
      if (!Number.isInteger(m.start) || !Number.isInteger(m.end) || m.start < 0 || m.end > it.text.length || m.start >= m.end || it.text.slice(m.start, m.end) !== m.exactSpan) inventedSpans++;
      const ok = it.gold.some((g) => g.qs.includes(m.questionId) && overlaps(g, m));
      const qc = (byQuestion[m.questionId] ??= zero());
      for (const c of [overall, qc, cat]) {
        c.marks++;
        if (ok) c.correct++;
      }
      if (!ok) falseMarks.push(m);
    }
    if (falseMarks.length) cat.itemsWithFalseMarks++;
    const missed: ItemResult['missed'] = [];
    for (const g of it.gold) {
      const hit = p.marks.find((m) => g.qs.includes(m.questionId) && overlaps(g, m));
      const found = !!hit;
      const qc = (byQuestion[hit ? hit.questionId : g.q] ??= zero());
      for (const c of [overall, qc, cat]) {
        c.gold++;
        if (found) c.found++;
      }
      if (!found) missed.push(g);
    }
    const forbidHits: ItemResult['forbidHits'] = [];
    for (const f of it.forbid) {
      const hit = p.marks.some((m) => f.qs.includes(m.questionId) && overlaps(f, m));
      cat.forbid++;
      if (hit) {
        cat.forbidHits++;
        forbidHits.push(f);
      }
      const t = (falseTally[it.category] ??= { forbid: 0, hits: 0 });
      t.forbid++;
      if (hit) t.hits++;
    }
    perItem.push({ id: it.id, category: it.category, predicted: p.marks, falseMarks, missed, forbidHits });
  }

  const falseMarkRate: Report['falseMarkRate'] = {};
  for (const c of FALSE_MARK_CATEGORIES) {
    const t = falseTally[c] ?? { forbid: 0, hits: 0 };
    falseMarkRate[c] = { forbid: t.forbid, hits: t.hits, rate: t.forbid ? t.hits / t.forbid : NaN, upper95: wilsonUpper(t.hits, t.forbid) };
  }
  return { split, items: items.length, overall, byQuestion, byCategory, falseMarkRate, droppedByReason, sensitiveMarks, inventedSpans, perItem };
}

/** Questions whose precision on this report clears the per-question bar, with enough marks to say so. */
export function enabledQuestions(r: Report, minPrecision = 0.8, minMarks = 5): string[] {
  return Object.entries(r.byQuestion)
    .filter(([, c]) => c.marks >= minMarks && precision(c) >= minPrecision)
    .map(([q]) => q)
    .sort();
}

/** Metrics over only the marks and gold spans of these questions. */
export function restrictTo(r: Report, questions: readonly string[]): Counts {
  const c = zero();
  for (const q of questions) {
    const x = r.byQuestion[q];
    if (!x) continue;
    c.marks += x.marks;
    c.correct += x.correct;
    c.gold += x.gold;
    c.found += x.found;
  }
  return c;
}

export interface GateCheck {
  name: string;
  value: string;
  threshold: string;
  ok: boolean;
  note?: string;
}
export interface Gate {
  pass: boolean;
  checks: GateCheck[];
}

export const GATE = { overallPrecision: 0.9, perQuestionPrecision: 0.8, negationFalseMark: 0.02, recallFloor: 0.5 } as const;

const pct = (x: number) => (Number.isNaN(x) ? 'n/a' : `${(x * 100).toFixed(1)}%`);

/**
 * The plan's hard gates (8.7) for turning marks on, applied to a report with a FIXED list of enabled questions (chosen on
 * the dev split, never on the split being gated).
 */
export function applyGate(r: Report, enabled: readonly string[]): Gate {
  const on = restrictTo(r, enabled);
  const neg = r.falseMarkRate.negation;
  const checks: GateCheck[] = [
    { name: 'invented spans (not an exact substring)', value: String(r.inventedSpans), threshold: '0', ok: r.inventedSpans === 0 },
    { name: 'marks on a sensitive or excluded question', value: String(r.sensitiveMarks), threshold: '0', ok: r.sensitiveMarks === 0 },
    { name: 'overall precision (enabled questions)', value: pct(precision(on)), threshold: `>= ${pct(GATE.overallPrecision)}`, ok: precision(on) >= GATE.overallPrecision },
    {
      name: 'precision of every enabled question',
      value: enabled.map((q) => `${q} ${pct(precision(r.byQuestion[q] ?? zero()))}`).join(', ') || 'none enabled',
      threshold: `>= ${pct(GATE.perQuestionPrecision)} each`,
      ok: enabled.length > 0 && enabled.every((q) => precision(r.byQuestion[q] ?? zero()) >= GATE.perQuestionPrecision),
    },
    {
      name: 'negation false-mark rate',
      value: `${pct(neg.rate)} (${neg.hits}/${neg.forbid}, 95% upper bound ${pct(neg.upper95)})`,
      threshold: `<= ${pct(GATE.negationFalseMark)}`,
      ok: neg.forbid > 0 && neg.rate <= GATE.negationFalseMark,
      note: neg.forbid < 100 ? `only ${neg.forbid} negated statements: a pass here cannot rule out a rate near ${pct(neg.upper95)}` : undefined,
    },
    { name: 'recall (enabled questions), reported', value: pct(recall(on)), threshold: `>= ${pct(GATE.recallFloor)} to be worth shipping`, ok: recall(on) >= GATE.recallFloor },
  ];
  return { pass: checks.every((c) => c.ok), checks };
}

/** Deterministic PRNG for the bootstrap. */
function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 95% bootstrap interval for precision and recall over items (resampling whole accounts), restricted to `enabled` questions. */
export function bootstrap(r: Report, items: EvalItem[], enabled: readonly string[], reps = 1000, seed = 7): { precision: [number, number]; recall: [number, number] } {
  const rnd = mulberry32(seed);
  const on = new Set(enabled);
  const per = r.perItem.map((p, i) => {
    const it = items[i];
    const marks = p.predicted.filter((m) => on.has(m.questionId));
    const correct = marks.filter((m) => it.gold.some((g) => g.qs.includes(m.questionId) && overlaps(g, m))).length;
    const gold = it.gold.filter((g) => g.qs.some((q) => on.has(q)));
    const found = gold.filter((g) => marks.some((m) => g.qs.includes(m.questionId) && overlaps(g, m))).length;
    return { marks: marks.length, correct, gold: gold.length, found };
  });
  const ps: number[] = [];
  const rs: number[] = [];
  for (let k = 0; k < reps; k++) {
    let m = 0, c = 0, g = 0, f = 0;
    for (let i = 0; i < per.length; i++) {
      const x = per[Math.floor(rnd() * per.length)];
      m += x.marks;
      c += x.correct;
      g += x.gold;
      f += x.found;
    }
    if (m) ps.push(c / m);
    if (g) rs.push(f / g);
  }
  const q = (a: number[], p: number) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))] : NaN);
  return { precision: [q(ps, 0.025), q(ps, 0.975)], recall: [q(rs, 0.025), q(rs, 0.975)] };
}

export { pct };
