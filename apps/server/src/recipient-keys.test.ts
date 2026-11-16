/**
 * A recipient's copy of a key is deleted when access ends (src/recipient-keys.ts): at once on revoke, 30 days after
 * expiry by the housekeeping sweep. Renewing a share after that takes a fresh wrap from her device. Report releases are
 * covered in staged-release.test.ts; here, shares, the v13 migration, and the sweep with sealed matching off.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type express from 'express';
import { decryptBlob, decryptJSON, publicKeyFingerprint, unwrapKeyWithPrivate, wrapKeyForRecipient } from '@matra/crypto';
import { getDb } from './app.js';
import { openDb } from './db.js';
import { WRAP_GRACE_DAYS, sweepRecipientKeys } from './recipient-keys.js';
import { TEST_ALIAS, createRecord, shareConsent, makeApp, makeMatchingApp, registerUser, uploadBlob, type TestUser } from './test-helpers.js';

const DAY = 86_400_000;
const binary = (res: any, cb: (e: Error | null, b: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

/** Jane shares a record and one of two files with an attorney. */
async function shared(dbPath?: string) {
  const { app } = makeApp(dbPath ? { dbPath } : {});
  const db = getDb(app);
  const jane = await registerUser(app, 'jane.keys');
  const atty = await registerUser(app, 'atty.keys', 'attorney');
  const rec = await createRecord(app, jane, { narrative: 'her words' });
  const file = await uploadBlob(app, jane, new TextEncoder().encode('photo'));
  const other = await uploadBlob(app, jane, new TextEncoder().encode('not shared'));
  const FP = await publicKeyFingerprint(atty.user.publicKey);
  const res = await request(app)
    .post('/api/shares')
    .set(jane.auth)
    .send({
      recordId: rec.res.body.record.id,
      attorneyId: atty.user.id,
      recipientWrappedKey: await wrapKeyForRecipient(rec.key, atty.user.publicKey),
      blobs: [{ blobId: file.res.body.blob.id, recipientWrappedKey: await wrapKeyForRecipient(file.key, atty.user.publicKey) }],
      consentStatement: shareConsent(FP, 1),
      attorneyKeyFingerprint: FP,
      scope: ['record', 'evidence'],
      survivorAlias: TEST_ALIAS,
    });
  expect(res.status).toBe(201);
  return { app, db, jane, atty, rec, file, other, share: res.body.share as { id: string } };
}

