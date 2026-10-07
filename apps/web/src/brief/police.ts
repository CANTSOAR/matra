import type { IntakeRecord } from '@shield/shared';
import type { BriefOptions } from './types';
import { briefSections } from './sections';
import { renderPdf } from './pdf/render';
import { formatTimestamp } from './format';

/**
 * Police Evidentiary Brief, generated entirely in the browser (zero-knowledge: the server never
 * sees plaintext). Returns PDF bytes.
 */
export async function generatePoliceBrief(record: IntakeRecord, opts: BriefOptions = {}): Promise<Uint8Array> {
  const generatedAt = opts.generatedAt ?? new Date();
  const o = { ...opts, generatedAt };
  const sections = briefSections(record, o);
  const shortId = opts.recordId ? ` · Record ${opts.recordId.slice(0, 12)}` : '';
  return renderPdf(sections, {
    kicker: 'Prepared with Matra · At the direction of the survivor',
    tag: 'CONFIDENTIAL',
    title: 'Victim Statement & Evidentiary Summary',
    subtitle: opts.preparedFor
      ? `Prepared for ${opts.preparedFor}. Not a sworn statement unless signed.`
      : 'Not a sworn statement unless signed by the survivor.',
    runningTitle: 'Confidential — Victim Statement & Evidentiary Summary',
    runningRight: 'CONFIDENTIAL',
    footerLeft: `Prepared with Matra · Generated ${formatTimestamp(generatedAt)}${shortId}`,
    footerCenter: 'CONFIDENTIAL',
    numberSections: true,
    sanitizedNote:
      'Some characters in this record (for example emoji or non-Latin scripts) cannot be displayed with the standard ' +
      'fonts used in this PDF. They are shown as [?], and letters with accents outside the font’s range are shown ' +
      'without accents. Nothing else was changed. The exact original text is preserved in the encrypted record and ' +
      'in the on-screen version of this brief.',
    meta: {
      title: 'Confidential — Victim Statement & Evidentiary Summary',
      subject: 'Survivor-directed victim statement and evidentiary summary',
      date: generatedAt,
    },
  });
}
