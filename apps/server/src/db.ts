/**
 * SQLite storage (better-sqlite3) with in-code, versioned migrations.
 *
 * Immutability (WORM) is enforced *inside the database*, not just by the
 * application, so a bug or a careless query cannot silently rewrite history:
 *
 *   ledger  — UPDATE and DELETE always RAISE(ABORT). INSERT is only accepted
 *             if it extends the hash chain (seq = max+1, prev_hash = head).
 *   records — UPDATE always RAISE(ABORT); a new version is a new row with
 *             `supersedes`. DELETE RAISE(ABORT)s *unless* the owner is listed
 *             in `shred_authorizations`.
 *
 * Crypto-shredding (POST /api/account/delete) is the one legitimate way to
 * remove records. It runs in a single transaction that
 *   1. inserts the owner's id into `shred_authorizations`,
 *   2. deletes that owner's rows (the records trigger now allows it),
 *   3. deletes the authorization row again,
 * so the authorization never survives the transaction and can only ever
 * cover the account being shredded. (A TEMP table cannot be used here
 * because SQLite forbids triggers in `main` from referencing `temp` objects.)
 * Ledger rows are never deleted: they hold only ids, hashes and timestamps.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

export const GENESIS_HASH = '0'.repeat(64);

const MIGRATIONS: string[] = [
  // ── v1 ──────────────────────────────────────────────────────────────
  `
  CREATE TABLE users (
    id                  TEXT PRIMARY KEY,
    username            TEXT NOT NULL UNIQUE,
    role                TEXT NOT NULL CHECK (role IN ('survivor','attorney')),
    auth_hash           BLOB NOT NULL,          -- scrypt(authKey, auth_salt); never the authKey
    auth_salt           BLOB NOT NULL,
    kdf_salt            TEXT NOT NULL,          -- client PBKDF2 salt (base64), returned by prelogin
    kdf_iterations      INTEGER NOT NULL,
    public_key          TEXT NOT NULL,          -- JWK JSON
    wrapped_private_key TEXT NOT NULL,          -- Envelope JSON
    created_at          TEXT NOT NULL
  );

  CREATE TABLE attorney_profiles (
    user_id          TEXT PRIMARY KEY REFERENCES users(id),
    display_name     TEXT NOT NULL,
    organization     TEXT,
    bar_number       TEXT,
    jurisdictions    TEXT NOT NULL,             -- JSON array of USPS codes
    practice_areas   TEXT NOT NULL,             -- JSON array
    verified         INTEGER NOT NULL DEFAULT 0,
    accepts_pro_bono INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,                -- SHA-256 hex of the bearer token
    user_id    TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    expires_at INTEGER NOT NULL                 -- epoch ms
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE ledger (
    seq          INTEGER PRIMARY KEY,
    id           TEXT NOT NULL UNIQUE,
    type         TEXT NOT NULL,
    subject_id   TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    timestamp    TEXT NOT NULL,
    prev_hash    TEXT NOT NULL,
    entry_hash   TEXT NOT NULL
  );

  CREATE TABLE records (
    id                TEXT PRIMARY KEY,
    owner_id          TEXT NOT NULL REFERENCES users(id),
    supersedes        TEXT REFERENCES records(id),
    envelope          TEXT NOT NULL,            -- canonical Envelope JSON
    owner_wrapped_key TEXT NOT NULL,            -- WrappedKey JSON
    content_hash      TEXT NOT NULL,
    created_at        TEXT NOT NULL,
    ledger_entry_id   TEXT NOT NULL REFERENCES ledger(id)
  );
  CREATE INDEX records_owner ON records(owner_id);

  CREATE TABLE blobs (
    id                TEXT PRIMARY KEY,
    owner_id          TEXT NOT NULL REFERENCES users(id),
    data              BLOB NOT NULL,            -- ciphertext (iv || AES-GCM ct)
    size_bytes        INTEGER NOT NULL,
    content_hash      TEXT NOT NULL,
    owner_wrapped_key TEXT NOT NULL,
    created_at        TEXT NOT NULL,
    ledger_entry_id   TEXT NOT NULL REFERENCES ledger(id)
  );
  CREATE INDEX blobs_owner ON blobs(owner_id);

  CREATE TABLE shares (
    id                    TEXT PRIMARY KEY,
    record_id             TEXT NOT NULL REFERENCES records(id),
    survivor_id           TEXT NOT NULL REFERENCES users(id),
    attorney_id           TEXT NOT NULL REFERENCES users(id),
    status                TEXT NOT NULL CHECK (status IN ('active','revoked')),
    consent_statement     TEXT NOT NULL,
    scope                 TEXT NOT NULL,        -- JSON array
    recipient_wrapped_key TEXT NOT NULL,
    survivor_alias        TEXT NOT NULL,
    created_at            TEXT NOT NULL,
    revoked_at            TEXT,
    ledger_entry_id       TEXT NOT NULL REFERENCES ledger(id)
  );
  CREATE INDEX shares_survivor ON shares(survivor_id);
  CREATE INDEX shares_attorney ON shares(attorney_id);

  CREATE TABLE share_blobs (
    share_id              TEXT NOT NULL REFERENCES shares(id),
    blob_id               TEXT NOT NULL REFERENCES blobs(id),
    recipient_wrapped_key TEXT NOT NULL,
    PRIMARY KEY (share_id, blob_id)
  );
  CREATE INDEX share_blobs_blob ON share_blobs(blob_id);

  CREATE TABLE escrow_entries (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    peppered_hash   TEXT NOT NULL,              -- HMAC-SHA256(pepper, identifierHash); never returned
    label_envelope  TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('sealed','matched')),
    created_at      TEXT NOT NULL,
    matched_at      TEXT,
    ledger_entry_id TEXT NOT NULL REFERENCES ledger(id)
  );
  CREATE INDEX escrow_hash ON escrow_entries(peppered_hash);
  CREATE INDEX escrow_user ON escrow_entries(user_id);

  CREATE TABLE audit_events (
    id      TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,                      -- whose audit trail this event belongs to
    action  TEXT NOT NULL,
    detail  TEXT,
    at      TEXT NOT NULL
  );
  CREATE INDEX audit_user ON audit_events(user_id, at);

  CREATE TABLE shred_authorizations (
    owner_id TEXT PRIMARY KEY
  );

  -- ledger: append-only hash chain
  CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger
  BEGIN SELECT RAISE(ABORT, 'ledger is append-only (WORM)'); END;

  CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger
  BEGIN SELECT RAISE(ABORT, 'ledger is append-only (WORM)'); END;

  CREATE TRIGGER ledger_chain_insert BEFORE INSERT ON ledger
  WHEN NEW.seq IS NOT COALESCE((SELECT MAX(seq) FROM ledger), 0) + 1
    OR NEW.prev_hash IS NOT COALESCE((SELECT entry_hash FROM ledger ORDER BY seq DESC LIMIT 1), '${GENESIS_HASH}')
  BEGIN SELECT RAISE(ABORT, 'ledger insert does not extend the hash chain'); END;

  -- records: immutable; deletion only during an authorized crypto-shred
  CREATE TRIGGER records_no_update BEFORE UPDATE ON records
  BEGIN SELECT RAISE(ABORT, 'records are immutable (WORM); create a new version with supersedes'); END;

  CREATE TRIGGER records_guarded_delete BEFORE DELETE ON records
  WHEN NOT EXISTS (SELECT 1 FROM shred_authorizations WHERE owner_id = OLD.owner_id)
  BEGIN SELECT RAISE(ABORT, 'records are immutable (WORM); deletion only via account crypto-shred'); END;
  `,
  // ── v2: share expiry. Existing rows get created_at + 90 days. ──────────
  `
  ALTER TABLE shares ADD COLUMN expires_at TEXT;
  UPDATE shares SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+90 days');
  `,
  // ── v3: survivor 18+ self-attestation (boolean + server time it was given). Accounts created before this
  // column existed are left at 0 / NULL: we did not store their confirmation, so we don't invent one. ──
  `
  ALTER TABLE users ADD COLUMN age_confirmed_18 INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN age_confirmed_at TEXT;
  `,
  // ── v4: Callisto-style sealed matching + Legal Options Counselor role. ──────────────────────────────────
  // The old demo-only "blind escrow" (escrow_entries: HMAC-peppered PBKDF2 hashes) is DROPPED: it only ever held demo
  // data, and its hashes cannot be converted to OPRF tags (that would need the plaintext identifiers).
  // users is rebuilt to widen the role CHECK (SQLite cannot ALTER a CHECK); runs with foreign_keys OFF (see FK_OFF).
  `
  CREATE TABLE users_v4 (
    id                  TEXT PRIMARY KEY,
    username            TEXT NOT NULL UNIQUE,
    role                TEXT NOT NULL CHECK (role IN ('survivor','attorney','counselor')),
    auth_hash           BLOB NOT NULL,
    auth_salt           BLOB NOT NULL,
    kdf_salt            TEXT NOT NULL,
    kdf_iterations      INTEGER NOT NULL,
    public_key          TEXT NOT NULL,
    wrapped_private_key TEXT NOT NULL,
    created_at          TEXT NOT NULL,
    age_confirmed_18    INTEGER NOT NULL DEFAULT 0,
    age_confirmed_at    TEXT
  );
  INSERT INTO users_v4 (id, username, role, auth_hash, auth_salt, kdf_salt, kdf_iterations, public_key, wrapped_private_key,
                        created_at, age_confirmed_18, age_confirmed_at)
    SELECT id, username, role, auth_hash, auth_salt, kdf_salt, kdf_iterations, public_key, wrapped_private_key,
           created_at, age_confirmed_18, age_confirmed_at FROM users;
  DROP TABLE users;
  ALTER TABLE users_v4 RENAME TO users;

  DROP TABLE IF EXISTS escrow_entries;

  CREATE TABLE counselor_profiles (
    user_id       TEXT PRIMARY KEY REFERENCES users(id),
    display_name  TEXT NOT NULL,
    organization  TEXT,
    jurisdictions TEXT NOT NULL,                -- JSON array of USPS codes
    verified      INTEGER NOT NULL DEFAULT 0
  );

  -- One row per (survivor, perpetrator identifier). The server sees only the pseudorandom tag, never the identifier,
  -- its hash, or anything a counselor could open without a second survivor's share.
  CREATE TABLE match_entries (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    tag             TEXT NOT NULL,              -- π (64 hex)
    bundle          TEXT NOT NULL,              -- Envelope JSON: contact bundle under the per-entry key
    label_envelope  TEXT NOT NULL,              -- Envelope JSON: her own label, under her master key
    created_at      TEXT NOT NULL,
    ledger_entry_id TEXT NOT NULL REFERENCES ledger(id),
    UNIQUE (user_id, tag)
  );
  CREATE INDEX match_entries_tag ON match_entries(tag);

  -- One seal per (entry, counselor): {π, x, y, ce} encrypted to that counselor. Released only for matched groups.
  CREATE TABLE match_seals (
    entry_id     TEXT NOT NULL REFERENCES match_entries(id) ON DELETE CASCADE,
    counselor_id TEXT NOT NULL REFERENCES users(id),
    seal         TEXT NOT NULL,                 -- CounselorSeal JSON
    PRIMARY KEY (entry_id, counselor_id)
  );
  CREATE INDEX match_seals_counselor ON match_seals(counselor_id);

  -- Created the first time a tag has entries from 2 distinct survivors. Released while that remains true.
  CREATE TABLE match_groups (
    id         TEXT PRIMARY KEY,
    tag        TEXT NOT NULL UNIQUE,
    matched_at TEXT NOT NULL
  );

  CREATE TABLE counselor_notes (
    id           TEXT PRIMARY KEY,
    group_id     TEXT NOT NULL REFERENCES match_groups(id),
    counselor_id TEXT NOT NULL REFERENCES users(id),
    entry_id     TEXT,
    envelope     TEXT NOT NULL,                 -- encrypted under the counselor's own master key
    created_at   TEXT NOT NULL
  );
  CREATE INDEX counselor_notes_group ON counselor_notes(group_id, counselor_id);

  -- OPRF rate limits: only today's count and a lifetime total per (account, key holder); no per-call timestamps.
  CREATE TABLE oprf_quota (
    user_id        TEXT NOT NULL,
    holder         TEXT NOT NULL CHECK (holder IN ('a','b')),
    day            TEXT NOT NULL,
    day_count      INTEGER NOT NULL,
    lifetime_count INTEGER NOT NULL,
    PRIMARY KEY (user_id, holder)
  );
  `,
  // ── v5: sealed-matching v2 (security review fixes). The tag is now derived from the line's intercept, seals carry
  // v2 shares, bundles/labels are padded, and labels hold what her client needs to re-seal. Old entries cannot be
  // converted (that would need the plaintext identifiers), and only ever held DEMO data, so ALL matching data is
  // dropped: entries, seals, groups, counselor notes, and OPRF quotas. Ledger rows stay (append-only; hashes only).
  // Adds the key epoch per entry and a small meta table (pinned OPRF public keys, current epoch, signed roster).
  `
  DELETE FROM counselor_notes;
  DELETE FROM match_groups;
  DELETE FROM match_seals;
  DELETE FROM match_entries;
  DELETE FROM oprf_quota;
  ALTER TABLE match_entries ADD COLUMN key_epoch INTEGER NOT NULL DEFAULT 1;
  CREATE TABLE matching_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // ── v6: threshold OPRF (t-of-m Shamir shares replace the additive holders 'a'/'b'). Holders are now numbered
  // "1".."m", so the quota table loses its ('a','b') CHECK. Old quotas are dropped: they counted evaluations under the
  // old keys, which no longer exist (the key change is a rotation: new epoch, clients re-seal).
  `
  DROP TABLE oprf_quota;
  CREATE TABLE oprf_quota (
    user_id        TEXT NOT NULL,
    holder         TEXT NOT NULL,
    day            TEXT NOT NULL,
    day_count      INTEGER NOT NULL,
    lifetime_count INTEGER NOT NULL,
    PRIMARY KEY (user_id, holder)
  );
  `,
  // ── v7: phone verify-then-forget before sealed matching (W13, W19; src/sms.ts). phone_tokens holds only a keyed hash
  // of a verified number and how many accounts it has enabled: no user id, no timestamps, and WITHOUT ROWID so not even
  // insertion order is kept that could be lined up with users. Rows are written in batches apart from the users flag
  // (app.ts flushPhoneTokens), so no commit pairs a token with an account. That is NOT unlinkability: the SMS provider's
  // (number, time) records together with the account's own activity times can still link them (W19). The count is
  // never decremented (no row names an account). Accounts that already have sealed entries (demo data only) are grandfathered as verified, so their
  // clients can still re-seal after a key rotation.
  `
  CREATE TABLE phone_tokens (
    token_hash TEXT PRIMARY KEY,               -- hex HMAC(MATRA_PHONE_HASH_KEY, "matra/phone-token/v1|" + E.164)
    accounts   INTEGER NOT NULL
  ) WITHOUT ROWID;
  ALTER TABLE users ADD COLUMN matching_verified INTEGER NOT NULL DEFAULT 0;
  UPDATE users SET matching_verified = 1 WHERE id IN (SELECT user_id FROM match_entries);
  `,
  // ── v8: matcher service (apps/matcher; W15, W18). Each entry gains her routing tag sealed to the matcher's attested
  // key (this server cannot open it) and whether it has been forwarded to the matcher. match_assignments caches the
  // matcher's answer (which ONE counselor each group went to, and why), so groups already released stay visible while
  // the matcher is unreachable; new groups wait for it (fail closed). matcher_pending_deletes queues withdrawals and
  // account deletions until the matcher has them. key_epoch is bumped so existing clients re-seal on next sign-in,
  // this time with routing data. For counselors, counselor_profiles.jurisdictions means the states she is LICENSED in
  // (the roster's licensedStates).
  `
  ALTER TABLE match_entries ADD COLUMN routing_envelope TEXT;
  ALTER TABLE match_entries ADD COLUMN matcher_synced INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE match_assignments (
    tag          TEXT PRIMARY KEY,
    counselor_id TEXT NOT NULL,
    reason       TEXT NOT NULL,
    assigned_at  TEXT NOT NULL,
    signals      TEXT NOT NULL,             -- JSON MatchSignals, computed by the matcher
    signature    TEXT                       -- the matcher's Ed25519 signature over the assignment
  );
  CREATE TABLE matcher_pending_deletes (
    entry_id TEXT PRIMARY KEY
  ) WITHOUT ROWID;
  UPDATE matching_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'key_epoch';
  `,
  // ── v9: staged release (counselor-first; W1, W21). Each entry's contact details move into their own ciphertext
  // (contact_bundle), which the server withholds from the assigned counselor until she records a conflict check
  // (conflict_checks). Stage 2: she may ask one matched survivor for her full report (report_requests); only a survivor's
  // own yes creates a report_release (her record key, and any evidence keys she chose, wrapped to the counselor's key
  // on her device). One open request per (entry, counselor). No foreign keys: rows are deleted explicitly with the
  // entry, the group, or either account (app.ts). key_epoch is bumped so existing clients re-seal into the split format.
  `
  ALTER TABLE match_entries ADD COLUMN contact_bundle TEXT;
  CREATE TABLE conflict_checks (
    group_id          TEXT NOT NULL,
    counselor_id      TEXT NOT NULL,
    result            TEXT NOT NULL CHECK (result IN ('clear','conflict')),
    statement_version INTEGER NOT NULL,
    created_at        TEXT NOT NULL,
    ledger_entry_id   TEXT NOT NULL,
    PRIMARY KEY (group_id, counselor_id)
  );
  CREATE TABLE report_requests (
    id              TEXT PRIMARY KEY,
    group_id        TEXT NOT NULL,
    entry_id        TEXT NOT NULL,
    counselor_id    TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('pending','consented','declined','cancelled')),
    created_at      TEXT NOT NULL,
    decided_at      TEXT,
    ledger_entry_id TEXT NOT NULL
  );
  CREATE INDEX report_requests_entry ON report_requests(entry_id);
  CREATE INDEX report_requests_group ON report_requests(group_id, counselor_id);
  CREATE UNIQUE INDEX report_requests_one_open ON report_requests(entry_id, counselor_id) WHERE status = 'pending';
  CREATE TABLE report_releases (
    id                    TEXT PRIMARY KEY,
    request_id            TEXT NOT NULL UNIQUE,
    survivor_id           TEXT NOT NULL,
    counselor_id          TEXT NOT NULL,
    record_id             TEXT NOT NULL,
    recipient_wrapped_key TEXT NOT NULL,
    consent_statement     TEXT NOT NULL,
    status                TEXT NOT NULL CHECK (status IN ('active','revoked')),
    created_at            TEXT NOT NULL,
    expires_at            TEXT NOT NULL,
    first_opened_at       TEXT,
    revoked_at            TEXT,
    ledger_entry_id       TEXT NOT NULL
  );
  CREATE INDEX report_releases_survivor ON report_releases(survivor_id);
  CREATE INDEX report_releases_counselor ON report_releases(counselor_id);
  CREATE TABLE report_release_blobs (
    release_id            TEXT NOT NULL,
    blob_id               TEXT NOT NULL,
    recipient_wrapped_key TEXT NOT NULL,
    PRIMARY KEY (release_id, blob_id)
  );
  UPDATE matching_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'key_epoch';
  `,
  // ── v10: who ended a report release. Only the survivor's own revoke is a "no" (nobody may ask that entry again);
  // Matra also ends releases for her when the counselor later records a conflict, or when her entry is re-sealed into
  // a new group or withdrawn. Every earlier revoke was hers. No key_epoch bump (nothing in the sealed format changed).
  `
  ALTER TABLE report_releases ADD COLUMN revoke_reason TEXT CHECK (revoke_reason IN ('survivor','conflict','resealed','withdrawn'));
  UPDATE report_releases SET revoke_reason = 'survivor' WHERE status = 'revoked';
  `,
];

/**
 * A standalone OPRF key holder's own database (src/holder.ts): its quota counters, keyed by the app server's
 * pseudonymous token subject (same table shape as the app DB's oprf_quota, so SqliteQuotaStore works on both), and
 * its append-only daily evaluation totals.
 */
