/**
 * Low-level text helpers for the understanding engine. Everything works on the ORIGINAL string
 * (case-insensitive regexes) so character offsets always point at her exact words.
 */
import nlp from 'compromise/two';

export interface Sent {
  start: number;
  end: number;
}

/** Apostrophe class: survivors type ' or ’, or leave it out entirely ("didnt"). */
export const A = "['’]?";

/** Split into sentence-ish chunks; very long run-ons are also cut at "and then" / "so" / "but". */
export function sentences(text: string): Sent[] {
  const out: Sent[] = [];
  const re = /[^\n.!?…]+(?:[.!?…]+["”’)]*|(?=\n)|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[0] === '') {
      re.lastIndex++;
      continue;
    }
    const s = m.index;
    const e = m.index + m[0].length;
    if (!/\S/.test(m[0])) continue;
    // Break long run-ons (lowercase, no punctuation dumps) at soft boundaries.
    const words = m[0].split(/\s+/).length;
    if (words > 40) {
      const soft = /\s(?:and then|then|so|but|after that|and i|and he)\s/gi;
      let last = s;
      let sm: RegExpExecArray | null;
      const chunk = m[0];
      while ((sm = soft.exec(chunk))) {
        const cut = s + sm.index;
        if (cut - last > 60) {
          out.push({ start: last, end: cut });
          last = cut + 1;
        }
      }
      out.push({ start: last, end: e });
    } else out.push({ start: s, end: e });
  }
  return out;
}

export function sentenceAt(sents: Sent[], idx: number): Sent {
  let lo = 0;
  let hi = sents.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = sents[mid];
    if (idx < s.start) hi = mid - 1;
    else if (idx >= s.end) lo = mid + 1;
    else return s;
  }
  return { start: Math.max(0, idx - 80), end: idx + 80 };
}

const CLAUSE_BREAK =
  /[,;:()—–]|\b(?:but|then|so|because|cause|cuz|although|though|until|after|before|when|while|and (?=i\b|he\b|she\b|we\b|they\b|then\b)|y (?=yo\b|él\b|el\b))/gi;

/** Start offset of the clause containing `idx` (bounded by the sentence). */
export function clauseStart(text: string, sent: Sent, idx: number): number {
  const seg = text.slice(sent.start, idx);
  let last = 0;
  CLAUSE_BREAK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CLAUSE_BREAK.exec(seg))) last = m.index + m[0].length;
  return sent.start + last;
}

/** End offset of the clause containing `idx`. */
export function clauseEnd(text: string, sent: Sent, idx: number): number {
  const seg = text.slice(idx, sent.end);
  const re = /[,;:()—–.!?…]|\s(?:but|then|so|because|cause|cuz|and (?=i\b|he\b|she\b|we\b|they\b|then\b))\s/i;
  const m = re.exec(seg);
  return m ? idx + m.index : sent.end;
}

/** Last N words before idx within the clause. */
export function wordsBefore(text: string, sent: Sent, idx: number, n = 7): string {
  const cs = clauseStart(text, sent, idx);
  const words = text.slice(cs, idx).trim().split(/\s+/).filter(Boolean);
  return words.slice(-n).join(' ');
}

const NEGATOR = new RegExp(
  [
    `\\bnot\\b`, `\\bnever\\b`, `\\bno\\b`, `\\bnope\\b`, `\\bnobody\\b`, `\\bno one\\b`, `\\bnoone\\b`, `\\bwithout\\b`, `\\bnunca\\b`,
    `\\b(?:did|do|does|was|were|is|are|has|have|had|could|would|wo|ca|should)n${A}t\\b`,
    `\\b(?:did|do|does|was|were|is|are|has|have|had|could|would|can|should) not\\b`,
    `\\bcannot\\b`, `\\bwish i (?:had|would have|could have)\\b`, `\\bshould (?:have|['’]?ve)\\b`, `\\bshould${A}ve\\b`,
    `\\bnever got to\\b`, `\\btoo (?:scared|afraid|embarrassed|ashamed) to\\b`, `\\brefused\\b`, `\\bdeclined\\b`,
  ].join('|'),
  'i',
);

