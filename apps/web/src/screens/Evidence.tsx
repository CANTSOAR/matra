import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { BlobMeta, EvidenceItem } from '@matra/shared';
import { ErrorNote, Loading, PageTitle, VerifyBadge, formatDate, useAsync } from '../components/common';
import { IconFile, IconImage } from '../components/icons';
import { KeyNotice } from '../components/KeyNotice';
import { VaultStopped } from '../components/UnreadableNote';
import { emptyDraft } from '../integration/intakeAdapter';
import { NOTICES } from '../lib/disclosures';
import { friendlyError, useRequiredSession } from '../lib/session';
import {
  blobKeyFor,
  formatBytes,
  loadSpace,
  mergeEvidence,
  openEvidence,
  resumeFrom,
  shortHash,
  spaceEvidence,
  uploadEvidence,
  vaultError,
} from '../lib/vault';
import { SlotConflictError, currentDraftMode, saveDraftSlot } from '../lib/draftSlot';
import { DatesFoundSection } from '../evidence/DatesFoundSection';
import { DATES_FOUND_IN_BUILD } from '../evidence/datesFlag';
import { numberExhibits, type Exhibit } from '../evidence/exhibits';
import { BlurredImage, ExhibitSection, OcrControl, RedactControl, readableType } from '../evidence/EvidencePanels';
import { FINGERPRINT_NOTE, IMPORT_FORMAT_NOTICE } from '../evidence/formats';
import { emptyPrivate, loadPrivate, originalBlobIds, type PrivateEvidence, type PrivateItem } from '../evidence/privateStore';

