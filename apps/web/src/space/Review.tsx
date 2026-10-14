import { useEffect, useRef } from 'react';
import { KeyNotice } from '../components/KeyNotice';
import { NOTICES } from '../lib/disclosures';
import { formatAnswer, isBlank, stepById, type IntakeDraft } from '../intake/draft';
import { COPY } from './copy';
import { StatusIcon } from './StoryMap';
import { SECTIONS, STATUS_LABEL, sectionStatus, topicById, topicStatus, topicSteps, type SectionId } from './topics';

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function SpaceReview({
  draft,
  fileCount,
  onEdit,
  onSeal,
  sealing,
  sealError,
}: {
  draft: IntakeDraft;
  fileCount: number;
  onEdit: (id: SectionId) => void;
  onSeal: () => void;
  sealing: boolean;
  sealError?: string;
}) {
  const h = useRef<HTMLHeadingElement>(null);
  useEffect(() => h.current?.focus({ preventScroll: true }), []);
  const entries = draft.entries ?? [];
  const interviewWords = draft.answers['story.freeRecall'];
  const safety = stepById('safety.now')!;

  return (
    <section className="space-review" aria-labelledby="space-review-title">
      <h2 id="space-review-title" className="space-display space-display-sm" ref={h} tabIndex={-1}>
        {COPY.review.title}
      </h2>
      <p className="space-lead">{COPY.review.lead}</p>

      <section className="space-review-section space-review-words" aria-labelledby="space-rv-words">
        <div className="space-review-head">
          <h3 id="space-rv-words" className="space-h3">
            {COPY.review.words}
          </h3>
          <button type="button" className="space-btn space-btn-secondary space-btn-small" onClick={() => onEdit('words')} aria-label={`${COPY.review.edit}: ${COPY.review.words}`}>
            {COPY.review.edit}
          </button>
        </div>
        {entries.length === 0 && isBlank(interviewWords) && <p className="space-hint">{COPY.review.nothing}</p>}
        {typeof interviewWords === 'string' && !isBlank(interviewWords) && (
          <blockquote className="space-review-entry">
            <p className="space-entry-meta">{COPY.journal.fromInterview}</p>
            <p className="space-verbatim">{interviewWords}</p>
          </blockquote>
        )}
        {entries.map((e) => (
          <blockquote key={e.id} className="space-review-entry">
            <p className="space-entry-meta">
              {e.source === 'voice' ? COPY.journal.voice : COPY.journal.typed} · <time dateTime={e.createdAt}>{when(e.createdAt)}</time>
              {e.editedAt && (
                <>
                  {' · '}
                  <time dateTime={e.editedAt}>{COPY.journal.edited(when(e.editedAt))}</time>
                </>
              )}
            </p>
            <p className="space-verbatim">{e.text}</p>
          </blockquote>
        ))}
      </section>

      {SECTIONS.filter((s) => s.id !== 'review').map((s) => {
        const steps = s.topics.flatMap((tid) => topicSteps(draft, topicById(tid)));
        const rows = steps.filter((st) => draft.answers[st.id] !== undefined || draft.skipped.includes(st.id));
        if (s.id === 'safety' && (draft.answers['safety.now'] !== undefined || draft.skipped.includes('safety.now'))) rows.unshift(safety);
        const status = sectionStatus(draft, s);
        const skippedTopics = s.topics.map(topicById).filter((t) => topicStatus(draft, t) === 'skipped' && draft.space?.skippedTopics?.includes(t.id));
        if (s.id === 'words' && rows.length === 0) return null;
        return (
          <section key={s.id} className="space-review-section" aria-labelledby={`space-rv-${s.id}`}>
            <div className="space-review-head">
              <h3 id={`space-rv-${s.id}`} className="space-h3">
                {s.id === 'words' ? 'More of what you remember' : s.title}
              </h3>
              <span className="space-review-status">
                <StatusIcon status={status} /> {STATUS_LABEL[status]}
              </span>
              <button type="button" className="space-btn space-btn-secondary space-btn-small" onClick={() => onEdit(s.id)} aria-label={`${COPY.review.edit}: ${s.title}`}>
                {COPY.review.edit}
              </button>
            </div>
            {rows.length === 0 && skippedTopics.length === 0 && s.id !== 'care' && <p className="space-hint">{COPY.review.nothing}</p>}
            {(rows.length > 0 || skippedTopics.length > 0 || (s.id === 'care' && fileCount > 0)) && (
              <dl className="space-review-list">
                {skippedTopics.map((t) => (
                  <div key={t.id} className="space-review-row">
                    <dt>{t.title}</dt>
                    <dd className="is-empty">{COPY.review.skipped}</dd>
                  </div>
                ))}
                {rows.map((st) => {
                  const v = draft.answers[st.id];
                  return (
                    <div key={st.id} className="space-review-row">
                      <dt>{'label' in st ? st.label : st.id}</dt>
                      <dd className={v === undefined ? 'is-empty' : 'space-verbatim'}>
                        {v === undefined ? COPY.review.skipped : formatAnswer(st, v, draft)}
                      </dd>
                    </div>
                  );
                })}
                {s.id === 'care' && fileCount > 0 && (
                  <div className="space-review-row">
                    <dt>Files</dt>
                    <dd>{COPY.files.count(fileCount)}</dd>
                  </div>
                )}
              </dl>
            )}
            {rows.length === 0 && skippedTopics.length === 0 && s.id === 'care' && fileCount === 0 && <p className="space-hint">{COPY.review.nothing}</p>}
          </section>
        );
      })}

      <div className="space-seal">
        <p>{COPY.review.sealExplain}</p>
        <KeyNotice notice={NOTICES.savedVersions} />
        {sealError && (
          <p className="space-seal-error" role="alert">
            {sealError}
          </p>
        )}
        {sealing ? (
          <p className="space-seal-progress" role="status" aria-live="polite">
            <span className="space-spinner" aria-hidden="true" />
            <span>
              <strong>{COPY.review.sealing}</strong> {COPY.review.sealingBody}
            </span>
          </p>
        ) : (
          <button type="button" className="space-btn space-btn-primary space-btn-seal" onClick={onSeal}>
            {sealError ? COPY.review.retry : COPY.review.seal}
          </button>
        )}
      </div>
    </section>
  );
}