export function openHolderDb(dbPath: string): DB {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('secure_delete = ON');
  db.exec(`CREATE TABLE IF NOT EXISTS oprf_quota (
    user_id        TEXT NOT NULL,
    holder         TEXT NOT NULL,
    day            TEXT NOT NULL,
    day_count      INTEGER NOT NULL,
    lifetime_count INTEGER NOT NULL,
    PRIMARY KEY (user_id, holder)
  )`);
  // Append-only per-day totals (src/holder.ts HolderDailyTotals): rows can be added and counts can only grow.
  db.exec(`CREATE TABLE IF NOT EXISTS daily_totals (
    day         TEXT PRIMARY KEY,
    evaluations INTEGER NOT NULL,
    refused     INTEGER NOT NULL
  );
  CREATE TRIGGER IF NOT EXISTS daily_totals_no_delete BEFORE DELETE ON daily_totals
    BEGIN SELECT RAISE(ABORT, 'daily_totals is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS daily_totals_no_decrease BEFORE UPDATE ON daily_totals
    WHEN NEW.day IS NOT OLD.day OR NEW.evaluations < OLD.evaluations OR NEW.refused < OLD.refused
    BEGIN SELECT RAISE(ABORT, 'daily_totals is append-only'); END;`);
  return db;
}

/** Migrations (0-based index) that rebuild a referenced table and must run with foreign_keys OFF. */
const FK_OFF = new Set([3]);

export function openDb(dbPath: string): DB {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('secure_delete = ON'); // overwrite freed pages so shredded ciphertext doesn't linger on disk
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    // SQLite's documented table-rebuild procedure: FKs off (outside the transaction), rebuild, check, FKs on.
    const fkOff = FK_OFF.has(v);
    if (fkOff) db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        db.exec(MIGRATIONS[v]!);
        if (fkOff) {
          const bad = db.pragma('foreign_key_check') as unknown[];
          if (bad.length) throw new Error(`migration v${v + 1}: foreign key check failed`);
        }
        db.pragma(`user_version = ${v + 1}`);
      })();
    } finally {
      if (fkOff) db.pragma('foreign_keys = ON');
    }
  }
}
