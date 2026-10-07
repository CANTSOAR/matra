/**
 * New Jersey Victims of Crime Compensation Office (VCCO) — application worksheet (DRAFT).
 * Mirrors the 16 sections of the official Claim Application (eff. 8/1/2020, rev. 8/25/2020).
 * Sources & rules: docs/research/brief-fields.md.
 */
import type { IntakeRecord, IncidentType } from '@matra/shared';
import type { BriefBlock, BriefRow, BriefSection } from './types';
import { renderPdf } from './pdf/render';
import { NOT_PROVIDED, formatDate, formatDateUTC, formatTimestamp, goalLabel, has, parseIsoDate } from './format';

export const VCCO = {
  onlineUrl: 'http://www.njoag.gov/vcco/vcco-online-application/',
  paperUrl: 'http://www.njoag.gov/vcco/vcco-paper-application/',
  mail: 'Victims of Crime Compensation Office, 50 Park Place, 5th floor, Newark, NJ 07102',
  phone: '(877) 658-2221 or (973) 648-2107',
  fax: '(973) 648-3937',
  email: 'njvictims@njvictims.org',
  web: 'www.NJVictims.org',
} as const;

const NEED = 'Needed — not collected in your intake';

const filled = (label: string, value: string | undefined, needHint = NEED): BriefRow =>
  has(value) && value !== NOT_PROVIDED ? { label, value } : { label, value: needHint, needed: true };
const need = (label: string, hint = NEED): BriefRow => ({ label, value: hint, needed: true });
const info = (label: string, value: string): BriefRow => ({ label, value });

/** VCCO "Type of Crime" checkbox labels, mapped from intake categories. */
const CRIME_TYPE: Partial<Record<IncidentType, string>> = {
  sexual_assault: 'Sexual assault',
  rape: 'Sexual assault',
  attempted_sexual_assault: 'Sexual assault',
  unwanted_touching: 'Sexual assault',
  drugging_suspected: 'Sexual assault',
  stalking: 'Stalking',
  domestic_violence: 'Domestic violence',
  dating_violence: 'Domestic violence',
};

/** Heuristic: was a prior report made to a law enforcement agency? (agency type is not yet captured in intake) */
const LE_RE = /police|sheriff|prosecutor|law enforcement|trooper|\bPD\b|public safety|\bFBI\b/i;
const lawEnforcementReports = (r: IntakeRecord) => r.priorReports.filter((p) => LE_RE.test(p.agency ?? ''));

function addMonthsUTC(d: Date, months: number): Date {
  const r = new Date(d.getTime());
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + months);
  const dim = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, dim));
  return r;
}

