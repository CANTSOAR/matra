import { useId } from 'react';
import type { Notice } from '../lib/disclosures';

/**
 * A short, calm notice for a key moment (PRD N4): a title, one to three sentences, and an optional "Learn more" she can
 * open or ignore. It never blocks anything. Copy lives in lib/disclosures.ts so every screen says the same thing.
 */
export function KeyNotice({ notice, tone = 'soft', className }: { notice: Notice; tone?: 'soft' | 'warn'; className?: string }) {
  const id = useId();
  return (
    <div
      className={`key-notice key-notice-${tone}${className ? ` ${className}` : ''}`}
      role="note"
      aria-labelledby={`${id}-title`}
      data-testid={`notice-${notice.id}`}
    >
      <p className="key-notice-title" id={`${id}-title`}>
        {notice.title}
      </p>
      <p className="key-notice-body">{notice.body.join(' ')}</p>
      {notice.more && notice.more.length > 0 && (
        <details className="disclosure key-notice-more">
          <summary>Learn more</summary>
          {notice.more.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </details>
      )}
    </div>
  );
}
