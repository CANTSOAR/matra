/**
 * Clause guards: a mark must sit in a clause where SHE says it happened. Dropped:
 *   - negated       "I didn't tell anyone", "I never reported it", "no one saw"
 *   - hypothetical  "I wish I'd told someone", "if I call the police", "I want to tell my mom"
 *   - quoted        a span inside quotation marks is recorded speech, not her statement of fact
 *   - reported      "he said he was at the bar", "my mom told me that ..." (what someone else said)
 *   - other actor   "my sister told her friend": someone else's action, not hers
 *   - ambiguous     the clause has an action word nobody listed as plain (fail-safe: see ambiguousClause)
 *   - sensitive     the clause is about force, drinks or drugging, injuries, the neck or sex (see SENSITIVE_CONTEXT): a mark would
 *                   quote a clause about exactly the things the marker must never point at (PLAN_REVIEW finding 7)
 *
 * This is a second, independent guard. The rule engine in src/understand already skips many negations; this one is
 * applied to whatever any engine proposes, and a model path (plan 8.3) would go through it too, because small embedding
 * models ignore negation (PLAN_REVIEW finding 10). It errs towards dropping: a wrong mark nudges her to skip a question
 * she has not covered, a missed mark just leaves the plain checklist.
 *
 * Works on the original string so offsets stay exact. English only for v1 (Spanish arrives with a Spanish bank).
 */
import type { DropReason } from './types';

const A = "['’]?";

const CLAUSE_BREAK =
  /[,;:()—–]|\b(?:but|then|so|because|cause|cuz|although|though|until|after|before|when|while|whereas|and (?=i\b|he\b|she\b|we\b|they\b|then\b))/gi;
const SENTENCE_END = /[.!?…\n]/;

/**
 * How far the guards look for the edges of a sentence. A real sentence is far shorter; unpunctuated pasted text is not, and
 * scanning all of it for every candidate made the guards quadratic (100,000 characters took tens of seconds). Looking only
 * this far is safe: the guard then judges the nearest WINDOW characters, which is where its cue words are.
 */
export const GUARD_WINDOW = 600;

/** [start, end) of the sentence containing idx, looking at most GUARD_WINDOW characters either way. */
function sentenceBounds(text: string, idx: number): [number, number] {
  let s = Math.min(idx, text.length);
  const lo = Math.max(0, s - GUARD_WINDOW);
  while (s > lo && !SENTENCE_END.test(text[s - 1])) s--;
  let e = idx;
  const hi = Math.min(text.length, idx + GUARD_WINDOW);
  while (e < hi && !SENTENCE_END.test(text[e])) e++;
  return [s, e];
}

/** Start of the clause that contains `idx`, bounded by its sentence. */
function clauseStartOf(text: string, idx: number): number {
  const [s] = sentenceBounds(text, idx);
  const seg = text.slice(s, idx);
  let last = 0;
  CLAUSE_BREAK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CLAUSE_BREAK.exec(seg))) last = m.index + m[0].length;
  return s + last;
}

const NEGATOR = new RegExp(
  [
    `\\bnot\\b`, `\\bnever\\b`, `\\bno\\b`, `\\bnope\\b`, `\\bnobody\\b`, `\\bno ?one\\b`, `\\bnone\\b`, `\\bnothing\\b`, `\\bwithout\\b`, `\\bneither\\b`, `\\bnor\\b`,
    `\\b(?:did|do|does|was|were|is|are|has|have|had|could|would|wo|ca|should|must|need|ain)n${A}t\\b`,
    `\\b(?:dont|didnt|wasnt|werent|havent|hasnt|hadnt|cant|couldnt|wouldnt|wont|isnt|arent|doesnt|shouldnt)\\b`,
    `\\bcannot\\b`, `\\bnever got to\\b`, `\\brefused\\b`, `\\bdeclined\\b`, `\\bavoid(?:ed)?\\b`, `\\bskipped\\b`, `\\bunable to\\b`,
    `\\btoo (?:scared|afraid|embarrassed|ashamed|nervous) to\\b`,
  ].join('|'),
  'i',
);

