import { describe, expect, it } from 'vitest';
import { STEPS } from '../intake/script';
import { MATCHING_EXPLANATION } from '../counselor/SurvivorMatching';
import { MATCHING_CONSENT_LINES } from './disclosures';
import { MATCHING_CONSENT_STATEMENT } from './vault';

describe('sealed-match consent (Memo §7A)', () => {
  const shown = STEPS.find((s) => s.id === 'person.escrow')!.say;

  it('stores exactly what she is shown: one source for the opt-in, the review page and the sealed statement', () => {
    expect(shown.slice(1)).toEqual([...MATCHING_CONSENT_LINES]);
    expect(MATCHING_EXPLANATION).toEqual(MATCHING_CONSENT_LINES);
    expect(MATCHING_CONSENT_STATEMENT).toBe(MATCHING_CONSENT_LINES.join(' '));
  });

  it('covers what the memo asks for: attorney counselor, lead not evidence, separate opted-in contact, no follow-up, no fees', () => {
    const text = MATCHING_CONSENT_STATEMENT;
    expect(text).toMatch(/Legal Options Counselor/);
    expect(text).toMatch(/licensed attorney/);
    expect(text).toMatch(/A match is a lead, not evidence/);
    expect(text).toMatch(/separately/);
    expect(text).toMatch(/only happens because you said yes/);
    expect(text).toMatch(/If you do, there is no follow-up/);
    expect(text).toMatch(/There are no fees/);
    expect(text).toMatch(/withdraw/);
    expect(text).toMatch(/not unique enough/);
  });

  it('never claims nobody (including the operator) can test or read a sealed identifier (threat model W2/W14)', () => {
    expect(MATCHING_CONSENT_STATEMENT).not.toMatch(/nobody can read|\bnot us\b|not anyone/i);
    expect(MATCHING_CONSENT_STATEMENT).toMatch(/the people who run Matra could check whether a particular email or number was sealed/);
  });
});