interface Uploaded {
  item: EvidenceItem;
  note: string;
  /** set when the hidden details were NOT removed */
  warning: string | null;
  /** set when the private fingerprint of the original could not be kept */
  privateNote: string | null;
  details: PrivateItem | null;
  plaintext: Blob;
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
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [persistMsg, setPersistMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fails closed for writing (lib/vault.ts loadSpace): adding a file saves its details to her draft, and a draft built
  // from a space that didn't load cleanly could be older than her newest. Then nothing is uploaded; she sees why, and
  // Try again. Her files stay listed (read-only), with the details of what did load.
  const loadExisting = useCallback(async () => {
    const [{ vault, slot, problems }, { blobs }, mem, priv] = await Promise.all([
      loadSpace(api, session.masterKey, { allowPartial: true }),
      api.listBlobs(),
      getWorkingData(),
      // her private details about each file (text read from images, the proof of the original): never blocks the page
      loadPrivate(api, session.masterKey)
        .then((p) => ({ value: p.value, canKeep: !p.unreadable && currentDraftMode() !== 'keep-versions' }))
        .catch((): { value: PrivateEvidence; canKeep: boolean } => ({ value: emptyPrivate(), canKeep: false })),
    ]);
    const resume = resumeFrom(slot.slot, vault);
    const final = resume.final;
    const meta = spaceEvidence(vault, slot.slot, mem?.evidence); // the one set her files are numbered from
    return {
      blobs,
      meta,
      priv: priv.value,
      /** her private details can be kept, so a fingerprint can be made and an original kept */
      canKeepOriginal: priv.canKeep,
      resumeDraft: resume.draft,
      resumeEvidence: mergeEvidence(final?.payload.record?.evidence, resume.evidence),
      escrowedHashes: resume.escrowedHashes,
      slotVersion: slot.version,
      inFinal: new Set((final?.payload.record?.evidence ?? []).map((e) => e.blobId)),
      /** what didn't load cleanly: when set, nothing is uploaded or saved from this page */
      stop: problems.length ? vaultError(problems).message : null,
    };
  }, [api, session.masterKey, getWorkingData]);
  const existing = useAsync(loadExisting, [loadExisting]);
  // The latest loaded vault state, read when a file finishes uploading (not the render the file was chosen in).
  const existingRef = useRef(existing.data);
  existingRef.current = existing.data;

  async function handleFiles(files: FileList | File[], extra: { description?: string; derivedFrom?: string } = {}) {
    const list = Array.from(files);
    if (!list.length) return;
    setPersistMsg(null);
    // Her space must have opened cleanly first (she may have chosen a file before it finished): if it can't, nothing is
    // uploaded, so no file is left without its details in her draft.
    let opened = existingRef.current;
    try {
      if (!opened) opened = await loadExisting();
    } catch (e) {
      setPersistMsg(`Nothing was uploaded. ${friendlyError(e)}`);
      return;
    }
    if (opened.stop) {
      setPersistMsg(`Nothing was uploaded. ${opened.stop}`);
      return;
    }
    const added: EvidenceItem[] = [];
    for (const file of list) {
      setPending((p) => [...p, { name: file.name, status: 'Removing hidden details and encrypting on your device…' }]);
      try {
        const res = await uploadEvidence(api, session.masterKey, file, {
          description: extra.description ?? description,
          capturedAt: extra.derivedFrom ? '' : capturedAt,
          keepOriginal,
          ...(extra.derivedFrom && { derivedFrom: extra.derivedFrom }),
        });
        const previewUrl = res.item.mimeType.startsWith('image/') ? makeUrl(res.plaintext) : undefined;
        setUploaded((u) => [
          { item: res.item, note: res.note, warning: res.warning, privateNote: res.privateNote, details: res.details, plaintext: res.plaintext, previewUrl, sealedAt: res.ledgerEntry.timestamp },
          ...u,
        ]);
        added.push(res.item);
        setPending((p) => p.filter((x) => x.name !== file.name));
      } catch (e) {
        setPending((p) => p.map((x) => (x.name === file.name ? { ...x, status: 'Not uploaded', error: friendlyError(e) } : x)));
      }
    }
    if (!added.length) return;
    // Attach to the in-progress account (in memory) and save the details in her draft slot, so file names and hashes
    // survive sign-out.
    try {
      const mem = await getWorkingData();
      // the latest clean load (opened above, or reloaded since): never an empty draft over her story
      const ex = existingRef.current ?? opened;
      const draft = mem?.draft ?? ex.resumeDraft ?? emptyDraft();
      const evidence = mergeEvidence(ex.resumeEvidence, mem?.evidence, added);
      try {
        const res = await saveDraftSlot(
          api,
          session.masterKey,
          { draft, evidence, ...(ex.escrowedHashes.length > 0 && { escrowedHashes: ex.escrowedHashes }) },
          mem?.draft && mem.slotVersion !== undefined ? mem.slotVersion : ex.slotVersion,
        );
        await setWorkingData({ draft, evidence, slotVersion: res.version });
      } catch (e) {
        // Her draft was saved from another device or tab since: keep the files' details in memory (My story folds them
        // in and asks her which draft to keep) rather than saving this draft over that one.
        if (e instanceof SlotConflictError)
          await setWorkingData({ draft: mem?.draft ?? null, evidence: mergeEvidence(mem?.evidence, added), ...(mem?.slotVersion !== undefined && { slotVersion: mem.slotVersion }) });
        throw e;
      }
      setPersistMsg('Saved to your space and added to your draft story.');
      void existing.reload();
    } catch (e) {
      setPersistMsg(`Your files are safely uploaded, but we couldn’t add their details to your draft: ${friendlyError(e)}`);
    }
    setDescription('');
    setCapturedAt('');
    setKeepOriginal(false); // keeping originals is a choice for each time, never a standing default
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    void handleFiles(e.dataTransfer.files);
  }

  const metaByBlob = new Map((existing.data?.meta ?? []).filter((m) => m.blobId).map((m) => [m.blobId!, m]));
  const newIds = new Set(uploaded.map((u) => u.item.blobId));
  const priv = existing.data?.priv ?? emptyPrivate();
  const canKeepOriginal = existing.data?.canKeepOriginal ?? false;
  // a kept original is a second file that belongs to the file it came from, so it is not listed on its own
  const originalIds = originalBlobIds(priv.items);
  const { exhibits, missing } = numberExhibits(existing.data?.blobs ?? [], existing.data?.meta ?? [], priv.items);
  const exhibitByBlob = new Map(exhibits.map((e) => [e.blobId, e]));

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
      {existing.error && !existing.loading && <VaultStopped error={existing.error} onRetry={() => void existing.reload()} />}
      {existing.data?.stop && !existing.loading && <VaultStopped error={existing.data.stop} onRetry={() => void existing.reload()} />}

      {!existing.error && !existing.data?.stop && (
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
        <p className="small muted" data-testid="import-format-notice">
          {IMPORT_FORMAT_NOTICE} A fingerprint (SHA-256) of each file as it is kept here is recorded, so anyone can later check that file hasn’t been changed.
        </p>
        <details>
          <summary>More about fingerprints and originals</summary>
          <div className="stack">
            <p className="small muted">{FINGERPRINT_NOTE}</p>
            <label className="row" style={{ alignItems: 'flex-start' }}>
              <input type="checkbox" checked={keepOriginal && canKeepOriginal} disabled={!canKeepOriginal} onChange={(e) => setKeepOriginal(e.target.checked)} />
              <span>
                Also keep the original of the next file I add, with its hidden details, locked in my space. <span className="muted small">(Off unless you turn it on, each time.)</span>
              </span>
            </label>
            {!canKeepOriginal && (
              <p className="small" role="note" data-testid="keep-original-unavailable">
                Keeping the original isn’t available right now: {existing.data ? 'this copy of Matra keeps every save permanently, or the extra details saved about your files can’t be opened, so Matra can’t keep an original you could find again.' : 'we are still checking.'} Please keep the original on your device.
              </p>
            )}
            <p className="small muted">
              The original can show things the cleaned copy can’t, like when a photo was taken, but it also keeps any location inside your space. It only applies to photos
              that get cleaned; other files are already kept as they are. An advocate or a lawyer can help you decide.
            </p>
          </div>
        </details>
        <KeyNotice notice={NOTICES.keepOriginals} />
        {pending.map((p) => (
          <div key={p.name} className="stack">
            {p.error ? <ErrorNote>{p.name}: {p.error}</ErrorNote> : <Loading label={`${p.name}: ${p.status}`} />}
          </div>
        ))}
        {persistMsg && <p role="status">{persistMsg}</p>}
      </section>
      )}

      {uploaded.length > 0 && (
        <section className="card stack" aria-labelledby="just-added" data-testid="evidence-just-added">
          <h2 id="just-added">Added just now</h2>
          <ul className="list">
            {uploaded.map((u) => (
              <li key={u.item.id} className="evidence-row">
                {u.previewUrl ? <BlurredImage src={u.previewUrl} alt={`Preview of ${u.item.fileName}`} /> : <ThumbPlaceholder mime={u.item.mimeType} />}
                <div className="meta stack">
                  <div className="row">
                    <strong style={{ overflowWrap: 'anywhere' }}>{u.item.fileName}</strong>
                    <span className={u.item.metadataStripped ? 'badge ok' : 'badge warn'}>
                      {u.item.metadataStripped ? 'Hidden details removed' : 'Hidden details not removed'}
                    </span>
                    {(u.details?.screenshotLikely || u.item.kind === 'screenshot') && <span className="badge neutral">Screenshot</span>}
                  </div>
                  <p className="small">{u.note}</p>
                  {u.warning && <p className="small" role="note" data-testid="unstripped-warning">{u.warning}</p>}
                  {(u.details?.screenshotLikely || u.item.kind === 'screenshot') && (
                    <p className="small" data-testid="screenshot-note">
                      Its name or size matches a screenshot’s. Please keep the original messages on your phone too.
                    </p>
                  )}
                  {u.details?.originalBlobId && <p className="small">The original is also kept here, locked, with its hidden details.</p>}
                  {u.privateNote && <p className="small" role="status">{u.privateNote}</p>}
                  <p className="small muted">
                    {formatBytes(u.item.sizeBytes)} · sealed {formatDate(u.sealedAt)}
                  </p>
                  <p className="mono small muted" title="SHA-256 fingerprint of the file as kept here">
                    SHA-256: {u.item.sha256}
                  </p>
                  {u.details?.commitment && (
                    <p className="mono small muted" title="Salted fingerprint of the original file you chose; only this scrambled version was sent to Matra’s server" data-testid="commitment">
                      Salted fingerprint of the original: {u.details.commitment}
                    </p>
                  )}
                  {readableType(u.item.mimeType) && (
                    <OcrControl itemId={u.item.id} getImage={async () => u.plaintext} saved={priv.items[u.item.id]?.ocr} onSaved={() => void existing.reload()} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!existing.error && (
      <section className="card stack" aria-labelledby="in-vault" data-testid="evidence-in-space">
        <h2 id="in-vault">In your space</h2>
        {existing.loading && <Loading />}
        {existing.data && existing.data.blobs.filter((b) => !originalIds.has(b.id)).length === 0 && (
          <p className="muted">No files yet. There’s no rush — add things whenever you’re ready.</p>
        )}
        {existing.data && existing.data.blobs.filter((b) => !originalIds.has(b.id)).length > 0 && (
          <>
            {existing.data.blobs.some((b) => !originalIds.has(b.id) && !existing.data!.inFinal.has(b.id)) && (
              <p className="small card soft">
                New files join your sealed story the next time you seal it: open <Link to="/vault/story">My story</Link> and
                seal it again. Only sealed files can be shared with an attorney.
              </p>
            )}
            <ul className="list">
              {existing.data.blobs
                .filter((b) => !newIds.has(b.id) && !originalIds.has(b.id))
                .map((b) => (
                  <VaultFile
                    key={b.id}
                    blob={b}
                    meta={metaByBlob.get(b.id)}
                    inFinal={existing.data!.inFinal.has(b.id)}
                    makeUrl={makeUrl}
                    exhibit={exhibitByBlob.get(b.id)}
                    details={metaByBlob.get(b.id) ? priv.items[metaByBlob.get(b.id)!.id] : undefined}
                    originalBlob={(() => {
                      const id = metaByBlob.get(b.id) ? priv.items[metaByBlob.get(b.id)!.id]?.originalBlobId : undefined;
                      return id ? existing.data!.blobs.find((x) => x.id === id) : undefined;
                    })()}
                    onChanged={() => void existing.reload()}
                    onMakeCopy={(file, extra) => handleFiles([file], { description: extra.description, derivedFrom: metaByBlob.get(b.id)?.id })}
                  />
                ))}
            </ul>
          </>
        )}
      </section>
      )}

      {!existing.error && existing.data && missing.length > 0 && (
        <p className="small card soft" role="status" data-testid="exhibit-missing">
          Your story lists {missing.length === 1 ? 'a file' : `${missing.length} files`} that we can’t find stored right now ({missing.map((m) => m.fileName).join(', ')}).
          The numbers below only count files we can find.
        </p>
      )}
      {!existing.error && existing.data && <ExhibitSection exhibits={exhibits} />}
      {DATES_FOUND_IN_BUILD && existing.data && (
        <DatesFoundSection
          sealed={existing.data.inFinal.size > 0}
          files={exhibits.map((e) => ({ exhibit: e.number, fileName: e.fileName, ocrText: e.ocrText, metadataDates: priv.items[e.id]?.metadataDates }))}
        />
      )}
    </div>
  );
}

function VaultFile({
  blob,
  meta,
  inFinal,
  makeUrl,
  exhibit,
  details,
  originalBlob,
  onChanged,
  onMakeCopy,
}: {
  blob: BlobMeta;
  meta?: EvidenceItem;
  inFinal: boolean;
  makeUrl(b: Blob): string;
  exhibit?: Exhibit;
  details?: PrivateItem;
  originalBlob?: BlobMeta;
  onChanged(): void;
  onMakeCopy(file: File, extra: { description: string }): Promise<void>;
}) {
  const { api, session } = useRequiredSession();
  const [view, setView] = useState<{ url: string; blob: Blob; verified?: boolean; isImage: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [original, setOriginal] = useState<{ url: string } | null>(null);
  async function open() {
    setBusy(true);
    setError(null);
    try {
      const key = await blobKeyFor(blob, session.masterKey);
      const res = await openEvidence(api, key, blob.id, meta?.sha256);
      const type = meta?.mimeType ?? 'application/octet-stream';
      const plain = new Blob([res.bytes as BlobPart], { type });
      setView({ url: makeUrl(plain), blob: plain, verified: res.verified, isImage: type.startsWith('image/') });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  async function openOriginal() {
    if (!originalBlob) return;
    setBusy(true);
    setError(null);
    try {
      const key = await blobKeyFor(originalBlob, session.masterKey);
      const res = await openEvidence(api, key, originalBlob.id, details?.originalSha256);
      setOriginal({ url: makeUrl(new Blob([res.bytes as BlobPart], { type: details?.originalType || 'application/octet-stream' })) });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="evidence-row" data-testid={exhibit ? `file-${exhibit.number}` : undefined}>
      {view?.isImage ? <BlurredImage src={view.url} alt={`Preview of ${meta?.fileName ?? 'file'}`} /> : <ThumbPlaceholder mime={meta?.mimeType} />}
      <div className="meta stack">
        <div className="row">
          <strong style={{ overflowWrap: 'anywhere' }}>{exhibit ? `${exhibit.number}. ` : ''}{meta?.fileName ?? 'Locked file'}</strong>
          {inFinal ? <span className="badge sage">In your sealed story</span> : <span className="badge neutral">Not in your sealed story yet</span>}
          {(details?.screenshotLikely || meta?.kind === 'screenshot') && <span className="badge neutral">Screenshot</span>}
          {view && <VerifyBadge verified={view.verified} />}
        </div>
        <p className="small muted">
          {formatBytes(meta?.sizeBytes ?? blob.sizeBytes)} · sealed {formatDate(blob.createdAt)}
          {meta?.description && <> · {meta.description}</>}
        </p>
        {meta && <p className="mono small muted">SHA-256: {shortHash(meta.sha256, 20)}</p>}
        {meta && !meta.metadataStripped && (
          <p className="small" data-testid="unstripped-warning">
            Hidden details were not removed from this file. It is kept exactly as you added it.
          </p>
        )}
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
          {originalBlob && !original && (
            <button className="btn btn-small" onClick={() => void openOriginal()} disabled={busy}>
              Unlock the original
            </button>
          )}
          {original && (
            <a className="btn btn-small" href={original.url} download={`original-${meta?.fileName ?? 'evidence'}`}>
              Download the original
            </a>
          )}
        </div>
        {view?.isImage && meta && (
          <>
            {readableType(meta.mimeType) && (
              <OcrControl itemId={meta.id} getImage={async () => view.blob} saved={details?.ocr} onSaved={onChanged} />
            )}
            {exhibit && /^image\/(png|jpeg|webp)$/i.test(meta.mimeType) && (
              <RedactControl exhibit={exhibit} getImage={async () => view.blob} onMakeCopy={onMakeCopy} />
            )}
          </>
        )}
        {!view && meta && /^image\//i.test(meta.mimeType) && <p className="small muted">Unlock the file to read its text or make a redacted copy.</p>}
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </li>
  );
}

function ThumbPlaceholder({ mime }: { mime?: string }) {
  return <div className="thumb" aria-hidden="true">{mime?.startsWith('image/') ? <IconImage /> : <IconFile />}</div>;
}
