import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { RegisterRequest, Role } from '@matra/shared';
import { generatePassphrase, passphraseStrength } from '../lib/passphrase';
import { friendlyError, useSession, type Progress } from '../lib/session';
import { US_STATES } from './common';

const PROGRESS_TEXT: Record<Progress, string> = {
  deriving: 'Deriving your keys on this device… this takes a few seconds on purpose — it makes your passphrase much harder to guess.',
  generating: 'Creating your private sharing key…',
  contacting: 'Talking to the server (it only ever sees locked data)…',
  unlocking: 'Unlocking your vault…',
};

function ProgressNote({ p }: { p: Progress | null }) {
  if (!p) return null;
  return (
    <p className="row muted" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" /> {PROGRESS_TEXT[p]}
    </p>
  );
}

const STRENGTH_WIDTH = { 'too-short': '10%', weak: '35%', okay: '65%', strong: '100%' } as const;

export function CreateAccountForm({ role }: { role: Role }) {
  const { register } = useSession();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [ack, setAck] = useState(false);
  const [adult, setAdult] = useState(false);
  const [suggestion, setSuggestion] = useState(() => generatePassphrase());
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // attorney profile
  const [displayName, setDisplayName] = useState('');
  const [organization, setOrganization] = useState('');
  const [barNumber, setBarNumber] = useState('');
  const [jurisdictions, setJurisdictions] = useState<string[]>(['NJ']);
  const [practiceAreas, setPracticeAreas] = useState('Sexual assault, Civil protective orders, Victims’ rights');
  const [proBono, setProBono] = useState(true);

  const strength = useMemo(() => passphraseStrength(pass), [pass]);
  const mismatch = confirm.length > 0 && confirm !== pass;
  const valid =
    username.trim().length >= 3 &&
    strength.level !== 'too-short' &&
    strength.level !== 'weak' &&
    pass === confirm &&
    ack &&
    (role !== 'survivor' || adult) &&
    (role !== 'attorney' || (displayName.trim() && jurisdictions.length > 0));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || progress) return;
    setError(null);
    try {
      let attorneyProfile: RegisterRequest['attorneyProfile'];
      if (role === 'attorney') {
        attorneyProfile = {
          displayName: displayName.trim(),
          organization: organization.trim() || undefined,
          barNumber: barNumber.trim() || undefined,
          jurisdictions,
          practiceAreas: practiceAreas.split(',').map((s) => s.trim()).filter(Boolean),
          acceptsProBono: proBono,
        };
      }
      await register({ username, passphrase: pass, role, attorneyProfile, adultAffirmed: adult }, setProgress);
      navigate(role === 'attorney' ? '/attorney/cases' : '/vault', { replace: true });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setProgress(null);
    }
  }

  return (
    <form className="stack-lg" onSubmit={onSubmit} noValidate>
      <div className="card stack">
        <label className="field">
          <span>{role === 'attorney' ? 'Username' : 'Choose an alias'}</span>
          <span className="hint" id="alias-hint">
            {role === 'attorney'
              ? 'Used to sign in. Clients will see your display name and organization.'
              : 'Please don’t use your real name or email. Something like “bluebird-42” is perfect — it keeps you anonymous even to us.'}
          </span>
          <input
            autoComplete="username"
            aria-describedby="alias-hint"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            spellCheck={false}
            autoCapitalize="none"
            required
            minLength={3}
          />
        </label>
      </div>

      <div className="card stack">
        <h2>Your passphrase</h2>
        <p>
          Your passphrase is the only key to your vault. Everything is locked on this device before it is sent, so not even
          we can read it.
        </p>
        <div className="card warn stack" role="note">
          <strong>We cannot reset this.</strong> If you lose it, your vault cannot be opened — that’s what keeps it safe.
        </div>
        <div className="stack">
          <span className="small muted">A strong option, generated on your device just now:</span>
          <div className="passphrase-suggestion" aria-live="polite">
            {suggestion}
          </div>
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
          <span>Passphrase</span>
          <input
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            aria-describedby="strength"
            spellCheck={false}
            autoCapitalize="none"
          />
        </label>
        <div className="meter" aria-hidden="true">
          <span style={{ width: pass ? STRENGTH_WIDTH[strength.level] : '0%' }} />
        </div>
        <p id="strength" className="small muted" aria-live="polite">
          {pass ? strength.message : 'Five random words are easier to remember and harder to guess than a short password.'}
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
          />
        </label>
        {mismatch && <p className="error">These don’t match yet.</p>}
        <label className="check">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
          <span>Show passphrase</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span>I’ve written my passphrase down somewhere safe, and I understand it can’t be reset.</span>
        </label>
      </div>

      {role === 'survivor' && (
        <div className="card stack">
          <h2>Adults only</h2>
          <p className="small muted">
            Matra is a tool for adults. If you are worried a child or teenager is being abused, please contact the
            appropriate authorities (in New Jersey, call 1-877-NJ-ABUSE) or 911 if someone is in danger right now.
          </p>
          <label className="check">
            <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
            <span>I am 18 or older, and I understand Matra is not for reporting child abuse.</span>
          </label>
        </div>
      )}

      {role === 'attorney' && (
        <fieldset className="card stack" style={{ border: '1px solid var(--matra-border)' }}>
          <legend>
            <h2 style={{ margin: 0 }}>Professional profile</h2>
          </legend>
          <p className="small muted">
            Survivors see this before deciding whether to share with you. Your account stays “pending” until our team
            verifies your bar admission.
          </p>
          <label className="field">
            <span>Display name</span>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </label>
          <label className="field">
            <span>Organization</span>
            <input value={organization} onChange={(e) => setOrganization(e.target.value)} />
          </label>
          <label className="field">
            <span>Bar number</span>
            <input value={barNumber} onChange={(e) => setBarNumber(e.target.value)} />
          </label>
          <label className="field">
            <span>Jurisdictions (states you’re admitted in)</span>
            <span className="hint">Hold Ctrl/⌘ to select more than one.</span>
            <select
              multiple
              size={6}
              value={jurisdictions}
              onChange={(e) => setJurisdictions(Array.from(e.target.selectedOptions, (o) => o.value))}
            >
              {US_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Practice areas</span>
            <span className="hint">Comma-separated.</span>
            <input value={practiceAreas} onChange={(e) => setPracticeAreas(e.target.value)} />
          </label>
          <label className="check">
            <input type="checkbox" checked={proBono} onChange={(e) => setProBono(e.target.checked)} />
            <span>I accept pro bono matters</span>
          </label>
        </fieldset>
      )}

      <ProgressNote p={progress} />
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={!valid || !!progress} aria-disabled={!valid || !!progress}>
          {progress ? 'Working…' : role === 'attorney' ? 'Create attorney account' : 'Create my private vault'}
        </button>
        <Link to={role === 'attorney' ? '/attorney/signin' : '/signin'}>I already have one</Link>
      </div>
    </form>
  );
}

export function SignInForm({ role }: { role: Role }) {
  const { login, lockReason } = useSession();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [pass, setPass] = useState('');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !pass || progress) return;
    setError(null);
    try {
      const s = await login(username, pass, setProgress);
      setPass('');
      navigate(s.user.role === 'attorney' ? '/attorney/cases' : '/vault', { replace: true });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setProgress(null);
    }
  }

  return (
    <form className="card stack" onSubmit={onSubmit}>
      {lockReason === 'idle' && (
        <p className="card soft" role="status">
          We locked your vault after 15 minutes without activity, to keep it safe. Sign in again to continue.
        </p>
      )}
      <label className="field">
        <span>{role === 'attorney' ? 'Username' : 'Alias'}</span>
        <input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} spellCheck={false} autoCapitalize="none" />
      </label>
      <label className="field">
        <span>Passphrase</span>
        <input type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} />
      </label>
      <ProgressNote p={progress} />
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={!!progress}>
          {progress ? 'Unlocking…' : 'Unlock'}
        </button>
        <Link to={role === 'attorney' ? '/attorney/register' : '/start'}>Create an account</Link>
      </div>
    </form>
  );
}
