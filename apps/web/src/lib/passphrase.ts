/**
 * Passphrases: generated suggestions and a strength meter.
 *
 * Generated (the main path): distinct random words from WORDLIST (./wordlist.ts, EFF Short Wordlist #1 after an
 * engineer screen, 1,035 words ≈ 10.0 bits each). Survivors get 6 words (≈ 60.1 bits); attorneys and counselors get 7
 * (≈ 70.1 bits) and the app gives them no box to type their own, because their accounts open what survivors share with
 * them. The server never sees a passphrase, so none of this is enforced there (a modified client could skip it). On
 * top of this the passphrase goes through 600,000 PBKDF2 rounds (W5).
 *
 * Chosen (survivors only): she may type her own. Its entropy can't be measured, only guessed at, so the meter makes no
 * bit claim to her and says plainly that a phrase she makes up is easier to guess than a generated one. Internally it
 * scores her phrase low on purpose and asks for a high score: only distinct words count; a word she typed counts for
 * less than a random one (people pick words that go together); runs of list words in list or alphabetical order,
 * counting, months, days and other ordered sets, repeated or sequential words, keyboard runs, her alias and a short
 * list of common passwords and well-known openings count for almost nothing. No length shortcut.
 */
import type { Role } from '@matra/shared';
import { WORDLIST } from './wordlist';

export { WORDLIST };

/** Words in a survivor's generated passphrase. */
export const SURVIVOR_WORDS = 6;
/** Words in an attorney's or counselor's passphrase (always generated). */
export const PROFESSIONAL_WORDS = 7;
/** The meter's internal score a phrase she writes herself must reach (not shown to her; not a measured entropy). */
export const MIN_CHOSEN_SCORE = 60;
/** Below this the meter says "too easy to guess"; between this and MIN_CHOSEN_SCORE it says "almost". */
const OKAY_SCORE = 45;
/** Each distinct generated word. */
export const BITS_PER_WORD = Math.log2(WORDLIST.length);

/** Separator between generated words. No word in WORDLIST contains it. */
export const SEPARATOR = '-';

/** How many generated words an account of this role gets. */
export function passphraseWords(role: Role): number {
  return role === 'survivor' ? SURVIVOR_WORDS : PROFESSIONAL_WORDS;
}

/** Only survivors may type a passphrase of their own. */
export function canChoosePassphrase(role: Role): boolean {
  return role === 'survivor';
}

function randomIndex(n: number): number {
  // rejection sampling to avoid modulo bias
  const max = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < max) return buf[0] % n;
  }
}

/** `words` distinct random words from `list`, joined with SEPARATOR, made on this device. */
export function generatePassphrase(words = SURVIVOR_WORDS, list: readonly string[] = WORDLIST): string {
  if (words > list.length) throw new Error('Not enough words in the list');
  const out = new Set<string>();
  while (out.size < words) out.add(list[randomIndex(list.length)]);
  return [...out].join(SEPARATOR);
}

const LIST = new Set(WORDLIST);

/** True when `p` is exactly what generatePassphrase(words) could have made: `words` distinct list words, joined. */
export function isGeneratedPassphrase(p: string, words: number): boolean {
  const parts = p.split(SEPARATOR);
  return parts.length === words && new Set(parts).size === words && parts.every((w) => LIST.has(w));
}

// ───────────── strength estimate ─────────────

/** Common passwords, and openings of a few public-domain texts (a few words each). One guess wherever they appear. */
const COMMON = [
  'password', 'passphrase', 'passw0rd', 'letmein', 'let me in', 'iloveyou', 'i love you', 'qwerty', 'admin', 'welcome',
  'monkey', 'dragon', 'sunshine', 'princess', 'football', 'baseball', 'superman', 'batman', 'trustno1', 'starwars',
  'whatever', 'secret', 'changeme', 'abc123', 'matra', 'hello world', 'correct horse battery staple',
  'the quick brown fox', 'once upon a time', 'to be or not to be', 'four score and seven years ago',
  'we the people', 'in god we trust', 'our father who art in heaven', 'the lord is my shepherd',
  'mary had a little lamb', 'twinkle twinkle little star', 'humpty dumpty', 'jack and jill', 'roses are red',
  'open sesame', 'carpe diem',
];
const COMMON_PHRASES = COMMON.map((c) => c.split(' ')).filter((p) => p.length > 1).sort((a, b) => b.length - a.length);
/** Each entry also as one run-together token ("letmein"). */
const COMMON_TOKENS = new Set(COMMON.map((c) => c.replace(/ /g, '')));
const KNOWN = '\u0000known';

