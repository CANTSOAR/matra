/**
 * Sealed matching off (MATRA_MATCHING=off, the pilot default; src/matching-off.ts): no matching route answers, no key
 * is dealt, nothing is written for matching, counselors can't register, the server refuses to start with matching
 * secrets or (in production) with leftover matching rows, and everything a survivor does without matching still works.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import Database from 'better-sqlite3';
import request from 'supertest';
import type express from 'express';
import { publicKeyFingerprint, wrapKeyForRecipient } from '@matra/crypto';
import { assertMatchingService, parseMatchingMode } from '@matra/shared';
import { createApp, getDb } from './app.js';
import {
  MATCHING_ONLY_VARS,
  MATCHING_ROUTE_PREFIXES,
  WEB_BUILD_INFO,
  checkLeftoverMatchingRows,
  preflightLeftoverMatchingRows,
  loadMatchingMode,
  matchingOnlyVarsSet,
} from './matching-off.js';
import { TEST_ALIAS, TEST_PEPPER, shareConsent, createRecord, defaultProfile, makeApp, makeMatchingApp, registerUser, sealMatch, uploadBlob } from './test-helpers.js';
import { checkAttorneyKey, generateRosterKey, toBase64 } from '@matra/crypto';
import type { AttorneysResponse } from '@matra/shared';
import { signOrgLists, storeOrgLists } from './org-signing.js';

const DISABLED = { error: 'Sealed matching isn’t part of this service.', code: 'matching_disabled' };

/** Every route the app registered under a matching prefix, read from Express's own router (so new routes are covered). */
function matchingRoutes(app: express.Express): Array<{ method: string; path: string }> {
  const stack = (app as unknown as { router: { stack: Array<{ route?: { path: string | string[]; methods: Record<string, boolean> } }> } }).router.stack;
  const out: Array<{ method: string; path: string }> = [];
  for (const layer of stack) {
    if (!layer.route) continue;
    for (const p of ([] as string[]).concat(layer.route.path))
      if (MATCHING_ROUTE_PREFIXES.some((pre) => p === pre || p.startsWith(`${pre}/`)))
        for (const m of Object.keys(layer.route.methods)) out.push({ method: m, path: p.replace(/:(\w+)/g, 'x$1') });
  }
  return out;
}

