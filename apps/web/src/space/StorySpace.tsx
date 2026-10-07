/**
 * The "dump first" story space: start anywhere, see what was picked up, answer more only if she wants,
 * move freely with the story map, then review and seal. Like the interview, this module never stores
 * anything itself — the shell encrypts and persists every draft change.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { IntakeRecord } from '@matra/shared';
import { BreakPanel } from '../intake/IntakeChat';
import { emptyDraft, isBlank, type IntakeDraft } from '../intake/draft';
import { draftToRecord } from '../intake/record';
import type { StoryEntry } from '../understand/types';
import { understand, withEntries } from './adapters';
import { COPY } from './copy';
import {
  addEntry,
  answerSafety,
  continuePastHelp,
  dismissSuggestion,
  editEntry,
  editSuggestion,
  keepSuggestion,
  openSuggestions,
  patchSpace,
  removeEntry,
  safetyStage,
  setComposer,
} from './ops';
import { PickedUp } from './PickedUp';
import { SpaceReview } from './Review';
import { SafetyAsk, SafetyHelp } from './SafetyGate';
import { Composer, Journal, LockIcon } from './StartAnywhere';
import { StoryMap } from './StoryMap';
import { TopicCards, TopicPanel } from './TopicViews';
import { sectionById, topicById, topicStatus, type SectionId, type TopicId } from './topics';
import './space.css';

export interface StorySpaceProps {
  initialDraft?: IntakeDraft;
  /** Every change (typing is debounced). The shell encrypts and persists; this module never stores anything. */
  onDraftChange?: (d: IntakeDraft) => void;
  /** Resolves once the sealed record is confirmed; rejects with a friendly message (she can try again). */
  onComplete: (record: IntakeRecord) => void | Promise<void>;
  /** Encrypt and attach evidence files; resolves with how many were added. */
  onAddFiles?: (files: File[]) => Promise<number>;
  fileCount?: number;
  /** "Prefer to be asked one question at a time?" */
  onSwitchToInterview?: (d: IntakeDraft) => void;
  /** "Leave this page now" on the safety screen. */
  onExit?: () => void;
  /** Her preferred name, if she gave one — used for a gentle hello. */
  name?: string;
  /** Clock for timestamps and understanding (tests). */
  now?: () => Date;
  /**
   * A meaningful moment to keep her draft somewhere lasting (she added or changed her words, kept a
   * suggestion, or finished a topic page). Called after onDraftChange has the new draft.
   */
  onCheckpoint?: () => void;
  /** The shell's "saved to your private space" line; replaces the on-device indicator when given. */
  saveStatus?: ReactNode;
  /** She already has a sealed version (editing her words never changes it). */
  hasSealed?: boolean;
}

/**
 * Her pieces for the sealed record. If she also wrote "in your own words" in the interview, that text
 * goes first (verbatim), so attaching her entries never drops it.
 */
function entriesForRecord(d: IntakeDraft): StoryEntry[] {
  const list = d.entries ?? [];
  const words = d.answers['story.freeRecall'];
  if (!list.length || typeof words !== 'string' || isBlank(words)) return list;
  return [{ id: 'interview-free-recall', createdAt: d.startedAt, text: words, source: 'typed' }, ...list];
}

type View = { kind: 'home' } | { kind: 'topic'; id: TopicId } | { kind: 'review' };

const DEBOUNCE_MS = 500;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
function defaultExit() {
  window.location.replace('https://www.google.com/');
}