export function vccoSections(record: IntakeRecord, generatedAt: Date): BriefSection[] {
  const r = record;
  const s = r.survivor;
  const inc = r.incident;
  const fi = r.financialImpact;
  const out: BriefSection[] = [];

  // ── About ──
  out.push({
    id: 'about',
    title: 'About This Draft',
    blocks: [
      {
        kind: 'note', tone: 'warning',
        text: 'DRAFT — prepared to help you complete the official New Jersey VCCO application. This is not an official form ' +
          'and has not been sent to anyone. You must submit the official application (online or paper) yourself, or with ' +
          'help from a victim advocate.',
      },
      {
        kind: 'rows',
        rows: [
          info('Generated', formatTimestamp(generatedAt)),
          info('Official online application', VCCO.onlineUrl),
          info('Official paper application', VCCO.paperUrl),
          info('Free help', 'Your County Prosecutor’s Office of Victim-Witness Advocacy, your county rape crisis center, or the VCCO at ' + VCCO.phone),
        ],
      },
      {
        kind: 'paragraph',
        text: 'Answers below were copied from your intake. Items highlighted as “Needed” were not collected and must be ' +
          'filled in on the official form. Never write your Social Security number in this app — enter it only on the ' +
          'official application.',
      },
    ],
  });

  // ── Eligibility ──
  out.push({ id: 'eligibility', title: 'Eligibility Check (N.J.S.A. 52:4B-18)', blocks: [{ kind: 'checklist', items: eligibility(r, generatedAt) }] });

  // ── Section 1 ──
  const resid = [s.residenceCounty, s.residenceState].filter(has).join(', ');
  const dob = parseIsoDate(s.dateOfBirth);
  out.push({
    id: 's1', title: 'Section 1 — Victim Information (required)',
    blocks: [{
      kind: 'rows',
      rows: [
        need('Title (Mr / Mrs / Ms / Mx)'),
        filled('Full legal name', s.legalName),
        need('Social Security number', 'Enter only on the official form'),
        filled('Date of birth', has(s.dateOfBirth) ? formatDate(s.dateOfBirth) : undefined),
        info('Under 18', dob ? (ageOn(dob, generatedAt) < 18 ? 'Yes — a parent/guardian must sign' : 'No') : NOT_PROVIDED),
        need('Deceased / incompetent / disabled', 'Check if applicable'),
        need('Home mailing address, city, zip code'),
        filled('County, state', resid || undefined),
        filled('Phone (home / work / cell)', s.phone, 'Needed — and say which type'),
        filled('Email', s.email),
        need('Sex; race/ethnicity; marital status', 'Needed — demographic questions on the form'),
      ],
    }],
  });

  // ── Section 2/3 ──
  out.push({
    id: 's2', title: 'Section 2 — Claimant Information',
    blocks: [
      { kind: 'note', tone: 'info', text: 'Skip this section if you (the victim) are applying for yourself. A parent, guardian or spouse completes it when applying for a minor or incapacitated victim.' },
      { kind: 'rows', rows: [need('Are you applying for yourself?', 'Needed — confirm (if yes, skip Section 2)')] },
    ],
  });
  out.push({
    id: 's3', title: 'Section 3 — Additional Contact',
    blocks: [
      { kind: 'rows', rows: [need('Someone VCCO may contact if they cannot reach you', 'Needed — name, relationship, phone, email')] },
      ...(has(s.safeContactNotes) ? [{ kind: 'rows', rows: [{ label: 'Your safe-contact notes (from intake)', value: s.safeContactNotes!, verbatim: true }] } as BriefBlock] : []),
    ],
  });

  // ── Section 4 ──
  const reports = lawEnforcementReports(r);
  const otherReports = r.priorReports.filter((p) => !reports.includes(p));
  const crimeTypes = [...new Set(inc.incidentTypes.map((t) => CRIME_TYPE[t]).filter(Boolean) as string[])];
  const unmapped = inc.incidentTypes.filter((t) => !CRIME_TYPE[t]);
  const loc = has(inc.locationAddress)
    ? inc.locationAddress + (has(inc.jurisdiction.county) ? ` (${inc.jurisdiction.county} County)` : '')
    : [inc.jurisdiction.city, inc.jurisdiction.county, inc.jurisdiction.state].filter(has).join(', ');
  const deadlines = reportingDeadlines(r, generatedAt);
  out.push({
    id: 's4', title: 'Section 4 — Crime Incident Information (required)',
    blocks: [
      {
        kind: 'rows',
        rows: [
          filled('Date of crime', has(inc.dateStart) ? formatDate(inc.dateStart) + (inc.dateIsApproximate ? ' (approximate)' : '') : undefined),
          filled('Date reported to police', reports.find((p) => has(p.date))?.date ? formatDate(reports.find((p) => has(p.date))!.date) : undefined,
            'Needed — no police report recorded in your intake'),
          ...(otherReports.length ? [{ label: 'Other reports (not to law enforcement)', value: otherReports.map((p) => `${p.agency}${p.date ? ` (${formatDate(p.date)})` : ''}`).join('; ') }] : []),
          need('Name as it appears on the incident report'),
          filled('Law enforcement agency', reports.map((p) => p.agency).filter(has).join('; ') || undefined, reports.length ? NEED : 'The police department you report to'),
          filled('Location / address of crime', loc || undefined, 'Needed — address, city, county, state, zip'),
          filled('Police complaint number', reports.map((p) => p.reportNumber).filter(has).join('; ') || undefined, reports.length ? NEED : 'From the police report, once you have one'),
          need('Prosecutor’s file number', 'If known'),
          filled('Type of crime (check box)', crimeTypes.join(', ') || undefined, 'Needed — choose from the form’s list'),
          ...(unmapped.length ? [need('Other harm you described', `Check whether the form lists it: ${unmapped.join(', ').replace(/_/g, ' ')}`)] : []),
          need('Brief description of incident and injuries', 'Needed — a short description in your own words (1–3 sentences is enough)'),
          ...(has(r.medical.injuries) ? [{ label: 'Injuries (from your intake)', value: r.medical.injuries!, verbatim: true }] : []),
          filled('Name(s) of offender(s), if known', r.perpetrators.map((p) => p.name).filter(has).join('; ') || undefined, 'If known'),
          filled('Relationship to offender(s)', r.perpetrators.map((p) => p.relationship).filter(has).join('; ') || undefined, 'If any'),
          need('Living in the same household as the offender?', 'Needed — yes / no'),
          need('Has restitution been ordered?', 'Needed — yes / no'),
          deadlines.reportRow,
          deadlines.fileRow,
        ],
      },
      { kind: 'note', tone: 'info', text: 'Attach a copy of the police/incident report, TRO or FRO if you have one. If you don’t, VCCO will request it from the police or prosecutor.' },
    ],
  });

  // ── Section 5 ──
  const svc = (label: string, amount: string | undefined, cap: string): BriefRow =>
    has(amount) ? { label: `[x] ${label}`, value: `${amount}  (cap: ${cap})` } : { label: `[ ] ${label}`, value: `Not indicated in intake (cap: ${cap})` };
  out.push({
    id: 's5', title: 'Section 5 — Services Requested (required)',
    blocks: [
      {
        kind: 'rows',
        rows: [
          svc('Medical / dental / prescription', fi.medicalCosts ?? (r.medical.soughtCare ? 'You sought medical care — list any bills not covered by insurance' : undefined), 'within $25,000 overall'),
          svc('Counseling', fi.counselingCosts, '$20,000 for a direct victim'),
          svc('Relocation', fi.relocationCosts, '$3,000'),
          svc('Loss of earnings (victim)', fi.lostWages, '$600/week, up to 104 weeks'),
          svc('Other expenses', fi.otherCosts, 'varies — e.g. medical transportation $3,000; domestic help $6,500; child care $6,500; crime-scene clean-up $4,000'),
          info('Attorney fees — victims’ rights / related legal matters',
            `${r.goals.attorney === 'yes' ? 'You said you want an attorney. ' : ''}Paid at $275/hour, up to $10,000, only if you are otherwise eligible for compensation (N.J.S.A. 52:4B-8(b); N.J.A.C. 13:75-4.10).`),
          info('Attorney fees — help filing this claim', 'Lesser of $275/hour or 15% of the award.'),
        ],
      },
      { kind: 'note', tone: 'info', text: 'Overall maximum: $25,000 per claim (more for catastrophic injury). Not covered: pain and suffering, property loss (except crime-scene clean-up). VCCO pays last — after insurance, charity care and restitution.' },
    ],
  });

  // ── Section 6 ──
  out.push({
    id: 's6', title: 'Section 6 — Health Insurance / Benefits (required)',
    blocks: [{
      kind: 'rows',
      rows: [
        filled('Do you have insurance?', fi.hasInsurance ? goalLabel(fi.hasInsurance) : undefined),
        need('Medical / secondary / dental / auto / homeowner’s or renter’s insurance', 'Needed — carrier and policy number for each'),
        need('Charity care applied for?', 'Needed — if uninsured, apply for charity care at the hospital that treated you'),
      ],
    }],
  });

  // ── Section 7 ──
  out.push({
    id: 's7', title: 'Section 7 — Medical / Counseling Providers',
    blocks: [{
      kind: 'rows',
      rows: r.medical.soughtCare || has(r.medical.facility)
        ? [
            filled('Hospital / doctor name', r.medical.facility),
            filled('Date(s) of treatment', has(r.medical.date) ? formatDate(r.medical.date) : undefined),
            need('Provider address and phone'),
            need('Counseling providers', 'Needed — if any: name, dates, address, phone'),
          ]
        : [info('Medical care', 'You did not report seeking medical care.'), need('Counseling providers', 'If any: name, dates, address, phone')],
    }],
  });

  // ── Section 8 ──
  out.push({
    id: 's8', title: 'Section 8 — Lost Wages / Support',
    blocks: [{
      kind: 'rows',
      rows: has(fi.lostWages)
        ? [
            { label: 'Lost wages (from your intake)', value: fi.lostWages! },
            need('Employer name, address, phone, fax'),
            need('Dates absent from work'),
            need('On the job when it happened? Workers’ comp? State disability / Family Leave applied for?'),
            info('Documents', 'Pay stubs from the week before the crime and the week you returned; doctor’s letter stating period of disability.'),
          ]
        : [info('Lost wages', 'None indicated — skip unless you missed unpaid work.')],
    }],
  });

  out.push({ id: 's9', title: 'Section 9 — Dependent Information', blocks: [{ kind: 'rows', rows: [info('Applies to', 'Homicide claims — usually skip.')] }] });

  out.push({
    id: 's10', title: 'Section 10 — Attorney Information',
    blocks: [{
      kind: 'rows',
      rows: [
        info('Want an attorney (from intake)', goalLabel(r.goals.attorney)),
        need('Attorney name, address, phone; type of representation', 'If you have hired one: VCCO application / civil suit / victims’ rights in criminal proceedings'),
        need('Do you intend to file a lawsuit later?', 'Yes / no'),
      ],
    }],
  });

  out.push({
    id: 's11', title: 'Section 11 — Referral Information',
    blocks: [{ kind: 'rows', rows: [need('Who referred you to the VCCO?', 'e.g. Domestic Violence / Rape Crisis Center, Prosecutor, Internet, Other')] }],
  });

  out.push({
    id: 's12', title: 'Sections 12–15 — Signatures (required, on the official form)',
    blocks: [{
      kind: 'checklist',
      items: [
        { status: 'needed', text: 'Section 12 — Legal Authorization and Signature: you agree to repay VCCO from other sources (insurance, restitution, lawsuits) and certify the information is true.' },
        { status: 'needed', text: 'Section 13 — Authorization to Obtain Records (medical, employment, police and prosecutor records).' },
        { status: 'needed', text: 'Section 14 — Assignment of Interest (VCCO may be reimbursed from restitution and up to two-thirds of its award from any civil suit proceeds).' },
        { status: 'needed', text: 'Section 15 — HIPAA authorization for each health-care provider.' },
        { status: 'info', text: 'A parent or legal representative must sign if the victim is under 18 or legally incompetent.' },
      ],
    }],
  });

  out.push({
    id: 's16', title: 'Section 16 — Additional Details / Good Cause',
    blocks: [{
      kind: 'rows',
      rows: [need('Reasons for a late police report or late filing, if any', deadlines.goodCauseNeeded
        ? 'Needed — explain the “good cause” for the delay (e.g. you were not told about VCCO benefits)'
        : 'Only if you reported after 9 months or file after 5 years')],
    }],
  });

  out.push({
    id: 'submit', title: 'How to Submit',
    blocks: [
      {
        kind: 'rows',
        rows: [
          info('Online', VCCO.onlineUrl),
          info('Paper form', VCCO.paperUrl),
          info('Mail to', VCCO.mail),
          info('Phone', VCCO.phone),
          info('Fax', VCCO.fax),
          info('Email (status questions)', VCCO.email),
        ],
      },
      {
        kind: 'paragraph',
        text: 'Include copies of itemized bills, receipts and insurance statements you have; you can send more later. ' +
          'By law VCCO decides within 90 days of receiving a complete file. Keep a copy of everything you submit.',
      },
    ],
  });

  return out;
}

