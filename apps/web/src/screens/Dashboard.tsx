import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { AttorneyProfile, AuditEvent, EscrowEntry, Share } from '@matra/shared';
import { ErrorNote, Loading, PageTitle, VerifyBadge, formatDate, useAsync } from '../components/common';
import { friendlyError, useRequiredSession } from '../lib/session';
import { escrowLabel, finals, latestOf, loadVault, mergeEvidence, shortHash, formatBytes, type OpenedRecord } from '../lib/vault';
import { buildDataExport, downloadBytes } from '../lib/export';
import { IconBook, IconFeather, IconImage, IconPeople } from '../components/icons';

const AUDIT_TEXT: Record<string, string> = {
  'account.created': 'You created your space',
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'auth.login_failed': 'Someone tried to sign in with the wrong passphrase',
  // The server can't tell a draft save from a seal (it only sees ciphertext) — see describeAudit for how the
  // client refines this using records it can decrypt.
  'record.created': 'You saved to your space',
  'blob.uploaded': 'Evidence added to your space',
  'escrow.created': 'You sealed a match',
  'escrow.withdrawn': 'You withdrew a sealed match',
  'share.created': 'You shared your file with an attorney',
  'share.revoked': 'You took back an attorney’s access',
  'attorney.opened_share': 'Attorney opened your file',
  'attorney.downloaded_evidence': 'Attorney downloaded an evidence file',
  // attorney-side events
  'share.received': 'A client shared a file with you',
  'share.opened': 'You opened a shared file',
  'share.blob_downloaded': 'You downloaded a shared evidence file',
  'share.revoked_by_survivor': 'A client revoked your access',
};

/**
 * Human label for an audit event. `kindBySeq` maps ledger sequence numbers of records she can decrypt to what
 * they are; it lets the client say "sealed" vs "draft" without the server ever knowing the difference.
 */
