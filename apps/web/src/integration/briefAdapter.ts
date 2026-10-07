/**
 * Integration seam for the brief module (src/brief, owned by the brief agent).
 * All PDF generation happens in the browser from the decrypted IntakeRecord.
 */
export {
  generateIncidentSummary,
  generatePoliceBrief,
  generateVccoDraft,
  incidentSummaryFilename,
  BriefPreview,
  downloadPdf,
  INCIDENT_SUMMARY_TITLE,
} from '../brief';
export type { BriefOptions } from '../brief';
