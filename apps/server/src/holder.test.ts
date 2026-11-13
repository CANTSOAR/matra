/**
 * Standalone OPRF key holders (src/holder.ts) and the app server's remote HolderPool (src/holders.ts): token checks,
 * per-holder quotas in the holder's own DB, and sealing with t of m holders up.
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { blindMatchIdentifier, generateOprfKey, reconstructMatchGroup, splitOprfKey, toBase64, type ShareKey } from '@matra/crypto';
import type { CounselorMatchGroup } from '@matra/shared';
import { createHolderApp, HolderDailyTotals } from './holder.js';
import { openHolderDb } from './db.js';
import { HOLDER_TOKEN_HEADER, HolderTokenVerifier, RemoteHolderPool, blindedHash, holderSubject, holderTokenPrivateKey, holderTokenPublicKey, holderTokenPublicKeyFromSeed, signHolderToken } from './holders.js';
import { getDb } from './app.js';
import { makeApp, registerUser, sealMatch, TEST_PEPPER } from './test-helpers.js';

const seed = crypto.getRandomValues(new Uint8Array(32));
const tokenKey = holderTokenPrivateKey(seed);
const sub = holderSubject(Buffer.from(TEST_PEPPER), 'user-1');
const blinded = () => ({ blinded: toBase64(blindMatchIdentifier('email:x@example.com').blinded) });

function holderApp(share: ShareKey, limits?: { perDay: number; lifetime: number }, extra?: { dbPath?: string; dailyBudget?: number }) {
  return createHolderApp({
    index: share.index,
    share,
    tokenPublicKey: holderTokenPublicKeyFromSeed(seed),
    dbPath: extra?.dbPath ?? ':memory:',
    ...(limits && { limits }),
    ...(extra?.dailyBudget && { dailyBudget: extra.dailyBudget }),
  });
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});
async function listen(app: ReturnType<typeof holderApp>): Promise<{ url: string; server: Server }> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', () => r()));
  servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

describe('standalone OPRF key holder', () => {
  const shares = splitOprfKey(generateOprfKey().secretKey, 2, 3);

  it('serves its share public key; evaluates only with a valid token (signature, aud, exp, replay)', async () => {
    const app = holderApp(shares[1]!);
    expect((await request(app).get('/key')).body).toEqual({ index: 2, publicKey: toBase64(shares[1]!.publicKey) });
    expect((await request(app).get('/health')).body).toEqual({ ok: true });
    const body = blinded();
    const bh = blindedHash(body.blinded);
    const call = (token?: string, b = body) => {
      const r = request(app).post('/evaluate');
      return (token ? r.set(HOLDER_TOKEN_HEADER, token) : r).send(b);
    };
    const ok = await call(signHolderToken(tokenKey, { sub, aud: 2, bh }));
    expect(ok.status).toBe(200);
    expect(Object.keys(ok.body).sort()).toEqual(['evaluated', 'proof']);

    expect((await call()).status).toBe(401);
    expect((await call(signHolderToken(tokenKey, { sub, aud: 1, bh }))).status).toBe(401); // wrong audience
    expect((await call(signHolderToken(tokenKey, { sub, aud: 2, bh, exp: Math.floor(Date.now() / 1000) - 1 }))).status).toBe(401); // expired
    expect((await call(signHolderToken(tokenKey, { sub, aud: 2, bh, exp: Math.floor(Date.now() / 1000) + 3600 }))).status).toBe(401); // too long-lived
    expect((await call(signHolderToken(tokenKey, { sub, aud: 2, bh, exp: Math.floor(Date.now() / 1000) + 120 }))).status).toBe(401); // > TTL + skew
    const otherKey = holderTokenPrivateKey(crypto.getRandomValues(new Uint8Array(32)));
    expect((await call(signHolderToken(otherKey, { sub, aud: 2, bh }))).status).toBe(401); // not the app server's key
    // bound to the body: a captured token cannot be spent on another blinded element
    const captured = signHolderToken(tokenKey, { sub, aud: 2, bh });
    expect((await call(captured, blinded())).status).toBe(401);
    const t = signHolderToken(tokenKey, { sub, aud: 2, bh });
    expect((await call(t)).status).toBe(200);
    expect((await call(t)).status).toBe(401); // replayed jti
    // a tampered payload (other subject) breaks the signature
    const [p, s] = t.split('.');
    const forged = Buffer.from(Buffer.from(p!, 'base64url').toString().replace(sub, holderSubject(Buffer.from(TEST_PEPPER), 'user-2'))).toString('base64url');
    expect((await call(`${forged}.${s}`)).status).toBe(401);
    expect((await call('garbage')).status).toBe(401);
  });

  it('keeps quotas per subject in its own DB, keyed by the pseudonymous subject only', async () => {
    const app = holderApp(shares[0]!, { perDay: 2, lifetime: 5 });
    const call = (s = sub) => {
      const b = blinded();
      return request(app).post('/evaluate').set(HOLDER_TOKEN_HEADER, signHolderToken(tokenKey, { sub: s, aud: 1, bh: blindedHash(b.blinded) })).send(b);
    };
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    const r = await call();
    expect(r.status).toBe(429);
    expect(r.body.code).toBe('rate_limited_daily');
    expect((await call(holderSubject(Buffer.from(TEST_PEPPER), 'user-2'))).status).toBe(200);
    const db = app.locals.db as ReturnType<typeof getDb>;
    const rows = db.prepare('SELECT user_id, holder, day_count FROM oprf_quota ORDER BY day_count DESC').all();
    // keyed by index AND share key, so a rotation starts fresh counters (see the remote rotation test below)
    const hid = `1:${toBase64(shares[0]!.publicKey)}`;
    expect(rows).toEqual([
      { user_id: sub, holder: hid, day_count: 2 },
      { user_id: holderSubject(Buffer.from(TEST_PEPPER), 'user-2'), holder: hid, day_count: 1 },
    ]);
    // invalid element → 400, not counted
    const badB = toBase64(new Uint8Array(32).fill(255));
    const bad = await request(app)
      .post('/evaluate')
      .set(HOLDER_TOKEN_HEADER, signHolderToken(tokenKey, { sub: holderSubject(Buffer.from(TEST_PEPPER), 'user-3'), aud: 1, bh: blindedHash(badB) }))
      .send({ blinded: badB });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('invalid_element');
  });

  it('remembers a jti until the token expires, not for a fixed time (no replay once the cache would have been pruned)', () => {
    const v = new HolderTokenVerifier(holderTokenPublicKey(holderTokenPublicKeyFromSeed(seed)), 1);
    const now = Date.now();
    const b = blinded().blinded;
    const exp = Math.floor(now / 1000) + 85; // within TTL + skew
    const tok = signHolderToken(tokenKey, { sub, aud: 1, bh: blindedHash(b), exp });
    expect(v.verify(tok, b, now)).not.toBeNull();
    // refused as a replay right up to its own expiry (other traffic in between prunes only expired jtis)
    const other = signHolderToken(tokenKey, { sub, aud: 1, bh: blindedHash(b), exp: Math.floor((exp * 1000 - 2) / 1000) });
    expect(v.verify(other, b, exp * 1000 - 70_000)).not.toBeNull();
    expect(v.verify(tok, b, exp * 1000 - 1)).toBeNull();
  });

  it('has a global daily evaluation budget across all subjects, kept as an append-only daily total', async () => {
    const app = holderApp(shares[2]!, { perDay: 10, lifetime: 50 }, { dailyBudget: 3 });
    const call = (u: string) => {
      const b = blinded();
      return request(app)
        .post('/evaluate')
        .set(HOLDER_TOKEN_HEADER, signHolderToken(tokenKey, { sub: holderSubject(Buffer.from(TEST_PEPPER), u), aud: 3, bh: blindedHash(b.blinded) }))
        .send(b);
    };
    // fresh subjects each time (what a holder of the app server's token key could do): the budget still binds
    for (const u of ['u1', 'u2', 'u3']) expect((await call(u)).status).toBe(200);
    const r = await call('u4');
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('holder_budget_exhausted');
    const db = app.locals.db as ReturnType<typeof getDb>;
    const today = new Date().toISOString().slice(0, 10);
    expect(db.prepare('SELECT * FROM daily_totals').all()).toEqual([{ day: today, evaluations: 3, refused: 1 }]);
    // append-only: no deleting or lowering a day's totals
    expect(() => db.prepare('DELETE FROM daily_totals').run()).toThrow(/append-only/);
    expect(() => db.prepare('UPDATE daily_totals SET evaluations = 0').run()).toThrow(/append-only/);
    expect(() => new HolderDailyTotals(openHolderDb(':memory:'), 0, 1)).toThrow(/positive integer/);
  });
});

describe('app server with remote key holders (2-of-3)', () => {
  async function stack(up: boolean[]) {
    const shares = splitOprfKey(generateOprfKey().secretKey, 2, 3);
    const urls: string[] = [];
    const running: Server[] = [];
    for (const s of shares) {
      const { url, server } = await listen(holderApp(s));
      urls.push(url);
      running.push(server);
    }
    // holders that are "down": close them, so the port refuses connections
    await Promise.all(running.map((s, i) => (up[i] ? null : new Promise((r) => s.close(r)))));
    const remote = { urls, publicKeys: shares.map((s) => toBase64(s.publicKey)), tokenKey: seed };
    const { app } = makeApp({ matching: { oprf: { t: 2, remote } } });
    return { app, remote, shares };
  }

  it('seals and matches with all holders up, and with one holder down; the app server never sends user ids', async () => {
    const { app, remote } = await stack([true, false, true]);
    expect(await new RemoteHolderPool(2, remote, Buffer.from(TEST_PEPPER), 500).verifyKeys()).toEqual({ reachable: 2 });
    const loc = await registerUser(app, 'loc.one', 'counselor');
    const a = await registerUser(app, 'survivor.a');
    const b = await registerUser(app, 'survivor.b');
    const down = await request(app).post('/api/matching/oprf/2').set(a.auth).send(blinded());
    expect(down.status).toBe(503);
    expect(down.body.code).toBe('holder_unavailable');
    const ea = await sealMatch(app, a, 'phone', '(201) 555-0142');
    const eb = await sealMatch(app, b, 'phone', '+12015550142');
    expect(eb.tag).toBe(ea.tag);
    const groups = (await request(app).get('/api/counselor/groups').set(loc.auth)).body.groups as CounselorMatchGroup[];
    expect(groups).toHaveLength(1);
    const r = await reconstructMatchGroup(groups[0]!.tag, groups[0]!.entries, loc.privateKey, loc.user.id);
    expect(r.ok).toBe(true);
    // the remote holders' quotas are not in the app DB (only the app server's account-level budget is)
    expect(getDb(app).prepare(`SELECT COUNT(*) n FROM oprf_quota WHERE holder != 'account'`).get()).toEqual({ n: 0 });
  });

  it('the same identifier gives the same tag whichever t holders answer', async () => {
    const shares = splitOprfKey(generateOprfKey().secretKey, 2, 3);
    const servers3: Array<{ url: string; server: Server }> = [];
    for (const s of shares) servers3.push(await listen(holderApp(s)));
    const remote = { urls: servers3.map((s) => s.url), publicKeys: shares.map((s) => toBase64(s.publicKey)), tokenKey: seed };
    const { app } = makeApp({ matching: { oprf: { t: 2, remote } } });
    await registerUser(app, 'loc.one', 'counselor');
    const a = await registerUser(app, 'survivor.a');
    const b = await registerUser(app, 'survivor.b');
    const ea = await sealMatch(app, a, 'email', 'same@example.com'); // all three up
    await new Promise((r) => servers3[0]!.server.close(r)); // now only holders 2 and 3
    const eb = await sealMatch(app, b, 'email', 'same@example.com');
    expect(eb.tag).toBe(ea.tag);
  });

  it('two holders down → sealing fails with holders_unavailable and nothing is stored; a wrong pinned key refuses to start', async () => {
    const { app, remote, shares } = await stack([true, false, false]);
    await registerUser(app, 'loc.one', 'counselor');
    const a = await registerUser(app, 'survivor.a');
    await expect(sealMatch(app, a, 'email', 'x@example.com')).rejects.toMatchObject({ code: 'holders_unavailable' });
    expect(getDb(app).prepare('SELECT COUNT(*) n FROM match_entries').get()).toEqual({ n: 0 });
    // startup check: a holder serving a key other than its pinned one is fatal
    const other = splitOprfKey(generateOprfKey().secretKey, 2, 3);
    const { url } = await listen(holderApp({ ...other[0]!, index: 1 }));
    const wrong = { ...remote, urls: [url, ...remote.urls.slice(1)], publicKeys: shares.map((s) => toBase64(s.publicKey)) };
    await expect(new RemoteHolderPool(2, wrong, Buffer.from(TEST_PEPPER), 500).verifyKeys()).rejects.toThrow(/differs from MATRA_OPRF_SHARE_PUBKEYS/);
  });

  it('a key rotation does not leave survivors blocked by quotas spent under the old key at standalone holders', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matra-holder-rot-'));
    const limits = { perDay: 3, lifetime: 3 };
    const start = async (shares: ShareKey[]) => {
      const up: Array<{ url: string; server: Server }> = [];
      for (const s of shares) up.push(await listen(holderApp(s, limits, { dbPath: path.join(dir, `holder-${s.index}.db`) })));
      return { up, remote: { urls: up.map((u) => u.url), publicKeys: shares.map((s) => toBase64(s.publicKey)), tokenKey: seed } };
    };
    try {
      const dbPath = path.join(dir, 'app.db');
      const old = await start(splitOprfKey(generateOprfKey().secretKey, 2, 3));
      const { app } = makeApp({ dbPath, matching: { oprf: { t: 2, remote: old.remote }, limits: { perDay: 10, lifetime: 10 } } });
      await registerUser(app, 'loc.one', 'counselor');
      const a = await registerUser(app, 'survivor.a');
      for (const v of ['a1@example.com', 'a2@example.com', 'a3@example.com']) await sealMatch(app, a, 'email', v);
      // every holder's lifetime quota for her is now spent under the old key
      await expect(sealMatch(app, a, 'email', 'a4@example.com')).rejects.toMatchObject({ status: 429 });
      await Promise.all(old.up.map((u) => new Promise((r) => u.server.close(r))));
      getDb(app).close();

      // rotate: new shares, same holder DB files (each holder keeps its own quota DB across the rotation)
      const fresh = await start(splitOprfKey(generateOprfKey().secretKey, 2, 3));
      const rotated = makeApp({ dbPath, matching: { oprf: { t: 2, remote: fresh.remote }, allowKeyRotation: true, limits: { perDay: 10, lifetime: 10 } } });
      const reSealed = await sealMatch(rotated.app, a, 'email', 'a1@example.com'); // her session lives in the shared app DB
      expect(reSealed.entry.keyEpoch).toBe(2);
      getDb(rotated.app).close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
