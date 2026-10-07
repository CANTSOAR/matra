import { describe, expect, it } from 'vitest';
import { emptyDraft } from '../intake/draft';
import { STEPS } from '../intake/script';
import { writeTarget } from './adapters';
import { addEntry, safetyStage, answerSafety, continuePastHelp, savePage } from './ops';
import { snippetFor } from './suggestions';
import { SECTIONS, TOPICS, pagesOf, sectionStatus, topicStatus, topicById } from './topics';

describe('space ops', () => {
  it('never trims or rewrites entry text; ignores blank', () => {
    const d = addEntry(emptyDraft(), '  hi \n', 'typed');
    expect(d.entries![0].text).toBe('  hi \n');
    expect(addEntry(d, '   ', 'typed').entries).toHaveLength(1);
  });

  it('safety: ask → help (for no / not sure) → done', () => {
    let d = emptyDraft();
    expect(safetyStage(d)).toBe('ask');
    d = answerSafety(d, 'unsure');
    expect(safetyStage(d)).toBe('help');
    expect(safetyStage(continuePastHelp(d))).toBe('done');
    expect(safetyStage(answerSafety(emptyDraft(), 'yes'))).toBe('done');
    expect(safetyStage(answerSafety(emptyDraft(), undefined))).toBe('done');
  });

  it('writeTarget fills steps, form fields, group items and merges multi-selects', () => {
    let d = writeTarget(emptyDraft(), 'where.area.city', 'New Brunswick');
    expect(d.answers['where.area']).toEqual({ city: 'New Brunswick' });
    d = writeTarget(d, 'person.list[0].name', 'R.');
    d = writeTarget(d, 'person.list[0].relationship', 'coworker');
    expect((d.answers['person.list'] as Array<{ values: Record<string, string> }>)[0].values).toEqual({ name: 'R.', relationship: 'coworker' });
    d = writeTarget(d, 'details.force', ['threats']);
    d = writeTarget(d, 'details.force', ['weapon', 'threats']);
    expect(d.answers['details.force']).toEqual(['threats', 'weapon']);
    expect(writeTarget(d, 'no.such.step', 'x')).toBe(d);
  });

  it('every topic step exists, and every interview question has a home in the space', () => {
    const ids = new Set(STEPS.map((s) => s.id));
    for (const t of TOPICS) for (const id of [...t.steps, ...(t.notes ?? [])]) expect(ids.has(id), id).toBe(true);
    const covered = new Set(TOPICS.flatMap((t) => t.steps));
    const handledElsewhere = new Set(['safety.now', 'story.freeRecall']);
    for (const s of STEPS) {
      if (s.kind === 'info' || s.kind === 'review' || handledElsewhere.has(s.id)) continue;
      expect(covered.has(s.id), s.id).toBe(true);
    }
    for (const sec of SECTIONS) for (const t of sec.topics) expect(topicById(t).section).toBe(sec.id);
  });

  it('pages hold 1–3 short questions; big ones stand alone', () => {
    const t = topicById('whenWhere');
    const steps = t.steps.map((id) => STEPS.find((s) => s.id === id)!);
    const pages = pagesOf(steps);
    for (const p of pages) expect(p.length).toBeGreaterThanOrEqual(1), expect(p.length).toBeLessThanOrEqual(3);
    expect(pagesOf([STEPS.find((s) => s.id === 'person.list')!, STEPS.find((s) => s.id === 'person.escrow')!])).toHaveLength(2);
  });

  it('status: not yet → partly → filled; skip-all → skipped', () => {
    const t = topicById('whenWhere');
    let d = emptyDraft();
    expect(topicStatus(d, t)).toBe('notYet');
    d = savePage(d, ['when.date'], { 'when.date': { mode: 'unsure' } });
    expect(topicStatus(d, t)).toBe('partly');
    d = savePage(d, ['where.place'], { 'where.place': 'a car' });
    expect(topicStatus(d, t)).toBe('filled');
    expect(sectionStatus(d, SECTIONS.find((s) => s.id === 'whenWhere')!)).toBe('filled');
    const skipped = savePage(emptyDraft(), t.steps, {}, 'skip');
    expect(topicStatus(skipped, t)).toBe('skipped');
    // skip never erases an earlier answer
    expect(savePage(d, ['where.place'], {}, 'skip').answers['where.place']).toBe('a car');
  });

  it('snippets slice her words without changing them', () => {
    const e = { id: 'e1', createdAt: '', source: 'typed' as const, text: 'one two three FOUR five six' };
    const sn = snippetFor([e], { entryId: 'e1', start: 14, end: 18 }, 6)!;
    expect(sn.match).toBe('FOUR');
    expect(e.text.includes(sn.before + sn.match + sn.after)).toBe(true);
    expect(sn.before).toBe('three ');
  });
});
