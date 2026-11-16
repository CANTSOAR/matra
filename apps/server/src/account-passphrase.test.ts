import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type express from 'express';
import {
  decryptJSON,
  deriveRecoveryKeys,
  derivePassphraseKeys,
  generateRecoveryCode,
  importAccountSecret,
  legacyAccountSecret,
  openSlot,
  parseRecoveryCode,
  passphraseMaterialFor,
  publicKeyFingerprint,
  sealSlot,
  slotName,
  unlockAccount,
  unwrapAccountSecret,
  unwrapKeyWithMaster,
  unwrapKeyWithPrivate,
  unwrapPrivateKey,
  wrapAccountSecret,
  wrapKeyForRecipient,
} from '@matra/crypto';
import type { Envelope, PublicUser } from '@matra/shared';
import { getDb } from './app.js';
import { TEST_ALIAS, createRecord, shareConsent, makeApp, registerUser, TEST_ITERATIONS, type TestUser } from './test-helpers.js';

// Run something while the server hashes the new auth key (the conditional-update race).
const hook = vi.hoisted(() => ({ duringHash: null as null | (() => Promise<void>), duringVerify: null as null | (() => Promise<void>) }));
vi.mock('./auth.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./auth.js')>();
  return {
    ...mod,
    hashAuthKey: async (k: string) => {
      const run = hook.duringHash;
      hook.duringHash = null;
      if (run) await run();
      return mod.hashAuthKey(k);
    },
    verifyAuthKey: async (k: string, salt: Buffer, expected: Buffer) => {
      const ok = await mod.verifyAuthKey(k, salt, expected);
      const run = hook.duringVerify;
      hook.duringVerify = null;
      if (run) await run();
      return ok;
    },
  };
});

const NEW_PASS = 'brand-new-river-otter-lilac-heron';

async function prelogin(app: express.Express, username: string) {
  return (await request(app).get('/api/auth/prelogin').query({ username })).body as { kdfSalt: string; kdfIterations: number };
}

async function login(app: express.Express, username: string, passphrase: string) {
  const pre = await prelogin(app, username);
  const pk = await derivePassphraseKeys(passphrase, pre.kdfSalt, pre.kdfIterations);
  const res = await request(app).post('/api/auth/login').send({ username, authKey: pk.authKey });
  return { res, pk, auth: { Authorization: `Bearer ${res.body.token}` } };
}

/** What her client does on "Change passphrase": AS from the old passphrase, re-wrapped under the new one. */
async function changeBody(app: express.Express, u: TestUser, current = u.passphrase, next = NEW_PASS, iterations = TEST_ITERATIONS) {
  const me = (await request(app).get('/api/me').set(u.auth)).body.user as PublicUser;
  const pre = await prelogin(app, me.username);
  const pk = await derivePassphraseKeys(current, pre.kdfSalt, pre.kdfIterations);
  const as = me.wrappedAccountKey ? await unwrapAccountSecret(me.wrappedAccountKey, pk.kek) : await legacyAccountSecret(pk.ikm);
  const m = await passphraseMaterialFor(as, next, iterations);
  as.fill(0);
  return { authKey: pk.authKey, newAuthKey: m.authKey, kdfSalt: m.kdfSalt, kdfIterations: m.kdfIterations, wrappedAccountKey: m.wrappedAccountKey };
}

async function change(app: express.Express, u: TestUser, auth = u.auth, current?: string, next?: string) {
  return request(app).post('/api/account/passphrase').set(auth).send(await changeBody(app, u, current, next));
}

async function setUpRecovery(app: express.Express, u: TestUser) {
  const pre = await prelogin(app, u.user.username);
  const pk = await derivePassphraseKeys(u.passphrase, pre.kdfSalt, pre.kdfIterations);
  const as = await legacyAccountSecret(pk.ikm);
  const { bytes, code } = generateRecoveryCode();
  const rk = await deriveRecoveryKeys(bytes);
  const res = await request(app)
    .post('/api/account/recovery')
    .set(u.auth)
    .send({ authKey: pk.authKey, wrappedAccountKey: await wrapAccountSecret(as, pk.kek), recoveryAuthKey: rk.authKey, recoveryWrappedKey: await wrapAccountSecret(as, rk.kek) });
  as.fill(0);
  expect(res.status).toBe(200);
  return code;
}

