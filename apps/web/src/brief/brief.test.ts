// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import type { IntakeRecord } from '@shield/shared';
import { briefSections, generatePoliceBrief, generateVccoDraft, vccoSections } from './index';
import type { BriefSection } from './types';
import { minimalRecord, sampleBriefOptions, sampleRecord } from './fixtures';
import { makeSanitizer, wrapText } from './pdf/text';
import { NOT_PROVIDED } from './format';

/** Every string that ends up in the structured content. */
function allText(sections: BriefSection[]): string[] {
  const out: string[] = [];
  for (const s of sections) {
    out.push(s.title);
    for (const b of s.blocks) {
      switch (b.kind) {
        case 'rows': b.rows.forEach((r) => out.push(r.label, r.value)); break;
        case 'verbatim': out.push(b.text); if (b.label) out.push(b.label); break;
        case 'paragraph': case 'note': case 'subheading': out.push(b.text); break;
        case 'table': b.rows.forEach((r) => { out.push(...r.cells); if (r.detail) out.push(r.detail.value); }); break;
        case 'checklist': b.items.forEach((i) => out.push(i.text)); break;
        case 'signature': b.lines.forEach((l) => out.push(l.label)); break;
      }
    }
  }
  return out;
}
const joined = (s: BriefSection[]) => allText(s).join('\n');

const isPdf = (b: Uint8Array) => String.fromCharCode(...b.slice(0, 5)) === '%PDF-';
const pageCount = async (b: Uint8Array) => (await PDFDocument.load(b)).getPageCount();

function hugeRecord(): IntakeRecord {
  const para =
    'I remember the hallway light flickering and the sound of the elevator. He said “stay here” — and I didn’t move. ' +
    'Он сказал мне молчать. 他说不要告诉任何人。 قال لي لا تخبري أحدا 😢🙏🏽 👩‍👩‍👧 Łódź, Đorđe, naïve café. ';
  const words: string[] = [];
  while (words.length < 20_000) words.push(...para.split(/\s+/).filter(Boolean));
  const paras: string[] = [];
  for (let i = 0; i < 20_000; i += 180) paras.push(words.slice(i, Math.min(i + 180, 20_000)).join(' '));
  const freeRecall = paras.join('\n\n');
  return {
    ...sampleRecord,
    narrative: { ...sampleRecord.narrative, freeRecall, wordsSpoken: '“Ты никому не скажешь.” 🤫' },
    evidence: Array.from({ length: 30 }, (_, i) => ({ ...sampleRecord.evidence[i % 4], id: `e${i}`, fileName: `file-${i}-${'x'.repeat(i)}.jpg` })),
  };
}

describe('briefSections', () => {
  it('includes every populated field of the sample record', () => {
    const t = joined(briefSections(sampleRecord, sampleBriefOptions));
    const r = sampleRecord;
    const expected = [
      r.survivor.preferredName, r.survivor.legalName, r.survivor.pronouns, r.survivor.preferredLanguage,
      r.survivor.phone, r.survivor.email, r.survivor.safeContactNotes,
      r.incident.timeDescription, r.incident.locationDescription, r.incident.locationAddress, 'New Brunswick', 'Middlesex County',
      'Sexual assault', 'August 14, 2026',
      r.narrative.freeRecall, ...Object.values(r.narrative.sensory), r.narrative.contextBefore, r.narrative.contextAfter,
      r.narrative.additionalDetails, r.narrative.wordsSpoken,
      r.perpetrators[0].name, r.perpetrators[0].relationship, r.perpetrators[0].physicalDescription,
      ...r.perpetrators[0].identifiers.map((i) => i.value), 'Instagram',
      r.witnesses[0].name, r.witnesses[0].contact, r.witnesses[0].relationship, r.witnesses[0].whatTheyKnow,
      ...r.disclosures.flatMap((d) => [d.toWhom, d.whatWasSaid]), 'Text message', 'Phone call', 'Sunday, August 16, in the evening',
      r.medical.facility, r.medical.injuries,
      r.priorReports[0].agency, r.priorReports[0].reportNumber, r.priorReports[0].outcome,
      ...r.evidence.flatMap((e) => [e.fileName, e.sha256, e.description]), '2.7 MB',
      r.safety.notes,
      sampleBriefOptions.recordId, sampleBriefOptions.recordContentHash, sampleBriefOptions.preparedFor,
      sampleBriefOptions.ledgerEntry.entryHash, sampleBriefOptions.ledgerEntry.prevHash, String(sampleBriefOptions.ledgerEntry.seq),
      sampleBriefOptions.ledgerEntry.timestamp,
      'I declare that the information above is true to the best of my recollection.',
    ];
    for (const e of expected) expect(t, `missing: ${e}`).toContain(e as string);
  });

  it('preserves the narrative exactly (no trimming, rewriting or reflowing)', () => {
    const weird = '  Line one with trailing spaces   \n\n\n“Quoted” — emoji 😢 and Ελληνικά\r\nlast line\t';
    const rec = { ...sampleRecord, narrative: { ...sampleRecord.narrative, freeRecall: weird } };
    const nar = briefSections(rec).find((s) => s.id === 'narrative')!;
    const v = nar.blocks.find((b) => b.kind === 'verbatim');
    expect(v && v.kind === 'verbatim' && v.text).toBe(weird);
    const v2 = briefSections(sampleRecord).find((s) => s.id === 'narrative')!.blocks.find((b) => b.kind === 'verbatim');
    expect(v2 && v2.kind === 'verbatim' && v2.text).toBe(sampleRecord.narrative.freeRecall);
  });

  it('never mentions escrow matching', () => {
    expect(joined(briefSections(sampleRecord, sampleBriefOptions)).toLowerCase()).not.toMatch(/escrow/);
  });

  it('omits wholly-empty optional sections and shows "Not provided" for empty rows', () => {
    const secs = briefSections(minimalRecord);
    const ids = secs.map((s) => s.id);
    for (const gone of ['sensory', 'statements', 'perpetrators', 'witnesses', 'disclosures', 'priorReports', 'evidence']) {
      expect(ids).not.toContain(gone);
    }
    for (const kept of ['survivor', 'incident', 'narrative', 'medical', 'safety', 'goals', 'integrity', 'attestation']) {
      expect(ids).toContain(kept);
    }
    const survivor = secs.find((s) => s.id === 'survivor')!;
    const rows = survivor.blocks[0].kind === 'rows' ? survivor.blocks[0].rows : [];
    expect(rows.find((r) => r.label === 'Legal name')!.value).toBe(NOT_PROVIDED);
    expect(joined(secs)).toContain('not yet been sealed');
  });

  it('redactContactInfo hides survivor phone/email and witness contact', () => {
    const t = joined(briefSections(sampleRecord, { ...sampleBriefOptions, redactContactInfo: true }));
    expect(t).not.toContain(sampleRecord.survivor.phone!);
    expect(t).not.toContain(sampleRecord.survivor.email!);
    expect(t).not.toContain(sampleRecord.witnesses[0].contact!);
    expect(t).toContain('Withheld at the survivor’s request');
    // identifiers of the person responsible are evidence, not survivor contact info
    expect(t).toContain('(732) 555-0193');
  });
});

