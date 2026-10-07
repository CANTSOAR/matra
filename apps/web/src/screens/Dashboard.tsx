import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AttorneyProfile, AuditEvent, EscrowEntry, Share } from '@matra/shared';
import { ErrorNote, Loading, PageTitle, VerifyBadge, formatDate, useAsync } from '../components/common';
import { friendlyError, useRequiredSession } from '../lib/session';
import { escrowLabel, finals, latestOf, loadVault, mergeEvidence, shortHash, formatBytes } from '../lib/vault';

const AUDIT_TEXT: Record<string, string> = {
  'account.created': 'Vault created',
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'auth.login_failed': 'Someone tried to sign in with the wrong passphrase',
  'record.created': 'You sealed a record',
  'blob.uploaded': 'Evidence added to your vault',
  'escrow.created': 'You sealed a name in escrow',
  'share.created': 'You shared your file with an attorney',
  'share.revoked': 'You revoked an attorney’s access',
  'attorney.opened_share': 'Attorney opened your file',
  'attorney.downloaded_evidence': 'Attorney downloaded an evidence file',
  // attorney-side events
  'share.received': 'A client shared a file with you',
  'share.opened': 'You opened a shared file',
  'share.blob_downloaded': 'You downloaded a shared evidence file',
  'share.revoked_by_survivor': 'A client revoked your access',
};

export function describeAudit(e: AuditEvent): string {
  if (AUDIT_TEXT[e.action]) return AUDIT_TEXT[e.action];
  const a = e.action.toLowerCase();
  if (/bundle|opened|viewed|access(ed)?$/.test(a)) return 'An attorney opened your shared file';
  if (/blob.*(download|read)/.test(a)) return 'A shared evidence file was downloaded';
  if (/revoke/.test(a)) return 'You revoked an attorney’s access';
  if (/share/.test(a)) return 'You shared your file with an attorney';
  if (/escrow/.test(a)) return 'You sealed a name in escrow';
  if (/blob|evidence/.test(a)) return 'Evidence added to your vault';
  if (/record/.test(a)) return 'You sealed a record';
  if (/register|signup|account\.create/.test(a)) return 'Vault created';
  if (/login|signin/.test(a)) return 'Signed in';
  if (/logout/.test(a)) return 'Signed out';
  return e.action;
}

