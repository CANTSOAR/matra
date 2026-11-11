/**
 * @matra/matcher: the separate matcher service (docs/design/WEEKEND_MVP.md §3.5). The app server imports it to run the
 * matcher in-process (development, tests, single-host demo: no separation from the operator) or talks to it over HTTP
 * (src/server.ts).
 */
import type { MatcherKeys } from '@matra/crypto';
import { Matcher } from './matcher.js';
import { MatcherStore, openMatcherDb } from './store.js';

export { Matcher, MatcherError, ASSIGNMENT_DOMAIN, verifyAssignmentSignature } from './matcher.js';
export type { MatcherAssignment, MatcherEntryInput, MatcherRosterInput, MatchSignals } from './matcher.js';
export { MatcherStore, openMatcherDb, type RosterCounselor } from './store.js';
export { SimulatedAttester, UnimplementedAttester, type AttestationProvider } from './attestation.js';
export { computeMeasurement, MATCHER_ROOT } from './measure.js';
export { createMatcherApp, type MatcherAppOptions } from './app.js';
export { matcherDebugState } from './debug.js';
export { loadAttester } from './config.js';

/** A matcher over its own database (a file, or ':memory:'). */
export function createMatcher(o: { dbPath: string; keys: MatcherKeys; releaseDelayMs: number; rosterKey?: Uint8Array; now?: () => number }) {
  const store = new MatcherStore(openMatcherDb(o.dbPath));
  return { matcher: new Matcher({ store, keys: o.keys, releaseDelayMs: o.releaseDelayMs, rosterKey: o.rosterKey, now: o.now }), store };
}