const HYPOTHETICAL = new RegExp(
  [
    `\\bif\\b`, `\\bwhat if\\b`, `\\bwish(?:ed)?\\b`, `\\bimagine\\b`, `\\bsuppose\\b`, `\\bhope\\b`, `\\bwhether\\b`, `\\bunless\\b`, `\\bin case\\b`, `\\bsomeday\\b`, `\\bone day\\b`,
    `\\b(?:would|could|should|might|may|can|will|shall)\\b`, `\\b(?:would|could|should)${A}ve\\b`, `\\b(?:woulda|coulda|shoulda)\\b`,
    `\\b(?:going|gonna|planning|plan|plans|want|wanted|wants|trying|thinking|thought|considering|need|needs|needed|have|has|had|supposed) to (?:tell|call|text|talk|report|reach|contact|ask|see|go|file|get|send|speak|show|save|keep|screenshot|write)\\b`,
    `\\b(?:thinking|thought|considered|consider|dreamed|dream) (?:about|of)\\b`,
  ].join('|'),
  'i',
);

/** Someone else's speech reported to her: a reporting verb earlier in the same sentence. */
const REPORTING =
  /\b(?:said|says|saying|told me|tells me|texted me|messaged me|asked me|claimed|claims|insisted|admitted|replied|answered|whispered|yelled|shouted|swore|according to)\b/i;

/** Quoted spans: straight and curly double quotes; single quotes only when they are not apostrophes. */
const QUOTE_RE = /“[^”\n]{1,400}”|"[^"\n]{1,400}"|(?<![\p{L}])'[^'\n]{2,200}'(?![\p{L}])|‘[^’\n]{2,200}’(?![\p{L}])/gu;

/** Quoted ranges of a text. Compute once per text and pass it to dropReasonFor for every candidate. */
export function quoteRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  QUOTE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = QUOTE_RE.exec(text))) out.push([m.index, m.index + m[0].length]);
  return out;
}

export function inQuotes(text: string, start: number, end: number, ranges: Array<[number, number]> = quoteRanges(text)): boolean {
  return ranges.some(([s, e]) => start >= s && end <= e);
}

/**
 * Words that put a clause in the sensitive groups. Stems, matched at a word start. Deliberately broad: dropping a mark in a
 * clause like this costs a little recall, and a mark there would quote wording about force, drugging, injury or sex.
 * English only for v1. Review with the bank (src/ml/marker/bank.ts).
 */
const SENSITIVE_CONTEXT = new RegExp(
  String.raw`\b(?:bruis|injur|hurt|bleed|bled|wound|scratch|swollen|swelling|sore\b|bitten|burn|choke|chok|strangl|smother|suffocat|throat|neck|grab|pinn|pushed|shov|slam|hit me|punch|slap|kick|stab|shot\b|tase|gag\b|forc|restrain|held (?:a|me|my|down)|tied|threat|weapon|knife|gun|drug|drunk|drink|alcohol|spiked|roofie|pill|tablet|powder|dizzy|passed out|blacked out|unconscious|(?:don|do not|can)${A}?t remember|rape|raped|assault|sex|intercours|naked|undress|strip|kiss|touch|grop|fondl|condom|penetrat|penis|vagin|ejacul|oral\b|inside me|on top of|underwear|panties|\bbra\b|breast|genital|thigh|marks? on|\b(?:arm|leg|wrist|chest|lip|face)s?\b|pants|clothes off|abus|molest|violat|coerc|pressur)`,
  'i',
);

/**
 * Fail-safe for a clause the word list above cannot judge. A neutral mark is kept only when every action word in its
 * clause is a plain, benign one (told, called, saved, went, was, ...). Any other past-tense or -ing word ("pushed", "walking",
 * "dragged", "pinned", a verb nobody listed) makes the clause ambiguous and the mark is dropped: a word list always has gaps, and a
 * mark placed in a clause about something we did not understand is the wrong way to be wrong. Costs recall; the eval says how much.
 */
