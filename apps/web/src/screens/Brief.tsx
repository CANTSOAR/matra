import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorNote, Loading, PageTitle, VerifyBadge, formatDate, useAsync } from '../components/common';
import { KeyNotice } from '../components/KeyNotice';
import { VaultStopped } from '../components/UnreadableNote';
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
import { finals, loadSpace, spaceEvidence } from '../lib/vault';
import { commitmentsById, emptyPrivate, loadPrivate } from '../evidence/privateStore';
import { MissingFilesError, exhibitNumbersByBlob, numberExhibits } from '../evidence/exhibits';

export function Brief() {
  const { api, session, getWorkingData } = useRequiredSession();
  // Fails closed (lib/vault.ts loadSpace): a summary she may hand to someone is only made from a space that loaded
  // cleanly, so it is never silently of an older version.
  const space = useAsync(() => loadSpace(api, session.masterKey).then((s) => ({ vault: s.vault, slot: s.slot.slot })), [api, session.masterKey]);
  const vault = { ...space, data: space.data?.vault };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [redact, setRedact] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sealed = finals(vault.data ?? []);
  const chosen = sealed.find((r) => r.meta.id === selectedId) ?? sealed.find((r) => !r.supersededBy) ?? sealed[0];
  const record = chosen?.payload.record;

  /**
   * The number printed beside each file, and the private fingerprints. The numbers are the ones on her Evidence screen and in
   * her exhibit list: the same numbering function (evidence/exhibits.ts) over the same set of file details (her whole space,
   * lib/vault.ts spaceEvidence, not only this sealed version). If the stored files cannot be listed, or one this summary names
   * is missing from the list, this throws and nothing is shown or made: a summary with no numbers, or with moved ones, would
   * read as complete.
   */
  async function loadNumbering() {
    const priv = await loadPrivate(api, session.masterKey).then((p) => (p.unreadable ? emptyPrivate() : p.value)).catch(() => emptyPrivate());
    const exhibitFingerprints = commitmentsById(priv.items);
    if (!record || record.evidence.length === 0) return { exhibitFingerprints, exhibitNumbers: {} as Record<string, number> };
    const { blobs } = await api.listBlobs();
    const mem = await getWorkingData();
    const { exhibits, missing } = numberExhibits(blobs, spaceEvidence(space.data?.vault ?? [], space.data?.slot ?? null, mem?.evidence), priv.items);
    const named = new Set(record.evidence.flatMap((e) => (e.blobId ? [e.blobId] : [])));
    const lost = missing.filter((m) => named.has(m.blobId!));
    if (lost.length) throw new MissingFilesError(lost.map((m) => m.fileName));
    return { exhibitFingerprints, exhibitNumbers: exhibitNumbersByBlob(exhibits) };
  }
  const numbering = useAsync(() => (chosen && record ? loadNumbering() : Promise.resolve(null)), [chosen?.meta.id, space.data]);

  async function opts(): Promise<BriefOptions> {
    let ledgerEntry = chosen!.ledgerEntry;
    if (!ledgerEntry) ledgerEntry = (await api.getLedgerEntry(chosen!.meta.ledgerEntryId)).entry;
    const { exhibitFingerprints, exhibitNumbers } = await loadNumbering(); // fresh at the moment she downloads
    return {
      recordId: chosen!.meta.id,
      recordContentHash: chosen!.meta.contentHash,
      ledgerEntry,
      generatedAt: new Date(),
      redactContactInfo: redact,
      ...(Object.keys(exhibitFingerprints).length > 0 && { exhibitFingerprints }),
      exhibitNumbers,
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
      {vault.error && <VaultStopped error={vault.error} onRetry={() => void vault.reload()} />}
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
          {numbering.loading && <Loading label="Numbering your files…" />}
          {numbering.error && <ErrorNote>{numbering.error}</ErrorNote>}
          {!numbering.loading && numbering.data && (
            <BriefPreview
              record={record}
              opts={{
                recordId: chosen.meta.id,
                recordContentHash: chosen.meta.contentHash,
                ledgerEntry: chosen.ledgerEntry,
                redactContactInfo: redact,
                exhibitNumbers: numbering.data.exhibitNumbers,
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
