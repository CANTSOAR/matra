import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { IntakeRecord, LedgerEntry } from '@matra/shared';
import { ErrorNote, Loading, PageTitle, formatDate } from '../components/common';
import { IntakeChat, emptyDraft, type IntakeDraft } from '../integration/intakeAdapter';
import { friendlyError, useRequiredSession, type WorkingData } from '../lib/session';
import { latestOf, loadVault, lodgeEscrow, mergeEvidence, resumeFrom, sealPayload, shortHash } from '../lib/vault';

interface Boot {
  working: WorkingData;
  previousFinalId?: string;
  previousEscrowed: string[];
  hasSealed: boolean;
}

export function Story() {
  const { api, session, getWorkingData, setWorkingData } = useRequiredSession();
  const navigate = useNavigate();
  const [boot, setBoot] = useState<Boot | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const workingRef = useRef<WorkingData | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const [saveState, setSaveState] = useState<{ busy: boolean; msg?: string; error?: string }>({ busy: false });
  const [sealing, setSealing] = useState<string | null>(null);
  const [sealed, setSealed] = useState<{ entry: LedgerEntry; contentHash: string; escrowNote?: string } | null>(null);

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

  function onDraftChange(d: IntakeDraft) {
    const next = { ...(workingRef.current ?? { evidence: [] }), draft: d } as WorkingData;
    workingRef.current = next;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void setWorkingData(next), 400);
  }

  async function saveToVault() {
    const w = workingRef.current;
    if (!w?.draft) return;
    setSaveState({ busy: true });
    try {
      const res = await sealPayload(
        api,
        session.masterKey,
        { kind: 'draft', draft: w.draft, evidence: w.evidence, savedAt: new Date().toISOString() },
        w.savedDraftRecordId,
      );
      const next = { ...w, savedDraftRecordId: res.record.id };
      workingRef.current = next;
      await setWorkingData(next);
      setSaveState({ busy: false, msg: `Draft saved to your vault at ${formatDate(res.ledgerEntry.timestamp)}. You can come back to it any time.` });
    } catch (e) {
      setSaveState({ busy: false, error: friendlyError(e) });
    }
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
    try {
      const record: IntakeRecord = {
        ...intake,
        evidence: mergeEvidence(intake.evidence, workingRef.current?.evidence),
      };
      let escrowed = boot.previousEscrowed;
      let escrowNote: string | undefined;
      if (record.perpetrators.some((p) => p.escrowOptIn && p.identifiers.length)) {
        setSealing('Sealing the names you chose for escrow…');
        try {
          escrowed = await lodgeEscrow(api, session.masterKey, record, boot.previousEscrowed);
        } catch (e) {
          escrowNote = `Your account was sealed, but escrow could not be completed right now (${friendlyError(e)}). You can try again later.`;
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
      throw new Error(friendlyError(e));
    } finally {
      setSealing(null);
    }
  }

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
            <Link className="btn btn-quiet" to="/vault">Back to your vault</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <PageTitle lead="Go at your own pace. You can skip anything, take breaks, and save a draft at any time. Your words are never rewritten.">
        Your account
      </PageTitle>
      {bootError && <ErrorNote>{bootError}</ErrorNote>}
      {!boot && !bootError && <Loading label="Opening your draft…" />}
      {boot && (
        <>
          {boot.hasSealed && (
            <p className="card soft small">
              You already have a sealed account. If you finish again, it’s sealed as a new version — the earlier one is kept
              unchanged, so the record of when you said what is preserved.
            </p>
          )}
          {boot.working.evidence.length > 0 && (
            <p className="small muted">{boot.working.evidence.length} evidence file(s) will be attached when you seal.</p>
          )}
          <IntakeChat
            initialDraft={boot.working.draft ?? undefined}
            onDraftChange={onDraftChange}
            onComplete={onComplete}
            onRequestEvidenceUpload={() => void onEvidenceRequest()}
          />
          <div className="card stack">
            <div className="row">
              <button className="btn" type="button" onClick={() => void saveToVault()} disabled={saveState.busy}>
                {saveState.busy ? 'Saving…' : 'Save draft to my vault'}
              </button>
              <Link to="/vault/evidence" onClick={() => workingRef.current && void setWorkingData(workingRef.current)}>
                Add evidence
              </Link>
            </div>
            <p className="small muted">
              While you’re signed in, your draft is kept encrypted in this tab’s memory only. Saving it to your vault lets
              you continue on another day.
            </p>
            {saveState.msg && <p role="status">{saveState.msg}</p>}
            {saveState.error && <ErrorNote>{saveState.error}</ErrorNote>}
          </div>
          {sealing && <Loading label={sealing} />}
        </>
      )}
    </div>
  );
}
