/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  MATRA — INTAKE INTERVIEW SCRIPT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Every word the intake assistant says lives in this file, so attorneys and
 *  advocates can review and change it without touching any screen code.
 *
 *  HOW TO EDIT (no programming needed):
 *   • Change only the text inside quotes: 'like this' or "like this".
 *     If your text contains an apostrophe ( ' ), use double quotes around it:
 *     "I'm not sure".
 *   • `say:`   lines are what the assistant says, one chat bubble per line.
 *   • `label:` is the short name of the answer box (read aloud by screen
 *              readers and shown on the review screen).
 *   • `hint:`  is the small helper text under an answer box.
 *   • `bullets:` are shown as a short list inside a bubble.
 *   • Do NOT change `id:`, `kind:`, `phase:`, `value:`, or `key:` — the app
 *     uses them to file each answer in the right place.
 *   • To reorder questions inside a section, move the whole { ... } block.
 *   • `showIf` lines decide when a follow-up question appears. Leave them as-is
 *     unless you are working with an engineer.
 *
 *  STYLE GUIDE (please keep to it):
 *   • Short sentences. Plain words. About a 6th–8th grade reading level.
 *   • Warm, calm, never judging. Open invitations, not interrogation.
 *   • Never use the word "alleged". Never ask "why". Never ask
 *     "why didn't you…". Never suggest an answer (no leading questions).
 *   • Every question can be skipped. Say so often. "Not sure" is always okay.
 *   • Fuzzy order, gaps, and sensory details are normal after trauma, and are
 *     valid on their own.
 *
 *  Interview design draws on: the Cognitive Interview (Fisher & Geiselman —
 *  report everything, context reinstatement, varied retrieval order),
 *  trauma-informed / FETI principles (open invitations, no "why" questions,
 *  sensory and peripheral detail), and self-paced "Seek Then Speak" style intake.
 */
import type { ForceKind, IncidentType, PhysicalEvidenceKind, ReportAgencyType, SubstanceKind } from '@matra/shared';
import type { IntakeDraft } from './draft';
import { answerOf } from './draft';

// ───────────────────────── Sections (shown in the progress bar) ─────────────────────────

export type PhaseId =
  | 'welcome'
  | 'about'
  | 'whenWhere'
  | 'yourWords'
  | 'remembering'
  | 'beforeAfter'
  | 'details'
  | 'person'
  | 'people'
  | 'medical'
  | 'priorReports'
  | 'evidence'
  | 'safety'
  | 'costs'
  | 'wishes'
  | 'review';

export interface Phase {
  id: PhaseId;
  /** Shown in the progress bar and section list. */
  title: string;
}

export const PHASES: Phase[] = [
  { id: 'welcome', title: 'Welcome' },
  { id: 'about', title: 'About you' },
  { id: 'whenWhere', title: 'When and where' },
  { id: 'yourWords', title: 'In your words' },
  { id: 'remembering', title: 'What you remember' },
  { id: 'beforeAfter', title: 'Before and after' },
  { id: 'details', title: 'A few more details' },
  { id: 'person', title: 'The person responsible' },
  { id: 'people', title: 'People who know' },
  { id: 'medical', title: 'Medical care' },
  { id: 'priorReports', title: 'Earlier reports' },
  { id: 'evidence', title: 'Evidence' },
  { id: 'safety', title: 'Your safety' },
  { id: 'costs', title: 'Costs and losses' },
  { id: 'wishes', title: 'What you want' },
  { id: 'review', title: 'Review' },
];

// ───────────────────────── Words used on buttons and around the screen ─────────────────────────

export const UI = {
  appTitle: 'My story',
  progress: (n: number, total: number, title: string) => `Part ${n} of ${total}: ${title}`,
  sectionsMenu: 'All sections',
  takeBreak: 'Take a break',
  back: 'Back',
  skip: 'Skip for now',
  skipSection: 'Skip this part',
  continue: 'Continue',
  saveContinue: 'Save and continue',
  change: 'Change',
  backToReview: 'Back to review',
  skippedBubble: 'Skipped for now',
  youSaid: 'You said',
  assistantSaid: 'Matra said',
  optional: 'Optional',
  notAnswered: 'Not answered yet',
  skippedReview: 'Skipped',
  edit: 'Edit',
  remove: 'Remove',
  leaveNow: 'Leave this page now',
  keepGoing: "I'd like to keep going",
  date: {
    knowDate: 'Pick a date',
    describe: 'Describe it in words',
    notSure: "I'm not sure",
    dateLabel: 'Date',
    approximate: 'This date is approximate',
    describeLabel: 'Describe when, in your own words',
    describeHint: "For example: 'summer 2023' or 'the weekend of my cousin's wedding'.",
    notSureSaved: "Not sure — that's okay.",
    approxSuffix: ' (approximate)',
  },
  escrow: {
    notMatchable: "Names aren't unique enough to match safely. Add their email, phone, or social handle if you know it.",
    yes: 'Yes, seal it',
    no: 'No, thank you',
    unsure: "I'm not sure yet",
    noIdentifiers: 'No email, phone, or handle given',
  },
  evidence: {
    requested: 'You chose to add files.',
  },
  review: {
    title: 'Here is everything you shared',
    intro: [
      'Take your time to look it over. Your words are shown exactly as you wrote them.',
      'You can change any section. Nothing is sent to anyone when you seal it.',
    ],
    sealExplain:
      'Sealing locks this version of your account on this device. It is still only yours. You can add to it later, and this version will stay as it is.',
    seal: 'Seal my account',
    sealing: 'Sealing your account…',
    sealingBody: 'Locking it on this device and saving it to your vault. Please keep this page open.',
    sealError: "We couldn't seal your account just now. Nothing is lost — your answers are still here.",
    retry: 'Try again',
    sealedTitle: 'Your account is sealed.',
    sealedBody: [
      'It is locked and stored safely. Only you can open it.',
      'Nothing has been sent to anyone. You decide what happens next, when you are ready.',
      'Thank you for trusting us with your story.',
    ],
  },
} as const;

// ───────────────────────── Help resources ─────────────────────────

export const RESOURCES = {
  heading: 'Help is available any time, for free:',
  items: [
    { label: 'If you are in danger right now', text: 'Call 911', href: 'tel:911' },
    {
      label: 'National Sexual Assault Hotline (24/7, private)',
      text: 'Call 1-800-656-4673',
      href: 'tel:+18006564673',
    },
    { label: 'Chat online with a trained helper', text: 'online.rainn.org', href: 'https://online.rainn.org' },
  ],
};

// ───────────────────────── "Take a break" panel ─────────────────────────

export const BREAK = {
  title: 'Take a break',
  reassure: [
    'Your progress is kept. Nothing you shared is lost.',
    'You can rest here, or close this and come back any time.',
  ],
  groundingTitle: 'If it helps, try this. Go slowly.',
  grounding: [
    'Name 5 things you can see.',
    'Notice 4 things you can feel, like your feet on the floor.',
    'Listen for 3 things you can hear.',
    'Notice 2 things you can smell.',
    'Take 1 slow breath in… and out.',
  ],
  breathe: 'Breathe in… and out.',
  resume: "I'm ready to keep going",
};

// ───────────────────────── Answer choices ─────────────────────────

export interface Option {
  value: string;
  label: string;
}

export const YES_NO_UNSURE: Option[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unsure', label: "I'm not sure" },
];

export const INCIDENT_TYPE_OPTIONS: Array<Option & { value: IncidentType }> = [
  { value: 'sexual_assault', label: 'Sexual assault' },
  { value: 'rape', label: 'Rape' },
  { value: 'attempted_sexual_assault', label: 'Someone tried to sexually assault me' },
  { value: 'unwanted_touching', label: 'Unwanted touching' },
  { value: 'drugging_suspected', label: 'I think I was drugged' },
  { value: 'stalking', label: 'Stalking or being followed' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'dating_violence', label: 'Harm by someone I was dating' },
  { value: 'domestic_violence', label: 'Harm by a partner or family member' },
  { value: 'image_based_abuse', label: 'Private images shared or threatened' },
  { value: 'other', label: 'Something else' },
];

export const FORCE_OPTIONS: Array<Option & { value: ForceKind }> = [
  { value: 'physical_force', label: 'Physical force, like pushing or holding down' },
  { value: 'restraint', label: 'Being held, tied, or blocked from leaving' },
  { value: 'threats', label: 'Threats, to me or someone else' },
  { value: 'weapon', label: 'A weapon, or something used as one' },
  { value: 'other', label: 'Something else' },
];

export const SUBSTANCE_OPTIONS: Array<Option & { value: SubstanceKind }> = [
  { value: 'survivor_alcohol', label: 'I had been drinking' },
  { value: 'survivor_drugs', label: 'I had taken drugs or medicine' },
  { value: 'suspected_drugging', label: 'I think I may have been drugged' },
  { value: 'other_person_substances', label: 'The other person had been drinking or using drugs' },
  { value: 'unsure', label: "I'm not sure" },
];

export const PHYSICAL_EVIDENCE_OPTIONS: Array<Option & { value: PhysicalEvidenceKind }> = [
  { value: 'clothing', label: 'Clothing' },
  { value: 'bedding', label: 'Bedding or towels' },
  { value: 'condom', label: 'A condom or wrapper' },
  { value: 'containers', label: 'Cups, glasses, or bottles' },
  { value: 'other', label: 'Something else' },
];

export const AGENCY_TYPE_OPTIONS: Array<Option & { value: ReportAgencyType }> = [
  { value: 'police', label: 'Police or sheriff' },
  { value: 'prosecutor', label: "Prosecutor's office" },
  { value: 'campus', label: 'School or college' },
  { value: 'employer', label: 'Job or employer' },
  { value: 'other', label: 'Somewhere else' },
];

export const CLAIMANT_OPTIONS: Option[] = [
  { value: 'self', label: 'Yes, for myself' },
  { value: 'other', label: 'Someone else is applying for me' },
];

export const CONTACT_OPTIONS: Option[] = [
  { value: 'phone', label: 'Phone call' },
  { value: 'text', label: 'Text message' },
  { value: 'email', label: 'Email' },
  { value: 'voicemail', label: 'Voicemail' },
];

export const PLATFORM_OPTIONS: Option[] = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'snapchat', label: 'Snapchat' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'x', label: 'X (Twitter)' },
  { value: 'discord', label: 'Discord' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'dating_app', label: 'A dating app' },
  { value: 'other', label: 'Other' },
];

