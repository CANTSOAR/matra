import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { BlobMeta, EvidenceItem } from '@matra/shared';
import { ErrorNote, Loading, PageTitle, VerifyBadge, formatDate, useAsync } from '../components/common';
import { IconFile, IconImage } from '../components/icons';
import { KeyNotice } from '../components/KeyNotice';
import { emptyDraft } from '../integration/intakeAdapter';
import { NOTICES } from '../lib/disclosures';
import { friendlyError, useRequiredSession } from '../lib/session';
import {
  blobKeyFor,
  formatBytes,
  latestOf,
  loadVault,
  mergeEvidence,
  openEvidence,
  resumeFrom,
  sealPayload,
  shortHash,
  uploadEvidence,
} from '../lib/vault';

interface Uploaded {
  item: EvidenceItem;
  note: string;
  previewUrl?: string;
  sealedAt: string;
}

interface Pending {
  name: string;
  status: string;
  error?: string;
}

/** Object URLs are only ever created from in-memory plaintext, and always revoked. */
function useObjectUrls() {
  const urls = useRef<string[]>([]);
  useEffect(
    () => () => {
      urls.current.forEach((u) => URL.revokeObjectURL(u));
      urls.current = [];
    },
    [],
  );
  return (b: Blob) => {
    const u = URL.createObjectURL(b);
    urls.current.push(u);
    return u;
  };
}

