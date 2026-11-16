import { describe, expect, it } from 'vitest';
import { STEPS } from '../../intake/script';
import { NEUTRAL_IDS, SENSITIVE_PREFIXES, buildBank, groupOf, questionForTarget } from './bank';
import { INTAKE_MARK_BANK } from './intakeBank';

const group = (id: string) => INTAKE_MARK_BANK.questions.find((q) => q.id === id)?.group;

describe('mark bank: which questions may be marked', () => {
  it('classifies every step of the intake script, and only the plain factual ones are neutral', () => {
    const ids = STEPS.map((s) => s.id);
    expect(INTAKE_MARK_BANK.questions.map((q) => q.id).sort()).toEqual([...new Set(ids)].sort());
    const neutral = INTAKE_MARK_BANK.questions.filter((q) => q.group === 'neutral').map((q) => q.id).sort();
    expect(neutral).toEqual([...NEUTRAL_IDS].sort());
    // every neutral id is a real question in the script (a typo here would silently mark nothing)
    for (const id of NEUTRAL_IDS) expect(ids, id).toContain(id);
  });

  it('never marks force, substances or drugging, strangulation, injuries, sexual acts or anything near them', () => {
    for (const id of [
      'details.force', 'details.forceWords', 'details.strangulation', 'details.strangulationInfo', 'details.substances', 'details.incapacitated',
      'details.toxInfo', 'details.substancesWords', 'medical.injuries', 'medical.exam', 'medical.kit', 'medical.examInfo', 'medical.care',
      'recall.touch', 'recall.taste', 'context.words', 'context.types', 'person.list', 'evidence.physical', 'evidence.physicalNotes',
      'safety.access', 'safety.notes', 'when.repeated',
    ])
      expect(group(id), id).toBe('sensitive');
  });

  it('leaves contact details, goals and notices out as excluded, not sensitive', () => {
    for (const id of ['about.phone', 'about.email', 'goals.police', 'costs.amounts', 'review', 'story.freeRecall']) expect(group(id), id).toBe('excluded');
  });

  it('a question added later starts excluded: default deny', () => {
    expect(groupOf('something.new')).toBe('excluded');
    expect(buildBank(['when.date', 'something.new'], 'x').questions.find((q) => q.id === 'something.new')?.group).toBe('excluded');
  });

  it('a sensitive prefix wins over the neutral list', () => {
    for (const p of SENSITIVE_PREFIXES) expect(groupOf(p.endsWith('.') ? `${p}anything` : p)).toBe('sensitive');
    expect(NEUTRAL_IDS.some((id) => SENSITIVE_PREFIXES.some((p) => id.startsWith(p)))).toBe(false);
  });

  it('maps engine targets to questions (prior.list is answered under prior.any)', () => {
    expect(questionForTarget(INTAKE_MARK_BANK, 'prior.list')?.id).toBe('prior.any');
    expect(questionForTarget(INTAKE_MARK_BANK, 'when.date')?.id).toBe('when.date');
    expect(questionForTarget(INTAKE_MARK_BANK, 'person.list[0].name')?.id).toBe('person.list');
    expect(questionForTarget(INTAKE_MARK_BANK, 'nope.nothing')).toBeUndefined();
  });
});