export const TOLD_METHOD_OPTIONS: Option[] = [
  { value: 'in_person', label: 'In person' },
  { value: 'phone', label: 'Phone call' },
  { value: 'text', label: 'Text message' },
  { value: 'social_media', label: 'Social media' },
  { value: 'email', label: 'Email' },
  { value: 'other', label: 'Other' },
];

export const US_STATES: Option[] = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'],
  ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'],
  ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'],
  ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'],
  ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'],
  ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'],
  ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'],
  ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'],
  ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
  ['AS', 'American Samoa'], ['GU', 'Guam'], ['MP', 'Northern Mariana Islands'], ['PR', 'Puerto Rico'],
  ['VI', 'U.S. Virgin Islands'],
].map(([value, label]) => ({ value, label }));

// ───────────────────────── Step types (engineers only) ─────────────────────────

export type FieldType = 'text' | 'tel' | 'email' | 'longtext' | 'select' | 'choice';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  hint?: string;
  options?: Option[];
  autoComplete?: string;
}

interface BaseStep {
  /** Do not change. */
  id: string;
  phase: PhaseId;
  /** What the assistant says — one bubble per line. */
  say: string[];
  /** Short list shown inside the last bubble. */
  bullets?: string[];
  /** When to show this step. Leave alone unless working with an engineer. */
  showIf?: (d: IntakeDraft) => boolean;
}

export interface InfoStep extends BaseStep {
  kind: 'info';
  continueLabel?: string;
  /** Show 911 / hotline / online chat. */
  showResources?: boolean;
  /** Show a "Leave this page now" button. */
  showLeave?: boolean;
  /** Offer a "Skip this part" button that jumps to the next section. */
  offerSkipSection?: boolean;
}
export interface TextStep extends BaseStep {
  kind: 'text';
  label: string;
  hint?: string;
  inputType?: 'text' | 'tel' | 'email';
  autoComplete?: string;
}
export interface LongTextStep extends BaseStep {
  kind: 'longtext';
  label: string;
  hint?: string;
  /** Bigger box for the main account. */
  large?: boolean;
}
export interface DateStep extends BaseStep {
  kind: 'date';
  label: string;
  hint?: string;
}
export interface ApproxDateStep extends BaseStep {
  kind: 'approxDate';
  label: string;
  hint?: string;
}
export interface ChoiceStep extends BaseStep {
  kind: 'choice';
  label: string;
  options: Option[];
}
export interface MultiStep extends BaseStep {
  kind: 'multi';
  label: string;
  hint?: string;
  options: Option[];
}
export interface SelectStep extends BaseStep {
  kind: 'select';
  label: string;
  hint?: string;
  options: Option[];
  placeholder: string;
}
export interface FormStep extends BaseStep {
  kind: 'form';
  label: string;
  fields: FieldDef[];
}
export interface GroupStep extends BaseStep {
  kind: 'group';
  label: string;
  /** e.g. "Person" → "Person 1", "Person 2" */
  itemLabel: string;
  addLabel: string;
  fields: FieldDef[];
}
export interface EscrowStep extends BaseStep {
  kind: 'escrow';
  label: string;
}
export interface EvidenceStep extends BaseStep {
  kind: 'evidence';
  label: string;
  uploadLabel: string;
  laterLabel: string;
}
export interface ReviewStep extends BaseStep {
  kind: 'review';
}

