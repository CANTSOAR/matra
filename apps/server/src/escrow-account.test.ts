import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import request from 'supertest';
import { publicKeyFingerprint, wrapKeyForRecipient } from '@matra/crypto';
import { createRecord, makeApp, registerUser, sealMatch, uploadBlob } from './test-helpers.js';

describe('account deletion', () => {
  it('deletes all user data but keeps the ledger intact', async () => {
    const { app, db } = makeApp();
    const jane = await registerUser(app, 'jane.test');
    const keep = await registerUser(app, 'keeper.test');
    const atty = await registerUser(app, 'atty.nj', 'attorney');
    const { res, key } = await createRecord(app, jane);
    const v2 = await createRecord(app, jane, { v: 2 }, res.body.record.id);
    expect(v2.res.status).toBe(201);
    const blob = (await uploadBlob(app, jane)).res.body.blob.id;
    await createRecord(app, keep);
    const share = await request(app)
      .post('/api/shares')
      .set(jane.auth)
      .send({
        recordId: res.body.record.id,
        attorneyId: atty.user.id,
        recipientWrappedKey: await wrapKeyForRecipient(key, atty.user.publicKey),
        blobs: [{ blobId: blob, recipientWrappedKey: await wrapKeyForRecipient(key, atty.user.publicKey) }],
        consentStatement: `I consent to share my case file with this attorney. ${await publicKeyFingerprint(atty.user.publicKey)}`,
          attorneyKeyFingerprint: await publicKeyFingerprint(atty.user.publicKey),
        scope: ['record', 'evidence'],
        survivorAlias: 'J.',
      });
    expect(share.status).toBe(201);
    await registerUser(app, 'loc.test', 'counselor');
    await sealMatch(app, jane, 'email', 'someone@example.com');
    expect((db.prepare('SELECT COUNT(*) n FROM oprf_quota WHERE user_id = ?').get(jane.user.id) as { n: number }).n).toBe(4); // one row per key holder (2-of-3: all three answer) + the account-level budget
    const ledgerBefore = (db.prepare('SELECT COUNT(*) n FROM ledger').get() as { n: number }).n;

    // a session alone can't delete: her passphrase (its auth key) is required again, and a wrong one deletes nothing
    const noKey = await request(app).post('/api/account/delete').set(jane.auth);
    expect(noKey.status).toBe(400);
    const wrong = await request(app).post('/api/account/delete').set(jane.auth).send({ authKey: atty.authKey });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('invalid_credentials');
    expect((db.prepare('SELECT COUNT(*) n FROM records WHERE owner_id = ?').get(jane.user.id) as { n: number }).n).toBeGreaterThan(0);
    const events = (await request(app).get('/api/audit').set(jane.auth)).body.events as Array<{ action: string }>;
    expect(events.map((e) => e.action)).toContain('auth.delete_reauth_failed');

    const del = await request(app).post('/api/account/delete').set(jane.auth).send({ authKey: jane.authKey });
    expect(del.body).toEqual({ ok: true });

    const count = (sql: string) => (db.prepare(sql).get(jane.user.id) as { n: number }).n;
    expect(count('SELECT COUNT(*) n FROM users WHERE id = ?')).toBe(0);
    expect(count('SELECT COUNT(*) n FROM records WHERE owner_id = ?')).toBe(0);
    expect(count('SELECT COUNT(*) n FROM blobs WHERE owner_id = ?')).toBe(0);
    expect(count('SELECT COUNT(*) n FROM shares WHERE survivor_id = ?')).toBe(0);
    expect(count('SELECT COUNT(*) n FROM match_entries WHERE user_id = ?')).toBe(0);
    expect(count('SELECT COUNT(*) n FROM oprf_quota WHERE user_id = ?')).toBe(0);
    expect((db.prepare('SELECT COUNT(*) n FROM match_seals').get() as { n: number }).n).toBe(0);
    expect(count('SELECT COUNT(*) n FROM sessions WHERE user_id = ?')).toBe(0);
    expect(count('SELECT COUNT(*) n FROM audit_events WHERE user_id = ?')).toBe(0);
    expect((db.prepare('SELECT COUNT(*) n FROM shred_authorizations').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) n FROM records').get() as { n: number }).n).toBe(1); // keeper's

    // ledger kept + one account.shredded entry, chain still valid
    const v = await request(app).get('/api/ledger/verify');
    expect(v.body).toMatchObject({ ok: true, length: ledgerBefore + 1 });
    const last = db.prepare('SELECT type, subject_id FROM ledger ORDER BY seq DESC LIMIT 1').get() as { type: string; subject_id: string };
    expect(last).toEqual({ type: 'account.shredded', subject_id: jane.user.id });

    expect((await request(app).get('/api/me').set(jane.auth)).status).toBe(401);
    expect((await request(app).get('/api/shares').set(atty.auth)).body.shares).toHaveLength(0);
    // records of other users are still protected by the trigger
    expect(() => db.prepare('DELETE FROM records').run()).toThrow(/immutable/);
  });

  it('empties the WAL after deleting, so her deleted pages are not left in it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matra-delete-'));
    onTestFinished(() => fs.rmSync(dir, { recursive: true, force: true }));
    const { app } = makeApp({ dbPath: path.join(dir, 'matra.db') });
    const jane = await registerUser(app, 'jane.wal');
    await createRecord(app, jane, { narrative: 'words' });
    await uploadBlob(app, jane);
    expect(fs.statSync(path.join(dir, 'matra.db-wal')).size).toBeGreaterThan(0);
    const del = await request(app).post('/api/account/delete').set(jane.auth).send({ authKey: jane.authKey });
    expect(del.status).toBe(200);
    expect(fs.statSync(path.join(dir, 'matra.db-wal')).size).toBe(0);
  });
});
