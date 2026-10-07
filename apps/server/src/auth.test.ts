import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { deriveKeys, DEFAULT_KDF_ITERATIONS } from '@shield/crypto';
import { makeApp, registerUser, TEST_ITERATIONS } from './test-helpers.js';

describe('auth', () => {
  it('health + security headers', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/health');
    expect(res.body).toEqual({ ok: true });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('register → prelogin → login → me → logout', async () => {
    const { app, db } = makeApp();
    const u = await registerUser(app, 'Jane.Test');
    expect(u.user.username).toBe('jane.test');
    expect(u.user.role).toBe('survivor');

    // server never stores the authKey itself
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(u.user.id) as Record<string, unknown>;
    const serialized = JSON.stringify(row, (_k, v) => (Buffer.isBuffer(v) ? v.toString('base64') : v));
    expect(serialized).not.toContain(u.authKey);

    const pre = await request(app).get('/api/auth/prelogin').query({ username: 'jane.test' });
    expect(pre.status).toBe(200);
    expect(pre.body.kdfIterations).toBe(TEST_ITERATIONS);

    const { authKey } = await deriveKeys(u.passphrase, pre.body.kdfSalt, pre.body.kdfIterations);
    const login = await request(app).post('/api/auth/login').send({ username: 'jane.test', authKey });
    expect(login.status).toBe(200);
    expect(login.body.user.id).toBe(u.user.id);

    const me = await request(app).get('/api/me').set('Authorization', `Bearer ${login.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe('jane.test');
    expect(me.body.attorneyProfile).toBeUndefined();

    // only the token hash is stored
    expect(db.prepare('SELECT 1 FROM sessions WHERE token_hash = ?').get(login.body.token)).toBeUndefined();

    const out = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${login.body.token}`);
    expect(out.body).toEqual({ ok: true });
    const after = await request(app).get('/api/me').set('Authorization', `Bearer ${login.body.token}`);
    expect(after.status).toBe(401);
  });

  it('rejects wrong authKey and unknown users with the same error', async () => {
    const { app } = makeApp();
    await registerUser(app, 'jane.test');
    const bad = Buffer.alloc(32, 7).toString('base64');
    const a = await request(app).post('/api/auth/login').send({ username: 'jane.test', authKey: bad });
    const b = await request(app).post('/api/auth/login').send({ username: 'nobody.here', authKey: bad });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body).toEqual(b.body);
  });

  it('prelogin resists username enumeration (deterministic fake salt)', async () => {
    const { app } = makeApp();
    const r1 = await request(app).get('/api/auth/prelogin').query({ username: 'ghost.user' });
    const r2 = await request(app).get('/api/auth/prelogin').query({ username: 'ghost.user' });
    const r3 = await request(app).get('/api/auth/prelogin').query({ username: 'other.ghost' });
    expect(r1.status).toBe(200);
    expect(r1.body).toEqual(r2.body);
    expect(r1.body.kdfSalt).not.toBe(r3.body.kdfSalt);
    expect(r1.body.kdfIterations).toBe(DEFAULT_KDF_ITERATIONS);
    expect(Buffer.from(r1.body.kdfSalt, 'base64')).toHaveLength(16);
  });

  it('rejects duplicate usernames and invalid input', async () => {
    const { app } = makeApp();
    await registerUser(app, 'jane.test');
    await expect(registerUser(app, 'jane.test')).rejects.toThrow(/409/);
    const res = await request(app).post('/api/auth/register').send({ username: 'x', role: 'admin' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_request');
    const badJson = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{nope');
    expect(badJson.status).toBe(400);
    expect(badJson.body.code).toBe('invalid_json');
  });

  it('attorney requires profile, starts unverified, appears only once verified', async () => {
    const { app } = makeApp();
    const s = await registerUser(app, 'jane.test');
    const a = await registerUser(app, 'atty.one', 'attorney', { verify: false });
    const me = await request(app).get('/api/me').set(a.auth);
    expect(me.body.attorneyProfile.verified).toBe(false);
    let list = await request(app).get('/api/attorneys').set(s.auth);
    expect(list.body.attorneys).toHaveLength(0);
    await registerUser(app, 'atty.two', 'attorney', {
      profile: { displayName: 'NY Counsel', jurisdictions: ['ny'], practiceAreas: [], acceptsProBono: true },
    });
    list = await request(app).get('/api/attorneys').set(s.auth).query({ state: 'NY' });
    expect(list.body.attorneys.map((x: { displayName: string }) => x.displayName)).toEqual(['NY Counsel']);
    expect(list.body.attorneys[0].publicKey.kty).toBe('RSA');
    list = await request(app).get('/api/attorneys').set(s.auth).query({ state: 'NJ' });
    expect(list.body.attorneys).toHaveLength(0);
  });

  it('rate-limits repeated login attempts', async () => {
    const { app } = makeApp();
    const bad = Buffer.alloc(32, 1).toString('base64');
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++)
      statuses.push((await request(app).post('/api/auth/login').send({ username: 'brute.force', authKey: bad })).status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});
