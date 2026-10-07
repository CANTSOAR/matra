/**
 * People: who she told (disclosures), who was there (witnesses), the person responsible
 * (name, relationship, identifiers). She ("I", "me") is never treated as a person here.
 */
import { consume, emit, group, inQuote, isConsumed, matches, sentOf, type Confidence, type Ctx } from './context';
import { scanDates } from './dates';
import { clauseEnd, clauseStart, hedge, hedgeConfidence, isNameToken, polarity, quote, readName, toSecondPerson, trimSpan, wordsBefore } from './text';

const FAMILY = String.raw`best friend|bestie|bff|friends?|mom|mother|mama|mommy|dad|father|papa|step-?mom|step-?dad|sister|sis|brother|roommates?|roomie|housemates?|suitemates?|boyfriend|bf|girlfriend|gf|partner|husband|wife|fianc[eé]e?|therapist|counselor|counsellor|ra|r\.a\.|aunt|auntie|uncle|cousin|grandma|grandmother|grandpa|coworker|co-worker|boss|manager|teacher|professor|coach|advocate|pastor|priest|doctor|nurse|neighbou?r|teammate|classmate|mentor|supervisor|sorority sisters?|hermana|mam[aá]|madre|amiga|amigo|novi[oa]|prim[oa]|t[ií]a`;

const PERP_REL = String.raw`ex[- ]?boyfriend|ex[- ]?bf|ex[- ]?husband|ex[- ]?partner|ex[- ]?girlfriend|ex[- ]?wife|ex|co-?workers?|co worker|colleague|boss|manager|supervisor|boyfriend|bf|husband|partner|fianc[eé]|(?:tinder |hinge |bumble )?date|match|classmate|lab partner|professor|prof|teacher|ta|tutor|coach|trainer|neighbou?r|landlord|uncle|step-?dad|step-?father|step-?brother|cousin|brother-in-law|friend['’]s (?:brother|boyfriend|cousin|roommate|dad|husband|ex)|roommate['’]s (?:boyfriend|friend|brother)|best friend|friend|roommate|housemate|teammate|youth pastor|pastor|priest|doctor|therapist|instructor|mentor|client|customer|(?:uber |lyft )?driver|bouncer|security guard|compa[nñ]ero de trabajo|jefe|ex novio|novio|vecino|primo|t[ií]o`;

/** Relationships that strongly suggest the person responsible when he/him appears nearby. */
const STRONG_PERP = /^(?:ex.*|co-?workers?|co worker|colleague|boss|manager|supervisor|professor|prof|coach|landlord|step.*|uncle|(?:tinder |hinge |bumble )?date|match|tutor|trainer|instructor|youth pastor|pastor|priest|.*driver|compa.*|jefe|ex novio)$/i;
const NOT_KNOWN_BEFORE = /^(?:.*driver|bouncer|security guard|match|(?:tinder |hinge |bumble )?date)$/i;

const HARM = String.raw`push(?:ed|es)?|shoved|grabbed|pinned|held me|forced|choked|strangled|hit me|slapped|punched|kissed me|touched|groped|raped|assaulted|attacked|followed me|cornered me|wouldn['’]?t (?:stop|let|leave|take no)|kept (?:touching|pushing|grabbing|trying|giving me)|pulled (?:down|off|my)|took off my|undressed me|put his|got on top|climbed on|drugged|spiked|threatened|filmed me|recorded me|locked the door|came into my room|walked me|took me|drove me|bought me|gave me (?:a |another )?drinks?|made me|tried to|started (?:touching|kissing|taking)|was on top|invited me|offered me|me (?:empuj|agarr|forz|ahorc|toc|viol)[oó]`;
const HARM_AFTER = new RegExp(String.raw`^\s*(?:,\s*)?(?:who\s+|he\s+|just\s+|then\s+|basically\s+|literally\s+|kind of\s+|kinda\s+)*(?:${HARM})`, 'i');

const RECIPIENT_STOP = /^(?:him|her|them|me|myself|anyone|anybody|everyone|everybody|someone|somebody|no one|nobody|police|cops|hr|title|the|a|an|it|that|this|what|how|he|she|they|you)$/i;

// ─────────────── disclosures ───────────────

