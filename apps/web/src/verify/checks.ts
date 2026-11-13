/**
 * Plain-language integrity checks, shared by the "Check a file" page (/verify) and the attorney's verification panel.
 * Each check turns hashes computed on this device, plus a ledger proof from the server (POST /api/ledger/proof,
 * re-checked here with @matra/crypto checkLedgerProof), into one green or red line with technical details underneath.
 * Pure functions: no network, no DOM (unit-tested in checks.test.ts).
 */
import { checkLedgerProof } from '@matra/crypto';
import type { LedgerEntry, LedgerProofResponse } from '@matra/shared';

export type Tone = 'ok' | 'bad' | 'info';
export interface CheckLine {
  id: 'account' | 'evidence' | 'chain' | 'files';
  tone: Tone;
  text: string;
  details: string[];
}

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The ledger's record.sealed entry for this exact record ciphertext hash, if the proof holds one. */
export function sealedEntry(proof: Pick<LedgerProofResponse, 'entries'> | undefined, hash: string | undefined, type = 'record.sealed'): LedgerEntry | undefined {
  return hash ? proof?.entries.find((e) => e.contentHash === hash && e.type === type) : undefined;
}

/**
 * The sealed account. `recomputed` is true when this device re-hashed the ciphertext itself (attorney portal); false
 * when the hash comes from a summary PDF (the checker cannot read the account).
 */
export function accountCheck(a: {
  recordId?: string;
  recordContentHash?: string;
  proof?: Pick<LedgerProofResponse, 'entries'>;
  recomputed: boolean;
}): CheckLine {
  if (!a.recordContentHash)
    return {
      id: 'account',
      tone: 'info',
      text: 'This summary was made before the account was sealed, so there is no ledger entry to check it against.',
      details: [],
    };
  const entry = sealedEntry(a.proof, a.recordContentHash);
  const hashLine = `Record ciphertext SHA-256: ${a.recordContentHash}${a.recomputed ? ' (recomputed on this device)' : ' (as listed in the PDF)'}`;
  if (!entry)
    return {
      id: 'account',
      tone: 'bad',
      text: a.recomputed
        ? 'This account does not match what was sealed. Treat it as unverified.'
        : 'We couldn’t find the sealed account behind this summary in the ledger. The PDF may have been changed, or it comes from a different Matra service.',
      details: [hashLine, 'No ledger entry seals this exact hash.'],
    };
  const details = [
    hashLine,
    `Ledger entry #${entry.seq} (${entry.type}), id ${entry.id}`,
    `Sealed (server receipt time): ${entry.timestamp}`,
    `Entry hash ${entry.entryHash}, previous ${entry.prevHash}`,
  ];
  if (a.recordId && entry.subjectId !== a.recordId)
    return {
      id: 'account',
      tone: 'bad',
      text: 'The ledger entry for this hash belongs to a different record. Treat this summary as unverified.',
      details: [...details, `Record named: ${a.recordId}; ledger entry is for record ${entry.subjectId}`],
    };
  return {
    id: 'account',
    tone: 'ok',
    text: a.recomputed
      ? `This account has not changed since it was sealed on ${when(entry.timestamp)}.`
      : `The sealed account behind this summary is in the ledger: sealed on ${when(entry.timestamp)}, unchanged since.`,
    details: a.recomputed
      ? details
      : [...details, 'This checks the sealed account named in the PDF. It cannot read the account, so it does not check the printed words; the attorney portal does.'],
  };
}

export interface EvidenceExpected {
  fileName: string;
  /** SHA-256 of the file as sealed (after metadata removal), from the sealed account or the PDF's inventory */
  sha256: string;
}
export interface FileHash {
  name: string;
  sha256: string;
}

/**
 * Files dropped on the checker, against the evidence the summary lists. Matched by content (hash), not by name.
 * Returns the evidence line and, if any dropped file matches nothing, a line naming those files.
 */
