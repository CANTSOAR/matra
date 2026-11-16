/**
 * A recipient's copy of a key: when she shares her sealed account with an attorney (shares, share_blobs) or releases her
 * report to a counselor (report_releases, report_release_blobs), her device wraps the record's key, and each file's, to
 * that person's public key. The server keeps those wraps only while they may still be needed:
 *
 *   - she revokes a share, or a release ends (her revoke, or Matra ending it for her): deleted in the same transaction;
 *   - access expires: kept for WRAP_GRACE_DAYS, so she can renew without doing anything else, then deleted by the
 *     housekeeping sweep. Renewing a share after that sends a fresh wrap from her device (POST /api/shares/:id/renew).
 *
 * Without the wrap, nothing on the server opens her record for that person, even if their private key leaks later or
 * the server is told to hand the row over. Deleting the wrap can't undo what they already opened or saved.
 * The sweep runs whatever MATRA_MATCHING says: report-release rows written while it was on stay in the database.
 */
import type { DB } from './db.js';

/** Days after a share or release expires that its wraps are kept, so a renewal needs nothing from her device. */
export const WRAP_GRACE_DAYS = 30;

/** Delete every wrap of a share: the record's and each file's. Call inside the transaction that ends the share. */
export function forgetShareKeys(db: DB, shareId: string): void {
  db.prepare('UPDATE shares SET recipient_wrapped_key = NULL WHERE id = ?').run(shareId);
  db.prepare('UPDATE share_blobs SET recipient_wrapped_key = NULL WHERE share_id = ?').run(shareId);
}

/** Delete every wrap of a report release. Call inside the transaction that ends the release. */
export function forgetReleaseKeys(db: DB, releaseId: string): void {
  db.prepare('UPDATE report_releases SET recipient_wrapped_key = NULL WHERE id = ?').run(releaseId);
  db.prepare('UPDATE report_release_blobs SET recipient_wrapped_key = NULL WHERE release_id = ?').run(releaseId);
}

/**
 * Delete the wraps of every share and release that was revoked, or that expired more than WRAP_GRACE_DAYS ago. Returns
 * how many shares and releases lost theirs. Idempotent; one transaction.
 */
export function sweepRecipientKeys(db: DB, now: number = Date.now()): { shares: number; releases: number } {
  const cutoff = new Date(now - WRAP_GRACE_DAYS * 86_400_000).toISOString();
  const ended = (table: 'shares' | 'report_releases') =>
    `SELECT id FROM ${table} WHERE recipient_wrapped_key IS NOT NULL
       AND (status = 'revoked' OR (expires_at IS NOT NULL AND expires_at <= ?))`;
  const out = { shares: 0, releases: 0 };
  db.transaction(() => {
    for (const { id } of db.prepare(ended('shares')).all(cutoff) as Array<{ id: string }>) {
      forgetShareKeys(db, id);
      out.shares++;
    }
    for (const { id } of db.prepare(ended('report_releases')).all(cutoff) as Array<{ id: string }>) {
      forgetReleaseKeys(db, id);
      out.releases++;
    }
  })();
  if (out.shares + out.releases > 0) checkpoint(db);
  return out;
}

/**
 * Move deleted wraps out of the write-ahead log now (secure_delete already overwrites the freed pages of the main
 * file). Best effort: a busy reader can hold a checkpoint back, and the next one finishes the job. Backups and
 * snapshots taken before keep their copies.
 */
export function checkpoint(db: DB): void {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    /* closed database (tests) */
  }
}
