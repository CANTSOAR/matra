/** Sealed-matching pins baked in at build time (vite.config.ts `define`). */
import type { MatchPins } from '@matra/crypto';

declare const __MATRA_MATCH_PINS__: { oprfT: number; oprfGroup: string; oprfShares: string[]; rosterKey: string } | undefined;

const raw = typeof __MATRA_MATCH_PINS__ === 'undefined' ? { oprfT: 2, oprfGroup: '', oprfShares: [], rosterKey: '' } : __MATRA_MATCH_PINS__;

export const MATCH_PINS: MatchPins = {
  ...(raw.oprfGroup && raw.oprfShares.length && { oprf: { t: raw.oprfT, groupPublicKey: raw.oprfGroup, holders: raw.oprfShares } }),
  ...(raw.rosterKey && { rosterKey: raw.rosterKey }),
};
