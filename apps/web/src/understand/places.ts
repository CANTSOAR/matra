/** Where it happened: her description of the place, a street or venue name, and city / state / campus. */
import { emit, group, inQuote, isConsumed, matches, sentOf, type Confidence, type Ctx } from './context';
import { hedge, hedgeConfidence, isNameToken, polarity, quote, tagsOf, trimSpan } from './text';

const PLACE = String.raw`apartment|apt|place|house|home|townhouse|condo|dorm(?: room)?|room|bedroom|basement|attic|car|truck|van|suv|backseat|back seat|office|party|frat(?: house)?|fraternity(?: house)?|sorority(?: house)?|bar|club|nightclub|hotel(?: room)?|motel|airbnb|backyard|yard|bathroom|restroom|kitchen|couch|parking lot|parking garage|garage|stairwell|hallway|elevator|park|beach|gym|locker room|studio|warehouse|restaurant|tent|cabin|boat|church|library|lab|break ?room|storage room|stockroom|supply closet|closet|event|concert|festival|wedding|bonfire|pool|lake house|cottage|shed|alley|woods|trail|dorms|suite|casa|cuarto|apartamento|carro|fiesta`;
const DET = String.raw`(?:his|her|my|their|our|a|an|the|this|that|some|[\p{L}]+['’]s|my friend['’]s|his friend['’]s|his (?:roommate|brother|parents|mom|dad)['’]s?|su|mi|la|el)`;
const STREET_SUFFIX = String.raw`st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pl|place|terrace|pkwy|parkway|hwy|highway|calle`;
const LOC_RE = new RegExp(
  String.raw`\b(?:at|in|to|into|inside|outside|behind|near|from|back to|over to|out to|en)\s+(?<ph>${DET}\s+(?:[\p{L}'’-]+\s+){0,2}?(?:${PLACE})(?:\s+(?:on|at|near|off|by)\s+(?<street>(?:\d+(?:st|nd|rd|th)?|[\p{L}'’.-]+)(?:\s+[\p{L}'’.-]+){0,2}?\s+(?:${STREET_SUFFIX})\b\.?))?)\b`,
  'giu',
);
const ADDRESS_RE = new RegExp(String.raw`\b\d{1,5}\s+(?:[NSEW]\.?\s+)?(?:[\p{L}0-9'’.-]+\s+){0,3}?(?:${STREET_SUFFIX})\b\.?`, 'giu');
const ON_STREET_RE = new RegExp(String.raw`\b(?:on|off|near)\s+(?<s>(?:\d+(?:st|nd|rd|th)|[\p{Lu}][\p{L}'’.-]*)(?:\s+[\p{Lu}][\p{L}'’.-]*)?\s+(?:${STREET_SUFFIX})\b\.?)`, 'giu');
const VENUE_RE =
  /\bat\s+(?<v>(?:the\s+)?(?:[\p{Lu}][\p{L}'’&-]*\s+){1,3}(?:Bar|Pub|Tavern|Lounge|Club|Hotel|Inn|Motel|Grill|Cafe|Café|Restaurant|Diner|Hall|House|Arena|Stadium|Brewery))\b/gu;

const NOT_INCIDENT = /\b(?:after(?:wards?)?|later|went home|got home|drove home|walked home|the next|i told|i texted|i called|now|these days|moved)\b/i;
const INCIDENT = /\b(?:happened|it was (?:at|in)|that['’]s where|he|him|his|took me|brought me|drove me|walked me|invited me|pushed|grabbed|pinned|kissed|touched|forced|locked|choked)\b/i;

/** A place that says little on its own ("a party", "the bar") — a more specific place nearby wins. */
const GENERIC_PLACE =
  /^(?:a|an|the|some|this|that)\s+(?:[\p{Ll}-]+\s+){0,2}?(?:party|frat party|house party|bar|club|nightclub|event|concert|festival|wedding|bonfire|restaurant|hotel|motel|place|room)$/u;

interface PlaceHit {
  s: number;
  e: number;
  sentStart: number;
  confidence: Confidence;
  generic: boolean;
  street?: [number, number];
}

function locations(ctx: Ctx): void {
  const t = ctx.text;
  const hits: PlaceHit[] = [];
  for (const m of matches(ctx, LOC_RE)) {
    const ph = group(m, 'ph')!;
    if (isConsumed(ctx, ph[0], ph[1]) || inQuote(ctx, ph[0])) continue;
    const sent = sentOf(ctx, m.index);
    if (polarity(t, sent, m.index) === 'neg') continue;
    const phrase = t.slice(ph[0], ph[1]);
    // "in the room" / "at home" alone say very little; "my place" after the fact is usually not where it happened.
    if (/^(?:the|a|this|that)\s+(?:(?:other|next|same|living)\s+)?(?:room|place|event|home)$/i.test(phrase)) continue;
    const st = t.slice(sent.start, sent.end);
    let confidence: Confidence = 'medium';
    if (NOT_INCIDENT.test(t.slice(sent.start, m.index))) confidence = 'low';
    else if (/\bhappened\b|\bit was (?:at|in)\b|that['’]s where/i.test(st) || (INCIDENT.test(st) && /^(?:his|their|her)\b/i.test(phrase))) confidence = 'high';
    confidence = hedgeConfidence(confidence, hedge(t, sent, ph[0], ph[1]));
    hits.push({ s: ph[0], e: ph[1], sentStart: sent.start, confidence, generic: GENERIC_PLACE.test(phrase), street: group(m, 'street') });
  }
  // "a party at my coworker's apartment" is one place: join a generic place to the specific one it is at.
  const RANK = { high: 3, medium: 2, low: 1 } as const;
  const places: PlaceHit[] = [];
  for (const h of hits) {
    const prev = places[places.length - 1];
    if (prev && prev.generic && !h.generic && prev.sentStart === h.sentStart && /^\s+(?:at|in|on|inside)\s+$/i.test(t.slice(prev.e, h.s))) {
      places[places.length - 1] = { ...h, s: prev.s, confidence: RANK[prev.confidence] > RANK[h.confidence] ? prev.confidence : h.confidence };
    } else places.push(h);
  }
  for (const h of places) {
    // A generic place is still offered — unless a more specific place is in the same sentence.
    if (h.generic && places.some((o) => o !== h && !o.generic && o.sentStart === h.sentStart)) continue;
    const phrase = t.slice(h.s, h.e);
    emit(ctx, {
      kind: 'location', target: 'where.place', value: phrase, confidence: h.confidence,
      label: `You mentioned a place: ${quote(phrase)}.`, start: h.s, end: h.e, key: phrase.toLowerCase().replace(/\s+/g, ' '),
    });
    if (h.street) emitAddress(ctx, h.street[0], h.street[1], 'medium');
  }
  for (const m of matches(ctx, ADDRESS_RE)) emitAddress(ctx, m.index, m.index + m[0].length, 'high');
  for (const m of matches(ctx, ON_STREET_RE)) {
    const g = group(m, 's')!;
    emitAddress(ctx, g[0], g[1], 'medium');
  }
  for (const m of matches(ctx, /\b(?:bar|club|restaurant|place|hotel|lounge|pub|venue|spot)\s+(?:called|named)\s+(?<v>(?:[Tt]he\s+)?(?:[\p{Lu}0-9][\p{L}0-9'’&-]*)(?:\s+[\p{Lu}0-9][\p{L}0-9'’&-]*){0,3})/gu)) {
    const g = group(m, 'v')!;
    emitAddress(ctx, g[0], g[1], 'medium', true);
  }
  for (const m of matches(ctx, VENUE_RE)) {
    const g = group(m, 'v')!;
    emitAddress(ctx, g[0], g[1], 'medium', true);
  }
}

function emitAddress(ctx: Ctx, s: number, e: number, confidence: Confidence, venue = false): void {
  const t = ctx.text;
  [s, e] = trimSpan(t, s, e);
  if (e <= s || isConsumed(ctx, s, e) || inQuote(ctx, s)) return;
  const words = t.slice(s, e);
  // "2 drinks" etc. never reach here (needs a street suffix); "1 way" / "the way" are too vague.
  if (/^\d+\s+(?:way|place|court)$/i.test(words) || /^(?:the|a|my)\s+way$/i.test(words)) return;
  const sent = sentOf(ctx, s);
  emit(ctx, {
    kind: 'location', target: 'where.address', value: words, confidence: hedgeConfidence(confidence, hedge(t, sent, s, e)),
    label: venue ? `You mentioned the name of a place: ${quote(words)}.` : `It sounds like the street or address might be ${quote(words)}.`,
    start: s, end: e, key: words.toLowerCase().replace(/\.$/, ''),
  });
}

// ─────────────── jurisdiction ───────────────

const STATES: Array<[string, string]> = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'],
  ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'],
  ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'],
  ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'],
  ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'],
  ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'],
  ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'],
  ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'], ['PR', 'Puerto Rico'],
];
const NAME_TO_CODE = new Map(STATES.map(([c, n]) => [n.toLowerCase(), c]));
const CODE_TO_NAME = new Map(STATES);
const STATE_NAMES = STATES.map(([, n]) => n.replace(/ /g, '\\s+')).sort((a, b) => b.length - a.length).join('|');
const UPPER_CODES = STATES.map(([c]) => c).join('|');
/** Lowercase two-letter codes that are rarely ordinary words. */
const LOWER_CODES = 'nj|ny|tx|fl|nc|nh|nv|az|tn|ks|wv|vt|wy|sd|dc|pa|ca|il|ct|ri|sc|va|wa|md|ky';

function codeOf(s: string): string | undefined {
  const k = s.replace(/\s+/g, ' ').trim();
  if (/^[A-Za-z]{2}$/.test(k)) return CODE_TO_NAME.has(k.toUpperCase()) ? k.toUpperCase() : undefined;
  return NAME_TO_CODE.get(k.toLowerCase());
}

function stateName(code: string): string {
  return CODE_TO_NAME.get(code) ?? code;
}

const CITY_STATE_RE = new RegExp(
  String.raw`\b(?<city>(?:[\p{Lu}][\p{L}.'’-]+\s+){0,2}[\p{Lu}][\p{L}.'’-]+),?\s+(?<st>${UPPER_CODES}|${STATE_NAMES})\b`,
  'gu',
);
const CITY_STATE_LOWER_RE = new RegExp(
  String.raw`\b(?:in|from|near|outside(?: of)?|around)\s+(?<city>[\p{Ll}]+(?:\s+[\p{Ll}]+){0,2}?),?\s+(?<st>${LOWER_CODES}|${STATE_NAMES.toLowerCase()})\b`,
  'gu',
);
const STATE_ALONE_RE = new RegExp(String.raw`\b(?:in|from|to|near|outside(?: of)?|back in|en)\s+(?<st>${STATE_NAMES})\b`, 'giu');
const CITY_ALONE_RE = /\b(?:in|near|outside(?: of)?|downtown)\s+(?<city>[\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+)?)/gu;
const CAMPUS_RE =
  /\b(?<c>(?:[\p{Lu}][\p{L}&'’.-]*\s+){1,4}(?:University|College|Institute|Academy)|University\s+of(?:\s+[\p{Lu}][\p{L}'’.-]*){1,3}|[\p{Lu}][\p{L}&'’.-]*\s+Community\s+College)\b/gu;
const CAMPUS_ABBR_RE = /\b(?<c>[A-Z]{2,6})\s+(?:campus|dorms?|frat|library|quad)\b/g;

const CITY_STOP = new Set('my his her the a an our their this that party bar club car room house apartment back town'.split(' '));

function jurisdiction(ctx: Ctx): void {
  const t = ctx.text;
  const seen: Array<[number, number]> = [];
  const push = (s: number, e: number, value: Record<string, string>, confidence: Confidence) => {
    if (seen.some(([a, b]) => s < b && e > a) || inQuote(ctx, s)) return;
    seen.push([s, e]);
    const parts = [value.city, value.state ? stateName(value.state) : undefined].filter(Boolean).join(', ');
    emit(ctx, {
      kind: 'jurisdiction', target: 'where.area', value, confidence,
      label: value.campus && !parts ? `It sounds like this may be connected to ${value.campus}.` : `It sounds like this was in ${parts}${value.campus ? ` (${value.campus})` : ''}.`,
      start: s, end: e, key: JSON.stringify(value).toLowerCase(),
    });
  };
  for (const m of matches(ctx, CITY_STATE_RE)) {
    const cg = group(m, 'city')!;
    const sg = group(m, 'st')!;
    let city = t.slice(cg[0], cg[1]);
    // Drop leading words that aren't part of the city ("Then Newark, NJ").
    const words = city.split(/\s+/);
    while (words.length > 1 && (tagsOf(words[0].toLowerCase()).has('Verb') || CITY_STOP.has(words[0].toLowerCase()) || /^(?:In|At|From|Near|We|I|He|She|It|Then|And|But)$/.test(words[0]))) words.shift();
    city = words.join(' ');
    const code = codeOf(t.slice(sg[0], sg[1]));
    if (!code || CITY_STOP.has(city.toLowerCase()) || /^(?:I|He|She|We|It|They)$/.test(city)) continue;
    const cs = cg[1] - city.length;
    push(cs, sg[1], { city, state: code }, 'high');
  }
  for (const m of matches(ctx, CITY_STATE_LOWER_RE)) {
    const cg = group(m, 'city')!;
    const sg = group(m, 'st')!;
    const city = t.slice(cg[0], cg[1]);
    if (city.split(/\s+/).some((w) => CITY_STOP.has(w))) continue;
    const code = codeOf(t.slice(sg[0], sg[1]));
    if (!code) continue;
    push(cg[0], sg[1], { city, state: code }, 'medium');
  }
  for (const m of matches(ctx, STATE_ALONE_RE)) {
    const sg = group(m, 'st')!;
    const code = codeOf(t.slice(sg[0], sg[1]));
    if (code) push(sg[0], sg[1], { state: code }, 'medium');
  }
  for (const m of matches(ctx, CITY_ALONE_RE)) {
    const cg = group(m, 'city')!;
    const city = t.slice(cg[0], cg[1]);
    const first = city.split(/\s+/)[0].toLowerCase();
    if (codeOf(city) || CITY_STOP.has(first)) continue;
    const tags = tagsOf(city.toLowerCase());
    if (!(tags.has('Place') || tags.has('City')) || isNameToken(city)) continue;
    push(cg[0], cg[1], { city }, 'low');
  }
  for (const re of [CAMPUS_RE, CAMPUS_ABBR_RE]) {
    for (const m of matches(ctx, re)) {
      const g = group(m, 'c')!;
      const campus = t.slice(g[0], g[1]).replace(/^(?:At|In|From|The|On)\s+/, '');
      if (/^(?:ER|SANE|RA|HR|ID|OK|TV|LOL|OMG|IDK|NJ|NY|USA)$/.test(campus)) continue;
      push(g[1] - campus.length, g[1], { campus }, re === CAMPUS_RE ? 'medium' : 'low');
    }
  }
}

export function extractPlaces(ctx: Ctx): void {
  locations(ctx);
  jurisdiction(ctx);
}