const tables = (db: ReturnType<typeof getDb>, ...names: string[]) =>
  Object.fromEntries(names.map((t) => [t, (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n]));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('matching off: the server', () => {
  it('createApp without matching, or with matching: false, is off', async () => {
    for (const matching of [undefined, false] as const) {
      const app = createApp({ dbPath: ':memory:', pepper: TEST_PEPPER, ...(matching === false && { matching }) });
      const res = await request(app).get('/api/matching/config');
      expect(res.status).toBe(404);
      expect(res.body).toEqual(DISABLED);
    }
  });

  it('every matching, escrow, counselor and report route answers 404 matching_disabled, signed in or not', async () => {
    const { app } = makeApp();
    const jane = await registerUser(app, 'jane.off');
    const routes = matchingRoutes(app);
    // the routes are still registered (so this list is real); the guard in front of them answers first
    expect(routes.length).toBeGreaterThanOrEqual(25);
    for (const prefix of MATCHING_ROUTE_PREFIXES) expect(routes.some((r) => r.path.startsWith(prefix))).toBe(true);
    for (const { method, path: p } of routes) {
      for (const who of [undefined, jane.auth]) {
        const req = (request(app) as unknown as Record<string, (u: string) => request.Test>)[method](p);
        const res = await (who ? req.set(who) : req).send(method === 'get' || method === 'delete' ? undefined : {});
        expect([method, p, res.status, res.body]).toEqual([method, p, 404, DISABLED]);
      }
    }
    // and anything else under a prefix (no such route even when on) gets the same answer, not "not_found"
    expect((await request(app).get('/api/counselor/anything/at/all')).body).toEqual(DISABLED);
  });

  it('turned on, the same routes answer normally (the guard is only there when off)', async () => {
    const { app } = makeMatchingApp();
    const jane = await registerUser(app, 'jane.on');
    const res = await request(app).get('/api/matching/verification').set(jane.auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ required: true, verified: true });
  });

  it('deals no key and writes nothing for matching: no matching_meta row, no quota, no sync', async () => {
    const { app, db } = makeApp();
    expect(tables(db, 'matching_meta', 'oprf_quota', 'match_entries', 'match_seals', 'match_groups')).toEqual({
      matching_meta: 0,
      oprf_quota: 0,
      match_entries: 0,
      match_seals: 0,
      match_groups: 0,
    });
    // on, the key set is pinned in matching_meta at start (the contrast this test relies on)
    const on = makeMatchingApp();
    expect(tables(on.db, 'matching_meta').matching_meta).toBeGreaterThan(0);
    // the test hook the matcher sync uses is a no-op when off
    await expect((app.locals.syncMatcher as () => Promise<void>)()).resolves.toBeUndefined();
  });

  it('refuses to register a counselor; attorneys and survivors register as usual', async () => {
    const { app, db } = makeApp();
    await expect(registerUser(app, 'loc.off', 'counselor')).rejects.toThrow(/register failed 404 .*matching_disabled/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM users WHERE username = 'loc.off'").get()).toEqual({ n: 0 });
    expect(tables(db, 'counselor_profiles').counselor_profiles).toBe(0);
    await registerUser(app, 'atty.off', 'attorney');
    await registerUser(app, 'jane.off2');
  });

  it('her own vault, sharing with an attorney, activity and deleting her account all still work', async () => {
    const { app, db } = makeApp();
    const jane = await registerUser(app, 'jane.share');
    const atty = await registerUser(app, 'atty.share', 'attorney');
    const { res: rec, key } = await createRecord(app, jane, { narrative: 'her words' });
    expect(rec.status).toBe(201);
    const { res: blob, key: blobKey } = await uploadBlob(app, jane);
    expect(blob.status).toBe(201);
    const fp = await publicKeyFingerprint(atty.user.publicKey);
    const share = await request(app)
      .post('/api/shares')
      .set(jane.auth)
      .send({
        recordId: rec.body.record.id,
        attorneyId: atty.user.id,
        recipientWrappedKey: await wrapKeyForRecipient(key, atty.user.publicKey),
        blobs: [{ blobId: blob.body.blob.id, recipientWrappedKey: await wrapKeyForRecipient(blobKey, atty.user.publicKey) }],
        consentStatement: shareConsent(fp, 1),
        attorneyKeyFingerprint: fp,
        scope: ['record', 'evidence'],
        survivorAlias: TEST_ALIAS,
      });
    expect(share.status).toBe(201);
    expect((await request(app).get(`/api/shares/${share.body.share.id}/bundle`).set(atty.auth)).status).toBe(200);
    expect((await request(app).get('/api/audit').set(jane.auth)).status).toBe(200);
    const del = await request(app).post('/api/account/delete').set(jane.auth).send({ authKey: jane.authKey });
    expect(del.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(jane.user.id)).toEqual({ n: 0 });
  });

  it('the inspector says there is no matcher instead of reaching for one', async () => {
    const { app } = makeApp({ inspector: true });
    const res = await request(app).get('/api/dev/inspector');
    expect(res.status).toBe(200);
    const matcher = res.body.processes.find((p: { role: string }) => p.role === 'matcher');
    expect(matcher).toMatchObject({ note: expect.stringMatching(/off/), tables: [] });
    expect(matcher.error).toBeUndefined();
    expect(res.body.processes.filter((p: { role: string }) => p.role === 'holder')).toEqual([]);
  });
});

describe('matching off: leftover rows from when it was on', () => {
  const tmpDb = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matra-off-'));
    onTestFinished(() => fs.rmSync(dir, { recursive: true, force: true }));
    return path.join(dir, 'matra.db');
  };

  it('development warns and leaves them untouched; production refuses to start', async () => {
    const dbPath = tmpDb();
    const on = makeMatchingApp({ dbPath });
    const jane = await registerUser(on.app, 'jane.left');
    await registerUser(on.app, 'loc.left', 'counselor');
    await sealMatch(on.app, jane, 'email', 'person@example.com');
    on.db.close();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const off = createApp({ dbPath, pepper: TEST_PEPPER, matching: false });
    expect(warn.mock.calls.flat().join(' ')).toMatch(/still holds 1 sealed-match entry and 0 report releases/);
    expect(tables(getDb(off), 'match_entries').match_entries).toBe(1);
    expect(() => checkLeftoverMatchingRows(getDb(off), true)).toThrow(/Refusing to start in production/);
    getDb(off).close();
  });

  it('production refuses before any migration runs: the file is left at its old schema version', async () => {
    const dbPath = tmpDb();
    const on = makeMatchingApp({ dbPath });
    const jane = await registerUser(on.app, 'jane.pre');
    await registerUser(on.app, 'loc.pre', 'counselor');
    await sealMatch(on.app, jane, 'email', 'person@example.com');
    // as if the database was last opened by a server from before migrations v12 and v13
    on.db.pragma('user_version = 11');
    on.db.pragma('wal_checkpoint(TRUNCATE)');
    on.db.close();
    vi.stubEnv('NODE_ENV', 'production');
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    expect(() => createApp({ dbPath, pepper: TEST_PEPPER, matching: false })).toThrow(/no migration has run/);
    const check = new Database(dbPath, { readonly: true });
    expect(check.pragma('user_version', { simple: true })).toBe(11);
    check.close();
    // a missing file, an empty database and development are not refused here
    expect(() => preflightLeftoverMatchingRows(path.join(os.tmpdir(), 'matra-no-such.db'), true)).not.toThrow();
    expect(() => preflightLeftoverMatchingRows(dbPath, false)).not.toThrow();
  });

  it('an empty database is fine in production too', () => {
    const { db } = makeApp();
    expect(() => checkLeftoverMatchingRows(db, true)).not.toThrow();
  });
});