describe('text sanitizer', () => {
  const clean = makeSanitizer(Array.from({ length: 0x7f - 0x20 }, (_, i) => 0x20 + i).concat([0x201c, 0x201d, 0x2014, 0xe9, 0xef]));
  it('keeps encodable text, maps typography, marks unsupported runs once per run', () => {
    expect(clean('“café” — naïve').text).toBe('“café” — naïve');
    expect(clean('a‑b c').text).toBe('a-b c');
    const r = clean('Он сказал 😢🙏🏽 ok');
    expect(r.text).toBe('[?] [?] [?] ok');
    expect(r.replaced).toBe(true);
    expect(clean('👩‍👩‍👧').text).toBe('[?]');
    const t = clean('Łódź');
    expect(t.text).toBe('Lodz');
    expect(t.transliterated).toBe(true);
  });
  it('wraps long unbroken strings', () => {
    const font = { widthOfTextAtSize: (s: string, size: number) => s.length * size * 0.5 };
    const lines = wrapText('a'.repeat(200) + ' short words here', font, 10, 100);
    expect(lines.every((l) => font.widthOfTextAtSize(l, 10) <= 100)).toBe(true);
    expect(lines.join('').replace(/ /g, '')).toBe('a'.repeat(200) + 'shortwordshere');
  });
});

describe('PDF generation', () => {
  it('generates a brief for a minimal record', async () => {
    const bytes = await generatePoliceBrief(minimalRecord, { generatedAt: new Date('2026-10-06T12:00:00Z') });
    expect(isPdf(bytes)).toBe(true);
    expect(await pageCount(bytes)).toBeGreaterThanOrEqual(1);
  });

  it('generates a brief for the sample record', async () => {
    const bytes = await generatePoliceBrief(sampleRecord, sampleBriefOptions);
    expect(isPdf(bytes)).toBe(true);
    expect(await pageCount(bytes)).toBeGreaterThan(1);
  });

  it('handles a 20,000-word narrative with emoji and non-Latin text', async () => {
    const rec = hugeRecord();
    expect(rec.narrative.freeRecall.split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(20_000);
    const bytes = await generatePoliceBrief(rec, { ...sampleBriefOptions, redactContactInfo: true });
    expect(isPdf(bytes)).toBe(true);
    expect(await pageCount(bytes)).toBeGreaterThan(30);
  }, 60_000);

  it('generates the NJ VCCO draft for sample and minimal records', async () => {
    for (const rec of [sampleRecord, minimalRecord]) {
      const bytes = await generateVccoDraft(rec, { generatedAt: new Date('2026-10-06T12:00:00Z') });
      expect(isPdf(bytes)).toBe(true);
      expect(await pageCount(bytes)).toBeGreaterThan(1);
    }
  });
});

describe('VCCO worksheet content', () => {
  const at = new Date('2026-10-06T12:00:00Z');
  it('labels itself a draft and links the official application', () => {
    const t = joined(vccoSections(sampleRecord, at));
    expect(t).toContain('DRAFT');
    expect(t).toContain('njoag.gov/vcco/vcco-online-application');
    expect(t).toContain('50 Park Place');
  });
  it('flags the 9-month police-report rule when no law-enforcement report exists', () => {
    const t = joined(vccoSections(sampleRecord, at));
    // sample has only an HR complaint → not a police report; incident 2026-08-14 → deadline 2027-05-14
    expect(t).toContain('not one to police');
    expect(t).toContain('May 14, 2027');
    expect(t).toContain('$275/hour');
  });
  it('pre-fills known answers and marks unknown ones as needed', () => {
    const secs = vccoSections(sampleRecord, at);
    const s1 = secs.find((s) => s.id === 's1')!;
    const rows = s1.blocks[0].kind === 'rows' ? s1.blocks[0].rows : [];
    expect(rows.find((r) => r.label === 'Full legal name')).toMatchObject({ value: 'Maya R. Okafor' });
    expect(rows.find((r) => r.label === 'Social Security number')!.needed).toBe(true);
  });
});
