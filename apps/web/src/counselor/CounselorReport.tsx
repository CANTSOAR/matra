/**
 * Staged release, Stage 2 (docs/design/WEEKEND_MVP.md §3.6): a report one matched survivor chose to share with the
 * assigned counselor. Her client wrapped the record key (and any evidence keys she chose) to this counselor's RSA key;
 * it is opened here, on the counselor's device, exactly like an attorney share (attorney/Attorney.tsx). Every opening
 * is shown to her in her own activity. Nothing here ever names or links to anyone else in the group.
 */
import { Link, useParams } from 'react-router-dom';
import { decryptJSON, unwrapKeyWithPrivate } from '@matra/crypto';
import type { IntakeRecord, LedgerEntry, ReportReleaseBundle } from '@matra/shared';
import { envelopeHash } from '../api/client';
import { SharedBlob } from '../attorney/Attorney';
import { ErrorNote, Loading, PageTitle, VerifyBadge, formatDate, useAsync } from '../components/common';
import { BriefPreview } from '../integration/briefAdapter';
import { useRequiredSession } from '../lib/session';
import type { VaultPayload } from '../lib/vault';

interface OpenedReport {
  bundle: ReportReleaseBundle;
  record: IntakeRecord;
  ledgerEntry?: LedgerEntry;
  ledgerOk: boolean;
}

/** Each bundle fetch is shown to her as "opened your report"; StrictMode's double mount must not log one visit twice. */
const inflight = new Map<string, Promise<ReportReleaseBundle>>();
function fetchOnce(api: ReturnType<typeof useRequiredSession>['api'], id: string) {
  let p = inflight.get(id);
  if (!p) {
    p = api.counselorReleaseBundle(id).finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  return p;
}

export function CounselorReport() {
  const { id = '' } = useParams();
  const { api, session } = useRequiredSession();
  const opened = useAsync(async (): Promise<OpenedReport> => {
    const bundle = await fetchOnce(api, id);
    const key = await unwrapKeyWithPrivate(bundle.recipientWrappedKey, session.privateKey);
    const payload = await decryptJSON<VaultPayload>(bundle.record.envelope, key);
    if (!payload.record) throw new Error('This report does not contain a sealed account.');
    const recomputed = await envelopeHash(bundle.record.envelope);
    let ledgerEntry: LedgerEntry | undefined;
    try {
      ledgerEntry = (await api.getLedgerEntry(bundle.record.ledgerEntryId)).entry;
    } catch {
      /* shown as unverified */
    }
    const ledgerOk = !!ledgerEntry && ledgerEntry.contentHash === recomputed && bundle.record.contentHash === recomputed;
    return { bundle, record: payload.record, ledgerEntry, ledgerOk };
  }, [api, id, session.privateKey]);
  const d = opened.data;

  return (
    <div className="stack-lg">
      <p>
        <Link className="back-link" to="/counselor/matches">← Matched sealed reports</Link>
      </p>
      {opened.loading && <Loading label="Fetching and decrypting with your private key…" />}
      {opened.error && <ErrorNote>{opened.error}</ErrorNote>}
      {d && (
        <>
          <PageTitle eyebrow="Shared with you" testId="counselor-report-title">
            A report shared with you
          </PageTitle>
          <dl className="case-meta">
            <div>
              <dt>Shared</dt>
              <dd>{formatDate(d.bundle.release.createdAt)}</dd>
            </div>
            <div>
              <dt>Access until</dt>
              <dd>{formatDate(d.bundle.release.expiresAt)}</dd>
            </div>
            <div>
              <dt>Integrity</dt>
              <dd>
                <VerifyBadge verified={d.ledgerOk} />
              </dd>
            </div>
          </dl>
          <p className="card soft small" role="note">
            This person chose to share this with you only. It is not shared with anyone else in the group, and you must not
            pass it on. Every time you open it, they can see it, and they can stop sharing at any time.
          </p>
          <section className="card stack" aria-labelledby="r-consent">
            <h2 id="r-consent">Their consent (verbatim)</h2>
            <div className="consent-text">{d.bundle.release.consentStatement}</div>
          </section>
          <section className="card stack" aria-labelledby="r-story">
            <h2 id="r-story">Their account, in their own words</h2>
            <BriefPreview
              record={d.record}
              opts={{ recordId: d.bundle.record.id, recordContentHash: d.bundle.record.contentHash, ledgerEntry: d.ledgerEntry }}
            />
          </section>
          <section className="card stack" aria-labelledby="r-ev">
            <h2 id="r-ev">Evidence</h2>
            {d.bundle.blobs.length === 0 && <p className="muted">No evidence files were shared.</p>}
            <ul className="list">
              {d.bundle.blobs.map((b) => (
                <SharedBlob
                  key={b.blobId}
                  blob={b}
                  item={d.record.evidence.find((e) => e.blobId === b.blobId)}
                  download={(blobId) => api.counselorReleaseBlob(id, blobId)}
                />
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
