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
  const ledgerLen = (db: ReturnType<typeof makeApp>['db']) => (db.prepare('SELECT COUNT(*) n FROM ledger').get() as { n: number }).n;
  const dbStatuses = (db: ReturnType<typeof makeApp>['db'], userId: string) =>
    (db.prepare('SELECT status FROM escrow_entries WHERE user_id = ? ORDER BY rowid').all(userId) as Array<{ status: string }>).map((r) => r.status);

  it('does not self-match; cross-user match flips all entries in the DB; no hashes leak', async () => {
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
    expect(dbStatuses(db, a.user.id)).toEqual(['sealed', 'sealed']); // no self-match

    // the identifierHash is never stored raw
    expect(JSON.stringify(db.prepare('SELECT * FROM escrow_entries').all())).not.toContain(h);

    const other = await seal(app, b, await escrowIdentifierHash('phone', '555-000-1111'));
    expect(other.body.entry.status).toBe('sealed');

    const b1 = await seal(app, b, h);
    expect(b1.status).toBe(201);
    const body = JSON.stringify(b1.body);
    expect(body).not.toContain(h);
    expect(body).not.toContain(a.user.id);

    // real state: matched, in the DB only
    expect(dbStatuses(db, a.user.id)).toEqual(['matched', 'matched']);
    expect(dbStatuses(db, b.user.id)).toEqual(['sealed', 'matched']);
    const matchedAt = db.prepare(`SELECT matched_at FROM escrow_entries WHERE status = 'matched'`).all() as Array<{ matched_at: string | null }>;
    expect(matchedAt).toHaveLength(3);
    for (const r of matchedAt) expect(r.matched_at).toBeTruthy();

    expect((await request(app).get('/api/ledger/verify')).body.ok).toBe(true);
    const atty = await registerUser(app, 'atty.x', 'attorney');
    expect((await seal(app, atty, h)).status).toBe(403);
  });

  it('survivors only ever see "sealed" — a perpetrator posing as a survivor cannot self-check', async () => {
    const { app, db } = makeApp();
    const victim = await registerUser(app, 'survivor.v');
    const perp = await registerUser(app, 'not.a.survivor');
    const h = await escrowIdentifierHash('phone', '(201) 555-0100');
    await seal(app, victim, h);

    const p1 = await seal(app, perp, await escrowIdentifierHash('phone', '+1 201 555 0100'));
    expect(p1.status).toBe(201);
    expect(p1.body.entry.status).toBe('sealed');
    expect(p1.body.entry).not.toHaveProperty('matchedAt');
    expect(dbStatuses(db, perp.user.id)).toEqual(['matched']); // the match really happened

    for (const u of [victim, perp]) {
      const entries = (await request(app).get('/api/escrow').set(u.auth)).body.entries as Array<Record<string, unknown>>;
      expect(entries.length).toBeGreaterThan(0);
      for (const e of entries) {
        expect(e.status).toBe('sealed');
        expect(e).not.toHaveProperty('matchedAt');
      }
      // nothing in the survivor's own audit trail reveals it either
      const events = JSON.stringify((await request(app).get('/api/audit').set(u.auth)).body.events);
      expect(events).not.toMatch(/match/i);
    }
  });

  it('ledger grows by exactly one entry per submission, match or not; no escrow.matched entries', async () => {
    const { app, db } = makeApp();
    const a = await registerUser(app, 'survivor.a');
    const b = await registerUser(app, 'survivor.b');
    const h = await escrowIdentifierHash('email', 'someone@example.com');

    const steps: Array<[TestUser, string]> = [
      [a, h], // sealed
      [a, h], // same user — no match
      [b, await escrowIdentifierHash('email', 'other@example.com')], // unrelated
      [b, h], // cross-user match
      [b, h], // already matched hash
    ];
    for (const [u, hash] of steps) {
      const before = ledgerLen(db);
      const headBefore = (await request(app).get('/api/ledger/head')).body.seq;
      expect((await seal(app, u, hash)).status).toBe(201);
      expect(ledgerLen(db)).toBe(before + 1);
      expect((await request(app).get('/api/ledger/head')).body.seq).toBe(headBefore + 1);
    }
    expect(dbStatuses(db, b.user.id)).toEqual(['sealed', 'matched', 'matched']);
    const types = (db.prepare('SELECT DISTINCT type FROM ledger').all() as Array<{ type: string }>).map((r) => r.type);
    expect(types).toEqual(['escrow.sealed']);
    expect((await request(app).get('/api/ledger/verify')).body.ok).toBe(true);
  });

  it('match counts are released only to the verified attorney with an active share', async () => {
    const { app } = makeApp();
    const jane = await registerUser(app, 'jane.test');
    const other = await registerUser(app, 'other.survivor');
    const atty = await registerUser(app, 'atty.nj', 'attorney');
    const h = await escrowIdentifierHash('social_handle', '@bad_guy', 'instagram');
    await seal(app, jane, h);
    await seal(app, jane, await escrowIdentifierHash('email', 'unrelated@example.com'));

    const { res, key } = await createRecord(app, jane);
    const share = (
      await request(app)
        .post('/api/shares')
        .set(jane.auth)
        .send({
          recordId: res.body.record.id,
          attorneyId: atty.user.id,
          recipientWrappedKey: await wrapKeyForRecipient(key, atty.user.publicKey),
          blobs: [],
          consentStatement: 'I consent to share my case file with this attorney.',
          scope: ['record'],
          survivorAlias: 'J.',
        })
    ).body.share;

    const open = async () => (await request(app).get(`/api/shares/${share.id}/bundle`).set(atty.auth)).body;
    expect((await open()).escrow).toEqual({ sealedCount: 2, matchedCount: 0 });

    await seal(app, other, await escrowIdentifierHash('social_handle', 'Bad_Guy', 'Instagram'));
    const bundle = await open();
    expect(bundle.escrow).toEqual({ sealedCount: 1, matchedCount: 1 });
    const text = JSON.stringify(bundle);
    expect(text).not.toContain(h);
    expect(text).not.toContain(other.user.id);
    expect(text).not.toContain('other.survivor');

    // the survivor herself still sees only 'sealed', and her audit trail doesn't reveal it
    const mine = (await request(app).get('/api/escrow').set(jane.auth)).body.entries as Array<{ status: string }>;
    expect(mine.map((e) => e.status)).toEqual(['sealed', 'sealed']);
    expect(JSON.stringify((await request(app).get('/api/audit').set(jane.auth)).body.events)).not.toMatch(/match/i);

    // revoked share → no bundle, no counts
    await request(app).post(`/api/shares/${share.id}/revoke`).set(jane.auth);
    expect((await request(app).get(`/api/shares/${share.id}/bundle`).set(atty.auth)).status).toBe(403);
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
