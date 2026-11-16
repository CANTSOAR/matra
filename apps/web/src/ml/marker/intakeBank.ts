/** The mark bank for the intake script: every step id, tagged by src/ml/marker/bank.ts. */
import { STEPS } from '../../intake/script';
import { buildBank } from './bank';

/** Bump when NEUTRAL_IDS / SENSITIVE_PREFIXES change. */
export const INTAKE_BANK_VERSION = 'intake-marks-1';
export const INTAKE_MARK_BANK = buildBank(
  STEPS.map((s) => s.id),
  INTAKE_BANK_VERSION,
);
