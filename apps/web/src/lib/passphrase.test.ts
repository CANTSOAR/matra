import { describe, expect, it } from 'vitest';
import { sha256Hex } from '@matra/crypto';
import {
  BITS_PER_WORD,
  PROFESSIONAL_WORDS,
  SURVIVOR_WORDS,
  WORDLIST,
  estimateBits,
  generatePassphrase,
  isGeneratedPassphrase,
  passphraseAccepted,
  passphraseStrength,
  passphraseWords,
} from './passphrase';
import { WORDLIST_SHA256 } from './wordlist';

describe('word list', () => {
  it('is the screened EFF short list: at least 1,024 distinct words of 3 to 5 lowercase letters', () => {
    expect(WORDLIST.length).toBe(1035);
    expect(WORDLIST.length).toBeGreaterThanOrEqual(1024);
    expect(new Set(WORDLIST).size).toBe(WORDLIST.length);
    for (const w of WORDLIST) expect(w).toMatch(/^[a-z]{3,5}$/);
  });

  it('is pinned: changing it means updating WORDLIST_SHA256, and an advocate reviewing the change', async () => {
    expect(await sha256Hex(WORDLIST.join(' '))).toBe(WORDLIST_SHA256);
  });

  it('leaves out words the first-pass screen removed', () => {
    for (const w of ['grope', 'gag', 'blade', 'drown', 'woozy', 'dizzy', 'drank', 'acid', 'swab', 'jury', 'cage', 'bride', 'yo-yo',
      // second screen (B4 review): clear misses, confusable pairs, autocorrected words
      'junky', 'flask', 'snuff', 'slug', 'lasso', 'untie', 'bulge', 'romp', 'tart', 'nutty', 'hazy', 'diary', 'slept', 'wifi'])
      expect(WORDLIST).not.toContain(w);
  });

  it('6 distinct words reach 60 bits, 7 reach 70', () => {
    const distinctBits = (k: number) => Array.from({ length: k }, (_, i) => Math.log2(WORDLIST.length - i)).reduce((a, b) => a + b);
    expect(distinctBits(SURVIVOR_WORDS)).toBeGreaterThanOrEqual(60);
    expect(distinctBits(PROFESSIONAL_WORDS)).toBeGreaterThanOrEqual(70);
    expect(SURVIVOR_WORDS * BITS_PER_WORD).toBeGreaterThanOrEqual(60);
  });
});

describe('generatePassphrase', () => {
  it('makes 6 distinct list words for survivors and 7 for attorneys and counselors', () => {
    expect(passphraseWords('survivor')).toBe(6);
    expect(passphraseWords('attorney')).toBe(7);
    expect(passphraseWords('counselor')).toBe(7);
    for (let i = 0; i < 200; i++) {
      const p = generatePassphrase();
      const words = p.split('-');
      expect(words).toHaveLength(6);
      expect(new Set(words).size).toBe(6);
      words.forEach((w) => expect(WORDLIST).toContain(w));
      expect(isGeneratedPassphrase(p, 6)).toBe(true);
      expect(passphraseStrength(p).level).toBe('strong');
      expect(isGeneratedPassphrase(generatePassphrase(7), 7)).toBe(true);
    }
  });

  it('isGeneratedPassphrase refuses anything else', () => {
    const p = generatePassphrase(7);
    expect(isGeneratedPassphrase(p, 6)).toBe(false);
    expect(isGeneratedPassphrase(p.replace(/-/g, ' '), 7)).toBe(false);
    expect(isGeneratedPassphrase(p.toUpperCase(), 7)).toBe(false);
    const [a, , ...rest] = p.split('-');
    expect(isGeneratedPassphrase([a, a, ...rest].join('-'), 7)).toBe(false); // a repeated word
    expect(isGeneratedPassphrase('my-own-very-long-and-strong-passphrase', 7)).toBe(false);
  });
});

