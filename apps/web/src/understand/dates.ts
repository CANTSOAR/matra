/**
 * Dates and times, resolved against when she wrote each piece (StoryEntry.createdAt).
 * Hedged phrases ("i think", "maybe around") lower confidence and mark the date approximate.
 * Vague phrases ("sometime in june", "last summer") are kept as her own words (DateAnswer mode 'text').
 */
import * as chrono from 'chrono-node';
import type { DateAnswer } from '../intake/draft';
import { consume, emit, inQuote, isConsumed, sentOf, type Confidence, type Ctx } from './context';
import { expandHedgeLeft, hedge, hedgeConfidence, quote, trimSpan, type Sent } from './text';

export interface DateHit {
  start: number;
  end: number;
  answer: DateAnswer;
  confidence: Confidence;
  /** Human rendering for labels. */
  display: string;
  hedged: boolean;
}

export interface TimeHit {
  start: number;
  end: number;
  text: string;
  confidence: Confidence;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const TRIGGER =
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)s?\b|\byesterday\b|\btoday\b|\btonight\b|\bago\b|\blast (?:night|week|weekend|month|year)\b|\d|\bnoon\b|\bmidnight\b|\bo['’]?clock\b/i;

/** Words chrono reads as dates that are usually something else ("i sat down", "i may have", "the sun"). */
const AMBIGUOUS_WORD = /^(?:may|march|sat|sun|wed|mon|tue|thu|fri|jan|aug|second|sec)$/i;

const STORY_RELATIVE = /\b(?:next|following|later|after|before|earlier)\b/i;
const NOW_WORDS = /^(?:now|right now|today|tonight|this morning|these days|currently)$/i;
const TIME_TEXT = /\d\s*(?:am|pm|a\.m\.?|p\.m\.?)\b|\d:\d\d|\bo['’]?clock\b|\bnoon\b|\bmidnight\b/i;

const VAGUE =
  /\b(?:last|this past|that|this|in the|during the|over the|in|early|late)\s+(?:summer|winter|spring|fall|autumn)(?:\s+(?:of\s+)?(?:19|20)\d\d)?\b(?!\s+(?:semester|break|classes))|\b(?:summer|winter|spring|fall|autumn)\s+(?:of\s+)?(?:19|20)\d\d\b|\b(?:spring|winter|fall|thanksgiving|christmas|easter|summer) break\b|\b(?:new year['’]?s(?: eve)?|thanksgiving(?: weekend)?|christmas(?: eve)?|halloween(?: weekend)?|valentine['’]?s(?: day)?|labor day(?: weekend)?|memorial day(?: weekend)?|(?:the )?(?:fourth|4th) of july|homecoming(?: weekend)?|prom night|graduation(?: night)?|orientation week|(?:freshman|sophomore|junior|senior) year|(?:first|second|third|last) (?:week|weekend|month|semester) of (?:school|college|classes|the semester))\b|\b(?:in|back in|during)\s+(?:19|20)\d\d\b/gi;

const TIME_WORDS =
  /\b(?:late at night|(?:in )?the middle of the night|(?:right |just )?after midnight|around midnight|past midnight|early (?:in the )?morning|the early hours|wee hours(?: of the morning)?|before dawn|at dawn|late that night|late in the evening|in the afternoon|in the evening|after dinner|after work|after school|after class|after the party|during the party|at lunch)\b/gi;

function iso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function dayNum(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d) / 86400000;
}

function fromDayNum(n: number): { y: number; m: number; d: number } {
  const t = new Date(n * 86400000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export function displayDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[wd]}, ${MONTHS[m - 1]} ${d}, ${y}`;
}

const ORDINAL_DAY =
  /\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b(?!\s*(?:of\b|floor|time|grade|street|st\b|ave|avenue|row|place|century|amendment|person|guy|one|drink|shot|beer|week|day|year|month|birthday|period|hour|round|try|attempt|-?\s*(?:largest|biggest|best)))/gi;

const MONTH_NAME_RE =
  /\b(?:(january|february|april|june|july|august|september|october|november|december)|(March|May)|(jan|feb|apr|jun|jul|aug|sept?|oct|nov|dec)\.?)\b/gi;

/** The last month she named before `idx` in this piece (1–12), if any. "may"/"march" count only capitalized. */
function monthNamedBefore(text: string, idx: number): number | undefined {
  MONTH_NAME_RE.lastIndex = 0;
  let found: number | undefined;
  let m: RegExpExecArray | null;
  while ((m = MONTH_NAME_RE.exec(text)) && m.index < idx) {
    if (m[2] && !/^[A-Z]/.test(m[2])) continue;
    const w = m[0].toLowerCase().slice(0, 3);
    const i = MONTHS.findIndex((x) => x.toLowerCase().startsWith(w));
    if (i >= 0) found = i + 1;
  }
  return found;
}

/** Day `day` in `month` (latest one not in the future), or in the nearest month where it already happened. */
export function resolveDayOfMonth(day: number, ref: Date, month?: number): string | undefined {
  const refY = ref.getFullYear();
  const refM = ref.getMonth() + 1;
  const refN = dayNum(refY, refM, ref.getDate());
  const valid = (y: number, m: number) => fromDayNum(dayNum(y, m, day)).d === day;
  if (month) {
    for (const y of [refY, refY - 1]) if (valid(y, month) && dayNum(y, month, day) <= refN) return iso(y, month, day);
    return undefined;
  }
  let y = refY;
  let m = refM;
  for (let i = 0; i < 13; i++) {
    if (valid(y, m) && dayNum(y, m, day) <= refN) return iso(y, m, day);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return undefined;
}

const chronoCache = new Map<string, chrono.ParsedResult[]>();
function parse(text: string, ref: Date): chrono.ParsedResult[] {
  const k = `${ref.getTime()}|${text}`;
  let r = chronoCache.get(k);
  if (!r) {
    r = chrono.parse(text, ref, { forwardDate: false });
    if (chronoCache.size > 5000) chronoCache.clear();
    chronoCache.set(k, r);
  }
  return r;
}

export function clearDateCache(): void {
  chronoCache.clear();
}

/** Dates and times inside [from, to) of the entry. */
export function scanDates(ctx: Ctx, sent: Sent): { dates: DateHit[]; times: TimeHit[] } {
  const dates: DateHit[] = [];
  const times: TimeHit[] = [];
  const text = ctx.text;
  const st = text.slice(sent.start, sent.end);
  const refY = ctx.ref.getFullYear();
  const refN = dayNum(refY, ctx.ref.getMonth() + 1, ctx.ref.getDate());

  if (TRIGGER.test(st)) {
    for (const r of parse(st, ctx.ref)) {
      const [start, end] = trimSpan(text, sent.start + r.index, sent.start + r.index + r.text.length);
      if (inQuote(ctx, start)) continue;
      const c = r.start;
      if (AMBIGUOUS_WORD.test(r.text.trim()) && !/\b(?:in|on|of|last|this past|since|early|late|mid|until|that)\s*$/i.test(text.slice(Math.max(sent.start, start - 12), start))) continue;
      const before = text.slice(Math.max(sent.start, start - 14), start);
      const storyRelative = STORY_RELATIVE.test(r.text) || /\b(?:the next|the following|the day after)\s*$/i.test(before);
      const hasDate = c.isCertain('day') || c.isCertain('weekday') || c.isCertain('month') || c.isCertain('year');
      const hasTime = c.isCertain('hour') && TIME_TEXT.test(r.text);

      if (hasTime) {
        const tm = TIME_TEXT.exec(r.text)!;
        // Use the time words only ("at 2am" from "friday at 2am"), plus any hedge in front of them.
        let ts = start + (hasDate ? Math.max(0, r.text.search(/(?:at|around|about)?\s*\d|noon|midnight/i)) : 0);
        if (ts > start + tm.index) ts = start + tm.index;
        const te = hasDate ? start + tm.index + tm[0].length : end;
        const s0 = expandHedgeLeft(text, ts, sent.start);
        const [a, b] = trimSpan(text, s0, te);
        const h = hedge(text, sent, a, b);
        times.push({ start: a, end: b, text: text.slice(a, b), confidence: hedgeConfidence('high', h) });
      }
      if (!hasDate || storyRelative || NOW_WORDS.test(r.text.trim())) continue;

      const h = hedge(text, sent, start, end);
      const hedged = h !== 'none';
      const lower = r.text.toLowerCase();
      const y0 = c.get('year') ?? refY;
      const m0 = c.get('month') ?? 1;
      const d0 = c.get('day') ?? 1;

      if (c.isCertain('day') && c.isCertain('month')) {
        let y = y0;
        if (!c.isCertain('year') && dayNum(y, m0, d0) > refN) y -= 1;
        if (dayNum(y, m0, d0) > refN) continue; // still in the future: not something that already happened
        const date = iso(y, m0, d0);
        const relativeFuzzy = /\b(?:weeks?|months?|years?)\s+ago\b/.test(lower);
        dates.push({
          start, end, hedged,
          answer: { mode: 'date', date, approximate: hedged || relativeFuzzy },
          confidence: hedgeConfidence(relativeFuzzy ? 'medium' : c.isCertain('year') || /yesterday|last night|days? ago/.test(lower) ? 'high' : 'medium', h),
          display: displayDate(date),
        });
      } else if (c.isCertain('weekday') && !c.isCertain('month')) {
        // "a friday" with no anchor: keep her words. "last friday" / "on friday": the most recent one.
        const bare = /\b(?:a|one)\s*$/i.test(before) || /^(?:a|one)\s/i.test(lower);
        if (bare) {
          const s0 = expandHedgeLeft(text, start - (before.match(/\b(?:a|one)\s*$/i)?.[0].length ?? 0), sent.start);
          const [a, b] = trimSpan(text, s0, end);
          dates.push({ start: a, end: b, hedged, answer: { mode: 'text', text: text.slice(a, b) }, confidence: hedgeConfidence('medium', h), display: text.slice(a, b) });
          continue;
        }
        let n = dayNum(y0, m0, d0);
        while (n > refN) n -= 7;
        const { y, m, d } = fromDayNum(n);
        const date = iso(y, m, d);
        dates.push({
          start, end, hedged,
          answer: { mode: 'date', date, approximate: hedged || /weekend/.test(lower) },
          confidence: hedgeConfidence('medium', h),
          display: displayDate(date),
        });
      } else {
        // Month only, or month + year, or a year: her words.
        const s0 = expandHedgeLeft(text, start, sent.start);
        const [a, b] = trimSpan(text, s0, end);
        dates.push({ start: a, end: b, hedged, answer: { mode: 'text', text: text.slice(a, b) }, confidence: hedgeConfidence('medium', h), display: text.slice(a, b) });
      }
    }
  }

  // "the 14th": a day of the month with no month. Use a month she named earlier in this piece, else the
  // nearest month in which that day has already happened. Approximate, since the month is a guess.
  ORDINAL_DAY.lastIndex = 0;
  let od: RegExpExecArray | null;
  while ((od = ORDINAL_DAY.exec(st))) {
    const s = sent.start + od.index;
    const e = s + od[0].length;
    if (dates.some((d) => s < d.end && e > d.start) || inQuote(ctx, s)) continue;
    const day = Number(od[1]);
    if (day < 1 || day > 31) continue;
    const resolved = resolveDayOfMonth(day, ctx.ref, monthNamedBefore(text, s));
    if (!resolved) continue;
    const s0 = expandHedgeLeft(text, s, sent.start);
    const [a, b] = trimSpan(text, s0, e);
    const h = hedge(text, sent, a, b);
    dates.push({
      start: a, end: b, hedged: h !== 'none',
      answer: { mode: 'date', date: resolved, approximate: true },
      confidence: hedgeConfidence('medium', h),
      display: displayDate(resolved),
    });
  }

  VAGUE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = VAGUE.exec(st))) {
    const s = sent.start + m.index;
    const e = s + m[0].length;
    if (dates.some((d) => s < d.end && e > d.start) || inQuote(ctx, s)) continue;
    const s0 = expandHedgeLeft(text, s, sent.start);
    const [a, b] = trimSpan(text, s0, e);
    const h = hedge(text, sent, a, b);
    dates.push({ start: a, end: b, hedged: h !== 'none', answer: { mode: 'text', text: text.slice(a, b) }, confidence: hedgeConfidence('medium', h), display: text.slice(a, b) });
  }

  TIME_WORDS.lastIndex = 0;
  while ((m = TIME_WORDS.exec(st))) {
    const s = sent.start + m.index;
    const e = s + m[0].length;
    if (times.some((t) => s < t.end && e > t.start) || inQuote(ctx, s)) continue;
    const s0 = expandHedgeLeft(text, s, sent.start);
    const [a, b] = trimSpan(text, s0, e);
    const h = hedge(text, sent, a, b);
    times.push({ start: a, end: b, text: text.slice(a, b), confidence: hedgeConfidence('medium', h) });
  }
  return { dates, times };
}

const STORY_TIME =
  /\b(?:the\s+)?(?:next|following)\s+(?:morning|day|night|week|afternoon|evening)\b|\bthe day after\b|\bthat (?:same )?(?:night|morning|day|weekend|week)\b|\bright (?:after|away)\b|\blater that (?:night|day|morning|week)\b|\ba (?:few |couple(?: of)? )?(?:days|weeks|months) (?:later|after)\b|\b(?:a|one|two|three|\d+) (?:days?|weeks?|months?) (?:later|after)\b/gi;

/** First date mentioned near idx (same sentence), e.g. for "went to the ER the next day". Consumes it. */
export function dateNear(ctx: Ctx, idx: number): DateHit | undefined {
  const sent = sentOf(ctx, idx);
  const { dates } = scanDates(ctx, sent);
  let d = dates.find((x) => !isConsumed(ctx, x.start, x.end));
  if (!d) {
    // Story-relative words ("the next day") are kept as her words.
    STORY_TIME.lastIndex = 0;
    const st = ctx.text.slice(sent.start, sent.end);
    let m: RegExpExecArray | null;
    while ((m = STORY_TIME.exec(st))) {
      const s = sent.start + m.index;
      const e = s + m[0].length;
      if (isConsumed(ctx, s, e)) continue;
      d = { start: s, end: e, hedged: false, answer: { mode: 'text', text: m[0] }, confidence: 'medium', display: m[0] };
      break;
    }
  }
  if (d) consume(ctx, d.start, d.end);
  return d;
}

/** Dates in this sentence belong to something else (e.g. "he showed up at my work last week"). */
export function consumeDatesIn(ctx: Ctx, sent: Sent): void {
  for (const d of scanDates(ctx, sent).dates) consume(ctx, d.start, d.end);
}

const INCIDENT_CUE =
  /\b(?:happened|it was|that night|that day|he|him|his|they|attack|assault|party|went out|hung out|came over|took me|met up|that was when)\b/i;

/** The general pass: dates and times not already explained by a more specific rule. */
export function extractDatesAndTimes(ctx: Ctx): void {
  let seenDate = 0;
  let seenTime = 0;
  for (const sent of ctx.sents) {
    const { dates, times } = scanDates(ctx, sent);
    const cue = INCIDENT_CUE.test(ctx.text.slice(sent.start, sent.end));
    for (const d of dates) {
      if (isConsumed(ctx, d.start, d.end)) continue;
      let confidence = d.confidence;
      if (!cue && seenDate > 0) confidence = confidence === 'high' ? 'medium' : 'low';
      seenDate++;
      const label =
        d.answer.mode === 'text'
          ? `You mentioned when this happened: ${quote(d.display)}.`
          : d.hedged || d.answer.approximate
            ? `It sounds like this may have happened around ${d.display}.`
            : `It sounds like this happened on ${d.display}.`;
      emit(ctx, {
        kind: 'incident_date',
        target: 'when.date',
        value: d.answer,
        confidence,
        label,
        start: d.start,
        end: d.end,
        key: d.answer.mode === 'date' ? `d:${d.answer.date}` : `t:${(d.answer.text ?? '').toLowerCase()}`,
      });
    }
    for (const t of times) {
      if (isConsumed(ctx, t.start, t.end)) continue;
      seenTime++;
      emit(ctx, {
        kind: 'incident_time',
        target: 'when.time',
        value: t.text,
        confidence: cue || seenTime === 1 ? t.confidence : t.confidence === 'high' ? 'medium' : 'low',
        label: `You mentioned the time: ${quote(t.text)}.`,
        start: t.start,
        end: t.end,
        key: t.text.toLowerCase(),
      });
    }
  }
}
