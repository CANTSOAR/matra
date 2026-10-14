import { useState, type ReactNode } from 'react';
import { ErrorNote } from './common';
import { friendlyError, useRequiredSession } from '../lib/session';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * "Download my data": decrypts everything on this device into one .zip, after a clear warning.
 * Used on Home and, before deleting, on the "Delete everything" screen.
 */
export function ExportCard({
  title = 'Your data',
  headingId = 'your-data',
  testId = 'home-data',
  children,
}: {
  title?: string;
  headingId?: string;
  testId?: string;
  /** extra content at the bottom of the card */
  children?: ReactNode;
}) {
  const { api, session } = useRequiredSession();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      // loaded on demand: most visits never export, so the zip code stays out of the home screen
      const { buildDataExport, downloadBytes } = await import('../lib/export');
      const out = await buildDataExport(api, session.masterKey, session.user.username);
      downloadBytes(out.zip, out.fileName, 'application/zip');
      setDone(
        `Downloaded ${out.fileName}: ${plural(out.recordCount, 'saved version')} and ${plural(out.evidenceCount, 'evidence file')}.` +
          (out.problems.length ? ` ${out.problems.length} file(s) had a problem — see evidence/manifest.json.` : ''),
      );
      setConfirming(false);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card stack" aria-labelledby={headingId} data-testid={testId}>
      <div className="section-title">
        <h2 id={headingId}>{title}</h2>
        {!confirming && (
          <button className="btn btn-small" type="button" onClick={() => setConfirming(true)}>
            Download my data
          </button>
        )}
      </div>
      <p className="small muted">
        Get a copy of everything in your space — every version of your story, your drafts, and your evidence files — as
        one .zip file. It’s unlocked on this device. Nothing extra is sent to our server.
      </p>
      {confirming && (
        <div className="card warn stack" role="note">
          <p>
            <strong>The downloaded file is not encrypted.</strong> Anyone who can open this device, or the file, can read
            everything in it. If someone else uses this device, think about downloading it somewhere safer. Delete it (and
            empty the trash) when you’re done.
          </p>
          <div className="row">
            <button className="btn btn-primary btn-small" type="button" onClick={() => void run()} disabled={busy}>
              {busy ? 'Unlocking and packaging…' : 'I understand — download'}
            </button>
            <button className="btn btn-small" type="button" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {done && <p role="status">{done}</p>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {children}
    </section>
  );
}
