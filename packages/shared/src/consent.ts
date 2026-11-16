/**
 * What a recipient can read when she shares, in the words her consent uses. One table, used by the share screen, the
 * counselor release screen, the consent statements they store, and the server's checks, so the words and the bytes
 * can't drift apart (apps/web/src/lib/shareContents.test.tsx decrypts what a recipient gets for every choice and checks
 * it against these words).
 *
 * A share wraps the key of her whole sealed version, so a recipient can read all of her written account: every field
 * she filled in. Only the evidence files themselves are chosen one by one. Narrowing the account itself would mean a
 * re-encrypted copy that no longer matches what the ledger attests (MATRA_PLAN PR 9; per-field redaction is later work).
 *
 * The consent statement is stored as plain text on the server and hashed into the ledger, so it never carries anything
 * from her account: it names these parts in the same fixed words whatever she filled in.
 */
import type { IntakeRecord } from './index.js';

export type AccountPartId = 'identity' | 'contact' | 'incident' | 'people' | 'care' | 'safety' | 'costs' | 'goals' | 'evidenceList' | 'sealed';

export interface AccountPart {
  id: AccountPartId;
  /** On her screen, second person. */
  screen: string;
  /** In her consent statement, first person. */
  consent: string;
}

/*
 * CHANGING ANY OF THESE WORDS NEEDS ADVOCATE AND COUNSEL REVIEW (Q-023; MATRA_PLAN §9, "PR 9, PR 37 consent text").
 * They are pinned word for word in apps/web/src/lib/consentWords.test.ts, and every field of her account names the
 * words that cover it in RECORD_FIELDS below.
 */
export const ACCOUNT_PARTS: readonly AccountPart[] = [
  {
    id: 'identity',
    screen: 'your name and legal name, date of birth, pronouns and language',
    consent: 'my name and legal name, date of birth, pronouns and language',
  },
  {
    id: 'contact',
    screen: 'your phone number and email, how it’s safe to reach you, the state and county you live in, and any interpreter or access needs',
    consent: 'my phone number and email, how it’s safe to reach me, the state and county I live in, and any interpreter or access needs',
  },
  {
    id: 'incident',
    screen: 'what happened, in your own words (each piece with when you added it and whether you typed or spoke it), and when and where it happened',
    consent: 'what happened, in my own words (each piece with when I added it and whether I typed or spoke it), and when and where it happened',
  },
  {
    id: 'people',
    screen:
      'who did this, what you know about them and how to find them, and whether you set up a sealed match on them, anyone who saw or heard something, and who you’ve told and what you said',
    consent:
      'who did this, what I know about them and how to find them, and whether I set up a sealed match on them, anyone who saw or heard something, and who I’ve told and what I said',
  },
  {
    id: 'care',
    screen: 'medical care and injuries, forensic exams, reports you’ve made, and physical evidence you kept',
    consent: 'medical care and injuries, forensic exams, reports I’ve made, and physical evidence I kept',
  },
  { id: 'safety', screen: 'your answers about your safety', consent: 'my answers about my safety' },
  {
    id: 'costs',
    screen: 'costs, losses and insurance, and any compensation details you gave (such as a mailing address, employer or another contact person)',
    consent: 'costs, losses and insurance, and any compensation details I gave (such as a mailing address, employer or another contact person)',
  },
  { id: 'goals', screen: 'what you’d like to do next', consent: 'what I’d like to do next' },
  {
    id: 'evidenceList',
    screen:
      'the list of all your evidence files, with their names, file types and sizes, descriptions, dates and fingerprints, whether hidden photo data like location was removed, and Matra’s reference for each uploaded file, including files you don’t share',
    consent:
      'the list of all my evidence files, with their names, file types and sizes, descriptions, dates and fingerprints, whether hidden photo data like location was removed, and Matra’s reference for each uploaded file, including files I don’t share',
  },
  { id: 'sealed', screen: 'when you sealed it', consent: 'when I sealed it' },
];

/**
 * The words that cover one field: a phrase that must appear inside its part's `consent` words. `internal` marks the
 * few fields that say nothing about her (an item's random id, the format version), with the reason.
 */
export type FieldWords = { part: AccountPartId; words: string } | { internal: string };

/** Every field of T, nested ones and array elements included, down to its leaves. */
export type FieldMap<T> = T extends readonly (infer E)[]
  ? FieldMap<E>
  : T extends object
    ? { [K in keyof T]-?: FieldMap<NonNullable<T[K]>> }
    : FieldWords;

