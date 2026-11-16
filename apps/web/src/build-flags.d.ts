/**
 * MATRA_MATCHING=on at build time (vite.config.ts `define`). A literal `false` in a matching-off build (the pilot
 * default), so every branch behind it, and every module only those branches import, is left out of the bundle.
 * Tests read it as a global the test file can set before importing anything (see src/test/matching.ts).
 */
declare const __MATRA_MATCHING__: boolean;

/**
 * MATRA_MARKER=on at build time (vite.config.ts `define`), default off. Read through src/ml/marker/flag.ts, which also
 * copes with it being undefined (the eval harness runs the marker under Node with no bundler).
 */
declare const __MATRA_MARKER__: boolean;

/**
 * MATRA_DATES_FOUND=on at build time (vite.config.ts `define`), default off. Read through src/evidence/datesFlag.ts, which
 * also copes with it being undefined.
 */
declare const __MATRA_DATES_FOUND__: boolean;
