import type { Share } from '@matra/shared';

/** The server's default share length, used when a share's own length can't be read. */
export const DEFAULT_SHARE_DAYS = 90;

/** The sentence in her consent statement that records how long she chose (screens/Share.tsx buildConsentStatement). */
export function shareLengthSentence(days: number): string {
  return `This access expires ${days} days after the date below unless I renew it.`;
}

const LENGTH_RE = /This access expires (\d+) days after the date below/;

/**
 * How long she chose when she shared, read back from the exact consent text she agreed to, so a renewal keeps her
 * choice instead of always using 90 days. Falls back to the default for older or unusual consent text.
 */
export function shareLengthDays(share: Pick<Share, 'consentStatement'>): number {
  const n = Number(LENGTH_RE.exec(share.consentStatement ?? '')?.[1]);
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : DEFAULT_SHARE_DAYS;
}

/** "90 days", or "1 year" for 365. */
export function shareLengthLabel(days: number): string {
  return days === 365 ? '1 year' : `${days} days`;
}
