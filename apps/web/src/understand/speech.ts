/** Words spoken by the person responsible — quoted ("he said “relax”") or reported ("he said no one would believe me"). */
import { emit, matches, sentOf, type Ctx } from './context';
import { quote, trimSpan } from './text';

const SPEAK_VERB = String.raw`said|says|told me|tells me|texted(?: me)?|whispered|yelled|screamed|kept saying|keeps saying|kept telling me|goes|went|was like|is like|wrote|messaged(?: me)?|snapped(?: me)?|dm['’]?e?d(?: me)?|asked(?: me)?|replied|answered|laughed|muttered|said to me|me dijo|dijo|me escribi[oó]`;
const SPEAKER = String.raw`he|him|(?:the|that|this)\s+guy|[\p{Lu}][\p{L}'’-]*`;
const BEFORE_RE = new RegExp(String.raw`(?<![\p{L}])(?<spk>${SPEAKER})\s+(?:just\s+|then\s+|finally\s+|even\s+|also\s+)?(?:${SPEAK_VERB})(?:\s+[\p{L}0-9'’-]+){0,4}?\s*[,:]?\s*(?:that\s+)?$`, 'iu');
const AFTER_RE = new RegExp(String.raw`^\s*,?\s*(?:(?<spk>${SPEAKER})\s+(?:${SPEAK_VERB})|(?:said|whispered|yelled|asked)\s+(?<spk2>he))\b`, 'iu');
const NOT_HIM = /^(?:i|she|her|they|my|we|you|it|mom|me)$/i;
const NOT_HIM_BEFORE = /(?:^|\s)(?:i|she|they|we|my\s+[\p{L}]+|her\s+[\p{L}]+)\s+(?:just\s+|then\s+)?(?:said|says|told|texted|kept saying|was like|yelled|screamed|asked|whispered)\b[^"“‘']{0,30}$/iu;

const INDIRECT_RE = new RegExp(
  String.raw`(?:(?<![\p{L}])(?:he|(?:the|that|this)\s+guy)\s+(?:just\s+|then\s+|even\s+|also\s+|later\s+)?(?:said|says|told me|kept saying|kept telling me|whispered|yelled|texted(?: me)?|threatened|warned me|me dijo|dijo)|(?<![\p{L}])me\s+dijo)\s+(?:that\s+|que\s+)?(?<what>[^.!?\n"“”]{6,200})`,
  'giu',
);
const SOFT_END = /\s(?:and i|but i|so i|then i|and then|y yo|pero yo)\b/i;

function isHim(spk: string | undefined): boolean {
  if (!spk) return false;
  const s = spk.trim();
  if (NOT_HIM.test(s)) return false;
  if (/^(?:he|him)$/i.test(s) || /guy$/i.test(s)) return true;
  // A capitalized name: only if it isn't a sentence-start word like "Then" or "So".
  return /^\p{Lu}/u.test(s) && !/^(?:Then|So|And|But|He|She|I|We|They|It|My|Mom|Dad)$/.test(s);
}

export function extractSpeech(ctx: Ctx): void {
  const t = ctx.text;
  const covered: Array<[number, number]> = [];
  for (const [qs, qe] of ctx.quotes) {
    const sent = sentOf(ctx, qs);
    const beforeText = t.slice(Math.max(sent.start, qs - 80, 0), qs);
    const afterText = t.slice(qe, Math.min(t.length, qe + 40));
    let start = qs;
    let end = qe;
    let confidence: 'high' | 'medium' | 'low' | undefined;
    const bm = BEFORE_RE.exec(beforeText);
    const am = AFTER_RE.exec(afterText);
    // "He grabbed my arm and said “…”": the speaker is the subject earlier in the sentence.
    const chained = /(?:\band|\bthen|,)\s+(?:just\s+|kept\s+)?(?:said|says|whispered|yelled|told me|goes|went|was like|asked)\s*[,:]?\s*$/i.test(beforeText);
    const subject = /^\W*(?:\w+\s+){0,3}?(he|she|i|we|they)\b/i.exec(t.slice(sent.start, qs))?.[1]?.toLowerCase();
    if (bm && isHim(bm.groups!.spk)) {
      start = qs - beforeText.length + bm.index;
      confidence = 'high';
    } else if (chained && subject === 'he') {
      const v = /(?:just\s+|kept\s+)?(?:said|says|whispered|yelled|told me|goes|went|was like|asked)\s*[,:]?\s*$/i.exec(beforeText);
      start = qs - beforeText.length + (v ? v.index : 0);
      confidence = 'high';
    } else if (am && (isHim(am.groups!.spk) || am.groups!.spk2)) {
      end = qe + am[0].length;
      confidence = 'high';
    } else if (NOT_HIM_BEFORE.test(beforeText) || (am && am.groups!.spk && !isHim(am.groups!.spk))) {
      continue; // her own words, or a friend's
    } else if (/\b(?:he|him|his)\b/i.test(t.slice(sent.start, sent.end))) {
      confidence = 'low';
    }
    if (!confidence) continue;
    const inner = t.slice(qs + 1, qe - 1).trim();
    if (inner.length < 2) continue;
    [start, end] = trimSpan(t, start, end);
    // Keep the closing quote mark.
    if (end < qe && /["”’']/.test(t[qe - 1])) end = Math.max(end, qe);
    if (start > qs) start = qs;
    covered.push([start, end]);
    const words = t.slice(start, end);
    emit(ctx, {
      kind: 'words_spoken', target: 'context.words', value: words, confidence,
      label: `You remembered something that was said: ${quote(inner)}`, start, end, key: inner.toLowerCase(),
    });
  }
  for (const m of matches(ctx, INDIRECT_RE)) {
    const s = m.index;
    if (covered.some(([a, b]) => s < b && s + m[0].length > a)) continue;
    let e = s + m[0].length;
    const soft = SOFT_END.exec(m[0]);
    if (soft) e = s + soft.index;
    [, e] = trimSpan(t, s, e);
    const what = (m.groups!.what ?? '').trim();
    if (what.split(/\s+/).length < 2) continue;
    // "he said ok" / "he told me to sit down" are kept; "he said nothing" is not a statement.
    if (/^(?:nothing|anything|something)\b/i.test(what)) continue;
    const words = t.slice(s, e);
    emit(ctx, {
      kind: 'words_spoken', target: 'context.words', value: words, confidence: 'medium',
      label: `You remembered something that was said: ${quote(words)}`, start: s, end: e, key: words.toLowerCase(),
    });
  }
}
