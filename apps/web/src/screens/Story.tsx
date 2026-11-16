import { useEffect, useRef, useState } from 'react';
import { onBeforeLock } from '../lib/beforeLock';
import { onWipe } from '../lib/wipe';
import { Link, useNavigate } from 'react-router-dom';
import type { IntakeRecord, LedgerEntry } from '@matra/shared';
import { ErrorNote, Loading, PageTitle, formatDate } from '../components/common';
import { IntakeChat, emptyDraft, type IntakeDraft } from '../integration/intakeAdapter';
import { friendlyError, useRequiredSession, type WorkingData } from '../lib/session';
import {
  DRAFT_PROBLEM_ID,
  foldInLateEvidence,
  loadSpace,
  mergeEvidence,
  resumeFrom,
  shortHash,
  uploadEvidence,
  vaultError,
  type OpenedRecord,
  type VaultProblem,
} from '../lib/vault';
import { SlotConflictError, loadDraftSlot, saveDraftSlot } from '../lib/draftSlot';
import { sealStory } from '../lib/sealStory';
import { DraftWords, VaultStopped } from '../components/UnreadableNote';
import { SaveStatus, StorySpace, safetyStage, toInterview, type SavePhase } from '../space';
import { matchContactOf } from '../intake/record';
import { PhoneStepCard } from '../components/PhoneStepCard';
import { MatchingError, lodgeMatches } from '../lib/matching';
import { matchingApi } from '../api/matching';

/** Shown if she tries to seal while two drafts disagree. */
const CONFLICT_SEAL = 'Your draft was also saved from another device or tab. Choose which draft to keep (above) before you seal.';
/** Shown if she tries to seal while writing in her draft only (part of her space didn't load cleanly). */
const DRAFT_ONLY_SEAL =
  'Sealing is off for now: something else stored for your space doesn’t match what you saved, or didn’t open. Your draft keeps saving. Try opening My story again later.';

/** Autosave to her draft slot (lib/draftSlot.ts): at most one save per minute, a moment after a meaningful change. */
const MIN_GAP_MS = 60_000;
const SETTLE_MS = 2_000;

interface Boot {
  working: WorkingData;
  previousFinalId?: string;
  hasSealed: boolean;
  /**
   * Set when she chose to keep writing in her draft although something else in her space didn't load cleanly: she
   * resumed from the draft only, it autosaves, and sealing stays off (writes that build on records need a clean load).
   */
  draftOnly?: VaultProblem[];
}

/** Her space didn't load cleanly: why, her draft to read (if it opened), and whether she may keep writing in it. */
interface Stopped {
  message: string;
  draft: IntakeDraft | null;
  keepWriting: (() => void) | null;
}

