import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ErrorNote, PageTitle } from '../components/common';
import { ExportCard } from '../components/ExportCard';
import { KeyNotice } from '../components/KeyNotice';
import { NOTICES } from '../lib/disclosures';
import { useRequiredSession } from '../lib/session';

/** What she types to confirm (case and spaces don't matter). */
export const DELETE_CONFIRM_WORD = 'DELETE';

export function confirmMatches(typed: string): boolean {
  return typed.trim().toUpperCase() === DELETE_CONFIRM_WORD;
}

/**
 * "Delete everything" (PRD M9): a crypto-shred of her account, after she has read what it means (Memo §2 "Deletion and
 * spoliation"; Succession and Data Promise D2). Nothing happens until the typed confirmation and the last button.
 * Afterwards everything in memory is wiped and she lands on the public home page.
 */
export function DeleteAccount() {
  const { api, lock } = useRequiredSession();
  const navigate = useNavigate();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = confirmMatches(typed);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount();
    } catch {
      setError('We couldn’t delete your space just now. Nothing was deleted. Please try again.');
      setBusy(false);
      return;
    }
    // Leave the signed-in screens first, then forget the keys, the session and any draft held in memory.
    navigate('/', { replace: true, state: { deleted: true } });
    lock();
  }

  return (
    <div className="stack-lg">
      <p>
        <Link className="back-link" to="/vault">← Home</Link>
      </p>
      <PageTitle
        eyebrow="Your data"
        testId="delete-title"
        lead="Take your time. Nothing is deleted until you finish the last step at the bottom of this page."
      >
        Delete everything
      </PageTitle>

      <KeyNotice notice={NOTICES.deleting} tone="warn" />

      <section className="card stack" aria-labelledby="del-what">
        <h2 id="del-what">What gets deleted</h2>
        <ul className="bullets">
          <li>Every version of your story, your drafts, and your evidence files.</li>
          <li>The locked copies on our server, and the keys that unlock them. Without those keys, they can’t be opened.</li>
          <li>Your sealed matches, any sharing with attorneys, your activity list, and your sign-in.</li>
        </ul>
        <p style={{ margin: 0 }}>
          <strong>This can’t be undone.</strong> We can’t bring any of it back, even if you ask us to.
        </p>
      </section>

      <section className="card stack" aria-labelledby="del-not">
        <h2 id="del-not">What deleting can’t reach</h2>
        <ul className="bullets">
          <li>
            <strong>Copies an attorney already downloaded or saved.</strong> We can’t take those back. You can ask the
            attorney to delete their copies.
          </li>
          <li>
            <strong>Files you downloaded yourself</strong>, like a summary PDF or a “Download my data” file. Delete those
            on your device.
          </li>
          <li>
            <strong>Matra’s tamper-evident record.</strong> It keeps short fingerprints (hashes) of what was saved, and a
            note that your account was deleted. The fingerprints don’t contain your words, and your words can’t be
            rebuilt from them.
          </li>
        </ul>
      </section>

      <ExportCard title="Want a copy first?" headingId="del-copy" testId="delete-export" />

      <form className="card warn stack" onSubmit={onSubmit} aria-labelledby="del-confirm">
        <h2 id="del-confirm">Delete my space</h2>
        <label className="field">
          <span>To confirm, type {DELETE_CONFIRM_WORD} in the box.</span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            data-testid="delete-confirm-input"
          />
        </label>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="row">
          <button className="btn btn-danger" type="submit" disabled={!ready || busy} data-testid="delete-account">
            {busy ? 'Deleting…' : 'Delete everything now'}
          </button>
          <Link className="btn" to="/vault">
            Keep my space
          </Link>
        </div>
      </form>
    </div>
  );
}