describe('MATRA_MATCHING at startup (loadMatchingMode)', () => {
  it('accepts off and on; development defaults to off; production must say which', () => {
    expect(loadMatchingMode({ MATRA_MATCHING: 'off' })).toBe('off');
    expect(loadMatchingMode({ MATRA_MATCHING: 'on' })).toBe('on');
    expect(loadMatchingMode({ MATRA_MATCHING: ' ON ' })).toBe('on');
    expect(loadMatchingMode({})).toBe('off');
    expect(() => loadMatchingMode({ NODE_ENV: 'production' })).toThrow(/MATRA_MATCHING must be set in production/);
    expect(() => loadMatchingMode({ NODE_ENV: 'production', MATRA_MATCHING: '' })).toThrow(/must be set in production/);
    expect(loadMatchingMode({ NODE_ENV: 'production', MATRA_MATCHING: 'off' })).toBe('off');
    expect(() => loadMatchingMode({ MATRA_MATCHING: 'yes' })).toThrow(/must be "off" or "on"/);
    expect(() => loadMatchingMode({ MATRA_MATCHING: '1' })).toThrow(/must be "off" or "on"/);
  });

  it('refuses to start off with any matching secret or setting, in production or not', () => {
    const vars = [
      'MATRA_OPRF_SHARE_1',
      'MATRA_OPRF_SHARE_2_FILE',
      'MATRA_OPRF_SHARE_PUBKEYS',
      'MATRA_OPRF_HOLDER_URLS',
      'MATRA_HOLDER_TOKEN_KEY',
      'MATRA_HOLDER_TOKEN_KEY_FILE',
      'MATRA_MATCHER_URL',
      'MATRA_MATCHER_KEY',
      'MATRA_MATCHER_TOKEN_FILE',
      'MATRA_ATTESTATION_PLATFORM_KEY',
      'MATRA_PHONE_HASH_KEY',
      'MATRA_PHONE_HASH_KEY_FILE',
      'MATRA_SMS_PROVIDER',
      'TWILIO_AUTH_TOKEN',
      'TWILIO_ACCOUNT_SID',
      'MATRA_OPRF_THRESHOLD',
      'MATRA_ATTESTATION_PLATFORM_PUBKEY',
      'MATRA_MATCHER_MEASUREMENT',
      'MATRA_OPRF_KEY_A',
      'MATRA_OPRF_KEY_B_FILE',
    ];
    for (const v of vars) {
      expect(MATCHING_ONLY_VARS.some((re) => re.test(v))).toBe(true);
      const refused = new RegExp(`MATRA_MATCHING is off.*${v}.*remove them, or set MATRA_MATCHING=on`);
      expect(() => loadMatchingMode({ MATRA_MATCHING: 'off', [v]: 'x'.repeat(64) })).toThrow(refused);
      expect(() => loadMatchingMode({ [v]: 'x'.repeat(64) })).toThrow(refused); // development's default "off" too
      expect(() => loadMatchingMode({ NODE_ENV: 'production', MATRA_MATCHING: 'off', [v]: 'x'.repeat(64) })).toThrow(refused);
      expect(loadMatchingMode({ NODE_ENV: 'production', MATRA_MATCHING: 'on', [v]: 'x' })).toBe('on');
    }
    // all of them are named at once; empty values (an unset Docker build arg) don't count
    expect(matchingOnlyVarsSet({ MATRA_PHONE_HASH_KEY: 'k', MATRA_MATCHER_URL: 'u', MATRA_OPRF_SHARE_1: '' })).toEqual(['MATRA_MATCHER_URL', 'MATRA_PHONE_HASH_KEY']);
    // and what the pilot still needs is not on the list
    for (const v of ['MATRA_PEPPER', 'MATRA_DB_PATH', 'MATRA_COUNSELOR_ROSTER_PUBKEY', 'MATRA_DEMO_MODE'])
      expect(matchingOnlyVarsSet({ [v]: 'x' })).toEqual([]);
  });

  it('the key holders and the matcher refuse to run where MATRA_MATCHING=off', () => {
    expect(parseMatchingMode(undefined)).toBeUndefined();
    expect(() => assertMatchingService({ MATRA_MATCHING: 'off' }, 'An OPRF key holder')).toThrow(/An OPRF key holder is part of sealed matching/);
    expect(() => assertMatchingService({ MATRA_MATCHING: 'on' }, 'The matcher')).not.toThrow();
    expect(() => assertMatchingService({}, 'The matcher')).not.toThrow();
  });
});

