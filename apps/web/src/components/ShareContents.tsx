/**
 * What a recipient would get, as she decides: the attorney share (screens/Share.tsx) and the counselor release
 * (counselor/ReportRequest.tsx) show the same words, from the same table as her consent statement and the server's
 * checks (@matra/shared consent.ts). Her written account is always shared, whole; the evidence files themselves are
 * chosen one by one, and none is ticked until she ticks it.
 */
import type { EvidenceItem } from '@matra/shared';
import { ACCOUNT_PARTS } from '@matra/shared';
import { formatBytes } from '../lib/vault';

export function ShareContents({
  recipient,
  summaryLine,
  files,
  listed,
  chosen,
  onChange,
}: {
  /** "the attorney", "the counselor" */
  recipient: string;
  /** what their app does with the account (the incident summary) */
  summaryLine: string;
  /** her uploaded files, the only ones that can be shared */
  files: EvidenceItem[];
  /** every file her written account lists (uploaded or not): all of their names travel with it */
  listed: EvidenceItem[];
  chosen: ReadonlySet<string>;
  onChange(next: Set<string>): void;
}) {
  const toggle = (blobId: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(blobId);
    else next.delete(blobId);
    onChange(next);
  };
  return (
    <section className="card stack" aria-labelledby="sc-h" data-testid="share-contents">
      <h2 id="sc-h" style={{ margin: 0 }}>
        What {recipient} would get
      </h2>
      <div className="stack" data-testid="share-account">
        <h3 style={{ margin: 0 }}>Always shared: your written account</h3>
        <p className="small" style={{ margin: 0 }}>
          It can’t be left out, and it isn’t split up: {recipient} gets everything you wrote or chose in Matra, including any of
          these you gave:
        </p>
        <ul className="small" style={{ margin: 0, paddingLeft: '1.2em' }} data-testid="account-parts">
          {ACCOUNT_PARTS.map((p) => (
            <li key={p.id} data-part={p.id}>
              {p.screen}
            </li>
          ))}
        </ul>
        <p className="small muted" style={{ margin: 0 }}>
          {summaryLine}
        </p>
      </div>
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }} data-testid="share-files">
        <legend>
          <h3 style={{ margin: 0 }}>Your evidence files themselves: only the ones you tick</h3>
        </legend>
        {files.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>
            You haven’t added any files to your space, so no files can be shared.
          </p>
        ) : (
          <>
            {files.map((f) => (
              <label className="check" key={f.blobId}>
                <input type="checkbox" checked={chosen.has(f.blobId!)} onChange={(e) => toggle(f.blobId!, e.target.checked)} />
                <span>
                  {f.fileName} <span className="small muted">({f.kind}, {formatBytes(f.sizeBytes)})</span>
                </span>
              </label>
            ))}
            {files.length > 1 && (
              <div>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => onChange(chosen.size === files.length ? new Set() : new Set(files.map((f) => f.blobId!)))}
                >
                  {chosen.size === files.length ? 'Untick all files' : `Tick all ${files.length} files`}
                </button>
              </div>
            )}
          </>
        )}
        {listed.length > 0 && (
          <>
            <p className="small muted" style={{ margin: 0 }}>
              Your written account lists {listed.length === 1 ? 'this file' : `all ${listed.length} of these files`} either
              way, with their names, file types and sizes, descriptions, dates and fingerprints. Only a file you tick can be
              opened.
            </p>
            <ul className="small muted" style={{ margin: 0, paddingLeft: '1.2em' }} data-testid="listed-files">
              {listed.map((f) => (
                <li key={f.id} data-file={f.fileName}>
                  {f.fileName}{' '}
                  {!f.blobId ? '(listed only: never uploaded)' : chosen.has(f.blobId) ? '(listed, and the file is shared)' : '(listed only: not ticked)'}
                </li>
              ))}
            </ul>
          </>
        )}
      </fieldset>
    </section>
  );
}
