/**
 * Integration seam for the brief module (src/brief, owned by the brief agent).
 * All PDF generation happens in the browser from the decrypted IntakeRecord.
 */
export { generatePoliceBrief, generateVccoDraft, BriefPreview, downloadPdf } from '../brief';
export type { BriefOptions } from '../brief';