export function Evidence() {
  const { api, session, getWorkingData, setWorkingData } = useRequiredSession();
  const location = useLocation();
  const fromStory = (location.state as { from?: string } | null)?.from === 'story';
  const makeUrl = useObjectUrls();
  const [uploaded, setUploaded] = useState<Uploaded[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [description, setDescription] = useState('');
  const [capturedAt, setCapturedAt] = useState('');
  const [over, setOver] = useState(false);
  const [persistMsg, setPersistMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadExisting = useCallback(async () => {
    const [vault, { blobs }, mem] = await Promise.all([loadVault(api, session.masterKey), api.listBlobs(), getWorkingData()]);
    const draft = latestOf(vault, 'draft');
    const final = latestOf(vault, 'final');
    const meta = mergeEvidence(draft?.payload.evidence, final?.payload.record?.evidence, mem?.evidence);
    const resume = resumeFrom(vault);
    return {
      blobs,
      meta,
      vaultDraft: draft,
      resumeDraft: resume.draft,
      resumeEvidence: mergeEvidence(final?.payload.record?.evidence, resume.draftRecord?.payload.evidence),
      inFinal: new Set((final?.payload.record?.evidence ?? []).map((e) => e.blobId)),
    };
  }, [api, session.masterKey, getWorkingData]);
  const existing = useAsync(loadExisting, [loadExisting]);
  // The latest loaded vault state, read when a file finishes uploading (not the render the file was chosen in).
  const existingRef = useRef(existing.data);
  existingRef.current = existing.data;

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    setPersistMsg(null);
    const added: EvidenceItem[] = [];
    for (const file of list) {
      setPending((p) => [...p, { name: file.name, status: 'Removing hidden details and encrypting on your device…' }]);
      try {
        const res = await uploadEvidence(api, session.masterKey, file, { description, capturedAt });
        const previewUrl = res.item.mimeType.startsWith('image/') ? makeUrl(res.plaintext) : undefined;
        setUploaded((u) => [{ item: res.item, note: res.note, previewUrl, sealedAt: res.ledgerEntry.timestamp }, ...u]);
        added.push(res.item);
        setPending((p) => p.filter((x) => x.name !== file.name));
      } catch (e) {
        setPending((p) => p.map((x) => (x.name === file.name ? { ...x, status: 'Not uploaded', error: friendlyError(e) } : x)));
      }
    }
    if (!added.length) return;
    // Attach to the in-progress account (in memory) and persist the metadata in a vault draft,
    // so file names/hashes survive sign-out.
    try {
      const mem = await getWorkingData();
      // If she chose a file before her space finished opening, open it now: otherwise her story would be saved over
      // with an empty draft (and the next screen would start from the beginning).
      const ex = existingRef.current ?? (await loadExisting());
      const vaultDraft = ex.vaultDraft;
      const draft = mem?.draft ?? ex.resumeDraft ?? emptyDraft();
      const evidence = mergeEvidence(ex.resumeEvidence, mem?.evidence, added);
      const res = await sealPayload(
        api,
        session.masterKey,
        { kind: 'draft', draft, evidence, savedAt: new Date().toISOString() },
        mem?.savedDraftRecordId ?? vaultDraft?.meta.id,
      );
      await setWorkingData({ draft, evidence, savedDraftRecordId: res.record.id });
      setPersistMsg('Saved to your space and added to your draft story.');
      void existing.reload();
    } catch (e) {
      setPersistMsg(`Your files are safely uploaded, but we couldn’t add their details to your draft: ${friendlyError(e)}`);
    }
    setDescription('');
    setCapturedAt('');
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    void handleFiles(e.dataTransfer.files);
  }

  const metaByBlob = new Map((existing.data?.meta ?? []).filter((m) => m.blobId).map((m) => [m.blobId!, m]));
  const newIds = new Set(uploaded.map((u) => u.item.blobId));

  return (
    <div className="stack-lg">
      {fromStory && (
        <p>
          <Link className="back-link" to="/vault/story">← Back to my story</Link>
        </p>
      )}
      <PageTitle
        eyebrow="Things to keep"
        lead="Photos, screenshots, messages, recordings or documents — anything you want to keep. Each file is cleaned and locked on this device before a copy is uploaded."
      >
        Evidence
      </PageTitle>

      <section className="card stack" aria-labelledby="add">
        <h2 id="add">Add something</h2>
        <div
          className={`dropzone stack${over ? ' over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          <p className="muted" style={{ margin: 0 }}>Drop files here, or</p>
          <div>
            <button type="button" className="btn btn-primary" onClick={() => inputRef.current?.click()}>
              Choose files
            </button>
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="visually-hidden"
            aria-label="Choose evidence files"
            onChange={(e) => {
              if (e.target.files) void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
        <div className="grid-2">
          <label className="field">
            <span>What is it? (optional)</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. texts he sent the next day" />
          </label>
          <label className="field">
            <span>When was it taken or received? (optional)</span>
            <input value={capturedAt} onChange={(e) => setCapturedAt(e.target.value)} placeholder="e.g. around March 3" />
          </label>
        </div>
        <p className="small muted">
          Photos (JPEG, PNG, WebP) have hidden details — like location and camera info — removed automatically. For other
          files, we’ll tell you what couldn’t be removed. A fingerprint (SHA-256) of each cleaned file is recorded, so
          anyone can later check it hasn’t been changed.
        </p>
        <KeyNotice notice={NOTICES.keepOriginals} />
        {pending.map((p) => (
          <div key={p.name} className="stack">
            {p.error ? <ErrorNote>{p.name}: {p.error}</ErrorNote> : <Loading label={`${p.name}: ${p.status}`} />}
          </div>
        ))}
        {persistMsg && <p role="status">{persistMsg}</p>}
      </section>

      {uploaded.length > 0 && (
        <section className="card stack" aria-labelledby="just-added" data-testid="evidence-just-added">
          <h2 id="just-added">Added just now</h2>
          <ul className="list">
            {uploaded.map((u) => (
              <li key={u.item.id} className="evidence-row">
                {u.previewUrl ? <img className="thumb" src={u.previewUrl} alt={`Preview of ${u.item.fileName}`} /> : <ThumbPlaceholder mime={u.item.mimeType} />}
                <div className="meta stack">
                  <div className="row">
                    <strong style={{ overflowWrap: 'anywhere' }}>{u.item.fileName}</strong>
                    <span className={u.item.metadataStripped ? 'badge ok' : 'badge warn'}>
                      {u.item.metadataStripped ? 'Hidden details removed' : 'Hidden details not removed'}
                    </span>
                  </div>
                  <p className="small">{u.note}</p>
                  <p className="small muted">
                    {formatBytes(u.item.sizeBytes)} · sealed {formatDate(u.sealedAt)}
                  </p>
                  <p className="mono small muted" title="SHA-256 fingerprint of the cleaned file">
                    SHA-256: {u.item.sha256}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card stack" aria-labelledby="in-vault" data-testid="evidence-in-space">
        <h2 id="in-vault">In your space</h2>
        {existing.loading && <Loading />}
        {existing.error && <ErrorNote>{existing.error}</ErrorNote>}
        {existing.data && existing.data.blobs.length === 0 && (
          <p className="muted">No files yet. There’s no rush — add things whenever you’re ready.</p>
        )}
        {existing.data && existing.data.blobs.length > 0 && (
          <>
            {existing.data.blobs.some((b) => !existing.data!.inFinal.has(b.id)) && (
              <p className="small card soft">
                New files join your sealed story the next time you seal it: open <Link to="/vault/story">My story</Link> and
                seal it again. Only sealed files can be shared with an attorney.
              </p>
            )}
            <ul className="list">
              {existing.data.blobs
                .filter((b) => !newIds.has(b.id))
                .map((b) => (
                  <VaultFile key={b.id} blob={b} meta={metaByBlob.get(b.id)} inFinal={existing.data!.inFinal.has(b.id)} makeUrl={makeUrl} />
                ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function VaultFile({ blob, meta, inFinal, makeUrl }: { blob: BlobMeta; meta?: EvidenceItem; inFinal: boolean; makeUrl(b: Blob): string }) {
  const { api, session } = useRequiredSession();
  const [view, setView] = useState<{ url: string; verified?: boolean; isImage: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function open() {
    setBusy(true);
    setError(null);
    try {
      const key = await blobKeyFor(blob, session.masterKey);
      const res = await openEvidence(api, key, blob.id, meta?.sha256);
      const type = meta?.mimeType ?? 'application/octet-stream';
      setView({ url: makeUrl(new Blob([res.bytes as BlobPart], { type })), verified: res.verified, isImage: type.startsWith('image/') });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="evidence-row">
      {view?.isImage ? <img className="thumb" src={view.url} alt={`Preview of ${meta?.fileName ?? 'file'}`} /> : <ThumbPlaceholder mime={meta?.mimeType} />}
      <div className="meta stack">
        <div className="row">
          <strong style={{ overflowWrap: 'anywhere' }}>{meta?.fileName ?? 'Locked file'}</strong>
          {inFinal ? <span className="badge sage">In your sealed story</span> : <span className="badge neutral">Not in your sealed story yet</span>}
          {view && <VerifyBadge verified={view.verified} />}
        </div>
        <p className="small muted">
          {formatBytes(meta?.sizeBytes ?? blob.sizeBytes)} · sealed {formatDate(blob.createdAt)}
          {meta?.description && <> · {meta.description}</>}
        </p>
        {meta && <p className="mono small muted">SHA-256: {shortHash(meta.sha256, 20)}</p>}
        <div className="row">
          {!view && (
            <button className="btn btn-small" onClick={() => void open()} disabled={busy}>
              {busy ? 'Unlocking…' : 'Unlock & view'}
            </button>
          )}
          {view && (
            <a className="btn btn-small" href={view.url} download={meta?.fileName ?? 'evidence'}>
              Download
            </a>
          )}
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </li>
  );
}

function ThumbPlaceholder({ mime }: { mime?: string }) {
  return <div className="thumb" aria-hidden="true">{mime?.startsWith('image/') ? <IconImage /> : <IconFile />}</div>;
}