export function Story() {
  const { api, session, getWorkingData, setWorkingData, workingVersion, profile } = useRequiredSession();
  const navigate = useNavigate();
  const [boot, setBoot] = useState<Boot | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [stopped, setStopped] = useState<Stopped | null>(null);
  const workingRef = useRef<WorkingData | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const [vaultSave, setVaultSave] = useState<{ phase: SavePhase; at?: number }>({ phase: 'idle' });
  // Autosave bookkeeping. `stopped` is set by Quick exit / lock (wipe) and while sealing: nothing is saved after it.
  const auto = useRef({ lastAt: 0, lastJson: '', inFlight: null as Promise<void> | null, timer: undefined as number | undefined, failures: 0, stopped: false });
  // Her draft was saved from another device or tab after this page opened (the slot's version moved on). Saving pauses
  // until she chooses which draft to keep; nothing is merged or overwritten for her.
  const [conflict, setConflict] = useState(false);
  const conflictRef = useRef(false);
  // Sealed matching on: fingerprints of identifiers already sealed, kept in her draft slot with every save.
  const escrowedRef = useRef<string[]>([]);
  // Sealed, but the slot couldn't be marked with the seal yet: the next save that still holds exactly this draft says so.
  const sealedMarkRef = useRef<{ id: string; json: string } | null>(null);
  const [markPending, setMarkPending] = useState(false);
  const [bootRound, setBootRound] = useState(0);
  const [pastSafety, setPastSafety] = useState(false);
  const pastSafetyRef = useRef(false);
  pastSafetyRef.current = pastSafety;
  const [sealing, setSealing] = useState<string | null>(null);
  const [sealed, setSealed] = useState<{ entry: LedgerEntry; contentHash: string; escrowNote?: string; needsPhone?: boolean } | null>(null);
  // How she prefers to tell it: the open story space (default) or one question at a time.
  const [mode, setMode] = useState<'space' | 'interview'>('space');
  const [fileCount, setFileCount] = useState(0);

  // Load: in-memory working draft first; else her draft slot (or, for an account with no slot yet, its older records).
  // Fails closed (lib/vault.ts loadSpace): if any saved version or her draft didn't load, or didn't match what she
  // saved, nothing here resumes from records or seals; she sees why, and Try again. If her draft itself opened, she can
  // read it there, and may choose to keep writing in it (draft only): see `draftOnly`.
  useEffect(() => {
    let alive = true;
    setBootError(null);
    setStopped(null);
    (async () => {
      const [mem, { vault, slot, problems }] = await Promise.all([getWorkingData(), loadSpace(api, session.masterKey, { allowPartial: true })]);
      if (!alive) return;
      const begin = (working: WorkingData, escrowed: string[], final: OpenedRecord | undefined, draftOnly?: VaultProblem[]) => {
        workingRef.current = working;
        escrowedRef.current = escrowed;
        if (!mem?.draft && slot.slot && working.draft) {
          // Resumed from her slot: that is what is saved, so there is nothing new to save yet.
          auto.current.lastJson = JSON.stringify([working.draft, working.evidence]);
          setVaultSave({ phase: 'saved', at: Date.parse(slot.slot.value.savedAt) });
        }
        setPastSafety(!!working.draft && safetyStage(working.draft) === 'done');
        setMode(working.draft?.space?.mode === 'interview' ? 'interview' : 'space');
        setFileCount(working.evidence.length);
        setBoot({ working, previousFinalId: final?.meta.id, hasSealed: !!final, ...(draftOnly && { draftOnly }) });
      };
      if (problems.length) {
        // Her draft itself opened (it decrypted under her key and is a draft) only if no problem is about it. Then she
        // may keep writing in it: it resumes from the draft alone (never from records that may be older), autosaves
        // with compare-and-swap, and sealing stays off. Her next save also drops a `sealedRecordId` the server no
        // longer lists, so that problem clears by itself (a main database restored from an older backup).
        const draftOpened = !slot.unreadable && !problems.some((p) => p.id === DRAFT_PROBLEM_ID);
        const draft = draftOpened ? (mem?.draft ?? slot.slot?.value.draft ?? null) : null;
        setStopped({
          message: vaultError(problems).message,
          draft,
          keepWriting: draft
            ? () => {
                setStopped(null);
                begin(
                  {
                    draft,
                    evidence: mergeEvidence(slot.slot?.value.evidence, mem?.evidence),
                    slotVersion: mem?.draft && mem.slotVersion !== undefined ? mem.slotVersion : slot.version,
                  },
                  slot.slot?.value.escrowedHashes ?? [],
                  undefined,
                  problems,
                );
              }
            : null,
        });
        return;
      }
      const resume = resumeFrom(slot.slot, vault);
      const final = resume.final;
      // A new sealed version keeps the evidence of the one it replaces.
      const sealedEvidence = final?.payload.record?.evidence;
      let working: WorkingData;
      if (mem?.draft)
        working = { ...mem, evidence: mergeEvidence(sealedEvidence, mem.evidence), slotVersion: mem.slotVersion !== undefined ? mem.slotVersion : slot.version };
      else
        working = {
          draft: resume.draft ?? emptyDraft(),
          evidence: mergeEvidence(sealedEvidence, resume.evidence, mem?.evidence),
          slotVersion: slot.version,
        };
      begin(working, resume.escrowedHashes, final);
    })().catch((e) => alive && setBootError(friendlyError(e)));
    return () => {
      alive = false;
      window.clearTimeout(saveTimer.current);
    };
  }, [api, session.masterKey, getWorkingData, bootRound]);

  // A file added on the Evidence page can finish saving after she has already come back to her story (the upload
  // carries on when she leaves that page). Fold its details in when they land, so the file count is right and the next
  // save or seal keeps the file.
  useEffect(() => {
    if (!boot) return;
    let alive = true;
    getWorkingData().then(
      (mem) => {
        const next = alive && workingRef.current ? foldInLateEvidence(workingRef.current, mem) : null;
        if (!next) return;
        workingRef.current = next;
        setFileCount(next.evidence.length);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [boot, workingVersion, getWorkingData]);

  /**
   * Save the encrypted draft to her vault now (if anything changed since the last save).
   * Never runs after Quick exit / lock, or while sealing.
   */
  async function saveToVault(): Promise<void> {
    const a = auto.current;
    if (a.stopped || conflictRef.current) return;
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
        const res = await saveDraftSlot(
          api,
          session.masterKey,
          {
            draft: w.draft!,
            evidence: w.evidence,
            ...(escrowedRef.current.length > 0 && { escrowedHashes: escrowedRef.current }),
            // still exactly what she sealed (the mark after sealing didn't land): say so in the slot
            ...(sealedMarkRef.current?.json === json && { sealedRecordId: sealedMarkRef.current.id }),
          },
          w.slotVersion ?? null,
        );
        if (a.stopped) return;
        a.lastJson = json;
        a.lastAt = Date.now();
        a.failures = 0;
        workingRef.current = { ...(workingRef.current ?? w), slotVersion: res.version };
        await setWorkingData(workingRef.current);
        setVaultSave({ phase: 'saved', at: a.lastAt });
        if (sealedMarkRef.current) {
          sealedMarkRef.current = null;
          setMarkPending(false);
        }
      } catch (e) {
        if (a.stopped) return;
        if (e instanceof SlotConflictError) {
          conflictRef.current = true;
          setConflict(true);
          setVaultSave((v) => ({ ...v, phase: 'idle' }));
          return;
        }
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
    if (a.stopped || conflictRef.current) return;
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
    if (boot.draftOnly) throw new Error(DRAFT_ONLY_SEAL);
    if (conflictRef.current) throw new Error(CONFLICT_SEAL);
    window.clearTimeout(saveTimer.current);
    // No draft autosave while sealing: sealStory saves the draft itself, first, with compare-and-swap.
    const a = auto.current;
    a.stopped = true;
    window.clearTimeout(a.timer);
    a.timer = undefined;
    while (a.inFlight) await a.inFlight;
    const w = workingRef.current;
    if (!w?.draft) {
      a.stopped = false;
      throw new Error('Your story is still opening.');
    }
    const record: IntakeRecord = { ...intake, evidence: mergeEvidence(intake.evidence, w.evidence) };
    let escrowNote: string | undefined;
    let needsPhone = false;
    // Sealed matching only in a build that has it (MATRA_MATCHING=on); a pilot build never sets escrowOptIn either.
    const wantsMatching =
      __MATRA_MATCHING__ && record.perpetrators.some((p) => p.escrowOptIn && p.identifiers.some((i) => i.kind !== 'full_name' && i.kind !== 'other'));
    try {
      const res = await sealStory({
        api,
        masterKey: session.masterKey,
        draft: w.draft,
        evidence: w.evidence,
        record,
        slotVersion: w.slotVersion ?? null,
        escrowed: escrowedRef.current,
        previousFinalId: boot.previousFinalId,
        // her draft is saved now: if sealing fails after this, her next save must build on this version
        onDraftSaved: (version) => {
          if (workingRef.current) workingRef.current = { ...workingRef.current, slotVersion: version };
          a.lastJson = JSON.stringify([w.draft, w.evidence]);
          a.lastAt = Date.now();
        },
        onStep: (step) =>
          setSealing(
            step === 'saving'
              ? 'Saving your draft first…'
              : step === 'matching'
                ? 'Sealing the names you chose for escrow…'
                : step === 'sealing'
                  ? 'Encrypting and sealing your account…'
                  : 'Keeping your draft so you can add to it later…',
          ),
        lodge: wantsMatching
          ? async (before) => {
              try {
                return await lodgeMatches(matchingApi(api), session.masterKey, record, before, matchContactOf(w.draft!));
              } catch (e) {
                // A sealed match waits for her phone confirmation (W13): a calm next step, not an error.
                if (e instanceof MatchingError && e.code === 'phone_verification_required') needsPhone = true;
                else escrowNote = `Your account was sealed, but the sealed match could not be set up right now (${friendlyError(e)}). You can try again later.`;
                return before;
              }
            }
          : undefined,
      });
      escrowedRef.current = res.escrowed;
      if (res.marked) {
        await setWorkingData(null);
        workingRef.current = null;
      } else {
        // Sealed, and her slot already holds every word (saved first), but it doesn't say which seal it became yet.
        // Keep her working copy and keep saving it, so the next save marks it; never drop it.
        const json = JSON.stringify([w.draft, record.evidence]);
        workingRef.current = { ...w, evidence: record.evidence, slotVersion: res.slotVersion };
        await setWorkingData(workingRef.current);
        sealedMarkRef.current = { id: res.sealed.record.id, json };
        a.lastJson = '';
        a.stopped = false;
        setMarkPending(true);
        if (res.markProblem === 'conflict') {
          conflictRef.current = true;
          setConflict(true);
        } else scheduleSave(30_000);
      }
      setSealed({ entry: res.sealed.ledgerEntry, contentHash: res.sealed.record.contentHash, escrowNote, needsPhone });
    } catch (e) {
      a.stopped = false; // nothing sealed: keep her draft saving
      if (e instanceof SlotConflictError) {
        conflictRef.current = true;
        setConflict(true);
        throw new Error(CONFLICT_SEAL);
      }
      throw new Error(friendlyError(e));
    } finally {
      setSealing(null);
    }
  }

  /** Her choice after a conflict: open the draft saved elsewhere (this page's changes since then are not kept). */
  async function openNewerDraft() {
    conflictRef.current = false;
    setConflict(false);
    sealedMarkRef.current = null;
    setMarkPending(false);
    setSealed(null);
    auto.current = { ...auto.current, lastJson: '', lastAt: 0, failures: 0 };
    workingRef.current = null;
    await setWorkingData(null);
    setBoot(null);
    setBootRound((n) => n + 1);
  }

  /** Her other choice after a conflict: this page's draft replaces the one saved elsewhere. */
  async function keepThisDraft() {
    try {
      const { version } = await loadDraftSlot(api, session.masterKey);
      if (workingRef.current) workingRef.current = { ...workingRef.current, slotVersion: version };
      conflictRef.current = false;
      setConflict(false);
      auto.current.lastJson = '';
      await saveToVault();
    } catch (e) {
      setBootError(friendlyError(e));
    }
  }


  const statusLine = <SaveStatus phase={vaultSave.phase} at={vaultSave.at} onSaveNow={() => void saveToVault()} />;

  const conflictCard = conflict && (
    <div className="card soft stack" data-testid="story-conflict" role="status">
      <p className="small" style={{ margin: 0 }}>
        Your draft was also saved from another device or tab after this page opened, so saving here is paused. You can
        open that newer draft (what you wrote on this page since then won’t be kept in it; files you added stay in your
        Evidence list, and anything you sealed stays sealed), or keep this page’s version (it replaces the other one).
      </p>
      <div className="row">
        <button type="button" className="btn btn-small" onClick={() => void openNewerDraft()}>
          Open the newer draft
        </button>
        <button type="button" className="btn btn-small btn-quiet" onClick={() => void keepThisDraft()}>
          Keep this page’s version
        </button>
      </div>
    </div>
  );

  if (sealed) {
    return (
      <div className="stack-lg">
        <PageTitle>Your account is sealed</PageTitle>
        {conflictCard}
        {markPending && !conflict && (
          <div className="card warn stack" data-testid="seal-mark-pending" role="status">
            <p className="small" style={{ margin: 0 }}>
              Your account is sealed, and your draft is saved. We couldn’t yet note on your draft which sealed version it
              became, so this page keeps it and tries again. You can also try now.
            </p>
            <div className="space-root">{statusLine}</div>
          </div>
        )}
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
        {__MATRA_MATCHING__ && sealed.escrowNote && <div className="card warn">{sealed.escrowNote}</div>}
        {__MATRA_MATCHING__ && sealed.needsPhone && <PhoneStepCard />}
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
      {bootError && boot && <ErrorNote>{bootError}</ErrorNote>}
      {bootError && !boot && <VaultStopped error={bootError} onRetry={() => setBootRound((n) => n + 1)} />}
      {stopped && (
        <>
          <VaultStopped error={stopped.message} onRetry={() => setBootRound((n) => n + 1)} />
          {stopped.keepWriting && (
            <div className="card soft stack" data-testid="story-keep-writing">
              <p className="small" style={{ margin: 0 }}>
                Your draft itself opened as you saved it. You can keep writing in it, and it keeps saving. Sealing and
                sharing stay off until everything else in your space matches what you saved again.
              </p>
              <div>
                <button type="button" className="btn btn-small" onClick={stopped.keepWriting}>
                  Keep writing in your draft
                </button>
              </div>
            </div>
          )}
          {stopped.draft && <DraftWords draft={stopped.draft} />}
        </>
      )}
      {!boot && !bootError && !stopped && <Loading label="Opening your draft…" />}
      {boot && (
        <>
          {boot.draftOnly && (
            <p className="card warn small" role="status" data-testid="story-draft-only">
              You’re writing in your draft only. Something else stored for your space doesn’t match what you saved, or
              didn’t open, so sealing and sharing are off for now. Your draft keeps saving.
            </p>
          )}
          {conflictCard}
          {boot.hasSealed && (
            <p className="card soft small">
              You already have a sealed account. If you seal again, it’s kept as a new version — the earlier one stays
              unchanged, so the record of when you said what is preserved.
            </p>
          )}
          {mode === 'space' ? (
            <StorySpace
              key={`space-${bootRound}`}
              initialDraft={workingRef.current?.draft ?? boot.working.draft ?? undefined}
              onDraftChange={onDraftChange}
              onComplete={onComplete}
              onAddFiles={onAddFiles}
              fileCount={fileCount}
              name={profile?.preferredName}
              onSwitchToInterview={(d) => switchMode(d, 'interview')}
              onCheckpoint={onCheckpoint}
              hasSealed={boot.hasSealed}
              saveStatus={conflict ? undefined : statusLine}
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
              {pastSafety && !conflict && <div className="space-root space-status-row">{statusLine}</div>}
              {fileCount > 0 && <p className="small muted">{fileCount} evidence file(s) will be attached when you seal.</p>}
              <IntakeChat
                key={`interview-${bootRound}`}
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