export function evidenceCheck(expected: EvidenceExpected[], files: FileHash[]): CheckLine[] {
  if (!expected.length) {
    return files.length
      ? [{ id: 'files', tone: 'bad', text: `This summary lists no evidence files, so ${plural(files.length, 'file')} can’t be matched to it.`, details: files.map((f) => `${f.name}: ${f.sha256}`) }]
      : [];
  }
  const dropped = new Map(files.map((f) => [f.sha256, f]));
  const matched = expected.filter((e) => dropped.has(e.sha256));
  const listed = new Set(expected.map((e) => e.sha256));
  const unknown = files.filter((f) => !listed.has(f.sha256));
  const details = expected.map((e) => `${dropped.has(e.sha256) ? '✓' : '·'} ${e.fileName}: ${e.sha256}${dropped.has(e.sha256) ? ` (matches ${dropped.get(e.sha256)!.name})` : ' (not checked)'}`);
  const out: CheckLine[] = [];
  if (!files.length)
    out.push({ id: 'evidence', tone: 'info', text: `This summary lists ${plural(expected.length, 'evidence file')}. Add them to check them.`, details });
  else
    out.push({
      id: 'evidence',
      tone: matched.length ? 'ok' : unknown.length ? 'bad' : 'info',
      text:
        matched.length === expected.length
          ? `${matched.length} of ${expected.length} evidence files match. Each is bit-for-bit the file that was sealed.`
          : `${matched.length} of ${expected.length} evidence files match${matched.length ? ' so far' : ''}.${expected.length - matched.length ? ` ${plural(expected.length - matched.length, 'file')} not checked yet.` : ''}`,
      details,
    });
  if (unknown.length)
    out.push({
      id: 'files',
      tone: 'bad',
      text: `${unknown.length === 1 ? `${unknown[0]!.name} doesn’t` : `${unknown.length} files don’t`} match any file in this summary. ${unknown.length === 1 ? 'It' : 'They'} may have been changed, or ${unknown.length === 1 ? 'it is' : 'they are'} a different file.`,
      details: unknown.map((f) => `${f.name}: ${f.sha256}`),
    });
  return out;
}

/** The hash chain, re-checked on this device from the proof's entries and links. */
export function chainCheck(proof: LedgerProofResponse | undefined): CheckLine | null {
  if (!proof || !proof.entries.length) return null;
  const c = checkLedgerProof(proof);
  if (!c.ok)
    return {
      id: 'chain',
      tone: 'bad',
      text: `The ledger chain is broken${c.brokenAtSeq ? ` at entry ${c.brokenAtSeq}` : ''}. Treat these results as unverified.`,
      details: [c.problem ?? 'The chain did not check out.'],
    };
  return {
    id: 'chain',
    tone: 'ok',
    text: `Ledger chain intact through entry ${c.throughSeq}${c.truncated ? ` (of ${c.headSeq})` : ''}.`,
    details: [
      `Recomputed on this device: ${plural(proof.entries.length, 'entry', 'entries')} for these files, and ${plural(proof.links.length, 'link')} from entry ${proof.links[0]!.seq} to ${c.throughSeq}${c.truncated ? '' : ' (the latest)'}.`,
      `Latest entry hash: ${proof.head.entryHash}`,
      'This shows nothing in the chain was altered or back-dated after it was written. It cannot rule out the operator rewriting the whole chain; publishing the latest entry hash elsewhere would.',
    ],
  };
}

/** Every content hash the checker should ask the ledger about (record ciphertext; deduplicated). */
export function proofHashes(...hashes: Array<string | undefined>): string[] {
  return [...new Set(hashes.filter((h): h is string => !!h && /^[0-9a-f]{64}$/.test(h)))].slice(0, 32);
}

export const overallTone = (lines: CheckLine[]): Tone => (lines.some((l) => l.tone === 'bad') ? 'bad' : lines.some((l) => l.tone === 'ok') ? 'ok' : 'info');
