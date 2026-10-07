import { describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  decryptBlob,
  decryptJSON,
  unwrapKeyWithPrivate,
  wrapKeyForRecipient,
} from '@matra/crypto';
import { createRecord, makeApp, registerUser, uploadBlob } from './test-helpers.js';

const binary = (res: any, cb: (e: Error | null, b: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

const CONSENT = 'I consent to share my case file with this attorney for legal consultation.';

describe('shares', () => {
  it('grant → attorney decrypts bundle + blob → audit → revoke → 403', async () => {
    const { app } = makeApp();
    const jane = await registerUser(app, 'jane.test');
    const atty = await registerUser(app, 'atty.nj', 'attorney');
    const other = await registerUser(app, 'atty.other', 'attorney');

    const { res: recRes, key: recKey } = await createRecord(app, jane, { narrative: 'shared words' });
    const recordId = recRes.body.record.id;
    const { res: blobRes, key: blobKey } = await uploadBlob(app, jane, new TextEncoder().encode('photo'));
    const blobId = blobRes.body.blob.id;
    const { res: blob2Res } = await uploadBlob(app, jane, new TextEncoder().encode('not shared'));

    const attorneys = (await request(app).get('/api/attorneys').set(jane.auth)).body.attorneys;
    const pub = attorneys.find((a: { userId: string }) => a.userId === atty.user.id).publicKey;

    const body = {
      recordId,
      attorneyId: atty.user.id,
      recipientWrappedKey: await wrapKeyForRecipient(recKey, pub),
      blobs: [{ blobId, recipientWrappedKey: await wrapKeyForRecipient(blobKey, pub) }],
      consentStatement: CONSENT,
      scope: ['record', 'evidence'],
      survivorAlias: 'J.',
    };
    // attorneys cannot create shares
    expect((await request(app).post('/api/shares').set(atty.auth).send(body)).status).toBe(403);
    const created = await request(app).post('/api/shares').set(jane.auth).send(body);
    expect(created.status).toBe(201);
    const share = created.body.share;
    expect(share).toMatchObject({ status: 'active', consentStatement: CONSENT, survivorId: jane.user.id });
    expect(created.body.ledgerEntry.type).toBe('share.granted');

    expect((await request(app).get('/api/shares').set(jane.auth)).body.shares).toHaveLength(1);
    expect((await request(app).get('/api/shares').set(atty.auth)).body.shares).toHaveLength(1);
    expect((await request(app).get('/api/shares').set(other.auth)).body.shares).toHaveLength(0);

    // attorney opens bundle and decrypts
    const bundle = await request(app).get(`/api/shares/${share.id}/bundle`).set(atty.auth);
    expect(bundle.status).toBe(200);
    const rk = await unwrapKeyWithPrivate(bundle.body.recipientWrappedKey, atty.privateKey);
    expect(await decryptJSON(bundle.body.record.envelope, rk)).toEqual({ narrative: 'shared words' });
    expect(bundle.body.survivorAlias).toBe('J.');
    expect(bundle.body.blobs).toHaveLength(1);

    const dl = await request(app).get(`/api/vault/blobs/${blobId}`).set(atty.auth).buffer(true).parse(binary);
    expect(dl.status).toBe(200);
    const bk = await unwrapKeyWithPrivate(bundle.body.blobs[0].recipientWrappedKey, atty.privateKey);
    expect(new TextDecoder().decode(await decryptBlob(new Uint8Array(dl.body), bk))).toBe('photo');

    // blob not included in share → 403; other attorney → 403; survivor can't fetch bundle
    expect((await request(app).get(`/api/vault/blobs/${blob2Res.body.blob.id}`).set(atty.auth)).status).toBe(403);
    expect((await request(app).get(`/api/vault/blobs/${blobId}`).set(other.auth)).status).toBe(403);
    expect((await request(app).get(`/api/shares/${share.id}/bundle`).set(other.auth)).status).toBe(403);
    expect((await request(app).get(`/api/shares/${share.id}/bundle`).set(jane.auth)).status).toBe(403);

    // survivor sees attorney access in her audit trail
    const events = (await request(app).get('/api/audit').set(jane.auth)).body.events;
    const actions = events.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['attorney.opened_share', 'attorney.downloaded_evidence', 'share.created']));
    expect(events.every((e: { userId: string }) => e.userId === jane.user.id)).toBe(true);

    // revoke
    expect((await request(app).post(`/api/shares/${share.id}/revoke`).set(atty.auth)).status).toBe(403);
    const rev = await request(app).post(`/api/shares/${share.id}/revoke`).set(jane.auth);
    expect(rev.status).toBe(200);
    expect(rev.body.share.status).toBe('revoked');
    expect(rev.body.share.revokedAt).toBeTruthy();
    expect(rev.body.ledgerEntry.type).toBe('share.revoked');
    expect((await request(app).post(`/api/shares/${share.id}/revoke`).set(jane.auth)).status).toBe(409);

    const after = await request(app).get(`/api/shares/${share.id}/bundle`).set(atty.auth);
    expect(after.status).toBe(403);
    expect(after.body.code).toBe('share_revoked');
    expect((await request(app).get(`/api/vault/blobs/${blobId}`).set(atty.auth)).status).toBe(403);

    expect((await request(app).get('/api/ledger/verify')).body.ok).toBe(true);
  });

  it('validates ownership, attorney verification, and scope', async () => {
    const { app } = makeApp();
    const jane = await registerUser(app, 'jane.test');
    const mallory = await registerUser(app, 'mallory.test');
    const unverified = await registerUser(app, 'atty.new', 'attorney', { verify: false });
    const atty = await registerUser(app, 'atty.nj', 'attorney');
    const { res, key } = await createRecord(app, jane);
    const mBlob = (await uploadBlob(app, mallory)).res.body.blob.id;
    const wk = await wrapKeyForRecipient(key, atty.user.publicKey);
    const base = {
      recordId: res.body.record.id,
      attorneyId: atty.user.id,
      recipientWrappedKey: wk,
      blobs: [] as Array<{ blobId: string; recipientWrappedKey: typeof wk }>,
      consentStatement: CONSENT,
      scope: ['record'],
      survivorAlias: 'J.',
    };
    expect((await request(app).post('/api/shares').set(mallory.auth).send(base)).status).toBe(403);
    const unv = await request(app).post('/api/shares').set(jane.auth).send({ ...base, attorneyId: unverified.user.id });
    expect(unv.body.code).toBe('attorney_not_verified');
    const notAtty = await request(app).post('/api/shares').set(jane.auth).send({ ...base, attorneyId: mallory.user.id });
    expect(notAtty.body.code).toBe('attorney_not_found');
    const foreignBlob = await request(app)
      .post('/api/shares')
      .set(jane.auth)
      .send({ ...base, scope: ['record', 'evidence'], blobs: [{ blobId: mBlob, recipientWrappedKey: wk }] });
    expect(foreignBlob.status).toBe(403);
    const ownBlob = (await uploadBlob(app, jane)).res.body.blob.id;
    const noScope = await request(app)
      .post('/api/shares')
      .set(jane.auth)
      .send({ ...base, blobs: [{ blobId: ownBlob, recipientWrappedKey: wk }] });
    expect(noScope.body.code).toBe('scope_mismatch');
    expect((await request(app).post('/api/shares').set(jane.auth).send(base)).status).toBe(201);
  });
});
