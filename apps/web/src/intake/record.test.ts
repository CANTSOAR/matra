import { describe, expect, it } from 'vitest';
import type { IntakeRecord } from '@shield/shared';
import { draftToRecord, emptyDraft, STEPS, type IntakeDraft } from './index';

const NARRATIVE =
  '  It started at the party.\n\n\tHe said "don\'t tell anyone" 😶‍🌫️ — I left at ~2am…  \r\nI remember {braces} [brackets] & <tags>.   ';

function draftWith(answers: IntakeDraft['answers']): IntakeDraft {
  return { ...emptyDraft(new Date('2026-01-01T00:00:00Z')), answers };
}

function assertValidRecord(r: IntakeRecord) {
  expect(r.schemaVersion).toBe(1);
  expect(typeof r.completedAt).toBe('string');
  expect(Number.isNaN(Date.parse(r.completedAt))).toBe(false);
  for (const k of ['phone', 'text', 'email', 'voicemail'] as const) expect(typeof r.survivor.safeContact[k]).toBe('boolean');
  expect(typeof r.incident.dateIsApproximate).toBe('boolean');
  expect(typeof r.incident.isOngoing).toBe('boolean');
  expect(Array.isArray(r.incident.incidentTypes)).toBe(true);
  expect(typeof r.narrative.freeRecall).toBe('string');
  for (const arr of [r.perpetrators, r.witnesses, r.disclosures, r.priorReports, r.evidence]) expect(Array.isArray(arr)).toBe(true);
  expect(typeof r.medical.soughtCare).toBe('boolean');
  expect(typeof r.safety.inImmediateDanger).toBe('boolean');
  for (const g of Object.values(r.goals)) expect(['yes', 'no', 'undecided']).toContain(g);
}

/** No optional field may be an empty string — skipped means undefined. */
function noEmptyStrings(v: unknown, path = 'record', allow = new Set(['record.narrative.freeRecall'])) {
  if (typeof v === 'string') {
    if (!allow.has(path)) expect(v, path).not.toBe('');
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) noEmptyStrings(x, Array.isArray(v) ? `${path}[]` : `${path}.${k}`, allow);
  }
}

