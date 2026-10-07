import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { encryptJSON, escrowIdentifierHash, generateContentKey } from '@shield/crypto';
import { createRecord, makeApp, registerUser, uploadBlob, type TestUser } from './test-helpers.js';
import type express from 'express';
import { wrapKeyForRecipient } from '@shield/crypto';

async function seal(app: express.Express, u: TestUser, identifierHash: string) {
  const labelEnvelope = await encryptJSON({ label: 'person' }, await generateContentKey());
  return request(app).post('/api/escrow').set(u.auth).send({ identifierHash, labelEnvelope });
}

describe('blind escrow', () => {
  it('does not self-match; cross-user match flips all entries; no hashes leak', async () => {
    const { app, db } = makeApp();
    const a = await registerUser(app, 'survivor.a');
    const b = await registerUser(app, 'survivor.b');
    const h = await escrowIdentifierHash('email', 'Bad.Actor+x@gmail.com');
    const h2 = await escrowIdentifierHash('email', 'badactor@gmail.com');
    expect(h).toBe(h2);

    const a1 = await seal(app, a, h);
    expect(a1.status).toBe(201);
    expect(a1.body.entry.status).toBe('sealed');
    expect(Object.keys(a1.body.entry).sort()).toEqual(['createdAt', 'id', 'labelEnvelope', 'ledgerEntryId', 'status']);
    const a2 = await seal(app, a, h); // same survivor, same identifier
    expect(a2.body.entry.status).toBe('sealed');

    // the identifierHash is never stored raw
    expect(JSON.stringify(db.prepare('SELECT * FROM escrow_entries').all())).not.toContain(h);

    const other = await seal(app, b, await escrowIdentifierHash('phone', '555-000-1111'));
    expect(other.body.entry.status).toBe('sealed');

    const b1 = await seal(app, b, h);
    expect(b1.body.entry.status).toBe('matched');
    expect(b1.body.entry.matchedAt).toBeTruthy();
    const body = JSON.stringify(b1.body);
    expect(body).not.toContain(h);
    expect(body).not.toContain(a.user.id);

    const aEntries = (await request(app).get('/api/escrow').set(a.auth)).body.entries;
    expect(aEntries.map((e: { status: string }) => e.status)).toEqual(['matched', 'matched']);
    const bEntries = (await request(app).get('/api/escrow').set(b.auth)).body.entries;
    expect(bEntries.map((e: { status: string }) => e.status).sort()).toEqual(['matched', 'sealed']);

    const matchedLedger = db.prepare(`SELECT COUNT(*) n FROM ledger WHERE type = 'escrow.matched'`).get() as { n: number };
    expect(matchedLedger.n).toBe(3);
    expect((await request(app).get('/api/ledger/verify')).body.ok).toBe(true);

    const atty = await registerUser(app, 'atty.x', 'attorney');
    expect((await seal(app, atty, h)).status).toBe(403);
  });
});

describe('account crypto-shredding', () => {
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
        consentStatement: 'I consent to share my case file with this attorney.',
        scope: ['record', 'evidence'],
        survivorAlias: 'J.',
      });
    expect(share.status).toBe(201);
    await seal(app, jane, 'a'.repeat(64));
    const ledgerBefore = (db.prepare('SELECT COUNT(*) n FROM ledger').get() as { n: number }).n;

    const del = await request(app).post('/api/account/delete').set(jane.auth);
    expect(del.body).toEqual({ ok: true });

    const count = (sql: string) => (db.prepare(sql).get(jane.user.id) as { n: number }).n;
    expect(count('SELECT COUNT(*) n FROM users WHERE id = ?')).toBe(0);
    expect(count('SELECT COUNT(*) n FROM records WHERE owner_id = ?')).toBe(0);
    expect(count('SELECT COUNT(*) n FROM blobs WHERE owner_id = ?')).toBe(0);
    expect(count('SELECT COUNT(*) n FROM shares WHERE survivor_id = ?')).toBe(0);
    expect(count('SELECT COUNT(*) n FROM escrow_entries WHERE user_id = ?')).toBe(0);
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
});
