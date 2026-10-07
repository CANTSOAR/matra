import { useState } from 'react';
import type { IntakeDraft } from '../intake/draft';
import { COPY } from './copy';
import { SECTIONS, STATUS_LABEL, reviewLabel, sectionStatus, type SectionId, type Status } from './topics';

export function StatusIcon({ status }: { status: Status }) {
  // Shape carries the meaning (not color alone): check, half, empty ring, dash.
  return (
    <svg className={`space-status-icon is-${status}`} width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      {status === 'filled' && (
        <>
          <circle cx="9" cy="9" r="8" fill="currentColor" />
          <path d="M5.2 9.3l2.4 2.4 5-5.2" fill="none" stroke="var(--matra-surface, #fff)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {status === 'partly' && (
        <>
          <circle cx="9" cy="9" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M9 1.75a7.25 7.25 0 0 1 0 14.5z" fill="currentColor" />
        </>
      )}
      {status === 'notYet' && <circle cx="9" cy="9" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.6 2.2" />}
      {status === 'skipped' && (
        <>
          <circle cx="9" cy="9" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5.5 9h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

export function StoryMap({
  draft,
  current,
  onJump,
}: {
  draft: IntakeDraft;
  current: SectionId;
  onJump: (id: SectionId) => void;
}) {
  const [open, setOpen] = useState(false);
  const rows = SECTIONS.map((s) => {
    const status = sectionStatus(draft, s);
    const label = s.id === 'review' ? reviewLabel(draft) : STATUS_LABEL[status];
    return { s, status, label };
  });
  const started = rows.filter((r) => r.s.id !== 'review' && r.status !== 'notYet').length;
  const total = SECTIONS.length - 1;
  const cur = rows.find((r) => r.s.id === current);
  return (
    <nav className={`space-map${open ? ' is-open' : ''}`} aria-label={COPY.map.title}>
      <button
        type="button"
        className="space-map-toggle"
        aria-expanded={open}
        aria-controls="space-map-list"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="space-map-toggle-text">
          <span className="space-map-toggle-title">{cur?.s.title ?? COPY.map.title}</span>
          <span className="space-map-toggle-sub">
            {COPY.map.title} · {COPY.map.summary(started, total)}
          </span>
        </span>
        <span className="space-map-toggle-action">{open ? COPY.map.close : COPY.map.open}</span>
      </button>
      <p className="space-map-heading" aria-hidden="true">
        {COPY.map.title}
      </p>
      <ol id="space-map-list" className="space-map-list">
        {rows.map(({ s, status, label }) => (
          <li key={s.id}>
            <button
              type="button"
              className={`space-map-item is-${status}${s.id === current ? ' is-current' : ''}`}
              aria-current={s.id === current ? 'location' : undefined}
              onClick={() => {
                setOpen(false);
                onJump(s.id);
              }}
            >
              <StatusIcon status={s.id === 'review' ? (draft.reachedReview ? 'partly' : 'notYet') : status} />
              <span className="space-map-item-title">{s.title}</span>
              <span className="space-map-item-status">{label}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
