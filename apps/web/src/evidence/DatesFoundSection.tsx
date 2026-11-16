/**
 * "Dates found in your files" (PR 35). OFF by default: only in a build made with MATRA_DATES_FOUND=on (./datesFlag.ts).
 *
 * Shown only (1) after she has sealed her account, because the plan requires her own account to be on record before any date
 * from a file is put in front of her, so it cannot refresh her memory (N.J.R.E. 612 / FRE 612, counsel question Q-074), and
 * (2) when she asks. The narrative baseline that gate should really use is P2, which does not exist; `sealed` is the integration
 * point (today the Evidence screen passes "she has a sealed account").
 *
 * It lists strings exactly as written in her files with the file each came from. It is never merged into her account or her PDF.
 */
import { useMemo, useState } from 'react';
import { datesFound, type DatesSource } from './datesFound';

export function DatesFoundSection({ sealed, files }: { sealed: boolean; files: readonly DatesSource[] }) {
  const [asked, setAsked] = useState(false);
  const found = useMemo(() => (asked ? datesFound(files) : []), [asked, files]);
  if (!sealed) return null;
  return (
    <section className="card stack" aria-labelledby="dates-found" data-testid="dates-found">
      <h2 id="dates-found">Dates found in your files</h2>
      <p className="small muted">
        If you’d like, Matra can list the dates written in your files, exactly as they’re written, with the file each one came from. It doesn’t add them to your story or
        check them against anything you wrote.
      </p>
      {!asked ? (
        <div>
          <button type="button" className="btn btn-small" onClick={() => setAsked(true)}>
            Show the dates
          </button>
        </div>
      ) : found.length === 0 ? (
        <p className="muted">No dates were found in the files you’ve had read, or in their saved details.</p>
      ) : (
        <ul className="list" data-testid="dates-found-list">
          {found.map((d, i) => (
            <li key={i}>
              <strong>{d.text}</strong>
              <span className="small muted">
                {' '}
                · exhibit {d.exhibit}, {d.fileName} · {d.source === 'text-in-image' ? 'written in the image' : `in the file’s saved details (${d.field})`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
