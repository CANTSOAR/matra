/** Sealed-matching pins baked in at build time (vite.config.ts `define`). */
import type { AttorneyKeyCheck, MatchPins } from '@matra/crypto';

declare const __MATRA_MATCH_PINS__: { oprfT: number; oprfGroup: string; oprfShares: string[]; rosterKey: string } | undefined;
/** The matcher this build trusts: the attestation platform's key and the published matcher measurement. */
declare const __MATRA_ATTESTATION__: { platformKey: string; measurement: string } | undefined;
/** MATRA_DEMO_MODE=1 at build time: a fictional-data demo build, which accepts a SIMULATED matcher attestation. */
declare const __MATRA_DEMO__: boolean | undefined;

const raw = typeof __MATRA_MATCH_PINS__ === 'undefined' ? { oprfT: 2, oprfGroup: '', oprfShares: [], rosterKey: '' } : __MATRA_MATCH_PINS__;
const att = typeof __MATRA_ATTESTATION__ === 'undefined' ? { platformKey: '', measurement: '' } : __MATRA_ATTESTATION__;
export const DEMO_BUILD = typeof __MATRA_DEMO__ !== 'undefined' && __MATRA_DEMO__ === true;

export const MATCH_PINS: MatchPins = {
  ...(raw.oprfGroup && raw.oprfShares.length && { oprf: { t: raw.oprfT, groupPublicKey: raw.oprfGroup, holders: raw.oprfShares } }),
  ...(raw.rosterKey && { rosterKey: raw.rosterKey }),
  ...(att.platformKey && att.measurement && { attestation: { platformKey: att.platformKey, measurement: att.measurement } }),
  // a pinned production build refuses a simulated attestation unless it is a demo build
  ...(DEMO_BUILD && { allowSimulatedAttestation: true }),
  // and a production build that is not a demo refuses to seal without a pinned matcher (vite.config.ts already refuses
  // to build one; this is the same rule at run time)
  ...(import.meta.env.PROD && !DEMO_BUILD && { requireAttestationPin: true }),
};

/**
 * May an attorney key with no org key to check it against ('unpinned') be shared with? Only in development and demo
 * builds. A production build that is not a demo refuses to build without the pin (vite.config.ts
 * assertProductionPins); this is the same rule at run time, so such a build never trusts the server's attorney keys (W3).
 */
export const UNPINNED_SHARING_ALLOWED = !import.meta.env.PROD || DEMO_BUILD;

/** May she share with this attorney's key? Verified by the org-signed directory, or unpinned where that is allowed. */
export function attorneyShareable(c: AttorneyKeyCheck, allowUnpinned: boolean = UNPINNED_SHARING_ALLOWED): boolean {
  return c.status === 'verified' || (c.status === 'unpinned' && allowUnpinned);
}
