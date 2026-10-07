import type {
  Disclosure,
  IncidentType,
  IntakeRecord,
  Perpetrator,
  PerpetratorIdentifier,
  Witness,
} from '@shield/shared';
import { answerOf, asDate, asGroup, asList, asRecord, asText, type IntakeDraft } from './draft';
import { INCIDENT_TYPE_OPTIONS } from './script';

/** Non-blank string, kept exactly as typed (never trimmed or altered). */
function keep(v: string | undefined): string | undefined {
  return v !== undefined && v.trim() !== '' ? v : undefined;
}

function tri(d: IntakeDraft, id: string): 'yes' | 'no' | 'unsure' | undefined {
  const v = answerOf(d, id);
  return v === 'yes' || v === 'no' || v === 'unsure' ? v : undefined;
}

function goal(d: IntakeDraft, id: string): 'yes' | 'no' | 'undecided' {
  const t = tri(d, id);
  return t === 'yes' || t === 'no' ? t : 'undecided';
}

function text(d: IntakeDraft, id: string): string | undefined {
  return asText(answerOf(d, id));
}

/** ISO date, or her own words, or undefined if unsure/skipped. */
function dateValue(d: IntakeDraft, id: string): { value?: string; approximate: boolean; answered: boolean } {
  const a = asDate(answerOf(d, id));
  if (!a) return { approximate: false, answered: false };
  if (a.mode === 'unsure') return { approximate: true, answered: true };
  if (a.mode === 'text') return { value: keep(a.text), approximate: true, answered: true };
  return { value: keep(a.date), approximate: !!a.approximate, answered: true };
}

const VALID_TYPES = new Set<string>(INCIDENT_TYPE_OPTIONS.map((o) => o.value));
const VALID_METHODS = new Set(['in_person', 'phone', 'text', 'social_media', 'email', 'other']);

/**
 * Pure: turn a draft into the IntakeRecord contract.
 * - Skipped / blank / hidden answers become `undefined`, never ''.
 * - Required booleans/arrays get safe defaults.
 * - Her words are copied byte-for-byte.
 */
