import { describe, expect, it } from 'vitest';
import type { IntakeRecord } from '@matra/shared';
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
  expect([undefined, 'safe', 'not_safe', 'unsure']).toContain(r.safety.immediateSafety);
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
    expect(r.safety.immediateSafety).toBe('not_safe');
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

  it('maps "Are you safe right now?" exactly, including "I\'m not sure" and skipped', () => {
    expect(draftToRecord(draftWith({ 'safety.now': 'yes' })).safety.immediateSafety).toBe('safe');
    expect(draftToRecord(draftWith({ 'safety.now': 'no' })).safety.immediateSafety).toBe('not_safe');
    expect(draftToRecord(draftWith({ 'safety.now': 'unsure' })).safety.immediateSafety).toBe('unsure');
    expect(draftToRecord(draftWith({})).safety.immediateSafety).toBeUndefined();
  });

  it('maps force, strangulation, substances, kit, physical evidence, access and person details', () => {
    const r = draftToRecord(
      draftWith({
        'details.force': ['restraint', 'weapon', 'bogus'],
        'details.forceWords': ' He blocked the door. ',
        'details.strangulation': 'unsure',
        'details.substances': ['suspected_drugging'],
        'details.incapacitated': 'yes',
        'details.substancesWords': 'My drink tasted salty.',
        'medical.care': 'yes',
        'medical.exam': 'yes',
        'medical.kit': { toxicology: 'yes', fiveYearHold: 'unsure', reported: '' },
        'evidence.physical': ['clothing', 'bedding'],
        'evidence.physicalNotes': 'In a paper bag.',
        'wishes.access': { interpreter: 'yes', language: 'Spanish', otherNeeds: '' },
        'person.list': [{ id: 'p1', values: { name: 'Sam Doe', address: '12 Elm St', workplace: 'the gym', vehicle: 'red truck', whereabouts: '' } }],
        'prior.any': 'yes',
        'prior.list': [
          { id: 'r1', values: { agency: 'City PD', agencyType: 'police', prosecutorFileNumber: 'P-22' } },
          { id: 'r2', values: { agency: 'Title IX', agencyType: 'nonsense' } },
        ],
      }),
    );
    expect(r.incident.force).toEqual({ kinds: ['restraint', 'weapon'], description: ' He blocked the door. ' });
    expect(r.incident.strangulation).toBe('unsure');
    expect(r.incident.substances).toEqual({ kinds: ['suspected_drugging'], suspectedIncapacitation: 'yes', description: 'My drink tasted salty.' });
    expect(r.medical).toMatchObject({ forensicExamCompleted: true, toxicologyTest: 'yes', fiveYearHoldKit: 'unsure', kitReportedToPolice: undefined });
    expect(r.physicalEvidence).toEqual({ kinds: ['clothing', 'bedding'], description: 'In a paper bag.' });
    expect(r.survivor.accessibility).toEqual({ interpreter: 'yes', interpreterLanguage: 'Spanish', otherNeeds: undefined });
    expect(r.perpetrators[0]).toMatchObject({ address: '12 Elm St', workplace: 'the gym', vehicle: 'red truck', whereabouts: undefined });
    expect(r.priorReports[0]).toMatchObject({ agencyType: 'police', prosecutorFileNumber: 'P-22' });
    expect(r.priorReports[1].agencyType).toBeUndefined();
  });

  it('hides follow-ups when their question was not answered that way', () => {
    const r = draftToRecord(
      draftWith({
        'details.forceWords': 'left over',
        'details.incapacitated': 'yes',
        'medical.care': 'no',
        'medical.kit': { toxicology: 'yes' },
        'goals.compensation': 'no',
        'comp.mailing': { street: '1 Main St' },
        'costs.insurance': 'no',
        'costs.insuranceCarrier': 'Acme',
      }),
    );
    expect(r.incident.force).toBeUndefined();
    expect(r.incident.substances).toBeUndefined();
    expect(r.medical.toxicologyTest).toBeUndefined();
    expect(r.compensation).toBeUndefined();
  });

  it('collects compensation-only details when she wants help with compensation', () => {
    const r = draftToRecord(
      draftWith({
        'goals.compensation': 'unsure',
        'comp.mailing': { street: '1 Main St', city: 'Newark', state: 'NJ', zip: '07102' },
        'comp.claimant': 'other',
        'comp.claimantDetails': 'my mom, Rosa',
        'comp.altContact': { name: 'Rosa', phone: '555-0101' },
        'comp.goodCause': 'I did not know this help existed.',
        'costs.insurance': 'yes',
        'costs.insuranceCarrier': 'Acme Health',
        'costs.amounts': { wages: '$400' },
        'costs.work': { employer: 'Cafe', datesMissed: 'two weeks in May' },
      }),
    );
    expect(r.compensation).toEqual({
      mailingAddress: { street: '1 Main St', city: 'Newark', state: 'NJ', zip: '07102' },
      claimant: 'other',
      claimantDetails: 'my mom, Rosa',
      alternateContact: { name: 'Rosa', relationship: undefined, phone: '555-0101', email: undefined },
      insuranceCarrier: 'Acme Health',
      employer: 'Cafe',
      workDatesMissed: 'two weeks in May',
      goodCauseExplanation: 'I did not know this help existed.',
    });
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
  it('asks every specific question only after free recall', () => {
    const idx = (id: string) => STEPS.findIndex((s) => s.id === id);
    const recall = idx('story.freeRecall');
    expect(recall).toBeGreaterThan(0);
    for (const id of ['details.force', 'details.strangulation', 'details.substances', 'medical.kit', 'evidence.physical', 'wishes.access', 'comp.mailing', 'comp.goodCause'])
      expect(idx(id), id).toBeGreaterThan(recall);
  });

  it('has unique ids and never uses forbidden wording', () => {
    const ids = STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const all = JSON.stringify(STEPS).toLowerCase();
    expect(all).not.toMatch(/alleged/);
    expect(all).not.toMatch(/\bwhy\b/);
  });
});

describe('sealed match: unique identifiers only', () => {
  const person = (values: Record<string, string>) => [{ id: 'p1', values }];
  it('never opts in on a name alone, and does not offer the choice', () => {
    const d = draftWith({ 'person.list': person({ name: 'Ryan Smith' }), 'person.escrow': { p1: 'yes' } });
    expect(draftToRecord(d).perpetrators[0].escrowOptIn).toBe(false);
    expect(STEPS.find((s) => s.id === 'person.escrow')!.showIf!(d)).toBe(false);
  });
  it('opts in with a phone / email / handle, and then asks how a counselor may reach her', () => {
    const d = draftWith({ 'person.list': person({ name: 'R.', phone: '(201) 555-0142' }), 'person.escrow': { p1: 'yes' } });
    expect(draftToRecord(d).perpetrators[0].escrowOptIn).toBe(true);
    // free text, a non-profile link, or an invalid number never opts in (review M1/H2)
    for (const values of [{ otherId: 'Badguy 2015550100' } as Record<string, string>, { handle: 'https://www.instagram.com/share/AbC', platform: 'instagram' }, { phone: '555' }])
      expect(draftToRecord(draftWith({ 'person.list': person({ name: 'R.', ...values }), 'person.escrow': { p1: 'yes' } })).perpetrators[0].escrowOptIn).toBe(false);
    expect(STEPS.find((s) => s.id === 'person.matchContact')!.showIf!(d)).toBe(true);
    const words = STEPS.find((s) => s.id === 'person.escrow')!.say.join(' ');
    expect(words).toMatch(/legal options counselor — not the police, not your school/);
    expect(words).toMatch(/not unique enough/);
  });
});
