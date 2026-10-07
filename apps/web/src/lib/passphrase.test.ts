import { describe, expect, it } from 'vitest';
import { WORDLIST, generatePassphrase, passphraseStrength } from './passphrase';

describe('passphrase', () => {
  it('has a 300+ unique word list and generates 5 words', () => {
    expect(WORDLIST.length).toBeGreaterThanOrEqual(300);
    expect(new Set(WORDLIST).size).toBe(WORDLIST.length);
    const p = generatePassphrase();
    expect(p.split('-')).toHaveLength(5);
    p.split('-').forEach((w) => expect(WORDLIST).toContain(w));
    expect(passphraseStrength(p).level).toBe('strong');
    expect(passphraseStrength('hunter2').level).toBe('too-short');
  });
});
