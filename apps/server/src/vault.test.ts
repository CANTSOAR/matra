import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { checkLedgerProof, decryptJSON, sha256Hex, unwrapKeyWithMaster } from '@matra/crypto';
import type { LedgerProofResponse } from '@matra/shared';
import { createRecord, makeApp, registerUser, uploadBlob } from './test-helpers.js';
import { computeEntryHash } from './ledger.js';
import { GENESIS_HASH } from './db.js';

const binary = (res: any, cb: (e: Error | null, b: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('vault records + WORM ledger', () => {
  it('creates a record, seals it in the ledger, and round-trips ciphertext', async () => {
    const { app } = makeApp();
    const u = await registerUser(app, 'jane.test');
    const { res, envelope } = await createRecord(app, u, { narrative: 'my words' });
    expect(res.status).toBe(201);
    const { record, ledgerEntry } = res.body;
    // contentHash = SHA-256 of canonical envelope JSON, computable client-side
    const expected = await sha256Hex(JSON.stringify({ v: envelope.v, alg: envelope.alg, iv: envelope.iv, ct: envelope.ct }));
    expect(record.contentHash).toBe(expected);
    expect(ledgerEntry).toMatchObject({ seq: 1, type: 'record.sealed', subjectId: record.id, contentHash: expected, prevHash: GENESIS_HASH });
    expect(record.ledgerEntryId).toBe(ledgerEntry.id);
    expect(ledgerEntry.entryHash).toBe(
      computeEntryHash(1, 'record.sealed', record.id, expected, ledgerEntry.timestamp, GENESIS_HASH),
    );

    const got = await request(app).get(`/api/vault/records/${record.id}`).set(u.auth);
    const key = await unwrapKeyWithMaster(got.body.record.ownerWrappedKey, u.masterKey);
    expect(await decryptJSON(got.body.record.envelope, key)).toEqual({ narrative: 'my words' });

    const list = await request(app).get('/api/vault/records').set(u.auth);
    expect(list.body.records).toHaveLength(1);
    expect(list.body.records[0].envelope).toBeUndefined();

    const entry = await request(app).get(`/api/ledger/entries/${ledgerEntry.id}`);
    expect(entry.body.entry).toEqual(ledgerEntry);
  });

  it('records are immutable at the database level; versions use supersedes', async () => {
    const { app, db } = makeApp();
    const u = await registerUser(app, 'jane.test');
    const v1 = (await createRecord(app, u, { v: 1 })).res.body.record;
    expect(() => db.prepare('UPDATE records SET content_hash = ? WHERE id = ?').run('x', v1.id)).toThrow(/immutable/);
    expect(() => db.prepare('DELETE FROM records WHERE id = ?').run(v1.id)).toThrow(/immutable/);
    expect(() => db.prepare('UPDATE ledger SET type = ?').run('x')).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM ledger').run()).toThrow(/append-only/);
    // forged insert that doesn't extend the chain is rejected
    expect(() =>
      db
        .prepare(`INSERT INTO ledger (seq,id,type,subject_id,content_hash,timestamp,prev_hash,entry_hash) VALUES (99,'f','x','x','x','x','x','x')`)
        .run(),
    ).toThrow(/hash chain/);

    const v2 = await createRecord(app, u, { v: 2 }, v1.id);
    expect(v2.res.status).toBe(201);
    expect(v2.res.body.record.supersedes).toBe(v1.id);
  });

  it('owner-only access to records; cannot supersede others', async () => {
    const { app } = makeApp();
    const a = await registerUser(app, 'jane.test');
    const b = await registerUser(app, 'mallory.test');
    const rec = (await createRecord(app, a)).res.body.record;
    expect((await request(app).get(`/api/vault/records/${rec.id}`).set(b.auth)).status).toBe(403);
    expect((await request(app).get(`/api/vault/records/${rec.id}`)).status).toBe(401);
    expect((await createRecord(app, b, {}, rec.id)).res.status).toBe(403);
    expect((await request(app).get('/api/vault/records').set(b.auth)).body.records).toHaveLength(0);
  });

  it('ledger verify detects tampering', async () => {
    const { app, db } = makeApp();
    const u = await registerUser(app, 'jane.test');
    await createRecord(app, u);
    await createRecord(app, u);
    await uploadBlob(app, u);
    let v = await request(app).get('/api/ledger/verify');
    expect(v.body).toMatchObject({ ok: true, length: 3 });
    const head = await request(app).get('/api/ledger/head');
    expect(head.body.seq).toBe(3);
    expect(head.body.entryHash).toBe(v.body.headHash);

    // An attacker with raw DB access must first drop the trigger — and is still caught.
    db.exec('DROP TRIGGER ledger_no_update');
    db.prepare(`UPDATE ledger SET content_hash = ? WHERE seq = 2`).run('f'.repeat(64));
    v = await request(app).get('/api/ledger/verify');
    expect(v.body).toMatchObject({ ok: false, length: 3, brokenAtSeq: 2 });
  });

  it('blobs: upload, hash, owner download, access control', async () => {
    const { app } = makeApp();
    const a = await registerUser(app, 'jane.test');
    const b = await registerUser(app, 'mallory.test');
    const { res, ct } = await uploadBlob(app, a);
    expect(res.status).toBe(201);
    expect(res.body.blob.contentHash).toBe(await sha256Hex(ct));
    expect(res.body.blob.sizeBytes).toBe(ct.length);
    expect(res.body.ledgerEntry.type).toBe('blob.sealed');
    expect(res.body.blob.ownerWrappedKey.alg).toBe('A256GCM-KW');

    const dl = await request(app).get(`/api/vault/blobs/${res.body.blob.id}`).set(a.auth).buffer(true).parse(binary);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toMatch(/application\/octet-stream/);
    expect(Buffer.compare(dl.body, Buffer.from(ct))).toBe(0);

    expect((await request(app).get(`/api/vault/blobs/${res.body.blob.id}`).set(b.auth)).status).toBe(403);
    expect((await request(app).get(`/api/vault/blobs/${'0'.repeat(32)}`).set(a.auth)).status).toBe(404);
    expect((await request(app).get('/api/vault/blobs').set(b.auth)).body.blobs).toHaveLength(0);

    const noKey = await request(app)
      .post('/api/vault/blobs')
      .set(a.auth)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.alloc(64));
    expect(noKey.body.code).toBe('invalid_wrapped_key');
    const wrongType = await request(app).post('/api/vault/blobs').set(a.auth).send({ x: 1 });
    expect(wrongType.status).toBe(415);
  });
});

describe('ledger proof lookup (the in-browser checker, /verify)', () => {
  it('answers only exact sealed-content hashes, with bare links to the head that the client can check', async () => {
    const { app, db } = makeApp();
    const a = await registerUser(app, 'proof.a');
    const b = await registerUser(app, 'proof.b');
    const rec = (await createRecord(app, a, { story: 'mine' })).res.body;
    const blob = (await uploadBlob(app, a)).res.body;
    await createRecord(app, b, { story: 'someone else' });

    const res = await request(app).post('/api/ledger/proof').send({ contentHashes: [rec.record.contentHash, blob.blob.contentHash] });
    expect(res.status).toBe(200);
    const proof = res.body as LedgerProofResponse;
    expect(proof.entries.map((e) => [e.type, e.subjectId])).toEqual([
      ['record.sealed', rec.record.id],
      ['blob.sealed', blob.blob.id],
    ]);
    // links carry no other entry's type, subject or time
    expect(proof.links.map((l) => Object.keys(l).sort())).toEqual(proof.links.map(() => ['entryHash', 'prevHash', 'seq']));
    expect(proof.links.map((l) => l.seq)).toEqual([1, 2, 3]);
    expect(proof.head.seq).toBe(3);
    expect(checkLedgerProof(proof)).toMatchObject({ ok: true, throughSeq: 3, headSeq: 3 });

    // unknown hash: nothing, and no links
    const none = (await request(app).post('/api/ledger/proof').send({ contentHashes: ['f'.repeat(64)] })).body as LedgerProofResponse;
    expect(none).toMatchObject({ entries: [], links: [], truncated: false });
    // no prefixes, ids or empty lists: exact 64-hex hashes only
    for (const contentHashes of [[rec.record.contentHash.slice(0, 16)], [rec.record.id], [], Array(33).fill('a'.repeat(64))])
      expect((await request(app).post('/api/ledger/proof').send({ contentHashes })).status).toBe(400);
    // share, account and other non-content entries are not answered, even by their exact hash
    expect((await request(app).post('/api/account/delete').set(b.auth)).status).toBe(200);
    const shredded = db.prepare(`SELECT content_hash FROM ledger WHERE type = 'account.shredded'`).get() as { content_hash: string };
    expect((await request(app).post('/api/ledger/proof').send({ contentHashes: [shredded.content_hash] })).body.entries).toEqual([]);
  });

  it('is rate-limited per client', async () => {
    const { app } = makeApp();
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await request(app).post('/api/ledger/proof').send({ contentHashes: ['a'.repeat(64)] })).status;
    expect(last).toBe(429);
  });
});