describe('passphraseStrength', () => {
  it('rates the review’s inputs weak: one word repeated, and 28 of one letter (no length shortcut)', () => {
    expect(passphraseStrength('password password password password').level).toBe('weak');
    expect(passphraseStrength('a'.repeat(28)).level).toBe('weak');
    expect(passphraseStrength('a'.repeat(80)).level).toBe('weak');
    expect(passphraseStrength('abcdefghijklmnopqrstuvwxyz').level).toBe('weak');
    expect(passphraseStrength('qwertyuiop1234567890').level).toBe('weak');
  });

  it('counts distinct words only', () => {
    const [a, b, c] = ['otter', 'lemon', 'cedar'];
    const repeated = [a, b, c, a, b, c].join(' ');
    expect(estimateBits(repeated)).toBe(estimateBits([a, b, c].join(' ')));
    expect(passphraseStrength(repeated).level).toBe('weak');
    expect(estimateBits(`${a} ${a.toUpperCase()} ${a}`)).toBeLessThan(BITS_PER_WORD);
  });

  it('counts a common password or a well-known opening as one guess, wherever it appears', () => {
    expect(passphraseStrength('correct horse battery staple').level).toBe('weak');
    expect(passphraseStrength('Correct-Horse-Battery-Staple').level).toBe('weak');
    expect(passphraseStrength('once upon a time there was').level).toBe('weak');
    expect(passphraseStrength('iloveyou iloveyou 2024').level).toBe('weak');
    expect(estimateBits('correct horse battery staple')).toBeLessThan(5);
    expect(estimateBits('password1')).toBeLessThan(10);
  });

  it('folds ordered runs into one guess: list words in list (alphabetical) order, counting, months, days, colours', () => {
    const first = WORDLIST.slice(0, 6);
    const last = WORDLIST.slice(-6);
    for (const p of [
      first.join(' '),
      first.join('-'), // looks generated, but four or more in list order are not random
      last.join(' '),
      [...first].reverse().join(' '),
      WORDLIST.filter((_, i) => i % 2 === 0).slice(100, 106).join(' '), // every other word, still in order
      'one two three four five six seven',
      'seven six five four three two one',
      'january february march april may june july',
      'monday tuesday wednesday thursday friday saturday sunday',
      'red orange yellow green blue indigo violet',
      'first second third fourth fifth sixth',
    ])
      expect([p, passphraseStrength(p).level]).toEqual([p, 'weak']);
    expect(estimateBits('one two three four five six seven')).toBeLessThan(5);
  });

  it('a phrase she writes herself needs many words that don’t go together; six of her own words are not enough', () => {
    const six = generatePassphrase().split('-');
    // the same six random words, typed by her (or not shown here): scored as hers
    expect(passphraseAccepted(six.join(' '))).toBe(false);
    expect(passphraseAccepted(six.join('-'), [], { generatedHere: false })).toBe(false);
    expect(passphraseAccepted('pebble lantern fjord mango heron willow')).toBe(false);
    expect(passphraseStrength('MyDogIsNamedRex2019!').level).toBe('weak');
    // ten unrelated words of her own pass
    expect(passphraseAccepted('pebble lantern fjord mango heron willow copper tundra violin saffron')).toBe(true);
  });

  it('never puts a number on a phrase she writes, and says the random words are safer', () => {
    for (const p of ['password password password password', 'pebble lantern fjord mango heron willow copper', 'pebble lantern fjord mango heron willow copper tundra violin saffron']) {
      const { message } = passphraseStrength(p);
      expect(message).not.toMatch(/\d|bits/);
      expect(message).toMatch(/random words we suggest/);
    }
    expect(passphraseStrength(generatePassphrase()).message).toBe('Strong. Write it down somewhere only you can reach.');
  });

  it('her alias counts for nothing in a phrase she wrote, but never makes a generated one fail', () => {
    const p = 'bluebird pebble lantern fjord mango heron willow copper tundra violin';
    expect(passphraseAccepted(p)).toBe(true);
    expect(passphraseAccepted(p, ['bluebird-42'])).toBe(false);
    for (let i = 0; i < 500; i++) {
      const g = generatePassphrase();
      expect(passphraseAccepted(g, [`sky.${g.split('-')[0]}`, g.split('-')[1]])).toBe(true);
    }
  });

  it('too short is too short', () => {
    expect(passphraseStrength('hunter2').level).toBe('too-short');
    expect(passphraseStrength('').level).toBe('too-short');
  });
});