export function Dashboard() {
  const { api, session, getWorkingData, workingVersion } = useRequiredSession();
  const mk = session.masterKey;

  const vault = useAsync(() => loadVault(api, mk), [api, mk]);
  const blobs = useAsync(() => api.listBlobs().then((r) => r.blobs), [api]);
  const working = useAsync(() => getWorkingData(), [getWorkingData, workingVersion]);
  const escrow = useAsync(async () => {
    const { entries } = await api.listEscrow();
    return Promise.all(entries.map(async (e) => ({ entry: e, label: await escrowLabel(e.labelEnvelope, mk) })));
  }, [api, mk]);
  const shares = useAsync(async () => {
    const [{ shares }, atts] = await Promise.all([api.listShares(), api.listAttorneys().catch(() => ({ attorneys: [] as AttorneyProfile[] }))]);
    const byId = new Map(atts.attorneys.map((a) => [a.userId, a]));
    return shares.map((s) => ({ share: s, attorney: byId.get(s.attorneyId) }));
  }, [api]);
  const audit = useAsync(() => api.listAudit().then((r) => r.events), [api]);

  const records = vault.data ?? [];
  const sealed = finals(records);
  const savedDraft = latestOf(records, 'draft');
  const latestFinal = latestOf(records, 'final');
  const evidenceMeta = mergeEvidence(savedDraft?.payload.evidence, latestFinal?.payload.record?.evidence, working.data?.evidence);
  const metaByBlob = new Map(evidenceMeta.filter((e) => e.blobId).map((e) => [e.blobId!, e]));

  return (
    <div className="stack-lg">
      <PageTitle lead={`Signed in as ${session.user.username}. Everything here is decrypted only on this device.`}>Your vault</PageTitle>

      {/* ── accounts ── */}
      <section className="card stack" aria-labelledby="accounts">
        <div className="section-title">
          <h2 id="accounts">Your account of what happened</h2>
          <Link className="btn btn-small" to="/vault/story">
            {sealed.length ? 'Add to or update it' : savedDraft || working.data ? 'Continue' : 'Start when you’re ready'}
          </Link>
        </div>
        {vault.loading && <Loading label="Opening your vault…" />}
        {vault.error && <ErrorNote>{vault.error}</ErrorNote>}
        {!vault.loading && !vault.error && (
          <>
            <p className="small">
              Draft:{' '}
              {working.data ? (
                <span className="badge">In progress (not saved to vault yet)</span>
              ) : savedDraft && !savedDraft.supersededBy ? (
                <span className="badge neutral">Saved {formatDate(savedDraft.payload.savedAt)}</span>
              ) : (
                <span className="muted">none</span>
              )}
            </p>
            {sealed.length === 0 ? (
              <p className="muted">No sealed account yet. There’s no rush — you can save a draft and come back.</p>
            ) : (
              <ul className="list">
                {sealed.map((r) => (
                  <li key={r.meta.id} className="stack">
                    <div className="row">
                      <strong>{r.supersededBy ? 'Earlier version' : 'Current sealed account'}</strong>
                      <VerifyBadge verified={r.verified} />
                    </div>
                    <div className="small muted">
                      Sealed {formatDate(r.ledgerEntry?.timestamp ?? r.meta.createdAt)}
                      {r.ledgerEntry && <> · ledger entry #{r.ledgerEntry.seq}</>} · {r.payload.record?.evidence.length ?? 0} evidence item(s)
                    </div>
                    <div className="mono muted" title="SHA-256 fingerprint of the sealed, encrypted record">
                      {shortHash(r.meta.contentHash, 16)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {/* ── evidence ── */}
      <section className="card stack" aria-labelledby="evidence">
        <div className="section-title">
          <h2 id="evidence">Evidence</h2>
          <Link className="btn btn-small" to="/vault/evidence">
            Add evidence
          </Link>
        </div>
        {blobs.loading && <Loading />}
        {blobs.error && <ErrorNote>{blobs.error}</ErrorNote>}
        {blobs.data && blobs.data.length === 0 && <p className="muted">No files yet.</p>}
        {blobs.data && blobs.data.length > 0 && (
          <ul className="list">
            {blobs.data.map((b) => {
              const m = metaByBlob.get(b.id);
              return (
                <li key={b.id} className="row" style={{ justifyContent: 'space-between' }}>
                  <span>
                    <strong>{m?.fileName ?? 'Encrypted file'}</strong>{' '}
                    <span className="small muted">
                      · {formatBytes(m?.sizeBytes ?? b.sizeBytes)} · sealed {formatDate(b.createdAt)}
                    </span>
                  </span>
                  {m && (
                    <span className={m.metadataStripped ? 'badge ok' : 'badge warn'}>
                      {m.metadataStripped ? 'Hidden details removed' : 'Hidden details kept'}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── escrow ── */}
      <section className="card stack" aria-labelledby="escrow">
        <h2 id="escrow">Sealed escrow</h2>
        <p className="small muted">
          If you chose to, the names or handles you gave are sealed as one-way fingerprints. Nobody can read them, and
          nobody is told who you are. This list will always say “Sealed” — that is on purpose, so no one can use this
          page to find out whether they have been named.
        </p>
        {escrow.loading && <Loading />}
        {escrow.error && <ErrorNote>{escrow.error}</ErrorNote>}
        {escrow.data && escrow.data.length === 0 && <p className="muted">Nothing sealed in escrow.</p>}
        {escrow.data?.map(({ entry, label }) => <EscrowCard key={entry.id} entry={entry} label={label} />)}
        {escrow.data && escrow.data.length > 0 && (
          <p className="small muted">
            If someone else independently names the same person, the attorney you choose to share with will be told —
            never the other person’s identity.
          </p>
        )}
      </section>

      {/* ── shares ── */}
      <section className="card stack" aria-labelledby="shares">
        <div className="section-title">
          <h2 id="shares">Who can see your file</h2>
          <Link className="btn btn-small" to="/vault/share">
            Share with an attorney
          </Link>
        </div>
        {shares.loading && <Loading />}
        {shares.error && <ErrorNote>{shares.error}</ErrorNote>}
        {shares.data && shares.data.length === 0 && <p className="muted">Only you. You haven’t shared anything.</p>}
        {shares.data && shares.data.length > 0 && (
          <ul className="list">
            {shares.data.map(({ share, attorney }) => (
              <ShareRow key={share.id} share={share} attorney={attorney} onChanged={() => { void shares.reload(); void audit.reload(); }} />
            ))}
          </ul>
        )}
      </section>

      {/* ── activity ── */}
      <section className="card stack" aria-labelledby="activity">
        <h2 id="activity">Activity</h2>
        {audit.loading && <Loading />}
        {audit.error && <ErrorNote>{audit.error}</ErrorNote>}
        {audit.data && audit.data.length === 0 && <p className="muted">No activity yet.</p>}
        {audit.data && audit.data.length > 0 && (
          <ul className="list timeline">
            {[...audit.data]
              .sort((a, b) => b.at.localeCompare(a.at))
              .slice(0, 25)
              .map((e) => (
                <li key={e.id}>
                  <span>{describeAudit(e)}</span>
                  <span className="small muted">{formatDate(e.at)}</span>
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Survivors never see match results (the server always reports 'sealed'). If they could, a perpetrator posing as a
 * survivor could escrow his own identifiers and learn he has been named. Matches are released only to the verified
 * attorney she chooses to share with.
 */
function EscrowCard({ entry, label }: { entry: EscrowEntry; label: string }) {
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span>
          <strong>{label}</strong> <span className="small muted">· sealed {formatDate(entry.createdAt)}</span>
        </span>
        <span className="badge neutral">Sealed</span>
      </div>
    </div>
  );
}

function ShareRow({ share, attorney, onChanged }: { share: Share; attorney?: AttorneyProfile; onChanged(): void }) {
  const { api } = useRequiredSession();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = attorney ? `${attorney.displayName}${attorney.organization ? `, ${attorney.organization}` : ''}` : 'Attorney';
  const expired = share.status === 'active' && Date.parse(share.expiresAt) <= Date.now();
  async function renew() {
    setBusy(true);
    setError(null);
    try {
      await api.renewShare(share.id);
      onChanged();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      await api.revokeShare(share.id);
      onChanged();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }
  return (
    <li className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span>
          <strong>{name}</strong>{' '}
          <span className="small muted">
            · shared {formatDate(share.createdAt)} · {share.scope.join(', ')}{share.status === 'active' && <> · {expired ? 'expired' : 'expires'} {formatDate(share.expiresAt)}</>}
          </span>
        </span>
        {share.status === 'active' ? expired ? <span className="badge neutral">Expired</span> : <span className="badge ok">Has access</span> : <span className="badge neutral">Revoked {formatDate(share.revokedAt)}</span>}
      </div>
      {share.status === 'active' &&
        (confirming ? (
          <div className="card warn stack">
            <p>Revoke {name}’s access? They won’t be able to open your file again. This can’t un-see what they already viewed.</p>
            <div className="row">
              <button className="btn btn-primary btn-small" onClick={revoke} disabled={busy}>
                {busy ? 'Revoking…' : 'Yes, revoke access'}
              </button>
              <button className="btn btn-small" onClick={() => setConfirming(false)}>
                Keep access
              </button>
            </div>
          </div>
        ) : (
          <div className="row">
            <button className="btn btn-small" onClick={renew} disabled={busy}>
              {busy ? 'Renewing…' : 'Renew 90 days'}
            </button>
            <button className="btn btn-small btn-danger" onClick={() => setConfirming(true)}>
              Revoke
            </button>
          </div>
        ))}
      {error && <ErrorNote>{error}</ErrorNote>}
    </li>
  );
}