/** Ordered sets people count through. Three or more in a row (either way) count as one guess; one alone, very little. */
const SEQUENCES: string[][] = [
  'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split(' '),
  'first second third fourth fifth sixth seventh eighth ninth tenth'.split(' '),
  'january february march april may june july august september october november december'.split(' '),
  'jan feb mar apr may jun jul aug sep oct nov dec'.split(' '),
  'monday tuesday wednesday thursday friday saturday sunday'.split(' '),
  'mon tue wed thu fri sat sun'.split(' '),
  'red orange yellow green blue indigo violet'.split(' '),
  'mercury venus earth mars jupiter saturn uranus neptune pluto'.split(' '),
  'do re mi fa so la ti'.split(' '),
  'spring summer autumn winter'.split(' '),
  'north east south west'.split(' '),
  'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima'.split(' '),
];
const SEQ_WORDS = new Set(SEQUENCES.flat().concat('black white pink purple brown gray grey gold silver'.split(' ')));
const LIST_INDEX = new Map(WORDLIST.map((w, i) => [w, i]));

const RUNS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'abcdefghijklmnopqrstuvwxyz', '01234567890'];
const RUNS_BOTH_WAYS = RUNS.flatMap((r) => [r, [...r].reverse().join('')]);

/** "aaaa", "abcd", "4321", "qwer": a few guesses at most. */
function isRun(piece: string): boolean {
  if (piece.length < 3) return false;
  return /^(.)\1+$/u.test(piece) || RUNS_BOTH_WAYS.some((r) => r.includes(piece));
}

/** "abcabc", "haha": the repeated part is all that counts. */
function repeatedUnit(piece: string): string | null {
  for (let n = 1; n <= piece.length / 2; n++) {
    if (piece.length % n) continue;
    const unit = piece.slice(0, n);
    if (unit.repeat(piece.length / n) === piece) return unit;
  }
  return null;
}

/** Score of one distinct token. `listBits`: what a list word is worth (full for a generated phrase, less if typed). */
function pieceBits(piece: string, listBits: number, chosen: boolean): number {
  if (piece === KNOWN || COMMON_TOKENS.has(piece)) return 2;
  if (LIST.has(piece)) return chosen && SEQ_WORDS.has(piece) ? 4 : listBits;
  if (isRun(piece)) return 3;
  const unit = repeatedUnit(piece);
  if (unit) return pieceBits(unit, listBits, chosen) + 1;
  if (/^\p{N}+$/u.test(piece)) {
    if (/^(19|20)\d\d$/.test(piece)) return 6; // a year
    return Math.min(piece.length * Math.log2(10), 20);
  }
  if (SEQ_WORDS.has(piece)) return 4;
  // a word she picked: people choose words that go together, so at most 6; a long run of letters is probably several
  // words run together, at about 1 bit a letter
  return piece.length <= 8 ? Math.min(piece.length * 1.5, 6) : piece.length;
}

/** Folds runs of `minRun`+ tokens that step through one ordered set (list order, alphabetical, counting) into KNOWN. */
function foldOrderedRuns(toks: string[], minRun: number): string[] {
  const position = (t: string, set: 'list' | number): number | undefined =>
    set === 'list' ? LIST_INDEX.get(t) : SEQUENCES[set].indexOf(t) >= 0 ? SEQUENCES[set].indexOf(t) : undefined;
  const sets: Array<'list' | number> = ['list', ...SEQUENCES.map((_, i) => i)];
  const out: string[] = [];
  let i = 0;
  while (i < toks.length) {
    let best = 1;
    for (const set of sets) {
      const start = position(toks[i], set);
      if (start === undefined) continue;
      // list order: each next word within a few places, one direction; a counting set: the very next item
      const maxStep = set === 'list' ? 3 : 1;
      for (const dir of [1, -1]) {
        let n = 1;
        let prev = start;
        while (i + n < toks.length) {
          const p = position(toks[i + n], set);
          if (p === undefined || (p - prev) * dir < 1 || (p - prev) * dir > maxStep) break;
          prev = p;
          n++;
        }
        best = Math.max(best, n);
      }
    }
    if (best >= minRun) {
      out.push(KNOWN);
      i += best;
    } else out.push(toks[i++]);
  }
  return out;
}

