/**
 * MATRA_MATCHING=on at build time (vite.config.ts `define`). A literal `false` in a matching-off build (the pilot
 * default), so every branch behind it, and every module only those branches import, is left out of the bundle.
 * Tests read it as a global the test file can set before importing anything (see src/test/matching.ts).
 */
declare const __MATRA_MATCHING__: boolean;
