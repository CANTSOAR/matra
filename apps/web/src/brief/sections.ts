import type { IntakeRecord } from '@matra/shared';
import type { BriefBlock, BriefOptions, BriefRow, BriefSection } from './types';
import {
  DISCLOSURE_METHOD_LABELS, EVIDENCE_KIND_LABELS, IDENTIFIER_LABELS, INCIDENT_TYPE_LABELS,
  NOT_PROVIDED, formatBytes, formatDate, formatTimestamp, goalLabel, has, orNP, yesNo,
} from './format';

export const BRIEF_TITLE = 'Confidential — Victim Statement & Evidentiary Summary';
export const REDACTED = 'Withheld at the survivor’s request — available through the survivor’s advocate or counsel';

const row = (label: string, value: string | undefined, extra: Partial<BriefRow> = {}): BriefRow => ({
  label, value: orNP(value), ...extra,
});

/** Verbatim row — value is the survivor's exact text. */
const vrow = (label: string, value: string | undefined): BriefRow =>
  has(value) ? { label, value: value!, verbatim: true } : { label, value: NOT_PROVIDED };

function incidentDate(r: IntakeRecord): string {
  const { dateStart, dateEnd, dateIsApproximate } = r.incident;
  if (!has(dateStart) && !has(dateEnd)) return NOT_PROVIDED;
  let s = has(dateEnd) && dateEnd !== dateStart
    ? `${formatDate(dateStart)} to ${formatDate(dateEnd)}`
    : formatDate(dateStart ?? dateEnd);
  if (dateIsApproximate) s += ' (approximate — as recalled by the survivor)';
  return s;
}

function jurisdiction(r: IntakeRecord): string {
  const j = r.incident.jurisdiction;
  const parts = [j.city, j.county ? (/county/i.test(j.county) ? j.county : `${j.county} County`) : undefined, j.state]
    .filter(has);
  let s = parts.join(', ');
  if (has(j.campus)) s = s ? `${s} — campus: ${j.campus}` : `Campus: ${j.campus}`;
  return orNP(s);
}

function safeMethods(r: IntakeRecord): string {
  const sc = r.survivor.safeContact;
  const ok = [sc.phone && 'Phone call', sc.text && 'Text message', sc.email && 'Email', sc.voicemail && 'Voicemail']
    .filter(Boolean) as string[];
  const no = [!sc.phone && 'phone calls', !sc.text && 'text messages', !sc.email && 'email', !sc.voicemail && 'voicemail']
    .filter(Boolean) as string[];
  if (ok.length === 0) return 'None selected — contact only through the survivor’s advocate or counsel';
  return ok.join(', ') + (no.length ? `. Do NOT use: ${no.join(', ')}.` : '.');
}

/**
 * Pure function: the structured content of the Police Evidentiary Brief.
 * Survivor-authored text is carried through byte-for-byte (never trimmed, rewritten or summarised).
 */