/** Lowercase words and numbers in `s`, with known phrases and ordered runs folded into one KNOWN token each. */
function tokens(s: string, minRun: number): string[] {
  let toks = s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((t) => (COMMON_TOKENS.has(t) ? KNOWN : t));
  for (const phrase of COMMON_PHRASES) {
    const out: string[] = [];
    for (let i = 0; i < toks.length; ) {
      if (phrase.every((w, j) => toks[i + j] === w)) {
        out.push(KNOWN);
        i += phrase.length;
      } else out.push(toks[i++]);
    }
    toks = out;
  }
  toks = foldOrderedRuns(toks, minRun);
  // "word2024" → "word", "2024"
  return toks.flatMap((t) => (t === KNOWN ? [t] : (t.match(/\p{L}+|\p{N}+/gu) ?? [])));
}

export interface MeterOptions {
  /**
   * Whether this device made it (the form knows which suggestions it showed). false: score it as written by her even
   * if it looks generated (six list words typed with dashes are not random). Omitted: judged by its shape alone.
   */
  generatedHere?: boolean;
}

function looksGenerated(s: string, opts: MeterOptions): boolean {
  return opts.generatedHere !== false && (isGeneratedPassphrase(s, SURVIVOR_WORDS) || isGeneratedPassphrase(s, PROFESSIONAL_WORDS));
}

/**
 * The meter's score for a passphrase. A generated one (`words` distinct list words joined by "-") scores its real
 * entropy, about 10 bits a word, whatever her alias is. Anything else is scored as written by her: see the header.
 * `context`: words an attacker would try first (her alias), which count for nothing in a phrase she wrote.
 */
export function estimateBits(p: string, context: readonly string[] = [], opts: MeterOptions = {}): number {
  const s = p.normalize('NFKC').trim();
  const generated = looksGenerated(s, opts);
  // a random phrase almost never holds 4 words in list order (about 1 in 10 million); a typed one often holds 3
  const toks = tokens(s, generated ? 4 : 3);
  const known = generated ? new Set<string>() : new Set(context.flatMap((c) => tokens(c, 3)).filter((t) => t !== KNOWN));
  const distinct = new Set(toks.filter((t) => !known.has(t)));
  let bits = 0;
  for (const piece of distinct) bits += pieceBits(piece, generated ? BITS_PER_WORD : 8, !generated);
  if (generated) return bits;
  // symbols other than spaces and the usual separators, and capital letters, add a little
  const symbols = new Set(s.match(/[^\p{L}\p{N}\s\-_.,]/gu) ?? []);
  bits += Math.min(symbols.size, 2) * 3;
  if (/\p{Lu}/u.test(s)) bits += /\p{L}\p{Lu}/u.test(s) ? 2 : 1;
  return bits;
}

export type Strength = 'too-short' | 'weak' | 'okay' | 'strong';

/**
 * The meter. Only 'strong' is accepted; 'okay' means "almost". A generated phrase is 'strong'; a phrase she wrote
 * herself must reach MIN_CHOSEN_SCORE, and the message never puts a number on it. `context`: her alias.
 */
export function passphraseStrength(
  p: string,
  context: readonly string[] = [],
  opts: MeterOptions = {},
): { level: Strength; message: string; bits: number } {
  const s = p.normalize('NFKC').trim();
  const bits = estimateBits(s, context, opts);
  const generated = looksGenerated(s, opts);
  if (s.length < 12) return { level: 'too-short', bits, message: 'Use at least 12 characters. Six random words work well.' };
  if (bits >= MIN_CHOSEN_SCORE)
    return {
      level: 'strong',
      bits,
      message: generated
        ? 'Strong. Write it down somewhere only you can reach.'
        : 'Hard to guess. Still, a phrase you make up is easier to guess than the random words we suggest, so those are safer. Write it down somewhere only you can reach.',
    };
  if (bits >= OKAY_SCORE)
    return { level: 'okay', bits, message: 'Almost. Add more words that don’t go together, or use the random words we suggest (safer).' };
  return { level: 'weak', bits, message: 'Too easy to guess. Phrases people make up are easier to guess than they look. The random words we suggest are safer.' };
}

/** Whether a passphrase she chose may be used. */
export function passphraseAccepted(p: string, context: readonly string[] = [], opts: MeterOptions = {}): boolean {
  return passphraseStrength(p, context, opts).level === 'strong';
}
