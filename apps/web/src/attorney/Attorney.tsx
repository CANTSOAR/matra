import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { checkAttorneyKey, decryptBlob, decryptJSON, publicKeyFingerprint, sha256Hex, unwrapKeyWithPrivate } from '@matra/crypto';
import type { EvidenceItem, IntakeRecord, LedgerEntry, LedgerProofResponse, ShareBundle } from '@matra/shared';
import { ApiError, envelopeHash } from '../api/client';
import { ErrorNote, Loading, PageTitle, VerifyBadge, formatDate, useAsync } from '../components/common';
import { BriefPreview, downloadPdf, generateIncidentSummary } from '../integration/briefAdapter';
import { friendlyError, useRequiredSession } from '../lib/session';
import { formatBytes, type VaultPayload } from '../lib/vault';
import { MATCH_PINS } from '../matchPins';
import { CheckLines } from '../verify/CheckLines';
import { accountCheck, chainCheck, evidenceCheck, overallTone, proofHashes, sealedEntry, type CheckLine } from '../verify/checks';

const SCOPE_WORDS: Record<string, string> = { record: 'Written account', evidence: 'Evidence files', brief: 'Incident summary' };
const scopeText = (scope: string[]) => scope.map((x) => SCOPE_WORDS[x] ?? x).join(' · ');

