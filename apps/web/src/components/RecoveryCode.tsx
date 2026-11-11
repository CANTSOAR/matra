import { useState, type FormEvent } from 'react';
import { recoveryTailMatches } from '@matra/crypto';
import { ErrorNote } from './common';

/** What a recovery code is, in her words. Shown before she makes one and next to the code itself. */
export function RecoveryCodeExplainer() {
  return (
    <div className="stack">
      <p style={{ margin: 0 }}>
        If you ever forget your passphrase, this code lets you set a new one. <strong>Only you have it</strong>; Matra
        can’t see it or send it to you again.
      </p>
      <p className="small muted" style={{ margin: 0 }}>
        Anyone who has it and knows your alias could get into your account, so keep it somewhere only you can reach. You
        don’t have to set one up.
      </p>
    </div>
  );
}

/**
 * Show-once: the code, ways to keep it (copy, a text file, print), and a confirm step: she types its last 4
 * characters before `onConfirmed` runs. Once this is gone from the screen, nobody can show the code again.
 */
export function RecoveryCodeCard({
  code,
  replacing = false,
  busy = false,
  error,
  confirmLabel = 'I’ve saved it',
  onConfirmed,
}: {
  code: string;
  replacing?: boolean;
  busy?: boolean;
  error?: string | null;
  confirmLabel?: string;
  onConfirmed(): void;
}) {
  const [typed, setTyped] = useState('');
  const [tried, setTried] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [downloadWarn, setDownloadWarn] = useState(false);
  const ok = recoveryTailMatches(typed, code);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied('Copied. Paste it somewhere safe, then clear your clipboard if others use this device.');
    } catch {
      setCopied('Copying didn’t work here. Please write it down instead.');
    }
  }

  async function download() {
    const { downloadBytes } = await import('../lib/export');
    const text = `Matra recovery code\n\n${code}\n\nIf you forget your passphrase, this code lets you set a new one.\nAnyone who has it and knows your alias could get into your account. Keep it somewhere only you can reach.\n`;
    downloadBytes(new TextEncoder().encode(text), 'matra-recovery-code.txt', 'text/plain');
    setDownloadWarn(false);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (ok && !busy) onConfirmed();
  }

  return (
    <section className="card stack" aria-labelledby="rc-title" data-testid="recovery-code-card">
      <h2 id="rc-title">Your recovery code</h2>
      <RecoveryCodeExplainer />
      {replacing && (
        <p className="card soft" role="note" style={{ margin: 0 }}>
          Your old code will stop working.
        </p>
      )}
      <div className="passphrase-suggestion recovery-code" data-testid="recovery-code" aria-label="Recovery code">
        {code}
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        This is the only time it will be shown. Write it down, or keep it one of these ways:
      </p>
      <div className="row">
        <button type="button" className="btn btn-small" onClick={() => void copy()}>
          Copy
        </button>
        <button type="button" className="btn btn-small" onClick={() => setDownloadWarn(true)}>
          Download as a text file
        </button>
        <button type="button" className="btn btn-small" onClick={() => window.print()}>
          Print
        </button>
      </div>
      {copied && <p className="small" role="status">{copied}</p>}
      {downloadWarn && (
        <div className="card warn stack" role="note">
          <p style={{ margin: 0 }}>
            <strong>The downloaded file is not encrypted.</strong> Anyone who can open this device, or the file, can read
            the code. Move it somewhere only you can reach, and delete the download (and empty the trash).
          </p>
          <div className="row">
            <button className="btn btn-primary btn-small" type="button" onClick={() => void download()}>
              I understand — download
            </button>
            <button className="btn btn-small" type="button" onClick={() => setDownloadWarn(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <form className="stack" onSubmit={onSubmit} noValidate>
        <label className="field">
          <span>To check you saved it, type the last 4 characters</span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            maxLength={9}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-invalid={tried && !ok}
            data-testid="recovery-confirm-input"
          />
        </label>
        {tried && !ok && <p className="error">Those aren’t the last 4 characters. Look at the end of the code above.</p>}
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="row">
          <button className="btn btn-primary" type="submit" disabled={busy} data-testid="recovery-confirm">
            {busy ? 'Saving…' : confirmLabel}
          </button>
        </div>
      </form>
    </section>
  );
}