const wrapsOf = (app: express.Express, shareId: string) => ({
  record: (getDb(app).prepare('SELECT recipient_wrapped_key AS k FROM shares WHERE id = ?').get(shareId) as { k: string | null }).k,
  files: (getDb(app).prepare('SELECT recipient_wrapped_key AS k FROM share_blobs WHERE share_id = ?').all(shareId) as Array<{ k: string | null }>).map((r) => r.k),
});
const expireAgo = (app: express.Express, shareId: string, days: number) =>
  getDb(app).prepare('UPDATE shares SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - days * DAY).toISOString(), shareId);
const myShare = async (app: express.Express, u: TestUser, id: string) =>
  ((await request(app).get('/api/shares').set(u.auth)).body.shares as Array<{ id: string; keyDeleted?: boolean; blobIds?: string[] }>).find((s) => s.id === id)!;

describe('revoking a share deletes the attorney’s copies of the keys', () => {
  it('in the same transaction as the revoke; the share row, consent text and ledger stay', async () => {
    const { app, jane, atty, share } = await shared();
    expect(wrapsOf(app, share.id).record).not.toBeNull();
    expect((await request(app).post(`/api/shares/${share.id}/revoke`).set(jane.auth)).status).toBe(200);
    expect(wrapsOf(app, share.id)).toEqual({ record: null, files: [null] });
    expect(await myShare(app, jane, share.id)).toMatchObject({ status: 'revoked', keyDeleted: true });
    expect((await request(app).get(`/api/shares/${share.id}/bundle`).set(atty.auth)).body.code).toBe('share_revoked');
    expect((await request(app).get('/api/ledger/verify')).body.ok).toBe(true);
  });

  it('a revoke that fails leaves the keys (one transaction)', async () => {
    const { app, db, jane, share } = await shared();
    // the ledger refuses the append: the whole revoke rolls back, keys included
    db.exec(`CREATE TRIGGER fail_ledger BEFORE INSERT ON ledger BEGIN SELECT RAISE(ABORT, 'test'); END;`);
    expect((await request(app).post(`/api/shares/${share.id}/revoke`).set(jane.auth)).status).toBe(500);
    db.exec('DROP TRIGGER fail_ledger');
    expect(wrapsOf(app, share.id).record).not.toBeNull();
    expect(wrapsOf(app, share.id).files[0]).not.toBeNull();
  });
});

describe('expiry: kept for 30 days, then swept', () => {
  it(`keeps the keys for ${WRAP_GRACE_DAYS} days after expiry (renewal needs nothing new), then deletes them`, async () => {
    const { app, jane, atty, share } = await shared();
    expireAgo(app, share.id, WRAP_GRACE_DAYS - 1);
    app.locals.housekeeping();
    expect(wrapsOf(app, share.id).record).not.toBeNull();
    // within the grace period a plain renewal works, and a fresh wrap is refused
    expect((await request(app).post(`/api/shares/${share.id}/renew`).set(jane.auth).send({ recipientWrappedKey: await wrapKeyForRecipient(
      (await createRecord(app, jane)).key, atty.user.publicKey) })).body.code).toBe('rewrap_not_needed');
    expect((await request(app).post(`/api/shares/${share.id}/renew`).set(jane.auth).send({})).status).toBe(200);
    expect((await request(app).get(`/api/shares/${share.id}/bundle`).set(atty.auth)).status).toBe(200);

    expireAgo(app, share.id, WRAP_GRACE_DAYS + 1);
    app.locals.housekeeping();
    expect(wrapsOf(app, share.id)).toEqual({ record: null, files: [null] });
    // still 'active' (she may renew), but nothing opens: the bundle says expired
    expect((await request(app).get(`/api/shares/${share.id}/bundle`).set(atty.auth)).body.code).toBe('share_expired');
    expect(await myShare(app, jane, share.id)).toMatchObject({ status: 'active', keyDeleted: true });
  });

  it('the sweep is idempotent and counts what it deleted', async () => {
    const { db, app, share } = await shared();
    expireAgo(app, share.id, 40);
    expect(sweepRecipientKeys(db)).toEqual({ shares: 1, releases: 0 });
    expect(sweepRecipientKeys(db)).toEqual({ shares: 0, releases: 0 });
  });
});

describe('renewing after the keys were deleted takes a fresh wrap from her device', () => {
  it('refuses without one, with the wrong files, or to a different key; accepts exactly the same record and files', async () => {
    const { app, db, jane, atty, rec, file, other, share } = await shared();
    expireAgo(app, share.id, WRAP_GRACE_DAYS + 5);
    app.locals.housekeeping();
    const mine = await myShare(app, jane, share.id);
    expect(mine.blobIds).toEqual([file.res.body.blob.id]);

    expect((await request(app).post(`/api/shares/${share.id}/renew`).set(jane.auth).send({})).body.code).toBe('rewrap_required');
    const recordWrap = await wrapKeyForRecipient(rec.key, atty.user.publicKey);
    const fileWrap = await wrapKeyForRecipient(file.key, atty.user.publicKey);
    // a different set of files than she consented to
    const wrong = await request(app)
      .post(`/api/shares/${share.id}/renew`)
      .set(jane.auth)
      .send({ recipientWrappedKey: recordWrap, blobs: [{ blobId: other.res.body.blob.id, recipientWrappedKey: fileWrap }] });
    expect(wrong.body.code).toBe('rewrap_mismatch');
    expect((await request(app).post(`/api/shares/${share.id}/renew`).set(jane.auth).send({ recipientWrappedKey: recordWrap })).body.code).toBe('rewrap_mismatch');
    // the attorney's key changed since she confirmed it: never re-wrapped to a key she didn't confirm
    const realKey = (db.prepare('SELECT public_key FROM users WHERE id = ?').get(atty.user.id) as { public_key: string }).public_key;
    db.prepare('UPDATE users SET public_key = ? WHERE id = ?').run(JSON.stringify(jane.user.publicKey), atty.user.id);
    const mismatch = await request(app)
      .post(`/api/shares/${share.id}/renew`)
      .set(jane.auth)
      .send({ recipientWrappedKey: recordWrap, blobs: [{ blobId: file.res.body.blob.id, recipientWrappedKey: fileWrap }] });
    expect(mismatch.body.code).toBe('attorney_key_mismatch');
    db.prepare('UPDATE users SET public_key = ? WHERE id = ?').run(realKey, atty.user.id);
    expect(wrapsOf(app, share.id).record).toBeNull();

    const ok = await request(app)
      .post(`/api/shares/${share.id}/renew`)
      .set(jane.auth)
      .send({ expiresInDays: 30, recipientWrappedKey: recordWrap, blobs: [{ blobId: file.res.body.blob.id, recipientWrappedKey: fileWrap }] });
    expect(ok.status).toBe(200);
    expect(ok.body.ledgerEntry.type).toBe('share.renewed');
    expect(ok.body.share.keyDeleted).toBeUndefined();

    // the attorney opens the record and the file again
    const bundle = await request(app).get(`/api/shares/${share.id}/bundle`).set(atty.auth);
    expect(bundle.status).toBe(200);
    const rk = await unwrapKeyWithPrivate(bundle.body.recipientWrappedKey, atty.privateKey);
    expect(await decryptJSON(bundle.body.record.envelope, rk)).toEqual({ narrative: 'her words' });
    const fk = await unwrapKeyWithPrivate(bundle.body.blobs[0].recipientWrappedKey, atty.privateKey);
    const dl = await request(app).get(`/api/vault/blobs/${file.res.body.blob.id}`).set(atty.auth).buffer(true).parse(binary);
    expect(new TextDecoder().decode(await decryptBlob(new Uint8Array(dl.body), fk))).toBe('photo');
    expect((await request(app).get('/api/ledger/verify')).body.ok).toBe(true);
  });
});

describe('with sealed matching off', () => {
  it('housekeeping ends live report releases for her and deletes the keys of old ones; the routes stay 404', async () => {
    const { app } = makeApp();
    const db = getDb(app);
    const jane = await registerUser(app, 'jane.off');
    const loc = await registerUser(app, 'loc.off', 'attorney'); // any second account; counselor sign-up is off
    const insert = db.prepare(
      `INSERT INTO report_releases (id, request_id, survivor_id, counselor_id, record_id, recipient_wrapped_key, consent_statement, status,
                                    created_at, expires_at, ledger_entry_id) VALUES (?, ?, ?, ?, 'r1', '{"v":1}', 'yes', 'active', ?, ?, 'l1')`,
    );
    const old = new Date(Date.now() - 45 * DAY).toISOString();
    insert.run('rel-old', 'rq-old', jane.user.id, loc.user.id, old, old);
    insert.run('rel-live', 'rq-live', jane.user.id, loc.user.id, new Date().toISOString(), new Date(Date.now() + 60 * DAY).toISOString());
    db.prepare(`INSERT INTO report_release_blobs (release_id, blob_id, recipient_wrapped_key) VALUES ('rel-live', 'b1', '{"v":1}')`).run();
    app.locals.housekeeping();
    const rows = db.prepare('SELECT id, status, revoke_reason AS reason, recipient_wrapped_key AS k FROM report_releases ORDER BY id').all();
    expect(rows).toEqual([
      // a live one is ended for her (she could neither see nor end it while matching is off)
      { id: 'rel-live', status: 'revoked', reason: 'matching_off', k: null },
      // an expired one too (it was still 'active'); both lose the counselor's copy of the keys
      { id: 'rel-old', status: 'revoked', reason: 'matching_off', k: null },
    ]);
    expect(db.prepare('SELECT recipient_wrapped_key AS k FROM report_release_blobs').get()).toEqual({ k: null });
    const ledger = db.prepare(`SELECT subject_id FROM ledger WHERE type = 'report.revoked' ORDER BY subject_id`).all();
    expect(ledger).toEqual([{ subject_id: 'rel-live' }, { subject_id: 'rel-old' }]);
    const trail = (await request(app).get('/api/audit').set(jane.auth)).body.events as Array<{ detail: string }>;
    expect(trail.filter((e) => /sealed matching is turned off on this server/.test(e.detail))).toHaveLength(2);
    // nothing is deleted, the guard is unchanged, and a second run does nothing new
    app.locals.housekeeping();
    expect(db.prepare(`SELECT COUNT(*) AS n FROM ledger WHERE type = 'report.revoked'`).get()).toEqual({ n: 2 });
    expect((await request(app).post('/api/report-releases/rel-live/revoke').set(jane.auth)).body.code).toBe('matching_disabled');
    expect((await request(app).get('/api/ledger/verify')).body.ok).toBe(true);
  });

  it('with matching on, housekeeping leaves live releases alone', async () => {
    const { app } = makeMatchingApp();
    const db = getDb(app);
    const jane = await registerUser(app, 'jane.on');
    db.prepare(
      `INSERT INTO report_releases (id, request_id, survivor_id, counselor_id, record_id, recipient_wrapped_key, consent_statement, status,
                                    created_at, expires_at, ledger_entry_id) VALUES ('rel', 'rq', ?, ?, 'r1', '{"v":1}', 'yes', 'active', ?, ?, 'l1')`,
    ).run(jane.user.id, jane.user.id, new Date().toISOString(), new Date(Date.now() + 60 * DAY).toISOString());
    app.locals.housekeeping();
    expect(db.prepare('SELECT status, recipient_wrapped_key AS k FROM report_releases').get()).toEqual({ status: 'active', k: '{"v":1}' });
  });
});

describe('migration v13', () => {
  it('makes the four wrap columns nullable, keeps every row, and deletes the keys of shares already revoked', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matra-v13-'));
    try {
      const file = path.join(dir, 'old.db');
      const { app, db, jane, atty, rec } = await shared(file);
      // a second share of Jane's, revoked under the old schema (when revoking kept the keys)
      const FP = await publicKeyFingerprint(atty.user.publicKey);
      const second = await request(app)
        .post('/api/shares')
        .set(jane.auth)
        .send({
          recordId: rec.res.body.record.id, attorneyId: atty.user.id, recipientWrappedKey: await wrapKeyForRecipient(rec.key, atty.user.publicKey),
          blobs: [], consentStatement: shareConsent(FP, 0), attorneyKeyFingerprint: FP, scope: ['record'], survivorAlias: TEST_ALIAS,
        });
      db.prepare(`UPDATE shares SET status = 'revoked', revoked_at = ? WHERE id = ?`).run(new Date().toISOString(), second.body.share.id);
      // back to the v12 shape: NOT NULL wrap columns
      db.pragma('foreign_keys = OFF');
      db.exec(`
        CREATE TABLE s12 AS SELECT * FROM shares; DROP TABLE shares;
        CREATE TABLE shares (id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES records(id), survivor_id TEXT NOT NULL REFERENCES users(id),
          attorney_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL CHECK (status IN ('active','revoked')), consent_statement TEXT NOT NULL,
          scope TEXT NOT NULL, recipient_wrapped_key TEXT NOT NULL, survivor_alias TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT,
          ledger_entry_id TEXT NOT NULL REFERENCES ledger(id), expires_at TEXT);
        INSERT INTO shares SELECT id, record_id, survivor_id, attorney_id, status, consent_statement, scope, recipient_wrapped_key, survivor_alias,
          created_at, revoked_at, ledger_entry_id, expires_at FROM s12; DROP TABLE s12;
        CREATE INDEX shares_survivor ON shares(survivor_id); CREATE INDEX shares_attorney ON shares(attorney_id);
        CREATE TABLE b12 AS SELECT * FROM share_blobs; DROP TABLE share_blobs;
        CREATE TABLE share_blobs (share_id TEXT NOT NULL REFERENCES shares(id), blob_id TEXT NOT NULL REFERENCES blobs(id),
          recipient_wrapped_key TEXT NOT NULL, PRIMARY KEY (share_id, blob_id));
        INSERT INTO share_blobs SELECT share_id, blob_id, recipient_wrapped_key FROM b12; DROP TABLE b12;
        CREATE INDEX share_blobs_blob ON share_blobs(blob_id);
      `);
      db.pragma('user_version = 12');
      db.close();

      const db2 = openDb(file);
      expect(db2.pragma('user_version', { simple: true })).toBe(13);
      for (const t of ['shares', 'share_blobs', 'report_releases', 'report_release_blobs']) {
        const col = (db2.pragma(`table_info(${t})`) as Array<{ name: string; notnull: number }>).find((c) => c.name === 'recipient_wrapped_key')!;
        expect(col.notnull).toBe(0);
      }
      expect(db2.pragma('foreign_key_check')).toEqual([]);
      const rows = db2.prepare('SELECT id, status, recipient_wrapped_key AS k FROM shares ORDER BY created_at').all() as Array<{ id: string; status: string; k: string | null }>;
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.status === 'active')!.k).not.toBeNull();
      expect(rows.find((r) => r.status === 'revoked')!.k).toBeNull();
      expect((db2.prepare('SELECT recipient_wrapped_key AS k FROM share_blobs').get() as { k: string | null }).k).not.toBeNull();
      // the WORM triggers and indexes on other tables are untouched
      expect(db2.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'shares' AND name LIKE 'shares_%'`).all()).toHaveLength(2);
      db2.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
