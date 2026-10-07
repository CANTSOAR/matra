import { useEffect, useMemo, useRef, useState } from 'react';
import { isVisible, stepById, type AnswerValue, type IntakeDraft } from '../intake/draft';
import { Resources } from '../intake/IntakeChat';
import { STEPS, type ScriptStep } from '../intake/script';
import { COPY } from './copy';
import { StepField } from './fields';
import { savePage, setTopicPending, skipTopic } from './ops';
import { StatusIcon } from './StoryMap';
import {
  STATUS_LABEL,
  TOPICS,
  pagesOf,
  sectionById,
  topicById,
  topicStatus,
  topicSteps,
  withPending,
  type Topic,
  type TopicId,
} from './topics';

/**
 * Which gaps matter most, in order. When she has written nothing yet, the gentlest ways in come first;
 * once she has, the details a lawyer or advocate most often needs (and her words rarely cover) come first.
 */
const PRIORITY_EMPTY: TopicId[] = ['whenWhere', 'remember', 'person', 'people', 'kept', 'care', 'safety', 'next', 'reports', 'details', 'you', 'costs'];
const PRIORITY_WORDS: TopicId[] = ['whenWhere', 'person', 'people', 'kept', 'care', 'safety', 'next', 'remember', 'reports', 'details', 'you', 'costs'];

export function orderTopics(draft: IntakeDraft, empty: boolean): Array<{ t: Topic; status: ReturnType<typeof topicStatus> }> {
  const priority = empty ? PRIORITY_EMPTY : PRIORITY_WORDS;
  const rank = (id: TopicId) => {
    const i = priority.indexOf(id);
    return i === -1 ? priority.length + TOPICS.findIndex((t) => t.id === id) : i;
  };
  const rows = TOPICS.map((t) => ({ t, status: topicStatus(draft, t) }));
  // Gaps first (a topic she has started counts as a gap), most useful first; what she has done settles to the end.
  const order = { notYet: 0, partly: 0, skipped: 1, filled: 2 } as const;
  return rows.sort((a, b) => order[a.status] - order[b.status] || rank(a.t.id) - rank(b.t.id));
}

