/** Sealed-matching pins baked in at build time (vite.config.ts `define`). */
import type { MatchPins } from '@matra/crypto';

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