describe('draftToRecord', () => {
  it('produces a valid record with defaults from an empty draft', () => {
    const r = draftToRecord(emptyDraft(), new Date('2026-02-02T10:00:00Z'));
    assertValidRecord(r);
    expect(r.completedAt).toBe('2026-02-02T10:00:00.000Z');
    expect(r.survivor.safeContact).toEqual({ phone: false, text: false, email: false, voicemail: false });
    expect(r.goals).toEqual({ policeReport: 'undecided', attorney: 'undecided', compensation: 'undecided', protectiveOrder: 'undecided' });
    expect(r.incident.dateIsApproximate).toBe(true);
    expect(r.survivor.preferredName).toBeUndefined();
    expect(r.narrative.freeRecall).toBe('');
    noEmptyStrings(r);
  });

  it('preserves the narrative byte-for-byte (whitespace, emoji, symbols)', () => {
    const r = draftToRecord(
      draftWith({ 'story.freeRecall': NARRATIVE, 'context.words': NARRATIVE, 'recall.smell': ' smoke ' }),
    );
    expect(r.narrative.freeRecall).toBe(NARRATIVE);
    expect(new TextEncoder().encode(r.narrative.freeRecall)).toEqual(new TextEncoder().encode(NARRATIVE));
    expect(r.narrative.wordsSpoken).toBe(NARRATIVE);
    expect(r.narrative.sensory.smell).toBe(' smoke ');
  });

  it('turns skipped and blank answers into undefined, never empty strings', () => {
    const d = draftWith({
      'about.name': '   ',
      'about.legalName': '',
      'about.home': { state: '', county: '' },
      'where.area': { city: 'Newark', state: 'NJ', county: '', campus: '' },
      'people.witnesses': [{ id: 'w1', values: { name: '', contact: '' } }],
    });
    d.skipped = ['about.pronouns'];
    const r = draftToRecord(d);
    expect(r.survivor.preferredName).toBeUndefined();
    expect(r.survivor.legalName).toBeUndefined();
    expect(r.survivor.residenceState).toBeUndefined();
    expect(r.incident.jurisdiction).toEqual({ city: 'Newark', state: 'NJ', county: undefined, campus: undefined });
    expect(r.witnesses).toEqual([]);
    noEmptyStrings(r);
  });

  it('ignores answers to follow-up questions that are no longer shown', () => {
    const r = draftToRecord(
      draftWith({ 'about.contactMethods': ['email'], 'about.phone': '555-0100', 'about.email': 'me@example.com' }),
    );
    expect(r.survivor.phone).toBeUndefined();
    expect(r.survivor.email).toBe('me@example.com');
    expect(r.survivor.safeContact.email).toBe(true);
  });

  it('maps dates, people, identifiers, escrow, goals and safety', () => {
    const r = draftToRecord(
      draftWith({
        'safety.now': 'no',
        'when.date': { mode: 'date', date: '2025-07-04', approximate: false },
        'when.repeated': 'yes',
        'when.lastDate': { mode: 'text', text: 'last winter' },
        'when.ongoing': 'yes',
        'context.types': ['rape', 'drugging_suspected', 'bogus'],
        'person.list': [
          { id: 'p1', values: { name: 'J. Doe', known: 'yes', email: 'jd@example.com', handle: '@jd', platform: 'instagram' } },
          { id: 'p2', values: { description: 'tall, red jacket' } },
        ],
        'person.escrow': { p1: 'yes', p2: 'yes' },
        'people.told': [{ id: 'd1', values: { toWhom: 'my sister', method: 'text' } }],
        'medical.care': 'yes',
        'medical.exam': 'unsure',
        'safety.protective': 'unsure',
        'goals.police': 'yes',
        'goals.attorney': 'unsure',
        'costs.insurance': 'no',
      }),
    );
    assertValidRecord(r);
    expect(r.safety.inImmediateDanger).toBe(true);
    expect(r.incident.dateStart).toBe('2025-07-04');
    expect(r.incident.dateEnd).toBe('last winter');
    expect(r.incident.dateIsApproximate).toBe(true);
    expect(r.incident.isOngoing).toBe(true);
    expect(r.incident.incidentTypes).toEqual(['rape', 'drugging_suspected']);
    expect(r.perpetrators[0]).toMatchObject({
      id: 'p1',
      name: 'J. Doe',
      knownToSurvivor: true,
      escrowOptIn: true,
      identifiers: [
        { kind: 'full_name', value: 'J. Doe' },
        { kind: 'email', value: 'jd@example.com' },
        { kind: 'social_handle', value: '@jd', platform: 'instagram' },
      ],
    });
    // no identifiers → cannot be escrowed even if "yes"
    expect(r.perpetrators[1]).toMatchObject({ knownToSurvivor: false, escrowOptIn: false, identifiers: [] });
    expect(r.disclosures).toEqual([{ id: 'd1', toWhom: 'my sister', method: 'text', when: undefined, whatWasSaid: undefined }]);
    expect(r.medical).toMatchObject({ soughtCare: true, forensicExamCompleted: undefined });
    expect(r.safety.wantsProtectiveOrder).toBe('unsure');
    expect(r.goals).toEqual({ policeReport: 'yes', attorney: 'undecided', compensation: 'undecided', protectiveOrder: 'undecided' });
    expect(r.financialImpact.hasInsurance).toBe('no');
  });

  it('skipping every question still yields a completable record', () => {
    const d = emptyDraft();
    d.skipped = STEPS.filter((s) => s.kind !== 'info' && s.kind !== 'review').map((s) => s.id);
    const r = draftToRecord(d);
    assertValidRecord(r);
    noEmptyStrings(r);
  });

  it('draft is plain JSON (round-trips through serialization)', () => {
    const d = draftWith({ 'story.freeRecall': NARRATIVE, 'when.date': { mode: 'unsure' } });
    const back = JSON.parse(JSON.stringify(d)) as IntakeDraft;
    expect(draftToRecord(back, new Date(0))).toEqual(draftToRecord(d, new Date(0)));
  });
});

describe('script', () => {
  it('has unique ids and never uses forbidden wording', () => {
    const ids = STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const all = JSON.stringify(STEPS).toLowerCase();
    expect(all).not.toMatch(/alleged/);
    expect(all).not.toMatch(/\bwhy\b/);
  });
});
