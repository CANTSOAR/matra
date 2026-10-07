/**
 * Rule-based extraction for medical care, forensic exams, earlier reports, evidence, substances,
 * force/threats, pressure on the neck, injuries and safety. Each rule checks negation in its own
 * clause ("I didn't go to the hospital" → 'no', never 'yes').
 */
import { consume, emit, group, isConsumed, matches, sentOf, type Confidence, type Ctx } from './context';
import { consumeDatesIn, dateNear } from './dates';
import {
  A, clauseEnd, clauseStart, hedge, hedgeConfidence, polarity, quote, toSecondPerson, trimSpan, wordsBefore,
} from './text';

const OTHER_SUBJECT = /\b(?:she|they|my (?:friend|roommate|mom|sister|brother|dad|boyfriend|girlfriend)|her)\s*$/i;
const SELF_SUBJECT = /(?:^|\s)(?:i|i['’]?d|i['’]?ve|we)\s*$/i;

/** Did someone other than "he" do this? (e.g. "my friend pulled me out") */
function subjectIsOther(ctx: Ctx, idx: number): boolean {
  const w = wordsBefore(ctx.text, sentOf(ctx, idx), idx, 4);
  return OTHER_SUBJECT.test(w) && !/\bhe\b/i.test(w);
}

function clauseText(ctx: Ctx, start: number, end: number, max = 220): [number, number] {
  const sent = sentOf(ctx, start);
  let a = clauseStart(ctx.text, sent, start);
  let b = Math.max(end, clauseEnd(ctx.text, sent, end));
  if (b - a > max) {
    a = Math.max(a, start - 80);
    b = Math.min(b, end + 80);
  }
  return trimSpan(ctx.text, a, b);
}

// ─────────────── medical care ───────────────

const CARE_PLACE = String.raw`(?:the\s+|a\s+|an\s+|my\s+)?(?:ER\b|E\.R\.|er\b|emergency room|emergency department|hospital|urgent care|clinic|doctor(?:['’]?s)?(?:\s+office)?|gyno|gynecologist|ob-?gyn|planned parenthood|health cent(?:er|re)|student health(?:\s+cent(?:er|re))?|campus health|health services|walk-in)`;
const MED_VERB = String.raw`(?:went|go|going|gone|drove|driven|got|get|ended up|was taken|were taken|took me|takes me|brought me|rushed|walked|headed|made it|checked into|admitted)(?:\s+(?:myself|me|her|straight|right|back|over|down|later))?\s+(?:to|into|at|in)\s+`;
const MEDICAL_RE = new RegExp(
  String.raw`\b(?:${MED_VERB}(?<place>${CARE_PLACE})|saw\s+(?:a|the|my)\s+(?:doctor|nurse|gyno|gynecologist|physician)|(?:get|got|seek|sought|getting)\s+(?:any\s+)?medical\s+(?:care|help|attention)|got\s+(?:checked out|examined|stitches|plan b|the morning after pill|pep)\b|fui al (?:hospital|m[eé]dico|doctor))`,
  'gi',
);
const FACILITY_KW = /\b(?:Hospital|Medical Center|Medical Centre|Health|Clinic|Urgent Care|Infirmary|Planned Parenthood)\b/;
const FACILITY_STOP = new Set(
  'the and but so they where for on in with because after that this then next around like at by i he she we to until till it was later tonight last yesterday right early late and or who when while since what how about me my him'.split(
    ' ',
  ),
);

