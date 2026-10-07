/**
 * Matra brief engine — all document generation happens in the browser.
 * The server never receives plaintext; these functions take a decrypted IntakeRecord and
 * return bytes / React elements locally.
 */
export type { BriefOptions, BriefSection, BriefBlock, BriefRow, BriefTableRow } from './types';
export { briefSections, BRIEF_TITLE, INCIDENT_SUMMARY_TITLE, PREPARED_BY_NOTE } from './sections';
export { generatePoliceBrief, generateIncidentSummary } from './police';
export { generateVccoDraft, vccoSections, VCCO } from './vcco';
export { BriefPreview } from './BriefPreview';
export type { BriefPreviewProps } from './BriefPreview';

/** Trigger a browser download of PDF bytes. */
export function downloadPdf(bytes: Uint8Array, filename: string): void {
  const name = filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`;
  // Copy into a fresh ArrayBuffer so Blob gets exactly these bytes (not a larger shared buffer).
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download filename for the incident summary, e.g. `matra-incident-summary-2026-10-07.pdf`. */
export function incidentSummaryFilename(date: Date = new Date()): string {
  return `matra-incident-summary-${date.toISOString().slice(0, 10)}.pdf`;
}
