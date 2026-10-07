/**
 * Integration seam for the intake module (src/intake, owned by the intake agent).
 * The shell treats IntakeDraft as opaque: it only stores it (encrypted) and passes it back
 * to IntakeChat / draftToRecord. Evidence is tracked by the shell separately and merged
 * into the final IntakeRecord.evidence on completion.
 */
export { IntakeChat, emptyDraft, draftToRecord } from '../intake';
export type { IntakeDraft, IntakeChatProps } from '../intake';
