/**
 * One short step before a sealed match: confirm a phone number by text (W13 Sybil friction; server src/sms.ts).
 *
 * The server sends a code, checks it, and then forgets the number: it keeps only a scrambled fingerprint (a keyed hash)
 * in a table that isn't connected to her account, so one phone can't turn on sealed matching for lots of accounts, and a
 * yes/no flag on her account. In development and demos the code comes from a mock provider and is shown on screen.
 *
 * On success it seals whatever her current sealed record chose for a sealed match but couldn't seal yet
 * (space/adapters.ts retrySealedMatches) and returns to Home. She can always skip: her story is saved either way.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ErrorNote, Loading, PageTitle, useAsync } from '../components/common';
import { friendlyError, useRequiredSession } from '../lib/session';
import { retrySealedMatches } from '../space/adapters';

const RESEND_AFTER_MS = 30_000;

export function PhoneVerify() {
  const { api, session } = useRequiredSession();
  const navigate = useNavigate();
  const status = useAsync(() => api.phoneVerificationStatus(), [api]);
  const [phone, setPhone] = useState('');
  const [challenge, setChallenge] = useState<{ id: string; demoCode?: string; sentAt: number } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ sealed: number; sealError?: string } | null>(null);
  const [canResend, setCanResend] = useState(false);

  useEffect(() => {
    if (!challenge) return;
    setCanResend(false);
    const t = window.setTimeout(() => setCanResend(true), Math.max(0, challenge.sentAt + RESEND_AFTER_MS - Date.now()));
    return () => window.clearTimeout(t);
  }, [challenge]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    setBusy('Sending a code…');
    setError(null);
    try {
      const r = await api.startPhoneVerification(phone);
      setChallenge({ id: r.challengeId, demoCode: r.demoCode, sentAt: Date.now() });
      setCode('');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(null);
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    setBusy('Checking the code…');
    setError(null);
    try {
      await api.checkPhoneVerification(challenge.id, code.trim());
    } catch (err) {
      setError(friendlyError(err));
      setBusy(null);
      return;
    }
    setPhone('');
    setChallenge(null);
    setBusy('Turning on your sealed match…');
    try {
      setDone({ sealed: await retrySealedMatches(api, session.masterKey) });
    } catch (err) {
      setDone({ sealed: 0, sealError: friendlyError(err) });
    } finally {
      setBusy(null);
    }
  }

  const header = (
    <>
      <p>
        <Link className="back-link" to="/vault">← Home</Link>
      </p>
      <PageTitle eyebrow="Sealed match">One quick step before your sealed match</PageTitle>
    </>
  );

  if (done) {
    return (
      <div className="stack-lg">
        {header}
        <div className="card soft stack" role="status" data-testid="phone-verified">
          <p style={{ margin: 0 }}>
            <strong>Done. The number has been forgotten.</strong>
          </p>
          <p style={{ margin: 0 }}>
            {done.sealed > 0
              ? 'Your sealed match is on. Nothing has been sent to anyone.'
              : 'You can now use a sealed match whenever you choose one for someone you named.'}
          </p>
        </div>
        {done.sealError && (
          <div className="card warn">The sealed match could not be set up right now ({done.sealError}). You can try again later from Home.</div>
        )}
        <div className="row">
          <button className="btn btn-primary" onClick={() => navigate('/vault')}>
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack-lg">
      {header}
      {status.loading && <Loading />}
      {status.error && <ErrorNote>{status.error}</ErrorNote>}
      {status.data?.verified && (
        <div className="card soft" role="status" data-testid="phone-already-verified">
          You’ve already confirmed a phone number. The number itself wasn’t kept. <Link to="/vault">Back to Home</Link>
        </div>
      )}
      {status.data && !status.data.verified && (
        <>
          <section className="card soft stack" aria-label="Why we ask">
            <p style={{ margin: 0 }}>
              To make it harder for someone to fake a match with made-up accounts, we ask for a phone number that can get
              texts. We send a code, check it, and then <strong>forget the number</strong>.
            </p>
            <p style={{ margin: 0 }}>
              We keep only a scrambled fingerprint of it that isn’t connected to your account, so one phone can’t be used
              for lots of accounts. It doesn’t have to be your main number.
            </p>
            <p style={{ margin: 0 }}>You can skip this. Your story is saved either way.</p>
          </section>

          {!challenge ? (
            <form className="card stack" onSubmit={(e) => void send(e)} aria-label="Phone number">
              <label className="field">
                <span>Phone number that can get texts</span>
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  data-testid="phone-verify-number"
                />
              </label>
              {error && <ErrorNote>{error}</ErrorNote>}
              <div className="row">
                <button className="btn btn-primary" type="submit" disabled={!phone.trim() || !!busy}>
                  Text me a code
                </button>
                <Link className="btn btn-quiet" to="/vault">
                  Not now
                </Link>
              </div>
            </form>
          ) : (
            <form className="card stack" onSubmit={(e) => void confirm(e)} aria-label="Code">
              <p style={{ margin: 0 }}>We sent a code by text. It works for 10 minutes.</p>
              {challenge.demoCode && (
                <p className="small muted" style={{ margin: 0 }} data-testid="phone-demo-code">
                  Demo: your code is {challenge.demoCode}
                </p>
              )}
              <label className="field">
                <span>Code from the text</span>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  data-testid="phone-verify-code"
                />
              </label>
              {error && <ErrorNote>{error}</ErrorNote>}
              <div className="row">
                <button className="btn btn-primary" type="submit" disabled={!code.trim() || !!busy}>
                  Confirm
                </button>
                {canResend && (
                  <button className="btn btn-quiet" type="button" onClick={() => void send()} disabled={!!busy}>
                    Didn’t get it? Send again
                  </button>
                )}
                <button
                  className="btn btn-quiet"
                  type="button"
                  onClick={() => {
                    setChallenge(null);
                    setError(null);
                  }}
                  disabled={!!busy}
                >
                  Use a different number
                </button>
                <Link className="btn btn-quiet" to="/vault">
                  Not now
                </Link>
              </div>
            </form>
          )}
        </>
      )}
      {busy && <Loading label={busy} />}
    </div>
  );
}
