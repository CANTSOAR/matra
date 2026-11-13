import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type express from 'express';
import {
  decryptJSON,
  derivePassphraseKeys,
  deriveRecoveryKeys,
  generateRecoveryCode,
  importAccountSecret,
  legacyAccountSecret,
  newKdfSalt,
  parseRecoveryCode,
  toBase64,
  unlockAccount,
  unwrapAccountSecret,
  unwrapKeyWithMaster,
  wrapAccountSecret,
} from '@matra/crypto';
import type { Envelope, PublicUser } from '@matra/shared';
import { AUDIT_LIST_LIMIT, getDb, LOGIN_FAILED_AUDIT_CAP, RECOVERY_FAILED_AUDIT_CAP } from './app.js';
import { hashAuthKey } from './auth.js';
import { sha256Hex } from './ledger.js';
import { createRecord, makeApp, registerUser, TEST_ITERATIONS, type TestUser } from './test-helpers.js';

// Count the timing-parity path without changing what it does; optionally run something during a hash (race tests).
const dummy = vi.hoisted(() => ({ calls: 0, duringHash: null as null | (() => Promise<void>) }));
vi.mock('./auth.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./auth.js')>();
  return {
    ...mod,
    dummyVerify: async (k: string) => {
      dummy.calls++;
      return mod.dummyVerify(k);
    },
    hashAuthKey: async (k: string) => {
      const hook = dummy.duringHash;
      dummy.duringHash = null;
      if (hook) await hook();
      return mod.hashAuthKey(k);
    },
  };
});

async function prelogin(app: express.Express, username: string) {
  return (await request(app).get('/api/auth/prelogin').query({ username })).body as { kdfSalt: string; kdfIterations: number };
}

/** What her client does in Settings → Recovery code: re-derive AS from the passphrase, make a code, wrap AS under it. */
async function setUpRecovery(app: express.Express, u: TestUser, passphrase = u.passphrase) {
  const me = (await request(app).get('/api/me').set(u.auth)).body.user as PublicUser;
  const pre = await prelogin(app, me.username);
  const pk = await derivePassphraseKeys(passphrase, pre.kdfSalt, pre.kdfIterations);
  const as = me.wrappedAccountKey ? await unwrapAccountSecret(me.wrappedAccountKey, pk.kek) : await legacyAccountSecret(pk.ikm);
  const { bytes, code } = generateRecoveryCode();
  const rk = await deriveRecoveryKeys(bytes);
  const body = {
    authKey: pk.authKey,
    ...(me.keyVersion === 1 && { wrappedAccountKey: await wrapAccountSecret(as, pk.kek) }),
    recoveryAuthKey: rk.authKey,
    recoveryWrappedKey: await wrapAccountSecret(as, rk.kek),
  };
  as.fill(0);
  const res = await request(app).post('/api/account/recovery').set(u.auth).send(body);
  return { res, code, body };
}

/**
 * The signed-out reset: alias + code → new passphrase; then, as her client does once she confirms she wrote it down,
 * a new code saved through POST /api/account/recovery with the new passphrase (`saveNewCode: false` skips that).
 */
async function recover(app: express.Express, username: string, code: string, newPassphrase: string, { saveNewCode = true } = {}) {
  const rk = await deriveRecoveryKeys(parseRecoveryCode(code));
  const start = await request(app).post('/api/auth/recover/start').send({ username, recoveryAuthKey: rk.authKey });
  if (start.status !== 200) return { start };
  const as = await unwrapAccountSecret(start.body.recoveryWrappedKey as Envelope, rk.kek);
  const kdfSalt = newKdfSalt();
  const pk = await derivePassphraseKeys(newPassphrase, kdfSalt, TEST_ITERATIONS);
  const next = generateRecoveryCode();
  const nrk = await deriveRecoveryKeys(next.bytes);
  const finishBody = {
    resetToken: start.body.resetToken as string,
    kdfSalt,
    kdfIterations: TEST_ITERATIONS,
    authKey: pk.authKey,
    wrappedAccountKey: await wrapAccountSecret(as, pk.kek),
  };
  const codeBody = { authKey: pk.authKey, recoveryAuthKey: nrk.authKey, recoveryWrappedKey: await wrapAccountSecret(as, nrk.kek) };
  as.fill(0);
  const finish = await request(app).post('/api/auth/recover/finish').send(finishBody);
  const saved =
    saveNewCode && finish.status === 200
      ? await request(app).post('/api/account/recovery').set('Authorization', `Bearer ${finish.body.token}`).send(codeBody)
      : undefined;
  return { start, finish, finishBody, codeBody, saved, newCode: next.code };
}