export function draftToRecord(draft: IntakeDraft, now: Date = new Date()): IntakeRecord {
  const d = draft;

  // ── survivor ──
  const contact = asList(answerOf(d, 'about.contactMethods'));
  const home = asRecord(answerOf(d, 'about.home'));

  // ── incident ──
  const start = dateValue(d, 'when.date');
  const end = dateValue(d, 'when.lastDate');
  const area = asRecord(answerOf(d, 'where.area'));
  const incidentTypes = asList(answerOf(d, 'context.types')).filter((t): t is IncidentType => VALID_TYPES.has(t));

  // ── people ──
  const escrow = asRecord(answerOf(d, 'person.escrow'));
  const perpetrators: Perpetrator[] = asGroup(answerOf(d, 'person.list'))
    .filter((p) => Object.values(p.values).some((v) => (v ?? '').trim() !== ''))
    .map((p) => {
      const v = p.values;
      const identifiers: PerpetratorIdentifier[] = [];
      if (keep(v.name)) identifiers.push({ kind: 'full_name', value: v.name });
      if (keep(v.email)) identifiers.push({ kind: 'email', value: v.email });
      if (keep(v.phone)) identifiers.push({ kind: 'phone', value: v.phone });
      if (keep(v.handle)) identifiers.push({ kind: 'social_handle', value: v.handle, platform: keep(v.platform) });
      if (keep(v.otherId)) identifiers.push({ kind: 'other', value: v.otherId });
      return {
        id: p.id,
        name: keep(v.name),
        relationship: keep(v.relationship),
        knownToSurvivor: v.known === 'yes',
        physicalDescription: keep(v.description),
        identifiers,
        escrowOptIn: escrow[p.id] === 'yes' && identifiers.length > 0,
      };
    });

  const witnesses: Witness[] = asGroup(answerOf(d, 'people.witnesses'))
    .filter((w) => Object.values(w.values).some((v) => (v ?? '').trim() !== ''))
    .map((w) => ({
      id: w.id,
      name: keep(w.values.name),
      contact: keep(w.values.contact),
      relationship: keep(w.values.relationship),
      whatTheyKnow: keep(w.values.whatTheyKnow),
    }));

  const disclosures: Disclosure[] = asGroup(answerOf(d, 'people.told'))
    .filter((x) => Object.values(x.values).some((v) => (v ?? '').trim() !== ''))
    .map((x) => ({
      id: x.id,
      // `toWhom` is required by the contract; '' only if she filled other details but not the name.
      toWhom: keep(x.values.toWhom) ?? '',
      when: keep(x.values.when),
      method: VALID_METHODS.has(x.values.method) ? (x.values.method as Disclosure['method']) : undefined,
      whatWasSaid: keep(x.values.whatWasSaid),
    }));

  const priorReports: IntakeRecord['priorReports'] = asGroup(answerOf(d, 'prior.list'))
    .filter((x) => Object.values(x.values).some((v) => (v ?? '').trim() !== ''))
    .map((x) => ({
      id: x.id,
      agency: keep(x.values.agency) ?? '',
      date: keep(x.values.date),
      reportNumber: keep(x.values.reportNumber),
      outcome: keep(x.values.outcome),
    }));

  // ── medical ──
  const care = tri(d, 'medical.care');
  const exam = tri(d, 'medical.exam');
  const medDate = dateValue(d, 'medical.date');

  // ── safety ──
  const safeNow = tri(d, 'safety.now');
  const access = tri(d, 'safety.access');
  const po = tri(d, 'safety.protective');

  // ── costs ──
  const costs = asRecord(answerOf(d, 'costs.amounts'));
  const insurance = tri(d, 'costs.insurance');

  // Protective-order goal: her explicit answer in "What you want", else what she said under safety.
  const poGoal = tri(d, 'goals.protective') ?? po;

  return {
    schemaVersion: 1,
    completedAt: now.toISOString(),
    survivor: {
      preferredName: text(d, 'about.name'),
      legalName: text(d, 'about.legalName'),
      dateOfBirth: text(d, 'about.dob'),
      pronouns: text(d, 'about.pronouns'),
      preferredLanguage: text(d, 'about.language'),
      phone: text(d, 'about.phone'),
      email: text(d, 'about.email'),
      safeContact: {
        phone: contact.includes('phone'),
        text: contact.includes('text'),
        email: contact.includes('email'),
        voicemail: contact.includes('voicemail'),
      },
      safeContactNotes: text(d, 'about.contactNotes'),
      residenceState: keep(home.state),
      residenceCounty: keep(home.county),
    },
    incident: {
      dateStart: start.value,
      dateEnd: end.value,
      // Unknown or skipped date is treated as approximate, never as exact.
      dateIsApproximate: start.answered ? start.approximate || (end.answered && end.approximate) : true,
      timeDescription: text(d, 'when.time'),
      locationDescription: text(d, 'where.place'),
      locationAddress: text(d, 'where.address'),
      jurisdiction: {
        state: keep(area.state),
        county: keep(area.county),
        city: keep(area.city),
        campus: keep(area.campus),
      },
      incidentTypes,
      isOngoing: tri(d, 'when.ongoing') === 'yes',
    },
    narrative: {
      // Required string: '' only if she chose not to write it yet.
      freeRecall: text(d, 'story.freeRecall') ?? '',
      sensory: {
        sight: text(d, 'recall.sight'),
        sound: text(d, 'recall.sound'),
        smell: text(d, 'recall.smell'),
        touch: text(d, 'recall.touch'),
        taste: text(d, 'recall.taste'),
      },
      contextBefore: text(d, 'context.before'),
      contextAfter: text(d, 'context.after'),
      additionalDetails: text(d, 'recall.more'),
      wordsSpoken: text(d, 'context.words'),
    },
    perpetrators,
    witnesses,
    disclosures,
    medical: {
      soughtCare: care === 'yes',
      facility: text(d, 'medical.facility'),
      date: medDate.value,
      forensicExamCompleted: exam === 'yes' ? true : exam === 'no' ? false : undefined,
      injuries: text(d, 'medical.injuries'),
    },
    priorReports,
    // Evidence files are encrypted and attached by the evidence module / shell.
    evidence: [],
    safety: {
      inImmediateDanger: safeNow === 'no',
      perpetratorHasAccess: access === 'yes' ? true : access === 'no' ? false : undefined,
      wantsProtectiveOrder: po,
      notes: text(d, 'safety.notes'),
    },
    financialImpact: {
      medicalCosts: keep(costs.medical),
      counselingCosts: keep(costs.counseling),
      lostWages: keep(costs.wages),
      relocationCosts: keep(costs.relocation),
      otherCosts: keep(costs.other),
      hasInsurance: insurance,
    },
    goals: {
      policeReport: goal(d, 'goals.police'),
      attorney: goal(d, 'goals.attorney'),
      compensation: goal(d, 'goals.compensation'),
      protectiveOrder: poGoal === 'yes' || poGoal === 'no' ? poGoal : 'undecided',
    },
  };
}