export function briefSections(record: IntakeRecord, opts: BriefOptions = {}): BriefSection[] {
  const r = record;
  const out: BriefSection[] = [];
  const redact = !!opts.redactContactInfo;

  // ── About this document ──
  out.push({
    id: 'about',
    title: 'About This Document',
    blocks: [
      {
        kind: 'rows',
        rows: [
          ...(has(opts.preparedFor) ? [row('Prepared for', opts.preparedFor)] : []),
          row('Generated', opts.generatedAt ? formatTimestamp(opts.generatedAt) : undefined),
          row('Account finalized by survivor', formatDate(r.completedAt)),
          ...(has(opts.recordId) ? [row('Record ID', opts.recordId, { mono: true })] : []),
        ],
      },
      {
        kind: 'paragraph',
        text:
          'This document was prepared at the direction of the survivor from an account the survivor recorded personally in a ' +
          'self-guided, encrypted intake. The account and every passage marked “In the survivor’s own words” ' +
          'are reproduced verbatim: no software or third party has summarised, reordered, corrected or ' +
          'interpreted them. Headings and labels are the only text added.',
      },
      {
        kind: 'note',
        tone: 'warning',
        text:
          'This is not a sworn statement unless signed and dated by the survivor in the attestation section. ' +
          'Sharing it does not by itself constitute a police report, and the survivor retains the right to ' +
          'choose whether to participate in any investigation (N.J.S.A. 52:4B-60.2(c)(7)).',
      },
    ],
  });

  // ── 1. Survivor ──
  const s = r.survivor;
  out.push({
    id: 'survivor',
    title: 'Survivor Information & Safe Contact',
    blocks: [{
      kind: 'rows',
      rows: [
        row('Preferred name', s.preferredName),
        row('Legal name', s.legalName),
        row('Date of birth', has(s.dateOfBirth) ? formatDate(s.dateOfBirth) : undefined),
        row('Pronouns', s.pronouns),
        row('Preferred language', s.preferredLanguage),
        redact ? row('Phone', REDACTED) : row('Phone', s.phone),
        redact ? row('Email', REDACTED) : row('Email', s.email),
        row('Safe contact methods', safeMethods(r)),
        vrow('Contact instructions', s.safeContactNotes),
        row('Residence', [s.residenceCounty && (/county/i.test(s.residenceCounty) ? s.residenceCounty : `${s.residenceCounty} County`), s.residenceState].filter(has).join(', ')),
      ],
    }],
  });

  // ── 2. Incident summary ──
  const inc = r.incident;
  out.push({
    id: 'incident',
    title: 'Incident Summary',
    blocks: [
      {
        kind: 'rows',
        rows: [
          row('Date', incidentDate(r)),
          vrow('Time', inc.timeDescription),
          vrow('Location', inc.locationDescription),
          row('Address', inc.locationAddress),
          row('Jurisdiction', jurisdiction(r)),
          row('Type(s) of harm reported', inc.incidentTypes.map((t) => INCIDENT_TYPE_LABELS[t] ?? t).join('; ')),
          row('Ongoing', inc.isOngoing ? 'Yes — the survivor reports this is ongoing' : 'No'),
        ],
      },
      ...(inc.incidentTypes.length
        ? [{ kind: 'note', tone: 'info', text: 'Types of harm are categories selected by the survivor; they are not legal charging decisions.' } as BriefBlock]
        : []),
    ],
  });

  // ── 3. Own words ──
  const n = r.narrative;
  out.push({
    id: 'narrative',
    title: 'Account — In the Survivor’s Own Words',
    blocks: has(n.freeRecall)
      ? [
          { kind: 'note', tone: 'info', text: 'Verbatim. Reproduced exactly as written by the survivor, including paragraph breaks, wording and spelling.' },
          { kind: 'verbatim', text: n.freeRecall },
        ]
      : [{ kind: 'note', tone: 'info', text: 'The survivor did not provide a written account in this intake.' }],
  });

  // ── 4. Sensory & contextual ──
  const sensory: Array<[string, string | undefined]> = [
    ['Sight', n.sensory.sight], ['Sound', n.sensory.sound], ['Smell', n.sensory.smell],
    ['Touch', n.sensory.touch], ['Taste', n.sensory.taste],
  ];
  const ctx: Array<[string, string | undefined]> = [
    ['Before the incident', n.contextBefore], ['After the incident', n.contextAfter], ['Additional details', n.additionalDetails],
  ];
  const sensBlocks: BriefBlock[] = [];
  for (const [label, text] of [...sensory, ...ctx]) if (has(text)) sensBlocks.push({ kind: 'verbatim', label, text });
  if (sensBlocks.length) {
    out.push({
      id: 'sensory',
      title: 'Sensory & Contextual Details',
      blocks: [{ kind: 'note', tone: 'info', text: 'In the survivor’s own words (verbatim).' }, ...sensBlocks],
    });
  }

  // ── 5. Statements by person responsible ──
  if (has(n.wordsSpoken)) {
    out.push({
      id: 'statements',
      title: 'Statements Made by the Person Responsible',
      blocks: [
        { kind: 'note', tone: 'info', text: 'As recalled by the survivor, in the survivor’s own words (verbatim).' },
        { kind: 'verbatim', text: n.wordsSpoken },
      ],
    });
  }

  // ── 6. Person(s) responsible ──
  if (r.perpetrators.length) {
    const blocks: BriefBlock[] = [];
    r.perpetrators.forEach((p, i) => {
      if (r.perpetrators.length > 1) blocks.push({ kind: 'subheading', text: `Person ${i + 1}` });
      const rows: BriefRow[] = [
        row('Name', p.name),
        row('Relationship to survivor', p.relationship),
        row('Known to survivor', p.knownToSurvivor ? 'Yes' : 'No'),
        vrow('Physical description', p.physicalDescription),
      ];
      for (const id of p.identifiers) {
        if (!has(id.value)) continue;
        const label = IDENTIFIER_LABELS[id.kind] + (has(id.platform) ? ` (${id.platform})` : '');
        rows.push({ label, value: id.value, mono: id.kind !== 'full_name' && id.kind !== 'other' });
      }
      blocks.push({ kind: 'rows', rows });
    });
    out.push({ id: 'perpetrators', title: 'Person(s) Responsible — As Identified by the Survivor', blocks });
  }

  // ── 7. Witnesses ──
  if (r.witnesses.length) {
    const blocks: BriefBlock[] = [];
    r.witnesses.forEach((w, i) => {
      blocks.push({ kind: 'subheading', text: `Witness ${i + 1}${has(w.name) ? ` — ${w.name}` : ''}` });
      blocks.push({
        kind: 'rows',
        rows: [
          row('Name', w.name),
          row('Relationship to survivor', w.relationship),
          redact && has(w.contact) ? row('Contact', REDACTED) : row('Contact', w.contact),
          vrow('What they know', w.whatTheyKnow),
        ],
      });
    });
    out.push({ id: 'witnesses', title: 'Witnesses', blocks });
  }

  // ── 8. Disclosures ──
  if (r.disclosures.length) {
    const blocks: BriefBlock[] = [{
      kind: 'note', tone: 'info',
      text: 'People the survivor told about the incident afterwards (outcry / “fresh complaint” witnesses), listed in the order the survivor entered them.',
    }];
    r.disclosures.forEach((d, i) => {
      blocks.push({ kind: 'subheading', text: `Disclosure ${i + 1} — ${orNP(d.toWhom)}` });
      blocks.push({
        kind: 'rows',
        rows: [
          row('Told', d.toWhom),
          row('When', formatDate(d.when)),
          row('How', d.method ? DISCLOSURE_METHOD_LABELS[d.method] : undefined),
          vrow('What was said', d.whatWasSaid),
        ],
      });
    });
    out.push({ id: 'disclosures', title: 'Disclosures — Outcry Witnesses', blocks });
  }

  // ── 9. Medical ──
  const m = r.medical;
  out.push({
    id: 'medical',
    title: 'Medical Care & Forensic Examination',
    blocks: [{
      kind: 'rows',
      rows: [
        row('Sought medical care', yesNo(m.soughtCare)),
        ...(m.soughtCare || has(m.facility) ? [row('Facility', m.facility)] : []),
        ...(m.soughtCare || has(m.date) ? [row('Date of care', formatDate(m.date))] : []),
        row('Forensic exam (SANE / evidence kit) completed', m.forensicExamCompleted === undefined ? NOT_PROVIDED : yesNo(m.forensicExamCompleted)),
        vrow('Injuries', m.injuries),
      ],
    }],
  });

  // ── 10. Prior reports ──
  if (r.priorReports.length) {
    out.push({
      id: 'priorReports',
      title: 'Prior Reports',
      blocks: [{
        kind: 'table',
        columns: [
          { header: 'Agency', width: 0.34 }, { header: 'Date', width: 0.18 },
          { header: 'Report no.', width: 0.18 }, { header: 'Outcome', width: 0.30 },
        ],
        rows: r.priorReports.map((p) => ({
          cells: [orNP(p.agency), formatDate(p.date), orNP(p.reportNumber), orNP(p.outcome)],
        })),
      }],
    });
  }

  // ── 11. Evidence ──
  if (r.evidence.length) {
    const anyStripped = r.evidence.some((e) => e.metadataStripped);
    out.push({
      id: 'evidence',
      title: 'Evidence Inventory',
      blocks: [
        {
          kind: 'table',
          columns: [
            { header: '#', width: 0.04 }, { header: 'File', width: 0.26 }, { header: 'Kind', width: 0.11 },
            { header: 'Description', width: 0.25 }, { header: 'Captured', width: 0.13 },
            { header: 'Size', width: 0.09 }, { header: 'Metadata stripped', width: 0.12 },
          ],
          rows: r.evidence.map((e, i) => ({
            cells: [
              String(i + 1), e.fileName || NOT_PROVIDED, EVIDENCE_KIND_LABELS[e.kind] ?? e.kind, orNP(e.description),
              formatDate(e.capturedAt), formatBytes(e.sizeBytes), e.metadataStripped ? 'Yes' : 'No',
            ],
            detail: { label: 'SHA-256', value: orNP(e.sha256), mono: true },
          })),
        },
        {
          kind: 'note', tone: 'info',
          text: 'SHA-256 values are computed over the exact file bytes provided to the reader (after any metadata stripping). ' +
            'Any change to a file — even one pixel or byte — produces a different value.',
        },
        ...(anyStripped
          ? [{
              kind: 'note', tone: 'warning',
              text: 'Files marked “Metadata stripped” had embedded device metadata (e.g. EXIF capture time, GPS location, device model) ' +
                'removed before encryption to protect the survivor. If that metadata is material, investigators should request the ' +
                'original files from the survivor’s own device, which the survivor has been advised to preserve.',
            } as BriefBlock]
          : []),
      ],
    });
  }

  // ── 12. Safety ──
  const sf = r.safety;
  out.push({
    id: 'safety',
    title: 'Safety Concerns',
    blocks: [
      ...(sf.inImmediateDanger
        ? [{ kind: 'note', tone: 'warning', text: 'The survivor reported that they were in immediate danger when completing this intake.' } as BriefBlock]
        : []),
      {
        kind: 'rows',
        rows: [
          row('In immediate danger', yesNo(sf.inImmediateDanger)),
          row('Person responsible knows where the survivor lives or works', sf.perpetratorHasAccess === undefined ? NOT_PROVIDED : yesNo(sf.perpetratorHasAccess)),
          row('Interested in a protective order', goalLabel(sf.wantsProtectiveOrder)),
          row('Abuse ongoing', inc.isOngoing ? 'Yes' : 'No'),
          vrow('Safety notes', sf.notes),
        ],
      },
    ],
  });

  // ── 13. Goals ──
  out.push({
    id: 'goals',
    title: 'Survivor’s Stated Goals',
    blocks: [
      {
        kind: 'rows',
        rows: [
          row('File a police report', goalLabel(r.goals.policeReport)),
          row('Speak with an attorney', goalLabel(r.goals.attorney)),
          row('Apply for crime victim compensation', goalLabel(r.goals.compensation)),
          row('Seek a protective order', goalLabel(r.goals.protectiveOrder)),
        ],
      },
      { kind: 'note', tone: 'info', text: 'Goals are as stated at the time of intake and may change. Nothing is sent to any agency without the survivor’s explicit approval at that moment.' },
    ],
  });

  // ── 14. Integrity ──
  out.push({ id: 'integrity', title: 'Integrity & Chain of Custody', blocks: integrityBlocks(r, opts) });

  // ── 15. Attestation ──
  out.push({
    id: 'attestation',
    title: 'Survivor Attestation',
    minSpace: 250,
    blocks: [
      { kind: 'paragraph', text: 'I declare that the information above is true to the best of my recollection.' },
      { kind: 'signature', lines: [{ label: 'Survivor signature', wide: true }, { label: 'Date' }, { label: 'Printed name', wide: true }] },
      { kind: 'subheading', text: 'Received by (agency use)' },
      { kind: 'signature', lines: [{ label: 'Name / badge or ID no.', wide: true }, { label: 'Date' }, { label: 'Agency', wide: true }, { label: 'Case / complaint no.' }] },
    ],
  });

  return out;
}