export type ScriptStep =
  | InfoStep
  | TextStep
  | LongTextStep
  | DateStep
  | ApproxDateStep
  | ChoiceStep
  | MultiStep
  | SelectStep
  | FormStep
  | GroupStep
  | EscrowStep
  | EvidenceStep
  | ReviewStep;

// Helpers used by `showIf` lines.
const is = (id: string, ...values: string[]) => (d: IntakeDraft) => {
  const a = answerOf(d, id);
  return typeof a === 'string' && values.includes(a);
};
const isNot = (id: string, value: string) => (d: IntakeDraft) => answerOf(d, id) !== value;
const includesAny = (id: string, ...values: string[]) => (d: IntakeDraft) => {
  const a = answerOf(d, id);
  return Array.isArray(a) && a.some((v) => typeof v === 'string' && values.includes(v));
};
const answered = (id: string) => (d: IntakeDraft) => {
  const a = answerOf(d, id);
  return Array.isArray(a) ? a.length > 0 : typeof a === 'string' && a.trim() !== '';
};
const formFieldFilled = (id: string, key: string) => (d: IntakeDraft) => {
  const a = answerOf(d, id);
  return !!a && typeof a === 'object' && !Array.isArray(a) && !('mode' in a) && ((a as Record<string, string>)[key] ?? '').trim() !== '';
};
/**
 * Only unique identifiers can be matched. A name alone is never enough (names are shared by many people),
 * so the sealed-match choice is only offered for a person with an email, phone number, or social handle.
 */
export const MATCHABLE_KEYS = ['email', 'phone', 'handle'];
const PERSON_IDENTIFIER_KEYS = MATCHABLE_KEYS;
const anyPersonHasIdentifier = (d: IntakeDraft) => {
  const a = answerOf(d, 'person.list');
  return (
    Array.isArray(a) &&
    a.some((p) => typeof p === 'object' && PERSON_IDENTIFIER_KEYS.some((k) => (p.values[k] ?? '').trim() !== ''))
  );
};

// ───────────────────────── THE INTERVIEW ─────────────────────────