function facilityAfter(ctx: Ctx, idx: number): [number, number] | undefined {
  const t = ctx.text;
  const m = /^\s+(?:at|called|named)\s+/i.exec(t.slice(idx, idx + 20));
  if (!m) return undefined;
  const s = idx + m[0].length;
  const re = /[\p{L}0-9'’.&-]+/uy;
  let pos = s;
  let end = s;
  let count = 0;
  while (count < 5) {
    re.lastIndex = pos;
    const w = re.exec(t);
    if (!w) break;
    const word = w[0].replace(/[.]$/, '');
    if (FACILITY_STOP.has(word.toLowerCase()) && !(count > 0 && /^(?:of|the)$/i.test(word) && /^\p{Lu}/u.test(t.slice(w.index + w[0].length + 1)))) break;
    if (/^\d/.test(word) && count === 0) break;
    end = w.index + word.length;
    count++;
    pos = w.index + w[0].length;
    if (!/^ /.test(t.slice(pos, pos + 1))) break;
    pos++;
  }
  return count > 0 ? [s, end] : undefined;
}

function medical(ctx: Ctx): void {
  const t = ctx.text;
  let sawPositive = false;
  for (const m of matches(ctx, MEDICAL_RE)) {
    const place = group(m, 'place');
    if (place) {
      const p = t.slice(place[0], place[1]).trim();
      // "er" as a filler word ("er, i mean") is not an emergency room.
      if (/^er$/.test(p) && !/\b(?:the|an)\s+er$/i.test(t.slice(Math.max(0, place[0] - 4), place[1]))) continue;
    }
    const sent = sentOf(ctx, m.index);
    const pol = polarity(t, sent, m.index);
    const start = m.index;
    const end = m.index + m[0].length;
    consume(ctx, start, end);
    if (pol === 'neg') {
      emit(ctx, {
        kind: 'medical_care', target: 'medical.care', value: 'no', confidence: 'medium',
        label: 'It sounds like you didn’t get medical care. That’s okay.', start, end, key: 'no',
      });
      continue;
    }
    const h = hedge(t, sent, start, end);
    const value = pol === 'uncertain' ? 'unsure' : 'yes';
    sawPositive = true;
    emit(ctx, {
      kind: 'medical_care', target: 'medical.care', value, confidence: pol === 'uncertain' ? 'low' : hedgeConfidence('high', h),
      label: value === 'yes' ? 'It sounds like you got some medical care afterward.' : 'You mentioned you might have gotten medical care.',
      start, end, key: value,
    });
    if (value !== 'yes') continue;
    // Facility: "the ER at Robert Wood Johnson", "went to Saint Mary's Hospital".
    let fac = facilityAfter(ctx, end);
    if (!fac && place && /^\s*\p{Lu}/u.test(t.slice(place[0], place[1]).replace(/^(?:the|a|an|my)\s+/i, '')) && FACILITY_KW.test(t.slice(place[0], place[1]))) {
      fac = trimSpan(t, place[0], place[1]);
    }
    if (fac) {
      consume(ctx, fac[0], fac[1]);
      const name = t.slice(fac[0], fac[1]);
      emit(ctx, {
        kind: 'medical_care', target: 'medical.facility', value: name, confidence: /^\p{Lu}/u.test(name) || FACILITY_KW.test(name) ? 'high' : 'medium',
        label: `You mentioned getting care at ${quote(name)}.`, start: fac[0], end: fac[1], key: name.toLowerCase(),
      });
    }
    const d = dateNear(ctx, m.index);
    if (d) {
      emit(ctx, {
        kind: 'medical_care', target: 'medical.date', value: d.answer, confidence: d.confidence,
        label: d.answer.mode === 'text' ? `You mentioned when you got care: ${quote(d.display)}.` : `It sounds like you got care around ${d.display}.`,
        start: d.start, end: d.end, key: JSON.stringify(d.answer),
      });
    }
  }
  // Named hospitals without a "went to" verb: "at Robert Wood Johnson Hospital they…"
  if (!sawPositive) {
    for (const m of matches(ctx, /\b(?:at|in)\s+(?<n>(?:[\p{Lu}][\p{L}'’.&-]*\s+){0,4}(?:Hospital|Medical Center|Medical Centre|Urgent Care|Infirmary))\b/gu)) {
      const g = group(m, 'n')!;
      if (isConsumed(ctx, g[0], g[1])) continue;
      if (polarity(t, sentOf(ctx, m.index), m.index) !== 'pos') continue;
      consume(ctx, g[0], g[1]);
      emit(ctx, {
        kind: 'medical_care', target: 'medical.facility', value: t.slice(g[0], g[1]), confidence: 'medium',
        label: `You mentioned ${quote(t.slice(g[0], g[1]))}. It sounds like you may have gotten care there.`,
        start: g[0], end: g[1], key: t.slice(g[0], g[1]).toLowerCase(),
      });
    }
  }
}

// ─────────────── forensic exam ───────────────

const EXAM_RE =
  /\b(?:rape kit|sane (?:exam|nurse)|s\.a\.n\.e\.?(?: exam| nurse)?|forensic (?:exam|examination|nurse|kit)|evidence kit|(?:sexual assault|sa) (?:kit|exam|evidence kit|nurse|nurse examiner)|(?:did|do|got|get|had|have) (?:a |the )?kit(?: done)?|swabb(?:ed|ing) me|took swabs|kit de violaci[oó]n)\b/gi;
const TOX_RE =
  /\b(?:tox(?:icology)? (?:screen|test|report|panel)|drug (?:test|screen|panel)|tested (?:me|my (?:blood|urine|pee))(?: for (?:drugs|everything))?|blood (?:test|work)|urine (?:test|sample))\b/gi;

function forensic(ctx: Ctx): void {
  const t = ctx.text;
  for (const m of matches(ctx, EXAM_RE)) {
    const sent = sentOf(ctx, m.index);
    const pol = polarity(t, sent, m.index);
    const start = m.index;
    const end = start + m[0].length;
    consume(ctx, start, end);
    const value = pol === 'neg' ? 'no' : pol === 'uncertain' ? 'unsure' : 'yes';
    emit(ctx, {
      kind: 'forensic_exam', target: 'medical.exam', value,
      confidence: value === 'yes' ? hedgeConfidence('high', hedge(t, sent, start, end)) : value === 'no' ? 'medium' : 'low',
      label:
        value === 'yes'
          ? 'It sounds like you had a forensic exam (sometimes called a SANE exam).'
          : value === 'no'
            ? 'It sounds like you didn’t have a forensic exam. That’s okay.'
            : 'You mentioned a forensic exam. It’s okay not to be sure.',
      start, end, key: value,
    });
  }
  for (const m of matches(ctx, TOX_RE)) {
    const sent = sentOf(ctx, m.index);
    if (polarity(t, sent, m.index) !== 'pos') continue;
    emit(ctx, {
      kind: 'forensic_exam', target: 'medical.kit', value: { toxicology: 'yes' }, confidence: 'medium',
      label: 'It sounds like they may have tested for alcohol or drugs.', start: m.index, end: m.index + m[0].length, key: 'tox',
    });
  }
}

// ─────────────── earlier reports ───────────────

const AGENCY = String.raw`(?:(?:the|my|our|campus|university|school|local|city)\s+)*(?:police(?: department| station)?|cops|sheriff|precinct|title ix(?: office| coordinator)?|hr|human resources|school|college|university|dean(?: of students)?|ra|job|employer|boss|manager|prosecutor(?:['’]s office)?|da|district attorney|detective|app|tinder|hinge|bumble|instagram|snapchat|landlord|public safety)`;
const REPORT_RE = new RegExp(
  String.raw`\b(?:reported(?:\s+(?:it|this|him|what happened|everything|the assault))?(?:\s+to\s+(?<a1>${AGENCY}))?|filed\s+(?:a|an)\s+(?:police\s+|formal\s+|title ix\s+|hr\s+)?(?:report|complaint)|made\s+(?:a|an)\s+(?:police\s+|formal\s+)?(?:report|statement)|gave\s+(?:a|my)\s+statement|called\s+(?<a2>the police|the cops|911|9-1-1|campus police|public safety)|went\s+to\s+(?<a3>the police(?: station)?|the cops|the precinct|campus police|public safety|title ix|hr|human resources)|(?:told|emailed|contacted|talked to|spoke (?:to|with)|met with)\s+(?<a4>hr|human resources|(?:the\s+)?title ix(?: office| coordinator)?|the dean(?: of students)?|campus police|public safety|a detective|the detective|an officer|the police|the cops)|denunci[eé](?:\s+a\s+(?<a5>la polic[ií]a))?|(?<bare>report(?:ing)?\s+(?:it|this|him|what happened)|go(?:ing)?\s+to\s+the\s+police|call(?:ing)?\s+the\s+(?:police|cops)))\b`,
  'gi',
);
const FUTURE = /\b(?:want|wanted|going to|gonna|plan|planning|thinking about|thinking of|might|should|scared to|afraid to|considering|deciding|if i)\b/i;

function agencyType(a: string): string | undefined {
  const s = a.toLowerCase();
  if (/police|cops|sheriff|precinct|911|9-1-1|detective|officer|public safety|polic/.test(s)) return 'police';
  if (/prosecutor|\bda\b|district attorney/.test(s)) return 'prosecutor';
  if (/title ix|school|college|university|dean|\bra\b/.test(s)) return 'campus';
  if (/\bhr\b|human resources|job|employer|boss|manager/.test(s)) return 'employer';
  return s ? 'other' : undefined;
}

function reports(ctx: Ctx): void {
  const t = ctx.text;
  for (const m of matches(ctx, REPORT_RE)) {
    const sent = sentOf(ctx, m.index);
    const start = m.index;
    const end = start + m[0].length;
    const pol = polarity(t, sent, start);
    const before = wordsBefore(t, sent, start, 6);
    consume(ctx, start, end);
    if (pol === 'neg') {
      emit(ctx, {
        kind: 'prior_report', target: 'prior.any', value: 'no', confidence: FUTURE.test(before) ? 'low' : 'medium',
        label: 'It sounds like you haven’t reported this anywhere yet. That’s okay.', start, end, key: 'no',
      });
      continue;
    }
    if (FUTURE.test(before) || group(m, 'bare')) continue; // "I'm thinking about reporting" is not a past report
    const g = ['a1', 'a2', 'a3', 'a4', 'a5'].map((k) => group(m, k)).find(Boolean);
    let agency = g ? t.slice(g[0], g[1]) : undefined;
    if (!agency) {
      const pm = /\b(police|title ix|hr)\b/i.exec(m[0]);
      if (pm) agency = pm[1];
    }
    const value: Record<string, string> = {};
    if (agency) value.agency = agency;
    const at = agencyType(agency ?? m[0]);
    if (at) value.agencyType = at;
    const d = dateNear(ctx, start);
    if (d) value.date = t.slice(d.start, d.end);
    const who = agency ? toSecondPerson(agency.replace(/^(?:the|a|an)\s+/i, 'the ')) : '';
    emit(ctx, {
      kind: 'prior_report', target: 'prior.list', value, confidence: pol === 'uncertain' ? 'low' : hedgeConfidence('high', hedge(t, sent, start, end)),
      label: agency ? `It sounds like you reported this to ${/^(?:the|your)\s/i.test(who) ? who : quote(agency)}.` : 'It sounds like you reported this somewhere.',
      start, end, key: (agency ?? '').toLowerCase() || at || 'report',
    });
  }
  for (const m of matches(ctx, /\b(?:case|report|incident|complaint|police report)\s*(?:number|no\.?|num|#)\s*(?:is|was|:)?\s*(?<n>[A-Z0-9][A-Z0-9-]{2,})/gi)) {
    const g = group(m, 'n')!;
    if (!/\d/.test(t.slice(g[0], g[1]))) continue;
    consume(ctx, m.index, g[1]);
    emit(ctx, {
      kind: 'prior_report', target: 'prior.list', value: { reportNumber: t.slice(g[0], g[1]) }, confidence: 'high',
      label: `You mentioned a report or case number: ${quote(t.slice(g[0], g[1]))}.`, start: g[0], end: g[1], key: `n:${t.slice(g[0], g[1])}`,
    });
  }
}

// ─────────────── evidence ───────────────

const DIGITAL = String.raw`texts?|text messages?|messages?|dms|snaps|snapchats?|screenshots?|screen ?shots?|photos?|pictures?|pics|videos?|voicemails?|voice ?(?:memos?|notes?|messages?)|recordings?|emails?|call logs?|receipts?|chat(?: logs?| history)?|message history|the (?:convo|conversation)|location history|mensajes|fotos|capturas`;
const EVID_DIG_RE = new RegExp(
  String.raw`\b(?:still have|still got|kept|saved|have|has|got|took|screenshotted|screenshot(?:ted)?|recorded|backed up|there (?:are|is|were)|tengo|guard[eé])\b(?:\s+[\p{L}'’]+){0,4}?\s+(?<what>${DIGITAL})\b`,
  'giu',
);
const PHYS = String.raw`clothes|clothing|dress|shirt|t-shirt|underwear|panties|bra|jeans|pants|shorts|skirt|top|hoodie|jacket|leggings|sheets|bedding|pillowcase|comforter|blanket|towels?|condom|wrapper|cup|solo cup|glass|bottle|ropa|vestido`;
const EVID_PHYS_RE = new RegExp(
  String.raw`\b(?:still have|still got|kept|saved|put|bagged|have|got|(?:didn${A}t|did not|never|haven${A}t|have not) (?:wash|washed|throw away|threw away|throw out|get rid of))\b(?:\s+[\p{L}'’]+){0,4}?\s+(?<what>${PHYS})\b`,
  'giu',
);

function physicalKind(w: string): string {
  const s = w.toLowerCase();
  if (/sheet|bedding|pillow|comforter|blanket|towel/.test(s)) return 'bedding';
  if (/condom|wrapper/.test(s)) return 'condom';
  if (/cup|glass|bottle/.test(s)) return 'containers';
  return 'clothing';
}

function evidence(ctx: Ctx): void {
  const t = ctx.text;
  for (const m of matches(ctx, EVID_DIG_RE)) {
    const sent = sentOf(ctx, m.index);
    const w = group(m, 'what')!;
    if (polarity(t, sent, m.index) !== 'pos') continue;
    const before = wordsBefore(t, sent, m.index, 3);
    if (/\b(?:he|she|they)\s*$/i.test(before)) continue; // "he has photos" is not her evidence
    if (/\b(?:deleted|lost|got rid of)\b/i.test(t.slice(m.index, w[0]))) continue;
    const what = t.slice(w[0], w[1]);
    const norm = what.toLowerCase().replace(/^the\s+/, '').replace(/s$/, '');
    emit(ctx, {
      kind: 'evidence_mention', target: 'evidence.upload', value: 'requested', confidence: 'medium',
      label: `You mentioned ${quote(t.slice(m.index, w[1]))}. If you want, you can add them here. They’re locked on this device first.`,
      start: m.index, end: w[1], key: `d:${norm}`,
    });
  }
  for (const m of matches(ctx, EVID_PHYS_RE)) {
    const sent = sentOf(ctx, m.index);
    const w = group(m, 'what')!;
    if (polarity(t, sent, m.index) !== 'pos') continue;
    if (/\b(?:he|she|they)\s*$/i.test(wordsBefore(t, sent, m.index, 2))) continue;
    // "had a glass of wine" / "put on my dress" are not things she kept.
    if (/\b(?:put on|got dressed|glass of|cup of|bottle of)\b/i.test(t.slice(m.index, w[1] + 4))) continue;
    if (/^(?:have|got|put)$/i.test(m[0].split(/\s+/)[0]) && !/\b(?:still|kept|saved|bag|safe|closet|drawer)\b/i.test(t.slice(sent.start, sent.end))) continue;
    const kind = physicalKind(t.slice(w[0], w[1]));
    emit(ctx, {
      kind: 'evidence_mention', target: 'evidence.physical', value: [kind], confidence: 'medium',
      label: `You mentioned ${quote(t.slice(m.index, w[1]))}. It sounds like you may still have this.`,
      start: m.index, end: w[1], key: `p:${kind}`,
    });
  }
}

// ─────────────── substances ───────────────

const ALC_RE = new RegExp(
  String.raw`\b(?:i|i${A}d|we|we${A}d)\b(?:\s+[\p{L}'’]+){0,3}?\s+(?:had|drank|drink|was drinking|were drinking|been drinking|did|took|downed|split)\b(?:\s+[\p{L}0-9'’-]+){0,4}?\s+(?:drinks?|beers?|shots?|wine|glass(?:es)? of wine|vodka|tequila|whiskey|rum|gin|cocktails?|seltzers?|white claws?|mixed drinks?|jungle juice|punch|margaritas?|alcohol|liquor|booze)\b|\bi\s+(?:was|got|felt)\s+(?:really\s+|so\s+|pretty\s+|a little\s+|kind of\s+|kinda\s+|super\s+)?(?:drunk|tipsy|buzzed|wasted|hammered|trashed|faded)\b|\bwe\s+(?:were|was)\s+(?:all\s+)?(?:drinking|drunk|tipsy|pregaming)\b|\b(?:estaba borracha|tom[eé] (?:unas|dos|tres|unos))\b`,
  'giu',
);
const DRUGS_RE = new RegExp(
  String.raw`\b(?:i|we)\b(?:\s+[\p{L}'’]+){0,3}?\s+(?:smoked|took|had|ate|did|popped|vaped)\b(?:\s+[\p{L}0-9'’-]+){0,3}?\s+(?:weed|edibles?|pot|a joint|joints?|blunt|molly|mdma|ecstasy|xanax|xans|adderall|coke|cocaine|pills?|shrooms|mushrooms|acid|lsd|ketamine|my meds|meds|medication|ambien|benadryl|nyquil|sleeping pills?)\b|\bi\s+was\s+(?:high|stoned|rolling|tripping)\b`,
  'giu',
);
const SUSP_RE =
  /(?:drink|cup|beer|soda|it|that)\s+tasted\s+(?:really\s+|so\s+|kind of\s+|kinda\s+|a little\s+|super\s+)?(?:weird|funny|off|strange|bitter|salty|different|chalky|wrong)|(?:put|slipped|dropped|added|mixed)\s+something\s+(?:in|into)\s+my\s+(?:drink|cup|beer|soda|water)|something\s+(?:was\s+)?in\s+my\s+drink|\broofied\b|\bdrugged\b|\bspiked\b|\bme drog[oó]\b|blacked out after (?:only |just )?(?:one|1|two|2|a|a single) drinks?|(?:hit|felt)\s+(?:me\s+)?(?:way\s+)?(?:harder|different|weird)\s+than\s+(?:normal|usual)/gi;
const OTHER_SUB_RE =
  /\b(?:he|they)\s+(?:was|were|seemed|looked|got|had been|was really|was super)\s+(?:really\s+|so\s+|super\s+|pretty\s+|very\s+)?(?:drunk|wasted|high|hammered|tipsy|buzzed|stoned|trashed|on something|drinking|smoking)\b|\bhe\s+smelled\s+like\s+(?:alcohol|beer|booze|liquor|weed|vodka|whiskey)\b|\bhe\s+(?:had|drank)\s+(?:a lot|like \d+|so many|\d+|a bunch)(?:\s+of)?\s+(?:drinks|beers|shots)\b/gi;
const INCAP_RE =
  /\b(?:blacked out|black(?:ed)? out|passed out|went in and out|in and out of (?:it|consciousness)|(?:couldn['’]?t|could not) (?:move|talk|speak|stand|walk|keep my eyes open)|fell asleep|was asleep|woke up (?:to|and|with)|(?:don['’]?t|do not|dont) remember (?:anything|much|most|getting|how)|lost time|memory gaps?|was unconscious|knocked out)\b/gi;

const SUB_LABEL: Record<string, string> = {
  survivor_alcohol: 'You mentioned you’d been drinking. That never makes any of this your fault.',
  survivor_drugs: 'You mentioned you’d taken something. That never makes any of this your fault.',
  suspected_drugging: 'It sounds like you think something may have been put in your drink.',
  other_person_substances: 'It sounds like the other person had been drinking or using something.',
};

function substances(ctx: Ctx): void {
  const t = ctx.text;
  const rules: Array<[RegExp, string]> = [
    [ALC_RE, 'survivor_alcohol'],
    [DRUGS_RE, 'survivor_drugs'],
    [SUSP_RE, 'suspected_drugging'],
    [OTHER_SUB_RE, 'other_person_substances'],
  ];
  let any = false;
  for (const [re, kind] of rules) {
    for (const m of matches(ctx, re)) {
      const sent = sentOf(ctx, m.index);
      const pol = polarity(t, sent, m.index);
      if (pol === 'neg') continue;
      any = true;
      const start = m.index;
      const end = start + m[0].length;
      const h = hedge(t, sent, start, end);
      emit(ctx, {
        kind: 'substances', target: 'details.substances', value: [kind],
        confidence: pol === 'uncertain' ? 'low' : hedgeConfidence(kind === 'suspected_drugging' ? 'medium' : 'high', h),
        label: SUB_LABEL[kind], start, end, key: kind,
      });
    }
  }
  if (!any) return;
  for (const m of matches(ctx, INCAP_RE)) {
    const sent = sentOf(ctx, m.index);
    if (polarity(t, sent, m.index) === 'neg' && !/remember/i.test(m[0])) continue;
    emit(ctx, {
      kind: 'substances', target: 'details.incapacitated', value: 'yes', confidence: 'medium',
      label: 'It sounds like there were times you couldn’t move, speak, or remember. That’s a common reaction, and it matters.',
      start: m.index, end: m.index + m[0].length, key: 'incap',
    });
  }
}

// ─────────────── force, threats, weapons ───────────────

const PHYS_FORCE_RE = new RegExp(
  String.raw`\b(?:push(?:ed|ing)? me(?! away)|shov(?:ed|ing) me|pinn(?:ed|ing) (?:me|my)|held me down|holding me down|held (?:me|my \w+) down|pull(?:ed|ing) me(?!\s+(?:aside|away|out|up|over|into a hug))|dragg(?:ed|ing) me|grabb(?:ed|ing) (?:me|my)|forc(?:ed|ing) (?:me|himself|my)|threw me|throw me|slamm(?:ed|ing) me|hit me|hitting me|punch(?:ed|ing) me|slapp(?:ed|ing) me|kick(?:ed|ing) me|wouldn${A}t get off(?: of)? me|got on top of me|was on top of me|climbed on (?:top of )?me|overpower(?:ed|ing) me|bit me|yank(?:ed|ing) (?:me|my)|me empuj[oó]|me agarr[oó]|me forz[oó])`,
  'gi',
);
const RESTRAINT_RE = new RegExp(
  String.raw`\b(?:held my (?:wrists|arms|hands|legs|head|hair)|held me (?:there|in place)|holding my (?:wrists|arms|hands)|locked the door|blocked the (?:door|doorway|way)|stood in (?:front of )?the door(?:way)?|(?:would|did|could)n${A}t let me (?:leave|go|get up|out|move)|would not let me (?:leave|go)|(?:couldn${A}t|could not) (?:leave|get out|get away|get up|get him off)|tied (?:me|my)|restrain(?:ed|ing) me|trapped me|i was trapped|kept me (?:there|from leaving|inside)|took my (?:phone|keys))`,
  'gi',
);
const THREAT_RE = new RegExp(
  String.raw`\bthreaten(?:ed|ing|s)?\b|\bsaid (?:he(?:${A}d| would| will| was going to| was gonna| is going to|${A}ll)?\s+)?(?:kill|hurt|ruin|post|send|share|leak|show everyone|tell everyone|find|fire|fail|get me fired|get me expelled|come after|beat)\b|\bif (?:i|you) (?:ever )?(?:told|tell|say|said) (?:anyone|anybody|someone|any1|a soul)|\bor else\b|\byou${A}ll regret\b|\bi${A}ll (?:kill|hurt|find|ruin) you\b|\bme amenaz[oó]\b`,
  'gi',
);
const WEAPON_RE = /\b(?:knife|gun|pistol|handgun|firearm|weapon|blade|box ?cutter|razor|taser|pepper spray|cuchillo|pistola)\b/gi;

const FORCE_LABEL: Record<string, string> = {
  physical_force: 'It sounds like physical force was part of what happened.',
  restraint: 'It sounds like you were held, or kept from leaving.',
  threats: 'It sounds like there were threats.',
  weapon: 'You mentioned a weapon, or something used as one.',
};

function force(ctx: Ctx): void {
  const t = ctx.text;
  const rules: Array<[RegExp, string, Confidence]> = [
    [PHYS_FORCE_RE, 'physical_force', 'high'],
    [RESTRAINT_RE, 'restraint', 'high'],
    [THREAT_RE, 'threats', 'medium'],
    [WEAPON_RE, 'weapon', 'medium'],
  ];
  for (const [re, kind, base] of rules) {
    for (const m of matches(ctx, re)) {
      const sent = sentOf(ctx, m.index);
      const pol = polarity(t, sent, m.index);
      if (pol === 'neg') continue;
      if (kind !== 'threats' && kind !== 'weapon' && subjectIsOther(ctx, m.index)) continue;
      if (kind === 'physical_force' && SELF_SUBJECT.test(wordsBefore(t, sent, m.index, 2))) continue;
      const start = m.index;
      const end = start + m[0].length;
      emit(ctx, {
        kind: 'force_or_threats', target: 'details.force', value: [kind],
        confidence: pol === 'uncertain' ? 'low' : hedgeConfidence(base, hedge(t, sent, start, end)),
        label: FORCE_LABEL[kind], start, end, key: kind,
      });
    }
  }
}

// ─────────────── pressure on the neck ───────────────

const STRANG_RE =
  /\b(?:chok(?:ed|ing|es|e)?\s+me|chok(?:ed|ing)\b(?!\s+(?:on|up|back|out))|strangl(?:ed|ing|es|e)\b|(?:hand|hands|arm|arms|forearm|elbow|knee|belt|rope|cord)\s+(?:around|on|over|against|across)\s+my\s+(?:neck|throat)|(?:squeez|press|push|grabb|held|hold|grip)(?:ed|ing|s|ped)?\s+(?:down\s+)?(?:on\s+)?my\s+(?:neck|throat)|by\s+(?:the|my)\s+(?:neck|throat)|me\s+ahorc[oó]|me\s+estrangul[oó])/gi;

function strangulation(ctx: Ctx): void {
  const t = ctx.text;
  for (const m of matches(ctx, STRANG_RE)) {
    const sent = sentOf(ctx, m.index);
    const before = wordsBefore(t, sent, m.index, 2);
    // "I choked" (on a drink, back tears) is not pressure on her neck.
    if (/(?:^|\s)i\s*$/i.test(before) && !/\bme\b|\bmy\b/i.test(m[0])) continue;
    if (subjectIsOther(ctx, m.index)) continue;
    const pol = polarity(t, sent, m.index);
    const start = m.index;
    const end = start + m[0].length;
    const h = hedge(t, sent, start, end);
    const value = pol === 'neg' ? 'no' : pol === 'uncertain' ? 'unsure' : 'yes';
    emit(ctx, {
      kind: 'strangulation', target: 'details.strangulation', value,
      confidence: value === 'yes' ? hedgeConfidence('high', h) : value === 'no' ? 'medium' : 'low',
      label:
        value === 'yes'
          ? 'You mentioned something about your neck or throat. If it’s okay, this is worth telling a doctor or nurse about, even if you feel fine.'
          : value === 'no'
            ? 'It sounds like there was no pressure on your neck or throat.'
            : 'You mentioned something about your neck or throat. It’s okay not to be sure.',
      start, end, key: value,
    });
  }
}

// ─────────────── injuries ───────────────

const INJURY_RE =
  /\b(?:bruis(?:e|es|ed|ing)|bleeding|bled|blood|scratch(?:es|ed)?|scrapes?|sore|soreness|swollen|swelling|black eye|busted lip|split lip|fat lip|bite marks?|teeth marks|marks on my|red marks|welts?|hurt (?:for|to)|it hurt|in (?:so much )?pain|pain (?:in|down)|torn|tearing|sprain(?:ed)?|broke (?:my|a)|broken (?:rib|wrist|finger|nose|arm)|concussion|stitches|hickeys?|cuts? on my|moretones?|sangr(?:e|aba))\b/gi;

function injuries(ctx: Ctx): void {
  const t = ctx.text;
  for (const m of matches(ctx, INJURY_RE)) {
    if (/^blood$/i.test(m[0]) && /\bblood (?:test|work|alcohol)/i.test(t.slice(m.index, m.index + 16))) continue;
    if (/^stitches$/i.test(m[0]) && /\bin stitches\b/i.test(t.slice(m.index - 3, m.index + 8))) continue;
    const sent = sentOf(ctx, m.index);
    if (polarity(t, sent, m.index) === 'neg') continue;
    const cs = clauseStart(t, sent, m.index);
    if (/\b(?:his|he had|he has|him)\b/i.test(t.slice(cs, m.index))) continue;
    const [a, b] = clauseText(ctx, m.index, m.index + m[0].length);
    if (b <= a) continue;
    const words = t.slice(a, b);
    emit(ctx, {
      kind: 'injury', target: 'medical.injuries', value: words, confidence: 'medium',
      label: `You mentioned being hurt: ${quote(words)}.`, start: a, end: b, key: words.toLowerCase(),
    });
  }
}

// ─────────────── safety ───────────────

const ACCESS_RE = new RegExp(
  String.raw`\b(?:he|they)\s+(?:still\s+)?(?:knows?|knew|has|had)\s+(?:where i (?:live|work|stay|go to school|study|park)|my (?:address|schedule|work schedule|class schedule)|a key|keys to my)|\bhe\s+(?:lives|works|stays)\s+(?:in my building|next door|near me|nearby|down the (?:street|hall)|on my floor|with me|across the (?:street|hall)|in my dorm|at my (?:job|work))|\bwe\s+(?:still\s+)?(?:live|work|go to school)\s+(?:together|in the same|at the same)|\bhe${A}?s\s+(?:still\s+)?my\s+(?:neighbor|neighbour|roommate|housemate|coworker|co-worker|boss|manager|landlord)|\bi know where you live\b|\bsabe d[oó]nde vivo\b`,
  'gi',
);
const NOTES_RE = new RegExp(
  String.raw`\b(?:he\s+)?(?:keeps|kept|has been|been|is still|still)\s+(?:texting|calling|messaging|dming|contacting|showing up|following|watching|driving by|waiting)|\bshow(?:ed|s)?\s+up\s+(?:at|to)\s+my\s+(?:work|job|house|place|apartment|apt|door|class|dorm|school|gym)|\bfollow(?:ed|ing|s)\s+me\b|\b(?:i${A}m|i am)\s+(?:still\s+|so\s+|really\s+)?(?:scared|afraid|terrified)\s+(?:of him|he|that he|to go|to leave)|\bi\s+(?:don${A}t|do not)\s+feel\s+safe|\bmade (?:a )?(?:new|fake) accounts?|\bstalk(?:ing|ed|s)\b|\bblocked him\b|\bchanged my (?:number|locks)`,
  'gi',
);

function safety(ctx: Ctx): void {
  const t = ctx.text;
  for (const m of matches(ctx, ACCESS_RE)) {
    const sent = sentOf(ctx, m.index);
    const pol = polarity(t, sent, m.index);
    const start = m.index;
    const end = start + m[0].length;
    const inner = /\b(?:does|did|do)n['’]?t know\b|\bdoes not know\b/i.test(t.slice(start, end));
    const neg = pol === 'neg' || inner;
    const value = neg ? 'no' : pol === 'uncertain' ? 'unsure' : 'yes';
    emit(ctx, {
      kind: 'safety_concern', target: 'safety.access', value,
      confidence: value === 'yes' ? (/\bwe\b/i.test(m[0]) ? 'medium' : 'high') : 'medium',
      label:
        value === 'yes'
          ? 'It sounds like the person who did this knows where you live, work, or study. Your safety matters.'
          : value === 'no'
            ? 'It sounds like the person doesn’t know where you live, work, or study.'
            : 'You mentioned not being sure whether the person knows where you are.',
      start, end, key: value,
    });
  }
  // "he doesn't know where i live" — the negation is inside the phrase.
  for (const m of matches(ctx, new RegExp(String.raw`\bhe\s+(?:does|did)n${A}t\s+know\s+where\s+i\s+(?:live|work|stay|go to school)`, 'gi'))) {
    emit(ctx, {
      kind: 'safety_concern', target: 'safety.access', value: 'no', confidence: 'medium',
      label: 'It sounds like the person doesn’t know where you live, work, or study.',
      start: m.index, end: m.index + m[0].length, key: 'no',
    });
  }
  for (const m of matches(ctx, NOTES_RE)) {
    const sent = sentOf(ctx, m.index);
    if (polarity(t, sent, m.index) === 'neg' && !/feel\s+safe/i.test(m[0])) continue;
    if (subjectIsOther(ctx, m.index)) continue;
    const [a, b] = trimSpan(t, sent.start, sent.end);
    const words = t.slice(a, b);
    if (words.length > 260) continue;
    consumeDatesIn(ctx, sent);
    emit(ctx, {
      kind: 'safety_concern', target: 'safety.notes', value: words, confidence: 'medium',
      label: `You mentioned something about your safety: ${quote(words)}.`, start: a, end: b, key: words.toLowerCase(),
    });
  }
}

export function extractFacts(ctx: Ctx): void {
  forensic(ctx);
  medical(ctx);
  reports(ctx);
  evidence(ctx);
  substances(ctx);
  force(ctx);
  strangulation(ctx);
  injuries(ctx);
  safety(ctx);
}
