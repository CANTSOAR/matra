/**
 * The marker is OFF by default and has no survivor-facing screen. MATRA_MARKER=off|on is read at build time
 * (apps/web/vite.config.ts defines __MATRA_MARKER__); an unset value means off. Even when on, the checklist that would
 * show marks (P2) must also have her per-user opt-in; this flag only decides whether the code is in the build.
 *
 * Where the flag is not defined at all (the eval harness, run by Node) the marker is treated as off.
 */
declare const __MATRA_MARKER__: boolean | undefined;

export const MARKER_IN_BUILD: boolean = typeof __MATRA_MARKER__ !== 'undefined' && __MATRA_MARKER__ === true;