const w = (part: AccountPartId, words: string): FieldWords => ({ part, words });
const ITEM_ID: FieldWords = { internal: 'a random id the app gives each item so it can keep them apart; says nothing about her' };

/**
 * Which words cover each field of her account. Typed over every field, nested ones and array elements included: a
 * field added anywhere in IntakeRecord doesn't compile until someone writes the words that cover it (and the test
 * checks those words are in the part's consent text, and in the statement she agreed to).
 */
export const RECORD_FIELDS: FieldMap<IntakeRecord> = {
  schemaVersion: { internal: 'the format version of the record (always 1); says nothing about her' },
  completedAt: w('sealed', 'when I sealed it'),
  survivor: {
    preferredName: w('identity', 'my name'),
    legalName: w('identity', 'legal name'),
    dateOfBirth: w('identity', 'date of birth'),
    pronouns: w('identity', 'pronouns'),
    preferredLanguage: w('identity', 'language'),
    phone: w('contact', 'phone number'),
    email: w('contact', 'email'),
    safeContact: {
      phone: w('contact', 'how it’s safe to reach me'),
      text: w('contact', 'how it’s safe to reach me'),
      email: w('contact', 'how it’s safe to reach me'),
      voicemail: w('contact', 'how it’s safe to reach me'),
    },
    safeContactNotes: w('contact', 'how it’s safe to reach me'),
    residenceState: w('contact', 'the state and county I live in'),
    residenceCounty: w('contact', 'the state and county I live in'),
    accessibility: {
      interpreter: w('contact', 'interpreter'),
      interpreterLanguage: w('contact', 'interpreter'),
      otherNeeds: w('contact', 'access needs'),
    },
  },
  incident: {
    dateStart: w('incident', 'when and where it happened'),
    dateEnd: w('incident', 'when and where it happened'),
    dateIsApproximate: w('incident', 'when and where it happened'),
    timeDescription: w('incident', 'when and where it happened'),
    locationDescription: w('incident', 'when and where it happened'),
    locationAddress: w('incident', 'when and where it happened'),
    jurisdiction: {
      state: w('incident', 'when and where it happened'),
      county: w('incident', 'when and where it happened'),
      city: w('incident', 'when and where it happened'),
      campus: w('incident', 'when and where it happened'),
    },
    incidentTypes: w('incident', 'what happened'),
    isOngoing: w('incident', 'what happened'),
    force: { kinds: w('incident', 'what happened'), description: w('incident', 'in my own words') },
    strangulation: w('incident', 'what happened'),
    substances: {
      kinds: w('incident', 'what happened'),
      suspectedIncapacitation: w('incident', 'what happened'),
      description: w('incident', 'in my own words'),
    },
  },
  narrative: {
    entries: {
      id: ITEM_ID,
      createdAt: w('incident', 'when I added it'),
      text: w('incident', 'in my own words'),
      source: w('incident', 'whether I typed or spoke it'),
    },
    freeRecall: w('incident', 'in my own words'),
    sensory: {
      sight: w('incident', 'in my own words'),
      sound: w('incident', 'in my own words'),
      smell: w('incident', 'in my own words'),
      touch: w('incident', 'in my own words'),
      taste: w('incident', 'in my own words'),
    },
    contextBefore: w('incident', 'in my own words'),
    contextAfter: w('incident', 'in my own words'),
    additionalDetails: w('incident', 'in my own words'),
    wordsSpoken: w('incident', 'in my own words'),
  },
  perpetrators: {
    id: ITEM_ID,
    name: w('people', 'who did this'),
    relationship: w('people', 'what I know about them'),
    knownToSurvivor: w('people', 'what I know about them'),
    physicalDescription: w('people', 'what I know about them'),
    identifiers: { kind: w('people', 'how to find them'), platform: w('people', 'how to find them'), value: w('people', 'how to find them') },
    escrowOptIn: w('people', 'whether I set up a sealed match on them'),
    address: w('people', 'how to find them'),
    workplace: w('people', 'how to find them'),
    vehicle: w('people', 'how to find them'),
    whereabouts: w('people', 'how to find them'),
  },
  witnesses: {
    id: ITEM_ID,
    name: w('people', 'anyone who saw or heard something'),
    contact: w('people', 'anyone who saw or heard something'),
    relationship: w('people', 'anyone who saw or heard something'),
    whatTheyKnow: w('people', 'anyone who saw or heard something'),
  },
  disclosures: {
    id: ITEM_ID,
    toWhom: w('people', 'who I’ve told'),
    when: w('people', 'who I’ve told'),
    method: w('people', 'who I’ve told'),
    whatWasSaid: w('people', 'what I said'),
  },
  medical: {
    soughtCare: w('care', 'medical care'),
    facility: w('care', 'medical care'),
    date: w('care', 'medical care'),
    forensicExamCompleted: w('care', 'forensic exams'),
    toxicologyTest: w('care', 'forensic exams'),
    fiveYearHoldKit: w('care', 'forensic exams'),
    kitReportedToPolice: w('care', 'forensic exams'),
    injuries: w('care', 'injuries'),
  },
  priorReports: {
    id: ITEM_ID,
    agency: w('care', 'reports I’ve made'),
    agencyType: w('care', 'reports I’ve made'),
    date: w('care', 'reports I’ve made'),
    reportNumber: w('care', 'reports I’ve made'),
    prosecutorFileNumber: w('care', 'reports I’ve made'),
    outcome: w('care', 'reports I’ve made'),
  },
  evidence: {
    id: ITEM_ID,
    kind: w('evidenceList', 'file types'),
    fileName: w('evidenceList', 'names'),
    mimeType: w('evidenceList', 'file types'),
    sizeBytes: w('evidenceList', 'sizes'),
    sha256: w('evidenceList', 'fingerprints'),
    blobId: w('evidenceList', 'Matra’s reference for each uploaded file'),
    description: w('evidenceList', 'descriptions'),
    capturedAt: w('evidenceList', 'dates'),
    metadataStripped: w('evidenceList', 'whether hidden photo data like location was removed'),
  },
  physicalEvidence: { kinds: w('care', 'physical evidence I kept'), description: w('care', 'physical evidence I kept') },
  safety: {
    immediateSafety: w('safety', 'my answers about my safety'),
    perpetratorHasAccess: w('safety', 'my answers about my safety'),
    wantsProtectiveOrder: w('safety', 'my answers about my safety'),
    notes: w('safety', 'my answers about my safety'),
  },
  financialImpact: {
    medicalCosts: w('costs', 'costs, losses'),
    counselingCosts: w('costs', 'costs, losses'),
    lostWages: w('costs', 'costs, losses'),
    relocationCosts: w('costs', 'costs, losses'),
    otherCosts: w('costs', 'costs, losses'),
    hasInsurance: w('costs', 'insurance'),
  },
  compensation: {
    mailingAddress: {
      street: w('costs', 'mailing address'),
      city: w('costs', 'mailing address'),
      state: w('costs', 'mailing address'),
      zip: w('costs', 'mailing address'),
    },
    claimant: w('costs', 'compensation details'),
    claimantDetails: w('costs', 'compensation details'),
    alternateContact: {
      name: w('costs', 'another contact person'),
      relationship: w('costs', 'another contact person'),
      phone: w('costs', 'another contact person'),
      email: w('costs', 'another contact person'),
    },
    insuranceCarrier: w('costs', 'insurance'),
    employer: w('costs', 'employer'),
    workDatesMissed: w('costs', 'compensation details'),
    goodCauseExplanation: w('costs', 'compensation details'),
  },
  goals: {
    policeReport: w('goals', 'what I’d like to do next'),
    attorney: w('goals', 'what I’d like to do next'),
    compensation: w('goals', 'what I’d like to do next'),
    protectiveOrder: w('goals', 'what I’d like to do next'),
  },
};