const BENIGN_ACTION = new Set(
  `told tell texted text called call messaged emailed talked spoke reported report filed file saved kept took take have had has was were is are am be been went go got get came come left arrived stayed met saw heard lives lived live drove walked picked sent showed happened started ended parked worked noticed remembered forwarded screenshotted recorded backed wrote written asked replied filled reached confided stopped used turned opened looked checked`.split(
    ' ',
  ),
);
const BENIGN_ING = new Set('morning evening building parking during something anything everything nothing wedding meeting dining being thing things ceiling spring'.split(' '));
/** Past-tense forms that do not end in -ed and are not benign. */
const IRREGULAR_ACTION = new Set('put held hit threw pulled tore bit cut lay laid made let ran sat stood shook woke slept fell dragged broke ripped drew held gave took'.split(' ').filter((w) => !BENIGN_ACTION.has(w)));

function ambiguousClause(clause: string): boolean {
  const words = clause.match(/\p{L}+(?:['’]\p{L}+)?/gu) ?? [];
  for (const [i, raw] of words.entries()) {
    // a capitalised word that is not the first of the clause is a name ("Fred", "Reed"), not an action
    if (i > 0 && /^\p{Lu}/u.test(raw)) continue;
    const w = raw.toLowerCase();
    if (BENIGN_ACTION.has(w) || BENIGN_ING.has(w)) continue;
    if (IRREGULAR_ACTION.has(w)) return true;
    if (w.length >= 5 && w.endsWith('ed')) return true;
    if (w.length >= 5 && w.endsWith('ing')) return true;
  }
  return false;
}

/** For these questions the subject of the clause matters: who told whom, who reported, whose files. */
const ACTOR_SENSITIVE = new Set(['people.told', 'prior.any', 'evidence.upload']);

const ACT = String.raw`(?:told|texted|called|messaged|emailed|talked to|spoke to|spoke with|confided in|reached out to|reported|filed|saved|kept|has|have|had|sent|showed|screenshotted|forwarded)`;
const ADV = String.raw`(?:(?:also|then|later|already|just|still|finally|even)\s+){0,2}`;
const FIRST_PERSON_ACT = new RegExp(String.raw`\b(?:i|we|me and \S+)\s+${ADV}${ACT}\b`, 'i');
const OTHER_ACT = new RegExp(
  String.raw`\b(?:he|she|they|someone|somebody)\s+${ADV}${ACT}\b|\b(?:my|his|her|their|our)\s+[\p{L}'’-]+(?:\s+[\p{L}'’-]+)?\s+${ADV}${ACT}\b`,
  'iu',
);
/** A capitalised name doing the act ("Dana texted her mom"). Case-sensitive on purpose. */
const NAMED_ACT = new RegExp(String.raw`(?<![\p{L}'’-])(?!I\b)[A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+)?\s+${ADV}${ACT}\b`, 'u');

/**
 * Why a span at [start, end) must not be marked, or null. `questionId` lets the other-actor guard apply only where the
 * subject matters (the others are about the place, the date or the files, whoever is speaking).
 */
export function dropReasonFor(text: string, start: number, end: number, questionId?: string, quotes?: Array<[number, number]>): DropReason | null {
  if (inQuotes(text, start, end, quotes)) return 'quoted';

  const cs = clauseStartOf(text, start);
  const scope = text.slice(cs, end);
  const [, sentEnd] = sentenceBounds(text, end);

  if (NEGATOR.test(scope) || /^\s*(?:,\s*)?(?:not|never)\b/i.test(text.slice(end, sentEnd))) return 'negated';
  if (HYPOTHETICAL.test(scope)) return 'hypothetical';

  // the rest of the clause after the span ("...have photos of the bruises")
  const after = text.slice(end, sentEnd);
  const clauseEnd = end + (/[,;:()—–]|\b(?:but|then|so|because|and (?=i\b|he\b|she\b|we\b|they\b))/i.exec(after)?.index ?? after.length);
  const clause = text.slice(cs, clauseEnd);
  if (SENSITIVE_CONTEXT.test(clause)) return 'sensitive-context';
  if (ambiguousClause(clause)) return 'ambiguous-clause';

  const [sentStart] = sentenceBounds(text, start);
  if (REPORTING.test(text.slice(sentStart, start))) return 'reported-speech';

  if (questionId && ACTOR_SENSITIVE.has(questionId)) {
    // the verb is often inside the span itself ("has the screenshots"), so look at the whole clause up to the span's end
    if ((OTHER_ACT.test(scope) || NAMED_ACT.test(scope)) && !FIRST_PERSON_ACT.test(scope)) return 'other-actor';
  }
  return null;
}