const activity = async (app: express.Express, auth: { Authorization: string }) =>
  ((await request(app).get('/api/audit').set(auth)).body.events as Array<{ action: string }>).map((e) => e.action);

describe('POST /api/account/passphrase', () => {
  it('the old passphrase stops working, the new one opens the same space: records, private key, draft slot, shares', async () => {
    const { app, db } = makeApp();
    const jane = await registerUser(app, 'jane.change');
    const atty = await registerUser(app, 'atty.change', 'attorney');
    expect(jane.user.keyVersion).toBe(1);

    // her space before: a sealed record, a draft slot, and a share to an attorney
    const { res: rec, key: recKey, envelope } = await createRecord(app, jane, { story: 'her words' });
    const name = await slotName(jane.masterKey, 'draft');
    const put = await request(app).put(`/api/vault/slots/${name}`).set(jane.auth).send({ ...(await sealSlot({ kind: 'draft', words: 'unsent' }, jane.masterKey)), expectedVersion: null });
    expect(put.status).toBe(200);
    const pub = (await request(app).get('/api/attorneys').set(jane.auth)).body.attorneys.find((a: { userId: string }) => a.userId === atty.user.id).publicKey;
    const fp = await publicKeyFingerprint(pub);
    const share = await request(app)
      .post('/api/shares')
      .set(jane.auth)
      .send({
        recordId: rec.body.record.id,
        attorneyId: atty.user.id,
        recipientWrappedKey: await wrapKeyForRecipient(recKey, pub),
        blobs: [],
        consentStatement: shareConsent(fp, 0),
        attorneyKeyFingerprint: fp,
        scope: ['record'],
        survivorAlias: TEST_ALIAS,
      });
    expect(share.status).toBe(201);

    const res = await change(app, jane);
    expect(res.status).toBe(200);
    expect(res.body.user.keyVersion).toBe(2); // a version-1 account moves to version 2
    expect(res.body.user.wrappedAccountKey).toBeDefined();
    expect(res.body.endedSessions).toBe(0);

    // old passphrase: refused; new one: in
    expect((await login(app, 'jane.change', jane.passphrase)).res.status).toBe(401);
    const { res: inRes, pk, auth } = await login(app, 'jane.change', NEW_PASS);
    expect(inRes.status).toBe(200);
    const { masterKey } = await unlockAccount(pk, inRes.body.user.wrappedAccountKey as Envelope);
    // her record
    const got = (await request(app).get(`/api/vault/records/${rec.body.record.id}`).set(auth)).body.record;
    expect(got.envelope).toEqual(envelope);
    expect(await decryptJSON(got.envelope, await unwrapKeyWithMaster(got.ownerWrappedKey, masterKey))).toEqual({ story: 'her words' });
    // her private key
    expect((await unwrapPrivateKey(inRes.body.user.wrappedPrivateKey, masterKey)).type).toBe('private');
    // her draft slot: same opaque name, still opens
    expect(await slotName(masterKey, 'draft')).toBe(name);
    const slot = (await request(app).get(`/api/vault/slots/${name}`).set(auth)).body.slot;
    expect(await openSlot(slot, masterKey)).toMatchObject({ words: 'unsent' });
    // her share: still listed for her, still opens for the attorney
    expect((await request(app).get('/api/shares').set(auth)).body.shares).toHaveLength(1);
    const bundle = await request(app).get(`/api/shares/${share.body.share.id}/bundle`).set(atty.auth);
    expect(bundle.status).toBe(200);
    expect(await decryptJSON(bundle.body.record.envelope, await unwrapKeyWithPrivate(bundle.body.recipientWrappedKey, atty.privateKey))).toEqual({ story: 'her words' });

    // one activity row, always listed; nothing in the ledger (an activity event, like signing in)
    expect(await activity(app, auth)).toContain('auth.passphrase_changed');
    expect((db.prepare(`SELECT COUNT(*) n FROM ledger WHERE subject_id = ?`).get(jane.user.id) as { n: number }).n).toBe(0);
  });

  it('her recovery code still works afterwards, and opens the same space', async () => {
    const { app } = makeApp();
    const jane = await registerUser(app, 'jane.code');
    const { res: rec } = await createRecord(app, jane, { story: 'kept' });
    const code = await setUpRecovery(app, jane);
    const me = (await request(app).get('/api/me').set(jane.auth)).body.user as PublicUser;
    expect(me.keyVersion).toBe(2);
    const recoveryBefore = getDb(app).prepare('SELECT recovery_wrapped_key FROM users WHERE id = ?').get(jane.user.id);

    expect((await change(app, jane)).status).toBe(200);
    expect(getDb(app).prepare('SELECT recovery_wrapped_key FROM users WHERE id = ?').get(jane.user.id)).toEqual(recoveryBefore);
    expect((await request(app).get('/api/me').set(jane.auth)).body.user.hasRecoveryCode).toBe(true);

    // signed out, she forgets the new passphrase too: the code still unwraps her account secret
    const rk = await deriveRecoveryKeys(parseRecoveryCode(code));
    const start = await request(app).post('/api/auth/recover/start').send({ username: 'jane.code', recoveryAuthKey: rk.authKey });
    expect(start.status).toBe(200);
    const as = await unwrapAccountSecret(start.body.recoveryWrappedKey, rk.kek);
    const { masterKey } = await importAccountSecret(as);
    const m = await passphraseMaterialFor(as, 'third-passphrase-river-otter-lilac-heron', TEST_ITERATIONS);
    as.fill(0);
    const finish = await request(app)
      .post('/api/auth/recover/finish')
      .send({ resetToken: start.body.resetToken, kdfSalt: m.kdfSalt, kdfIterations: m.kdfIterations, authKey: m.authKey, wrappedAccountKey: m.wrappedAccountKey });
    expect(finish.status).toBe(200);
    const got = (await request(app).get(`/api/vault/records/${rec.body.record.id}`).set('Authorization', `Bearer ${finish.body.token}`)).body.record;
    expect(await decryptJSON(got.envelope, await unwrapKeyWithMaster(got.ownerWrappedKey, masterKey))).toEqual({ story: 'kept' });
  });

  it('signs out every other session of hers (they get 401); this one keeps working', async () => {
    const { app } = makeApp();
    const jane = await registerUser(app, 'jane.devices');
    const other = await login(app, 'jane.devices', jane.passphrase);
    const third = await login(app, 'jane.devices', jane.passphrase);
    const sam = await registerUser(app, 'sam.devices');
    expect((await request(app).get('/api/me').set(other.auth)).status).toBe(200);

    const res = await change(app, jane);
    expect(res.status).toBe(200);
    expect(res.body.endedSessions).toBe(2);
    expect((await request(app).get('/api/me').set(other.auth)).status).toBe(401);
    expect((await request(app).get('/api/me').set(third.auth)).status).toBe(401);
    expect((await request(app).get('/api/me').set(jane.auth)).status).toBe(200);
    expect((await request(app).get('/api/me').set(sam.auth)).status).toBe(200); // someone else's session is untouched
  });

  it('needs her current passphrase: a session alone changes nothing', async () => {
    const { app } = makeApp();
    const jane = await registerUser(app, 'jane.wrong');
    const before = getDb(app).prepare('SELECT auth_hash, kdf_salt, key_version, wrapped_account_key FROM users WHERE id = ?').get(jane.user.id);
    const other = await login(app, 'jane.wrong', jane.passphrase);
    const res = await request(app).post('/api/account/passphrase').set(jane.auth).send(await changeBody(app, jane, 'not-her-passphrase-at-all'));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('invalid_credentials');
    expect(getDb(app).prepare('SELECT auth_hash, kdf_salt, key_version, wrapped_account_key FROM users WHERE id = ?').get(jane.user.id)).toEqual(before);
    expect((await request(app).get('/api/me').set(other.auth)).status).toBe(200);
    expect((await login(app, 'jane.wrong', jane.passphrase)).res.status).toBe(200);
    expect(await activity(app, jane.auth)).toContain('auth.passphrase_reauth_failed');
    // no session at all
    expect((await request(app).post('/api/account/passphrase').send(await changeBody(app, jane))).status).toBe(401);
  });

  it('applies the PBKDF2 floor to the new passphrase (PR #2): fewer rounds than the server allows are refused', async () => {
    const { app, db } = makeApp();
    const jane = await registerUser(app, 'jane.floor2');
    // her account (made at 1,000 rounds) moved to a server whose floor is now 5,000
    const { app: strict } = makeApp({ minKdfIterations: 5000 });
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(jane.user.id) as Record<string, unknown>;
    const sdb = getDb(strict);
    const cols = Object.keys(row);
    sdb.prepare(`INSERT INTO users (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => row[c]));
    const { auth } = await login(strict, 'jane.floor2', jane.passphrase);
    const body = await changeBody(strict, { ...jane, auth });
    const low = await request(strict).post('/api/account/passphrase').set(auth).send(body);
    expect(low.status).toBe(400);
    expect(low.body.error).toMatch(/kdfIterations: must be at least 5000/);
    expect((await login(strict, 'jane.floor2', NEW_PASS)).res.status).toBe(401);
    const ok = await changeBody(strict, { ...jane, auth }, jane.passphrase, NEW_PASS, 5000);
    expect((await request(strict).post('/api/account/passphrase').set(auth).send(ok)).status).toBe(200);
  });

  it('is conditional: if her passphrase changed meanwhile, nothing changes here (409)', async () => {
    const { app } = makeApp();
    const jane = await registerUser(app, 'jane.race');
    const first = await changeBody(app, jane, jane.passphrase, 'first-river-otter-lilac-heron-tulip');
    const second = await changeBody(app, jane, jane.passphrase, 'second-river-otter-lilac-heron-tulip');
    hook.duringHash = async () => {
      expect((await request(app).post('/api/account/passphrase').set(jane.auth).send(first)).status).toBe(200);
    };
    const res = await request(app).post('/api/account/passphrase').set(jane.auth).send(second);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('passphrase_changed');
    expect((await login(app, 'jane.race', 'first-river-otter-lilac-heron-tulip')).res.status).toBe(200);
    expect((await login(app, 'jane.race', 'second-river-otter-lilac-heron-tulip')).res.status).toBe(401);
  });

  it('is rate-limited', async () => {
    const { app } = makeApp();
    const jane = await registerUser(app, 'jane.limit');
    const wrong = await changeBody(app, jane, 'not-her-passphrase-at-all');
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await request(app).post('/api/account/passphrase').set(jane.auth).send(wrong)).status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    // even the right passphrase waits now
    expect((await request(app).post('/api/account/passphrase').set(jane.auth).send(await changeBody(app, jane))).status).toBe(429);
  });

  it('works for attorneys too (their shares still open afterwards)', async () => {
    const { app } = makeApp();
    const atty = await registerUser(app, 'atty.self', 'attorney');
    const res = await change(app, atty);
    expect(res.status).toBe(200);
    expect(res.body.user.keyVersion).toBe(2);
    const { res: inRes, pk } = await login(app, 'atty.self', NEW_PASS);
    const { masterKey } = await unlockAccount(pk, inRes.body.user.wrappedAccountKey);
    expect((await unwrapPrivateKey(inRes.body.user.wrappedPrivateKey, masterKey)).type).toBe('private');
  });
});

describe('her sessions', () => {
  it('lists her unexpired sessions (sign-in times only), marking this one', async () => {
    const { app, db } = makeApp();
    const jane = await registerUser(app, 'jane.list');
    await login(app, 'jane.list', jane.passphrase);
    await registerUser(app, 'sam.list');
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run('f'.repeat(64), jane.user.id, new Date(0).toISOString(), 1);
    const res = await request(app).get('/api/auth/sessions').set(jane.auth);
    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(2);
    expect(res.body.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    for (const s of res.body.sessions) expect(Object.keys(s).sort()).toEqual(['current', 'expiresAt', 'signedInAt']);
    expect((await request(app).get('/api/auth/sessions')).status).toBe(401);
  });

  it('revoke-others needs her passphrase, ends every other session (401), keeps this one, and is in her activity', async () => {
    const { app } = makeApp();
    const jane = await registerUser(app, 'jane.revoke');
    const other = await login(app, 'jane.revoke', jane.passphrase);
    const { pk } = await login(app, 'jane.revoke', jane.passphrase);

    expect((await request(app).post('/api/auth/sessions/revoke-others').set(jane.auth).send({})).status).toBe(400);
    const wrongKey = (await derivePassphraseKeys('not-her-passphrase', (await prelogin(app, 'jane.revoke')).kdfSalt, TEST_ITERATIONS)).authKey;
    expect((await request(app).post('/api/auth/sessions/revoke-others').set(jane.auth).send({ authKey: wrongKey })).status).toBe(401);
    expect((await request(app).get('/api/me').set(other.auth)).status).toBe(200);

    const res = await request(app).post('/api/auth/sessions/revoke-others').set(jane.auth).send({ authKey: pk.authKey });
    expect(res.status).toBe(200);
    expect(res.body.endedSessions).toBe(2);
    expect((await request(app).get('/api/me').set(other.auth)).status).toBe(401);
    expect((await request(app).get('/api/me').set(jane.auth)).status).toBe(200);
    expect((await request(app).get('/api/auth/sessions').set(jane.auth)).body.sessions).toHaveLength(1);
    const acts = await activity(app, jane.auth);
    expect(acts).toContain('auth.other_sessions_ended');
    expect(acts).toContain('auth.sessions_reauth_failed');
    // her passphrase still works (nothing about it changed)
    expect((await login(app, 'jane.revoke', jane.passphrase)).res.status).toBe(200);
  });

  it('revoke-others is rate-limited', async () => {
    const { app } = makeApp();
    const jane = await registerUser(app, 'jane.revlimit');
    const wrongKey = (await derivePassphraseKeys('not-her-passphrase', (await prelogin(app, 'jane.revlimit')).kdfSalt, TEST_ITERATIONS)).authKey;
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await request(app).post('/api/auth/sessions/revoke-others').set(jane.auth).send({ authKey: wrongKey })).status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});

describe('races with a passphrase change (real server, real crypto)', () => {
  /** Signs in and fully unlocks, as her client does: the passphrase must open her private key, not only authenticate. */
  async function opens(app: express.Express, username: string, passphrase: string) {
    const { res, pk } = await login(app, username, passphrase);
    if (res.status !== 200) return `sign-in ${res.status}`;
    try {
      const { masterKey } = await unlockAccount(pk, res.body.user.wrappedAccountKey);
      await unwrapPrivateKey(res.body.user.wrappedPrivateKey, masterKey);
      return 'opens';
    } catch {
      return 'signs in but opens nothing';
    }
  }

  it('a recovery-code set-up in flight when the passphrase changes is refused (409), and the new passphrase still opens her space', async () => {
    const { app } = makeApp();
    const jane = await registerUser(app, 'jane.rc-race'); // key version 1: set-up sends AS wrapped under the OLD passphrase
    const pre = await prelogin(app, 'jane.rc-race');
    const pk = await derivePassphraseKeys(jane.passphrase, pre.kdfSalt, pre.kdfIterations);
    const as = await legacyAccountSecret(pk.ikm);
    const rk = await deriveRecoveryKeys(generateRecoveryCode().bytes);
    const setUp = { authKey: pk.authKey, wrappedAccountKey: await wrapAccountSecret(as, pk.kek), recoveryAuthKey: rk.authKey, recoveryWrappedKey: await wrapAccountSecret(as, rk.kek) };
    as.fill(0);
    const changed = await changeBody(app, jane);
    // the change commits while the set-up route is hashing the recovery auth key, after it re-authenticated
    hook.duringHash = async () => {
      expect((await request(app).post('/api/account/passphrase').set(jane.auth).send(changed)).status).toBe(200);
    };
    const res = await request(app).post('/api/account/recovery').set(jane.auth).send(setUp);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('passphrase_changed');
    expect(await opens(app, 'jane.rc-race', NEW_PASS)).toBe('opens');
    expect(await opens(app, 'jane.rc-race', jane.passphrase)).toBe('sign-in 401');
    expect((await request(app).get('/api/me').set(jane.auth)).body.user.hasRecoveryCode).toBe(false);
  });

  it('turning the recovery code off is conditional too', async () => {
    const { app } = makeApp();
    const jane = await registerUser(app, 'jane.off-race');
    const code = await setUpRecovery(app, jane);
    expect(code).toBeTruthy();
    const off = { authKey: (await derivePassphraseKeys(jane.passphrase, (await prelogin(app, 'jane.off-race')).kdfSalt, TEST_ITERATIONS)).authKey };
    const changed = await changeBody(app, jane);
    hook.duringVerify = async () => {
      expect((await request(app).post('/api/account/passphrase').set(jane.auth).send(changed)).status).toBe(200);
    };
    const res = await request(app).delete('/api/account/recovery').set(jane.auth).send(off);
    expect(res.status).toBe(409);
    expect((await request(app).get('/api/me').set(jane.auth)).body.user.hasRecoveryCode).toBe(true);
  });

  it('a sign-in with the old passphrase in flight during the change gets no session', async () => {
    const { app, db } = makeApp();
    const jane = await registerUser(app, 'jane.login-race');
    const changed = await changeBody(app, jane);
    const pre = await prelogin(app, 'jane.login-race');
    const old = await derivePassphraseKeys(jane.passphrase, pre.kdfSalt, pre.kdfIterations);
    const before = (db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id = ?').get(jane.user.id) as { n: number }).n;
    // the old passphrase checks out, then the change commits before the session would be created
    hook.duringVerify = async () => {
      expect((await request(app).post('/api/account/passphrase').set(jane.auth).send(changed)).status).toBe(200);
    };
    const res = await request(app).post('/api/auth/login').send({ username: 'jane.login-race', authKey: old.authKey });
    expect(res.status).toBe(401);
    expect((db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id = ?').get(jane.user.id) as { n: number }).n).toBe(before);
  });

  it('wrong passphrases typed into her open session are always listed, at most 10 a day', async () => {
    const { app, db } = makeApp();
    const jane = await registerUser(app, 'jane.guess');
    const wrong = { authKey: (await derivePassphraseKeys('not-her-passphrase', (await prelogin(app, 'jane.guess')).kdfSalt, TEST_ITERATIONS)).authKey };
    for (let i = 0; i < 6; i++) await request(app).post('/api/auth/sessions/revoke-others').set(jane.auth).send(wrong);
    for (let i = 0; i < 6; i++) await request(app).delete('/api/account/recovery').set(jane.auth).send(wrong);
    const rows = (db.prepare(`SELECT action FROM audit_events WHERE user_id = ? AND action LIKE 'auth.%reauth_failed'`).all(jane.user.id) as Array<{ action: string }>).length;
    expect(rows).toBe(10);
    // flood the list with other rows: the failures are still returned
    const ins = db.prepare('INSERT INTO audit_events (id, user_id, action, detail, at) VALUES (?, ?, ?, ?, ?)');
    for (let i = 0; i < 1100; i++) ins.run(`f${i}`, jane.user.id, 'record.created', null, new Date(Date.now() + 60_000 + i).toISOString());
    const listed = await activity(app, jane.auth);
    expect(listed.filter((a) => a.endsWith('reauth_failed'))).toHaveLength(10);
  });
});
