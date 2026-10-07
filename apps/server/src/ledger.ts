/**
 * WORM ledger — an append-only SHA-256 hash chain.
 *
 *   entryHash = SHA-256_hex(`${seq}|${type}|${subjectId}|${contentHash}|${timestamp}|${prevHash}`)
 *   genesis prevHash = 64 × '0'; seq starts at 1; timestamp = server receipt time, ISO-8601 UTC.
 *
 * contentHash conventions (clients and the brief PDF re-compute / display these):
 *   record.sealed    SHA-256_hex(UTF-8 of JSON.stringify({ v, alg, iv, ct }))  — canonical Envelope,
 *                    exactly those four keys in that order, no whitespace. See `envelopeContentHash`.
 *   blob.sealed      SHA-256_hex(raw ciphertext bytes as uploaded, i.e. iv || ct).
 *   share.granted    SHA-256_hex(JSON.stringify({ shareId, recordId, attorneyId, consentStatement, scope, blobIds }))
 *                    — attests the exact consent text. blobIds keep the order sent by the client.
 *   share.revoked    SHA-256_hex(JSON.stringify({ shareId, status: 'revoked', revokedAt }))
 *   escrow.sealed    SHA-256_hex(canonical labelEnvelope JSON) — the identifier hash is deliberately
 *                    NOT used, so the ledger cannot be used to link entries about the same person.
 *   escrow.matched   SHA-256_hex(JSON.stringify({ escrowEntryId, matchedAt }))
 *   account.shredded SHA-256_hex(JSON.stringify({ userId, recordIds, blobIds }))  (ids sorted ascending)
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Envelope, LedgerEntry, LedgerVerifyResponse } from '@shield/shared';
import { GENESIS_HASH, type DB } from './db.js';

export type LedgerType =
  | 'record.sealed'
  | 'blob.sealed'
  | 'share.granted'
  | 'share.revoked'
  | 'escrow.sealed'
  | 'escrow.matched'
  | 'account.shredded';

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function newId(): string {
  return randomBytes(16).toString('hex');
}

/** Canonical JSON of an Envelope: keys v, alg, iv, ct in that order. */
export function canonicalEnvelope(e: Envelope): string {
  return JSON.stringify({ v: e.v, alg: e.alg, iv: e.iv, ct: e.ct });
}

export function envelopeContentHash(e: Envelope): string {
  return sha256Hex(canonicalEnvelope(e));
}

export function computeEntryHash(
  seq: number,
  type: string,
  subjectId: string,
  contentHash: string,
  timestamp: string,
  prevHash: string,
): string {
  return sha256Hex(`${seq}|${type}|${subjectId}|${contentHash}|${timestamp}|${prevHash}`);
}

interface LedgerRow {
  seq: number;
  id: string;
  type: string;
  subject_id: string;
  content_hash: string;
  timestamp: string;
  prev_hash: string;
  entry_hash: string;
}

function toEntry(r: LedgerRow): LedgerEntry {
  return {
    seq: r.seq,
    id: r.id,
    type: r.type,
    subjectId: r.subject_id,
    contentHash: r.content_hash,
    timestamp: r.timestamp,
    prevHash: r.prev_hash,
    entryHash: r.entry_hash,
  };
}

/** Append one entry. Must be called inside a db.transaction() so the head read + insert are atomic. */
export function appendLedger(
  db: DB,
  type: LedgerType,
  subjectId: string,
  contentHash: string,
  timestamp: string = new Date().toISOString(),
): LedgerEntry {
  const head = db.prepare('SELECT seq, entry_hash FROM ledger ORDER BY seq DESC LIMIT 1').get() as
    | { seq: number; entry_hash: string }
    | undefined;
  const seq = (head?.seq ?? 0) + 1;
  const prevHash = head?.entry_hash ?? GENESIS_HASH;
  const entry: LedgerEntry = {
    seq,
    id: newId(),
    type,
    subjectId,
    contentHash,
    timestamp,
    prevHash,
    entryHash: computeEntryHash(seq, type, subjectId, contentHash, timestamp, prevHash),
  };
  db.prepare(
    `INSERT INTO ledger (seq, id, type, subject_id, content_hash, timestamp, prev_hash, entry_hash)
     VALUES (@seq, @id, @type, @subjectId, @contentHash, @timestamp, @prevHash, @entryHash)`,
  ).run(entry);
  return entry;
}

export function getLedgerEntry(db: DB, id: string): LedgerEntry | undefined {
  const r = db.prepare('SELECT * FROM ledger WHERE id = ?').get(id) as LedgerRow | undefined;
  return r && toEntry(r);
}

export function ledgerHead(db: DB): { seq: number; entryHash: string } {
  const r = db.prepare('SELECT seq, entry_hash FROM ledger ORDER BY seq DESC LIMIT 1').get() as
    | { seq: number; entry_hash: string }
    | undefined;
  return { seq: r?.seq ?? 0, entryHash: r?.entry_hash ?? GENESIS_HASH };
}

/** Recompute the whole chain from genesis. */
export function verifyLedger(db: DB): LedgerVerifyResponse {
  let prev = GENESIS_HASH;
  let expectedSeq = 1;
  let length = 0;
  for (const r of db.prepare('SELECT * FROM ledger ORDER BY seq ASC').iterate() as IterableIterator<LedgerRow>) {
    length++;
    const recomputed = computeEntryHash(r.seq, r.type, r.subject_id, r.content_hash, r.timestamp, r.prev_hash);
    if (r.seq !== expectedSeq || r.prev_hash !== prev || r.entry_hash !== recomputed) {
      return { ok: false, length: countLedger(db), headHash: ledgerHead(db).entryHash, brokenAtSeq: r.seq };
    }
    prev = r.entry_hash;
    expectedSeq++;
  }
  return { ok: true, length, headHash: prev };
}

function countLedger(db: DB): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM ledger').get() as { n: number }).n;
}
