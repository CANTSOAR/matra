/**
 * Draft slots (packages/shared/src/slots.ts): one encrypted, overwritable envelope per (account, opaque name), in their
 * own SQLite file next to the main database. Not ledgered, no WORM triggers, no audit rows: autosaving a draft must not
 * mint a permanent record (MATRA_DRAFT_MODE=keep-versions files a copy as a record in app.ts, which is the only way a
 * draft reaches the main database).
 *
 * What the server learns about a slot: which account, an opaque 64-hex name, the ciphertext size to the nearest 16 KiB,
 * and the UTC day of the last write. Compare-and-swap uses a random version tag that changes on every write, so the row
 * does not count her saves. (The file's own modification time, and request times, still show when someone last wrote.)
 *
 * Overwritten and deleted ciphertext: secure_delete overwrites freed pages, and every write ends with a TRUNCATE
 * checkpoint (journal_size_limit 0), so the WAL holds no earlier version once a write returns, unless another
 * connection (a backup tool, the sqlite3 shell) is reading the file at that moment: then the checkpoint can't truncate,
 * and that is logged. Copies in freed filesystem blocks, snapshots or backups are outside SQLite's reach
 * (docs/SECURITY_WHITEPAPER.md §4b).
 *
 * The file is bound to its main database: both hold the same random deployment id (db.ts deployment_meta). A drafts file
 * that belongs to another main database (a mistyped MATRA_DB_PATH, a restore of only one file, a fresh main database)
 * is never swept, and production refuses to start with it.
 */
import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from './db.js';

export interface SlotRow {
  owner_id: string;
  name: string;
  envelope: string;
  wrapped_key: string;
  version: string;
  updated_day: string;
}

export type PutResult =
  | { ok: true; version: string; updatedDay: string }
  | { ok: false; reason: 'conflict' }
  | { ok: false; reason: 'full' };

/** How this drafts file relates to the main database it was opened with. */
export type SlotBinding =
  /** it carries this main database's id */
  | 'bound'
  /** it had no id, and its slots (if any) all belong to accounts here: now bound to this main database */
  | 'new'
  /** it carries another main database's id, or it had slots but no id and they don't all belong here */
  | 'mismatch';

/** Where the slots live for a main database at `dbPath`: `<name>-drafts.db` beside it (':memory:' stays in memory). */
export function draftsDbPathFor(dbPath: string): string {
  if (dbPath === ':memory:') return ':memory:';
  const dir = path.dirname(dbPath);
  const base = path.basename(dbPath).replace(/\.(db|sqlite3?)$/i, '');
  return path.join(dir, `${base}-drafts.db`);
}

const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);
const newVersion = () => randomBytes(16).toString('hex');

const statements = (db: DB) => ({
  get: db.prepare('SELECT * FROM slots WHERE owner_id = ? AND name = ?'),
  count: db.prepare('SELECT COUNT(*) AS n FROM slots WHERE owner_id = ?'),
  insert: db.prepare('INSERT INTO slots (owner_id, name, envelope, wrapped_key, version, updated_day) VALUES (?, ?, ?, ?, ?, ?)'),
  update: db.prepare('UPDATE slots SET envelope = ?, wrapped_key = ?, version = ?, updated_day = ? WHERE owner_id = ? AND name = ? AND version = ?'),
  delete: db.prepare('DELETE FROM slots WHERE owner_id = ? AND name = ?'),
  deleteOwner: db.prepare('DELETE FROM slots WHERE owner_id = ?'),
  owners: db.prepare('SELECT DISTINCT owner_id FROM slots'),
  metaGet: db.prepare('SELECT value FROM slots_meta WHERE key = ?'),
  metaSet: db.prepare('INSERT INTO slots_meta (key, value) VALUES (?, ?)'),
});

export class SlotStore {
  readonly db: DB;
  private readonly q: ReturnType<typeof statements>;

  constructor(dbPath: string, private readonly maxPerAccount: number) {
    if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('secure_delete = ON');
    this.db.pragma('journal_size_limit = 0');
    this.db.exec(`CREATE TABLE IF NOT EXISTS slots (
      owner_id    TEXT NOT NULL,
      name        TEXT NOT NULL,              -- hex HMAC under her slot-name key; opaque to the server
      envelope    TEXT NOT NULL,              -- Envelope JSON, ciphertext padded to whole 16 KiB buckets
      wrapped_key TEXT NOT NULL,              -- WrappedKey JSON, under her master key
      version     TEXT NOT NULL,              -- random tag, new on every write; compare-and-swap (not a counter)
      updated_day TEXT NOT NULL,              -- UTC day of the last write, nothing finer
      PRIMARY KEY (owner_id, name)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS slots_meta (
      key   TEXT PRIMARY KEY,                 -- 'main_db_id': the deployment id of the main database this file belongs to
      value TEXT NOT NULL
    )`);
    const cols = (this.db.prepare(`SELECT name FROM pragma_table_info('slots')`).all() as Array<{ name: string }>).map((c) => c.name);
    if (!cols.includes('version'))
      throw new Error(`${dbPath} is a drafts file from a pre-release build (its slots have no version column). It never held real data: delete it and start again.`);
    this.q = statements(this.db);
  }

