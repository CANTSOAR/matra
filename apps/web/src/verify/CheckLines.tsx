import type { CheckLine, Tone } from './checks';

const MARK: Record<Tone, string> = { ok: '✓', bad: '!', info: 'i' };
const LABEL: Record<Tone, string> = { ok: 'Checked', bad: 'Problem', info: 'Note' };

/** Green / red / neutral result lines, each with its technical details folded away underneath. */
export function CheckLines({ lines, testId }: { lines: CheckLine[]; testId?: string }) {
  return (
    <ul className="check-lines" data-testid={testId}>
      {lines.map((l, i) => (
        <li key={`${l.id}-${i}`} className={`check-line ${l.tone}`} data-tone={l.tone} data-check={l.id}>
          <span className="check-mark" aria-label={LABEL[l.tone]} role="img">
            {MARK[l.tone]}
          </span>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0 }}>{l.text}</p>
            {l.details.length > 0 && (
              <details className="disclosure small">
                <summary>Technical details</summary>
                <ul className="mono small check-details">
                  {l.details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
