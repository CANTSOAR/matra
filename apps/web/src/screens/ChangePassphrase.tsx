import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ProgressNote } from '../components/AuthForms';
import { NewPassphraseFields } from '../components/NewPassphraseFields';
import { ErrorNote, Loading, PageTitle, formatDate, useAsync } from '../components/common';
import { friendlyError, useRequiredSession, type Progress } from '../lib/session';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Home → Your data → "Passphrase and devices" (plan PR 8): change her passphrase, and see and end her other signed-in
 * sessions. Both need her passphrase again, not only this session (a session can be left open on a shared device).
 * Changing it re-wraps the same account secret on this device, so nothing in her space is re-encrypted and her
 * recovery code keeps working. The page says what it can't do: it doesn't lock out someone who already copied that
 * secret. Attorneys reach it from their files page and get seven generated words, never their own.
 */
export function ChangePassphrase() {
  const { session, api, changePassphrase, signOutOtherSessions } = useRequiredSession();
  const survivor = session.user.role === 'survivor';
  const home = survivor ? '/vault' : '/attorney/cases';

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState<string | null>(null);
  const [fieldsKey, setFieldsKey] = useState(0);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const sessions = useAsync(() => api.listSessions().then((r) => r.sessions), [api]);
  const others = sessions.data?.filter((s) => !s.current) ?? [];
  const [outPass, setOutPass] = useState('');
  const [outProgress, setOutProgress] = useState<Progress | null>(null);
  const [outError, setOutError] = useState<string | null>(null);
  const [outDone, setOutDone] = useState<string | null>(null);

  async function onChange(e: FormEvent) {
    e.preventDefault();
    if (!current || !next || progress) return;
    setError(null);
    setDone(null);
    try {
      const { endedSessions } = await changePassphrase(current, next, setProgress);
      setCurrent('');
      setNext(null);
      setFieldsKey((k) => k + 1);
      setDone(
        'Your passphrase is changed. Use the new one from now on.' +
          (endedSessions === null
            ? ' Any other session was signed out.'
            : endedSessions
              ? ` ${plural(endedSessions, 'other session')} ${endedSessions === 1 ? 'was' : 'were'} signed out.`
              : ''),
      );
      void sessions.reload();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setProgress(null);
    }
  }

  async function onSignOutOthers(e: FormEvent) {
    e.preventDefault();
    if (!outPass || outProgress) return;
    setOutError(null);
    setOutDone(null);
    try {
      const { endedSessions } = await signOutOtherSessions(outPass, setOutProgress);
      setOutPass('');
      setOutDone(endedSessions ? `Done. ${plural(endedSessions, 'other session')} ${endedSessions === 1 ? 'was' : 'were'} signed out.` : 'There was nothing else to sign out.');
      void sessions.reload();
    } catch (err) {
      setOutError(friendlyError(err));
    } finally {
      setOutProgress(null);
    }
  }

  return (
    <div className="stack-lg">
      <p>
        <Link className="back-link" to={home}>
          ← {survivor ? 'Home' : 'All files'}
        </Link>
      </p>
      <PageTitle eyebrow={survivor ? 'Your data' : 'Your account'} testId="passphrase-title" lead="Choose a new passphrase, or sign out other devices.">
        Passphrase and devices
      </PageTitle>

      {done && (
        <p className="card soft" role="status" data-testid="change-done">
          {done}
        </p>
      )}

      <form className="card stack" onSubmit={onChange} aria-labelledby="change-heading" noValidate>
        <h2 id="change-heading">Change your passphrase</h2>
        <p style={{ margin: 0 }}>
          Everything in your space stays as it is.
          {survivor && ' If you have a recovery code, it keeps working.'}
        </p>
        <label className="field">
          <span>Your passphrase now</span>
          <input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            data-testid="change-current"
          />
        </label>
        <NewPassphraseFields
          key={fieldsKey}
          role={session.user.role}
          label="New passphrase"
          context={[session.user.username]}
          inputTestId="change-new"
          againTestId="change-new-again"
          onChange={setNext}
        />
        <div className="card warn stack" role="note" data-testid="change-caveat">
          <p style={{ margin: 0 }}>
            <strong>What changing it does:</strong> your old passphrase stops working for signing in, and anyone signed in
            to your account on another device is signed out. Anything typed there and not yet saved is lost.
          </p>
          <p style={{ margin: 0 }}>
            <strong>What it can’t do:</strong> if someone already had your old passphrase, or had your account open, they
            may have kept a copy of the key that unlocks it. A new passphrase stops them signing in, but that key stays the
            same, so anything they already downloaded, or later get from a copy of our server, still opens for them.
          </p>
          {survivor && (
            <p className="small" style={{ margin: 0 }}>
              If you think someone has seen your recovery code, <Link to="/vault/recovery">make a new one</Link> too.
            </p>
          )}
        </div>
        <ProgressNote p={progress} />
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="row">
          <button className="btn btn-primary" type="submit" disabled={!current || !next || !!progress} data-testid="change-submit">
            {progress ? 'Working…' : 'Change my passphrase'}
          </button>
        </div>
      </form>

      <section className="card stack" aria-labelledby="sessions-heading" data-testid="sessions">
        <h2 id="sessions-heading">Where you’re signed in</h2>
        <p className="small muted" style={{ margin: 0 }}>
          We don’t keep which device, browser or place a sign-in came from, only when it started. Each one ends by itself
          12 hours after it starts. A tab you closed or reloaded without choosing Lock &amp; sign out still shows here until
          it ends.
        </p>
        {sessions.loading && <Loading />}
        {sessions.error && <ErrorNote>{sessions.error}</ErrorNote>}
        {sessions.data && (
          <ul className="list small" data-testid="session-list">
            {sessions.data.map((s, i) => (
              <li key={`${s.signedInAt}-${i}`}>
                {s.current ? 'This device' : 'Another sign-in'}: since {formatDate(s.signedInAt)}
              </li>
            ))}
          </ul>
        )}
        {outDone && (
          <p className="card soft" role="status" style={{ margin: 0 }} data-testid="signout-others-done">
            {outDone}
          </p>
        )}
        {others.length > 0 && (
          <form className="stack" onSubmit={onSignOutOthers}>
            <p className="small" style={{ margin: 0 }}>
              Don’t recognize one, or left one open somewhere? Sign out everywhere else. Your passphrase stays the same, so
              if someone else knows it, change it above instead (that signs everyone else out too).
            </p>
            <label className="field">
              <span>To make sure it’s you, type your passphrase</span>
              <input
                type="password"
                autoComplete="current-password"
                value={outPass}
                onChange={(e) => setOutPass(e.target.value)}
                data-testid="signout-others-passphrase"
              />
            </label>
            <ProgressNote p={outProgress} />
            {outError && <ErrorNote>{outError}</ErrorNote>}
            <div className="row">
              <button className="btn" type="submit" disabled={!outPass || !!outProgress} data-testid="signout-others">
                {outProgress ? 'Working…' : 'Sign out everywhere else'}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
