import { useEffect, useRef } from 'react';
import { Resources } from '../intake/IntakeChat';
import { COPY } from './copy';

export function SafetyAsk({ onAnswer }: { onAnswer: (v: 'yes' | 'no' | 'unsure' | undefined) => void }) {
  const h = useRef<HTMLHeadingElement>(null);
  useEffect(() => h.current?.focus({ preventScroll: true }), []);
  return (
    <section className="space-gate" aria-labelledby="space-gate-title">
      <div className="space-gate-mark" aria-hidden="true" />
      <h2 id="space-gate-title" className="space-gate-title" ref={h} tabIndex={-1}>
        {COPY.safety.title}
      </h2>
      <p className="space-lead">{COPY.safety.lead}</p>
      <div className="space-gate-choices" role="group" aria-labelledby="space-gate-title">
        <button type="button" className="space-btn space-btn-choice" onClick={() => onAnswer('yes')}>
          {COPY.safety.yes}
        </button>
        <button type="button" className="space-btn space-btn-choice" onClick={() => onAnswer('no')}>
          {COPY.safety.no}
        </button>
        <button type="button" className="space-btn space-btn-choice" onClick={() => onAnswer('unsure')}>
          {COPY.safety.unsure}
        </button>
      </div>
      <button type="button" className="space-btn space-btn-link" onClick={() => onAnswer(undefined)}>
        {COPY.safety.skip}
      </button>
    </section>
  );
}

export function SafetyHelp({ onContinue, onLeave }: { onContinue: () => void; onLeave: () => void }) {
  const h = useRef<HTMLHeadingElement>(null);
  useEffect(() => h.current?.focus({ preventScroll: true }), []);
  return (
    <section className="space-gate space-gate-help" aria-labelledby="space-help-title">
      <h2 id="space-help-title" className="space-gate-title" ref={h} tabIndex={-1}>
        {COPY.safety.helpTitle}
      </h2>
      <p className="space-lead">{COPY.safety.helpBody}</p>
      <div className="space-resources">
        <Resources />
      </div>
      <div className="space-actions">
        <button type="button" className="space-btn space-btn-primary" onClick={onContinue}>
          {COPY.safety.keepGoing}
        </button>
        <button type="button" className="space-btn space-btn-secondary" onClick={onLeave}>
          {COPY.safety.leave}
        </button>
      </div>
    </section>
  );
}
