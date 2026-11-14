/**
 * Mark an attorney or a Legal Options Counselor as verified or unverified (the verify-attorney CLI; tests).
 *
 * Unverifying cuts access at once: the attorney routes (share list, bundle, evidence download) and the counselor routes
 * refuse an unverified account with 403, and every session of that account is deleted here, so nothing already open
 * keeps working until its 12 h expiry.
 *
 * Her shares are NOT revoked: a share is her consent record (ledgered), and only she changes it. Instead each survivor
 * with a live share to that attorney gets an activity row saying the attorney is no longer verified and access is
 * paused, so she can take the access back or keep it. If the attorney is verified again, access resumes and she gets a
 * row saying so. Rows are written only when the flag actually changes.
 */
import type { DB } from './db.js';
import { newId } from './ledger.js';

export interface VerificationChange {
  role: 'attorney' | 'counselor';
  userId: string;
  /** the flag was different before this call */
  changed: boolean;
  /** sessions deleted (unverify only) */
  sessionsEnded: number;
  /** survivors told in their activity (attorneys only) */
  survivorsNotified: number;
}

/** Returns null when no attorney or counselor has that username. */
export function setVerified(db: DB, username: string, verified: boolean, now: Date = new Date()): VerificationChange | null {
  const v = verified ? 1 : 0;
  const at = now.toISOString();
  return db.transaction((): VerificationChange | null => {
    const user = db
      .prepare(`SELECT id, role FROM users WHERE username = ? AND role IN ('attorney', 'counselor')`)
      .get(username) as { id: string; role: 'attorney' | 'counselor' } | undefined;
    if (!user) return null;
    const table = user.role === 'attorney' ? 'attorney_profiles' : 'counselor_profiles';
    const profile = db.prepare(`SELECT display_name, organization, verified FROM ${table} WHERE user_id = ?`).get(user.id) as
      | { display_name: string; organization: string | null; verified: number }
      | undefined;
    if (!profile) return null;
    const changed = profile.verified !== v;
    db.prepare(`UPDATE ${table} SET verified = ? WHERE user_id = ?`).run(v, user.id);

    const sessionsEnded = verified ? 0 : db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id).changes;

    let survivorsNotified = 0;
    if (user.role === 'attorney' && changed) {
      // Survivors whose share to this attorney would otherwise still be open (active and unexpired).
      const survivors = db
        .prepare(`SELECT DISTINCT survivor_id FROM shares WHERE attorney_id = ? AND status = 'active' AND expires_at > ?`)
        .all(user.id, at) as Array<{ survivor_id: string }>;
      const who = `${profile.display_name}${profile.organization ? `, ${profile.organization}` : ''}`;
      const detail = verified
        ? `${who} is verified by Matra again, so they can open the file you shared with them again. You can still take back their access at any time.`
        : `${who} is no longer verified by Matra, so their access to the file you shared is paused. You can take back their access, or keep it in case they are verified again.`;
      const ins = db.prepare('INSERT INTO audit_events (id, user_id, action, detail, at) VALUES (?, ?, ?, ?, ?)');
      for (const s of survivors) ins.run(newId(), s.survivor_id, verified ? 'attorney.reverified' : 'attorney.unverified', detail, at);
      survivorsNotified = survivors.length;
    }
    return { role: user.role, userId: user.id, changed, sessionsEnded, survivorsNotified };
  })();
}
