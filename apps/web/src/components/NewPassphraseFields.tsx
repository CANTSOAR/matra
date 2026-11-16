import { useEffect, useState } from 'react';
import type { Role } from '@matra/shared';
import {
  canChoosePassphrase,
  generatePassphrase,
  passphraseAccepted,
  passphraseStrength,
  passphraseWords,
  type Strength,
} from '../lib/passphrase';

export const STRENGTH_WIDTH: Record<Strength, string> = { 'too-short': '10%', weak: '35%', okay: '65%', strong: '100%' };

const WORD_NAMES: Record<number, string> = { 6: 'Six', 7: 'Seven' };

/**
 * Choosing a new passphrase (create account, reset with a recovery code, change it). Reports the passphrase once it
 * can be used, else null.
 *
 * Survivors: a suggestion of six random words made on this device, which she can use, or her own, which must reach the
 * meter's "strong" (a harsh score, with no bit claim, and copy saying the suggestion is safer). Attorneys and counselors: seven random words made here, and only those
 * (they can ask for different words, not type their own); typing it again is how they show they copied it.
 */
export function NewPassphraseFields({
  role,
  label = 'Passphrase',
  context = [],
  inputTestId,
  againTestId,
  onChange,
}: {
  role: Role;
  label?: string;
  /** words an attacker would try first (her alias), which the meter counts for nothing */
  context?: readonly string[];
  inputTestId?: string;
  againTestId?: string;
  onChange: (accepted: string | null) => void;
}) {
  const words = passphraseWords(role);
  const choose = canChoosePassphrase(role);
  const [suggestion, setSuggestion] = useState(() => generatePassphrase(words));
  // every suggestion shown here: only those count as generated (six list words she typed herself are not random)
  const [shown] = useState(() => new Set<string>());
  shown.add(suggestion);
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const meter = { generatedHere: shown.has(pass) };
  const strength = passphraseStrength(pass, context, meter);
  const value = choose ? pass : suggestion;
  const mismatch = confirm.length > 0 && confirm !== value;
  const accepted = confirm === value && (choose ? passphraseAccepted(pass, context, meter) : true) ? value : null;

  useEffect(() => onChange(accepted), [accepted, onChange]);

  const againField = (
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
        data-testid={againTestId}
      />
    </label>
  );

  if (!choose) {
    return (
      <>
        <div className="stack">
          <span className="small muted">Your passphrase: {WORD_NAMES[words]?.toLowerCase() ?? words} random words, made on this device just now.</span>
          <div className="passphrase-suggestion" aria-live="polite" data-testid="generated-passphrase">
            {suggestion}
          </div>
          <div className="row">
            <button
              type="button"
              className="btn btn-quiet btn-small"
              onClick={() => {
                setSuggestion(generatePassphrase(words));
                setConfirm('');
              }}
            >
              Different words
            </button>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Attorney and counselor accounts always use words made here, never ones you choose, because your account opens
            what survivors share with you. Type it again below, exactly as shown, dashes included.
          </p>
          <WordListCredit />
        </div>
        {againField}
        {mismatch && <p className="error">These don’t match yet.</p>}
        <label className="check">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
          <span>Show what I type</span>
        </label>
      </>
    );
  }

  return (
    <>
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
          <button type="button" className="btn btn-quiet btn-small" onClick={() => setSuggestion(generatePassphrase(words))}>
            Suggest another
          </button>
        </div>
        <WordListCredit />
      </div>
      <label className="field">
        <span>{label}</span>
        <input
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          aria-describedby="new-passphrase-strength"
          spellCheck={false}
          autoCapitalize="none"
          data-testid={inputTestId}
        />
      </label>
      <div className="meter" aria-hidden="true">
        <span style={{ width: pass ? STRENGTH_WIDTH[strength.level] : '0%' }} />
      </div>
      <p id="new-passphrase-strength" className="small muted" aria-live="polite" data-testid="passphrase-strength">
        {pass
          ? strength.message
          : `${WORD_NAMES[words]} random words made on your device are the safest choice. A phrase you make up yourself is easier to guess, so it has to be longer.`}
      </p>
      {againField}
      {mismatch && <p className="error">These don’t match yet.</p>}
      <label className="check">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
        <span>Show passphrase</span>
      </label>
    </>
  );
}

/** CC BY 4.0 attribution for the word list (NOTICE), shown wherever its words are. */
export function WordListCredit() {
  return (
    <p className="small muted" style={{ margin: 0 }} data-testid="wordlist-credit">
      Words from the EFF Short Wordlist #1 (Electronic Frontier Foundation), shortened by Matra;{' '}
      <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">
        CC BY 4.0
      </a>
      .
    </p>
  );
}
