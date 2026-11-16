import { describe, expect, it } from 'vitest';
import { INTAKE_MARK_BANK } from './intakeBank';
import { MAX_MARKS_PER_QUESTION, MAX_SPAN_CHARS, validateMarks } from './validate';
import { buildBank } from './bank';
import type { MarkCandidate } from './types';

const TEXT = 'It happened on March 14 at the Riverside Diner. I told my sister Dana the next day.';
const span = (s: string) => {
  const start = TEXT.indexOf(s);
  return { start, end: start + s.length, exactSpan: s };
};
const ok = (questionId: string, s: string): MarkCandidate => ({ questionId, ...span(s) });
const run = (c: MarkCandidate[], text = TEXT, enabled?: ReadonlySet<string> | null) => validateMarks(text, INTAKE_MARK_BANK, c, enabled);

describe('validateMarks', () => {
  it('keeps an exact substring for a neutral question, unchanged', () => {
    const r = run([ok('when.date', 'March 14'), ok('people.told', 'my sister Dana')]);
    expect(r.marks.map((m) => [m.questionId, m.exactSpan])).toEqual([['when.date', 'March 14'], ['people.told', 'my sister Dana']]);
    expect(r.dropped).toBe(0);
  });

  it('drops anything that is not an exact substring of her text', () => {
    const a = span('March 14');
    const cases: MarkCandidate[] = [
      { questionId: 'when.date', ...a, exactSpan: 'march 14' }, // case changed
      { questionId: 'when.date', ...a, exactSpan: 'March 14 ' }, // extra space
      { questionId: 'when.date', ...a, exactSpan: 'March 15' }, // one character off
      { questionId: 'when.date', start: a.start + 1, end: a.end + 1, exactSpan: 'March 14' }, // right words, wrong place
      { questionId: 'when.date', ...a, exactSpan: 'March  14' },
      { questionId: 'when.date', ...a, exactSpan: '' },
    ];
    const r = run(cases);
    expect(r.marks).toEqual([]);
    expect(r.droppedByReason['not-exact-substring']).toBeGreaterThanOrEqual(5);
  });

  it('drops bad offsets', () => {
    const bad: Array<[number, number]> = [[-1, 4], [0, 0], [5, 3], [0, TEXT.length + 1], [1.5, 4], [Number.NaN, 4], [0, Number.POSITIVE_INFINITY]];
    const r = run(bad.map(([start, end]) => ({ questionId: 'when.date', start, end, exactSpan: TEXT.slice(0, 4) })));
    expect(r.marks).toEqual([]);
    expect(r.droppedByReason['bad-offsets']).toBe(bad.length);
  });

  it('drops a mark for a sensitive question, even when the bank passed in says it is neutral', () => {
    for (const id of ['details.force', 'details.substances', 'details.strangulation', 'medical.injuries', 'medical.exam', 'recall.touch', 'evidence.physical']) {
      const lying = { version: 'x', questions: [{ id, group: 'neutral' as const }] };
      const r = validateMarks(TEXT, lying, [ok(id, 'March 14')]);
      expect(r.marks, id).toEqual([]);
      expect(r.droppedByReason['sensitive-group'], id).toBe(1);
    }
  });

  it('drops unknown questions and questions tagged excluded', () => {
    const r = run([ok('no.such.question', 'March 14'), ok('about.phone', 'March 14'), { questionId: 7 as unknown as string, ...span('March 14') }]);
    expect(r.marks).toEqual([]);
    expect(r.droppedByReason['unknown-question']).toBe(2);
    expect(r.droppedByReason['excluded-group']).toBe(1);
  });

  it('drops a span that cuts a surrogate pair or a combining sequence (P5 review, major 2)', () => {
    const t = 'I told my sister \u{1F600}Dana on March 14.';
    const i = t.indexOf('Dana');
    const mk = (start: number, end: number): MarkCandidate => ({ questionId: 'people.told', start, end, exactSpan: t.slice(start, end) });
    // starts on the low half of the emoji ("\ude00Da"), ends on the high half ("\ud83d"), and the clean span
    const r = validateMarks(t, INTAKE_MARK_BANK, [mk(i - 1, i + 2), mk(i - 2, i - 1), mk(i, i + 4)], null);
    expect(r.marks.map((m) => m.exactSpan)).toEqual(['Dana']);
    expect(r.droppedByReason['split-character']).toBe(2);
    // NFD "Dana" + acute: ending after "Dana" and before the accent splits the letter from its mark
    const nfd = 'I told my sister Dana\u0301 on March 14.';
    const j = nfd.indexOf('Dana');
    const cut = validateMarks(nfd, INTAKE_MARK_BANK, [{ questionId: 'people.told', start: j, end: j + 4, exactSpan: 'Dana' }], null);
    expect(cut.marks).toEqual([]);
    expect(cut.droppedByReason['split-character']).toBe(1);
    const whole = validateMarks(nfd, INTAKE_MARK_BANK, [{ questionId: 'people.told', start: j, end: j + 5, exactSpan: 'Dana\u0301' }], null);
    expect(whole.marks.map((m) => m.exactSpan)).toEqual(['Dana\u0301']);
    // a ZWJ sequence and a flag are one character too
    const fam = 'told \u{1F468}\u200D\u{1F469}\u200D\u{1F467} Dana';
    const k = fam.indexOf('\u200D');
    expect(validateMarks(fam, INTAKE_MARK_BANK, [{ questionId: 'people.told', start: 5, end: k + 1, exactSpan: fam.slice(5, k + 1) }], null).droppedByReason['split-character']).toBe(1);
  });

  it('the rule fallback gives the same answers without Intl.Segmenter', async () => {
    const { isBoundaryByRule } = await import('./grapheme');
    const t = 'a\u{1F600}b\u0301c';
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => isBoundaryByRule(t, i))).toEqual([true, true, false, true, false, true, true]);
  });

  it('drops a span that is blank or a whole passage', () => {
    const t = `${'word '.repeat(60)}on March 14 `;
    const blank = validateMarks('a   b', INTAKE_MARK_BANK, [{ questionId: 'when.date', start: 1, end: 4, exactSpan: '   ' }]);
    expect(blank.droppedByReason['empty-or-whitespace']).toBe(1);
    const long = validateMarks(t, INTAKE_MARK_BANK, [{ questionId: 'when.date', start: 0, end: MAX_SPAN_CHARS + 1, exactSpan: t.slice(0, MAX_SPAN_CHARS + 1) }]);
    expect(long.droppedByReason['too-long']).toBe(1);
  });

  it('drops marks for questions that are not enabled', () => {
    const r = run([ok('when.date', 'March 14'), ok('people.told', 'my sister Dana')], TEXT, new Set(['people.told']));
    expect(r.marks.map((m) => m.questionId)).toEqual(['people.told']);
    expect(r.droppedByReason['disabled-question']).toBe(1);
  });

  it('keeps at most two marks per question, earliest first, and drops overlapping duplicates', () => {
    const text = 'on March 14, then March 15, then March 16.';
    const mk = (s: string): MarkCandidate => ({ questionId: 'when.date', start: text.indexOf(s), end: text.indexOf(s) + s.length, exactSpan: s });
    const r = validateMarks(text, INTAKE_MARK_BANK, [mk('March 16'), mk('March 14'), mk('March 15'), mk('March 14')]);
    expect(r.marks.map((m) => m.exactSpan)).toEqual(['March 14', 'March 15']);
    expect(MAX_MARKS_PER_QUESTION).toBe(2);
    expect(r.droppedByReason['duplicate']).toBe(1);
    expect(r.droppedByReason['over-limit']).toBe(1);
  });

  it('survives hostile candidate fields without throwing', () => {
    const hostile = [
      { questionId: '__proto__', start: 0, end: 3, exactSpan: TEXT.slice(0, 3) },
      { questionId: 'constructor', start: 0, end: 3, exactSpan: TEXT.slice(0, 3) },
      { questionId: 'when.date', start: 0, end: 3, exactSpan: undefined as unknown as string },
      { questionId: 'when.date', start: '0' as unknown as number, end: 3, exactSpan: 'It ' },
    ];
    expect(() => run(hostile)).not.toThrow();
    expect(run(hostile).marks).toEqual([]);
  });

  describe('fuzz: random and adversarial candidates never get through unless exactly right', () => {
    function rng(seed: number) {
      return () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
    }
    const questions = [...INTAKE_MARK_BANK.questions.map((q) => q.id), 'x', '', '__proto__', 'when.date '];
    it('5000 candidates: every mark that survives is neutral, enabled, in range, and exactly her words', () => {
      const r = rng(20261115);
      const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
      const enabled = new Set(['when.date', 'when.time', 'where.place', 'people.told']);
      const candidates: MarkCandidate[] = [];
      for (let i = 0; i < 5000; i++) {
        const start = Math.floor(r() * (TEXT.length + 10)) - 5;
        const end = start + Math.floor(r() * 30) - 3;
        const real = TEXT.slice(Math.max(0, start), Math.max(0, end));
        const variants = [real, real.toUpperCase(), real + 'x', real.slice(1), ` ${real}`, TEXT, '', 'a fabricated phrase', real.replace(/\s/, '  ')];
        candidates.push({ questionId: pick(questions), start, end, exactSpan: pick(variants) });
      }
      const res = validateMarks(TEXT, INTAKE_MARK_BANK, candidates, enabled);
      expect(res.dropped + res.marks.length).toBe(candidates.length); // every candidate is either kept or counted as dropped
      for (const m of res.marks) {
        expect(enabled.has(m.questionId)).toBe(true);
        expect(Number.isInteger(m.start) && Number.isInteger(m.end) && m.start >= 0 && m.end > m.start && m.end <= TEXT.length).toBe(true);
        expect(TEXT.slice(m.start, m.end)).toBe(m.exactSpan);
      }
      // no sensitive question ever appears
      const sensitive = new Set(INTAKE_MARK_BANK.questions.filter((q) => q.group !== 'neutral').map((q) => q.id));
      expect(res.marks.some((m) => sensitive.has(m.questionId))).toBe(false);
    });
    it('a bank with only sensitive questions yields no marks at all', () => {
      const b = buildBank(['details.force', 'medical.injuries'], 'x');
      const res = validateMarks(TEXT, b, [ok('details.force', 'March 14'), ok('medical.injuries', 'March 14')]);
      expect(res.marks).toEqual([]);
    });
  });
});
