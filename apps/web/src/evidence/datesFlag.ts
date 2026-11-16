/**
 * "Dates found in your files" (PR 35) is OFF by default and not in a default build. The plan requires her narrative to be
 * sealed first, and only on request, so it does not refresh her memory of what happened (N.J.R.E. 612 / FRE 612, counsel
 * question Q-074). The narrative baseline and its seal are P2, which does not exist yet, so nothing here can check that.
 * MATRA_DATES_FOUND=off|on is read at build time (apps/web/vite.config.ts defines __MATRA_DATES_FOUND__); unset means off.
 * Where the flag is not defined at all (Node tools) it is treated as off.
 */
declare const __MATRA_DATES_FOUND__: boolean | undefined;

export const DATES_FOUND_IN_BUILD: boolean = typeof __MATRA_DATES_FOUND__ !== 'undefined' && __MATRA_DATES_FOUND__ === true;
