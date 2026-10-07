import { useEffect, useRef, useState } from 'react';
import { onBeforeLock } from '../lib/beforeLock';
import { onWipe } from '../lib/wipe';
import { Link, useNavigate } from 'react-router-dom';
import type { IntakeRecord, LedgerEntry } from '@matra/shared';
import { ErrorNote, Loading, PageTitle, formatDate } from '../components/common';
import { IntakeChat, emptyDraft, type IntakeDraft } from '../integration/intakeAdapter';
import { friendlyError, useRequiredSession, type WorkingData } from '../lib/session';
import { latestOf, loadVault, mergeEvidence, resumeFrom, sealPayload, shortHash, uploadEvidence } from '../lib/vault';
import { SaveStatus, StorySpace, safetyStage, toInterview, type SavePhase } from '../space';
import { lodgeMatches } from '../space/adapters';
import { matchContactOf } from '../intake/record';

/** Autosave to her vault: at most one save per minute, a moment after a meaningful change. */
const MIN_GAP_MS = 60_000;
const SETTLE_MS = 2_000;

interface Boot {
  working: WorkingData;
  previousFinalId?: string;
  previousEscrowed: string[];
  hasSealed: boolean;
}

export function Story() {
  const { api, session, getWorkingData, setWorkingData, profile } = useRequiredSession();
  const navigate = useNavigate();
  const [boot, setBoot] = useState<Boot | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const workingRef = useRef<WorkingData | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const [vaultSave, setVaultSave] = useState<{ phase: SavePhase; at?: number }>({ phase: 'idle' });
  // Autosave bookkeeping. `stopped` is set by Quick exit / lock (wipe) and while sealing: nothing is saved after it.
  const auto = useRef({ lastAt: 0, lastJson: '', inFlight: null as Promise<void> | null, timer: undefined as number | undefined, failures: 0, stopped: false });
  const [pastSafety, setPastSafety] = useState(false);
  const pastSafetyRef = useRef(false);
  pastSafetyRef.current = pastSafety;
  const [sealing, setSealing] = useState<string | null>(null);
  const [sealed, setSealed] = useState<{ entry: LedgerEntry; contentHash: string; escrowNote?: string } | null>(null);
  // How she prefers to tell it: the open story space (default) or one question at a time.
  const [mode, setMode] = useState<'space' | 'interview'>('space');
  const [fileCount, setFileCount] = useState(0);

  // Load: in-memory working draft first; else the latest draft saved in the vault.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [mem, vault] = await Promise.all([getWorkingData(), loadVault(api, session.masterKey)]);
      const { draft: resumeDraft, draftRecord, final } = resumeFrom(vault);
      // A new sealed version keeps the evidence of the one it replaces.
      const sealedEvidence = final?.payload.record?.evidence;
      let working: WorkingData;
      if (mem?.draft) working = { ...mem, evidence: mergeEvidence(sealedEvidence, mem.evidence) };
      else
        working = {
          draft: resumeDraft ?? emptyDraft(),
          evidence: mergeEvidence(sealedEvidence, draftRecord?.payload.evidence, mem?.evidence),
          savedDraftRecordId: mem?.savedDraftRecordId ?? draftRecord?.meta.id ?? latestOf(vault, 'draft')?.meta.id,
        };
      if (!alive) return;
      workingRef.current = working;
      if (!mem?.draft && draftRecord && working.draft) {
        // Resumed from the vault: that is what is saved, so there is nothing new to save yet.
        auto.current.lastJson = JSON.stringify([working.draft, working.evidence]);
        setVaultSave({ phase: 'saved', at: Date.parse(draftRecord.meta.createdAt) });
      }
      setPastSafety(!!working.draft && safetyStage(working.draft) === 'done');
      setMode(working.draft?.space?.mode === 'interview' ? 'interview' : 'space');
      setFileCount(working.evidence.length);
      setBoot({
        working,
        previousFinalId: final?.meta.id,
        previousEscrowed: final?.payload.escrowedHashes ?? [],
        hasSealed: !!final,
      });
    })().catch((e) => alive && setBootError(friendlyError(e)));
    return () => {
      alive = false;
      window.clearTimeout(saveTimer.current);
    };
  }, [api, session.masterKey, getWorkingData]);

  /**
   * Save the encrypted draft to her vault now (if anything changed since the last save).
   * Never runs after Quick exit / lock, or while sealing.
   */
  async function saveToVault(): Promise<void> {
    const a = auto.current;
    if (a.stopped) return;
    window.clearTimeout(a.timer);
    a.timer = undefined;
    while (a.inFlight) await a.inFlight;
    if (a.stopped) return;
    const w = workingRef.current;
    if (!w?.draft) return;
    const json = JSON.stringify([w.draft, w.evidence]);
    if (json === a.lastJson) {
      if (a.lastAt) setVaultSave({ phase: 'saved', at: a.lastAt });
      return;
    }
    setVaultSave((v) => ({ ...v, phase: 'saving' }));
    const run = (async () => {
      try {
        const res = await sealPayload(
          api,
          session.masterKey,
          { kind: 'draft', draft: w.draft!, evidence: w.evidence, savedAt: new Date().toISOString() },
          w.savedDraftRecordId,
        );
        if (a.stopped) return;
        a.lastJson = json;
        a.lastAt = Date.now();
        a.failures = 0;
        workingRef.current = { ...(workingRef.current ?? w), savedDraftRecordId: res.record.id };
        await setWorkingData(workingRef.current);
        setVaultSave({ phase: 'saved', at: a.lastAt });
      } catch {
        if (a.stopped) return;
        a.failures += 1;
        setVaultSave((v) => ({ ...v, phase: 'error' }));
        scheduleSave(Math.min(5 * 60_000, 30_000 * a.failures)); // "we'll try again"
      }
    })();
    a.inFlight = run;
    try {
      await run;
    } finally {
      a.inFlight = null;
    }
  }
  const saveRef = useRef(saveToVault);
  saveRef.current = saveToVault;

  /** Coalesce: one pending save at a time, a moment after the change and at least a minute after the last save. */
  function scheduleSave(delay?: number) {
    const a = auto.current;
    if (a.stopped) return;
    if (a.timer !== undefined) {
      if (delay === undefined) return;
      window.clearTimeout(a.timer);
    }
    const d = delay ?? Math.max(SETTLE_MS, a.lastAt + MIN_GAP_MS - Date.now());
    a.timer = window.setTimeout(() => {
      a.timer = undefined;
      void saveRef.current();
    }, d);
  }

  // Quick exit / lock wipes everything: stop autosaving at once (before anything unmounts).
  useEffect(
    () =>
      onWipe(() => {
        auto.current.stopped = true;
        window.clearTimeout(auto.current.timer);
        window.clearTimeout(saveTimer.current);
      }),
    [],
  );
  // Save on leaving the page, when the tab is hidden, and before a calm "Lock & sign out".
  useEffect(() => {
    const flush = () => (pastSafetyRef.current ? saveRef.current() : Promise.resolve());
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    document.addEventListener('visibilitychange', onHide);
    const off = onBeforeLock(flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      off();
      window.clearTimeout(auto.current.timer);
      auto.current.timer = undefined;
      void flush();
    };
  }, []);

  function onDraftChange(d: IntakeDraft) {
    const next = { ...(workingRef.current ?? { evidence: [] }), draft: d } as WorkingData;
    workingRef.current = next;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void setWorkingData(next), 400);
    const past = safetyStage(d) === 'done';
    if (past !== pastSafetyRef.current) {
      pastSafetyRef.current = past;
      setPastSafety(past);
    }
    // One question at a time: every answered step is a checkpoint (the minute between saves keeps it calm).
    if (past && d.space?.mode === 'interview') scheduleSave();
  }

  /** The story space reached a meaningful moment (words added or changed, a suggestion kept, a page saved). */
  function onCheckpoint() {
    if (pastSafetyRef.current) scheduleSave();
  }

  /** Files added from the story space: stripped + encrypted on this device, attached to the draft, saved to the vault. */
  async function onAddFiles(files: File[]): Promise<number> {
    const added = [];
    let lastError: unknown;
    for (const file of files) {
      try {
        added.push((await uploadEvidence(api, session.masterKey, file)).item);
      } catch (e) {
        lastError = e;
      }
    }
    if (!added.length) throw new Error(friendlyError(lastError));
    const w = workingRef.current ?? { draft: null, evidence: [] };
    const next: WorkingData = { ...w, evidence: mergeEvidence(w.evidence, added) };
    workingRef.current = next;
    setFileCount(next.evidence.length);
    await setWorkingData(next);
    // Keep the file details with her draft in the vault right away, so they survive signing out.
    // (On failure the status line says so and tries again.)
    if (next.draft) await saveToVault();
    return added.length;
  }

  function switchMode(d: IntakeDraft, to: 'space' | 'interview') {
    window.clearTimeout(saveTimer.current);
    const draft = to === 'interview' ? toInterview(d) : { ...d, space: { ...(d.space ?? {}), mode: 'space' as const } };
    const next = { ...(workingRef.current ?? { evidence: [] }), draft } as WorkingData;
    workingRef.current = next;
    void setWorkingData(next);
    setMode(to);
    window.scrollTo?.({ top: 0 });
  }

  async function onEvidenceRequest() {
    window.clearTimeout(saveTimer.current);
    if (workingRef.current) await setWorkingData(workingRef.current);
    navigate('/vault/evidence', { state: { from: 'story' } });
  }

  /**
   * Resolves only once the server has confirmed the sealed record (so the intake never says "sealed" early).
   * Rejects with a friendly message on failure; the intake then offers "Try again" with her answers intact.
   */
  async function onComplete(intake: IntakeRecord): Promise<void> {
    if (!boot) throw new Error('Your vault is still opening.');
    window.clearTimeout(saveTimer.current);
    // No draft autosave while (or after) sealing: the sealed version must be the newest.
    const a = auto.current;
    a.stopped = true;
    window.clearTimeout(a.timer);
    a.timer = undefined;
    while (a.inFlight) await a.inFlight;
    try {
      const record: IntakeRecord = {
        ...intake,
        evidence: mergeEvidence(intake.evidence, workingRef.current?.evidence),
      };
      let escrowed = boot.previousEscrowed;
      let escrowNote: string | undefined;
      if (record.perpetrators.some((p) => p.escrowOptIn && p.identifiers.some((i) => i.kind !== 'full_name' && i.kind !== 'other'))) {
        setSealing('Sealing the names you chose for escrow…');
        try {
          escrowed = await lodgeMatches(
            api,
            session.masterKey,
            record,
            boot.previousEscrowed,
            workingRef.current?.draft ? matchContactOf(workingRef.current.draft) : undefined,
          );
        } catch (e) {
          escrowNote = `Your account was sealed, but the sealed match could not be set up right now (${friendlyError(e)}). You can try again later.`;
        }
      }
      setSealing('Encrypting and sealing your account…');
      const res = await sealPayload(
        api,
        session.masterKey,
        // the answers are kept too, so she can add to this version later without starting over
        { kind: 'final', record, draft: workingRef.current?.draft ?? undefined, escrowedHashes: escrowed, savedAt: new Date().toISOString() },
        boot.previousFinalId,
      );
      await setWorkingData(null);
      workingRef.current = null;
      setSealed({ entry: res.ledgerEntry, contentHash: res.record.contentHash, escrowNote });
    } catch (e) {
      a.stopped = false; // nothing sealed: keep her draft saving
      throw new Error(friendlyError(e));
    } finally {
      setSealing(null);
    }
  }

  const statusLine = <SaveStatus phase={vaultSave.phase} at={vaultSave.at} onSaveNow={() => void saveToVault()} />;

  if (sealed) {
    return (
      <div className="stack-lg">
        <PageTitle>Your account is sealed</PageTitle>
        <div className="card soft stack" role="status">
          <p>
            <strong>Thank you for telling it.</strong> It’s encrypted, stored, and sealed with a timestamp. Nothing has
            been sent to anyone.
          </p>
          <p className="small">
            Sealed {formatDate(sealed.entry.timestamp)} · ledger entry #{sealed.entry.seq}
          </p>
          <p className="mono muted small">{shortHash(sealed.contentHash, 16)}</p>
        </div>
        {sealed.escrowNote && <div className="card warn">{sealed.escrowNote}</div>}
        <div className="card stack">
          <h2>What you can do next — only if and when you want</h2>
          <div className="row">
            <Link className="btn" to="/vault/brief">Prepare an incident summary</Link>
            <Link className="btn" to="/vault/share">Share with a verified attorney</Link>
            <Link className="btn btn-quiet" to="/vault">Home</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <PageTitle>My story</PageTitle>
      {bootError && <ErrorNote>{bootError}</ErrorNote>}
      {!boot && !bootError && <Loading label="Opening your draft…" />}
      {boot && (
        <>
          {boot.hasSealed && (
            <p className="card soft small">
              You already have a sealed account. If you seal again, it’s kept as a new version — the earlier one stays
              unchanged, so the record of when you said what is preserved.
            </p>
          )}
          {mode === 'space' ? (
            <StorySpace
              key="space"
              initialDraft={workingRef.current?.draft ?? boot.working.draft ?? undefined}
              onDraftChange={onDraftChange}
              onComplete={onComplete}
              onAddFiles={onAddFiles}
              fileCount={fileCount}
              name={profile?.preferredName}
              onSwitchToInterview={(d) => switchMode(d, 'interview')}
              onCheckpoint={onCheckpoint}
              hasSealed={boot.hasSealed}
              saveStatus={statusLine}
            />
          ) : (
            <>
              <p className="small">
                <button
                  type="button"
                  className="btn btn-quiet btn-small"
                  onClick={() => switchMode(workingRef.current?.draft ?? emptyDraft(), 'space')}
                >
                  ← Back to the open story space
                </button>
              </p>
              {pastSafety && <div className="space-root space-status-row">{statusLine}</div>}
              {fileCount > 0 && <p className="small muted">{fileCount} evidence file(s) will be attached when you seal.</p>}
              <IntakeChat
                key="interview"
                initialDraft={workingRef.current?.draft ?? boot.working.draft ?? undefined}
                onDraftChange={onDraftChange}
                onComplete={onComplete}
                onRequestEvidenceUpload={() => void onEvidenceRequest()}
              />
            </>
          )}
          {sealing && <Loading label={sealing} />}
        </>
      )}
    </div>
  );
}
