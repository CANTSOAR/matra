import { useEffect, useRef, useState } from 'react';
import { COPY } from './copy';
import { LockIcon } from './StartAnywhere';

export type SavePhase = 'idle' | 'saving' | 'saved' | 'error';

function ago(at: number, now: number): string {
  const s = Math.max(0, now - at) / 1000;
  if (s < 60) return COPY.vault.justNow;
  if (s < 3600) return COPY.vault.minutesAgo(Math.floor(s / 60));
  const d = new Date(at);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  return sameDay
    ? `at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * A quiet line about where her draft is kept: "Saved to your private space · just now", "Saving…", or
 * "Couldn't save — we'll try again" with a way to retry. Only failures (and saves she asked for) are announced.
 */
export function SaveStatus({ phase, at, onSaveNow }: { phase: SavePhase; at?: number; onSaveNow: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => setNow(Date.now()), [at, phase]);
  const asked = useRef(false);
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    if (phase === 'error') setAnnounce(COPY.vault.failed);
    else if (phase === 'saved' && asked.current) {
      asked.current = false;
      setAnnounce(`${COPY.vault.saved}.`);
    } else if (phase !== 'saving') setAnnounce('');
  }, [phase, at]);

  const text =
    phase === 'saving'
      ? COPY.vault.saving
      : phase === 'error'
        ? COPY.vault.failed
        : phase === 'saved' && at
          ? `${COPY.vault.saved} · ${ago(at, now)}`
          : COPY.vault.notYet;
  return (
    <div className={`space-saved space-vault is-${phase}`} data-testid="vault-status">
      <LockIcon />
      <span className="space-vault-text">{text}</span>
      {phase !== 'saving' && (
        <button
          type="button"
          className="space-btn space-btn-link space-vault-now"
          onClick={() => {
            asked.current = true;
            onSaveNow();
          }}
        >
          {phase === 'error' ? COPY.vault.retry : COPY.vault.saveNow}
        </button>
      )}
      <span className="space-visually-hidden" role="status" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}
