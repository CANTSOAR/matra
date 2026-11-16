/**
 * /marker-preview: a developer page for the span-marker (src/ml/marker). It exists only in a development server started with
 * MATRA_MARKER=on (main.tsx: a build-time false everywhere else), uses made-up text typed into the box, and is NOT a
 * survivor-facing screen. The real checklist that would show "you may have written about this" is P2's, and it needs
 * advocate-reviewed copy and her opt-in first. Nothing typed here leaves the page or is stored.
 */
import { useMemo, useState } from 'react';
import { markWithStats } from '../ml/marker';
import { ENABLED_QUESTIONS } from '../ml/marker/enabled';
import { INTAKE_MARK_BANK } from '../ml/marker/intakeBank';

const SAMPLE = 'It was on March 14 around 10pm at the Riverside Diner. I told my sister Dana the next day. I never told my mom. I still have the texts.';

export function MarkerPreview() {
  const [text, setText] = useState(SAMPLE);
  const res = useMemo(() => markWithStats(text, INTAKE_MARK_BANK), [text]);
  return (
    <main style={{ maxWidth: 720, margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Span-marker preview (developer page)</h1>
      <p>
        Dev only. Fictional text only. Enabled questions: {ENABLED_QUESTIONS.join(', ')}. The eval gate was not met on the held-out split
        (tools/eval/span-marker/results/REPORT.md), so this must not be shown to survivors.
      </p>
      <label htmlFor="mp-text">Text</label>
      <textarea id="mp-text" value={text} onChange={(e) => setText(e.target.value)} rows={8} style={{ width: '100%' }} />
      <h2>Marks ({res.marks.length}), dropped by the validator ({res.dropped})</h2>
      <ul>
        {res.marks.map((m) => (
          <li key={`${m.questionId}-${m.start}`}>
            <code>{m.questionId}</code> [{m.start}, {m.end}) “{m.exactSpan}”
          </li>
        ))}
      </ul>
      <pre>{JSON.stringify(res.droppedByReason, null, 2)}</pre>
    </main>
  );
}