function ageOn(dob: Date, at: Date): number {
  let a = at.getUTCFullYear() - dob.getUTCFullYear();
  const m = at.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && at.getUTCDate() < dob.getUTCDate())) a--;
  return a;
}

function reportingDeadlines(r: IntakeRecord, now: Date): { reportRow: BriefRow; fileRow: BriefRow; goodCauseNeeded: boolean } {
  const incDate = parseIsoDate(r.incident.dateStart);
  const reportDates = lawEnforcementReports(r).map((p) => parseIsoDate(p.date)).filter((d): d is Date => !!d).sort((a, b) => +a - +b);
  let goodCause = false;
  let reportRow: BriefRow;
  if (!incDate) {
    reportRow = need('Police report within 9 months?', 'Needed — incident date not given as a calendar date');
  } else if (reportDates.length) {
    const ok = reportDates[0] <= addMonthsUTC(incDate, 9);
    if (!ok) goodCause = true;
    reportRow = ok
      ? { label: 'Police report within 9 months?', value: 'Yes (based on the dates in your intake)' }
      : need('Police report within 9 months?', 'No — explain good cause in Section 16 (reporting after reasonable discovery may still count)');
  } else {
    const dl = addMonthsUTC(incDate, 9);
    reportRow = need('Police report within 9 months?',
      dl >= now ? `Not yet reported — the 9-month reporting deadline is ${formatDateUTC(dl)}` : `Not reported — 9-month window ended ${formatDateUTC(dl)}; good cause required`);
    if (dl < now) goodCause = true;
  }

  let fileRow: BriefRow;
  if (!incDate) {
    fileRow = need('Filed within 5 years?', 'Needed — incident date not given as a calendar date');
  } else {
    let start = incDate;
    const dob = parseIsoDate(r.survivor.dateOfBirth);
    if (dob && ageOn(dob, incDate) < 18) start = addMonthsUTC(dob, 18 * 12);
    const dl = addMonthsUTC(start, 60);
    if (dl >= now) fileRow = { label: 'Filed within 5 years?', value: `Yes, if filed by ${formatDateUTC(dl)}` };
    else { fileRow = need('Filed within 5 years?', `No — deadline was ${formatDateUTC(dl)}; good cause required`); goodCause = true; }
  }
  return { reportRow, fileRow, goodCauseNeeded: goodCause };
}