/**
 * The words that cover a field path like ['survivor', 'phone'] or ['evidence', '2', 'sizeBytes'] (array indices are
 * skipped); undefined if no entry covers it (a field outside the type, or a path that stops at an object).
 */
export function fieldWords(path: readonly string[]): FieldWords | undefined {
  let node: unknown = RECORD_FIELDS;
  for (const k of path) {
    if (/^\d+$/.test(k)) continue;
    if (typeof node !== 'object' || node === null || !Object.hasOwn(node, k)) return undefined;
    node = (node as Record<string, unknown>)[k];
  }
  return typeof node === 'object' && node !== null && ('words' in node || 'internal' in node) ? (node as FieldWords) : undefined;
}

/** Her consent's sentence about the written account: always shared, and what it holds (fixed words). */
export function writtenAccountSentence(): string {
  return `My written account is always shared. It holds everything I wrote or chose in Matra, including any of these I gave: ${ACCOUNT_PARTS.map((p) => p.consent).join('; ')}.`;
}

/** Her consent's sentence about the evidence files themselves (the server checks it against the files wrapped). */
export function sharedFilesSentence(n: number): string {
  return n === 0
    ? 'I am not sharing any of the evidence files themselves.'
    : `I am also sharing ${n} of the evidence files themselves, the ${n === 1 ? 'one' : 'ones'} I chose.`;
}

