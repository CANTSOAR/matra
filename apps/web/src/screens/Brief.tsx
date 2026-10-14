import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorNote, Loading, PageTitle, VerifyBadge, formatDate, useAsync } from '../components/common';
import { KeyNotice } from '../components/KeyNotice';
import {
  BriefPreview,
  downloadPdf,
  generateIncidentSummary,
  generateVccoDraft,
  incidentSummaryFilename,
  type BriefOptions,
} from '../integration/briefAdapter';
import { friendlyError, useRequiredSession } from '../lib/session';
import { NOTICES } from '../lib/disclosures';
import { finals, loadVault } from '../lib/vault';

export function Brief() {
  const { api, session } = useRequiredSession();
  const vault = useAsync(() => loadVault(api, session.masterKey), [api, session.masterKey]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [redact, setRedact] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sealed = finals(vault.data ?? []);
  const chosen = sealed.find((r) => r.meta.id === selectedId) ?? sealed.find((r) => !r.supersededBy) ?? sealed[0];
  const record = chosen?.payload.record;

  async function opts(): Promise<BriefOptions> {
    let ledgerEntry = chosen!.ledgerEntry;
    if (!ledgerEntry) ledgerEntry = (await api.getLedgerEntry(chosen!.meta.ledgerEntryId)).entry;
    return {
      recordId: chosen!.meta.id,
      recordContentHash: chosen!.meta.contentHash,
      ledgerEntry,
      generatedAt: new Date(),
      redactContactInfo: redact,
    };
  }

  async function download(kind: 'summary' | 'vcco') {
    if (!record) return;
    setError(null);
    setBusy(kind);
    try {
      const date = new Date().toISOString().slice(0, 10);
      if (kind === 'summary') {
        downloadPdf(await generateIncidentSummary(record, await opts()), incidentSummaryFilename());
      } else {
        downloadPdf(await generateVccoDraft(record, { generatedAt: new Date() }), `nj-compensation-draft-${date}.pdf`);
      }
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack-lg">
      <PageTitle
        eyebrow="Summary"
        testId="summary-title"
        lead="Your sealed story, organized in your own words, to bring to police, an advocate or a lawyer — if and when you decide to. Downloading it doesn’t send it anywhere."
      >
        Incident summary
      </PageTitle>
      {vault.loading && <Loading label="Opening your space…" />}
      {vault.error && <ErrorNote>{vault.error}</ErrorNote>}
      {!vault.loading && !vault.error && sealed.length === 0 && (
        <div className="card stack">
          <p>Once your story is sealed, you can prepare a summary here. There’s no rush.</p>
          <div>
            <Link className="btn btn-primary" to="/vault/story">
              Go to my story
            </Link>
          </div>
        </div>
      )}
      {chosen && record && (
        <>
          <div className="card stack">
            {sealed.length > 1 && (
              <label className="field">
                <span>Which sealed version would you like to use?</span>
                <select value={chosen.meta.id} onChange={(e) => setSelectedId(e.target.value)}>
                  {sealed.map((r) => (
                    <option key={r.meta.id} value={r.meta.id}>
                      {r.supersededBy ? 'Earlier version' : 'Current'} — sealed {formatDate(r.ledgerEntry?.timestamp ?? r.meta.createdAt)}
                      {r.ledgerEntry ? ` (#${r.ledgerEntry.seq})` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="row">
              <VerifyBadge verified={chosen.verified} />
              <span className="small muted">
                Sealed {formatDate(chosen.ledgerEntry?.timestamp ?? chosen.meta.createdAt)}
                {chosen.ledgerEntry && <> · ledger entry #{chosen.ledgerEntry.seq}</>}
              </span>
            </div>
            <label className="check">
              <input type="checkbox" checked={redact} onChange={(e) => setRedact(e.target.checked)} />
              <span>Hide my contact information (phone, email, address) in the summary</span>
            </label>
            <KeyNotice notice={NOTICES.downloadFile} />
            <div className="row">
              <button className="btn btn-primary" onClick={() => void download('summary')} disabled={!!busy}>
                {busy === 'summary' ? 'Preparing…' : 'Download incident summary (PDF)'}
              </button>
              <button className="btn" onClick={() => void download('vcco')} disabled={!!busy}>
                {busy === 'vcco' ? 'Preparing…' : 'Download NJ compensation draft'}
              </button>
            </div>
            <p className="small muted">
              The NJ Victims of Crime Compensation draft is filled in for you to review. It isn’t sent or submitted anywhere.
            </p>
            {error && <ErrorNote>{error}</ErrorNote>}
          </div>
          <BriefPreview
            record={record}
            opts={{
              recordId: chosen.meta.id,
              recordContentHash: chosen.meta.contentHash,
              ledgerEntry: chosen.ledgerEntry,
              redactContactInfo: redact,
            }}
          />
        </>
      )}
    </div>
  );
}