function eligibility(r: IntakeRecord, now: Date) {
  const items: Array<{ text: string; status: 'ok' | 'needed' | 'warning' | 'info' }> = [];
  const st = r.incident.jurisdiction.state?.toUpperCase();
  const res = r.survivor.residenceState?.toUpperCase();
  if (st === 'NJ') items.push({ status: 'ok', text: 'The crime occurred in New Jersey.' });
  else if (res === 'NJ') items.push({ status: 'warning', text: 'You live in New Jersey but the crime may have occurred elsewhere. NJ covers residents only if the state where it happened has no compensation program — apply to that state’s program first.' });
  else items.push({ status: 'needed', text: 'Confirm the crime occurred in New Jersey (or that you are a NJ resident).' });

  const incDate = parseIsoDate(r.incident.dateStart);
  if (lawEnforcementReports(r).length === 0) {
    const dl = incDate ? addMonthsUTC(incDate, 9) : null;
    items.push({
      status: 'warning',
      text: (r.priorReports.length ? 'Your intake lists a report, but not one to police. ' : 'No police report is recorded. ') + 'Under current New Jersey law the crime must be reported to police or another law ' +
        'enforcement agency within 9 months of when it happened (or was reasonably discovered)' +
        (dl ? ` — for the date you gave, by ${formatDateUTC(dl)}` : '') +
        '. A forensic exam with a “Five-Year Hold Kit” alone does not currently meet this requirement. Bills pending in ' +
        'the Legislature (S1294 / A6254) would create an exception for survivors who received forensic medical services; ' +
        'as of this draft we could not confirm they have become law. Ask a victim advocate.',
    });
  } else {
    items.push({ status: 'info', text: 'A report to law enforcement is recorded. Confirm the date on the official form.' });
  }
  const dl5 = incDate ? addMonthsUTC(incDate, 60) : null;
  items.push(!dl5
    ? { status: 'needed', text: 'Give the date of the crime: claims must be filed within 5 years of it (minors: within 5 years after turning 18).' }
    : dl5 < now
    ? { status: 'warning', text: `The 5-year filing window appears to have ended (${formatDateUTC(dl5)}). VCCO can accept late claims for good cause — for example if you were never told about these benefits.` }
    : { status: 'ok', text: `File within 5 years of the crime (by ${formatDateUTC(dl5)}). Minors have until 5 years after turning 18.` });
  items.push({ status: 'info', text: 'You must cooperate with reasonable requests from police and the prosecutor, but eligibility does not depend on an arrest, prosecution or conviction.' });
  items.push({ status: has(r.financialImpact.medicalCosts) || has(r.financialImpact.counselingCosts) || has(r.financialImpact.lostWages) || has(r.financialImpact.relocationCosts) || has(r.financialImpact.otherCosts) ? 'ok' : 'needed',
    text: 'You need out-of-pocket losses caused by the crime (e.g. medical, counseling, lost wages, relocation) not covered by insurance or other sources.' });
  items.push({ status: 'info', text: 'Forensic sexual assault exams in New Jersey are free to the victim whether or not you report (N.J.S.A. 52:4B-22(b)) — do not list them as an expense.' });
  return items;
}