/** The statement's lines, as the server stores them (CRLF or LF; edges trimmed). */
const lines = (statement: string) => statement.split(/\r?\n/).map((l) => l.trim());

/** What the recipient's app does with her account: the summary is laid out from it, so it is never a separate choice. */
export const ATTORNEY_SUMMARY_SENTENCE = 'Their app can lay my written account out as an incident summary, which they can download as a PDF.';
export const COUNSELOR_SUMMARY_SENTENCE = 'Their app shows my written account laid out as an incident summary.';

/**
 * How many files a consent statement says are shared: exactly one line may mention evidence files (besides the
 * written account sentence), and it must be one of sharedFilesSentence's, word for word. Otherwise null.
 */
export function statedFileCount(statement: string): number | null {
  const about = lines(statement).filter((l) => /evidence files/i.test(l) && l !== writtenAccountSentence());
  if (about.length !== 1) return null;
  const line = about[0]!;
  const n = line === sharedFilesSentence(0) ? 0 : Number(/^I am also sharing (\d+) of /.exec(line)?.[1]);
  return Number.isInteger(n) && n >= 0 && sharedFilesSentence(n) === line ? n : null;
}

/**
 * The label a recipient sees for a share ("Client K7QZ4"): made up on her device for that share only, so it is never
 * her alias (half of her sign-in, and of her recovery), and the label itself doesn't link two shares (her account,
 * which names her, still does). No vowels, so it never
 * spells a word; no 0/1, so it can be read aloud.
 */
export const SHARE_ALIAS_RE = /^Client [BCDFGHJKLMNPQRSTVWXZ2-9]{5}$/;
const ALIAS_CHARS = 'BCDFGHJKLMNPQRSTVWXZ23456789';

export function newShareAlias(): string {
  let out = '';
  const buf = new Uint8Array(16);
  while (out.length < 5) {
    globalThis.crypto.getRandomValues(buf);
    for (const b of buf) {
      // 252 = 9 × 28: drop the top few values so every character is equally likely
      if (b < 252 && out.length < 5) out += ALIAS_CHARS[b % ALIAS_CHARS.length];
    }
  }
  return `Client ${out}`;
}

/** Her consent's sentence naming the share's label (the server checks it is the label stored). */
export function shareAliasSentence(alias: string): string {
  return `Matra shows this share to them as "${alias}", a name made up for this share only, not the alias I sign in with.`;
}

/**
 * Does this consent statement say exactly what the server is about to store? Line by line, word for word:
 * - exactly one line is the written account sentence, and any other line about the written account is one of the
 *   summary sentences;
 * - exactly one line is about evidence files, and it states this many files (statedFileCount);
 * - for an attorney share, exactly one line names a label, and it is the label stored; a release names none.
 * So text appended to a valid statement that contradicts it, or names another label, is refused. The server refuses a
 * share or release where this is false (400 consent_mismatch).
 */
export function consentMatches(statement: string, sent: { files: number; alias?: string }): boolean {
  const ls = lines(statement);
  const account = ls.filter((l) => /written account/i.test(l));
  const summaries = [ATTORNEY_SUMMARY_SENTENCE, COUNSELOR_SUMMARY_SENTENCE];
  if (account.filter((l) => l === writtenAccountSentence()).length !== 1) return false;
  if (!account.every((l) => l === writtenAccountSentence() || summaries.includes(l))) return false;
  if (statedFileCount(statement) !== sent.files) return false;
  const labels = ls.filter((l) => /shows this share|alias I sign in|username/i.test(l));
  return sent.alias === undefined ? labels.length === 0 : labels.length === 1 && labels[0] === shareAliasSentence(sent.alias);
}
