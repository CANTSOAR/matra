/**
 * Standalone OPRF key holders (src/holder.ts) and the app server's remote HolderPool (src/holders.ts): token checks,
 * per-holder quotas in the holder's own DB, and sealing with t of m holders up.
 */
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { blindMatchIdentifier, generateOprfKey, reconstructMatchGroup, splitOprfKey, toBase64, type ShareKey } from '@matra/crypto';
import type { CounselorMatchGroup } from '@matra/shared';
import { createHolderApp } from './holder.js';
import { HOLDER_TOKEN_HEADER, RemoteHolderPool, holderSubject, holderTokenPrivateKey, holderTokenPublicKeyFromSeed, signHolderToken } from './holders.js';
import { getDb } from './app.js';
import { makeApp, registerUser, sealMatch, TEST_PEPPER } from './test-helpers.js';

const seed = crypto.getRandomValues(new Uint8Array(32));
const tokenKey = holderTokenPrivateKey(seed);
const sub = holderSubject(Buffer.from(TEST_PEPPER), 'user-1');
const blinded = () => ({ blinded: toBase64(blindMatchIdentifier('email:x@example.com').blinded) });

function holderApp(share: ShareKey, limits?: { perDay: number; lifetime: number }) {
  return createHolderApp({ index: share.index, share, tokenPublicKey: holderTokenPublicKeyFromSeed(seed), dbPath: ':memory:', ...(limits && { limits }) });
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
    const call = (token?: string) => {
      const r = request(app).post('/evaluate');
      return (token ? r.set(HOLDER_TOKEN_HEADER, token) : r).send(blinded());
    };
    const ok = await call(signHolderToken(tokenKey, { sub, aud: 2 }));
    expect(ok.status).toBe(200);
    expect(Object.keys(ok.body).sort()).toEqual(['evaluated', 'proof']);

    expect((await call()).status).toBe(401);
    expect((await call(signHolderToken(tokenKey, { sub, aud: 1 }))).status).toBe(401); // wrong audience
    expect((await call(signHolderToken(tokenKey, { sub, aud: 2, exp: Math.floor(Date.now() / 1000) - 1 }))).status).toBe(401); // expired
    expect((await call(signHolderToken(tokenKey, { sub, aud: 2, exp: Math.floor(Date.now() / 1000) + 3600 }))).status).toBe(401); // too long-lived
    const otherKey = holderTokenPrivateKey(crypto.getRandomValues(new Uint8Array(32)));
    expect((await call(signHolderToken(otherKey, { sub, aud: 2 }))).status).toBe(401); // not the app server's key
    const t = signHolderToken(tokenKey, { sub, aud: 2 });
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
    const call = (s = sub) => request(app).post('/evaluate').set(HOLDER_TOKEN_HEADER, signHolderToken(tokenKey, { sub: s, aud: 1 })).send(blinded());
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    const r = await call();
    expect(r.status).toBe(429);
    expect(r.body.code).toBe('rate_limited_daily');
    expect((await call(holderSubject(Buffer.from(TEST_PEPPER), 'user-2'))).status).toBe(200);
    const db = app.locals.db as ReturnType<typeof getDb>;
    const rows = db.prepare('SELECT user_id, holder, day_count FROM oprf_quota ORDER BY day_count DESC').all();
    expect(rows).toEqual([
      { user_id: sub, holder: '1', day_count: 2 },
      { user_id: holderSubject(Buffer.from(TEST_PEPPER), 'user-2'), holder: '1', day_count: 1 },
    ]);
    // invalid element → 400, not counted
    const bad = await request(app).post('/evaluate').set(HOLDER_TOKEN_HEADER, signHolderToken(tokenKey, { sub: holderSubject(Buffer.from(TEST_PEPPER), 'user-3'), aud: 1 })).send({ blinded: toBase64(new Uint8Array(32).fill(255)) });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('invalid_element');
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
    // the remote holders' quotas are not in the app DB
    expect(getDb(app).prepare('SELECT COUNT(*) n FROM oprf_quota').get()).toEqual({ n: 0 });
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
});
