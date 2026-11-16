/**
 * MATRA_MATCHING=off|on: one switch for sealed matching, read by the app server (apps/server/src/matching-off.ts), the
 * separate matching services (OPRF key holders, the matcher) and the web build (apps/web/vite.config.ts).
 *
 * Off is the pilot default: the server skips every matching loader and answers 404 `matching_disabled` on every
 * matching route, and the web build leaves the matching screens, questions and API calls out of the bundle.
 * Production must say which one it is: an unset value is refused there.
 */
export type MatchingMode = 'off' | 'on';

/** The value of MATRA_MATCHING, or undefined when unset or empty. Anything other than "off" or "on" throws. */
export function parseMatchingMode(raw: string | undefined): MatchingMode | undefined {
  const v = raw?.trim().toLowerCase();
  if (!v) return undefined;
  if (v === 'off' || v === 'on') return v;
  throw new Error(`MATRA_MATCHING must be "off" or "on", got "${raw}"`);
}

/**
 * For the processes that exist only for sealed matching (an OPRF key holder, the matcher): refuse to start when this
 * deployment has turned matching off. Nothing should be holding a key share or routing data then.
 */
export function assertMatchingService(env: Record<string, string | undefined>, service: string): void {
  if (parseMatchingMode(env.MATRA_MATCHING) === 'off')
    throw new Error(`${service} is part of sealed matching, and MATRA_MATCHING=off. Don't run it, or set MATRA_MATCHING=on.`);
}