export function StorySpace({
  initialDraft,
  onDraftChange,
  onComplete,
  onAddFiles,
  fileCount = 0,
  onSwitchToInterview,
  onExit,
  name,
  now = () => new Date(),
  onCheckpoint,
  saveStatus,
  hasSealed = false,
}: StorySpaceProps) {
  const [draft, setDraftState] = useState<IntakeDraft>(() => initialDraft ?? emptyDraft());
  const [view, setView] = useState<View>({ kind: 'home' });
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'idle'>('idle');
  const [composerOpen, setComposerOpen] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [fileStatus, setFileStatus] = useState<string | undefined>();
  const [breakOpen, setBreakOpen] = useState(false);
  const [seal, setSeal] = useState<{ phase: 'idle' | 'sealing' | 'sealed'; error?: string }>({ phase: 'idle' });

  // ───────────── draft + autosave (same contract as IntakeChat) ─────────────
  const draftRef = useRef(draft);
  const cb = useRef(onDraftChange);
  cb.current = onDraftChange;
  const cp = useRef(onCheckpoint);
  cp.current = onCheckpoint;
  /** Save now (to the shell) and mark a checkpoint. */
  const commit = useCallback((next: IntakeDraft) => {
    draftRef.current = next;
    setDraftState(next);
    if (timer.current !== undefined) {
      clearTimeout(timer.current);
      timer.current = undefined;
    }
    cb.current?.(next);
    setSaveState('saved');
    cp.current?.();
  }, []);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flush = useCallback(() => {
    if (timer.current !== undefined) {
      clearTimeout(timer.current);
      timer.current = undefined;
    }
    cb.current?.(draftRef.current);
    setSaveState('saved');
  }, []);
  const setDraft = useCallback(
    (next: IntakeDraft, immediate: boolean) => {
      draftRef.current = next;
      setDraftState(next);
      if (immediate) flush();
      else {
        setSaveState('saving');
        if (timer.current !== undefined) clearTimeout(timer.current);
        timer.current = setTimeout(flush, DEBOUNCE_MS);
      }
    },
    [flush],
  );
  useEffect(
    () => () => {
      if (timer.current !== undefined) flush();
    },
    [flush],
  );

  // ───────────── understanding ─────────────
  const entries = useMemo(() => draft.entries ?? [], [draft.entries]);
  const dismissed = draft.dismissedSuggestions;
  const all = useMemo(() => understand(entries, { now: now(), dismissed: dismissed ?? [] }), [entries, dismissed]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = useMemo(() => openSuggestions(draft, all), [draft, all]);
  const keptCount = Object.values(draft.space?.decisions ?? {}).filter((x) => x !== 'dismissed').length;

  // ───────────── view changes: focus the new heading, scroll to the top of the space ─────────────
  const rootRef = useRef<HTMLDivElement>(null);
  const go = (v: View) => {
    setView(v);
    if (v.kind === 'review' && !draftRef.current.reachedReview) setDraft({ ...draftRef.current, reachedReview: true }, true);
    requestAnimationFrame(() => {
      const root = rootRef.current;
      if (!root) return;
      // Only scroll when the top of the space is out of view, so moving between views never jumps.
      const top = root.getBoundingClientRect?.().top ?? 0;
      if (top < 0 || top > window.innerHeight * 0.5) root.scrollIntoView?.({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      const target =
        v.kind === 'home' ? '#space-home-title, .space-composer .space-display' : v.kind === 'topic' ? '#space-panel-title' : '#space-review-title';
      root.querySelector<HTMLElement>(target)?.focus({ preventScroll: true });
    });
  };

  const jump = (id: SectionId) => {
    if (id === 'review') return go({ kind: 'review' });
    if (id === 'words') return go({ kind: 'home' });
    const s = sectionById(id);
    const d = draftRef.current;
    const first = s.topics.find((t) => {
      const st = topicStatus(d, topicById(t));
      return st === 'notYet' || st === 'partly';
    });
    go({ kind: 'topic', id: first ?? s.topics[0] });
  };

  const currentSection: SectionId = view.kind === 'review' ? 'review' : view.kind === 'topic' ? topicById(view.id).section : 'words';

  // ───────────── actions ─────────────
  const add = (text: string, source: StoryEntry['source']) => {
    const before = openSuggestions(draftRef.current, all).length;
    const next = addEntry(draftRef.current, text, source, now());
    commit(next);
    setComposerOpen(false);
    const after = openSuggestions(next, understand(next.entries ?? [], { now: now(), dismissed: next.dismissedSuggestions ?? [] }));
    const fresh = after.length - before;
    setAnnounce(fresh > 0 ? `Added to your story. ${COPY.picked.announce(after.length)}` : 'Added to your story.');
    // Move gently to what was picked up (or back to "Add more"): a smooth scroll, then focus without a jump.
    // Two frames: the first lets the new section render, the second lets it settle before measuring.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const target = fresh > 0 ? '#space-picked-title' : '#space-add-more';
        const el = rootRef.current?.querySelector<HTMLElement>(target);
        if (!el) return;
        el.scrollIntoView?.({ block: fresh > 0 ? 'start' : 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
        el.focus({ preventScroll: true });
      }),
    );
  };

  const addFiles = onAddFiles
    ? async (files: File[]) => {
        setFileStatus(COPY.files.working);
        try {
          const n = await onAddFiles(files);
          setFileStatus(n === files.length ? COPY.files.added(n) : `${COPY.files.added(n)} ${COPY.files.failed}`);
          if (n > 0 && draftRef.current.answers['evidence.upload'] === undefined) {
            const d = draftRef.current;
            commit({ ...d, answers: { ...d.answers, 'evidence.upload': 'requested' }, skipped: d.skipped.filter((x) => x !== 'evidence.upload') });
          }
          return n;
        } catch (e) {
          setFileStatus(e instanceof Error && e.message ? `${COPY.files.failed} (${e.message})` : COPY.files.failed);
          return 0;
        }
      }
    : undefined;

  const sealingRef = useRef(false);
  const doSeal = async () => {
    if (sealingRef.current) return;
    sealingRef.current = true;
    flush();
    setSeal({ phase: 'sealing' });
    try {
      const d = draftRef.current;
      await onComplete(withEntries(draftToRecord(d), entriesForRecord(d)));
      setSeal({ phase: 'sealed' });
    } catch (e) {
      const detail = e instanceof Error && e.message ? e.message : undefined;
      setSeal({ phase: 'idle', error: detail ? `${COPY.review.sealError} (${detail})` : COPY.review.sealError });
    } finally {
      sealingRef.current = false;
    }
  };

  // ───────────── render ─────────────
  if (seal.phase === 'sealed') {
    return (
      <div className="space-root">
        <section className="space-gate" role="status">
          <h2 className="space-gate-title">Your account is sealed.</h2>
          <p className="space-lead">It is locked and stored safely. Only you can open it. Nothing has been sent to anyone.</p>
        </section>
      </div>
    );
  }

  const stage = safetyStage(draft);
  if (stage !== 'done') {
    return (
      <div className="space-root space-root-gate" ref={rootRef}>
        {stage === 'ask' ? (
          <SafetyAsk onAnswer={(v) => setDraft(answerSafety(draftRef.current, v), true)} />
        ) : (
          <SafetyHelp onContinue={() => setDraft(continuePastHelp(draftRef.current), true)} onLeave={onExit ?? defaultExit} />
        )}
      </div>
    );
  }

  const interviewWords = typeof draft.answers['story.freeRecall'] === 'string' && !isBlank(draft.answers['story.freeRecall'])
    ? (draft.answers['story.freeRecall'] as string)
    : undefined;
  const hasAny = entries.length > 0 || !!interviewWords;
  const composerText = draft.space?.composer ?? '';

  return (
    <div className="space-root" ref={rootRef}>
      <div className="space-layout" inert={breakOpen || undefined}>
        <aside className="space-rail">
          <StoryMap draft={draft} current={currentSection} onJump={jump} />
        </aside>

        <div className="space-main">
          <header className="space-header">
            {saveStatus ?? (
              <p className="space-saved" aria-live="polite">
                <LockIcon />
                <span>{saveState === 'saving' ? COPY.saving : COPY.saved}</span>
              </p>
            )}
            <button type="button" className="space-btn space-btn-quiet space-btn-small" onClick={() => (flush(), setBreakOpen(true))}>
              {COPY.takeBreak}
            </button>
          </header>

          <p className="space-visually-hidden" role="status" aria-live="polite">
            {announce}
          </p>

          <div className="space-view" key={view.kind === 'topic' ? `topic-${view.id}` : view.kind}>
          {view.kind === 'home' && (
            <>
              {!hasAny ? (
                <Composer
                  first
                  greeting={name?.trim() ? `Hi, ${name.trim()}.` : undefined}
                  value={composerText}
                  onChange={(t) => setDraft(setComposer(draftRef.current, t), false)}
                  onAdd={add}
                  onAddFiles={addFiles ? async (f) => void (await addFiles(f)) : undefined}
                  fileStatus={fileStatus}
                />
              ) : (
                <section className="space-section space-words" aria-labelledby="space-home-title">
                  <h2 id="space-home-title" className="space-display space-display-sm" tabIndex={-1}>
                    {COPY.journal.title}
                  </h2>
                  <Journal
                    entries={entries}
                    interviewWords={interviewWords}
                    fileCount={fileCount}
                    hasSealed={hasSealed}
                    onRemove={(id) => {
                      commit(removeEntry(draftRef.current, id));
                      setAnnounce('Removed from your draft.');
                    }}
                    onEdit={(id, text) => {
                      commit(editEntry(draftRef.current, id, text, now()));
                      setAnnounce(COPY.journal.editedAnnounce);
                    }}
                  />
                  {composerOpen ? (
                    <Composer
                      first={false}
                      value={composerText}
                      onChange={(t) => setDraft(setComposer(draftRef.current, t), false)}
                      onAdd={add}
                      onAddFiles={addFiles ? async (f) => void (await addFiles(f)) : undefined}
                      onCancel={() => setComposerOpen(false)}
                      fileStatus={fileStatus}
                    />
                  ) : (
                    <button
                      id="space-add-more"
                      type="button"
                      className="space-btn space-btn-secondary space-add-more"
                      onClick={() => setComposerOpen(true)}
                    >
                      + {COPY.start.addMore}
                    </button>
                  )}
                </section>
              )}

              <PickedUp
                suggestions={open}
                entries={entries}
                keptCount={keptCount}
                onKeep={(s) => {
                  commit(keepSuggestion(draftRef.current, s));
                  setAnnounce(COPY.picked.kept);
                }}
                onEdit={(s, v) => {
                  commit(editSuggestion(draftRef.current, s, v));
                  setAnnounce(COPY.picked.kept);
                }}
                onDismiss={(s) => {
                  setDraft(dismissSuggestion(draftRef.current, s), true);
                  setAnnounce(COPY.picked.setAside);
                }}
              />

              <TopicCards draft={draft} empty={!hasAny} onOpen={(id) => go({ kind: 'topic', id })} />

              <section className="space-section space-next" aria-labelledby="space-next-title">
                <h2 id="space-next-title" className="space-h3">
                  {COPY.review.goReview}
                </h2>
                <p className="space-hint">{COPY.review.goReviewLead}</p>
                <button type="button" className="space-btn space-btn-primary" onClick={() => go({ kind: 'review' })}>
                  {COPY.review.goReview}
                </button>
              </section>

              {onSwitchToInterview && (
                <p className="space-interview-offer">
                  {COPY.interview.offer}{' '}
                  <button
                    type="button"
                    className="space-btn space-btn-link"
                    onClick={() => {
                      flush();
                      onSwitchToInterview(patchSpace(draftRef.current, { mode: 'interview' }));
                    }}
                  >
                    {COPY.interview.offerButton}
                  </button>
                </p>
              )}
            </>
          )}

          {view.kind === 'topic' && (
            <TopicPanel
              key={view.id}
              topicId={view.id}
              draft={draft}
              // Saving or skipping a page (immediate) is a checkpoint; typing is not.
              setDraft={(d, immediate) => (immediate ? commit(d) : setDraft(d, false))}
              onClose={() => go({ kind: 'home' })}
              onOpenTopic={(id) => go({ kind: 'topic', id })}
              onAddFiles={addFiles}
            />
          )}

          {view.kind === 'review' && (
            <>
              <button type="button" className="space-back" onClick={() => go({ kind: 'home' })}>
                <span aria-hidden="true">←</span> {COPY.backToStory}
              </button>
              <SpaceReview
                draft={draft}
                fileCount={fileCount}
                onEdit={jump}
                onSeal={() => void doSeal()}
                sealing={seal.phase === 'sealing'}
                sealError={seal.error}
              />
            </>
          )}
          </div>
        </div>
      </div>
      {breakOpen && <BreakPanel onClose={() => setBreakOpen(false)} />}
    </div>
  );
}
