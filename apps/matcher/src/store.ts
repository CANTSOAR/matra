/**
 * The matcher's own SQLite database (MATRA_MATCHER_DB_PATH). It never shares a file with the app server.
 *
 *   matcher_entries      one row per sealed entry: its tag, a pseudonymous survivor reference (HMAC of the account id
 *                        under the APP SERVER's pepper, so the matcher can count distinct survivors without user ids),
 *                        when it was sealed, the hour the account was created (Sybil signals), and the two states from
 *                        her routing tag (null when she gave none, or it did not open).
 *   matcher_assignments  one row per matched group (tag): the ONE counselor it went to, why, when, counselors excluded
 *                        for it (declines, roster removals) and the Sybil signals. counselor_id is null while nobody
 *                        licensed in the group's states is on the roster (reason "unassigned:…").
 *   matcher_exclusions   (tag, counselor) pairs a counselor declined (conflict check). Kept apart from the assignment
 *                        row, so a decline survives the group dissolving and forming again; erased once no entry with
 *                        that tag remains.
 *   matcher_roster       the latest roster: the signed payload as received, and the resolved list (userId +
 *                        licensed states) the assignment algorithm uses.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type MatcherDB = Database.Database;

export interface EntryRow {
  entry_id: string;
  tag: string;
  survivor_ref: string;
  created_at: string;
  account_created_hour: string;
  incident_state: string | null;
  survivor_state: string | null;
}

export interface AssignmentRow {
  tag: string;
  counselor_id: string | null;
  reason: string;
  assigned_at: string;
  excluded: string;
  signals: string;
  signature: string | null;
}

export interface RosterCounselor {
  userId: string;
  licensedStates: string[];
}

export function openMatcherDb(dbPath: string): MatcherDB {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('secure_delete = ON'); // withdrawn entries' states don't linger in freed pages
  db.exec(`
    CREATE TABLE IF NOT EXISTS matcher_entries (
      entry_id             TEXT PRIMARY KEY,
      tag                  TEXT NOT NULL,
      survivor_ref         TEXT NOT NULL,
      created_at           TEXT NOT NULL,
      account_created_hour TEXT NOT NULL,
      incident_state       TEXT,
      survivor_state       TEXT
    );
    CREATE INDEX IF NOT EXISTS matcher_entries_tag ON matcher_entries(tag);
    CREATE TABLE IF NOT EXISTS matcher_assignments (
      tag          TEXT PRIMARY KEY,
      counselor_id TEXT,
      reason       TEXT NOT NULL,
      assigned_at  TEXT NOT NULL,
      excluded     TEXT NOT NULL DEFAULT '[]',
      signals      TEXT NOT NULL,
      signature    TEXT
    );
    CREATE TABLE IF NOT EXISTS matcher_exclusions (
      tag          TEXT NOT NULL,
      counselor_id TEXT NOT NULL,
      PRIMARY KEY (tag, counselor_id)
    );
    CREATE TABLE IF NOT EXISTS matcher_roster (
      id          INTEGER PRIMARY KEY CHECK (id = 1),
      payload     TEXT,
      signature   TEXT,
      counselors  TEXT NOT NULL
    );
  `);
  return db;
}

/** Prepared statements over the matcher DB (the core in matcher.ts stays free of SQL). */
export class MatcherStore {
  private readonly q;
  constructor(readonly db: MatcherDB) {
    this.q = {
      upsertEntry: db.prepare(
        `INSERT INTO matcher_entries (entry_id, tag, survivor_ref, created_at, account_created_hour, incident_state, survivor_state)
         VALUES (@entry_id, @tag, @survivor_ref, @created_at, @account_created_hour, @incident_state, @survivor_state)
         ON CONFLICT (entry_id) DO UPDATE SET tag = excluded.tag, survivor_ref = excluded.survivor_ref, created_at = excluded.created_at,
           account_created_hour = excluded.account_created_hour, incident_state = excluded.incident_state, survivor_state = excluded.survivor_state`,
      ),
      deleteEntry: db.prepare('DELETE FROM matcher_entries WHERE entry_id = ?'),
      eligible: db.prepare('SELECT * FROM matcher_entries WHERE created_at <= ? ORDER BY created_at ASC, entry_id ASC'),
      assignments: db.prepare('SELECT * FROM matcher_assignments ORDER BY tag'),
      assignment: db.prepare('SELECT * FROM matcher_assignments WHERE tag = ?'),
      putAssignment: db.prepare(
        `INSERT INTO matcher_assignments (tag, counselor_id, reason, assigned_at, excluded, signals, signature)
         VALUES (@tag, @counselor_id, @reason, @assigned_at, @excluded, @signals, @signature)
         ON CONFLICT (tag) DO UPDATE SET counselor_id = excluded.counselor_id, reason = excluded.reason, assigned_at = excluded.assigned_at,
           excluded = excluded.excluded, signals = excluded.signals, signature = excluded.signature`,
      ),
      deleteAssignment: db.prepare('DELETE FROM matcher_assignments WHERE tag = ?'),
      exclusionsFor: db.prepare('SELECT counselor_id FROM matcher_exclusions WHERE tag = ? ORDER BY counselor_id'),
      addExclusion: db.prepare('INSERT OR IGNORE INTO matcher_exclusions (tag, counselor_id) VALUES (?, ?)'),
      pruneExclusions: db.prepare('DELETE FROM matcher_exclusions WHERE tag NOT IN (SELECT tag FROM matcher_entries)'),
      roster: db.prepare('SELECT counselors FROM matcher_roster WHERE id = 1'),
      putRoster: db.prepare(
        `INSERT INTO matcher_roster (id, payload, signature, counselors) VALUES (1, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET payload = excluded.payload, signature = excluded.signature, counselors = excluded.counselors`,
      ),
    };
  }

  upsertEntry(e: EntryRow): void {
    this.q.upsertEntry.run(e);
  }
  deleteEntry(entryId: string): void {
    this.q.deleteEntry.run(entryId);
  }
  /** Entries sealed at or before `cutoffIso` (ISO-8601 UTC strings compare in time order). */
  eligibleEntries(cutoffIso: string): EntryRow[] {
    return this.q.eligible.all(cutoffIso) as EntryRow[];
  }
  assignments(): AssignmentRow[] {
    return this.q.assignments.all() as AssignmentRow[];
  }
  assignment(tag: string): AssignmentRow | undefined {
    return this.q.assignment.get(tag) as AssignmentRow | undefined;
  }
  putAssignment(a: AssignmentRow): void {
    this.q.putAssignment.run(a);
  }
  deleteAssignment(tag: string): void {
    this.q.deleteAssignment.run(tag);
  }
  /** Counselors who declined this tag. */
  exclusionsFor(tag: string): string[] {
    return (this.q.exclusionsFor.all(tag) as Array<{ counselor_id: string }>).map((r) => r.counselor_id);
  }
  addExclusion(tag: string, counselorId: string): void {
    this.q.addExclusion.run(tag, counselorId);
  }
  /** Erase declines for tags with no entry left. */
  pruneExclusions(): void {
    this.q.pruneExclusions.run();
  }
  roster(): RosterCounselor[] {
    const r = this.q.roster.get() as { counselors: string } | undefined;
    return r ? (JSON.parse(r.counselors) as RosterCounselor[]) : [];
  }
  putRoster(signed: { payload: string; signature: string } | undefined, counselors: RosterCounselor[]): void {
    this.q.putRoster.run(signed?.payload ?? null, signed?.signature ?? null, JSON.stringify(counselors));
  }
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}
