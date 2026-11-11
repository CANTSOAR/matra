/**
 * The matcher's column in the dev/demo inspector (@matra/shared inspector.ts; GET /v1/debug/state, token required,
 * mounted only when inspectorEnabled()). It shows what the matcher holds, as stored: entries with the two states it
 * opened from each survivor's routing tag (the ONLY plaintext about a survivor anywhere outside her device and the
 * counselor's), the assignments with their reasons, the roster it routes by, and a fresh attestation document.
 */
import { randomBytes } from 'node:crypto';
import { inspectValue, type InspectorProcess, type InspectorTable } from '@matra/shared';
import type { AttestationProvider } from './attestation.js';
import type { MatcherStore } from './store.js';

const TABLES: Array<[table: string, caption: string]> = [
  ['matcher_entries', 'One row per sealed entry: its tag, a pseudonymous survivor reference, times, and the incident / home state opened from her routing tag. No identifier, no contact details, no account id.'],
  ['matcher_assignments', 'Each matched group (tag) and the ONE counselor it went to: licensed where it happened if possible, else where a survivor lives.'],
  ['matcher_exclusions', 'Counselors who declined a group (conflict of interest): it is passed on to someone else.'],
  ['matcher_roster', 'The organization-signed counselor roster it routes by (user ids and licensed states).'],
];

function table(store: MatcherStore, name: string, caption: string): InspectorTable {
  const rows = store.db.prepare(`SELECT * FROM ${name} ORDER BY rowid DESC LIMIT 20`).all();
  const total = (store.db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get() as { n: number }).n;
  return { name, caption, total, rows: rows.map((r) => inspectValue(r) as InspectorTable['rows'][number]) };
}

export async function matcherDebugState(store: MatcherStore, attester: AttestationProvider): Promise<InspectorProcess> {
  const tables = TABLES.map(([t, c]) => table(store, t, c));
  let attestation: InspectorTable;
  try {
    const doc = await attester.attest(randomBytes(32).toString('hex'));
    attestation = {
      name: 'attestation document (fresh)',
      caption:
        attester.platform === 'simulated'
          ? 'SIMULATED: a dev "platform" key signs the measurement (a hash of this matcher’s code) and its public keys. It shows the protocol; it is not hardware attestation.'
          : 'Signed by the confidential-computing platform over the measurement of the code it runs.',
      total: 1,
      rows: [inspectValue(doc) as InspectorTable['rows'][number]],
    };
  } catch (e) {
    attestation = { name: 'attestation document', caption: `Could not attest: ${(e as Error).message}`, total: 0, rows: [] };
  }
  return {
    name: 'Matcher',
    role: 'matcher',
    note: `Separate service (attestation: ${attester.platform}, measurement ${attester.measurement.slice(0, 16)}…). Sees tags and states, never identifiers or contact details.`,
    tables: [attestation, ...tables],
  };
}