export async function generateVccoDraft(record: IntakeRecord, opts: { generatedAt?: Date } = {}): Promise<Uint8Array> {
  const generatedAt = opts.generatedAt ?? new Date();
  return renderPdf(vccoSections(record, generatedAt), {
    kicker: 'Prepared with Matra · New Jersey Victims of Crime Compensation Office',
    tag: 'DRAFT — NOT AN OFFICIAL FORM',
    title: 'NJ Crime Victim Compensation — Application Worksheet',
    subtitle: 'Prepared to help complete the official NJ VCCO Claim Application. Not an official form; not submitted.',
    runningTitle: 'DRAFT — NJ VCCO application worksheet · not an official form',
    runningRight: 'DRAFT · CONFIDENTIAL',
    footerLeft: `Prepared with Matra · Generated ${formatTimestamp(generatedAt)}`,
    footerCenter: 'DRAFT — NOT AN OFFICIAL FORM',
    watermark: 'DRAFT — NOT AN OFFICIAL FORM',
    numberSections: false,
    sanitizedNote: 'Some characters could not be displayed in this PDF’s standard fonts and are shown as [?]. Your original text is unchanged in your encrypted record.',
    meta: { title: 'DRAFT — NJ VCCO application worksheet', subject: 'Not an official form', date: generatedAt },
  });
}