const TELL_RE =
  /\b(?<verb>told|texted|called|messaged|dm['’]?e?d|facetimed|snapchatted|emailed|talked to|spoke to|spoke with|confided in|opened up to|le cont[eé] a|le dije a|les cont[eé] a)\s+/gi;
const RECIP_RE = new RegExp(String.raw`^(?<rel>(?:my|our|mi|mis)\s+(?:${FAMILY}))\b`, 'i');
const WHEN_RE =
  /\b(?:the\s+)?(?:next|following)\s+(?:morning|day|night|week|afternoon|evening)|\bthe day after\b|\bthat (?:same )?(?:night|morning|day|weekend|week)\b|\bright (?:after|away)\b|\blater that (?:night|day|morning|week)\b|\ba (?:few |couple(?: of)? )?(?:days|weeks|months|years) (?:later|after)\b|\b(?:a|one|two|three|four|five|six|\d+) (?:days?|weeks?|months?|years?) (?:later|after|ago)\b|\b(?:last|this past) (?:week|month|year|night|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\byesterday\b|\bwhen i got home\b|\bas soon as i got home\b|\b(?:on|that) (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?: morning| night| afternoon)?\b/gi;

function method(verb: string): string | undefined {
  const v = verb.toLowerCase();
  if (/^texted|^messaged/.test(v)) return 'text';
  if (/^called|^facetimed/.test(v)) return 'phone';
  if (/^dm|^snapchatted/.test(v)) return 'social_media';
  if (/^emailed/.test(v)) return 'email';
  return undefined;
}

const METHOD_WORDS: Record<string, string> = { text: 'by text', phone: 'by phone', social_media: 'by message', email: 'by email' };

function disclosures(ctx: Ctx): void {
  const t = ctx.text;
  for (const m of matches(ctx, TELL_RE)) {
    const sent = sentOf(ctx, m.index);
    const after = m.index + m[0].length;
    const before = wordsBefore(t, sent, m.index, 3);
    if (/\b(?:he|she|they|him|his|it)\s*$/i.test(before) && !/\bi\b/i.test(before)) continue; // "he texted my roommate"
    if (/\b(?:my|his|her)\s+[\p{L}]+\s*$/iu.test(before) && !/\bi\b/i.test(before)) continue; // "my friend called her mom"
    if (inQuote(ctx, m.index)) continue;
    let ws: number;
    let we: number;
    let rel: string | undefined;
    let name: string | undefined;
    const rm = RECIP_RE.exec(t.slice(after, after + 60));
    if (rm) {
      ws = after;
      we = after + rm[0].length;
      rel = rm.groups!.rel;
      const nm = /^\s+/.exec(t.slice(we, we + 3)) ? readName(t, we + 1) : undefined;
      if (nm && !/^['’]s/.test(t.slice(nm[1], nm[1] + 2))) {
        name = t.slice(nm[0], nm[1]);
        we = nm[1];
      }
      if (/^['’]s\b/.test(t.slice(we, we + 3))) continue; // "called my mom's phone"
    } else {
      const word = /^[\p{L}][\p{L}'’.-]*/u.exec(t.slice(after, after + 30))?.[0] ?? '';
      if (!word || RECIPIENT_STOP.test(word)) continue;
      const nm = readName(t, after);
      if (!nm) continue;
      ws = nm[0];
      we = nm[1];
      name = t.slice(ws, we);
    }
    if (polarity(t, sent, m.index) === 'neg') {
      consume(ctx, m.index, we);
      continue;
    }
    const toWhom = t.slice(ws, we);
    const meth = method(m.groups!.verb);
    // When she told them: nearest time phrase in the sentence.
    let when: [number, number] | undefined;
    WHEN_RE.lastIndex = 0;
    const st = t.slice(sent.start, sent.end);
    let wm: RegExpExecArray | null;
    let best = Infinity;
    while ((wm = WHEN_RE.exec(st))) {
      const s = sent.start + wm.index;
      const dist = Math.min(Math.abs(s - we), Math.abs(s + wm[0].length - m.index));
      if (dist < best && dist < 60) {
        best = dist;
        when = [s, s + wm[0].length];
      }
    }
    if (!when) {
      const d = scanDates(ctx, sent).dates.find((x) => Math.abs(x.start - we) < 40 && !isConsumed(ctx, x.start, x.end));
      if (d) when = [d.start, d.end];
    }
    const value: Record<string, string> = { toWhom };
    if (when) {
      value.when = t.slice(when[0], when[1]);
      consume(ctx, when[0], when[1]);
    }
    if (meth) value.method = meth;
    consume(ctx, m.index, we);
    const whoWords = rel ?? name ?? toWhom;
    const bits = [(/^(?:mi|mis)\s/i.test(whoWords) ? quote(whoWords) : toSecondPerson(whoWords)) + (rel && name ? ` (${name})` : '')];
    if (meth) bits.push(METHOD_WORDS[meth]);
    if (value.when) bits.push(toSecondPerson(value.when));
    emit(ctx, {
      kind: 'disclosure', target: 'people.told', value, confidence: hedgeConfidence(rel ? 'high' : 'medium', hedge(t, sent, m.index, we)),
      label: `It sounds like you told ${bits.join(', ')}.`, start: ws, end: we, key: toWhom.toLowerCase(),
    });
  }
}

// ─────────────── witnesses ───────────────

const WITNESS_NOUNS = String.raw`${FAMILY}|bartender|bouncer|(?:uber |lyft )?driver|security guard|host|frat brothers?|other guys?|guys|girls|people|roommates?`;
const WITNESS_PRED = String.raw`(?:(?:was|were)\s+(?:also\s+|still\s+|just\s+)?(?:there|home|right there|in the (?:next|other|same|living) room|in the room|downstairs|upstairs|outside|in the hall(?:way)?|at the party|with us|awake|asleep in)|saw|heard|watched|walked in|came in|found me|picked me up|drove me home|took me home|walked me home|helped me|witnessed|knocked on|can (?:confirm|back me up)|me vio|me encontr[oó])`;
const WITNESS_RE = new RegExp(
  String.raw`(?:(?<who>(?:my|his|her|our|the|a|an|this|some|mi)\s+(?:${WITNESS_NOUNS})|(?:everyone|people|a lot of people|some people|a few people|others)(?:\s+at\s+the\s+[\p{L}]+)?)(?:\s+(?<nm>[\p{L}][\p{L}'’-]*))?|(?<nm2>[\p{L}][\p{L}'’-]+))\s+${WITNESS_PRED}\b`,
  'giu',
);

function witnesses(ctx: Ctx): void {
  const t = ctx.text;
  for (const m of matches(ctx, WITNESS_RE)) {
    const sent = sentOf(ctx, m.index);
    const whoG = group(m, 'who');
    const nmG = group(m, 'nm') ?? group(m, 'nm2');
    let name: string | undefined;
    let relationship: string | undefined;
    let ws = m.index;
    let we = m.index;
    if (nmG) {
      const raw = t.slice(nmG[0], nmG[1]);
      // "my roommate was" → nm absent; "my friend Sarah saw" → nm = Sarah; bare "sarah saw" → nm2.
      if (isNameToken(raw)) {
        name = raw;
        we = nmG[1];
      } else if (!whoG) continue;
    }
    if (whoG) {
      relationship = t.slice(whoG[0], whoG[1]);
      ws = whoG[0];
      if (we < whoG[1]) we = whoG[1];
    } else ws = nmG![0];
    if (!name && !relationship) continue;
    if (inQuote(ctx, ws) || isConsumed(ctx, ws, we)) continue;
    if (polarity(t, sent, ws) === 'neg') continue;
    // "the guy at the party saw me" is not a witness if it's him; skip relationships that are the person responsible.
    if (relationship && /\b(?:guy|man|dude)\b/i.test(relationship)) continue;
    const [a, b] = trimSpan(t, clauseStart(t, sent, ws), clauseEnd(t, sent, m.index + m[0].length));
    const value: Record<string, string> = {};
    if (name) value.name = name;
    if (relationship) value.relationship = relationship;
    if (b > a) value.whatTheyKnow = t.slice(a, b);
    consume(ctx, ws, Math.max(we, m.index + m[0].length));
    const who = relationship ? toSecondPerson(relationship) + (name ? ` ${name}` : '') : name!;
    emit(ctx, {
      kind: 'witness', target: 'people.witnesses', value, confidence: hedgeConfidence('medium', hedge(t, sent, ws, we)),
      label: `It sounds like ${who} may have seen or heard something, or was nearby.`,
      start: ws, end: we, key: (name ?? relationship ?? '').toLowerCase(),
    });
  }
}

/** People she was with, or found right after: "I went with my friend Dana", "I found Dana in the kitchen". */
const COMPANION_RE = new RegExp(
  String.raw`\b(?:(?:went|came|was|were|got there|showed up|arrived)\s+(?:there\s+)?with|found|ran to|went to find)\s+(?:(?<who>my\s+(?:${FAMILY}))\b(?:,?\s+(?<nm>[\p{L}][\p{L}'’-]*))?|(?<nm2>[\p{L}][\p{L}'’-]*))`,
  'giu',
);

function companions(ctx: Ctx): void {
  const t = ctx.text;
  for (const m of matches(ctx, COMPANION_RE)) {
    const whoG = group(m, 'who');
    const nmG = group(m, 'nm') ?? group(m, 'nm2');
    let name: string | undefined;
    if (nmG) {
      const nm = readName(t, nmG[0]);
      if (nm && nm[1] === nmG[1]) name = t.slice(nm[0], nm[1]);
    }
    if (!whoG && !name) continue;
    const ws = whoG ? whoG[0] : nmG![0];
    const we = name ? nmG![1] : whoG![1];
    if (isConsumed(ctx, ws, we) || inQuote(ctx, ws)) continue;
    const sent = sentOf(ctx, m.index);
    if (polarity(t, sent, m.index) === 'neg') continue;
    const value: Record<string, string> = {};
    if (name) value.name = name;
    if (whoG) value.relationship = t.slice(whoG[0], whoG[1]);
    const [a, b] = trimSpan(t, clauseStart(t, sent, m.index), clauseEnd(t, sent, we));
    if (b > a) value.whatTheyKnow = t.slice(a, b);
    consume(ctx, ws, we);
    const who = whoG ? toSecondPerson(t.slice(whoG[0], whoG[1])) + (name ? ` ${name}` : '') : name!;
    emit(ctx, {
      kind: 'witness', target: 'people.witnesses', value, confidence: 'low',
      label: `You mentioned ${who}. They may have seen you before or after, which can matter.`,
      start: ws, end: we, key: (name ?? value.relationship ?? '').toLowerCase(),
    });
  }
}

// ─────────────── the person responsible ───────────────

function emitName(ctx: Ctx, s: number, e: number, confidence: Confidence, known?: string): void {
  const name = ctx.text.slice(s, e);
  const value: Record<string, string> = { name };
  if (known) value.known = known;
  consume(ctx, s, e);
  emit(ctx, {
    kind: 'person_responsible', target: 'person.list', value, confidence,
    label: `It sounds like the person who did this goes by ${quote(name)}.`, start: s, end: e, key: name.toLowerCase().replace(/\.$/, ''),
  });
}

function emitRelationship(ctx: Ctx, s: number, e: number, rel: string, confidence: Confidence, known?: string, label?: string): void {
  const value: Record<string, string> = { relationship: rel };
  if (known) value.known = known;
  emit(ctx, {
    kind: 'relationship', target: 'person.list', value, confidence,
    label: label ??
      (known === 'no' && !/\bmy\b/i.test(rel)
        ? `It sounds like you didn’t know the person before (${quote(rel)}).`
        : /^(?:my|our)\s/i.test(rel)
          ? `It sounds like the person who did this is ${toSecondPerson(rel)}.`
          : `You mentioned how you know the person who did this: ${quote(rel)}.`),
    start: s, end: e, key: rel.toLowerCase().replace(/^(?:my|our|a|an|the)\s+/, ''),
  });
}

const HE = /\b(?:he|him|his|he['’]?s|he['’]?d)\b/i;

function personResponsible(ctx: Ctx): void {
  const t = ctx.text;
  const mentionsHim = HE.test(t);

  // "his name was Marcus", "a guy named Marcus", "my coworker named R"
  for (const m of matches(ctx, /\b(?:his name (?:is|was)|(?:named|called|who (?:went|goes) by)|se llama|se llamaba)\s+/gi)) {
    if (inQuote(ctx, m.index)) continue;
    const nm = readName(t, m.index + m[0].length);
    if (!nm || isConsumed(ctx, nm[0], nm[1])) continue;
    const before = t.slice(Math.max(0, m.index - 40), m.index);
    if (/\b(?:my|our)\s+(?:mom|sister|friend|roommate|girlfriend|therapist)\s*$/i.test(before)) continue;
    emitName(ctx, nm[0], nm[1], 'high');
  }

  // "my coworker R", "my ex", "it was my professor"
  const relRe = new RegExp(String.raw`\b(?<det>my|our|mi)\s+(?<rel>${PERP_REL})\b(?!['’]s)`, 'giu');
  for (const m of matches(ctx, relRe)) {
    const rg = group(m, 'rel')!;
    const s = m.index;
    let e = rg[1];
    if (isConsumed(ctx, s, e) || inQuote(ctx, s)) continue;
    const sent = sentOf(ctx, s);
    const relWord = t.slice(rg[0], rg[1]);
    let nameSpan: [number, number] | undefined;
    const sp = /^(?:\s*,\s*|\s+)/.exec(t.slice(e, e + 4));
    if (sp) {
      const nm = readName(t, e + sp[0].length);
      if (nm && !/^['’]s/.test(t.slice(nm[1], nm[1] + 2))) {
        // Lowercase non-name words were filtered by readName; a bare lowercase word must be a known first name.
        nameSpan = nm;
      }
    }
    const tailStart = nameSpan ? nameSpan[1] : e;
    const harmAfter = HARM_AFTER.test(t.slice(tailStart, tailStart + 80));
    const statement = /\b(?:it was|it['’]s|that was|he was|he['’]?s|he is|was with|with|by|from)\s*$/i.test(t.slice(Math.max(sent.start, s - 14), s));
    const strong = STRONG_PERP.test(relWord);
    let confidence: Confidence | undefined;
    if (harmAfter || /\b(?:it was|he was|he['’]?s|he is)\s*$/i.test(t.slice(Math.max(sent.start, s - 10), s))) confidence = 'high';
    else if (nameSpan && mentionsHim && strong) confidence = 'medium';
    else if (statement && mentionsHim && strong) confidence = 'medium';
    else if (strong && mentionsHim && HE.test(t.slice(sent.start, sent.end))) confidence = 'low';
    if (!confidence) continue;
    if (polarity(t, sent, s) === 'neg' && !harmAfter) continue;
    const rel = t.slice(s, e);
    const known = NOT_KNOWN_BEFORE.test(relWord) ? undefined : 'yes';
    if (nameSpan) {
      emitName(ctx, nameSpan[0], nameSpan[1], confidence, known);
      e = nameSpan[1];
    }
    emitRelationship(ctx, s, rg[1], rel, confidence, known);
    consume(ctx, s, e);
  }

  // "a party at my coworker's apartment": the person whose place it was may be the person she is describing.
  // Offered gently (low confidence), and only when the story talks about "him".
  const hostRe = new RegExp(
    String.raw`\b(?<det>my|our|a|an)\s+(?<rel>${PERP_REL})['’]s\s+(?:apartment|apt|place|house|home|room|dorm(?: room)?|party|car|office|condo|cabin|backyard)\b`,
    'giu',
  );
  for (const m of matches(ctx, hostRe)) {
    const rg = group(m, 'rel')!;
    if (!mentionsHim || inQuote(ctx, m.index) || isConsumed(ctx, m.index, rg[1])) continue;
    if (!STRONG_PERP.test(t.slice(rg[0], rg[1]))) continue;
    if (polarity(t, sentOf(ctx, m.index), m.index) === 'neg') continue;
    const rel = t.slice(m.index, rg[1]);
    emitRelationship(
      ctx, m.index, rg[1], rel, 'low', 'yes',
      `You mentioned ${toSecondPerson(rel)}. If that’s the person who did this, you can keep it here.`,
    );
  }

  // A name right before a harm verb: "Jake pushed me", "R kept giving me drinks".
  for (const m of matches(ctx, new RegExp(String.raw`(?<![\p{L}'’])(?<nm>[\p{L}][\p{L}'’-]*\.?)\s+(?:${HARM})`, 'giu'))) {
    const g = group(m, 'nm')!;
    if (isConsumed(ctx, g[0], g[1]) || inQuote(ctx, g[0])) continue;
    const nm = readName(t, g[0]);
    if (!nm || nm[1] !== g[1]) continue;
    const sent = sentOf(ctx, g[0]);
    if (/\b(?:my|our|his|her|the)\s*$/i.test(t.slice(Math.max(sent.start, g[0] - 6), g[0]))) continue;
    if (polarity(t, sent, g[0]) === 'neg') continue;
    emitName(ctx, nm[0], nm[1], 'medium');
  }

  // "Jake from my class", "someone from work"
  for (const m of matches(ctx, /\b(?<who>someone|a guy|this guy|a man|(?<nm>[\p{L}][\p{L}'’-]*))\s+from\s+(?<from>(?:my\s+|his\s+|the\s+)?(?:work|job|class|school|church|the gym|gym|building|team|frat|office|dorm|program|lab))\b/giu)) {
    const nmG = group(m, 'nm');
    const fromG = group(m, 'from')!;
    if (isConsumed(ctx, m.index, fromG[1]) || inQuote(ctx, m.index)) continue;
    const sent = sentOf(ctx, m.index);
    if (polarity(t, sent, m.index) === 'neg') continue;
    if (nmG) {
      const nm = readName(t, nmG[0]);
      if (!nm || nm[1] !== nmG[1] || !mentionsHim) continue;
      emitName(ctx, nm[0], nm[1], 'medium', 'yes');
    } else if (!mentionsHim) continue;
    emitRelationship(ctx, m.index, fromG[1], t.slice(nmG ? nmG[1] + 1 : m.index, fromG[1]), 'medium', 'yes');
    consume(ctx, m.index, fromG[1]);
  }

  // "he's in my statistics class", "we matched on hinge"
  for (const m of matches(ctx, /\b(?:he|he['’]s|he is|he was)\s+(?:is\s+|was\s+)?(?<rel>(?:in|from|on)\s+my\s+(?:[\p{L}]+\s+){0,2}?(?:class|team|program|dorm|building|lab|office|department|floor|section|team))\b|\b(?<rel2>(?:we\s+)?(?:matched|met)(?:\s+(?:him|up))?\s+on\s+(?:tinder|hinge|bumble|grindr|instagram|snapchat|a dating app|an app|the app|feeld|raya|okcupid))\b/giu)) {
    const g = group(m, 'rel') ?? group(m, 'rel2')!;
    if (inQuote(ctx, g[0]) || isConsumed(ctx, g[0], g[1])) continue;
    if (polarity(t, sentOf(ctx, m.index), m.index) === 'neg') continue;
    const rel = t.slice(g[0], g[1]).replace(/^we\s+/i, '');
    emitRelationship(ctx, g[1] - rel.length, g[1], rel, 'medium', /matched|met/i.test(rel) ? undefined : 'yes');
  }

  // Someone she didn't know.
  const strangerRe =
    /\b(?:a|an|some|this)\s+(?:random\s+|older\s+|young\s+)?(?:guy|man|dude|person|stranger)\s+(?:(?:i|that i|who i)\s+(?:had\s+)?(?:just\s+|only\s+)?(?:met|didn['’]?t know|did not know|never met|had never (?:met|seen)|don['’]?t know|barely knew))(?:\s+(?:at|on|from)\s+(?:the|a|this)\s+[\p{L}]+)?|\b(?:a|some)\s+(?:random\s+)?stranger\b|\bi\s+(?:didn['’]?t|did not|don['’]?t)\s+know\s+him\b|\bi\s+(?:had\s+|['’]d\s+)?never\s+(?:met|seen)\s+him\b|\bun desconocido\b/giu;
  for (const m of matches(ctx, strangerRe)) {
    if (inQuote(ctx, m.index)) continue;
    const phrase = m[0];
    const isPhrase = !/^\s*i\s/i.test(phrase);
    emitRelationship(ctx, m.index, m.index + phrase.length, isPhrase ? phrase : 'someone I didn’t know', isPhrase ? 'high' : 'medium', 'no');
  }
}

// ─────────────── identifiers ───────────────

const PLATFORMS: Array<[RegExp, string]> = [
  [/\b(?:insta(?:gram)?|ig)\b/i, 'instagram'],
  [/\bsnap(?:chat)?\b/i, 'snapchat'],
  [/\btik ?tok\b/i, 'tiktok'],
  [/\b(?:facebook|fb|messenger)\b/i, 'facebook'],
  [/\b(?:twitter|on x)\b/i, 'x'],
  [/\bdiscord\b/i, 'discord'],
  [/\bwhats ?app\b/i, 'whatsapp'],
  [/\btelegram\b/i, 'telegram'],
  [/\blinked ?in\b/i, 'linkedin'],
  [/\b(?:tinder|hinge|bumble|grindr|dating app|okcupid|feeld|raya)\b/i, 'dating_app'],
];

function platformNear(t: string, a: number, b: number): string | undefined {
  const win = t.slice(Math.max(0, a - 60), Math.min(t.length, b + 40));
  let best: string | undefined;
  let bestDist = Infinity;
  for (const [re, p] of PLATFORMS) {
    const g = new RegExp(re.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = g.exec(win))) {
      const pos = Math.max(0, a - 60) + m.index;
      const d = Math.abs(pos - a);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
  }
  return best;
}

const OWN = /\b(?:my|our)\s+(?:(?:new|old|work|cell|personal)\s+)?(?:number|phone|cell|email|e-mail|insta|ig|snap|handle|account|username|address)\s*(?:is|was|:)?\s*$/i;
const OTHER_OWNER = /\b(?:my|our)\s+(?:mom|mother|dad|sister|brother|friend|roommate|therapist|lawyer|advocate)['’]s\s+(?:\w+\s+)?$/i;
const HIS = /\b(?:his|him|he|he['’]s|their)\b/i;

function identifier(ctx: Ctx, s: number, e: number, value: Record<string, string>, what: string): void {
  const t = ctx.text;
  const sent = sentOf(ctx, s);
  const before = t.slice(Math.max(sent.start, s - 40), s);
  if (OWN.test(before) || OTHER_OWNER.test(before)) return;
  if (/\b(?:case|report|incident|file|claim|complaint)\s*(?:number|no\.?|#)?\s*(?:is|was|:)?\s*$/i.test(before)) return;
  const st = t.slice(sent.start, sent.end);
  const conf: Confidence = /\bhis\s+(?:\w+\s+)?(?:number|phone|cell|email|insta|ig|snap|handle|account|username|tiktok|twitter)\b/i.test(before)
    ? 'high'
    : HIS.test(st)
      ? 'medium'
      : 'low';
  emit(ctx, {
    kind: 'identifier', target: 'person.list', value, confidence: conf,
    label: `You mentioned ${what} that may belong to the person who did this: ${quote(t.slice(s, e))}.`,
    start: s, end: e, key: Object.values(value)[0].toLowerCase(),
  });
}

function identifiers(ctx: Ctx): void {
  const t = ctx.text;
  const emails: Array<[number, number]> = [];
  for (const m of matches(ctx, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    emails.push([m.index, m.index + m[0].length]);
    identifier(ctx, m.index, m.index + m[0].length, { email: m[0] }, 'an email address');
  }
  for (const m of matches(ctx, /(?<![\d-])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?![\d-])/g)) {
    if (isConsumed(ctx, m.index, m.index + m[0].length)) continue;
    identifier(ctx, m.index, m.index + m[0].length, { phone: m[0] }, 'a phone number');
  }
  for (const m of matches(ctx, /(?<![\w@.])@[A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?/g)) {
    const s = m.index;
    const e = s + m[0].length;
    if (emails.some(([a, b]) => s >= a && s < b)) continue;
    const value: Record<string, string> = { handle: m[0] };
    const p = platformNear(t, s, e);
    if (p) value.platform = p;
    identifier(ctx, s, e, value, 'a username');
  }
  // "his snap is jake_b22", "his insta was marcus.lee"
  const named =
    /\b(?:his|their)\s+(?<plat>insta(?:gram)?|ig|snap(?:chat)?|tik ?tok|twitter|discord|telegram|whats ?app|venmo|cash ?app|facebook|fb|linked ?in|tinder|hinge|bumble|grindr|username|user ?name|handle|gamertag)\s*(?:name\s*)?(?:is|was|:|=|-)\s*(?<h>[A-Za-z0-9_.]{3,30})/gi;
  for (const m of matches(ctx, named)) {
    const hg = group(m, 'h')!;
    const h = t.slice(hg[0], hg[1]).replace(/\.$/, '');
    if (!/[\d_.]/.test(h) && !/^\p{Lu}/u.test(h) && h.length < 5) continue;
    if (/^(?:the|and|but|private|deleted|gone|blocked|something|like)$/i.test(h)) continue;
    const plat = t.slice(...group(m, 'plat')!);
    const value: Record<string, string> = { handle: h };
    // The app named right there ("his snap is…"), else the nearest app she mentions ("met on tinder, his username…").
    const own = PLATFORMS.find(([re]) => re.test(plat))?.[1];
    const p = own ?? (/venmo|cash ?app/i.test(plat) ? 'other' : platformNear(t, hg[0], hg[1]));
    if (p) value.platform = p;
    identifier(ctx, hg[0], hg[0] + h.length, value, 'a username');
  }
}

export function extractPeople(ctx: Ctx): void {
  disclosures(ctx);
  witnesses(ctx);
  companions(ctx);
  personResponsible(ctx);
  identifiers(ctx);
}
