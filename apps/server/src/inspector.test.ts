/**
 * The dev/demo "what the server sees" inspector (src/inspector.ts, @matra/shared inspector.ts): never on in production
 * without the demo flag, off unless asked, never an IP, the secrets the server never stores redacted with the reason,
 * and the full-value search over the app database. The key holders' and the matcher's debug views too.
 */
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { generateOprfKey, splitOprfKey, toBase64 } from '@matra/crypto';
import { inspectValue, inspectorEnabled, type InspectorSnapshot } from '@matra/shared';
import { createHolderApp } from './holder.js';
import { holderTokenPublicKeyFromSeed } from './holders.js';
import { createRecord, makeApp, registerUser, sealMatch, verifyPhone } from './test-helpers.js';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

describe('inspector: when it is on', () => {
  it('needs MATRA_INSPECTOR=1, and production never turns it on without MATRA_DEMO_MODE=1', () => {
    expect(inspectorEnabled({})).toBe(false);
    expect(inspectorEnabled({ MATRA_INSPECTOR: '1' })).toBe(true);
    expect(inspectorEnabled({ NODE_ENV: 'production', MATRA_INSPECTOR: '1' })).toBe(false);
    expect(inspectorEnabled({ NODE_ENV: 'production', MATRA_DEMO_MODE: '1' })).toBe(false);
    expect(inspectorEnabled({ NODE_ENV: 'production', MATRA_DEMO_MODE: '1', MATRA_INSPECTOR: '1' })).toBe(true);
  });

  it('is not mounted unless asked (404, like any unknown API route)', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/dev/inspector');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });
});

describe('inspector: what it shows', () => {
  it('redacts what the server never stores, never shows an IP, and holds only ciphertext of her story', async () => {
    const { app } = makeApp({ inspector: true });
    const u = await registerUser(app, 'insp.survivor');
    await registerUser(app, 'insp.counselor', 'counselor');
    expect((await verifyPhone(app, u, '(201) 555-0177')).status).toBe(200);
    await createRecord(app, u, { story: 'a sentence only her device can read' });
    await sealMatch(app, u, 'email', 'person@example.com');

    const res = await request(app).get('/api/dev/inspector');
    expect(res.status).toBe(200);
    const snap = res.body as InspectorSnapshot;
    const raw = JSON.stringify(snap);
    // no client address anywhere (supertest connects from loopback)
    expect(raw).not.toMatch(/127\.0\.0\.1|::1|::ffff:/);
    // nothing she wrote or named, nor the phone number
    for (const text of ['only her device', 'person@example.com', '555-0177', '2015550177']) expect(raw).not.toContain(text);

    const app_ = snap.processes.find((p) => p.role === 'app')!;
    const body = (route: string) => app_.requests!.find((r) => r.route === route)!.body as Record<string, string>;
    expect(body('/api/auth/register').authKey).toMatch(/^\[redacted: never stored: the server keeps only a salted hash/);
    expect(body('/api/matching/verification/start').phone).toMatch(/^\[redacted: never stored/);
    expect(body('/api/matching/verification/check').code).toMatch(/^\[redacted: never stored/);
    // its own polling is not recorded
    expect(app_.requests!.some((r) => r.route.includes('inspector'))).toBe(false);
    // tables: values cut to 48 characters, with their length
    const records = app_.tables.find((t) => t.name === 'records')!;
    expect(records.total).toBe(1);
    expect(String(records.rows[0]!.envelope)).toMatch(/^\{"v":1,"alg":"A256GCM".*… \(\d+ chars\)$/);
    // rate-limit keys are keyed hashes: never the address
    const limits = app_.tables.find((t) => t.name === 'rate limits (memory)')!;
    expect(limits.total).toBeGreaterThan(0);
    // in-process holders and matcher say so
    expect(app_.note).toMatch(/INSIDE this process/);
    expect(snap.processes.find((p) => p.role === 'matcher')!.name).toBe('Matcher (in-process)');
  });

  it('?find= searches the FULL values of every column: finds an alias, not what was encrypted', async () => {
    const { app } = makeApp({ inspector: true });
    const u = await registerUser(app, 'findable.alias');
    await createRecord(app, u, { story: 'unfindable words in her story' });
    const find = async (q: string) => (await request(app).get(`/api/dev/inspector?find=${encodeURIComponent(q)}`)).body.found as InspectorSnapshot['found'];
    expect(await find('FINDABLE.alias')).toContainEqual({ table: 'users', column: 'username', rows: 1 });
    expect(await find('unfindable words')).toEqual([]);
  });

  it('a key holder shows its debug view only when asked, with the blinded elements it evaluated', async () => {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const shares = splitOprfKey(generateOprfKey().secretKey, 2, 3);
    const holder = (debug: boolean, i: number) =>
      createHolderApp({ index: shares[i]!.index, share: shares[i]!, tokenPublicKey: holderTokenPublicKeyFromSeed(seed), dbPath: ':memory:', debug });
    expect((await request(holder(false, 0)).get('/debug/state')).status).toBe(404);

    const urls: string[] = [];
    for (const i of [0, 1, 2]) {
      const server = holder(true, i).listen(0, '127.0.0.1');
      await new Promise<void>((r) => server.once('listening', () => r()));
      servers.push(server);
      urls.push(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    }
    const { app } = makeApp({ inspector: true, matching: { oprf: { t: 2, remote: { urls, publicKeys: shares.map((s) => toBase64(s.publicKey)), tokenKey: seed } } } });
    await registerUser(app, 'loc.insp', 'counselor');
    const u = await registerUser(app, 'survivor.insp');
    await sealMatch(app, u, 'email', 'someone@example.com');
    const snap = (await request(app).get('/api/dev/inspector')).body as InspectorSnapshot;
    const holders = snap.processes.filter((p) => p.role === 'holder');
    expect(holders.map((h) => h.name)).toEqual(['Key holder 1', 'Key holder 2', 'Key holder 3']);
    const evaluated = holders.map((h) => h.tables.find((t) => t.name.startsWith('evaluations'))!.total);
    expect(evaluated.filter((n) => n === 1).length).toBeGreaterThanOrEqual(2); // t of m answered for her
    expect(JSON.stringify(holders)).not.toContain('someone@example.com');

    // a stopped holder shows as unreachable; the page still works
    await new Promise((r) => servers[2]!.close(r));
    servers.pop();
    const after = (await request(app).get('/api/dev/inspector')).body as InspectorSnapshot;
    expect(after.processes.find((p) => p.name === 'Key holder 3')!.error).toMatch(/not reachable/);
  });
});

describe('inspectValue', () => {
  it('cuts strings to 48 characters, shows bytes as hex, redacts by field name at any depth', () => {
    expect(inspectValue('x'.repeat(60))).toBe(`${'x'.repeat(48)}… (60 chars)`);
    expect(inspectValue(new Uint8Array(20).fill(255))).toBe(`bytes ${'ff'.repeat(16)}… (20 bytes)`);
    const v = inspectValue({ authKey: 'secret', nested: { phone: '+12015550100', ok: 1 }, list: [{ code: '123456' }] }) as Record<string, unknown>;
    expect(JSON.stringify(v)).not.toMatch(/secret|2015550100|123456/);
    expect(v.authKey).toMatch(/^\[redacted: /);
    expect((v.nested as Record<string, unknown>).ok).toBe(1);
  });
});