export function AttorneyCases() {
  const { api, session, refreshProfile } = useRequiredSession();
  // null: the server refuses an unverified attorney (403 attorney_not_verified); shares to her are paused, not gone
  const shares = useAsync(
    () =>
      api
        .listShares()
        .then((r) => r.shares)
        .catch((e) => {
          if (e instanceof ApiError && e.code === 'attorney_not_verified') return null;
          throw e;
        }),
    [api],
  );
  const paused = shares.data === null;
  const fp = useAsync(() => publicKeyFingerprint(session.user.publicKey), [session.user.publicKey]);
  // Is this key in the org-signed directory survivors' apps check against (W3)? Unpinned (development) builds say nothing.
  const listing = useAsync(
    () => api.listAttorneys().then((r) => checkAttorneyKey(r.directory, { userId: session.user.id, publicKey: session.user.publicKey }, MATCH_PINS.rosterKey)),
    [api, session.user.id, session.user.publicKey],
  );
  const profile = session.attorneyProfile;
  const [checking, setChecking] = useState(false);
  const active = (shares.data ?? []).filter((s) => s.status === 'active');
  const revoked = (shares.data ?? []).filter((s) => s.status === 'revoked');

  return (
    <div className="stack-lg">
      <PageTitle
        eyebrow="Attorney portal"
        lead={profile ? `${profile.displayName}${profile.organization ? ` · ${profile.organization}` : ''}` : undefined}
      >
        Shared with you
      </PageTitle>
      {profile && !profile.verified && (
        <div className="card warn stack" role="status">
          <strong>Pending verification</strong>
          <p style={{ margin: 0 }}>
            We’re verifying your bar admission. Until then, you won’t appear to survivors. This usually takes 1–2 business days.
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
      <div className="card sage small stack">
        <p style={{ margin: 0 }}>
          <strong>Your key fingerprint:</strong> <span className="fingerprint">{fp.data ?? '…'}</span>
        </p>
        {listing.data?.status === 'verified' && (
          <p style={{ margin: 0 }} data-testid="attorney-directory-status">
            Matra’s signed attorney directory lists this key as yours, so clients’ apps confirm it automatically. Nobody
            needs to call you to compare it.
          </p>
        )}
        {listing.data && (listing.data.status === 'not_listed' || listing.data.status === 'unsigned') && profile?.verified && (
          <p style={{ margin: 0 }} data-testid="attorney-directory-status">
            Your key isn’t in Matra’s signed attorney directory yet. Until Matra signs it, clients can’t share with you.
          </p>
        )}
        {listing.data?.status === 'key_mismatch' && (
          <p style={{ margin: 0 }} data-testid="attorney-directory-status">
            <strong>Matra’s signed directory lists a different key for you.</strong> Clients can’t share with you until this
            is fixed. Please contact Matra.
          </p>
        )}
        <p style={{ margin: 0 }}>
          Received a summary PDF or evidence files by email or on a drive? <Link to="/verify">Check a file</Link> in your
          browser; nothing is uploaded.
        </p>
      </div>
      <section className="card stack" aria-labelledby="active">
        <h2 id="active">Active files</h2>
        <p className="small muted">Each file was shared with you by a survivor, with their consent. Every time you open one, they can see it.</p>
        {shares.loading && <Loading />}
        {shares.error && <ErrorNote>{shares.error}</ErrorNote>}
        {/* Any unverified account: a new one with no files yet, or one Matra unverified (its sessions end, so after
            signing back in its profile says unverified too). */}
        {paused && (
          <p className="muted" data-testid="attorney-paused">
            Your account isn’t verified by Matra right now, so you can’t open shared files. If clients shared files with
            you before, each of them decides whether to end or keep your access. Files they keep shared will show here
            again if Matra verifies your account.
          </p>
        )}
        {shares.data && active.length === 0 && <p className="muted">No files have been shared with you yet.</p>}
        <ul className="list">
          {active.map((s) => (
            <li key={s.id} className="row" style={{ justifyContent: 'space-between' }}>
              <span style={{ minWidth: 0 }}>
                <strong>Shared file</strong>
                <br />
                <span className="small muted">
                  Shared {formatDate(s.createdAt)} · access until {formatDate(s.expiresAt)} · {scopeText(s.scope)}
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
  /** sealed-content entries for the record and every shared evidence file, with chain links (null: ledger unreachable) */
  proof: LedgerProofResponse | null;
}

/** One evidence file the attorney decrypted: its SHA-256 and its ciphertext's, computed on this device. */
interface BlobCheck {
  sha256: string;
  ciphertextHash: string;
}

/**
 * Every bundle fetch is logged to the client as "Attorney opened your file". React StrictMode (dev) mounts effects
 * twice, which would log one visit as two — so concurrent requests for the same share are shared.
 */
const inflightBundles = new Map<string, Promise<ShareBundle>>();
function fetchBundleOnce(api: ReturnType<typeof useRequiredSession>['api'], id: string): Promise<ShareBundle> {
  let p = inflightBundles.get(id);
  if (!p) {
    p = api.getShareBundle(id).finally(() => inflightBundles.delete(id));
    inflightBundles.set(id, p);
  }
  return p;
}

export function AttorneyCase() {
  const { id = '' } = useParams();
  const { api, session } = useRequiredSession();
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);

  const opened = useAsync(async (): Promise<OpenedCase> => {
    const bundle = await fetchBundleOnce(api, id);
    const key = await unwrapKeyWithPrivate(bundle.recipientWrappedKey, session.privateKey);
    const payload = await decryptJSON<VaultPayload>(bundle.record.envelope, key);
    if (!payload.record) throw new Error('This file does not contain a sealed account.');
    const recomputedHash = await envelopeHash(bundle.record.envelope);
    // The record's hash as recomputed HERE (not the server's word for it), and the ciphertext hashes of the shared
    // evidence; the chain is re-checked on this device (verify/checks.ts).
    let proof: LedgerProofResponse | null = null;
    try {
      proof = await api.ledgerProof(proofHashes(recomputedHash, ...bundle.blobs.map((b) => b.contentHash)));
    } catch {
      /* shown as unverified */
    }
    const ledgerEntry = sealedEntry(proof ?? undefined, recomputedHash);
    return { bundle, record: payload.record, recordKeyOk: true, ledgerEntry, recomputedHash, proof };
  }, [api, id, session.privateKey]);
  const [checks, setChecks] = useState<Record<string, BlobCheck>>({});
  const [checkAll, setCheckAll] = useState(0);
  const verification = opened.data ? caseChecks(opened.data, checks) : null;
  const ledgerOk = verification ? verification.tone === 'ok' && !verification.lines.some((l) => l.id === 'account' && l.tone !== 'ok') : undefined;

  async function downloadBrief() {
    if (!opened.data) return;
    setBriefBusy(true);
    setBriefError(null);
    try {
      const { bundle, record, ledgerEntry } = opened.data;
      const pdf = await generateIncidentSummary(record, {
        recordId: bundle.record.id,
        recordContentHash: bundle.record.contentHash,
        ledgerEntry,
        generatedAt: new Date(),
        preparedFor: session.attorneyProfile?.displayName,
      });
      downloadPdf(pdf, `matra-incident-summary-${bundle.survivorAlias}-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) {
      setBriefError(friendlyError(e));
    } finally {
      setBriefBusy(false);
    }
  }

  return (
    <div className="stack-lg">
      <p>
        <Link className="back-link" to="/attorney/cases">← All files</Link>
      </p>
      {opened.loading && <Loading label="Fetching and decrypting with your private key…" />}
      {opened.error && <ErrorNote>{opened.error}</ErrorNote>}
      {opened.data && (
        <>
          <PageTitle eyebrow="Shared file">Client: {opened.data.bundle.survivorAlias}</PageTitle>
          <dl className="case-meta">
            <div>
              <dt>Shared</dt>
              <dd>{formatDate(opened.data.bundle.share.createdAt)}</dd>
            </div>
            <div>
              <dt>Access until</dt>
              <dd>{formatDate(opened.data.bundle.share.expiresAt)}</dd>
            </div>
            <div>
              <dt>Scope</dt>
              <dd>{scopeText(opened.data.bundle.share.scope)}</dd>
            </div>
            <div>
              <dt>Integrity</dt>
              <dd>
                <VerifyBadge verified={ledgerOk} />
              </dd>
            </div>
          </dl>
          <p className="card soft small" role="note">
            Your access is logged and visible to your client. They can revoke it at any time. Please handle this file with
            care — it’s their story, in their words.
          </p>

          <section className="card stack" aria-labelledby="consent">
            <h2 id="consent">Client’s consent (verbatim)</h2>
            <div className="consent-text">{opened.data.bundle.share.consentStatement}</div>
          </section>

          <section className="card stack" aria-labelledby="proof" data-testid="case-verification">
            <div className="section-title">
              <h2 id="proof">Verification</h2>
              <VerifyBadge verified={ledgerOk} />
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              Checked in your browser just now: the account was re-hashed on this device and compared with Matra’s
              tamper-evident ledger, and the ledger’s hash chain was recomputed.
            </p>
            {verification && <CheckLines lines={verification.lines} testId="case-checks" />}
            {verification && verification.unchecked > 0 && (
              <div className="row">
                <button className="btn btn-small" onClick={() => setCheckAll((n) => n + 1)} disabled={checkAll > 0}>
                  {checkAll > 0 ? 'Checking…' : `Check all ${verification.unchecked} evidence file${verification.unchecked === 1 ? '' : 's'}`}
                </button>
                <span className="small muted">Each file is downloaded and decrypted on this device. Your client sees each download.</span>
              </div>
            )}
          </section>

          <section className="card stack" aria-labelledby="brief">
            <div className="section-title">
              <h2 id="brief">Incident summary in the survivor’s own words</h2>
              <button className="btn btn-primary btn-small" onClick={() => void downloadBrief()} disabled={briefBusy}>
                {briefBusy ? 'Preparing…' : 'Download incident summary (PDF)'}
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
                  checkSignal={checkAll}
                  onChecked={(c) => setChecks((m) => ({ ...m, [b.blobId]: c }))}
                />
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

/**
 * The verification panel's lines: the account (re-hashed here), the shared evidence (each file decrypted and hashed
 * here, its ciphertext found in the ledger as that file's seal), and the chain.
 */
function caseChecks(c: OpenedCase, checks: Record<string, BlobCheck>): { lines: CheckLine[]; tone: ReturnType<typeof overallTone>; unchecked: number } {
  const proof = c.proof ?? undefined;
  const lines: CheckLine[] = [];
  if (!c.proof)
    lines.push({ id: 'account', tone: 'bad', text: 'We couldn’t reach Matra’s ledger to check this account. Try again in a moment.', details: [] });
  else lines.push(accountCheck({ recordId: c.bundle.record.id, recordContentHash: c.recomputedHash, proof, recomputed: true }));
  const shared = c.bundle.blobs.map((b) => ({ blob: b, item: c.record.evidence.find((e) => e.blobId === b.blobId) }));
  const expected = shared.flatMap(({ item }) => (item ? [{ fileName: item.fileName, sha256: item.sha256 }] : []));
  const files: Array<{ name: string; sha256: string }> = [];
  const unsealed: string[] = [];
  for (const { blob, item } of shared) {
    const got = checks[blob.blobId];
    if (!got) continue;
    const seal = proof?.entries.find((e) => e.type === 'blob.sealed' && e.contentHash === got.ciphertextHash && e.subjectId === blob.blobId);
    if (seal) files.push({ name: item?.fileName ?? 'Evidence file', sha256: got.sha256 });
    else unsealed.push(`${item?.fileName ?? blob.blobId}: ciphertext ${got.ciphertextHash}`);
  }
  const unchecked = shared.filter(({ blob }) => !checks[blob.blobId]).length;
  if (shared.length && unchecked === shared.length)
    lines.push({
      id: 'evidence',
      tone: 'info',
      text: `${shared.length} evidence file${shared.length === 1 ? ' was' : 's were'} shared. Not checked yet.`,
      details: expected.map((e) => `${e.fileName}: ${e.sha256}`),
    });
  else if (shared.length) lines.push(...evidenceCheck(expected, files));
  if (unsealed.length)
    lines.push({
      id: 'files',
      tone: 'bad',
      text: `${unsealed.length === 1 ? 'One evidence file isn’t' : `${unsealed.length} evidence files aren’t`} what was sealed in the ledger. Treat ${unsealed.length === 1 ? 'it' : 'them'} as unverified.`,
      details: unsealed,
    });
  const chain = chainCheck(proof);
  if (chain) lines.push(chain);
  return { lines, tone: overallTone(lines), unchecked };
}

/*
 * Sealed matching is no longer shown to attorneys: they never see match status or counts. Matches go only to a
 * verified Legal Options Counselor (apps/web/src/counselor), who reaches out to each matched survivor separately.
 */

/**
 * One shared evidence file: decrypt with the recipient's private key, check the hash she recorded, and only then offer
 * the download. Also used by the counselor's report viewer (counselor/CounselorReport.tsx), which passes `download`.
 */
export function SharedBlob({
  blob,
  item,
  download,
  checkSignal,
  onChecked,
}: {
  blob: Pick<ShareBundle['blobs'][number], 'blobId' | 'recipientWrappedKey' | 'sizeBytes'>;
  item?: EvidenceItem;
  /** fetch the ciphertext (default: the attorney share route) */
  download?: (blobId: string) => Promise<Uint8Array>;
  /** when this changes to a positive number, decrypt and verify (the verification panel's "Check all") */
  checkSignal?: number;
  /** the hashes computed on this device, for the verification panel */
  onChecked?(c: { sha256: string; ciphertextHash: string }): void;
}) {
  const { api, session } = useRequiredSession();
  const [state, setState] = useState<{ busy?: boolean; url?: string; ok?: boolean; hash?: string; error?: string }>({});
  const started = useRef(false);
  async function decrypt() {
    started.current = true;
    setState({ busy: true });
    try {
      const key = await unwrapKeyWithPrivate(blob.recipientWrappedKey, session.privateKey);
      const ct = await (download ?? ((id: string) => api.downloadBlob(id)))(blob.blobId);
      const pt = await decryptBlob(ct, key);
      const [hash, ciphertextHash] = await Promise.all([sha256Hex(pt), sha256Hex(ct)]);
      const ok = !!item && hash === item.sha256;
      // only offer the download once the hash has been checked
      const url = ok ? URL.createObjectURL(new Blob([pt as BlobPart], { type: item?.mimeType ?? 'application/octet-stream' })) : undefined;
      setState({ ok, hash, url });
      onChecked?.({ sha256: hash, ciphertextHash });
    } catch (e) {
      started.current = false;
      setState({ error: friendlyError(e) });
    }
  }
  useEffect(() => {
    if (checkSignal && !started.current) void decrypt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkSignal]);
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