async function login(app: express.Express, username: string, passphrase: string) {
  const pre = await prelogin(app, username);
  const pk = await derivePassphraseKeys(passphrase, pre.kdfSalt, pre.kdfIterations);
  const res = await request(app).post('/api/auth/login').send({ username, authKey: pk.authKey });
  return { res, pk };
}

describe('recovery code', () => {
  it('new accounts are key version 1 with no code; set-up moves her to version 2 and old records still open', async () => {
    const { app } = makeApp();
    const u = await registerUser(app, 'wren.one');
    expect(u.user.keyVersion).toBe(1);
    expect(u.user.hasRecoveryCode).toBe(false);
    expect(u.user.wrappedAccountKey).toBeUndefined();
    const { res: rec, key } = await createRecord(app, u, { story: 'before the code' });
    expect(rec.status).toBe(201);

    const { res } = await setUpRecovery(app, u);
    expect(res.status).toBe(200);
    expect(res.body.user.keyVersion).toBe(2);
    expect(res.body.user.hasRecoveryCode).toBe(true);
    expect(res.body.user.wrappedAccountKey).toBeDefined();

    // signing in with the same passphrase now goes through the wrapped account key, to the same master key
    const { res: li, pk } = await login(app, 'wren.one', u.passphrase);
    expect(li.status).toBe(200);
    const { masterKey } = await unlockAccount(pk, li.body.user.wrappedAccountKey);
    const got = (await request(app).get(`/api/vault/records/${rec.body.record.id}`).set('Authorization', `Bearer ${li.body.token}`)).body.record;
    const k = await unwrapKeyWithMaster(got.ownerWrappedKey, masterKey);
    expect(await decryptJSON(got.envelope, k)).toEqual({ story: 'before the code' });
    expect(key).toBeDefined();
  });

  it('set-up needs the right passphrase, and the wrapped account key exactly when moving to version 2', async () => {
    const { app } = makeApp();
    const u = await registerUser(app, 'wren.two');
    const wrong = await setUpRecovery(app, u, 'not her passphrase');
    // (the wrong passphrase can't even re-derive AS correctly; the server refuses on the auth key first)
    expect(wrong.res.status).toBe(401);
    expect(wrong.res.body.code).toBe('invalid_credentials');

    const { body } = await setUpRecovery(app, u);
    const v1Body = { ...body };
    // already version 2: a second wrapped account key is refused (it would replace what her passphrase opens)
    const again = await request(app).post('/api/account/recovery').set(u.auth).send(v1Body);
    expect(again.status).toBe(400);
    // and a version-1 account must send one
    const v = await registerUser(app, 'wren.three');
    const { wrappedAccountKey: _w, ...noWrap } = v1Body;
    const pk = await derivePassphraseKeys(v.passphrase, (await prelogin(app, 'wren.three')).kdfSalt, TEST_ITERATIONS);
    const missing = await request(app).post('/api/account/recovery').set(v.auth).send({ ...noWrap, authKey: pk.authKey });
    expect(missing.status).toBe(400);
  });

  it('recover: start → finish; the old passphrase stops working, the new one opens the same records; other sessions end', async () => {
    const { app, db } = makeApp();
    const u = await registerUser(app, 'wren.four');
    const { res: rec } = await createRecord(app, u, { story: 'still mine' });
    const { code } = await setUpRecovery(app, u);

    const r = await recover(app, 'wren.four', code, 'a whole new passphrase');
    expect(r.start.status).toBe(200);
    expect(r.finish!.status).toBe(200);
    const token = r.finish!.body.token as string;
    // the used code is burned and no new one exists until she confirms it (then it is saved separately)
    expect(r.finish!.body.user.hasRecoveryCode).toBe(false);
    expect(r.saved!.status).toBe(200);
    expect(r.saved!.body.user.hasRecoveryCode).toBe(true);

    // her earlier session (registration) is gone; the new one works
    expect((await request(app).get('/api/me').set(u.auth)).status).toBe(401);
    expect((await request(app).get('/api/me').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(u.user.id)).toEqual({ n: 1 });

    expect((await login(app, 'wren.four', u.passphrase)).res.status).toBe(401);
    const { res: li, pk } = await login(app, 'wren.four', 'a whole new passphrase');
    expect(li.status).toBe(200);
    const { masterKey } = await unlockAccount(pk, li.body.user.wrappedAccountKey);
    const got = (await request(app).get(`/api/vault/records/${rec.body.record.id}`).set('Authorization', `Bearer ${li.body.token}`)).body.record;
    expect(await decryptJSON(got.envelope, await unwrapKeyWithMaster(got.ownerWrappedKey, masterKey))).toEqual({ story: 'still mine' });

    // her own activity says so, and the ledger has an entry with only an id, a hash and a time
    const audit = (await request(app).get('/api/audit').set('Authorization', `Bearer ${token}`)).body.events as Array<{ action: string; detail?: string }>;
    expect(audit.find((e) => e.action === 'auth.recovered')?.detail).toBe('Your passphrase was reset with your recovery code');
    expect(audit.find((e) => e.action === 'recovery.used')?.detail).toBe('Your recovery code was used to start a passphrase reset');
    const led = db.prepare(`SELECT * FROM ledger WHERE type = 'account.recovered'`).all() as Array<{
      subject_id: string;
      content_hash: string;
      timestamp: string;
    }>;
    expect(led).toHaveLength(1);
    // the documented convention (ledger.ts): SHA-256_hex(JSON.stringify({ userId, at }))
    expect(led[0]!.content_hash).toBe(sha256Hex(JSON.stringify({ userId: u.user.id, at: led[0]!.timestamp })));
    expect((await request(app).get('/api/ledger/verify')).body.ok).toBe(true);

    // a used code is burned: the old one no longer works, the new one does
    expect((await recover(app, 'wren.four', code, 'x y z w v')).start.status).toBe(401);
    const again = await recover(app, 'wren.four', r.newCode!, 'yet another passphrase');
    expect(again.finish!.status).toBe(200);
  });

  it('a wrong code, an unknown alias and an alias with no code all get the same 401 after scrypt work', async () => {
    const { app } = makeApp();
    const u = await registerUser(app, 'wren.five');
    await registerUser(app, 'wren.nocode');
    await setUpRecovery(app, u);
    const wrongKey = (await deriveRecoveryKeys(generateRecoveryCode().bytes)).authKey;

    const before = dummy.calls;
    const a = await request(app).post('/api/auth/recover/start').send({ username: 'wren.five', recoveryAuthKey: wrongKey });
    const b = await request(app).post('/api/auth/recover/start').send({ username: 'nobody.here', recoveryAuthKey: wrongKey });
    const c = await request(app).post('/api/auth/recover/start').send({ username: 'wren.nocode', recoveryAuthKey: wrongKey });
    for (const r of [a, b, c]) {
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ error: 'That alias and recovery code don’t match.', code: 'invalid_credentials' });
    }
    // the real verification ran for wren.five; the two without a stored hash ran dummyVerify instead
    expect(dummy.calls - before).toBe(2);
    const audit = (await request(app).get('/api/audit').set(u.auth)).body.events as Array<{ action: string }>;
    expect(audit.some((e) => e.action === 'recovery.failed')).toBe(true);
  });

  it('the reset token is single use, expires, and dies when the code is replaced', async () => {
    const { app } = makeApp();
    const u = await registerUser(app, 'wren.six');
    const { code } = await setUpRecovery(app, u);
    const r = await recover(app, 'wren.six', code, 'first new passphrase');
    expect(r.finish!.status).toBe(200);
    // replay
    const replay = await request(app).post('/api/auth/recover/finish').send(r.finishBody);
    expect(replay.status).toBe(401);

    // expiry
    const rk = await deriveRecoveryKeys(parseRecoveryCode(r.newCode!));
    const start = await request(app).post('/api/auth/recover/start').send({ username: 'wren.six', recoveryAuthKey: rk.authKey });
    expect(start.status).toBe(200);
    const tokens = app.locals.resetTokens as Map<string, { expiresAt: number }>;
    for (const t of tokens.values()) t.expiresAt = Date.now() - 1;
    const late = await request(app).post('/api/auth/recover/finish').send({ ...r.finishBody, resetToken: start.body.resetToken });
    expect(late.status).toBe(401);
    expect(tokens.size).toBe(0);

    // a code replaced (from a signed-in session) after start: the pending reset can't finish
    const start2 = await request(app).post('/api/auth/recover/start').send({ username: 'wren.six', recoveryAuthKey: rk.authKey });
    expect(start2.status).toBe(200);
    const li = await login(app, 'wren.six', 'first new passphrase');
    const signedIn = { ...u, token: li.res.body.token, auth: { Authorization: `Bearer ${li.res.body.token}` }, passphrase: 'first new passphrase' };
    expect((await setUpRecovery(app, signedIn)).res.status).toBe(200);
    const stale = await request(app).post('/api/auth/recover/finish').send({ ...r.finishBody, resetToken: start2.body.resetToken });
    expect(stale.status).toBe(401);
  });

  it('making a new code invalidates the old one; turning it off removes recovery entirely', async () => {
    const { app, db } = makeApp();
    const u = await registerUser(app, 'wren.seven');
    const first = await setUpRecovery(app, u);
    const second = await setUpRecovery(app, u);
    expect(second.res.status).toBe(200);
    const k1 = await deriveRecoveryKeys(parseRecoveryCode(first.code));
    const k2 = await deriveRecoveryKeys(parseRecoveryCode(second.code));
    expect((await request(app).post('/api/auth/recover/start').send({ username: 'wren.seven', recoveryAuthKey: k1.authKey })).status).toBe(401);
    expect((await request(app).post('/api/auth/recover/start').send({ username: 'wren.seven', recoveryAuthKey: k2.authKey })).status).toBe(200);

    const pk = await derivePassphraseKeys(u.passphrase, (await prelogin(app, 'wren.seven')).kdfSalt, TEST_ITERATIONS);
    expect((await request(app).delete('/api/account/recovery').set(u.auth).send({ authKey: toBase64(new Uint8Array(32)) })).status).toBe(401);
    const off = await request(app).delete('/api/account/recovery').set(u.auth).send({ authKey: pk.authKey });
    expect(off.status).toBe(200);
    expect(off.body.user.hasRecoveryCode).toBe(false);
    expect(off.body.user.keyVersion).toBe(2); // her passphrase still opens the wrapped account key
    const row = db.prepare('SELECT recovery_auth_hash, recovery_auth_salt, recovery_wrapped_key FROM users WHERE id = ?').get(u.user.id);
    expect(row).toEqual({ recovery_auth_hash: null, recovery_auth_salt: null, recovery_wrapped_key: null });
    expect((await request(app).post('/api/auth/recover/start').send({ username: 'wren.seven', recoveryAuthKey: k2.authKey })).status).toBe(401);
    // and she can still sign in
    expect((await login(app, 'wren.seven', u.passphrase)).res.status).toBe(200);
  });

  it('recover/start is rate-limited', async () => {
    const { app } = makeApp();
    const wrongKey = (await deriveRecoveryKeys(generateRecoveryCode().bytes)).authKey;
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++)
      statuses.push((await request(app).post('/api/auth/recover/start').send({ username: 'wren.eight', recoveryAuthKey: wrongKey })).status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it('the server stores no code material: only scrypt hashes and ciphertext (it cannot reset anyone)', async () => {
    const { app, db } = makeApp();
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a) => void logs.push(a.join(' ')));
    try {
      const u = await registerUser(app, 'wren.nine');
      const { code, body } = await setUpRecovery(app, u);
      const r = await recover(app, 'wren.nine', code, 'brand new words here');
      expect(r.finish!.status).toBe(200);

      const dump = JSON.stringify(
        db.prepare('SELECT * FROM users').all(),
        (_k, v) => (v && typeof v === 'object' && v.type === 'Buffer' ? Buffer.from(v.data).toString('base64') : Buffer.isBuffer(v) ? v.toString('base64') : v),
      );
      const plain = code.replace(/-/g, '');
      const codeBytes = toBase64(parseRecoveryCode(code));
      const newCodeBytes = toBase64(parseRecoveryCode(r.newCode!));
      for (const secret of [code, plain, r.newCode!, codeBytes, newCodeBytes, body.recoveryAuthKey, r.codeBody!.recoveryAuthKey, r.finishBody!.authKey, 'brand new words here']) {
        expect(dump).not.toContain(secret);
        expect(logs.join('\n')).not.toContain(secret);
      }
      // what IS there: a hash and a wrapped key, which only the code's KEK opens
      const row = db.prepare('SELECT recovery_auth_hash, recovery_wrapped_key FROM users WHERE username = ?').get('wren.nine') as {
        recovery_auth_hash: Buffer;
        recovery_wrapped_key: string;
      };
      expect(row.recovery_auth_hash.length).toBe(32);
      const nrk = await deriveRecoveryKeys(parseRecoveryCode(r.newCode!));
      const as = await unwrapAccountSecret(JSON.parse(row.recovery_wrapped_key), nrk.kek);
      await expect(importAccountSecret(as)).resolves.toBeDefined();
    } finally {
      spy.mockRestore();
    }
    expect(getDb(app)).toBe(db);
  });

  it('a successful start is in her activity even if no reset follows (the wrapped secret has left)', async () => {
    const { app } = makeApp();
    const u = await registerUser(app, 'wren.used');
    const { code } = await setUpRecovery(app, u);
    const rk = await deriveRecoveryKeys(parseRecoveryCode(code));
    expect((await request(app).post('/api/auth/recover/start').send({ username: 'wren.used', recoveryAuthKey: rk.authKey })).status).toBe(200);
    const audit = (await request(app).get('/api/audit').set(u.auth)).body.events as Array<{ action: string; detail?: string }>;
    expect(audit.filter((e) => e.action === 'recovery.used')).toEqual([
      expect.objectContaining({ detail: 'Your recovery code was used to start a passphrase reset' }),
    ]);
    // her passphrase still works and the code is still set up: she learns of it here, and can replace it
    expect((await login(app, 'wren.used', u.passphrase)).res.status).toBe(200);
  });

  it('a finish already past the token check changes nothing if she replaces her code meanwhile', async () => {
    const { app } = makeApp();
    const u = await registerUser(app, 'wren.race');
    const { code } = await setUpRecovery(app, u);
    let replaced: Awaited<ReturnType<typeof setUpRecovery>> | undefined;
    // runs inside finish's scrypt of the new passphrase, after the token was accepted
    dummy.duringHash = async () => {
      replaced = await setUpRecovery(app, u);
    };
    const r = await recover(app, 'wren.race', code, 'the attacker passphrase', { saveNewCode: false });
    expect(r.start.status).toBe(200);
    expect(replaced!.res.status).toBe(200);
    expect(r.finish!.status).toBe(401);
    expect(r.finish!.body.code).toBe('invalid_credentials');
    // her passphrase and her new code both still work; the attacker's passphrase does not
    expect((await login(app, 'wren.race', 'the attacker passphrase')).res.status).toBe(401);
    expect((await login(app, 'wren.race', u.passphrase)).res.status).toBe(200);
    const rk = await deriveRecoveryKeys(parseRecoveryCode(replaced!.code));
    expect((await request(app).post('/api/auth/recover/start').send({ username: 'wren.race', recoveryAuthKey: rk.authKey })).status).toBe(200);
    const audit = (await request(app).get('/api/audit').set(u.auth)).body.events as Array<{ action: string }>;
    expect(audit.some((e) => e.action === 'auth.recovered')).toBe(false);
  });

  it('only survivor accounts can set up or use a recovery code', async () => {
    const { app, db } = makeApp();
    for (const role of ['attorney', 'counselor'] as const) {
      const u = await registerUser(app, `${role}.rc`, role);
      const { res, body } = await setUpRecovery(app, u);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('forbidden_role');
      expect((db.prepare('SELECT recovery_auth_hash FROM users WHERE id = ?').get(u.user.id) as { recovery_auth_hash: Buffer | null }).recovery_auth_hash).toBeNull();

      // even with a code planted in the row (e.g. an older build), start answers as for an account without one
      const rk = await deriveRecoveryKeys(generateRecoveryCode().bytes);
      const { hash, salt } = await hashAuthKey(rk.authKey);
      db.prepare('UPDATE users SET recovery_auth_hash = ?, recovery_auth_salt = ?, recovery_wrapped_key = ? WHERE id = ?').run(
        hash,
        salt,
        JSON.stringify(body.recoveryWrappedKey),
        u.user.id,
      );
      const before = dummy.calls;
      const start = await request(app).post('/api/auth/recover/start').send({ username: `${role}.rc`, recoveryAuthKey: rk.authKey });
      expect(start.status).toBe(401);
      expect(start.body).toEqual({ error: 'That alias and recovery code don’t match.', code: 'invalid_credentials' });
      expect(dummy.calls - before).toBe(1);
    }
  });

  it('wrong codes write at most RECOVERY_FAILED_AUDIT_CAP activity rows per day', async () => {
    const { app, db } = makeApp();
    const u = await registerUser(app, 'wren.flood');
    await setUpRecovery(app, u);
    const wrongKey = (await deriveRecoveryKeys(generateRecoveryCode().bytes)).authKey;
    const count = () =>
      (db.prepare(`SELECT COUNT(*) AS n FROM audit_events WHERE user_id = ? AND action = 'recovery.failed'`).get(u.user.id) as { n: number }).n;
    // rows already written today (from other clients) up to one below the cap
    const now = new Date().toISOString();
    for (let i = 0; i < RECOVERY_FAILED_AUDIT_CAP - 1; i++)
      db.prepare('INSERT INTO audit_events (id, user_id, action, detail, at) VALUES (?, ?, ?, ?, ?)').run(`f${i}`, u.user.id, 'recovery.failed', 'x', now);
    for (let i = 0; i < 3; i++)
      expect((await request(app).post('/api/auth/recover/start').send({ username: 'wren.flood', recoveryAuthKey: wrongKey })).status).toBe(401);
    expect(count()).toBe(RECOVERY_FAILED_AUDIT_CAP);
    // yesterday's rows don't count against today
    db.prepare(`UPDATE audit_events SET at = '2000-01-01T00:00:00.000Z' WHERE user_id = ? AND action = 'recovery.failed'`).run(u.user.id);
    expect((await request(app).post('/api/auth/recover/start').send({ username: 'wren.flood', recoveryAuthKey: wrongKey })).status).toBe(401);
    expect(count()).toBe(RECOVERY_FAILED_AUDIT_CAP + 1);
  });

  it('wrong passphrases write at most LOGIN_FAILED_AUDIT_CAP activity rows per day', async () => {
    const { app, db } = makeApp();
    const u = await registerUser(app, 'wren.knock');
    const wrong = await registerUser(app, 'someone.else');
    const count = () =>
      (db.prepare(`SELECT COUNT(*) AS n FROM audit_events WHERE user_id = ? AND action = 'auth.login_failed'`).get(u.user.id) as { n: number }).n;
    const now = new Date().toISOString();
    for (let i = 0; i < LOGIN_FAILED_AUDIT_CAP - 1; i++)
      db.prepare('INSERT INTO audit_events (id, user_id, action, detail, at) VALUES (?, ?, ?, ?, ?)').run(`l${i}`, u.user.id, 'auth.login_failed', 'x', now);
    for (let i = 0; i < 3; i++)
      expect((await request(app).post('/api/auth/login').send({ username: 'wren.knock', authKey: wrong.authKey })).status).toBe(401);
    expect(count()).toBe(LOGIN_FAILED_AUDIT_CAP);
    db.prepare(`UPDATE audit_events SET at = '2000-01-01T00:00:00.000Z' WHERE user_id = ? AND action = 'auth.login_failed'`).run(u.user.id);
    expect((await request(app).post('/api/auth/login').send({ username: 'wren.knock', authKey: wrong.authKey })).status).toBe(401);
    expect(count()).toBe(LOGIN_FAILED_AUDIT_CAP + 1);
  });

  it('her activity always includes recovery-code events, however many newer rows there are', async () => {
    const { app, db } = makeApp();
    const u = await registerUser(app, 'wren.buried');
    const { code } = await setUpRecovery(app, u);
    const r = await recover(app, 'wren.buried', code, 'brand new passphrase words');
    expect(r.finish?.status).toBe(200);
    // push the recovery rows back in time, then bury them under more than a page of newer rows
    db.prepare(`UPDATE audit_events SET at = '2001-01-01T00:00:00.000Z' WHERE user_id = ? AND (action LIKE 'recovery.%' OR action = 'auth.recovered')`).run(u.user.id);
    const ins = db.prepare('INSERT INTO audit_events (id, user_id, action, detail, at) VALUES (?, ?, ?, ?, ?)');
    const now = new Date().toISOString();
    db.transaction(() => {
      for (let i = 0; i < AUDIT_LIST_LIMIT + 50; i++) ins.run(`n${i}`, u.user.id, 'record.created', `ledger #${i}`, now);
    })();
    const auth = { Authorization: `Bearer ${r.finish!.body.token}` }; // the reset signed out her old session
    const events = (await request(app).get('/api/audit').set(auth)).body.events as Array<{ action: string; at: string }>;
    const actions = events.map((e) => e.action);
    expect(actions).toContain('recovery.used');
    expect(actions).toContain('recovery.set_up');
    expect(actions).toContain('auth.recovered');
    expect(actions.filter((a) => a === 'record.created').length).toBeLessThanOrEqual(AUDIT_LIST_LIMIT);
    // still newest first, with the older security rows at the end
    expect(events[events.length - 1]!.at).toBe('2001-01-01T00:00:00.000Z');
  });

  it('deleting the account removes the recovery columns with the user row', async () => {
    const { app, db } = makeApp();
    const u = await registerUser(app, 'wren.ten');
    const { code } = await setUpRecovery(app, u);
    expect((await request(app).post('/api/account/delete').set(u.auth).send({ authKey: u.authKey })).status).toBe(200);
    expect(db.prepare('SELECT 1 FROM users WHERE username = ?').get('wren.ten')).toBeUndefined();
    expect((await recover(app, 'wren.ten', code, 'whatever words')).start.status).toBe(401);
  });
});
