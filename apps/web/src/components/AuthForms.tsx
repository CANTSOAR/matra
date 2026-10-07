import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { RegisterRequest, Role } from '@matra/shared';
import { generatePassphrase, passphraseStrength } from '../lib/passphrase';
import { friendlyError, useSession, type Progress } from '../lib/session';
import { US_STATES } from './common';

const PROGRESS_TEXT: Record<Progress, string> = {
  deriving: 'Making your keys on this device… This takes a few seconds on purpose. It makes your passphrase much harder to guess.',
  generating: 'Creating your private sharing key…',
  contacting: 'Talking to our server (it only ever sees locked data)…',
  unlocking: 'Unlocking your space…',
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
  const [preferredName, setPreferredName] = useState('');
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [ack, setAck] = useState(false);
  const [adult, setAdult] = useState(false);
  const [under18, setUnder18] = useState(false);
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
      await register(
        { username, passphrase: pass, role, attorneyProfile, ageConfirmed18: adult, ...(role === 'survivor' && { preferredName }) },
        setProgress,
      );
      navigate(role === 'attorney' ? '/attorney/cases' : '/vault', { replace: true, state: { firstVisit: true } });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setProgress(null);
    }
  }

  if (under18) {
    return (
      <Under18Notice
        onBack={() => {
          setUnder18(false);
          setAdult(false);
        }}
      />
    );
  }

  return (
    <form className="stack-lg" onSubmit={onSubmit} noValidate>
      <div className="card stack">
        {role === 'survivor' && <h2>About you</h2>}
        <label className="field">
          <span>{role === 'attorney' ? 'Username' : 'Choose an alias'}</span>
          <span className="hint" id="alias-hint">
            {role === 'attorney'
              ? 'Used to sign in. Clients will see your display name and organization.'
              : 'This is what you’ll sign in with. Please don’t use your real name or email — something like “bluebird-42” is perfect. It keeps you anonymous, even to us.'}
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
            data-testid="alias-input"
          />
        </label>
        {role === 'survivor' && (
          <label className="field">
            <span>
              What should we call you? <span className="hint">(optional)</span>
            </span>
            <span className="hint" id="name-hint">
              It can be anything — a nickname is fine. It’s locked with the rest of your space, so only you will see it.
            </span>
            <input
              autoComplete="off"
              aria-describedby="name-hint"
              value={preferredName}
              onChange={(e) => setPreferredName(e.target.value)}
              maxLength={60}
              data-testid="preferred-name-input"
            />
          </label>
        )}
      </div>

      <div className="card stack">
        <h2>Your passphrase</h2>
        <p>
          Your passphrase is the only key to your space. Everything is locked on this device before it’s sent, so not even
          we can read it.
        </p>
        <div className="card warn stack" role="note">
          <p style={{ margin: 0 }}>
            <strong>We can’t reset it.</strong> If it’s lost, your space can’t be opened — by you or anyone else. That’s
            what keeps it safe.
          </p>
        </div>
        <div className="stack">
          <span className="small muted">Here’s a strong one, made on your device just now:</span>
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
          <h2>Matra is for adults</h2>
          <p className="small muted">
            Matra is made for people 18 and older. If you’re worried a child or teenager is being hurt, the Childhelp
            hotline (1-800-422-4453) can help. If someone is in danger right now, call 911.
          </p>
          <label className="check">
            <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
            <span>I am 18 or older.</span>
          </label>
          <div>
            <button
              type="button"
              className="btn btn-quiet btn-small"
              onClick={() => {
                // Nothing typed here has been sent or stored; drop it from memory too.
                setUsername('');
                setPreferredName('');
                setPass('');
                setConfirm('');
                setUnder18(true);
              }}
            >
              I’m under 18
            </button>
          </div>
        </div>
      )}

      {role === 'attorney' && (
        <fieldset className="card stack">
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
        <button
          className="btn btn-primary btn-large"
          type="submit"
          disabled={!valid || !!progress}
          aria-disabled={!valid || !!progress}
          data-testid="create-account"
        >
          {progress ? 'Working…' : role === 'attorney' ? 'Create attorney account' : 'Create my private space'}
        </button>
        <Link to={role === 'attorney' ? '/attorney/signin' : '/signin'}>I already have one</Link>
      </div>
      {role === 'survivor' && !valid && !progress && (
        <p className="small muted" style={{ marginTop: 8 }}>
          When your alias, passphrase and the two checkboxes are done, this button will be ready.
        </p>
      )}
    </form>
  );
}

/** Shown instead of the registration form to anyone who says they are under 18. Nothing is saved or sent. */
export function Under18Notice({ onBack }: { onBack: () => void }) {
  return (
    <section className="card stack" aria-labelledby="under18-title" role="region">
      <h2 id="under18-title" tabIndex={-1} data-autofocus>
        Thank you for telling us
      </h2>
      <p>
        Matra is built for adults, so we can’t make a space for you here. That isn’t because what happened to you
        matters less. It matters, and you deserve help that is made for you.
      </p>
      <p>These free, private services help young people, any time of day or night:</p>
      <ul className="stack" style={{ paddingLeft: 18, margin: 0 }}>
        <li>
          <strong>Childhelp National Child Abuse Hotline</strong> — call or text{' '}
          <a href="tel:+18004224453" style={{ whiteSpace: 'nowrap' }}>1-800-422-4453</a>. You can talk to someone without giving your name.
        </li>
        <li>
          <strong>RAINN National Sexual Assault Hotline</strong> — call <a href="tel:+18006564673">800-656-4673</a>, or
          chat at{' '}
          <a href="https://online.rainn.org" target="_blank" rel="noopener noreferrer">
            online.rainn.org
          </a>
          .
        </li>
        <li>
          If you are in danger right now, call <a href="tel:911">911</a>.
        </li>
      </ul>
      <p>A school counselor, nurse, or another adult you trust can also help you take the next step.</p>
      <p className="small muted">Nothing you typed on this page has been saved or sent anywhere.</p>
      <div>
        <button type="button" className="btn btn-small" onClick={onBack}>
          Go back
        </button>
      </div>
    </section>
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
          We locked your space after 15 minutes of quiet, to keep it safe. Everything is still here — sign in again
          whenever you’re ready.
        </p>
      )}
      <label className="field">
        <span>{role === 'attorney' ? 'Username' : 'Alias'}</span>
        <input
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          spellCheck={false}
          autoCapitalize="none"
          data-testid="signin-username"
        />
      </label>
      <label className="field">
        <span>Passphrase</span>
        <input
          type="password"
          autoComplete="current-password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          data-testid="signin-passphrase"
        />
      </label>
      <ProgressNote p={progress} />
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={!!progress} data-testid="signin-submit">
          {progress ? 'Unlocking…' : 'Unlock'}
        </button>
        <Link to={role === 'attorney' ? '/attorney/register' : '/start'}>Create an account</Link>
      </div>
    </form>
  );
}
