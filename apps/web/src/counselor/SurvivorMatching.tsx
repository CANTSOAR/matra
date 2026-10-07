/**
 * Survivor side of sealed matching: what it is, what she has sealed, and a way to withdraw any of it.
 * Entries ALWAYS show "Sealed" — that is deliberate (anti-self-check); see apps/server/src/app.ts.
 * Sealing itself happens when she seals her account with a sealed match chosen (lib/vault.ts lodgeEscrow).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { EscrowEntry } from '@matra/shared';
import { ErrorNote, Loading, PageTitle, formatDate, useAsync } from '../components/common';
import { friendlyError, useRequiredSession } from '../lib/session';
import { escrowLabel, withdrawEscrow } from '../lib/vault';

/** The plain explanation shown wherever she can opt in (keep in sync with MATCHING_CONSENT_STATEMENT). */
export const MATCHING_EXPLANATION = [
  'If someone else names the same person, a trained legal options counselor — not the police, not your school — will reach out privately to talk about your options. You decide everything after that.',
  'Only an email address, phone number, or social media profile can be matched. Names aren’t unique enough to match safely, so they are never used.',
  'This page will always say “Sealed”, even if there is a match. That keeps it safe: no one can use it to find out whether they’ve been named.',
];

export function SurvivorMatching() {
  const { api, session } = useRequiredSession();
  const entries = useAsync(async () => {
    const { entries } = await api.listEscrow();
    return Promise.all(entries.map(async (e) => ({ entry: e, label: await escrowLabel(e.labelEnvelope, session.masterKey) })));
  }, [api, session.masterKey]);

  return (
    <div className="stack-lg">
      <p>
        <Link className="back-link" to="/vault">← Home</Link>
      </p>
      <PageTitle eyebrow="Sealed match">What you’ve sealed</PageTitle>
      <section className="card soft stack" aria-label="How a sealed match works">
        {MATCHING_EXPLANATION.map((l) => (
          <p key={l} style={{ margin: 0 }}>
            {l}
          </p>
        ))}
      </section>
      <section className="card stack" aria-labelledby="sealed" data-testid="matching-entries">
        <h2 id="sealed">Sealed identifiers</h2>
        {entries.loading && <Loading />}
        {entries.error && <ErrorNote>{entries.error}</ErrorNote>}
        {entries.data && entries.data.length === 0 && (
          <p className="muted">
            Nothing sealed. You can choose a sealed match for someone you named when you tell your story.
          </p>
        )}
        <ul className="list">
          {entries.data?.map(({ entry, label }) => (
            <MatchRow key={entry.id} entry={entry} label={label} onChanged={() => void entries.reload()} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function MatchRow({ entry, label, onChanged }: { entry: EscrowEntry; label: string; onChanged(): void }) {
  const { api } = useRequiredSession();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function withdraw() {
    setBusy(true);
    setError(null);
    try {
      await withdrawEscrow(api, entry.id);
      onChanged();
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  }
  return (
    <li className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span>
          <strong>{label}</strong> <span className="small muted">· sealed {formatDate(entry.createdAt)}</span>
        </span>
        <span className="badge neutral">Sealed</span>
      </div>
      {!confirming ? (
        <div>
          <button className="btn btn-quiet btn-small" onClick={() => setConfirming(true)}>
            Withdraw
          </button>
        </div>
      ) : (
        <div className="card warn stack small">
          <p style={{ margin: 0 }}>
            Withdrawing deletes this sealed identifier. If there is ever a match on it, no one will be able to reach you
            about it. You can still keep everything else in your vault.
          </p>
          <div className="row">
            <button className="btn btn-small btn-danger" onClick={() => void withdraw()} disabled={busy}>
              {busy ? 'Withdrawing…' : 'Yes, withdraw it'}
            </button>
            <button className="btn btn-quiet btn-small" onClick={() => setConfirming(false)} disabled={busy}>
              Keep it
            </button>
          </div>
        </div>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
    </li>
  );
}
