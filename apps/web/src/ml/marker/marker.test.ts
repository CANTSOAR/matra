import { afterEach, describe, expect, it, vi } from 'vitest';
import { wipeAll } from '../../lib/wipe';
import { ENABLED_QUESTIONS, MARKER_IN_BUILD, createMarkLog, markCoverage, markLog, runMarker } from './index';
import { INTAKE_MARK_BANK } from './intakeBank';

const NOW = new Date('2026-10-07T15:00:00Z');
const mark = (text: string) => markCoverage(text, INTAKE_MARK_BANK, { now: NOW });
afterEach(() => markLog.clear());

describe('markCoverage', () => {
  it('returns { questionId, start, end, exactSpan } and every exactSpan is her words, unchanged', () => {
    const text = 'It happened on March 14 around 10pm at the Riverside Diner. I told my sister Dana the next day. I still have the texts.';
    const marks = mark(text);
    expect(marks.length).toBeGreaterThanOrEqual(4);
    for (const m of marks) {
      expect(Object.keys(m).sort()).toEqual(['end', 'exactSpan', 'questionId', 'start']);
      expect(text.slice(m.start, m.end)).toBe(m.exactSpan);
    }
    const qs = new Set(marks.map((m) => m.questionId));
    for (const q of ['when.date', 'people.told', 'evidence.upload']) expect(qs.has(q), q).toBe(true);
  });

  it('only ever marks neutral, enabled questions', () => {
    const text = 'He choked me and put something in my drink at his apartment on March 14. I went to the ER and they did a rape kit. I have bruises. I told my sister Dana.';
    const marks = mark(text);
    for (const m of marks) expect(ENABLED_QUESTIONS).toContain(m.questionId);
    const ids = marks.map((m) => m.questionId);
    for (const bad of ['details.strangulation', 'details.substances', 'medical.exam', 'medical.injuries', 'medical.care', 'details.force']) expect(ids).not.toContain(bad);
  });

  it('does not mark a negated, hypothetical, quoted, reported or someone else\'s statement', () => {
    for (const text of [
      'I never told anyone.',
      "I haven't reported it to the police.",
      'I wish I had told my sister sooner.',
      'He said he was at the Riverside Diner on Friday.',
      'My sister told her friend about it.',
      'I might call the hotline next week.',
      'No one saw us leave together.',
    ])
      expect(mark(text), text).toEqual([]);
  });

  it('marks the statement she did make, next to one she did not', () => {
    const text = 'I told my sister Dana, but I did not tell my mom.';
    const marks = mark(text);
    expect(marks.map((m) => m.exactSpan)).toEqual(['my sister Dana']);
  });

  it('never carries a value, label or score', () => {
    const [m] = mark('I told my sister Dana yesterday.');
    expect(m).toEqual({ questionId: 'people.told', start: 7, end: 21, exactSpan: 'my sister Dana' });
  });

  it('is deterministic and does not change her text', () => {
    const text = 'On March 14 at the diner I told my cousin Rosa.';
    const copy = `${text}`;
    expect(mark(text)).toEqual(mark(text));
    expect(text).toBe(copy);
  });

  it('handles empty, whitespace and non-string input', () => {
    expect(mark('')).toEqual([]);
    expect(mark('   \n ')).toEqual([]);
    expect(markCoverage(undefined as unknown as string, INTAKE_MARK_BANK)).toEqual([]);
  });

  it('with enabled = null every neutral question can mark (the eval uses this), still never a sensitive one', () => {
    const text = 'He grabbed my wrist at his apartment on Cedar Avenue on March 14.';
    const marks = markCoverage(text, INTAKE_MARK_BANK, { now: NOW, enabled: null });
    for (const m of marks) expect(['when.date', 'when.time', 'where.place', 'where.address', 'where.area', 'people.told', 'people.witnesses', 'prior.any', 'evidence.upload']).toContain(m.questionId);
  });

  it('reads a 20,000-word account in well under a few seconds', () => {
    const para = 'We were at the Oakwood Mall around noon on March 14. I told my friend Lena that night and I still have the texts. ';
    const text = para.repeat(Math.ceil(20000 / para.split(' ').length));
    const t0 = performance.now();
    const marks = mark(text);
    expect(performance.now() - t0).toBeLessThan(5000);
    expect(marks.length).toBeLessThanOrEqual(2 * ENABLED_QUESTIONS.length); // at most two per question
  });
});

