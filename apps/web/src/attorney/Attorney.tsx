import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { decryptBlob, decryptJSON, publicKeyFingerprint, sha256Hex, unwrapKeyWithPrivate } from '@shield/crypto';
import type { EvidenceItem, IntakeRecord, LedgerEntry, ShareBundle } from '@shield/shared';
import { envelopeHash } from '../api/client';
import { ErrorNote, Loading, PageTitle, VerifyBadge, formatDate, useAsync } from '../components/common';
import { BriefPreview, downloadPdf, generatePoliceBrief } from '../integration/briefAdapter';
import { friendlyError, useRequiredSession } from '../lib/session';
import { formatBytes, shortHash, type VaultPayload } from '../lib/vault';

export function AttorneyCases() {
  const { api, session, refreshProfile } = useRequiredSession();
  const shares = useAsync(() => api.listShares().then((r) => r.shares), [api]);
  const fp = useAsync(() => publicKeyFingerprint(session.user.publicKey), [session.user.publicKey]);
  const profile = session.attorneyProfile;
  const [checking, setChecking] = useState(false);
  const active = (shares.data ?? []).filter((s) => s.status === 'active');
  const revoked = (shares.data ?? []).filter((s) => s.status === 'revoked');

  return (
    <div className="stack-lg">
      <PageTitle lead={profile ? `${profile.displayName}${profile.organization ? ` · ${profile.organization}` : ''}` : undefined}>
        Shared with you
      </PageTitle>
      {profile && !profile.verified && (
        <div className="card warn stack" role="status">
          <strong>Pending verification</strong>
          <p style={{ margin: 0 }}>
            We’re verifying your bar admission. Until then you won’t appear to survivors. This usually takes 1–2 business days.
          </p>
          <div>
            <button
              className="btn btn-small"
              disabled={checking}
              onClick={async () => {
                setChecking(true);
                try {
                  await refreshProfile();
                  void shares.reload();
                } finally {
                  setChecking(false);
                }
              }}
            >
              {checking ? 'Checking…' : 'Check again'}
            </button>
          </div>
        </div>
      )}
      <div className="card soft small stack">
        <p style={{ margin: 0 }}>
          Your key fingerprint: <span className="fingerprint">{fp.data ?? '…'}</span>
        </p>
        <p style={{ margin: 0 }} className="muted">
          A client may ask you to read this to them to confirm they’re sharing with you.
        </p>
      </div>
      <section className="card stack" aria-labelledby="active">
        <h2 id="active">Active files</h2>
        {shares.loading && <Loading />}
        {shares.error && <ErrorNote>{shares.error}</ErrorNote>}
        {shares.data && active.length === 0 && <p className="muted">No files have been shared with you yet.</p>}
        <ul className="list">
          {active.map((s) => (
            <li key={s.id} className="row" style={{ justifyContent: 'space-between' }}>
              <span>
                <strong>Shared file</strong>{' '}
                <span className="small muted">
                  · {formatDate(s.createdAt)} · {s.scope.join(', ')}
                </span>
              </span>
              <Link className="btn btn-small btn-primary" to={`/attorney/cases/${s.id}`}>
                Open
              </Link>
            </li>
          ))}
        </ul>
      </section>
      {revoked.length > 0 && (
        <section className="card stack" aria-labelledby="revoked">
          <h2 id="revoked">Access revoked by client</h2>
          <ul className="list">
            {revoked.map((s) => (
              <li key={s.id} className="small muted">
                Shared {formatDate(s.createdAt)} · revoked {formatDate(s.revokedAt)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

interface OpenedCase {
  bundle: ShareBundle;
  record: IntakeRecord;
  recordKeyOk: true;
  ledgerEntry?: LedgerEntry;
  recomputedHash: string;
  ledgerOk: boolean;
}

export function AttorneyCase() {
  const { id = '' } = useParams();
  const { api, session } = useRequiredSession();
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);

  const opened = useAsync(async (): Promise<OpenedCase> => {
    const bundle = await api.getShareBundle(id);
    const key = await unwrapKeyWithPrivate(bundle.recipientWrappedKey, session.privateKey);
    const payload = await decryptJSON<VaultPayload>(bundle.record.envelope, key);
    if (!payload.record) throw new Error('This file does not contain a sealed account.');
    const recomputedHash = await envelopeHash(bundle.record.envelope);
    let ledgerEntry: LedgerEntry | undefined;
    try {
      ledgerEntry = (await api.getLedgerEntry(bundle.record.ledgerEntryId)).entry;
    } catch {
      /* shown as unverified */
    }
    const ledgerOk = !!ledgerEntry && ledgerEntry.contentHash === recomputedHash && bundle.record.contentHash === recomputedHash;
    return { bundle, record: payload.record, recordKeyOk: true, ledgerEntry, recomputedHash, ledgerOk };
  }, [api, id, session.privateKey]);

  async function downloadBrief() {
    if (!opened.data) return;
    setBriefBusy(true);
    setBriefError(null);
    try {
      const { bundle, record, ledgerEntry } = opened.data;
      const pdf = await generatePoliceBrief(record, {
        recordId: bundle.record.id,
        recordContentHash: bundle.record.contentHash,
        ledgerEntry,
        generatedAt: new Date(),
        preparedFor: session.attorneyProfile?.displayName,
      });
      downloadPdf(pdf, `brief-${bundle.survivorAlias}-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) {
      setBriefError(friendlyError(e));
    } finally {
      setBriefBusy(false);
    }
  }

  return (
    <div className="stack-lg">
      <p>
        <Link to="/attorney/cases">← All files</Link>
      </p>
      {opened.loading && <Loading label="Fetching and decrypting with your private key…" />}
      {opened.error && <ErrorNote>{opened.error}</ErrorNote>}
      {opened.data && (
        <>
          <PageTitle lead={`Shared ${formatDate(opened.data.bundle.share.createdAt)} · scope: ${opened.data.bundle.share.scope.join(', ')}`}>
            Client: {opened.data.bundle.survivorAlias}
          </PageTitle>
          <p className="card soft small" role="note">
            Access logged and visible to your client. They can revoke access at any time.
          </p>

          <section className="card stack" aria-labelledby="consent">
            <h2 id="consent">Client’s consent (verbatim)</h2>
            <div className="consent-text">{opened.data.bundle.share.consentStatement}</div>
          </section>

          <section className="card stack" aria-labelledby="proof">
            <div className="section-title">
              <h2 id="proof">Integrity proof</h2>
              <VerifyBadge verified={opened.data.ledgerOk} />
            </div>
            <dl className="small stack" style={{ margin: 0 }}>
              <div>
                <dt className="muted">Recomputed SHA-256 of the sealed ciphertext</dt>
                <dd className="mono" style={{ margin: 0 }}>{opened.data.recomputedHash}</dd>
              </div>
              <div>
                <dt className="muted">Hash attested in ledger</dt>
                <dd className="mono" style={{ margin: 0 }}>{opened.data.ledgerEntry?.contentHash ?? 'unavailable'}</dd>
              </div>
              {opened.data.ledgerEntry && (
                <>
                  <div>
                    <dt className="muted">Ledger entry</dt>
                    <dd style={{ margin: 0 }}>
                      #{opened.data.ledgerEntry.seq} · {opened.data.ledgerEntry.type} · {formatDate(opened.data.ledgerEntry.timestamp)} (server receipt time,{' '}
                      {opened.data.ledgerEntry.timestamp})
                    </dd>
                  </div>
                  <div>
                    <dt className="muted">Entry hash / previous hash</dt>
                    <dd className="mono" style={{ margin: 0 }}>
                      {shortHash(opened.data.ledgerEntry.entryHash, 16)} ← {shortHash(opened.data.ledgerEntry.prevHash, 16)}
                    </dd>
                  </div>
                </>
              )}
            </dl>
          </section>

          <section className="card stack" aria-labelledby="brief">
            <div className="section-title">
              <h2 id="brief">Evidentiary brief</h2>
              <button className="btn btn-primary btn-small" onClick={() => void downloadBrief()} disabled={briefBusy}>
                {briefBusy ? 'Preparing…' : 'Download police brief (PDF)'}
              </button>
            </div>
            {briefError && <ErrorNote>{briefError}</ErrorNote>}
            <BriefPreview
              record={opened.data.record}
              opts={{
                recordId: opened.data.bundle.record.id,
                recordContentHash: opened.data.bundle.record.contentHash,
                ledgerEntry: opened.data.ledgerEntry,
                preparedFor: session.attorneyProfile?.displayName,
              }}
            />
          </section>

          <section className="card stack" aria-labelledby="ev">
            <h2 id="ev">Evidence</h2>
            {opened.data.bundle.blobs.length === 0 && <p className="muted">No evidence files were shared.</p>}
            <ul className="list">
              {opened.data.bundle.blobs.map((b) => (
                <SharedBlob
                  key={b.blobId}
                  blob={b}
                  item={opened.data!.record.evidence.find((e) => e.blobId === b.blobId)}
                />
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function SharedBlob({ blob, item }: { blob: ShareBundle['blobs'][number]; item?: EvidenceItem }) {
  const { api, session } = useRequiredSession();
  const [state, setState] = useState<{ busy?: boolean; url?: string; ok?: boolean; hash?: string; error?: string }>({});
  async function decrypt() {
    setState({ busy: true });
    try {
      const key = await unwrapKeyWithPrivate(blob.recipientWrappedKey, session.privateKey);
      const ct = await api.downloadBlob(blob.blobId);
      const pt = await decryptBlob(ct, key);
      const hash = await sha256Hex(pt);
      const ok = !!item && hash === item.sha256;
      // only offer the download once the hash has been checked
      const url = ok ? URL.createObjectURL(new Blob([pt as BlobPart], { type: item?.mimeType ?? 'application/octet-stream' })) : undefined;
      setState({ ok, hash, url });
    } catch (e) {
      setState({ error: friendlyError(e) });
    }
  }
  return (
    <li className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span>
          <strong>{item?.fileName ?? 'Evidence file'}</strong>{' '}
          <span className="small muted">
            · {item?.kind ?? 'file'} · {formatBytes(item?.sizeBytes ?? blob.sizeBytes)}
            {item?.capturedAt && <> · captured {item.capturedAt}</>}
          </span>
        </span>
        {state.hash !== undefined && <VerifyBadge verified={state.ok} />}
      </div>
      {item?.description && <p className="small">{item.description}</p>}
      {item && (
        <p className="small muted">
          {item.metadataStripped ? 'Metadata (EXIF/GPS) removed on the client’s device before sealing.' : 'Original file metadata was not removed.'}
        </p>
      )}
      {item && <p className="mono small">Recorded SHA-256: {item.sha256}</p>}
      {state.hash && !state.ok && <ErrorNote>Hash mismatch — recomputed {state.hash}. Download withheld.</ErrorNote>}
      <div className="row">
        {!state.url && (
          <button className="btn btn-small" onClick={() => void decrypt()} disabled={state.busy}>
            {state.busy ? 'Decrypting & verifying…' : 'Decrypt & verify'}
          </button>
        )}
        {state.url && (
          <a
            className="btn btn-small btn-primary"
            href={state.url}
            download={item?.fileName ?? blob.blobId}
            onClick={() => setTimeout(() => state.url && URL.revokeObjectURL(state.url), 60_000)}
          >
            Download (verified ✓)
          </a>
        )}
      </div>
      {state.error && <ErrorNote>{state.error}</ErrorNote>}
    </li>
  );
}