export const STEPS: ScriptStep[] = [
  // ── Welcome: safety first, then what happens with her data ──
  {
    id: 'safety.now',
    phase: 'welcome',
    kind: 'choice',
    say: ['Hi. Before anything else, I want to check on you.', 'Are you safe right now?'],
    label: 'Are you safe right now?',
    options: [
      { value: 'yes', label: "Yes, I'm safe" },
      { value: 'no', label: 'No' },
      { value: 'unsure', label: "I'm not sure" },
    ],
  },
  {
    id: 'safety.help',
    phase: 'welcome',
    kind: 'info',
    showIf: is('safety.now', 'no', 'unsure'),
    say: [
      'Thank you for telling me. Your safety comes first.',
      'If you are in danger, please call 911. You can also talk to someone right now.',
      'When you are ready, you can keep going here, or leave this page.',
    ],
    showResources: true,
    showLeave: true,
    continueLabel: "I'd like to keep going",
  },
  {
    id: 'privacy',
    phase: 'welcome',
    kind: 'info',
    say: ['I am here to help you write down what happened, one time, in your own words.', 'Here is what happens with what you share:'],
    bullets: [
      'It is locked (encrypted) on this device before it is saved.',
      'Nobody else can read it. Not us, not the police, not your school or job.',
      'Nothing is sent to anyone unless you say so, at that moment.',
      'Your words are kept exactly as you write them. Nothing is changed.',
    ],
    continueLabel: 'Okay',
  },
  {
    id: 'howItWorks',
    phase: 'welcome',
    kind: 'info',
    say: [
      'You set the pace.',
      'You can skip any question, go back, or take a break at any time. Your progress is kept.',
      "There are no wrong answers. It's okay if you don't remember everything, or if things are out of order. That's normal.",
    ],
    continueLabel: "I'm ready",
  },

  // ── (a) About you & safe contact ──
  {
    id: 'about.name',
    phase: 'about',
    kind: 'text',
    say: ["Let's start with you.", 'What name would you like me to use for you?'],
    label: 'Name to use for you',
    hint: 'This can be a nickname.',
    autoComplete: 'nickname',
  },
  {
    id: 'about.legalName',
    phase: 'about',
    kind: 'text',
    say: ['If you are comfortable, what is your full legal name?', 'Police or a lawyer may need it later. You can leave it for now.'],
    label: 'Full legal name',
    autoComplete: 'name',
  },
  {
    id: 'about.dob',
    phase: 'about',
    kind: 'date',
    say: ['What is your date of birth?'],
    label: 'Date of birth',
    hint: 'This helps a lawyer know which rules apply to you.',
  },
  {
    id: 'about.pronouns',
    phase: 'about',
    kind: 'text',
    say: ['What pronouns do you use, if you would like to share?'],
    label: 'Pronouns',
    hint: 'For example: she/her, they/them, he/him.',
  },
  {
    id: 'about.language',
    phase: 'about',
    kind: 'text',
    say: ['What language do you feel most comfortable using?'],
    label: 'Preferred language',
  },
  {
    id: 'about.contactMethods',
    phase: 'about',
    kind: 'multi',
    say: ['If someone you choose needs to reach you later, which ways are safe for you?'],
    label: 'Safe ways to contact you',
    hint: 'Choose all that are safe. Only you decide who gets this.',
    options: CONTACT_OPTIONS,
  },
  {
    id: 'about.phone',
    phase: 'about',
    kind: 'text',
    showIf: includesAny('about.contactMethods', 'phone', 'text', 'voicemail'),
    say: ['What phone number is safe to use?'],
    label: 'Safe phone number',
    inputType: 'tel',
    autoComplete: 'tel',
  },
  {
    id: 'about.email',
    phase: 'about',
    kind: 'text',
    showIf: includesAny('about.contactMethods', 'email'),
    say: ['What email address is safe to use?'],
    label: 'Safe email address',
    inputType: 'email',
    autoComplete: 'email',
  },
  {
    id: 'about.contactNotes',
    phase: 'about',
    kind: 'text',
    say: ['Is there anything people should know about contacting you safely?'],
    label: 'Notes about contacting you',
    hint: "For example: 'only text after 6pm' or 'please don't leave messages'.",
  },
  {
    id: 'about.home',
    phase: 'about',
    kind: 'form',
    say: ['Where do you live now? Just the state and county is enough.', 'This helps match you with help near you.'],
    label: 'Where you live',
    fields: [
      { key: 'state', label: 'State', type: 'select', options: US_STATES },
      { key: 'county', label: 'County', type: 'text' },
    ],
  },

  // ── (b) When and where ──
  {
    id: 'when.date',
    phase: 'whenWhere',
    kind: 'approxDate',
    say: ['Thank you. Now, a little about when and where.', 'When did this happen?', "An exact date, a rough idea, or 'I'm not sure' are all okay."],
    label: 'When it happened',
  },
  {
    id: 'when.repeated',
    phase: 'whenWhere',
    kind: 'choice',
    say: ['Did this happen more than once, or over a period of time?'],
    label: 'Happened more than once',
    options: YES_NO_UNSURE,
  },
  {
    id: 'when.lastDate',
    phase: 'whenWhere',
    kind: 'approxDate',
    showIf: is('when.repeated', 'yes'),
    say: ['When was the most recent time?'],
    label: 'Most recent time',
  },
  {
    id: 'when.ongoing',
    phase: 'whenWhere',
    kind: 'choice',
    showIf: is('when.repeated', 'yes', 'unsure'),
    say: ['Is it still happening now?'],
    label: 'Still happening',
    options: YES_NO_UNSURE,
  },
  {
    id: 'when.time',
    phase: 'whenWhere',
    kind: 'text',
    say: ['Do you remember about what time of day it was?'],
    label: 'Time of day',
    hint: "Anything helps, like 'late at night' or 'after dinner'.",
  },
  {
    id: 'where.place',
    phase: 'whenWhere',
    kind: 'longtext',
    say: ['Where did it happen? Describe the place any way you can.'],
    label: 'Where it happened',
    hint: "For example: 'his apartment', 'a party at a friend's house', or 'in a car'.",
  },
  {
    id: 'where.address',
    phase: 'whenWhere',
    kind: 'text',
    say: ['If you know the address or the name of the place, you can add it here.'],
    label: 'Address or name of the place',
  },
  {
    id: 'where.area',
    phase: 'whenWhere',
    kind: 'form',
    say: ['What city and state was it in?', 'If it was at a school or college, you can add that too.'],
    label: 'City, county, state, school',
    fields: [
      { key: 'city', label: 'City or town', type: 'text' },
      { key: 'county', label: 'County', type: 'text' },
      { key: 'state', label: 'State', type: 'select', options: US_STATES },
      { key: 'campus', label: 'School or college (if any)', type: 'text' },
    ],
  },

  // ── (c) Free recall — her account, uninterrupted ──
  {
    id: 'story.intro',
    phase: 'yourWords',
    kind: 'info',
    say: [
      'This next part is yours.',
      'In a moment, I will ask you to tell me what happened, in your own words.',
      'Please include anything you remember, even small things, even if they seem unimportant or out of order.',
      'Write as much or as little as you want. I will not interrupt, and I will not change your words.',
      'You can start wherever feels easiest.',
    ],
    continueLabel: "I'm ready",
  },
  {
    id: 'story.freeRecall',
    phase: 'yourWords',
    kind: 'longtext',
    large: true,
    say: ['Whenever you are ready, tell me what happened.'],
    label: 'What happened, in your own words',
    hint: 'Take all the time you need. There is no length limit. Your words are saved exactly as you write them.',
  },

  // ── (d) Context reinstatement & senses ──
  {
    id: 'recall.intro',
    phase: 'remembering',
    kind: 'info',
    say: [
      'Thank you.',
      'Sometimes memories come back through the senses. Some people remember sounds or smells more clearly than the order things happened in. That is normal, and it matters.',
      'If it feels okay, take a slow breath and picture the place where you were. You can close your eyes, or keep them open.',
      'I will ask about each sense. Skip any you do not remember, or do not want to answer.',
    ],
    offerSkipSection: true,
  },
  {
    id: 'recall.sight',
    phase: 'remembering',
    kind: 'longtext',
    say: ['What do you remember seeing?', 'It could be the room, the light, colors, clothing, or anything else.'],
    label: 'What you saw',
  },
  {
    id: 'recall.sound',
    phase: 'remembering',
    kind: 'longtext',
    say: ['What do you remember hearing?', 'Voices, music, a TV, traffic — anything at all.'],
    label: 'What you heard',
  },
  {
    id: 'recall.smell',
    phase: 'remembering',
    kind: 'longtext',
    say: ['Do you remember any smells?', 'For example: smoke, alcohol, cologne, or food.'],
    label: 'What you smelled',
  },
  {
    id: 'recall.touch',
    phase: 'remembering',
    kind: 'longtext',
    say: [
      'Do you remember how anything felt? Like the temperature, a surface, or fabric.',
      'Only share what you are comfortable with.',
    ],
    label: 'What you felt',
  },
  {
    id: 'recall.taste',
    phase: 'remembering',
    kind: 'longtext',
    say: ['Do you remember any tastes?', 'For example, a drink that tasted different than usual.'],
    label: 'What you tasted',
  },
  {
    id: 'recall.more',
    phase: 'remembering',
    kind: 'longtext',
    say: [
      'Sometimes thinking about it in a different order brings back new details.',
      'If you want, try starting from the last thing you remember and thinking backward. Or start from a moment that stands out.',
      'Is there anything else that comes to mind? Even small things.',
    ],
    label: 'Anything else you remember',
  },

  // ── (e) Before / after / words spoken ──
  {
    id: 'context.before',
    phase: 'beforeAfter',
    kind: 'longtext',
    say: ['What was happening earlier, before this happened?', 'For example, where you were and who you were with.'],
    label: 'Before it happened',
  },
  {
    id: 'context.after',
    phase: 'beforeAfter',
    kind: 'longtext',
    say: ['What happened afterward? Where did you go, and what did you do?', 'There is no right way to react. Whatever you did is okay.'],
    label: 'After it happened',
  },
  {
    id: 'context.words',
    phase: 'beforeAfter',
    kind: 'longtext',
    say: [
      'Do you remember anything that was said — by the person who did this, or by anyone else?',
      'Write it the way you remember it, word for word if you can. It is okay to write words that are hard to read.',
    ],
    label: 'Words that were said',
  },
  {
    id: 'context.types',
    phase: 'beforeAfter',
    kind: 'multi',
    say: [
      'Some people find it helpful to choose words for what happened. Some do not.',
      'If you want, choose any that fit. You do not need to put a label on it.',
    ],
    label: 'Words that fit what happened',
    hint: 'Choose any, or none.',
    options: INCIDENT_TYPE_OPTIONS,
  },

  // ── (e2) A few specific details — only AFTER her own account ──
  {
    id: 'details.intro',
    phase: 'details',
    kind: 'info',
    say: [
      'Next are a few short questions about specific things. A nurse, advocate, or lawyer might ask about them later.',
      'Some of them may be hard to read. You can skip any question, or this whole part.',
    ],
    offerSkipSection: true,
  },
  {
    id: 'details.force',
    phase: 'details',
    kind: 'multi',
    say: ['Were any of these part of what happened?', 'Choose any that fit, or none.'],
    label: 'Force, threats, or weapons',
    hint: 'Choose any, or none.',
    options: FORCE_OPTIONS,
  },
  {
    id: 'details.forceWords',
    phase: 'details',
    kind: 'longtext',
    showIf: answered('details.force'),
    say: ['If you want, describe it in your own words.'],
    label: 'Force, threats, or weapons — in your words',
  },
  {
    id: 'details.strangulation',
    phase: 'details',
    kind: 'choice',
    say: ['Did anyone put their hands, arm, or anything else around your neck, or press on your neck or throat?'],
    label: 'Pressure on your neck or throat',
    options: YES_NO_UNSURE,
  },
  {
    id: 'details.strangulationInfo',
    phase: 'details',
    kind: 'info',
    showIf: is('details.strangulation', 'yes', 'unsure'),
    say: [
      'Thank you for telling me.',
      'Pressure on the neck can cause injuries inside the body that you cannot see. Sometimes signs show up hours or days later.',
      'If you can, please mention it to a doctor or nurse, even if you feel okay.',
    ],
    showResources: true,
  },
  {
    id: 'details.substances',
    phase: 'details',
    kind: 'multi',
    say: [
      "Some people were drinking or think they may have been drugged. Nothing you share here changes that it wasn't your fault.",
      'Were alcohol, drugs, or medicine part of that day or night, for anyone? Choose any that fit, or none.',
    ],
    label: 'Alcohol or drugs',
    hint: 'Choose any, or none.',
    options: SUBSTANCE_OPTIONS,
  },
  {
    id: 'details.incapacitated',
    phase: 'details',
    kind: 'choice',
    showIf: answered('details.substances'),
    say: ['Were there times you could not move, speak, or remember what was happening, or times you were asleep or passed out?'],
    label: 'Times you could not move, speak, or remember',
    options: YES_NO_UNSURE,
  },
  {
    id: 'details.toxInfo',
    phase: 'details',
    kind: 'info',
    showIf: includesAny('details.substances', 'suspected_drugging', 'unsure'),
    say: [
      'Something you may want to know: if this happened in the last few days, a hospital can test for drugs.',
      'Some drugs leave the body quickly, so sooner is better. The hotline at 1-800-656-4673 can help you find a hospital.',
    ],
  },
  {
    id: 'details.substancesWords',
    phase: 'details',
    kind: 'longtext',
    showIf: answered('details.substances'),
    say: ['Is there anything you want to add about this, in your own words?'],
    label: 'Alcohol or drugs — in your words',
  },

  // ── (f) The person / people responsible ──
  {
    id: 'person.intro',
    phase: 'person',
    kind: 'info',
    say: [
      'Next, I will ask about the person or people who did this.',
      'Share only what you know and feel okay sharing. Some people know the person well. Some do not know them at all. Both are okay.',
    ],
    offerSkipSection: true,
  },
  {
    id: 'person.list',
    phase: 'person',
    kind: 'group',
    say: ['What can you tell me about them? Fill in only what you know.'],
    label: 'Person or people responsible',
    itemLabel: 'Person',
    addLabel: 'Add another person',
    fields: [
      { key: 'name', label: 'Name, or what you call them', type: 'text' },
      { key: 'known', label: 'Did you know this person before?', type: 'choice', options: YES_NO_UNSURE },
      { key: 'relationship', label: 'How you know them', type: 'text', hint: 'For example: coworker, ex-partner, classmate, someone I just met.' },
      { key: 'description', label: 'What they look like', type: 'longtext', hint: 'Anything you remember: height, hair, clothes, tattoos, voice.' },
      { key: 'email', label: 'Their email', type: 'email' },
      { key: 'phone', label: 'Their phone number', type: 'tel' },
      { key: 'handle', label: 'Their social media name or handle', type: 'text', hint: 'For example: @name' },
      { key: 'platform', label: 'Which app or site?', type: 'select', options: PLATFORM_OPTIONS },
      { key: 'otherId', label: 'Anything else that identifies them', type: 'text', hint: 'For example: a username or a nickname.' },
      { key: 'address', label: 'Where they live, if you know', type: 'text' },
      { key: 'workplace', label: 'Where they work or go to school', type: 'text' },
      { key: 'vehicle', label: 'Their car or vehicle', type: 'text', hint: 'For example: color, make, or license plate.' },
      { key: 'whereabouts', label: 'Where they might be now', type: 'text' },
    ],
  },
  {
    id: 'person.escrow',
    phase: 'person',
    kind: 'escrow',
    showIf: anyPersonHasIdentifier,
    say: [
      'There is one more thing you can choose, if you want. It is called a sealed match.',
      'If you turn it on, the email, phone number, or social handle you gave is turned into a sealed code on this device. Nobody can read it — not us, not anyone.',
      'Names are not used for this. Many people share a name, so a name alone is not unique enough to match safely.',
      'If someone else names the same person, a trained legal options counselor — not the police, not your school — will reach out privately to talk about your options. You decide everything after that.',
      'You will never see a match in this app, and neither will anyone else. That keeps this tool safe, so no one can use it to find out if they have been named.',
      'Nothing else happens unless you decide. It is completely okay to say no.',
    ],
    label: 'Sealed match',
  },

  {
    id: 'person.matchContact',
    phase: 'person',
    kind: 'form',
    showIf: (d) => {
      const a = answerOf(d, 'person.escrow');
      return !!a && typeof a === 'object' && !Array.isArray(a) && Object.values(a as Record<string, string>).includes('yes');
    },
    say: [
      'If there is ever a match, how would you like the legal options counselor to reach you?',
      'Only they would use this, only if there is a match, and only privately.',
    ],
    label: 'How a counselor can reach you about a match',
    fields: [
      {
        key: 'method',
        label: 'Best way to reach you',
        type: 'choice',
        options: [
          { value: 'phone', label: 'Phone call' },
          { value: 'text', label: 'Text message' },
          { value: 'email', label: 'Email' },
        ],
      },
      { key: 'detail', label: 'Phone number or email to use', type: 'text' },
      { key: 'notes', label: 'Anything they should know', type: 'text', hint: "For example: 'only after 6pm' or 'don't leave a message'." },
    ],
  },

  // ── (g) Witnesses & people she told ──
  {
    id: 'people.witnesses',
    phase: 'people',
    kind: 'group',
    say: [
      'Was anyone else there, or nearby, before, during, or after?',
      'Even someone who only saw you that day or night can matter.',
    ],
    label: 'People who were there or nearby',
    itemLabel: 'Person',
    addLabel: 'Add another person',
    fields: [
      { key: 'name', label: 'Their name', type: 'text' },
      { key: 'contact', label: 'How to reach them, if you know', type: 'text' },
      { key: 'relationship', label: 'How you know them', type: 'text' },
      { key: 'whatTheyKnow', label: 'What they saw or know', type: 'longtext' },
    ],
  },
  {
    id: 'people.toldIntro',
    phase: 'people',
    kind: 'info',
    say: [
      'Have you told anyone about what happened? A friend, family member, counselor, or anyone else?',
      'This can matter, because the people you told can sometimes help support your account later.',
      'It is okay if you have not told anyone. Many people wait a long time, or never tell. That is normal.',
    ],
  },
  {
    id: 'people.told',
    phase: 'people',
    kind: 'group',
    say: ['If you told someone, you can add them here.'],
    label: 'People you told',
    itemLabel: 'Person you told',
    addLabel: 'Add another person',
    fields: [
      { key: 'toWhom', label: 'Who you told', type: 'text' },
      { key: 'when', label: 'About when', type: 'text', hint: "For example: 'the next morning' or 'March 2024'." },
      { key: 'method', label: 'How you told them', type: 'select', options: TOLD_METHOD_OPTIONS },
      { key: 'whatWasSaid', label: 'What you remember saying', type: 'longtext' },
    ],
  },

  // ── (h) Medical care ──
  {
    id: 'medical.care',
    phase: 'medical',
    kind: 'choice',
    say: ['Did you get any medical care after this happened?', 'It is okay if you did not.'],
    label: 'Got medical care',
    options: YES_NO_UNSURE,
  },
  {
    id: 'medical.facility',
    phase: 'medical',
    kind: 'text',
    showIf: is('medical.care', 'yes'),
    say: ['Where did you get care?'],
    label: 'Hospital, clinic, or doctor',
  },
  {
    id: 'medical.date',
    phase: 'medical',
    kind: 'approxDate',
    showIf: is('medical.care', 'yes'),
    say: ['About when was that?'],
    label: 'When you got care',
  },
  {
    id: 'medical.exam',
    phase: 'medical',
    kind: 'choice',
    showIf: is('medical.care', 'yes'),
    say: ['Did you have a forensic exam? This is sometimes called a SANE exam or a "rape kit".'],
    label: 'Had a forensic exam',
    options: YES_NO_UNSURE,
  },
  {
    id: 'medical.kit',
    phase: 'medical',
    kind: 'form',
    showIf: is('medical.exam', 'yes'),
    say: ['If you know, a few details about the exam. "Not sure" is okay for any of them.'],
    label: 'About the exam',
    fields: [
      { key: 'toxicology', label: 'Did they test for alcohol or drugs?', type: 'choice', options: YES_NO_UNSURE },
      {
        key: 'fiveYearHold',
        label: 'Was the kit kept without a police report? (sometimes called an anonymous or "Five-Year Hold" kit)',
        type: 'choice',
        options: YES_NO_UNSURE,
      },
      { key: 'reported', label: 'Was the kit reported to police?', type: 'choice', options: YES_NO_UNSURE },
    ],
  },
  {
    id: 'medical.examInfo',
    phase: 'medical',
    kind: 'info',
    showIf: isNot('medical.care', 'yes'),
    say: [
      'Something you may want to know: if this happened recently, you can still get a forensic exam. It is often free, and is usually possible up to about 5 days after.',
      'You do not have to report to police to get one. The hotline at 1-800-656-4673 can help you find a hospital near you.',
    ],
  },
  {
    id: 'medical.injuries',
    phase: 'medical',
    kind: 'longtext',
    say: ['Were you hurt in any way? This includes things that have healed, like bruises or soreness.', 'Only share what you are comfortable with.'],
    label: 'Injuries',
  },

  // ── (i) Earlier reports ──
  {
    id: 'prior.any',
    phase: 'priorReports',
    kind: 'choice',
    say: ['Have you already reported this anywhere?', 'For example, to police, a school, an employer, or an app.'],
    label: 'Reported before',
    options: YES_NO_UNSURE,
  },
  {
    id: 'prior.list',
    phase: 'priorReports',
    kind: 'group',
    showIf: is('prior.any', 'yes', 'unsure'),
    say: ['What do you remember about that report? Fill in only what you know.'],
    label: 'Earlier reports',
    itemLabel: 'Report',
    addLabel: 'Add another report',
    fields: [
      { key: 'agency', label: 'Who you reported to', type: 'text', hint: "For example: 'city police' or 'my school's Title IX office'." },
      { key: 'agencyType', label: 'What kind of place was it?', type: 'select', options: AGENCY_TYPE_OPTIONS },
      { key: 'date', label: 'About when', type: 'text' },
      { key: 'reportNumber', label: 'Report or case number, if you have it', type: 'text' },
      { key: 'prosecutorFileNumber', label: "Prosecutor's file number, if you have it", type: 'text' },
      { key: 'outcome', label: 'What happened after', type: 'longtext' },
    ],
  },

  // ── (j) Evidence ──
  {
    id: 'evidence.tips',
    phase: 'evidence',
    kind: 'info',
    say: [
      'Things like messages, photos, call logs, or posts can help. You do not need to have any. Your words matter on their own.',
      'If you do have some, here are a few ways to keep it safe:',
    ],
    bullets: [
      'Try not to delete messages, even upsetting ones.',
      'Take screenshots that show the date, the time, and who sent it.',
      'If you still have clothing from that day and want to keep it, a paper bag is best.',
      'Write down where things are, like which phone or account.',
    ],
  },
  {
    id: 'evidence.upload',
    phase: 'evidence',
    kind: 'evidence',
    say: ['Would you like to add photos, screenshots, or files now?', 'They are locked (encrypted) on this device before they are saved.'],
    label: 'Add evidence files',
    uploadLabel: 'Add files',
    laterLabel: 'Maybe later',
  },
  {
    id: 'evidence.physical',
    phase: 'evidence',
    kind: 'multi',
    say: ['Do you still have any physical things from that day or night?', 'Choose any, or none. You do not need to have kept anything.'],
    label: 'Physical things you kept',
    hint: 'Choose any, or none.',
    options: PHYSICAL_EVIDENCE_OPTIONS,
  },
  {
    id: 'evidence.physicalNotes',
    phase: 'evidence',
    kind: 'longtext',
    showIf: answered('evidence.physical'),
    say: ['If you want, write down where they are now and how they are kept.'],
    label: 'Where they are kept',
    hint: 'A paper bag is best for clothing. Try not to wash anything you want to keep.',
  },

  // ── (k) Safety & protective order ──
  {
    id: 'safety.access',
    phase: 'safety',
    kind: 'choice',
    say: ['Now a few questions about your safety.', 'Does the person who did this know where you live, work, or go to school?'],
    label: 'They know where you live, work, or study',
    options: YES_NO_UNSURE,
  },
  {
    id: 'safety.protective',
    phase: 'safety',
    kind: 'choice',
    say: [
      'A protective order is a court order that tells someone to stay away from you.',
      'Do you think you might want one?',
    ],
    label: 'Might want a protective order',
    options: YES_NO_UNSURE,
  },
  {
    id: 'safety.notes',
    phase: 'safety',
    kind: 'longtext',
    say: ['Is there anything else about your safety you want to write down?', 'For example: threats, messages, or places you avoid now.'],
    label: 'Safety notes',
  },

  // ── (l) Costs & losses ──
  {
    id: 'costs.intro',
    phase: 'costs',
    kind: 'info',
    say: [
      'Many states have a fund that helps pay for costs caused by a crime — like medical bills, counseling, or lost pay. It is called victim compensation.',
      'These questions help with that. Rough amounts or short notes are fine.',
    ],
    offerSkipSection: true,
  },
  {
    id: 'costs.amounts',
    phase: 'costs',
    kind: 'form',
    say: ['Have you had any of these costs? Fill in any that apply.'],
    label: 'Costs and losses',
    fields: [
      { key: 'medical', label: 'Medical costs', type: 'text' },
      { key: 'counseling', label: 'Counseling or therapy costs', type: 'text' },
      { key: 'wages', label: 'Lost pay from work', type: 'text' },
      { key: 'relocation', label: 'Moving or changing locks', type: 'text' },
      { key: 'other', label: 'Other costs', type: 'text' },
    ],
  },
  {
    id: 'costs.insurance',
    phase: 'costs',
    kind: 'choice',
    say: ['Do you have health insurance?'],
    label: 'Has health insurance',
    options: YES_NO_UNSURE,
  },
  {
    id: 'costs.insuranceCarrier',
    phase: 'costs',
    kind: 'text',
    showIf: is('costs.insurance', 'yes'),
    say: ['What is the name of your insurance company, if you know it?'],
    label: 'Insurance company',
  },
  {
    id: 'costs.work',
    phase: 'costs',
    kind: 'form',
    showIf: formFieldFilled('costs.amounts', 'wages'),
    say: ['You mentioned lost pay. If you want, add where you work and about which days you missed.'],
    label: 'Work you missed',
    fields: [
      { key: 'employer', label: 'Where you work', type: 'text' },
      { key: 'datesMissed', label: 'About which days you missed', type: 'text', hint: "For example: 'Aug 17 to Aug 30'." },
    ],
  },

  // ── (m) What she wants ──
  {
    id: 'goals.intro',
    phase: 'wishes',
    kind: 'info',
    say: [
      'Last part. What would you like to happen next?',
      'You do not have to decide anything today. "Not sure" is a perfectly good answer.',
      'Nothing happens unless you say so, at that moment. You can change your mind later.',
    ],
  },
  {
    id: 'goals.police',
    phase: 'wishes',
    kind: 'choice',
    say: ['Would you like help making a police report?'],
    label: 'Help with a police report',
    options: YES_NO_UNSURE,
  },
  {
    id: 'goals.attorney',
    phase: 'wishes',
    kind: 'choice',
    say: ['Would you like to talk with a free lawyer about your options?'],
    label: 'Talk with a free lawyer',
    options: YES_NO_UNSURE,
  },
  {
    id: 'goals.compensation',
    phase: 'wishes',
    kind: 'choice',
    say: ['Would you like help asking for victim compensation?'],
    label: 'Help with victim compensation',
    options: YES_NO_UNSURE,
  },
  {
    id: 'comp.intro',
    phase: 'wishes',
    kind: 'info',
    showIf: is('goals.compensation', 'yes', 'unsure'),
    say: [
      'The compensation form asks for a few more details. They are only used for that form, not for your account.',
      'You can skip any of them and add them later.',
    ],
    offerSkipSection: false,
  },
  {
    id: 'comp.mailing',
    phase: 'wishes',
    kind: 'form',
    showIf: is('goals.compensation', 'yes', 'unsure'),
    say: ['What mailing address is safe for letters about compensation?'],
    label: 'Safe mailing address',
    fields: [
      { key: 'street', label: 'Street address', type: 'text' },
      { key: 'city', label: 'City or town', type: 'text' },
      { key: 'state', label: 'State', type: 'select', options: US_STATES },
      { key: 'zip', label: 'ZIP code', type: 'text' },
    ],
  },
  {
    id: 'comp.claimant',
    phase: 'wishes',
    kind: 'choice',
    showIf: is('goals.compensation', 'yes', 'unsure'),
    say: ['Are you applying for yourself?'],
    label: 'Applying for yourself',
    options: CLAIMANT_OPTIONS,
  },
  {
    id: 'comp.claimantDetails',
    phase: 'wishes',
    kind: 'text',
    showIf: (d) => is('goals.compensation', 'yes', 'unsure')(d) && is('comp.claimant', 'other')(d),
    say: ['Who is applying for you, and how do you know them?'],
    label: 'Person applying for you',
  },
  {
    id: 'comp.altContact',
    phase: 'wishes',
    kind: 'form',
    showIf: is('goals.compensation', 'yes', 'unsure'),
    say: ['The form asks for one more person the office can contact if they cannot reach you. Only add someone you trust.'],
    label: 'Another person to contact',
    fields: [
      { key: 'name', label: 'Their name', type: 'text' },
      { key: 'relationship', label: 'How you know them', type: 'text' },
      { key: 'phone', label: 'Their phone', type: 'tel' },
      { key: 'email', label: 'Their email', type: 'email' },
    ],
  },
  {
    id: 'comp.goodCause',
    phase: 'wishes',
    kind: 'longtext',
    showIf: is('goals.compensation', 'yes', 'unsure'),
    say: [
      'If it has been a while since this happened, the form asks about the timing of a police report or of this application.',
      'Is there anything you want the compensation office to know about that? Many people wait. Any reason is okay to share.',
    ],
    label: 'About the timing',
    hint: 'Only if it applies to you.',
  },
  {
    id: 'goals.protective',
    phase: 'wishes',
    kind: 'choice',
    say: ['Would you like help asking for a protective order?'],
    label: 'Help with a protective order',
    options: YES_NO_UNSURE,
  },
  {
    id: 'wishes.access',
    phase: 'wishes',
    kind: 'form',
    say: ['If you talk with someone later, like an advocate or a lawyer, is there anything that would help?'],
    label: 'Interpreter or other help',
    fields: [
      { key: 'interpreter', label: 'Would you like an interpreter?', type: 'choice', options: YES_NO_UNSURE },
      { key: 'language', label: 'Which language?', type: 'text' },
      {
        key: 'otherNeeds',
        label: 'Anything else that would help',
        type: 'longtext',
        hint: 'For example: wheelchair access, sign language, large print, or having an advocate with you.',
      },
    ],
  },

  // ── (n) Review ──
  {
    id: 'review',
    phase: 'review',
    kind: 'review',
    say: ['Thank you. You did something hard today.'],
  },
];

