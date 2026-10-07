/** Sealed-matching pins baked in at build time (vite.config.ts `define`). */
import type { MatchPins } from '@matra/crypto';

declare const __MATRA_MATCH_PINS__: { oprfA: string; oprfB: string; rosterKey: string } | undefined;

const raw = typeof __MATRA_MATCH_PINS__ === 'undefined' ? { oprfA: '', oprfB: '', rosterKey: '' } : __MATRA_MATCH_PINS__;

export const MATCH_PINS: MatchPins = {
  ...(raw.oprfA && raw.oprfB && { keys: { a: raw.oprfA, b: raw.oprfB } }),
  ...(raw.rosterKey && { rosterKey: raw.rosterKey }),
};

