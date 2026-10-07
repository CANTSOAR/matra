/**
 * The story space's map: sections (shown in the story map) and the optional topics inside them.
 * Every word she sees here is plain and warm — see the style guide at the top of src/intake/script.ts.
 * Topics reuse the interview's questions (by step id), so both ways of telling it fill the same draft.
 */
import { isBlank, isVisible, stepById, type AnswerValue, type IntakeDraft } from '../intake/draft';
import type { ScriptStep } from '../intake/script';

export type SectionId = 'words' | 'whenWhere' | 'person' | 'people' | 'care' | 'safety' | 'support' | 'review';

export type TopicId =
  | 'remember'
  | 'details'
  | 'whenWhere'
  | 'person'
  | 'people'
  | 'reports'
  | 'care'
  | 'kept'
  | 'safety'
  | 'you'
  | 'next'
  | 'costs';

export type Status = 'filled' | 'partly' | 'notYet' | 'skipped';

export const STATUS_LABEL: Record<Status, string> = {
  filled: 'Filled',
  partly: 'Partly',
  notYet: 'Not yet',
  skipped: 'Skipped',
};

export interface Topic {
  id: TopicId;
  section: SectionId;
  title: string;
  /** One gentle line: how this might help her, if she wants it to. */
  why: string;
  /** Shown at the top when she opens it. */
  intro?: string;
  /** Question steps from src/intake/script.ts, in order. */
  steps: string[];
  /** Info steps shown as a gentle note when their showIf applies (e.g. a health note). */
  notes?: string[];
  /** Answering these is enough to call the topic "filled". Default: every visible question. */
  keySteps?: string[];
}

export interface Section {
  id: SectionId;
  title: string;
  topics: TopicId[];
}

export const TOPICS: Topic[] = [
  {
    id: 'whenWhere',
    section: 'whenWhere',
    title: 'When & where',
    why: 'This can help a lawyer know which rules and time limits apply.',
    intro: "A rough idea is fine. 'I'm not sure' is always okay.",
    steps: ['when.date', 'when.repeated', 'when.lastDate', 'when.ongoing', 'when.time', 'where.place', 'where.address', 'where.area'],
    keySteps: ['when.date', 'where.place'],
  },
  {
    id: 'remember',
    section: 'words',
    title: 'What you remember',
    why: 'Sounds, smells, or small moments can bring more back. Only if it feels okay.',
    intro: 'Memories often come back through the senses, and out of order. That is normal, and it matters.',
    steps: [
      'context.before',
      'context.after',
      'context.words',
      'recall.sight',
      'recall.sound',
      'recall.smell',
      'recall.touch',
      'recall.taste',
      'recall.more',
    ],
  },
  {
    id: 'details',
    section: 'words',
    title: 'A few specific things',
    why: 'A nurse or a lawyer might ask about these one day. Some may be hard to read.',
    intro: 'Choose any that fit, or none. You can stop at any time.',
    steps: [
      'details.force',
      'details.forceWords',
      'details.strangulation',
      'details.substances',
      'details.incapacitated',
      'details.substancesWords',
      'context.types',
    ],
    notes: ['details.strangulationInfo', 'details.toxInfo'],
    keySteps: ['details.force', 'details.strangulation', 'details.substances'],
  },
  {
    id: 'person',
    section: 'person',
    title: 'The person',
    why: 'Only what you know and feel okay sharing. Some people know them well, some not at all.',
    steps: ['person.list', 'person.escrow', 'person.matchContact'],
    keySteps: ['person.list'],
  },
  {
    id: 'people',
    section: 'people',
    title: 'People you told',
    why: 'People you told can sometimes support your account later. It is okay if you have told no one.',
    steps: ['people.told', 'people.witnesses'],
    keySteps: ['people.told'],
  },
  {
    id: 'reports',
    section: 'people',
    title: 'Earlier reports',
    why: 'If you have reported this somewhere, a case number can save you time later.',
    steps: ['prior.any', 'prior.list'],
    keySteps: ['prior.any'],
  },
  {
    id: 'care',
    section: 'care',
    title: 'Care you got',
    why: 'If you decide to ask for help with medical costs, this helps.',
    intro: 'It is okay if you did not get any care.',
    steps: ['medical.care', 'medical.facility', 'medical.date', 'medical.exam', 'medical.kit', 'medical.injuries'],
    notes: ['medical.examInfo'],
    keySteps: ['medical.care'],
  },
  {
    id: 'kept',
    section: 'care',
    title: "Things you've kept",
    why: 'Messages or photos can back up your words. You do not need to have any.',
    steps: ['evidence.upload', 'evidence.physical', 'evidence.physicalNotes'],
    notes: ['evidence.tips'],
    keySteps: ['evidence.physical'],
  },
  {
    id: 'safety',
    section: 'safety',
    title: 'Your safety',
    why: 'If you ever want a protective order, this helps.',
    steps: ['safety.access', 'safety.protective', 'safety.notes', 'about.contactMethods', 'about.phone', 'about.email', 'about.contactNotes'],
    keySteps: ['safety.access', 'safety.protective'],
  },
  {
    id: 'next',
    section: 'support',
    title: "What you'd like next",
    why: "Nothing happens unless you say so. 'Not sure' is a perfectly good answer.",
    steps: [
      'goals.police',
      'goals.attorney',
      'goals.compensation',
      'comp.mailing',
      'comp.claimant',
      'comp.claimantDetails',
      'comp.altContact',
      'comp.goodCause',
      'goals.protective',
      'wishes.access',
    ],
    notes: ['comp.intro'],
    keySteps: ['goals.police', 'goals.attorney', 'goals.compensation', 'goals.protective'],
  },
  {
    id: 'you',
    section: 'support',
    title: 'About you',
    why: 'So anyone you choose to talk to can use the name and language you like.',
    steps: ['about.name', 'about.pronouns', 'about.language', 'about.legalName', 'about.dob', 'about.home'],
    keySteps: ['about.name'],
  },
  {
    id: 'costs',
    section: 'support',
    title: 'Costs & losses',
    why: 'If you decide to apply for compensation, this helps.',
    intro: 'Many states have a fund that helps with costs like medical bills, counseling, or lost pay. Rough amounts are fine.',
    steps: ['costs.amounts', 'costs.insurance', 'costs.insuranceCarrier', 'costs.work'],
    keySteps: ['costs.amounts'],
  },
];

