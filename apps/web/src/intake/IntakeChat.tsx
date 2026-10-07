import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { IntakeRecord } from '@matra/shared';
import './intake.css';
import {
  answerOf,
  currentStep,
  emptyDraft,
  firstStepAfterPhase,
  firstStepOfPhase,
  formatAnswer,
  isVisible,
  nextStepId,
  phaseIndex,
  prevStepId,
  stepById,
  visibleSteps,
  type AnswerValue,
  type IntakeDraft,
} from './draft';
import { draftToRecord } from './record';
import { BREAK, PHASES, RESOURCES, STEPS, UI, type EvidenceStep, type InfoStep, type ScriptStep } from './script';
import {
  ApproxDateInput,
  ChoiceInput,
  DateInput,
  EscrowInput,
  FormInput,
  GroupInput,
  LongTextInput,
  MultiInput,
  SelectInput,
  TextInput,
} from './inputs';

export interface IntakeChatProps {
  /** Resume from a draft the shell decrypted. */
  initialDraft?: IntakeDraft;
  /** Called with every change (typing is debounced). The shell encrypts + persists; this module never stores anything. */
  onDraftChange?: (d: IntakeDraft) => void;
  /** Called once when she seals her account on the review screen. */
  onComplete: (record: IntakeRecord) => void;
  /** Called when she chooses to add evidence files. */
  onRequestEvidenceUpload?: () => void;
  /** "Leave this page now" on the safety screen. Default: replace this page with a neutral site. */
  onExit?: () => void;
}

const PENDING_DEBOUNCE_MS = 500;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function defaultExit() {
  window.location.replace('https://www.google.com/');
}