export function describeAudit(e: AuditEvent, kindBySeq?: Map<number, OpenedRecord['payload']['kind']>): string {
  if (e.action === 'record.created' && kindBySeq) {
    const seq = Number(/ledger #(\d+)/.exec(e.detail ?? '')?.[1]);
    const kind = Number.isFinite(seq) ? kindBySeq.get(seq) : undefined;
    if (kind === 'final') return 'You sealed your account';
    if (kind === 'draft') return 'You saved a draft';
    if (kind === 'profile') return 'You updated what we call you';
  }
  if (AUDIT_TEXT[e.action]) return AUDIT_TEXT[e.action];
  const a = e.action.toLowerCase();
  if (/bundle|opened|viewed|access(ed)?$/.test(a)) return 'An attorney opened your shared file';
  if (/blob.*(download|read)/.test(a)) return 'A shared evidence file was downloaded';
  if (/revoke/.test(a)) return 'You took back an attorney’s access';
  if (/share/.test(a)) return 'You shared your file with an attorney';
  if (/escrow/.test(a)) return /withdr/.test(a) ? 'You withdrew a sealed match' : 'You sealed a match';
  if (/blob|evidence/.test(a)) return 'Evidence added to your space';
  if (/record/.test(a)) return 'You saved to your space';
  if (/register|signup|account\.create/.test(a)) return 'You created your space';
  if (/login|signin/.test(a)) return 'Signed in';
  if (/logout/.test(a)) return 'Signed out';
  return e.action;
}

const SCOPE_WORDS: Record<string, string> = { record: 'written story', evidence: 'evidence files', brief: 'summary' };
const scopeText = (scope: string[]) => scope.map((x) => SCOPE_WORDS[x] ?? x).join(', ');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function Dashboard() {
  const { api, session, getWorkingData, workingVersion, profile } = useRequiredSession();
  const mk = session.masterKey;
  const location = useLocation();
  const firstVisit = !!(location.state as { firstVisit?: boolean } | null)?.firstVisit;

  // profile records included only so the activity list can name them; finals/latestOf pick by kind
  const vault = useAsync(() => loadVault(api, mk, { includeProfile: true }), [api, mk]);
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
  const [showAllActivity, setShowAllActivity] = useState(false);

  const records = vault.data ?? [];
  const sealed = finals(records);
  const savedDraft = latestOf(records, 'draft');
  const latestFinal = latestOf(records, 'final');
  const evidenceMeta = mergeEvidence(savedDraft?.payload.evidence, latestFinal?.payload.record?.evidence, working.data?.evidence);
  const metaByBlob = new Map(evidenceMeta.filter((e) => e.blobId).map((e) => [e.blobId!, e]));
  const kindBySeq = new Map(records.filter((r) => r.ledgerEntry).map((r) => [r.ledgerEntry!.seq, r.payload.kind]));

  const hasDraft = !!working.data || (!!savedDraft && !savedDraft.supersededBy);
  const currentSeal = sealed.find((r) => !r.supersededBy);
  const fileCount = blobs.data?.length ?? 0;
  const activeShares = (shares.data ?? []).filter(
    ({ share }) => share.status === 'active' && Date.parse(share.expiresAt) > Date.now(),
  );
  const activityList = [...(audit.data ?? [])].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="stack-xl">
      <Greeting firstVisit={firstVisit} name={profile?.preferredName} alias={session.user.username} />

      {/* ── where things are ── */}
      <section className="stack" aria-labelledby="where">
        <h2 id="where">Where things are</h2>
        <div className="status-grid">
          <Link className="status-tile" to="/vault/story" data-testid="tile-story">
            <span className="label">
              <span className="dot-icon warm"><IconFeather /></span> My story
            </span>
            <span className="value">
              {vault.loading ? '…' : currentSeal ? 'Sealed and safe' : hasDraft ? 'In progress' : 'Not started yet'}
            </span>
            <span className="detail">
              {currentSeal
                ? `Sealed ${formatDate(currentSeal.ledgerEntry?.timestamp ?? currentSeal.meta.createdAt)}${hasDraft ? ' · newer draft saved' : ''}`
                : hasDraft
                  ? 'Pick up whenever you like.'
                  : 'There’s no rush.'}
            </span>
          </Link>
          <Link className="status-tile" to="/vault/evidence" data-testid="tile-evidence">
            <span className="label">
              <span className="dot-icon"><IconImage /></span> Evidence
            </span>
            <span className="value">{blobs.loading ? '…' : fileCount ? plural(fileCount, 'file') : 'No files yet'}</span>
            <span className="detail">{fileCount ? 'Locked and fingerprinted.' : 'Photos, screenshots, messages…'}</span>
          </Link>
          <Link className="status-tile" to="/vault/share" data-testid="tile-sharing">
            <span className="label">
              <span className="dot-icon sage"><IconPeople /></span> Who can see it
            </span>
            <span className="value">
              {shares.loading ? '…' : activeShares.length ? `You + ${plural(activeShares.length, 'attorney')}` : 'Only you'}
            </span>
            <span className="detail">{activeShares.length ? 'You can take back access any time.' : 'Nothing has been shared.'}</span>
          </Link>
        </div>
      </section>

      {/* ── next steps ── */}
      <section className="card stack" aria-labelledby="next">
        <h2 id="next">When you’re ready</h2>
        <p className="muted small">There’s no right order, and nothing here has a deadline. Skip anything you like.</p>
        <ul className="next-steps">
          {!vault.loading && (
            <li>
              <Link className="next-step" to="/vault/story" data-testid="next-story">
                <span className="dot-icon warm"><IconFeather /></span>
                <span className="step-text">
                  <strong>{currentSeal ? 'Add to your story' : hasDraft ? 'Pick up where you left off' : 'Start your story'}</strong>
                  <span>
                    {currentSeal
                      ? 'Remembered something new? Your earlier sealed version stays as it was.'
                      : hasDraft
                        ? 'Your words are saved. Carry on when it feels right.'
                        : 'Write a little or a lot, in your own words. You can stop at any time.'}
                  </span>
                </span>
                <span className="chev" aria-hidden="true">›</span>
              </Link>
            </li>
          )}
          <li>
            <Link className="next-step" to="/vault/evidence">
              <span className="dot-icon"><IconImage /></span>
              <span className="step-text">
                <strong>{fileCount ? 'Add more evidence' : 'Keep photos, screenshots or messages'}</strong>
                <span>Each file is cleaned and locked on this device before it’s saved.</span>
              </span>
              <span className="chev" aria-hidden="true">›</span>
            </Link>
          </li>
          {currentSeal && (
            <li>
              <Link className="next-step" to="/vault/brief">
                <span className="dot-icon sage"><IconBook /></span>
                <span className="step-text">
                  <strong>Prepare a summary</strong>
                  <span>In your own words, to bring to police, an advocate or a lawyer — only if you choose.</span>
                </span>
                <span className="chev" aria-hidden="true">›</span>
              </Link>
            </li>
          )}
          {currentSeal && activeShares.length === 0 && (
            <li>
              <Link className="next-step" to="/vault/share">
                <span className="dot-icon sage"><IconPeople /></span>
                <span className="step-text">
                  <strong>Talk with a verified attorney</strong>
                  <span>Free legal help, if you want it. Nothing is shared until you say yes.</span>
                </span>
                <span className="chev" aria-hidden="true">›</span>
              </Link>
            </li>
          )}
        </ul>
      </section>

      {/* ── story ── */}
      <section className="card stack" aria-labelledby="accounts" data-testid="home-story">
        <div className="section-title">
          <h2 id="accounts">Your story</h2>
          <Link className="btn btn-small" to="/vault/story">
            {sealed.length ? 'Add to it' : hasDraft ? 'Continue' : 'Start when you’re ready'}
          </Link>
        </div>
        {vault.loading && <Loading label="Opening your space…" />}
        {vault.error && <ErrorNote>{vault.error}</ErrorNote>}
        {!vault.loading && !vault.error && (
          <>
            {hasDraft && (
              <p className="small">
                {working.data ? (
                  <span className="badge">Draft in progress — not saved to your space yet</span>
                ) : (
                  <span className="badge neutral">Draft saved {formatDate(savedDraft!.payload.savedAt)}</span>
                )}
              </p>
            )}
            {sealed.length === 0 ? (
              <p className="muted">
                Nothing sealed yet. That’s okay — you can save a draft and come back as many times as you need.
              </p>
            ) : (
              <ul className="list">
                {sealed.map((r) => (
                  <li key={r.meta.id} className="stack" data-testid={r.supersededBy ? 'sealed-earlier' : 'sealed-current'}>
                    <div className="row">
                      <strong>{r.supersededBy ? 'Earlier version' : 'Current sealed version'}</strong>
                      <VerifyBadge verified={r.verified} />
                    </div>
                    <div className="small muted">
                      Sealed {formatDate(r.ledgerEntry?.timestamp ?? r.meta.createdAt)}
                      {r.ledgerEntry && <> · ledger entry #{r.ledgerEntry.seq}</>} ·{' '}
                      {plural(r.payload.record?.evidence.length ?? 0, 'evidence file')}
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
      <section className="card stack" aria-labelledby="evidence" data-testid="home-evidence">
        <div className="section-title">
          <h2 id="evidence">Evidence</h2>
          <Link className="btn btn-small" to="/vault/evidence">
            Add evidence
          </Link>
        </div>
        {blobs.loading && <Loading />}
        {blobs.error && <ErrorNote>{blobs.error}</ErrorNote>}
        {blobs.data && blobs.data.length === 0 && <p className="muted">No files yet. Whenever you’re ready.</p>}
        {blobs.data && blobs.data.length > 0 && (
          <ul className="list">
            {blobs.data.map((b) => {
              const m = metaByBlob.get(b.id);
              return (
                <li key={b.id} className="row" style={{ justifyContent: 'space-between' }}>
                  <span style={{ minWidth: 0 }}>
                    <strong style={{ overflowWrap: 'anywhere' }}>{m?.fileName ?? 'Locked file'}</strong>{' '}
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
      <section className="card stack" aria-labelledby="escrow" data-testid="home-escrow">
        <div className="section-title">
          <h2 id="escrow">Sealed matches</h2>
          <Link className="btn btn-small" to="/vault/matching" data-testid="home-matching-link">Review or withdraw</Link>
        </div>
        <p className="small muted">
          If you chose a sealed match, the email, phone number, or social media profile you gave is sealed on this device.
          Nobody can read it — not us, not anyone. This list will always say “Sealed” — that’s on purpose, so no one can
          use this page to find out whether they’ve been named.
        </p>
        {escrow.loading && <Loading />}
        {escrow.error && <ErrorNote>{escrow.error}</ErrorNote>}
        {escrow.data && escrow.data.length === 0 && <p className="muted">Nothing sealed.</p>}
        {escrow.data?.map(({ entry, label }) => <EscrowCard key={entry.id} entry={entry} label={label} />)}
        {escrow.data && escrow.data.length > 0 && (
          <p className="small muted">
            If someone else names the same person, a trained legal options counselor — not the police, not your school —
            will reach out privately to talk about your options. You decide everything after that. Names aren’t unique
            enough to match safely, so they’re never used.
          </p>
        )}
      </section>

      {/* ── shares ── */}
      <section className="card stack" aria-labelledby="shares" data-testid="home-shares">
        <div className="section-title">
          <h2 id="shares">Who can see your story</h2>
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

      <ExportCard />

      {/* ── activity ── */}
      <section className="card stack" aria-labelledby="activity" data-testid="home-activity">
        <h2 id="activity">Activity</h2>
        <p className="small muted">Everything that happens with your space, including every time an attorney opens your file.</p>
        {audit.loading && <Loading />}
        {audit.error && <ErrorNote>{audit.error}</ErrorNote>}
        {audit.data && audit.data.length === 0 && <p className="muted">Nothing yet.</p>}
        {activityList.length > 0 && (
          <ul className="list timeline small">
            {activityList.slice(0, showAllActivity ? 50 : 10).map((e) => (
              <li key={e.id}>
                <span>{describeAudit(e, kindBySeq)}</span>
                <span className="muted">{formatDate(e.at)}</span>
              </li>
            ))}
          </ul>
        )}
        {activityList.length > 10 && (
          <div>
            <button className="btn btn-quiet btn-small" type="button" onClick={() => setShowAllActivity((v) => !v)}>
              {showAllActivity ? 'Show less' : 'Show more'}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

/** Greeting: by the name she chose (kept only in her encrypted profile), and a way to change it. */
function Greeting({ firstVisit, name, alias }: { firstVisit: boolean; name?: string; alias: string }) {
  const { saveProfile } = useRequiredSession();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = firstVisit
    ? name
      ? `Welcome, ${name}.`
      : 'Welcome. This space is yours.'
    : name
      ? `Welcome back, ${name}.`
      : 'Welcome back.';
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await saveProfile({ preferredName: draft });
      setEditing(false);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="greeting" aria-labelledby="home-title">
      <p className="eyebrow">Your private space</p>
      <h1 id="home-title" tabIndex={-1} data-autofocus data-testid="home-title">
        {title}
      </h1>
      <p className="lead">
        {firstVisit
          ? 'Everything here is locked on this device before it’s saved. There’s no rush — start whenever you’re ready.'
          : 'Take your time. Everything here is unlocked only on this device, and only for you.'}
      </p>
      <div className="name-edit">
        {editing ? (
          <form className="row" onSubmit={save} style={{ alignItems: 'flex-end' }}>
            <label className="field" style={{ flex: '1 1 220px' }}>
              <span>What should we call you?</span>
              <span className="hint">A nickname is fine. Leave it empty if you’d rather not say.</span>
              <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={60} autoComplete="off" autoFocus />
            </label>
            <button className="btn btn-primary btn-small" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button className="btn btn-small" type="button" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
          </form>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            Signed in as {alias} ·{' '}
            <button
              type="button"
              className="btn btn-quiet btn-small"
              style={{ minHeight: 0, padding: '2px 6px', verticalAlign: 'baseline' }}
              onClick={() => {
                setDraft(name ?? '');
                setEditing(true);
              }}
            >
              {name ? 'Change what we call you' : 'Tell us what to call you'}
            </button>
          </p>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </section>
  );
}

/** "Download my data": decrypts everything on this device into one .zip, after a clear warning. */
function ExportCard() {
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
    <section className="card stack" aria-labelledby="your-data" data-testid="home-data">
      <div className="section-title">
        <h2 id="your-data">Your data</h2>
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
    </section>
  );
}

/**
 * Survivors never see match results (the server always reports 'sealed'). If they could, a perpetrator posing as a
 * survivor could escrow his own identifiers and learn he has been named. Matches are released only to a verified
 * legal options counselor.
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
  const name = attorney ? attorney.displayName : 'Attorney';
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
        <span style={{ minWidth: 0 }}>
          <strong>{name}</strong>
          {attorney?.organization && <span className="small muted"> · {attorney.organization}</span>}
          <br />
          <span className="small muted">
            Shared {formatDate(share.createdAt)} · {scopeText(share.scope)}
            {share.status === 'active' && <> · {expired ? 'ended' : 'until'} {formatDate(share.expiresAt)}</>}
          </span>
        </span>
        {share.status === 'active' ? expired ? <span className="badge neutral">Expired</span> : <span className="badge ok">Has access</span> : <span className="badge neutral">Revoked {formatDate(share.revokedAt)}</span>}
      </div>
      {share.status === 'active' &&
        (confirming ? (
          <div className="card warn stack">
            <p>
              Take back {name}’s access? They won’t be able to open your file again. This can’t undo what they’ve already
              seen.
            </p>
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
            <button className="btn btn-small btn-danger" onClick={() => setConfirming(true)} data-testid="share-revoke">
              Revoke
            </button>
          </div>
        ))}
      {error && <ErrorNote>{error}</ErrorNote>}
    </li>
  );
}
