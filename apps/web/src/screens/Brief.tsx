import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorNote, Loading, PageTitle, VerifyBadge, formatDate, useAsync } from '../components/common';
import { BriefPreview, downloadPdf, generatePoliceBrief, generateVccoDraft, type BriefOptions } from '../integration/briefAdapter';
import { friendlyError, useRequiredSession } from '../lib/session';
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

  async function download(kind: 'police' | 'vcco') {
    if (!record) return;
    setError(null);
    setBusy(kind);
    try {
      const date = new Date().toISOString().slice(0, 10);
      if (kind === 'police') {
        downloadPdf(await generatePoliceBrief(record, await opts()), `evidentiary-brief-${date}.pdf`);
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
      <PageTitle lead="A clear, organized summary of your sealed account that you can bring to police — if and when you decide to. Downloading it doesn’t send it anywhere.">
        Police brief
      </PageTitle>
      {vault.loading && <Loading label="Opening your vault…" />}
      {vault.error && <ErrorNote>{vault.error}</ErrorNote>}
      {!vault.loading && !vault.error && sealed.length === 0 && (
        <div className="card stack">
          <p>You’ll be able to prepare a brief after you seal your account.</p>
          <div>
            <Link className="btn btn-primary" to="/vault/story">
              Go to your account
            </Link>
          </div>
        </div>
      )}
      {chosen && record && (
        <>
          <div className="card stack">
            {sealed.length > 1 && (
              <label className="field">
                <span>Which sealed version?</span>
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
              <span>Hide my contact information (phone, email, address) in the brief</span>
            </label>
            <div className="row">
              <button className="btn btn-primary" onClick={() => void download('police')} disabled={!!busy}>
                {busy === 'police' ? 'Preparing…' : 'Download police brief (PDF)'}
              </button>
              <button className="btn" onClick={() => void download('vcco')} disabled={!!busy}>
                {busy === 'vcco' ? 'Preparing…' : 'Download NJ compensation draft'}
              </button>
            </div>
            <p className="small muted">
              The NJ Victims of Crime Compensation draft is pre-filled for you to review — it is not submitted.
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
