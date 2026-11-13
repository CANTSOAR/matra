/**
 * Client-side check of the integrity ledger (apps/server/src/ledger.ts), so a reader does not have to trust the
 * server's own "verified" answer:
 *
 *   entryHash = SHA-256_hex(`${seq}|${type}|${subjectId}|${contentHash}|${timestamp}|${prevHash}`), genesis prevHash = 64 × '0'
 *
 * Given a proof (POST /api/ledger/proof): every returned entry's hash is recomputed here, each must sit in the chain of
 * links at its own seq, and the links must connect one to the next up to the head the server reports. Links carry only
 * seq, prevHash and entryHash (not other people's entry types, subjects or times), so the entries between are checked
 * for connection, not recomputed. This shows the entries are part of one unbroken chain ending at the published head;
 * it cannot show that the operator did not rewrite the whole chain (threat model W10: anchor the head externally).
 */
import { sha256 } from '@noble/hashes/sha2.js';
import type { LedgerEntry, LedgerProofResponse } from '@matra/shared';
import { toHex } from './index';

export const LEDGER_GENESIS_HASH = '0'.repeat(64);

/** The ledger's entry hash, recomputed from an entry's fields. */
export function ledgerEntryHash(e: Pick<LedgerEntry, 'seq' | 'type' | 'subjectId' | 'contentHash' | 'timestamp' | 'prevHash'>): string {
  return toHex(sha256(new TextEncoder().encode(`${e.seq}|${e.type}|${e.subjectId}|${e.contentHash}|${e.timestamp}|${e.prevHash}`)));
}

export interface LedgerChainCheck {
  /** every entry recomputes, sits in the chain, and the chain connects up to `throughSeq` */
  ok: boolean;
  /** the last entry the chain was followed to (the head, unless the proof was truncated) */
  throughSeq: number;
  headSeq: number;
  truncated: boolean;
  /** first place it went wrong, for technical readers */
  problem?: string;
  brokenAtSeq?: number;
}

export function checkLedgerProof(proof: Pick<LedgerProofResponse, 'entries' | 'links' | 'head' | 'truncated'>): LedgerChainCheck {
  const headSeq = proof.head.seq;
  const fail = (problem: string, brokenAtSeq?: number): LedgerChainCheck => ({
    ok: false,
    throughSeq: 0,
    headSeq,
    truncated: proof.truncated,
    problem,
    ...(brokenAtSeq !== undefined && { brokenAtSeq }),
  });
  const links = proof.links;
  if (!links.length) return proof.entries.length ? fail('The server sent no chain links.') : { ok: true, throughSeq: 0, headSeq, truncated: false };
  for (let i = 0; i < links.length; i++) {
    const l = links[i]!;
    if (i === 0) {
      if (l.seq === 1 && l.prevHash !== LEDGER_GENESIS_HASH) return fail('Entry #1 does not start from the genesis hash.', 1);
      continue;
    }
    const prev = links[i - 1]!;
    if (l.seq !== prev.seq + 1) return fail(`The chain skips from entry #${prev.seq} to #${l.seq}.`, l.seq);
    if (l.prevHash !== prev.entryHash) return fail(`Entry #${l.seq} does not point to entry #${prev.seq}.`, l.seq);
  }
  const bySeq = new Map(links.map((l) => [l.seq, l]));
  for (const e of proof.entries) {
    if (ledgerEntryHash(e) !== e.entryHash) return fail(`Entry #${e.seq} does not recompute: its contents were changed after it was written.`, e.seq);
    const l = bySeq.get(e.seq);
    if (!l) return fail(`Entry #${e.seq} is not in the chain the server sent.`, e.seq);
    if (l.entryHash !== e.entryHash || l.prevHash !== e.prevHash) return fail(`Entry #${e.seq} differs from the chain at that position.`, e.seq);
  }
  const last = links[links.length - 1]!;
  if (!proof.truncated && (last.seq !== headSeq || last.entryHash !== proof.head.entryHash))
    return fail(`The chain does not end at the published head (entry #${headSeq}).`, last.seq);
  return { ok: true, throughSeq: last.seq, headSeq, truncated: proof.truncated };
}