const UNCERTAIN = new RegExp(
  `\\b(?:not sure|unsure|(?:do|did)n${A}t know|do not know|(?:ca|do|did)n${A}t remember|cannot remember|can${A}t recall|no idea|idk|not certain|i wonder)\\b(?:\\s+(?:if|whether|what|when|how|exactly))?|\\bmaybe\\b|\\bmight\\b|\\bpossibly\\b|\\bi guess\\b|\\bno s[eé] si\\b`,
  'i',
);
const MILD = /\b(?:i think|i thought|i believe|pretty sure|probably|around|about|roughly|approximately|close to|almost|like|or so|i feel like|kind of|kinda|sort of|creo que|como)\b|-ish\b|ish\b/i;
const STRONG = /\b(?:maybe|might|might have|possibly|i guess|not sure|unsure|sometime|some time|i don['’]?t remember|i dont remember|can['’]?t remember|idk|no idea|or something|could have been|could['’]?ve been|tal vez|quizás|quizas)\b/i;

export type Polarity = 'pos' | 'neg' | 'uncertain';

/** Is the trigger at `idx` negated within its clause? "I'm not sure if…" is uncertainty, not negation. */
export function polarity(text: string, sent: Sent, idx: number, n = 7): Polarity {
  const before = wordsBefore(text, sent, idx, n);
  if (UNCERTAIN.test(before)) return 'uncertain';
  if (NEGATOR.test(before)) return 'neg';
  return 'pos';
}

export type Hedge = 'none' | 'mild' | 'strong';

/** Hedging language near a span (same sentence, a few words either side). */
export function hedge(text: string, sent: Sent, start: number, end: number): Hedge {
  const cs = clauseStart(text, sent, start);
  const before = text.slice(Math.max(cs, start - 60), start);
  const after = text.slice(end, Math.min(sent.end, end + 30));
  const win = `${before} ${text.slice(start, end)} ${after.split(/[,.;!?]/)[0]}`;
  if (STRONG.test(win)) return 'strong';
  if (MILD.test(win)) return 'mild';
  return 'none';
}

export function hedgeConfidence(base: 'high' | 'medium' | 'low', h: Hedge): 'high' | 'medium' | 'low' {
  if (h === 'strong') return 'low';
  if (h === 'mild') return base === 'high' ? 'medium' : base === 'medium' ? 'medium' : 'low';
  return base;
}

export function lowerConfidence(c: 'high' | 'medium' | 'low'): 'high' | 'medium' | 'low' {
  return c === 'high' ? 'medium' : 'low';
}

/** Leading hedge / preposition words directly before idx that belong with a phrase ("maybe around 2am"). */
export function expandHedgeLeft(text: string, idx: number, floor: number): number {
  const re = /(?:\b(?:maybe|probably|around|about|like|roughly|approximately|sometime|some time|i think|almost|close to|just|right|after|before|until|til|till|at|in|on|by)\s+)+$/i;
  const seg = text.slice(Math.max(floor, idx - 40), idx);
  const m = re.exec(seg);
  if (!m) return idx;
  return idx - m[0].length;
}

/** Trim whitespace and trailing punctuation off a span; returns adjusted [start, end]. */
export function trimSpan(text: string, start: number, end: number): [number, number] {
  while (start < end && /[\s,;:"“”'‘’(]/.test(text[start])) start++;
  while (end > start && /[\s,;:.!?…"“”'‘’)]/.test(text[end - 1])) end--;
  return [start, end];
}

// ───────── token knowledge (compromise, cached per word) ─────────

const tagCache = new Map<string, Set<string>>();
export function tagsOf(word: string): Set<string> {
  const k = word;
  let t = tagCache.get(k);
  if (!t) {
    const j = nlp(word).json() as Array<{ terms: Array<{ tags: string[] }> }>;
    t = new Set(j[0]?.terms[0]?.tags ?? []);
    if (tagCache.size > 20000) tagCache.clear();
    tagCache.set(k, t);
  }
  return t;
}

/** Words that are never a person's name, however they are capitalized. */
const NOT_NAMES = new Set(
  (
    'i me my mine myself im i\'m ive id ill he him his himself she her hers they them their we us our you your it its the a an this that these those ' +
    'and but or so then when while after before because if just like um uh lol omg idk tbh ok okay yes no yeah nah hey hi ' +
    'monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december ' +
    'god jesus mom dad mama papa uber lyft er sane er\'s tinder hinge bumble grindr insta ig snap snapchat tiktok facebook fb twitter discord whatsapp telegram ' +
    'police cops hr ra title ix school college university hospital doctor nurse cvs walgreens target walmart amazon google iphone android ' +
    'everyone everybody someone somebody anyone nobody people guy guys man men dude bro girl girls friend friends ' +
    'mi yo el él ella le lo la que de en con por para pero muy fue me dijo y no si sí es una un'
  ).split(' '),
);

/** Could this token be (part of) a person's name? Single initials ("R", "J.") count. */
export function isNameToken(tok: string): boolean {
  const w = tok.replace(/[.,;:!?'’"”)]+$/g, '');
  if (!w) return false;
  if (/^[A-Z]\.?$/.test(w)) return true; // an initial
  const lw = w.toLowerCase();
  if (NOT_NAMES.has(lw)) return false;
  if (!/^[\p{L}][\p{L}'’-]*$/u.test(w)) return false;
  const tags = tagsOf(lw);
  if (tags.has('Month') || tags.has('Date') || tags.has('Verb') || tags.has('Pronoun') || tags.has('Determiner') || tags.has('Adjective')) {
    return /^\p{Lu}/u.test(w) && tags.has('FirstName');
  }
  if (tags.has('FirstName') || tags.has('LastName') || tags.has('Person')) return true;
  // Capitalized mid-sentence word that compromise doesn't know as a common word.
  return /^\p{Lu}[\p{Ll}'’-]+$/u.test(w) && !tags.has('Place') && !tags.has('Organization') && !COMMON_CAPS.has(lw);
}

const COMMON_CAPS = new Set(
  'christmas thanksgiving halloween easter spring summer fall winter english spanish netflix starbucks venmo cashapp zoom'.split(' '),
);

/** Read a name of 1–2 tokens starting at idx. Returns [start, end] or undefined. */
export function readName(text: string, idx: number): [number, number] | undefined {
  const re = /^([\p{L}][\p{L}'’-]*\.?)(?:\s+([\p{Lu}][\p{L}'’-]*\.?))?/u;
  const m = re.exec(text.slice(idx, idx + 60));
  if (!m) return undefined;
  if (!isNameToken(m[1])) return undefined;
  let end = idx + m[1].length;
  // Second token: only when capitalized and name-like, and the first was capitalized too.
  if (m[2] && /^\p{Lu}/u.test(m[1]) && isNameToken(m[2]) && !/^[A-Z]\.?$/.test(m[1])) end = idx + m[0].length;
  // Drop a trailing period after a multi-letter word (sentence end), keep it on initials.
  if (text[end - 1] === '.' && !/^[A-Z]\.$/.test(text.slice(idx, end))) end--;
  return [idx, end];
}

/** FNV-1a 32-bit hash → base36. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** "my coworker" → "your coworker" (only for labels shown back to her; her stored words are untouched). */
export function toSecondPerson(phrase: string): string {
  return phrase
    .replace(/\bmy\b/gi, 'your')
    .replace(/\bme\b/gi, 'you')
    .replace(/\bI['’]m\b/g, "you're")
    .replace(/\bi\b/gi, 'you')
    .replace(/\bour\b/gi, 'your');
}

export function quote(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return `“${one.length > 140 ? one.slice(0, 137).trimEnd() + '…' : one}”`;
}
