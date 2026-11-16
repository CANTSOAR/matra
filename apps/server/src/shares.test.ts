import { describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  decryptBlob,
  decryptJSON,
  unwrapKeyWithPrivate,
  wrapKeyForRecipient,
} from '@matra/crypto';
import { checkAttorneyKey, generateRosterKey, publicKeyFingerprint, toBase64 } from '@matra/crypto';
import { shareAliasSentence, sharedFilesSentence, writtenAccountSentence, type AttorneysResponse } from '@matra/shared';
import { TEST_ALIAS, createRecord, defaultProfile, makeApp, makeMatchingApp, registerUser, shareConsent, uploadBlob } from './test-helpers.js';
import { signOrgLists, storeOrgLists } from './org-signing.js';
import { setVerified } from './attorney-verification.js';

const binary = (res: any, cb: (e: Error | null, b: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

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

    const FP = await publicKeyFingerprint(pub);
    const body = {
      recordId,
      attorneyId: atty.user.id,
      recipientWrappedKey: await wrapKeyForRecipient(recKey, pub),
      blobs: [{ blobId, recipientWrappedKey: await wrapKeyForRecipient(blobKey, pub) }],
      consentStatement: shareConsent(FP, 1),
      attorneyKeyFingerprint: FP,
      scope: ['record', 'evidence'],
      survivorAlias: TEST_ALIAS,
    };
    // attorneys cannot create shares
    expect((await request(app).post('/api/shares').set(atty.auth).send(body)).status).toBe(403);
    const created = await request(app).post('/api/shares').set(jane.auth).send(body);
    expect(created.status).toBe(201);
    const share = created.body.share;
    expect(share).toMatchObject({ status: 'active', consentStatement: shareConsent(FP, 1), survivorId: jane.user.id });
    expect(created.body.ledgerEntry.type).toBe('share.granted');

    expect((await request(app).get('/api/shares').set(jane.auth)).body.shares).toHaveLength(1);
    const attyList = (await request(app).get('/api/shares').set(atty.auth)).body.shares;
    expect(attyList).toHaveLength(1);
    expect(attyList[0]).not.toHaveProperty('survivorId'); // her account id never reaches the attorney
    expect(attyList[0].survivorAlias).toBe(TEST_ALIAS);
    expect((await request(app).get('/api/shares').set(other.auth)).body.shares).toHaveLength(0);

    // attorney opens bundle and decrypts
    const bundle = await request(app).get(`/api/shares/${share.id}/bundle`).set(atty.auth);
    expect(bundle.status).toBe(200);
    const rk = await unwrapKeyWithPrivate(bundle.body.recipientWrappedKey, atty.privateKey);
    expect(await decryptJSON(bundle.body.record.envelope, rk)).toEqual({ narrative: 'shared words' });
    expect(bundle.body.survivorAlias).toBe(TEST_ALIAS);
    expect(bundle.body.share).not.toHaveProperty('survivorId');
    expect(JSON.stringify(bundle.body)).not.toContain(jane.user.id);
    expect(bundle.body.blobs).toHaveLength(1);
    // attorneys no longer receive any sealed-match information (counts went to the Legal Options Counselor role)
    expect(bundle.body).not.toHaveProperty('escrow');

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
    const blobAfter = await request(app).get(`/api/vault/blobs/${blobId}`).set(atty.auth);
    expect(blobAfter.status).toBe(403);
    expect(blobAfter.body.code).toBe('share_revoked');

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
    const FP = await publicKeyFingerprint(atty.user.publicKey);
    const base = {
      recordId: res.body.record.id,
      attorneyId: atty.user.id,
      recipientWrappedKey: wk,
      blobs: [] as Array<{ blobId: string; recipientWrappedKey: typeof wk }>,
      consentStatement: shareConsent(FP, 0),
      attorneyKeyFingerprint: FP,
      scope: ['record'],
      survivorAlias: TEST_ALIAS,
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
    // swapped key / unconfirmed fingerprint is refused (W3)
    const other = await publicKeyFingerprint(mallory.user.publicKey);
    const swapped = await request(app)
      .post('/api/shares')
      .set(jane.auth)
      .send({ ...base, attorneyKeyFingerprint: other, consentStatement: shareConsent(other, 0) });
    expect(swapped.status).toBe(409);
    expect(swapped.body.code).toBe('attorney_key_mismatch');
    const noFpInText = await request(app)
      .post('/api/shares')
      .set(jane.auth)
      .send({ ...base, consentStatement: 'I consent to share my case file with this attorney.' });
    expect(noFpInText.body.code).toBe('consent_fingerprint_missing');
    // The scope and her consent text must say exactly what is wrapped (@matra/shared consent.ts).
    const code = async (over: Record<string, unknown>) => (await request(app).post('/api/shares').set(jane.auth).send({ ...base, ...over })).body.code;
    const one = [{ blobId: ownBlob, recipientWrappedKey: wk }];
    expect(await code({ scope: ['record', 'brief'] })).toBe('scope_mismatch'); // the summary is laid out from the account: not a choice
    expect(await code({ scope: ['evidence'], blobs: one, consentStatement: shareConsent(FP, 1) })).toBe('scope_mismatch'); // the account is always wrapped
    expect(await code({ scope: ['record', 'evidence'] })).toBe('scope_mismatch'); // names files, wraps none
    expect(await code({ consentStatement: shareConsent(FP, 1) })).toBe('consent_mismatch'); // says one file, wraps none
    expect(await code({ scope: ['record', 'evidence'], blobs: one })).toBe('consent_mismatch'); // says none, wraps one
    expect(await code({ consentStatement: `${shareConsent(FP, 0)}\n${sharedFilesSentence(1)}` })).toBe('consent_mismatch'); // says both
    expect(await code({ consentStatement: shareConsent(FP, 0).replace(writtenAccountSentence(), 'I am sharing my written account.') })).toBe('consent_mismatch');
    expect(await code({ consentStatement: shareConsent(FP, 0, 'Client ZZZZZ') })).toBe('consent_mismatch'); // names another label
    expect(await code({ survivorAlias: 'jane.test', consentStatement: shareConsent(FP, 0, 'jane.test') })).toBe('invalid_request'); // never her username
    expect(await code({ survivorAlias: 'Client AEIOU', consentStatement: shareConsent(FP, 0, 'Client AEIOU') })).toBe('invalid_request');
    // word for word, line by line: text appended to a valid statement that contradicts it, or names another label, is refused
    const plus = (line: string) => code({ consentStatement: `${shareConsent(FP, 0)}\n${line}` });
    expect(await plus('I am NOT sharing my written account.')).toBe('consent_mismatch');
    expect(await plus('I am sharing no evidence files at all.')).toBe('consent_mismatch');
    expect(await plus('Matra shows this share as "jane.real-name".')).toBe('consent_mismatch');
    expect(await plus(shareAliasSentence(TEST_ALIAS))).toBe('consent_mismatch'); // the label twice
    expect(await plus('My username is jane.test.')).toBe('consent_mismatch');
    expect(await code({ consentStatement: shareConsent(FP, 0).replace(writtenAccountSentence(), `${writtenAccountSentence()} Except my phone.`) })).toBe(
      'consent_mismatch',
    );
    expect((await request(app).get('/api/shares').set(jane.auth)).body.shares).toHaveLength(0);
    expect((await request(app).post('/api/shares').set(jane.auth).send(base)).status).toBe(201);
    expect((await request(app).post('/api/shares').set(jane.auth).send({ ...base, scope: ['record', 'evidence'], blobs: one, consentStatement: shareConsent(FP, 1) })).status).toBe(201);
  });

  it('expires shares server-side (bundle + blob), and renewal restores access', async () => {
    const { app, db } = makeApp() as any;
    const jane = await registerUser(app, 'jane.test');
    const atty = await registerUser(app, 'atty.nj', 'attorney');
    const { res, key } = await createRecord(app, jane);
    const { res: blobRes, key: blobKey } = await uploadBlob(app, jane, new TextEncoder().encode('photo'));
    const pub = (await request(app).get('/api/attorneys').set(jane.auth)).body.attorneys.find((a: { userId: string }) => a.userId === atty.user.id).publicKey;
    const FP = await publicKeyFingerprint(pub);
    const body = {
      recordId: res.body.record.id,
      attorneyId: atty.user.id,
      recipientWrappedKey: await wrapKeyForRecipient(key, pub),
      blobs: [{ blobId: blobRes.body.blob.id, recipientWrappedKey: await wrapKeyForRecipient(blobKey, pub) }],
      consentStatement: shareConsent(FP, 1),
      attorneyKeyFingerprint: FP,
      scope: ['record', 'evidence'],
      survivorAlias: TEST_ALIAS,
    };
    expect((await request(app).post('/api/shares').set(jane.auth).send({ ...body, expiresInDays: 0 })).status).toBe(400);
    const created = await request(app).post('/api/shares').set(jane.auth).send(body);
    const share = created.body.share;
    const days = (Date.parse(share.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThan(90.1);

    db.prepare('UPDATE shares SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), share.id);
    const b = await request(app).get(`/api/shares/${share.id}/bundle`).set(atty.auth);
    expect(b.status).toBe(403);
    expect(b.body.code).toBe('share_expired');
    const bl = await request(app).get(`/api/vault/blobs/${blobRes.body.blob.id}`).set(atty.auth);
    expect(bl.status).toBe(403);
    expect(bl.body.code).toBe('share_expired');

    expect((await request(app).post(`/api/shares/${share.id}/renew`).set(atty.auth)).status).toBe(403);
    const renewed = await request(app).post(`/api/shares/${share.id}/renew`).set(jane.auth).send({ expiresInDays: 30 });
    expect(renewed.status).toBe(200);
    expect(renewed.body.ledgerEntry.type).toBe('share.renewed');
    expect((await request(app).get(`/api/shares/${share.id}/bundle`).set(atty.auth)).status).toBe(200);

    await request(app).post(`/api/shares/${share.id}/revoke`).set(jane.auth);
    expect((await request(app).post(`/api/shares/${share.id}/renew`).set(jane.auth)).status).toBe(409);
    expect((await request(app).get('/api/ledger/verify')).body.ok).toBe(true);
  });
});

describe('shares made before the consent words were checked', () => {
  it('a pre-B5 share (incident summary in its scope, her username as its label, old wording) still opens, renews and revokes', async () => {
    const { app, db } = makeApp();
    const jane = await registerUser(app, 'jane.old');
    const atty = await registerUser(app, 'atty.old', 'attorney');
    const { res, key } = await createRecord(app, jane, { narrative: 'old words' });
    const FP = await publicKeyFingerprint(atty.user.publicKey);
    const id = 'f'.repeat(32);
    db.prepare(
      `INSERT INTO shares (id, record_id, survivor_id, attorney_id, status, consent_statement, scope, recipient_wrapped_key,
                           survivor_alias, created_at, revoked_at, expires_at, ledger_entry_id)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, 'jane.old', ?, NULL, ?, ?)`,
    ).run(
      id,
      res.body.record.id,
      jane.user.id,
      atty.user.id,
      `I, "jane.old", choose to share my sealed Matra file. I am sharing: my written account; the incident summary. Key ${FP}.`,
      JSON.stringify(['record', 'brief']),
      JSON.stringify(await wrapKeyForRecipient(key, atty.user.publicKey)),
      new Date().toISOString(),
      new Date(Date.now() + 86_400_000).toISOString(),
      res.body.ledgerEntry.id,
    );
    const bundle = await request(app).get(`/api/shares/${id}/bundle`).set(atty.auth);
    expect(bundle.status).toBe(200);
    expect(bundle.body.share.scope).toEqual(['record', 'brief']);
    expect((await request(app).post(`/api/shares/${id}/renew`).set(jane.auth).send({ expiresInDays: 30 })).status).toBe(200);
    expect((await request(app).post(`/api/shares/${id}/revoke`).set(jane.auth)).status).toBe(200);
  });
});

describe('unverifying an attorney pauses access to existing shares', () => {
  it('refuses an unverified attorney on the list, bundle and blob routes; re-verifying restores access', async () => {
    const { app, db } = makeApp();
    const jane = await registerUser(app, 'jane.unv');
    const atty = await registerUser(app, 'atty.unv', 'attorney');
    const { res: recRes, key: recKey } = await createRecord(app, jane, { narrative: 'paused words' });
    const { res: blobRes, key: blobKey } = await uploadBlob(app, jane, new TextEncoder().encode('photo'));
    const blobId = blobRes.body.blob.id;
    const pub = atty.user.publicKey;
    const FP = await publicKeyFingerprint(pub);
    const created = await request(app)
      .post('/api/shares')
      .set(jane.auth)
      .send({
        recordId: recRes.body.record.id,
        attorneyId: atty.user.id,
        recipientWrappedKey: await wrapKeyForRecipient(recKey, pub),
        blobs: [{ blobId, recipientWrappedKey: await wrapKeyForRecipient(blobKey, pub) }],
        consentStatement: shareConsent(FP, 1),
        attorneyKeyFingerprint: FP,
        scope: ['record', 'evidence'],
        survivorAlias: TEST_ALIAS,
      });
    expect(created.status).toBe(201);
    const shareId = created.body.share.id;
    const routes = (auth: { Authorization: string }) => [
      request(app).get('/api/shares').set(auth),
      request(app).get(`/api/shares/${shareId}/bundle`).set(auth),
      request(app).get(`/api/vault/blobs/${blobId}`).set(auth),
    ];
    for (const r of await Promise.all(routes(atty.auth))) expect(r.status).toBe(200);

    // The routes check the flag themselves (not only the session sweep below).
    db.prepare('UPDATE attorney_profiles SET verified = 0 WHERE user_id = ?').run(atty.user.id);
    for (const r of await Promise.all(routes(atty.auth))) {
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('attorney_not_verified');
    }
    db.prepare('UPDATE attorney_profiles SET verified = 1 WHERE user_id = ?').run(atty.user.id);

    // verify-attorney --revoke: signs the attorney out everywhere and tells the survivor; her share is not revoked
    expect(setVerified(db, 'atty.unv', false)).toMatchObject({ role: 'attorney', changed: true, survivorsNotified: 1 });
    expect((await request(app).get('/api/shares').set(atty.auth)).status).toBe(401);
    const login = await request(app).post('/api/auth/login').send({ username: 'atty.unv', authKey: atty.authKey });
    expect(login.status).toBe(200);
    let again = { Authorization: `Bearer ${login.body.token}` };
    for (const r of await Promise.all(routes(again))) {
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('attorney_not_verified');
    }
    const hers = (await request(app).get('/api/shares').set(jane.auth)).body.shares;
    expect(hers).toHaveLength(1);
    expect(hers[0]).toMatchObject({ status: 'active', attorneyVerified: false });
    const janeEvents = (await request(app).get('/api/audit').set(jane.auth)).body.events as Array<{ action: string; detail?: string }>;
    const notice = janeEvents.find((e) => e.action === 'attorney.unverified');
    expect(notice?.detail).toMatch(/no longer verified by Matra.*paused/);
    // revoking twice writes no second notice, but still signs the attorney out (a re-run --revoke must never leave a session open)
    expect(setVerified(db, 'atty.unv', false)).toMatchObject({ changed: false, sessionsEnded: 1, survivorsNotified: 0 });
    expect((await request(app).get('/api/shares').set(again)).status).toBe(401);
    const relogin = await request(app).post('/api/auth/login').send({ username: 'atty.unv', authKey: atty.authKey });
    expect(relogin.status).toBe(200);
    again = { Authorization: `Bearer ${relogin.body.token}` };
    expect(((await request(app).get('/api/audit').set(jane.auth)).body.events as Array<{ action: string }>).filter((e) => e.action === 'attorney.unverified')).toHaveLength(1);

    // re-verified: access is back, and she is told
    expect(setVerified(db, 'atty.unv', true)).toMatchObject({ changed: true, sessionsEnded: 0, survivorsNotified: 1 });
    for (const r of await Promise.all(routes(again))) expect(r.status).toBe(200);
    expect((await request(app).get('/api/shares').set(jane.auth)).body.shares[0]).toMatchObject({ attorneyVerified: true });
    const after = (await request(app).get('/api/audit').set(jane.auth)).body.events as Array<{ action: string }>;
    expect(after.map((e) => e.action)).toContain('attorney.reverified');
    // the attorney's own list never carries the flag
    expect((await request(app).get('/api/shares').set(again)).body.shares[0]).not.toHaveProperty('attorneyVerified');
    expect((await request(app).get('/api/ledger/verify')).body.ok).toBe(true);
  });
});

describe('attorney directory signed by the organization (W3)', () => {
  it('serves the signed directory with the attorney list; it names only verified attorneys, with their key fingerprints', async () => {
    const { app, db } = makeMatchingApp();
    const jane = await registerUser(app, 'jane.dir');
    const atty = await registerUser(app, 'atty.dir', 'attorney', { profile: { ...defaultProfile, displayName: 'Dir Counsel' } });
    await registerUser(app, 'atty.pending', 'attorney', { verify: false });
    await registerUser(app, 'loc.dir', 'counselor');

    // nothing signed yet: no directory, and a pinned client can't confirm anyone
    const before = (await request(app).get('/api/attorneys').set(jane.auth)).body as AttorneysResponse;
    expect(before.directory).toBeUndefined();
    const org = generateRosterKey();
    const pin = toBase64(org.publicKey);
    expect(checkAttorneyKey(before.directory, before.attorneys[0]!, pin).status).toBe('unsigned');

    const lists = signOrgLists(db, org.secretKey);
    storeOrgLists(db, lists);
    expect(lists.attorneys.map((a) => a.displayName)).toEqual(['Dir Counsel']); // the unverified one is not signed
    expect(lists.counselors).toHaveLength(1);

    const res = (await request(app).get('/api/attorneys').set(jane.auth)).body as AttorneysResponse;
    const listed = res.attorneys.find((a) => a.userId === atty.user.id)!;
    expect(checkAttorneyKey(res.directory, listed, pin)).toMatchObject({
      status: 'verified',
      displayName: 'Dir Counsel',
      fingerprint: await publicKeyFingerprint(listed.publicKey),
    });
    // the server swaps the attorney's key in its own table: the signed directory catches it
    const evil = await registerUser(app, 'evil.dir', 'attorney', { verify: false });
    db.prepare('UPDATE users SET public_key = ? WHERE id = ?').run(JSON.stringify(evil.user.publicKey), atty.user.id);
    const swapped = (await request(app).get('/api/attorneys').set(jane.auth)).body as AttorneysResponse;
    expect(checkAttorneyKey(swapped.directory, swapped.attorneys.find((a) => a.userId === atty.user.id)!, pin).status).toBe('key_mismatch');
    // the counselor roster is still served from the same signing run
    expect((await request(app).get('/api/matching/config').set(jane.auth)).body.roster).toEqual(lists.roster);
  });
});
