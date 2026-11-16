/**
 * The mark log (plan 8.11), kept ON THIS DEVICE ONLY.
 *
 * It exists so the record can show what the software pointed at and what she did about it, without anyone having to
 * re-run the software (scores near a threshold can differ across devices). It holds only Matra's fixed words, ids, numbers
 * and offsets into HER text (never the text itself, never free model output). Nothing here touches the network, localStorage
 * or the server. In this branch it lives in memory and is dropped on Quick exit and lock (onWipe). P2 decides where it is
 * persisted: the plan puts it in the draft slot and seals it with the record next to the prompt log.
 */
import { onWipe } from '../../lib/wipe';
import type { DropCounts } from './types';

export interface LoggedMark {
  markId: string;
  questionId: string;
  /** Which of her entries (P2's baseline entry id); omitted for a single text. */
  entryId?: string;
  start: number;
  end: number;
  /** ISO time the mark was shown to her (set by the UI that shows it; this branch shows nothing). */
  shownAt?: string;
}

export interface MarkRun {
  runId: string;
  engine: string;
  engineVersion: string;
  /** Model fields stay empty for the rule engine; a model path fills them (plan 8.11). */
  modelId?: string;
  modelRevision?: string;
  weightsSha256?: string[];
  backend: 'rules' | 'wasm' | 'webgpu';
  bankVersion: string;
  bankHash: string;
  narrativeHash: string;
  startedAt: string;
  finishedAt: string;
  droppedByValidator: number;
  droppedByReason: DropCounts;
  marks: LoggedMark[];
}

export interface MarkDecision {
  markId: string;
  action: 'opened' | 'dismissed' | 'marked-covered' | 'answered-anyway';
  at: string;
}

export interface MarkLog {
  addRun(run: MarkRun): void;
  addDecision(d: MarkDecision): void;
  runs(): readonly MarkRun[];
  decisions(): readonly MarkDecision[];
  /** A copy of everything, for P2 to seal with the record. */
  snapshot(): { runs: MarkRun[]; decisions: MarkDecision[] };
  clear(): void;
}

export function createMarkLog(): MarkLog {
  let runs: MarkRun[] = [];
  let decisions: MarkDecision[] = [];
  return {
    addRun: (r) => void runs.push(structuredClone(r)),
    addDecision: (d) => void decisions.push({ ...d }),
    runs: () => runs,
    decisions: () => decisions,
    snapshot: () => structuredClone({ runs, decisions }),
    clear: () => {
      runs = [];
      decisions = [];
    },
  };
}

/** The one log for this page. Dropped on Quick exit and lock. */
export const markLog: MarkLog = createMarkLog();
onWipe(() => markLog.clear());