describe('the flag and the local log', () => {
  it('is off in this build (MATRA_MARKER unset) and runMarker does nothing then', async () => {
    expect(MARKER_IN_BUILD).toBe(false);
    expect(await runMarker('I told my sister Dana.', INTAKE_MARK_BANK, { optedIn: true })).toBeNull();
    expect(markLog.runs()).toHaveLength(0);
  });

  it('even with the flag forced on, it needs her opt-in', async () => {
    expect(await runMarker('I told my sister Dana.', INTAKE_MARK_BANK, { optedIn: false, force: true })).toBeNull();
    expect(markLog.runs()).toHaveLength(0);
  });

  it('logs a run locally with ids, offsets and hashes only, never her text', async () => {
    const text = 'On March 14 I told my sister Dana. I never told my mom.';
    const res = await runMarker(text, INTAKE_MARK_BANK, { optedIn: true, force: true, entryId: 'e1', now: NOW });
    expect(res).not.toBeNull();
    const run = markLog.runs()[0];
    expect(run.engine).toBe('understand-rules');
    expect(run.backend).toBe('rules');
    expect(run.bankVersion).toBe(INTAKE_MARK_BANK.version);
    expect(run.bankHash).toMatch(/^[0-9a-f]{64}$/);
    expect(run.narrativeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(run.droppedByValidator).toBeGreaterThan(0); // the negated mention
    expect(run.marks.map((m) => m.questionId)).toEqual(res!.marks.map((m) => m.questionId));
    expect(run.marks.every((m) => m.entryId === 'e1')).toBe(true);
    expect(JSON.stringify(run)).not.toContain('sister');
    expect(JSON.stringify(run)).not.toContain('Dana');
  });

  it('sends nothing anywhere: no fetch, no storage', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const set = vi.spyOn(Storage.prototype, 'setItem');
    await runMarker('I told my sister Dana.', INTAKE_MARK_BANK, { optedIn: true, force: true, now: NOW });
    expect(f).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    set.mockRestore();
  });

  it('the log is dropped on Quick exit and lock, and a snapshot is a copy', async () => {
    await runMarker('I told my sister Dana.', INTAKE_MARK_BANK, { optedIn: true, force: true, now: NOW });
    markLog.addDecision({ markId: 'x', action: 'dismissed', at: '2026-11-15T00:00:00Z' });
    const snap = markLog.snapshot();
    snap.runs.length = 0;
    expect(markLog.runs()).toHaveLength(1);
    wipeAll();
    expect(markLog.runs()).toHaveLength(0);
    expect(markLog.decisions()).toHaveLength(0);
  });

  it('separate logs do not share state', () => {
    const a = createMarkLog();
    const b = createMarkLog();
    a.addDecision({ markId: '1', action: 'opened', at: 'x' });
    expect(b.decisions()).toHaveLength(0);
  });
});

describe('long text (P5 review, minor 4: the guards were quadratic)', () => {
  const t = (text: string) => {
    const t0 = performance.now();
    const marks = markCoverage(text, INTAKE_MARK_BANK, { now: NOW });
    return { ms: performance.now() - t0, marks };
  };
  const cases: Array<[string, string]> = [
    ['100k characters of unpunctuated fragments', 'I told my friend '.repeat(6000)],
    ['100k characters of "a-"', 'a-'.repeat(50000)],
    ['100k dots', '.'.repeat(100000)],
    ['100k characters, one run-on sentence with dates and places', 'on March 14 at the diner and then '.repeat(3000)],
    ['100k characters of apostrophes and quotes', `it's "the lake house" and 'x' `.repeat(4000)],
  ];
  for (const [name, text] of cases)
    it(`${name} finishes in about a second, and its marks are exact`, () => {
      expect(text.length).toBeGreaterThanOrEqual(90000);
      const { ms, marks } = t(text);
      expect(ms).toBeLessThan(2500); // ~1 s on a laptop; the margin is for a loaded CI runner
      for (const m of marks) expect(text.slice(m.start, m.end)).toBe(m.exactSpan);
    });
});

describe('reading a very long text in pieces', () => {
  it('pieces cover the text exactly, contiguously, and never cut a surrogate pair', async () => {
    const { pieces, WHOLE_LIMIT } = await import('./rules');
    expect(pieces('short')).toEqual([[0, 5]]);
    const t = 'I told my friend \u{1F600} on March 14. '.repeat(2000);
    expect(t.length).toBeGreaterThan(WHOLE_LIMIT);
    const ps = pieces(t);
    expect(ps.length).toBeGreaterThan(1);
    expect(ps[0][0]).toBe(0);
    expect(ps.at(-1)![1]).toBe(t.length);
    for (let i = 1; i < ps.length; i++) expect(ps[i][0]).toBe(ps[i - 1][1]);
    for (const [, end] of ps.slice(0, -1)) expect(/[\ud800-\udbff]/.test(t[end - 1])).toBe(false);
  });
  it('a mention far into a long text still gets a mark with the right offsets', () => {
    const filler = 'It was a quiet day and nothing else is worth noting here. '.repeat(500);
    const text = `${filler}On March 14 I told my sister Dana. ${filler}`;
    const marks = mark(text);
    const m = marks.find((x) => x.questionId === 'people.told');
    expect(m?.exactSpan).toBe('my sister Dana');
    expect(text.slice(m!.start, m!.end)).toBe('my sister Dana');
  });
});
