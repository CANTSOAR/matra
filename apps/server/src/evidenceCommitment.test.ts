import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHash, randomBytes } from 'node:crypto';
import { checkLedgerProof } from '@matra/crypto';
import type { LedgerProofResponse } from '@matra/shared';
import { makeApp, registerUser, uploadBlob } from './test-helpers.js';

const sha = (b: Buffer | Uint8Array | string) => createHash('sha256').update(b).digest('hex');
/** SHA-256(salt || SHA-256(original)), raw bytes: apps/web/src/evidence/commitment.ts */
const commitment = (saltHex: string, originalHash: string) => sha(Buffer.concat([Buffer.from(saltHex, 'hex'), Buffer.from(originalHash, 'hex')]));

/** Every cell of every table, as text: a plain hash or a salt must not be in any of them. */
function wholeDatabase(db: ReturnType<typeof makeApp>['db']): string {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as Array<{ name: string }>;
  const out: string[] = [];
  for (const t of tables)
    for (const row of db.prepare(`SELECT * FROM "${t.name}"`).all() as Array<Record<string, unknown>>)
      for (const v of Object.values(row)) out.push(Buffer.isBuffer(v) ? v.toString('hex') + Buffer.from(v).toString('latin1') : String(v));
  return out.join('\n');
}

describe('evidence commitments (PLAN_REVIEW finding 1): only a salted commitment ever reaches the server or the ledger', () => {
  it('ledgers the commitment for the blob, and a proof query by the PLAIN hash of the file returns nothing', async () => {
    const { app, db } = makeApp();
    const u = await registerUser(app, 'commit.a');
    const original = randomBytes(300); // her original file
    const strippedCopy = randomBytes(280); // what the browser re-encoded and encrypts
    const plainOriginalHash = sha(original);
    const plainCopyHash = sha(strippedCopy);
    const salt = randomBytes(32).toString('hex');
    const c = commitment(salt, plainOriginalHash);

    const { res, ct } = await uploadBlob(app, u, strippedCopy, c);
    expect(res.status).toBe(201);
    expect(res.body.ledgerEntry.type).toBe('blob.sealed');
    expect(res.body.commitmentEntry).toMatchObject({ type: 'evidence.committed', subjectId: res.body.blob.id, contentHash: c });
    expect(res.body.commitmentEntry.seq).toBe(res.body.ledgerEntry.seq + 1);

    // someone who holds the same file and asks the public proof route learns nothing: neither hash is on the ledger
    for (const plain of [plainOriginalHash, plainCopyHash, sha(ct.subarray(0, 0))]) {
      const r = await request(app).post('/api/ledger/proof').send({ contentHashes: [plain] });
      expect(r.status).toBe(200);
      expect((r.body as LedgerProofResponse).entries).toEqual([]);
    }
    // she (who has the commitment) can find it, and the chain checks
    const mine = await request(app).post('/api/ledger/proof').send({ contentHashes: [c] });
    const proof = mine.body as LedgerProofResponse;
    expect(proof.entries.map((e) => [e.type, e.subjectId])).toEqual([['evidence.committed', res.body.blob.id]]);
    expect(checkLedgerProof(proof)).toMatchObject({ ok: true });

    // no ledger contentHash equals any plaintext hash, and neither the plain hashes nor the salt are anywhere in the database
    const hashes = (db.prepare('SELECT content_hash FROM ledger').all() as Array<{ content_hash: string }>).map((r) => r.content_hash);
    for (const plain of [plainOriginalHash, plainCopyHash]) expect(hashes).not.toContain(plain);
    const dump = wholeDatabase(db);
    for (const secret of [plainOriginalHash, plainCopyHash, salt, original.toString('hex')]) expect(dump).not.toContain(secret);
    expect(dump).toContain(c);
  });

  it('the commitment can be verified by her with the salt, and by no one without it', async () => {
    const original = randomBytes(64);
    const salt = randomBytes(32).toString('hex');
    const c = commitment(salt, sha(original));
    expect(commitment(salt, sha(original))).toBe(c);
    expect(commitment(randomBytes(32).toString('hex'), sha(original))).not.toBe(c); // another salt
    expect(c).not.toBe(sha(original)); // not the plain hash
    expect(commitment(salt, sha(randomBytes(64)))).not.toBe(c); // another file
  });

  it('the same file imported twice gives two unrelated commitments (a fresh salt each time)', async () => {
    const { app } = makeApp();
    const u = await registerUser(app, 'commit.b');
    const original = randomBytes(100);
    const h = sha(original);
    const a = await uploadBlob(app, u, original, commitment(randomBytes(32).toString('hex'), h));
    const b = await uploadBlob(app, u, original, commitment(randomBytes(32).toString('hex'), h));
    expect(a.res.body.commitmentEntry.contentHash).not.toBe(b.res.body.commitmentEntry.contentHash);
  });

  it('refuses anything that is not 64 lowercase hex, and writes no second entry when there is no commitment', async () => {
    const { app, db } = makeApp();
    const u = await registerUser(app, 'commit.c');
    for (const bad of ['', 'abc', 'A'.repeat(64), 'g'.repeat(64), '0'.repeat(63), '0'.repeat(65)]) {
      const r = await uploadBlob(app, u, new Uint8Array([1, 2, 3]), bad);
      expect(r.res.status, bad).toBe(400);
      expect(r.res.body.code).toBe('invalid_commitment');
    }
    expect((db.prepare('SELECT COUNT(*) AS n FROM ledger').get() as { n: number }).n).toBe(0); // a refused upload writes nothing
    const plain = await uploadBlob(app, u);
    expect(plain.res.status).toBe(201);
    expect(plain.res.body.commitmentEntry).toBeUndefined();
    expect((db.prepare(`SELECT COUNT(*) AS n FROM ledger WHERE type = 'evidence.committed'`).get() as { n: number }).n).toBe(0);
  });
});