describe('the real server process (src/index.ts) in production', () => {
  const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'index.ts');
  const TSX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'node_modules', '.bin', 'tsx');

  /** Start the server with exactly `env` (plus PATH); resolve with its exit, or with a health check once it listens. */
  function start(env: Record<string, string>): Promise<{ code: number | null; output: string; port?: number; child: ChildProcess }> {
    const port = 46_000 + Math.floor(Math.random() * 2_000);
    const child = spawn(TSX, [SERVER], {
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', PORT: String(port), HOST: '127.0.0.1', MATRA_SERVE_WEB: '0', MATRA_LOG_REQUESTS: '0', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    onTestFinished(() => void child.kill('SIGKILL'));
    let output = '';
    return new Promise((resolve) => {
      const on = (b: Buffer) => {
        output += b.toString();
        if (/production server on/.test(output)) resolve({ code: null, output, port, child });
      };
      child.stdout.on('data', on);
      child.stderr.on('data', on);
      child.on('exit', (code) => resolve({ code, output, child }));
    });
  }
  const dir = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'matra-proc-'));
    onTestFinished(() => fs.rmSync(d, { recursive: true, force: true }));
    return d;
  };
  const prod = (d: string) => ({ NODE_ENV: 'production', MATRA_PEPPER: 'p'.repeat(64), MATRA_DB_PATH: path.join(d, 'matra.db') });

  it('starts with MATRA_MATCHING=off and no matching configuration at all; matching routes answer 404', async () => {
    const r = await start({ ...prod(dir()), MATRA_MATCHING: 'off' });
    expect(r.output).toMatch(/sealed matching: OFF/);
    expect(r.port).toBeDefined();
    expect(await (await fetch(`http://127.0.0.1:${r.port}/api/health`)).json()).toEqual({ ok: true });
    const m = await fetch(`http://127.0.0.1:${r.port}/api/matching/config`);
    expect(m.status).toBe(404);
    expect(await m.json()).toEqual(DISABLED);
  }, 60_000);

  it('refuses to start without MATRA_MATCHING, or off with a matching secret', async () => {
    const unset = await start(prod(dir()));
    expect(unset.code).not.toBe(0);
    expect(unset.output).toMatch(/MATRA_MATCHING must be set in production/);
    const secret = await start({ ...prod(dir()), MATRA_MATCHING: 'off', MATRA_OPRF_SHARE_1: 'a'.repeat(64) });
    expect(secret.code).not.toBe(0);
    expect(secret.output).toMatch(/MATRA_MATCHING is off, but MATRA_OPRF_SHARE_1 is set/);
  }, 60_000);
});

