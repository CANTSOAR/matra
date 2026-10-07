import type { IntakeRecord } from '@matra/shared';
import type { BriefOptions } from './types';
import { BRIEF_TITLE, INCIDENT_SUMMARY_TITLE, briefSections } from './sections';
import { renderPdf } from './pdf/render';
import { formatTimestamp } from './format';

/**
 * "Incident Summary in the Survivor's Own Words", generated entirely in the browser (zero-knowledge: the server never
 * sees plaintext). Returns PDF bytes. (Historical name kept for compatibility; prefer `generateIncidentSummary`.)
 */
export async function generatePoliceBrief(record: IntakeRecord, opts: BriefOptions = {}): Promise<Uint8Array> {
  const generatedAt = opts.generatedAt ?? new Date();
  const o = { ...opts, generatedAt };
  const sections = briefSections(record, o);
  const shortId = opts.recordId ? ` · Record ${opts.recordId.slice(0, 12)}` : '';
  return renderPdf(sections, {
    kicker: 'Prepared with Matra · At the direction of the survivor',
    tag: 'CONFIDENTIAL',
    title: INCIDENT_SUMMARY_TITLE,
    subtitle: opts.preparedFor
      ? `Shared with ${opts.preparedFor}. Not a sworn statement unless signed.`
      : 'Not a sworn statement unless signed by the survivor.',
    runningTitle: BRIEF_TITLE,
    runningRight: 'CONFIDENTIAL',
    // PREPARED_BY_NOTE is printed in "About This Document"; the footer keeps the short form.
    footerLeft: `Prepared by the survivor using Matra · Generated ${formatTimestamp(generatedAt)}${shortId}`,
    footerCenter: 'CONFIDENTIAL',
    numberSections: true,
    sanitizedNote:
      'Some characters in this record (for example emoji or non-Latin scripts) cannot be displayed with the standard ' +
      'fonts used in this PDF. They are shown as [?], and letters with accents outside the font’s range are shown ' +
      'without accents. Nothing else was changed. The exact original text is preserved in the encrypted record and ' +
      'in the on-screen version of this brief.',
    meta: {
      title: BRIEF_TITLE,
      subject: 'Incident summary in the survivor’s own words, prepared by the survivor',
      date: generatedAt,
    },
  });
}

/** Preferred name: the incident summary in the survivor's own words (PDF bytes). */
export const generateIncidentSummary = generatePoliceBrief;