  /**
   * Bind this file to the main database whose deployment id is `mainDbId`, or report that it belongs elsewhere.
   * `accountExists` checks the main database's users (for a file that has slots but no binding yet).
   */
  bind(mainDbId: string, accountExists: (ownerId: string) => boolean): SlotBinding {
    const bound = (this.q.metaGet.get('main_db_id') as { value: string } | undefined)?.value;
    if (bound) return bound === mainDbId ? 'bound' : 'mismatch';
    const owners = (this.q.owners.all() as Array<{ owner_id: string }>).map((r) => r.owner_id);
    if (owners.length && !owners.every(accountExists)) return 'mismatch';
    this.q.metaSet.run('main_db_id', mainDbId);
    this.checkpoint();
    return 'new';
  }

  get(ownerId: string, name: string): SlotRow | undefined {
    return this.q.get.get(ownerId, name) as SlotRow | undefined;
  }

  /** Whether she can make one more slot. */
  hasRoom(ownerId: string): boolean {
    return (this.q.count.get(ownerId) as { n: number }).n < this.maxPerAccount;
  }

  /** Current version of a slot (null when there is none). */
  versionOf(ownerId: string, name: string): string | null {
    return this.get(ownerId, name)?.version ?? null;
  }

  /**
   * Write if `expectedVersion` is the slot's current version (null = she has none yet). Synchronous, so nothing else
   * runs between the check and the write.
   */
  put(ownerId: string, name: string, envelope: string, wrappedKey: string, expectedVersion: string | null): PutResult {
    const day = utcDay();
    const version = newVersion();
    const result = this.db.transaction((): PutResult => {
      const cur = this.get(ownerId, name);
      if ((cur?.version ?? null) !== expectedVersion) return { ok: false, reason: 'conflict' };
      if (!cur) {
        if (!this.hasRoom(ownerId)) return { ok: false, reason: 'full' };
        this.q.insert.run(ownerId, name, envelope, wrappedKey, version, day);
      } else this.q.update.run(envelope, wrappedKey, version, day, ownerId, name, expectedVersion);
      return { ok: true, version, updatedDay: day };
    })();
    if (result.ok) this.checkpoint();
    return result;
  }

  /** Delete one slot if `expectedVersion` (when given) is current. */
  delete(ownerId: string, name: string, expectedVersion?: string | null): { ok: boolean } {
    const cur = this.get(ownerId, name);
    if (expectedVersion !== undefined && (cur?.version ?? null) !== expectedVersion) return { ok: false };
    if (cur) {
      this.q.delete.run(ownerId, name);
      this.checkpoint();
    }
    return { ok: true };
  }

  /** Account deletion: every slot she has. */
  deleteOwner(ownerId: string): void {
    this.q.deleteOwner.run(ownerId);
    this.checkpoint();
  }

  /**
   * Delete the slots of accounts that were provably deleted (an account deletion that stopped between the main database
   * and this file). `provablyDeleted` must say yes only with proof (app.ts: no user row AND an `account.shredded` ledger
   * entry for that id). Owners that are merely missing are kept and counted, never deleted.
   */
  sweepDeleted(accountExists: (ownerId: string) => boolean, provablyDeleted: (ownerId: string) => boolean): { deleted: number; unexplained: number } {
    const missing = (this.q.owners.all() as Array<{ owner_id: string }>).map((r) => r.owner_id).filter((id) => !accountExists(id));
    const gone = missing.filter(provablyDeleted);
    for (const id of gone) this.q.deleteOwner.run(id);
    if (gone.length) this.checkpoint();
    return { deleted: gone.length, unexplained: missing.length - gone.length };
  }

  /** Move written pages out of the WAL and truncate it, so no earlier version waits there for a later checkpoint. */
  checkpoint(): boolean {
    try {
      const [r] = this.db.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number }>;
      if (r?.busy) {
        console.warn('[matra] drafts: another reader blocked the WAL checkpoint; earlier draft pages stay in the WAL until the next write.');
        return false;
      }
      return true;
    } catch {
      console.warn('[matra] drafts: the WAL checkpoint failed; earlier draft pages stay in the WAL until the next write.');
      return false;
    }
  }
}