export function IntakeChat({ initialDraft, onDraftChange, onComplete, onRequestEvidenceUpload, onExit }: IntakeChatProps) {
  const [draft, setDraftState] = useState<IntakeDraft>(() => initialDraft ?? emptyDraft());
  const [breakOpen, setBreakOpen] = useState(false);
  const [sealed, setSealed] = useState(false);

  const draftRef = useRef(draft);
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = useCallback(() => {
    if (timer.current !== undefined) {
      clearTimeout(timer.current);
      timer.current = undefined;
    }
    onDraftChangeRef.current?.(draftRef.current);
  }, []);

  const setDraft = useCallback(
    (next: IntakeDraft, immediate: boolean) => {
      draftRef.current = next;
      setDraftState(next);
      if (immediate) flush();
      else {
        if (timer.current !== undefined) clearTimeout(timer.current);
        timer.current = setTimeout(flush, PENDING_DEBOUNCE_MS);
      }
    },
    [flush],
  );

  // Never lose typed words on unmount.
  useEffect(
    () => () => {
      if (timer.current !== undefined) flush();
    },
    [flush],
  );

  const step = currentStep(draft);
  const phase = PHASES[phaseIndex(step.phase)];

  // ───────────── navigation ─────────────

  const goTo = (id: string | undefined, base: IntakeDraft = draftRef.current) => {
    if (!id) return;
    const target = stepById(id);
    const next: IntakeDraft = {
      ...base,
      stepId: id,
      visited: base.visited.includes(id) ? base.visited : [...base.visited, id],
      reachedReview: base.reachedReview || target?.kind === 'review',
      pending: undefined,
      updatedAt: new Date().toISOString(),
    };
    setDraft(next, true);
  };

  const commit = (s: ScriptStep, value: AnswerValue | undefined) => {
    const d = draftRef.current;
    const answers = { ...d.answers };
    let skipped = d.skipped.filter((x) => x !== s.id);
    if (value === undefined) {
      delete answers[s.id];
      skipped = [...skipped, s.id];
    } else {
      answers[s.id] = value;
    }
    const base = { ...d, answers, skipped };
    goTo(nextStepId(base, s.id), base);
  };

  const setPending = (s: ScriptStep, value: AnswerValue) => {
    setDraft({ ...draftRef.current, pending: { stepId: s.id, value }, updatedAt: new Date().toISOString() }, false);
  };

  const back = () => goTo(prevStepId(draftRef.current, step.id));

  // ───────────── focus + scroll on step change ─────────────

  const answerRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLDivElement>(null);
  const breakBtnRef = useRef<HTMLButtonElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const target = answerRef.current?.querySelector<HTMLElement>(
      '[data-intake-focus], input:not([type=checkbox]), textarea, select, button',
    );
    target?.focus({ preventScroll: true });
    currentRef.current?.scrollIntoView?.({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [draft.stepId]);

  // ───────────── break panel ─────────────

  const openBreak = () => {
    flush();
    setBreakOpen(true);
  };
  const closeBreak = useCallback(() => {
    setBreakOpen(false);
    setTimeout(() => breakBtnRef.current?.focus(), 0);
  }, []);

  // ───────────── sealing ─────────────

  const seal = () => {
    flush();
    onComplete(draftToRecord(draftRef.current));
    setSealed(true);
  };

  // ───────────── render ─────────────

  const pIdx = phaseIndex(step.phase);
  const maxVisitedPhase = Math.max(
    0,
    ...draft.visited.map((id) => {
      const s = stepById(id);
      return s ? phaseIndex(s.phase) : 0;
    }),
  );

  const visible = visibleSteps(draft);
  const curIdx = visible.findIndex((s) => s.id === step.id);
  const earlier = visible
    .slice(0, curIdx)
    .filter((s) => s.phase === step.phase && (draft.visited.includes(s.id) || s.id in draft.answers));

  const initialFor = (s: ScriptStep) =>
    draft.pending?.stepId === s.id ? draft.pending.value : draft.answers[s.id];

  if (sealed) {
    return (
      <div className="intake-root">
        <main className="intake-chat intake-sealed" aria-live="polite">
          <h1 className="intake-title" tabIndex={-1}>
            {UI.review.sealedTitle}
          </h1>
          {UI.review.sealedBody.map((l) => (
            <p key={l} className="intake-bubble intake-bubble-bot">
              {l}
            </p>
          ))}
        </main>
      </div>
    );
  }

  return (
    <div className="intake-root">
      <header className="intake-header" inert={breakOpen || undefined}>
        <div className="intake-header-row">
          <h1 className="intake-title">{UI.appTitle}</h1>
          <button ref={breakBtnRef} type="button" className="intake-btn intake-btn-break" onClick={openBreak}>
            {UI.takeBreak}
          </button>
        </div>
        <p className="intake-progress-text">{UI.progress(pIdx + 1, PHASES.length, phase.title)}</p>
        <div className="intake-progress" aria-hidden="true">
          {PHASES.map((p, i) => (
            <span
              key={p.id}
              className={`intake-progress-seg${i < pIdx ? ' is-done' : ''}${i === pIdx ? ' is-current' : ''}`}
            />
          ))}
        </div>
        <details className="intake-sections">
          <summary>{UI.sectionsMenu}</summary>
          <ol>
            {PHASES.map((p, i) => {
              const reachable = i <= maxVisitedPhase && !!firstStepOfPhase(draft, p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className="intake-section-link"
                    disabled={!reachable}
                    aria-current={i === pIdx ? 'step' : undefined}
                    onClick={(e) => {
                      (e.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
                      goTo(firstStepOfPhase(draftRef.current, p.id));
                    }}
                  >
                    {p.title}
                  </button>
                </li>
              );
            })}
          </ol>
        </details>
      </header>

      <main className="intake-chat" inert={breakOpen || undefined}>
        <h2 className="intake-phase-title">{phase.title}</h2>

        {earlier.length > 0 && (
          <ol className="intake-log">
            {earlier.map((s) => (
              <li key={s.id} className="intake-turn">
                <BotLines step={s} />
                {s.kind !== 'info' && <MyAnswer step={s} draft={draft} onChange={() => goTo(s.id)} />}
              </li>
            ))}
          </ol>
        )}

        <div ref={currentRef} className="intake-current" aria-live="polite" aria-atomic="false">
          <BotLines key={step.id} step={step} />
        </div>

        <div ref={answerRef} className="intake-answer-area" data-step-id={step.id} data-step-kind={step.kind}>
          {step.kind === 'review' ? (
            <Review draft={draft} onEdit={(p) => goTo(firstStepOfPhase(draftRef.current, p))} onSeal={seal} />
          ) : step.kind === 'info' ? (
            <InfoActions
              step={step}
              onContinue={() => goTo(nextStepId(draftRef.current, step.id))}
              onSkipSection={() => goTo(firstStepAfterPhase(draftRef.current, step.phase))}
              onLeave={onExit ?? defaultExit}
            />
          ) : step.kind === 'evidence' ? (
            <EvidenceActions
              step={step}
              canUpload={!!onRequestEvidenceUpload}
              onUpload={() => {
                onRequestEvidenceUpload?.();
                commit(step, 'requested');
              }}
              onLater={() => commit(step, undefined)}
            />
          ) : (
            <StepInput
              key={step.id}
              step={step}
              draft={draft}
              initial={initialFor(step)}
              onPending={(v) => setPending(step, v)}
              onSubmit={(v) => commit(step, v)}
              onSkip={() => commit(step, undefined)}
            />
          )}
        </div>

        <nav className="intake-footer" aria-label="Move between questions">
          {prevStepId(draft, step.id) && (
            <button type="button" className="intake-btn intake-btn-quiet" onClick={back}>
              ← {UI.back}
            </button>
          )}
          {draft.reachedReview && step.kind !== 'review' && (
            <button type="button" className="intake-btn intake-btn-secondary" onClick={() => goTo('review')}>
              {UI.backToReview}
            </button>
          )}
        </nav>
      </main>

      {breakOpen && <BreakPanel onClose={closeBreak} />}
    </div>
  );
}

// ───────────── pieces ─────────────

function BotLines({ step }: { step: ScriptStep }) {
  const last = step.say.length - 1;
  return (
    <div className="intake-bot">
      {step.say.map((line, i) => (
        <div key={i} className="intake-bubble intake-bubble-bot">
          <span className="intake-visually-hidden">{UI.assistantSaid}: </span>
          {line}
          {i === last && step.bullets && (
            <ul className="intake-bullets">
              {step.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function MyAnswer({ step, draft, onChange }: { step: ScriptStep; draft: IntakeDraft; onChange: () => void }) {
  const value = answerOf(draft, step.id);
  const skipped = value === undefined;
  return (
    <div className="intake-me">
      <div className={`intake-bubble intake-bubble-me${skipped ? ' is-skipped' : ''}`}>
        <span className="intake-visually-hidden">{UI.youSaid}: </span>
        {skipped ? UI.skippedBubble : formatAnswer(step, value, draft)}
      </div>
      <button
        type="button"
        className="intake-link"
        onClick={onChange}
        aria-label={'label' in step ? `${UI.change}: ${step.label}` : UI.change}
      >
        {UI.change}
      </button>
    </div>
  );
}

function Resources() {
  return (
    <div className="intake-resources" role="region" aria-label={RESOURCES.heading}>
      <p className="intake-resources-heading">{RESOURCES.heading}</p>
      <ul>
        {RESOURCES.items.map((r) => (
          <li key={r.href}>
            <span className="intake-resource-label">{r.label}</span>
            <a
              className="intake-btn intake-btn-resource"
              href={r.href}
              {...(r.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
              {r.text}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InfoActions({
  step,
  onContinue,
  onSkipSection,
  onLeave,
}: {
  step: InfoStep;
  onContinue: () => void;
  onSkipSection: () => void;
  onLeave: () => void;
}) {
  return (
    <div className="intake-answer">
      {step.showResources && <Resources />}
      <div className="intake-actions">
        <button type="button" className="intake-btn intake-btn-primary" onClick={onContinue}>
          {step.continueLabel ?? UI.continue}
        </button>
        {step.offerSkipSection && (
          <button type="button" className="intake-btn intake-btn-quiet" onClick={onSkipSection}>
            {UI.skipSection}
          </button>
        )}
        {step.showLeave && (
          <button type="button" className="intake-btn intake-btn-secondary" onClick={onLeave}>
            {UI.leaveNow}
          </button>
        )}
      </div>
    </div>
  );
}

function EvidenceActions({
  step,
  canUpload,
  onUpload,
  onLater,
}: {
  step: EvidenceStep;
  canUpload: boolean;
  onUpload: () => void;
  onLater: () => void;
}) {
  return (
    <div className="intake-answer" role="group" aria-label={step.label}>
      <div className="intake-actions">
        {canUpload && (
          <button type="button" className="intake-btn intake-btn-primary" onClick={onUpload}>
            {step.uploadLabel}
          </button>
        )}
        <button type="button" className={`intake-btn ${canUpload ? 'intake-btn-secondary' : 'intake-btn-primary'}`} onClick={onLater}>
          {canUpload ? step.laterLabel : UI.continue}
        </button>
      </div>
    </div>
  );
}

function StepInput({
  step,
  draft,
  initial,
  onPending,
  onSubmit,
  onSkip,
}: {
  step: ScriptStep;
  draft: IntakeDraft;
  initial: AnswerValue | undefined;
  onPending: (v: AnswerValue) => void;
  onSubmit: (v: AnswerValue | undefined) => void;
  onSkip: () => void;
}): ReactNode {
  const common = { initial, onPending, onSubmit, onSkip };
  switch (step.kind) {
    case 'text':
      return <TextInput step={step} {...common} />;
    case 'longtext':
      return <LongTextInput step={step} {...common} />;
    case 'date':
      return <DateInput step={step} {...common} />;
    case 'approxDate':
      return <ApproxDateInput step={step} {...common} />;
    case 'choice':
      return <ChoiceInput step={step} {...common} />;
    case 'multi':
      return <MultiInput step={step} {...common} />;
    case 'select':
      return <SelectInput step={step} {...common} />;
    case 'form':
      return <FormInput step={step} {...common} />;
    case 'group':
      return <GroupInput step={step} {...common} />;
    case 'escrow':
      return <EscrowInput step={step} draft={draft} {...common} />;
    default:
      return null;
  }
}

function Review({ draft, onEdit, onSeal }: { draft: IntakeDraft; onEdit: (p: (typeof PHASES)[number]['id']) => void; onSeal: () => void }) {
  return (
    <section className="intake-review" aria-labelledby="intake-review-title">
      <h2 id="intake-review-title" className="intake-review-title" tabIndex={-1} data-intake-focus>
        {UI.review.title}
      </h2>
      {UI.review.intro.map((l) => (
        <p key={l} className="intake-hint">
          {l}
        </p>
      ))}
      {PHASES.filter((p) => p.id !== 'review').map((p) => {
        const qs = STEPS.filter((s) => s.phase === p.id && s.kind !== 'info' && isVisible(draft, s));
        if (qs.length === 0) return null;
        return (
          <section key={p.id} className="intake-review-section" aria-label={p.title}>
            <div className="intake-review-head">
              <h3>{p.title}</h3>
              <button type="button" className="intake-btn intake-btn-secondary intake-btn-small" onClick={() => onEdit(p.id)} aria-label={`${UI.edit}: ${p.title}`}>
                {UI.edit}
              </button>
            </div>
            <dl>
              {qs.map((s) => {
                const v = answerOf(draft, s.id);
                const label = 'label' in s ? s.label : s.id;
                return (
                  <div key={s.id} className="intake-review-row">
                    <dt>{label}</dt>
                    <dd className={v === undefined ? 'is-empty' : 'intake-verbatim'}>
                      {v === undefined
                        ? draft.skipped.includes(s.id)
                          ? UI.skippedReview
                          : UI.notAnswered
                        : formatAnswer(s, v, draft)}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        );
      })}
      <div className="intake-seal">
        <p>{UI.review.sealExplain}</p>
        <button type="button" className="intake-btn intake-btn-primary intake-btn-seal" onClick={onSeal}>
          {UI.review.seal}
        </button>
      </div>
    </section>
  );
}

function BreakPanel({ onClose }: { onClose: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="intake-overlay">
      <div className="intake-break" role="dialog" aria-modal="true" aria-labelledby="intake-break-title">
        <h2 id="intake-break-title" ref={headingRef} tabIndex={-1}>
          {BREAK.title}
        </h2>
        {BREAK.reassure.map((l) => (
          <p key={l}>{l}</p>
        ))}
        <div className="intake-breathe" aria-hidden="true">
          <span className="intake-breathe-circle" />
          <span className="intake-breathe-text">{BREAK.breathe}</span>
        </div>
        <p className="intake-break-sub">{BREAK.groundingTitle}</p>
        <ol className="intake-grounding">
          {BREAK.grounding.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ol>
        <Resources />
        <button type="button" className="intake-btn intake-btn-primary" onClick={onClose}>
          {BREAK.resume}
        </button>
      </div>
    </div>
  );
}
