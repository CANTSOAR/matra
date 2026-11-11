import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { RecoveryCodeError, parseRecoveryCode } from '@matra/crypto';
import { ProgressNote, STRENGTH_WIDTH } from '../components/AuthForms';
import { ErrorNote, PageTitle } from '../components/common';
import { RecoveryCodeCard, RecoveryCodeExplainer } from '../components/RecoveryCode';
import { generatePassphrase, passphraseStrength } from '../lib/passphrase';
import { friendlyError, useRequiredSession, useSession, type PendingRecoveryCode, type Progress, type RecoveryReset } from '../lib/session';

/**
 * Checks the "Forgot your passphrase?" form on this device, before anything is sent: an alias, and a code that parses
 * (right length, alphabet and check character). Returns what to tell her, or null when it's ready.
 */
export function recoverFormProblem(alias: string, code: string): string | null {
  if (alias.trim().length < 3) return 'Please enter your alias.';
  if (!code.trim()) return 'Please enter your recovery code.';
  try {
    parseRecoveryCode(code).fill(0);
    return null;
  } catch (e) {
    return e instanceof RecoveryCodeError ? e.message : 'That code doesn’t look right.';
  }
}

/** Home → "Recovery code": set one up, make a new one (the old one stops working), or turn it off. */
export function RecoverySettings() {
  const { session, prepareRecoveryCode, turnOffRecovery } = useRequiredSession();
  const navigate = useNavigate();
  const has = session.user.hasRecoveryCode;
  const [pass, setPass] = useState('');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingRecoveryCode | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [turningOff, setTurningOff] = useState(false);

  async function onPrepare(e: FormEvent) {
    e.preventDefault();
    if (!pass || progress) return;
    setError(null);
    setDone(null);
    try {
      const p = await prepareRecoveryCode(pass, setProgress);
      setPass('');
      setPending(p);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setProgress(null);
    }
  }

  async function onConfirmed() {
    if (!pending) return;
    setSaving(true);
    setError(null);
    try {
      await pending.commit();
      setPending(null);
      setDone(pending.replacing ? 'Your new recovery code is saved. The old one no longer works.' : 'Your recovery code is set up.');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  async function onTurnOff(e: FormEvent) {
    e.preventDefault();
    if (!pass || progress) return;
    setError(null);
    try {
      await turnOffRecovery(pass, setProgress);
      setPass('');
      setTurningOff(false);
      setDone('Your recovery code is turned off. Only your passphrase opens your space now.');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="stack-lg" style={{ maxWidth: 640 }}>
      <p>
        <Link className="back-link" to="/vault">← Home</Link>
      </p>
      <PageTitle eyebrow="Your account" testId="recovery-title" lead="A way back in that only you hold.">
        Recovery code
      </PageTitle>

      {done && (
        <p className="card soft" role="status" data-testid="recovery-done">
          {done}
        </p>
      )}

      {pending ? (
        <>
          <RecoveryCodeCard code={pending.code} replacing={pending.replacing} busy={saving} error={error} onConfirmed={() => void onConfirmed()} />
          <div>
            <button type="button" className="btn btn-quiet btn-small" onClick={() => setPending(null)} disabled={saving}>
              Cancel{pending.replacing ? ' (keep my old code)' : ''}
            </button>
          </div>
        </>
      ) : (
        <form className="card stack" onSubmit={turningOff ? onTurnOff : onPrepare}>
          <RecoveryCodeExplainer />
          <p className="small" style={{ margin: 0 }} data-testid="recovery-status">
            {session.user.hasRecoveryCode ? 'You have a recovery code.' : 'You don’t have a recovery code yet.'}
          </p>
          <label className="field">
            <span>To make sure it’s you, type your passphrase</span>
            <input
              type="password"
              autoComplete="current-password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              data-testid="recovery-passphrase"
            />
          </label>
          <ProgressNote p={progress} />
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="row">
            {turningOff ? (
              <>
                <button className="btn btn-danger" type="submit" disabled={!pass || !!progress} data-testid="recovery-turn-off-confirm">
                  Turn off my recovery code
                </button>
                <button className="btn" type="button" onClick={() => setTurningOff(false)} disabled={!!progress}>
                  Keep it
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-primary" type="submit" disabled={!pass || !!progress} data-testid="recovery-set-up">
                  {progress ? 'Working…' : has ? 'Make a new code' : 'Set it up now'}
                </button>
                <button className="btn" type="button" onClick={() => navigate('/vault')} disabled={!!progress}>
                  Maybe later
                </button>
              </>
            )}
          </div>
          {has && !turningOff && (
            <p className="small muted" style={{ margin: 0 }}>
              A new code replaces the old one. Or you can{' '}
              <button type="button" className="btn btn-quiet btn-small" style={{ minHeight: 0, padding: '2px 6px' }} onClick={() => setTurningOff(true)}>
                turn it off
              </button>
              .
            </p>
          )}
        </form>
      )}
    </div>
  );
}

/** Signed out: "Forgot your passphrase?" → alias + code → a new passphrase → a new code, shown once → her space. */
export function RecoverScreen() {
  const { beginRecovery } = useSession();
  const navigate = useNavigate();
  const [step, setStep] = useState<'code' | 'passphrase' | 'newCode'>('code');
  const [alias, setAlias] = useState('');
  const [code, setCode] = useState('');
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [suggestion, setSuggestion] = useState(() => generatePassphrase());
  const [newCode, setNewCode] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const reset = useRef<RecoveryReset | null>(null);
  // leaving the page mid-way wipes the account secret held for the reset
  useEffect(() => () => reset.current?.cancel(), []);

  const problem = recoverFormProblem(alias, code);
  const strength = useMemo(() => passphraseStrength(pass), [pass]);
  const mismatch = confirm.length > 0 && confirm !== pass;
  const passOk = strength.level !== 'too-short' && strength.level !== 'weak' && pass === confirm;

  async function onCode(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (problem || progress) return;
    setError(null);
    try {
      reset.current = await beginRecovery(alias, code, setProgress);
      setCode('');
      setStep('passphrase');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setProgress(null);
    }
  }

  async function onPassphrase(e: FormEvent) {
    e.preventDefault();
    if (!passOk || progress || !reset.current) return;
    setError(null);
    try {
      const out = await reset.current.finish(pass, setProgress);
      reset.current = null;
      setPass('');
      setConfirm('');
      setNewCode(out.code);
      setStep('newCode');
    } catch (err) {
      setError(friendlyError(err));
      if (/enter your recovery code again/.test(String((err as Error).message))) {
        reset.current = null;
        setStep('code');
      }
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="stack-lg" style={{ maxWidth: 560, margin: '0 auto' }}>
      <PageTitle
        eyebrow="Forgot your passphrase?"
        testId="recover-title"
        lead={
          step === 'newCode'
            ? 'You’re back in. One last thing before you go to your space.'
            : 'If you made a recovery code, you can use it to set a new passphrase. Everything in your space stays as it is.'
        }
      >
        {step === 'newCode' ? 'Your new passphrase is set' : 'Set a new passphrase'}
      </PageTitle>

      {step === 'code' && (
        <form className="card stack" onSubmit={onCode} noValidate>
          <label className="field">
            <span>Alias</span>
            <input
              autoComplete="username"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              spellCheck={false}
              autoCapitalize="none"
              data-testid="recover-alias"
            />
          </label>
          <label className="field">
            <span>Recovery code</span>
            <span className="hint" id="rc-hint">
              28 letters and numbers. Spaces, dashes and capital letters don’t matter.
            </span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-describedby="rc-hint"
              aria-invalid={tried && !!problem}
              data-testid="recover-code"
            />
          </label>
          {tried && problem && <p className="error">{problem}</p>}
          <ProgressNote p={progress} />
          {error && <p className="error" role="alert">{error}</p>}
          <div className="row">
            <button className="btn btn-primary" type="submit" disabled={!!progress} data-testid="recover-continue">
              {progress ? 'Checking…' : 'Continue'}
            </button>
            <Link to="/signin">Back to sign in</Link>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            No recovery code? Then your passphrase can’t be reset, by us or anyone. That’s what keeps your space private.
          </p>
        </form>
      )}

      {step === 'passphrase' && (
        <form className="card stack" onSubmit={onPassphrase} noValidate>
          <p className="card soft" role="status" style={{ margin: 0 }}>
            Your code was accepted. Choose a new passphrase. Your old one will stop working, and anyone signed in with it
            will be signed out.
          </p>
          <div className="stack">
            <span className="small muted">Here’s a strong one, made on your device just now:</span>
            <div className="passphrase-suggestion">{suggestion}</div>
            <div className="row">
              <button
                type="button"
                className="btn btn-small"
                onClick={() => {
                  setPass(suggestion);
                  setConfirm('');
                  setShow(true);
                }}
              >
                Use this passphrase
              </button>
              <button type="button" className="btn btn-quiet btn-small" onClick={() => setSuggestion(generatePassphrase())}>
                Suggest another
              </button>
            </div>
          </div>
          <label className="field">
            <span>New passphrase</span>
            <input
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              aria-describedby="new-strength"
              spellCheck={false}
              autoCapitalize="none"
              data-testid="recover-new-passphrase"
            />
          </label>
          <div className="meter" aria-hidden="true">
            <span style={{ width: pass ? STRENGTH_WIDTH[strength.level] : '0%' }} />
          </div>
          <p id="new-strength" className="small muted" aria-live="polite">
            {pass ? strength.message : 'Five random words are easier to remember — and harder to guess — than a short password.'}
          </p>
          <label className="field">
            <span>Type it again</span>
            <input
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={mismatch}
              spellCheck={false}
              autoCapitalize="none"
              data-testid="recover-new-passphrase-again"
            />
          </label>
          {mismatch && <p className="error">These don’t match yet.</p>}
          <label className="check">
            <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
            <span>Show passphrase</span>
          </label>
          <ProgressNote p={progress} />
          {error && <p className="error" role="alert">{error}</p>}
          <div className="row">
            <button className="btn btn-primary" type="submit" disabled={!passOk || !!progress} data-testid="recover-set-passphrase">
              {progress ? 'Working…' : 'Set my new passphrase'}
            </button>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            You’ll also get a new recovery code. The one you just used stops working.
          </p>
        </form>
      )}

      {step === 'newCode' && newCode && (
        <RecoveryCodeCard code={newCode} confirmLabel="Saved — go to my space" onConfirmed={() => navigate('/vault', { replace: true })} />
      )}
    </div>
  );
}