export function TopicCards({ draft, onOpen, empty }: { draft: IntakeDraft; onOpen: (id: TopicId) => void; empty: boolean }) {
  const rows = orderTopics(draft, empty);
  const allSeen = rows.every((r) => r.status === 'filled' || r.status === 'skipped');
  const [all, setAll] = useState(false);
  const LIMIT = 4;
  const shown = all ? rows : rows.slice(0, LIMIT);
  return (
    <section className="space-section space-topics" aria-labelledby="space-topics-title">
      <h2 id="space-topics-title" className="space-h2">
        {COPY.topics.title}
      </h2>
      <p className="space-lead">{allSeen ? COPY.topics.allDone : empty ? COPY.topics.leadEmpty : COPY.topics.leadMore}</p>
      <ul className="space-topic-grid">
        {shown.map(({ t, status }) => (
          <li key={t.id}>
            <button
              type="button"
              className={`space-topic is-${status}`}
              data-topic={t.id}
              onClick={() => onOpen(t.id)}
              aria-describedby={`space-topic-why-${t.id}`}
            >
              <span className="space-topic-head">
                <span className="space-topic-title">{t.title}</span>
                <span className="space-topic-status">
                  <StatusIcon status={status} />
                  {STATUS_LABEL[status]}
                </span>
              </span>
              <span className="space-topic-why" id={`space-topic-why-${t.id}`}>
                {t.why}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {rows.length > LIMIT && (
        <button type="button" className="space-btn space-btn-link space-show-more" aria-expanded={all} onClick={() => setAll((a) => !a)}>
          {all ? COPY.topics.showFewer : COPY.topics.showAll(rows.length)}
        </button>
      )}
    </section>
  );
}

// ───────────── an open topic: a few questions at a time ─────────────

const stepOrder = new Map(STEPS.map((s, i) => [s.id, i]));

function visibleQuestionIds(d: IntakeDraft, t: Topic, fromIdx: number): string[] {
  return t.steps.slice(fromIdx).filter((id) => {
    const s = stepById(id);
    return !!s && s.kind !== 'info' && isVisible(d, s);
  });
}

/** The first few questions from `fromIdx` — fixed when the page opens, so nothing jumps while she answers. */
function baseFor(d: IntakeDraft, t: Topic, fromIdx: number): string[] {
  const steps = visibleQuestionIds(d, t, fromIdx).map((id) => stepById(id)!) as ScriptStep[];
  return (pagesOf(steps)[0] ?? []).map((s) => s.id);
}

/**
 * What the page shows now: its questions, plus any follow-up that appears between them as she answers
 * (e.g. "describe it in your own words" right under the question it follows). Follow-ups after the last
 * question wait for the next page, so a page never balloons.
 */
function pageIdsFor(d: IntakeDraft, t: Topic, base: string[]): string[] {
  if (!base.length) return [];
  const first = t.steps.indexOf(base[0]);
  const last = t.steps.indexOf(base[base.length - 1]);
  return t.steps.slice(first, last + 1).filter((id) => {
    const s = stepById(id);
    return !!s && s.kind !== 'info' && isVisible(d, s);
  });
}

function notesFor(d: IntakeDraft, t: Topic, ids: string[]): ScriptStep[] {
  if (!ids.length || !t.notes) return [];
  const lo = Math.min(...ids.map((id) => stepOrder.get(id)!)) - 1;
  const hi = Math.max(...ids.map((id) => stepOrder.get(id)!)) + 1;
  return t.notes
    .map((id) => stepById(id)!)
    .filter((s) => !!s && isVisible(d, s) && stepOrder.get(s.id)! >= lo && stepOrder.get(s.id)! <= hi);
}

function startIndex(d: IntakeDraft, t: Topic): number {
  const qs = visibleQuestionIds(d, t, 0);
  const open = qs.find((id) => d.answers[id] === undefined && !d.skipped.includes(id));
  return open ? t.steps.indexOf(open) : 0;
}

function Note({ step }: { step: ScriptStep }) {
  return (
    <aside className="space-note" data-step={step.id}>
      {step.say.map((l) => (
        <p key={l}>{l}</p>
      ))}
      {step.bullets && (
        <ul>
          {step.bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {step.kind === 'info' && step.showResources && <Resources />}
    </aside>
  );
}

export function TopicPanel({
  topicId,
  draft,
  setDraft,
  onClose,
  onOpenTopic,
  onAddFiles,
}: {
  topicId: TopicId;
  draft: IntakeDraft;
  setDraft: (d: IntakeDraft, immediate: boolean) => void;
  onClose: () => void;
  onOpenTopic: (id: TopicId) => void;
  onAddFiles?: (files: File[]) => Promise<number>;
}) {
  const t = topicById(topicId);
  const [values, setValues] = useState<Record<string, AnswerValue>>(() => {
    const p = draft.space?.pending ?? {};
    return Object.fromEntries(Object.entries(p).filter(([k]) => t.steps.includes(k)));
  });
  const live = withPending(draft, values);
  const [from, setFrom] = useState(() => startIndex(draft, t));
  const [history, setHistory] = useState<number[]>([]);
  const [base, setBase] = useState<string[]>(() => baseFor(live, t, from));
  const ids = pageIdsFor(live, t, base);
  const finished = base.length === 0;
  const headingRef = useRef<HTMLHeadingElement>(null);

  const allPages = useMemo(() => pagesOf(topicSteps(live, t)), [live, t]);
  const pageNo = Math.max(1, allPages.findIndex((p) => p.some((s) => s.id === base[0])) + 1);

  // A new page: move focus to the top of it (screen readers hear the topic again, keyboard starts at the top).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
  }, [from, finished]);

  const goNext = (d: IntakeDraft) => {
    const lastIdx = ids.length ? t.steps.indexOf(ids[ids.length - 1]) + 1 : t.steps.length;
    setHistory((h) => [...h, from]);
    setFrom(lastIdx);
    setBase(baseFor(d, t, lastIdx));
  };

  const touchedHere = () => Object.fromEntries(Object.entries(values).filter(([k]) => ids.includes(k)));

  const onChange = (id: string, v: AnswerValue) => {
    const next = { ...values, [id]: v };
    setValues(next);
    setDraft(setTopicPending(draft, { ...(draft.space?.pending ?? {}), ...next }), false);
  };

  const dropValues = (keys: string[]) => setValues((vs) => Object.fromEntries(Object.entries(vs).filter(([k]) => !keys.includes(k))));

  const save = () => {
    const d = savePage(draft, ids, touchedHere());
    setDraft(d, true);
    dropValues(ids);
    goNext(d);
  };
  const skip = () => {
    const d = savePage(draft, ids, {}, 'skip');
    setDraft(d, true);
    dropValues(ids);
    goNext(d);
  };
  /** Keep anything typed on this page (nothing marked skipped), then leave. */
  const keepTyped = () => {
    let d = savePage(draft, ids, touchedHere(), 'keep');
    d = setTopicPending(d, Object.fromEntries(Object.entries(d.space?.pending ?? {}).filter(([k]) => !t.steps.includes(k))));
    setDraft(d, true);
  };
  const enough = () => {
    keepTyped();
    onClose();
  };
  const back = () => {
    const prev = history[history.length - 1];
    if (prev === undefined) return;
    setHistory((h) => h.slice(0, -1));
    setFrom(prev);
    setBase(baseFor(live, t, prev));
  };
  const skipWhole = () => {
    setDraft(skipTopic(draft, t.id), true);
    onClose();
  };
  const restart = () => {
    setHistory([]);
    setFrom(0);
    setBase(baseFor(live, t, 0));
  };

  const section = sectionById(t.section);
  const siblings = section.topics.filter((x) => x !== t.id).map(topicById);
  const notes = notesFor(live, t, ids);
  const items: ScriptStep[] = [...ids.map((id) => stepById(id)!), ...notes].sort(
    (a, b) => stepOrder.get(a.id)! - stepOrder.get(b.id)!,
  );
  const anyAnswered = topicSteps(draft, t).some((s) => draft.answers[s.id] !== undefined);

  return (
    <section className="space-panel" aria-labelledby="space-panel-title" data-topic-panel={t.id}>
      <button type="button" className="space-back" onClick={enough}>
        <span aria-hidden="true">←</span> {COPY.backToStory}
      </button>
      {section.title !== t.title && <p className="space-eyebrow">{section.title}</p>}
      <h2 id="space-panel-title" className="space-display space-display-sm" ref={headingRef} tabIndex={-1}>
        {t.title}
      </h2>
      {!finished && (
        <>
          <p className="space-lead">{from === startIndex(draft, t) && history.length === 0 && t.intro ? t.intro : t.why}</p>
          {allPages.length > 1 && (
            <p className="space-progress" aria-label={`Part ${pageNo} of ${allPages.length} in this topic`}>
              {allPages.map((_, i) => (
                <span key={i} className={`space-progress-dot${i + 1 === pageNo ? ' is-current' : i + 1 < pageNo ? ' is-past' : ''}`} />
              ))}
              <span className="space-progress-text">{COPY.panel.step(pageNo, allPages.length)}</span>
            </p>
          )}
          <form
            className="space-page"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            {items.map((s) =>
              s.kind === 'info' ? (
                <Note key={s.id} step={s} />
              ) : (
                <StepField
                  key={s.id}
                  step={s}
                  value={s.id in values ? values[s.id] : draft.answers[s.id]}
                  onChange={(v) => onChange(s.id, v)}
                  draft={live}
                  onAddFiles={onAddFiles}
                />
              ),
            )}
            <div className="space-page-actions">
              <button type="submit" className="space-btn space-btn-primary">
                {COPY.panel.next}
              </button>
              <button type="button" className="space-btn space-btn-secondary" onClick={skip}>
                {COPY.panel.skip}
              </button>
              <button type="button" className="space-btn space-btn-quiet" onClick={enough}>
                {COPY.panel.enough}
              </button>
            </div>
            <div className="space-page-foot">
              {history.length > 0 && (
                <button type="button" className="space-btn space-btn-link" onClick={back}>
                  ← {COPY.panel.back}
                </button>
              )}
              {!anyAnswered && history.length === 0 && (
                <button type="button" className="space-btn space-btn-link" onClick={skipWhole}>
                  {COPY.panel.skipTopic}
                </button>
              )}
            </div>
          </form>
        </>
      )}
      {finished && (
        <div className="space-finished" role="status">
          <p className="space-lead">
            <strong>{COPY.panel.done}</strong> {COPY.panel.doneLead}
          </p>
          <div className="space-actions">
            <button type="button" className="space-btn space-btn-primary" onClick={onClose}>
              {COPY.backToStory}
            </button>
            <button type="button" className="space-btn space-btn-quiet" onClick={restart}>
              {COPY.topics.revisit}
            </button>
          </div>
        </div>
      )}
      {siblings.length > 0 && (
        <div className="space-siblings">
          <p className="space-eyebrow">{COPY.panel.alsoHere}</p>
          <ul>
            {siblings.map((s) => {
              const st = topicStatus(draft, s);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    className="space-btn space-btn-link"
                    onClick={() => {
                      keepTyped();
                      onOpenTopic(s.id);
                    }}
                  >
                    <StatusIcon status={st} /> {s.title} <span className="space-hint-inline">· {STATUS_LABEL[st]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
