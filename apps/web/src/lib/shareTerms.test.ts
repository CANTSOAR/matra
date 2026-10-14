import { describe, expect, it } from 'vitest';
import type { AttorneyProfile } from '@matra/shared';
import { SHARE_DISCLAIMER, buildConsentStatement } from '../screens/Share';
import { DEFAULT_SHARE_DAYS, shareLengthDays, shareLengthLabel } from './shareTerms';

const attorney = { displayName: 'Demo — Alex Rivera, Esq.', organization: 'Demo Legal Aid' } as AttorneyProfile;
const statement = (days: number) =>
  buildConsentStatement({
    alias: 'bluebird-1',
    attorney,
    fingerprint: 'ABCD-ABCD-ABCD-ABCD-ABCD-ABCD-ABCD-ABCD',
    scope: ['record', 'brief'],
    sealedAt: '2026-10-01T10:00:00.000Z',
    at: '2026-10-02T10:00:00.000Z',
    expiresInDays: days,
  });

describe('share length (renewal keeps her choice)', () => {
  it('reads back the length she agreed to', () => {
    for (const days of [30, 90, 180, 365]) expect(shareLengthDays({ consentStatement: statement(days) })).toBe(days);
  });

  it('falls back to the default for consent text without a length', () => {
    expect(shareLengthDays({ consentStatement: 'I consent to share my case file with this attorney.' })).toBe(DEFAULT_SHARE_DAYS);
    expect(shareLengthDays({ consentStatement: 'This access expires 9999 days after the date below unless I renew it.' })).toBe(DEFAULT_SHARE_DAYS);
  });

  it('labels a year as a year', () => {
    expect(shareLengthLabel(365)).toBe('1 year');
    expect(shareLengthLabel(30)).toBe('30 days');
  });
});

describe('share consent text', () => {
  it('says, in her voice, that the attorney can read and save it and that revoking cannot erase saved copies', () => {
    expect(SHARE_DISCLAIMER).toMatch(/The attorney can read and save what you share/);
    const s = statement(90);
    expect(s).toMatch(/The attorney can read and save what I share\./);
    expect(s).toMatch(/it can’t erase what was already viewed or saved/);
    expect(s).toMatch(/This access expires 90 days after the date below unless I renew it\./);
  });
});
