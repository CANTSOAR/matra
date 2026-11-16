import { useState } from 'react';
import type { IntakeDraft } from '../integration/intakeAdapter';
import { typedText } from '../dev/mirror';
import { vaultProblemNotice, type VaultProblem } from '../lib/vault';

/**
 * Only on read-only screens that load with `allowPartial` (Home): part of her space didn't load or didn't match what
 * she saved, so it is left out and what is "latest" here may be older than her newest save (lib/vault.ts loadSpace).
 * Screens that save, seal, share or resume never render partially; they show VaultStopped instead. Renders nothing
 * when nothing is left out.
 */
export function UnreadableNote({ problems }: { problems: VaultProblem[] | undefined }) {
  const text = vaultProblemNotice(problems);
  if (!text) return null;
  const kind = problems?.some((p) => p.kind !== 'unavailable') ? 'integrity' : 'unavailable';
  return (
    <p className="card warn small" role="status" data-testid="vault-unreadable" data-kind={kind}>
      {text}
    </p>
  );
}

/**
 * In place of a screen that would show or save from her space when it didn't load cleanly: the calm reason (the error's
 * message, already distinct for "couldn't reach us" and "doesn't match what you saved") and Try again.
 */
export function VaultStopped({ error, onRetry }: { error: string; onRetry(): void }) {
  return (
    <div className="card warn stack" role="alert" data-testid="vault-stopped">
      <p style={{ margin: 0 }}>{error}</p>
      <div>
        <button type="button" className="btn btn-small" onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  );
}

/** Her words in a draft, as she typed them: story pieces, then unsent text, then typed answers (read-only). */
export function draftWords(draft: IntakeDraft): { story: string[]; answers: string } {
  const story = (draft.entries ?? []).map((e) => e.text.trim()).filter(Boolean);
  const composer = draft.space?.composer?.trim();
  if (composer) story.push(composer);
  return { story, answers: typedText(draft.answers ?? {}) };
}

/**
 * Her draft, read-only, on a stopped screen: reading her own words never depends on a download. With a button to copy
 * them. Renders nothing for an empty draft.
 */
export function DraftWords({ draft }: { draft: IntakeDraft }) {
  const { story, answers } = draftWords(draft);
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  if (!story.length && !answers) return null;
  const text = [...story, ...(answers ? [answers] : [])].join('\n\n');
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('yes');
    } catch {
      setCopied('no');
    }
  }
  return (
    <section className="card stack" aria-labelledby="draft-words" data-testid="draft-words">
      <h2 id="draft-words">Your draft, as you saved it</h2>
      {story.map((t, i) => (
        <p key={i} style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
          {t}
        </p>
      ))}
      {answers && <p className="small muted" style={{ margin: 0 }}>Your answers: {answers}</p>}
      <div className="row">
        <button type="button" className="btn btn-small" onClick={() => void copy()}>
          Copy my words
        </button>
        {copied === 'yes' && <span className="small muted" role="status">Copied.</span>}
        {copied === 'no' && <span className="small muted" role="status">This browser didn’t allow copying. You can select the text instead.</span>}
      </div>
    </section>
  );
}