describe('matching off: the web build must be an off build too', () => {
  const webDir = (matching?: string) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'matra-webmode-'));
    onTestFinished(() => fs.rmSync(d, { recursive: true, force: true }));
    fs.writeFileSync(path.join(d, 'index.html'), '<!doctype html><html><head></head><body></body></html>');
    if (matching !== undefined) fs.writeFileSync(path.join(d, WEB_BUILD_INFO), matching);
    return d;
  };

  it('an off server refuses an on build; an on server refuses an off build; matching pairs are served', async () => {
    const on = webDir('{"matching":"on"}');
    const off = webDir('{"matching":"off"}');
    expect(() => createApp({ dbPath: ':memory:', pepper: TEST_PEPPER, webDir: on })).toThrow(
      /built with MATRA_MATCHING=on, but this server runs with MATRA_MATCHING=off/,
    );
    expect(() => createApp({ dbPath: ':memory:', pepper: TEST_PEPPER, webDir: off, matching: {} })).toThrow(
      /built with MATRA_MATCHING=off, but this server runs with MATRA_MATCHING=on/,
    );
    const ok = createApp({ dbPath: ':memory:', pepper: TEST_PEPPER, webDir: off });
    expect((await request(ok).get('/')).status).toBe(200);
    expect(() => createApp({ dbPath: ':memory:', pepper: TEST_PEPPER, webDir: on, matching: {} })).not.toThrow();
  });

  it('refuses a build that does not say which mode it is', () => {
    for (const d of [webDir(), webDir('not json'), webDir('{"matching":"maybe"}'), webDir('{}')])
      expect(() => createApp({ dbPath: ':memory:', pepper: TEST_PEPPER, webDir: d })).toThrow(/MATRA_MATCHING is unknown|must be "off" or "on"/);
  });
});

describe('matching off: the pilot still shares through the org-signed attorney directory', () => {
  it('a signed directory with no counselors is stored and a pinned client confirms the attorney', async () => {
    const { app, db } = makeApp();
    const jane = await registerUser(app, 'jane.pilotdir');
    const atty = await registerUser(app, 'atty.pilotdir', 'attorney', { profile: { ...defaultProfile, displayName: 'Pilot Counsel' } });
    const org = generateRosterKey();
    const lists = signOrgLists(db, org.secretKey);
    expect(lists.counselors).toEqual([]);
    storeOrgLists(db, lists);
    // what matching_meta holds when off: the two org-signed lists, nothing from matching
    expect((db.prepare('SELECT key FROM matching_meta ORDER BY key').all() as Array<{ key: string }>).map((r) => r.key)).toEqual([
      'attorney_directory',
      'counselor_roster',
    ]);
    const res = (await request(app).get('/api/attorneys').set(jane.auth)).body as AttorneysResponse;
    const listed = res.attorneys.find((a) => a.userId === atty.user.id)!;
    expect(checkAttorneyKey(res.directory, listed, toBase64(org.publicKey))).toMatchObject({ status: 'verified', displayName: 'Pilot Counsel' });
  });
});