describe('checkLedgerProof (client-side chain check)', () => {
  it('rejects a tampered entry, a broken link, a gap, and a chain that does not reach the head', async () => {
    const { app } = makeApp();
    const a = await registerUser(app, 'chain.a');
    const hashes: string[] = [];
    for (let i = 0; i < 4; i++) hashes.push((await createRecord(app, a, { i })).res.body.record.contentHash);
    const proof = (await request(app).post('/api/ledger/proof').send({ contentHashes: [hashes[1]] })).body as LedgerProofResponse;
    expect(checkLedgerProof(proof)).toMatchObject({ ok: true, throughSeq: 4 });

    const tampered = structuredClone(proof);
    tampered.entries[0]!.timestamp = '2020-01-01T00:00:00.000Z'; // back-dated
    expect(checkLedgerProof(tampered)).toMatchObject({ ok: false, brokenAtSeq: 2 });
    const broken = structuredClone(proof);
    broken.links[2]!.prevHash = 'b'.repeat(64);
    expect(checkLedgerProof(broken)).toMatchObject({ ok: false, brokenAtSeq: 4 });
    const gap = structuredClone(proof);
    gap.links.splice(1, 1);
    expect(checkLedgerProof(gap).ok).toBe(false);
    const shortOfHead = structuredClone(proof);
    shortOfHead.links.pop();
    expect(checkLedgerProof(shortOfHead).problem).toMatch(/head/);
    expect(checkLedgerProof({ ...shortOfHead, truncated: true })).toMatchObject({ ok: true, throughSeq: 3, truncated: true });
  });
});
