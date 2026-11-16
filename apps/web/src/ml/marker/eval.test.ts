/**
 * Unit-test-sized slice of the span-marker eval (tools/eval/span-marker): the synthetic data is well-formed, and the hard
 * invariants hold on both splits. The precision / recall / false-mark GATE is not asserted here (it is a release gate, run by
 * `npm run eval:marker` and a non-blocking CI job); this blocks only what must never be wrong: an invented span, a mark on a
 * sensitive question, or data that is not what it says it is.
 */
import { describe, expect, it } from 'vitest';
import devRaw from '../../../../../tools/eval/data/span-marker.dev.jsonl?raw';
import testRaw from '../../../../../tools/eval/data/span-marker.test.jsonl?raw';
import report from '../../../../../tools/eval/span-marker/results/report.json';
import { CATEGORIES, parseJsonl } from '../../../../../tools/eval/span-marker/dataset';
import { applyGate, enabledQuestions, evaluate, precision, recall, wilsonUpper } from '../../../../../tools/eval/span-marker/metrics';
import { groupOf } from './bank';
import { ENABLED_QUESTIONS, markWithStats } from './index';
import { INTAKE_MARK_BANK } from './intakeBank';

const NOW = new Date('2026-10-07T15:00:00Z');
const dev = parseJsonl(devRaw, 'dev');
const test = parseJsonl(testRaw, 'test');
const predict = (text: string) => {
  const r = markWithStats(text, INTAKE_MARK_BANK, { now: NOW, enabled: null });
  return { marks: r.marks, droppedByReason: r.droppedByReason as Record<string, number> };
};
const isNeutral = (q: string) => groupOf(q) === 'neutral';

describe('synthetic set', () => {
  it('has every group in both splits, unique ids and spans that exist in the text', () => {
    for (const items of [dev, test]) {
      expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
      for (const c of CATEGORIES) expect(items.some((i) => i.category === c), c).toBe(true);
      for (const it of items) for (const l of [...it.gold, ...it.forbid]) expect(it.text.slice(l.start, l.end).length).toBeGreaterThan(0);
    }
    expect(dev.length).toBeGreaterThanOrEqual(80);
    expect(test.length).toBeGreaterThanOrEqual(75);
  });

  it('is clearly fictional and keeps to neutral wording (no real-data markers, nothing graphic)', () => {
    const all = [...dev, ...test].map((i) => i.text).join('\n');
    expect(all).not.toMatch(/https?:\/\/|@[a-z]+\.[a-z]|\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/i); // no URLs, emails, phone numbers
    expect(all).not.toMatch(/\b(?:rape[ds]?|penetrat|genital|naked|undress|semen|blood)\b/i); // nothing graphic
  });

  it('the two splits do not share an account', () => {
    const d = new Set(dev.map((i) => i.text));
    expect(test.filter((i) => d.has(i.text))).toEqual([]);
  });

  it('only labels questions the marker can mark', () => {
    for (const it of [...dev, ...test]) for (const l of [...it.gold, ...it.forbid]) for (const q of l.qs) expect(isNeutral(q), `${it.id} ${q}`).toBe(true);
  });
});

describe('eval invariants (blocking); the gate itself is reported, not asserted', () => {
  for (const [name, items] of [['dev', dev], ['test', test]] as const)
    it(`${name}: zero invented spans, zero sensitive marks, validator never fed a bad offset by the rule engine`, () => {
      const r = evaluate(items, predict, isNeutral, name);
      expect(r.inventedSpans).toBe(0);
      expect(r.sensitiveMarks).toBe(0);
      expect(r.droppedByReason['not-exact-substring'] ?? 0).toBe(0);
      expect(r.droppedByReason['bad-offsets'] ?? 0).toBe(0);
    });

  it('metrics are computed correctly on a tiny hand-made case', () => {
    const items = parseJsonl(
      [
        JSON.stringify({ id: 'a', split: 'dev', category: 'plain', text: 'I told my sister Dana.', gold: [{ q: 'people.told', span: 'my sister Dana' }], forbid: [] }),
        JSON.stringify({ id: 'b', split: 'dev', category: 'negation', text: 'I never told my mom.', gold: [], forbid: [{ q: 'people.told', span: 'my mom' }] }),
      ].join('\n'),
    );
    const marks = (t: string) => (t.startsWith('I told') ? [{ questionId: 'people.told', start: 7, end: 21, exactSpan: 'my sister Dana' }] : [{ questionId: 'people.told', start: 13, end: 19, exactSpan: 'my mom' }]);
    const r = evaluate(items, (t) => ({ marks: marks(t), droppedByReason: {} }), isNeutral);
    expect(precision(r.overall)).toBe(0.5);
    expect(recall(r.overall)).toBe(1);
    expect(r.falseMarkRate.negation).toMatchObject({ forbid: 1, hits: 1, rate: 1 });
    expect(applyGate(r, ['people.told']).pass).toBe(false);
    expect(enabledQuestions(r)).toEqual([]);
    expect(wilsonUpper(0, 15)).toBeGreaterThan(0.15);
  });
});

describe('the enabled list and the committed result', () => {
  it('enabled.ts is the list the dev split selects, as recorded in results/report.json', () => {
    expect([...ENABLED_QUESTIONS].sort()).toEqual([...report.enabledFromDev].sort());
    expect([...ENABLED_QUESTIONS].sort()).toEqual([...report.enabledInCode].sort());
  });
  it('the committed result still matches a fresh run of this engine on the dev split', () => {
    const fresh = evaluate(dev, predict, isNeutral, 'dev');
    expect(fresh.overall).toEqual(report.dev.overall);
    expect(enabledQuestions(fresh).sort()).toEqual([...report.enabledFromDev].sort());
  });
  it('the committed test-split result matches a fresh run, so a change to the engine cannot go unrecorded', () => {
    const fresh = evaluate(test, predict, isNeutral, 'test');
    expect(fresh.overall).toEqual(report.test.overall);
    expect(fresh.byQuestion).toEqual(report.test.byQuestion);
  });
});