export const SECTIONS: Section[] = [
  { id: 'words', title: 'Your words', topics: ['remember', 'details'] },
  { id: 'whenWhere', title: 'When & where', topics: ['whenWhere'] },
  { id: 'person', title: 'The person', topics: ['person'] },
  { id: 'people', title: 'People who know', topics: ['people', 'reports'] },
  { id: 'care', title: 'Care & evidence', topics: ['care', 'kept'] },
  { id: 'safety', title: 'Safety', topics: ['safety'] },
  { id: 'support', title: 'Support you want', topics: ['next', 'you', 'costs'] },
  { id: 'review', title: 'Review', topics: [] },
];

const topicIndex = new Map(TOPICS.map((t) => [t.id, t]));
export function topicById(id: TopicId): Topic {
  return topicIndex.get(id)!;
}
export function sectionById(id: SectionId): Section {
  return SECTIONS.find((s) => s.id === id)!;
}
/** Topic a script step belongs to, if any. */
export function topicOfStep(stepId: string): Topic | undefined {
  return TOPICS.find((t) => t.steps.includes(stepId) || t.notes?.includes(stepId));
}

/** Draft with unsaved topic answers laid over it, so follow-up questions appear as she answers. */
export function withPending(d: IntakeDraft, pending: Record<string, AnswerValue> | undefined): IntakeDraft {
  if (!pending || !Object.keys(pending).length) return d;
  return { ...d, answers: { ...d.answers, ...pending } };
}

/** The question steps of a topic that currently apply (showIf). */
export function topicSteps(d: IntakeDraft, t: Topic): ScriptStep[] {
  return t.steps
    .map((id) => stepById(id))
    .filter((s): s is ScriptStep => !!s && s.kind !== 'info' && isVisible(d, s));
}

function answered(d: IntakeDraft, id: string): boolean {
  return !isBlank(d.answers[id]);
}

export function topicStatus(d: IntakeDraft, t: Topic): Status {
  const steps = topicSteps(d, t);
  const anyAnswered = steps.some((s) => answered(d, s.id));
  if (!anyAnswered && d.space?.skippedTopics?.includes(t.id)) return 'skipped';
  if (!anyAnswered && steps.length > 0 && steps.every((s) => d.skipped.includes(s.id))) return 'skipped';
  if (!anyAnswered) return 'notYet';
  const key = (t.keySteps ?? steps.map((s) => s.id)).filter((id) => steps.some((s) => s.id === id));
  const keyDone = key.every((id) => answered(d, id));
  const allSeen = steps.every((s) => answered(d, s.id) || d.skipped.includes(s.id));
  return keyDone || allSeen ? 'filled' : 'partly';
}

export function hasWords(d: IntakeDraft): boolean {
  return (d.entries?.length ?? 0) > 0 || !isBlank(d.answers['story.freeRecall']);
}

export function sectionStatus(d: IntakeDraft, s: Section): Status {
  if (s.id === 'words') return hasWords(d) ? 'filled' : 'notYet';
  if (s.id === 'review') return d.reachedReview ? 'partly' : 'notYet';
  const st = s.topics.map((id) => topicStatus(d, topicById(id)));
  if (st.every((x) => x === 'filled')) return 'filled';
  if (st.every((x) => x === 'skipped')) return 'skipped';
  if (st.some((x) => x === 'filled' || x === 'partly')) return 'partly';
  return 'notYet';
}

/** Status line for the review entry in the map. */
export function reviewLabel(d: IntakeDraft): string {
  return d.reachedReview ? 'Looked over' : 'Not yet';
}

// ───────────── paging: 1–3 short questions at a time ─────────────

const BIG_KINDS = new Set(['group', 'form', 'escrow', 'evidence']);
function weight(s: ScriptStep): number {
  if (BIG_KINDS.has(s.kind)) return 3;
  if (s.kind === 'longtext') return 2;
  return 1;
}

/**
 * Split the topic's current questions into small pages. A big question (a list of people, a form) stands
 * alone; otherwise up to three short ones share a page. A follow-up stays on the same page as the
 * question it depends on, so it can appear right under it.
 */
export function pagesOf(steps: ScriptStep[]): ScriptStep[][] {
  const pages: ScriptStep[][] = [];
  let cur: ScriptStep[] = [];
  let w = 0;
  for (const s of steps) {
    const sw = weight(s);
    if (cur.length && (w + sw > 3 || cur.length >= 3)) {
      pages.push(cur);
      cur = [];
      w = 0;
    }
    cur.push(s);
    w += sw;
  }
  if (cur.length) pages.push(cur);
  return pages;
}