// ───────────────────────── Story space: gentler questions (src/space) ─────────────────────────
//
//  The open "story space" asks the same questions as the interview above (same ids, same answers),
//  but only when she opens a topic, a few at a time. These are the shorter, warmer versions it shows.
//  `q` is the question. `hint` is the small line under it. Same style guide as above.

export const SPACE_PROMPTS: Record<string, { q: string; hint?: string }> = {
  'when.date': { q: 'When did this happen?', hint: "An exact date, a rough idea, or 'not sure' are all okay." },
  'when.repeated': { q: 'Did it happen more than once, or over a period of time?' },
  'when.lastDate': { q: 'When was the most recent time?' },
  'when.ongoing': { q: 'Is it still happening now?' },
  'when.time': { q: 'Do you remember about what time of day it was?', hint: "Anything helps, like 'late at night' or 'after dinner'." },
  'where.place': { q: 'Where did it happen? Describe it any way you can.', hint: "For example: 'his apartment' or 'in a car'." },
  'where.address': { q: 'If you know the address or the name of the place, you can add it.' },
  'where.area': { q: 'What city and state was it in?', hint: 'If it was at a school or college, you can add that too.' },

  'context.before': { q: 'What was happening earlier, before it happened?', hint: 'Where you were, who you were with.' },
  'context.after': { q: 'What happened afterward?', hint: 'There is no right way to react. Whatever you did is okay.' },
  'context.words': {
    q: 'Do you remember anything that was said?',
    hint: 'By them, or by anyone else. Word for word if you can. It is okay to write words that are hard to read.',
  },
  'recall.sight': { q: 'What do you remember seeing?', hint: 'The room, the light, colors, clothing — anything at all.' },
  'recall.sound': { q: 'What do you remember hearing?', hint: 'Voices, music, a TV, traffic.' },
  'recall.smell': { q: 'Do you remember any smells?', hint: 'Like smoke, alcohol, cologne, or food.' },
  'recall.touch': { q: 'Do you remember how anything felt?', hint: 'The temperature, a surface, fabric. Only what you are comfortable with.' },
  'recall.taste': { q: 'Do you remember any tastes?', hint: 'Like a drink that tasted different than usual.' },
  'recall.more': {
    q: 'Is there anything else that comes to mind?',
    hint: 'Some people find it helps to start from the last thing they remember and think backward.',
  },

  'details.force': { q: 'Were any of these part of what happened?', hint: 'Choose any that fit, or none.' },
  'details.forceWords': { q: 'If you want, describe it in your own words.' },
  'details.strangulation': { q: 'Did anyone press on your neck or throat, or put anything around it?' },
  'details.substances': {
    q: 'Were alcohol, drugs, or medicine part of that day or night, for anyone?',
    hint: "Choose any that fit, or none. Nothing you share here changes that it wasn't your fault.",
  },
  'details.incapacitated': { q: 'Were there times you could not move, speak, or remember — or times you were asleep or passed out?' },
  'details.substancesWords': { q: 'Is there anything you want to add about this, in your own words?' },
  'context.types': {
    q: 'Some people like to choose words for what happened. Some do not.',
    hint: 'Choose any that fit, or none. You do not need to put a label on it.',
  },

  'person.list': { q: 'What can you tell us about them?', hint: 'Fill in only what you know.' },
  'person.escrow': { q: 'Would you like a sealed match?' },
  'person.matchContact': {
    q: 'If there is ever a match, how would you like a counselor to reach you?',
    hint: 'Only a trained legal options counselor would use this — privately, and only if there is a match.',
  },

  'people.told': {
    q: 'Have you told anyone? You can add them here.',
    hint: 'A friend, family member, counselor — anyone. It is okay if you have not told anyone.',
  },
  'people.witnesses': {
    q: 'Was anyone else there or nearby — before, during, or after?',
    hint: 'Even someone who only saw you that day or night can matter.',
  },
  'prior.any': { q: 'Have you reported this anywhere?', hint: 'For example, to police, a school, an employer, or an app.' },
  'prior.list': { q: 'What do you remember about that report?', hint: 'Fill in only what you know.' },

  'medical.care': { q: 'Did you get any medical care afterward?', hint: 'It is okay if you did not.' },
  'medical.facility': { q: 'Where did you get care?' },
  'medical.date': { q: 'About when was that?' },
  'medical.exam': { q: 'Did you have a forensic exam?', hint: 'This is sometimes called a SANE exam or a "rape kit".' },
  'medical.kit': { q: 'A few details about the exam, if you know them.', hint: '"Not sure" is fine for any of them.' },
  'medical.injuries': {
    q: 'Were you hurt in any way?',
    hint: 'This includes things that have healed, like bruises or soreness. Only share what you are comfortable with.',
  },
  'evidence.upload': { q: 'Would you like to add photos, screenshots, or files?', hint: 'They are locked on this device before they are saved.' },
  'evidence.physical': {
    q: 'Do you still have anything physical from that day or night?',
    hint: 'Choose any, or none. You do not need to have kept anything.',
  },
  'evidence.physicalNotes': {
    q: 'If you want, write down where they are and how they are kept.',
    hint: 'A paper bag is best for clothing. Try not to wash anything you want to keep.',
  },

  'safety.access': { q: 'Does the person know where you live, work, or go to school?' },
  'safety.protective': {
    q: 'Do you think you might want a protective order?',
    hint: 'It is a court order that tells someone to stay away from you.',
  },
  'safety.notes': {
    q: 'Is there anything else about your safety you want to write down?',
    hint: 'For example: threats, messages, or places you avoid now.',
  },
  'about.contactMethods': {
    q: 'If someone you choose needs to reach you later, which ways are safe?',
    hint: 'Choose all that are safe. Only you decide who gets this.',
  },
  'about.phone': { q: 'What phone number is safe to use?' },
  'about.email': { q: 'What email address is safe to use?' },
  'about.contactNotes': {
    q: 'Anything people should know about contacting you safely?',
    hint: "For example: 'only text after 6pm' or 'please don't leave messages'.",
  },

  'goals.police': { q: 'Would you like help making a police report?' },
  'goals.attorney': { q: 'Would you like to talk with a free lawyer about your options?' },
  'goals.compensation': { q: 'Would you like help asking for victim compensation?', hint: 'It can help pay for things like medical bills, counseling, or lost pay.' },
  'comp.mailing': { q: 'What mailing address is safe for letters about compensation?' },
  'comp.claimant': { q: 'Are you applying for yourself?' },
  'comp.claimantDetails': { q: 'Who is applying for you, and how do you know them?' },
  'comp.altContact': { q: 'One more person the office can contact if they cannot reach you.', hint: 'Only add someone you trust.' },
  'comp.goodCause': {
    q: 'Is there anything you want the compensation office to know about timing?',
    hint: 'Many people wait. Any reason is okay to share. Only if it applies to you.',
  },
  'goals.protective': { q: 'Would you like help asking for a protective order?' },
  'wishes.access': { q: 'If you talk with someone later, is there anything that would help?' },

  'about.name': { q: 'What name would you like us to use for you?', hint: 'This can be a nickname.' },
  'about.pronouns': { q: 'What pronouns do you use, if you would like to share?', hint: 'For example: she/her, they/them, he/him.' },
  'about.language': { q: 'What language do you feel most comfortable using?' },
  'about.legalName': { q: 'Your full legal name, if you are comfortable.', hint: 'Police or a lawyer may need it later. You can leave it for now.' },
  'about.dob': { q: 'Your date of birth.', hint: 'This helps a lawyer know which rules apply to you.' },
  'about.home': { q: 'Where do you live now? Just the state and county is enough.', hint: 'This helps match you with help near you.' },

  'costs.amounts': { q: 'Have you had any of these costs?', hint: 'Rough amounts or short notes are fine.' },
  'costs.insurance': { q: 'Do you have health insurance?' },
  'costs.insuranceCarrier': { q: 'What is the name of your insurance company, if you know it?' },
  'costs.work': { q: 'Where do you work, and about which days did you miss?' },
};