function integrityBlocks(r: IntakeRecord, opts: BriefOptions): BriefBlock[] {
  const L = opts.ledgerEntry;
  const sealed = has(opts.recordId) || has(opts.recordContentHash) || !!L;
  const blocks: BriefBlock[] = [];
  if (!sealed) {
    blocks.push({
      kind: 'note', tone: 'warning',
      text: 'This brief was generated from an account that had not yet been sealed to the integrity ledger. No timestamp attestation is available for this version.',
    });
  }
  blocks.push({
    kind: 'rows',
    rows: [
      row('Record ID', opts.recordId, { mono: true }),
      row('Record ciphertext SHA-256', opts.recordContentHash ?? L?.contentHash, { mono: true }),
      row('Account finalized (survivor’s device)', formatDate(r.completedAt)),
      ...(L
        ? [
            row('Ledger sequence no.', String(L.seq)),
            row('Ledger entry ID', L.id, { mono: true }),
            row('Ledger event', L.type),
            row('Ledger timestamp (server receipt)', formatDate(L.timestamp) === NOT_PROVIDED ? undefined : `${formatDate(L.timestamp)}  (${L.timestamp})`),
            row('Attested content hash', L.contentHash, { mono: true }),
            ...(has(opts.recordContentHash)
              ? [row('Record hash matches ledger', opts.recordContentHash === L.contentHash ? 'Yes' : 'NO — see warning below')]
              : []),
            row('Previous entry hash', L.prevHash, { mono: true }),
            row('Entry hash', L.entryHash, { mono: true }),
          ]
        : [row('Ledger entry', undefined)]),
      row('Evidence files listed', String(r.evidence.length)),
    ],
  });
  if (L && has(opts.recordContentHash) && opts.recordContentHash !== L.contentHash) {
    blocks.push({
      kind: 'note', tone: 'warning',
      text: 'The record hash supplied with this brief does not match the hash attested in the ledger entry. Treat the integrity data as unverified.',
    });
  }
  blocks.push({ kind: 'subheading', text: 'How to verify' });
  blocks.push({
    kind: 'paragraph',
    text:
      '1. Evidence files. Compute the SHA-256 of each file exactly as received (macOS/Linux: shasum -a 256 <file>; ' +
      'Windows: certutil -hashfile <file> SHA256) and compare it with the value in the Evidence Inventory. A match ' +
      'shows the file is bit-for-bit identical to the one the survivor sealed.',
  });
  blocks.push({
    kind: 'paragraph',
    text:
      '2. The account. The survivor’s account is stored only in encrypted form; the service operator cannot read it. ' +
      'When it was sealed, the SHA-256 of the encrypted record was written to an append-only, hash-chained ledger. ' +
      'Each entry’s hash is SHA-256(seq|type|subjectId|contentHash|timestamp|prevHash) and includes the previous entry’s ' +
      'hash, so an entry cannot be altered or back-dated without breaking every later entry. A matching ledger entry ' +
      'therefore shows that this exact encrypted record existed, unchanged, no later than the ledger timestamp.',
  });
  blocks.push({
    kind: 'paragraph',
    text:
      '3. This document. This PDF is a rendering of that record made on the survivor’s device. The authoritative version ' +
      'is the encrypted record; with the survivor’s consent, the survivor’s counsel can decrypt it and confirm that its hash matches ' +
      'the ledger and that its text matches this brief.',
  });
  return blocks;
}
