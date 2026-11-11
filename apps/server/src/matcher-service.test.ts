import { describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  AttestationError,
  matcherKeysFromSeed,
  newAttestationNonce,
  openRouting,
  platformPublicKey,
  verifyAttestation,
} from '@matra/crypto';
import type { CounselorMatchGroup, RoutingEnvelope } from '@matra/shared';
import { getDb } from './app.js';
import { loadMatcherConfig } from './config.js';
import { InProcessMatcher, type MatcherClient } from './matcher-client.js';
import { makeApp, registerUser, sealMatch, syncMatcher, type TestUser } from './test-helpers.js';
import type express from 'express';

const groupsOf = async (app: express.Express, c: TestUser) => {
  const r = await request(app).get('/api/counselor/groups').set(c.auth);
  expect(r.status).toBe(200);
  return r.body.groups as CounselorMatchGroup[];
};
const licensed = (app: express.Express, c: TestUser, states: string[]) =>
  getDb(app).prepare('UPDATE counselor_profiles SET jurisdictions = ? WHERE user_id = ?').run(JSON.stringify(states), c.user.id);

function inProcess() {
  const key = new Uint8Array(randomBytes(32));
  const platform = new Uint8Array(randomBytes(32));
  const client = new InProcessMatcher({ key, platformSecretKey: platform, releaseDelayMs: 0 });
  return { key, platform, client };
}

/** A matcher client that can be switched off (connection refused) and back on; `attestDown` for its attestation alone. */
function flaky(inner: MatcherClient) {
  const state = { down: false, attestDown: false };
  const guard = <A extends unknown[], R>(fn: (...a: A) => Promise<R>) => async (...a: A) => {
    if (state.down) throw new Error('connect ECONNREFUSED');
    return fn(...a);
  };
  const client: MatcherClient = {
    kind: 'http',
    attestation: async (n: string) => {
      if (state.attestDown) throw new Error('connect ECONNREFUSED');
      return inner.attestation(n);
    },
    upsertEntry: guard((e) => inner.upsertEntry(e)),
    removeEntry: guard((id: string) => inner.removeEntry(id)),
    putRoster: guard((r) => inner.putRoster(r)),
    assignments: guard(() => inner.assignments()),
    decline: guard((t: string, c: string) => inner.decline(t, c)),
  };
  return { client, state };
}

describe('matcher service: one counselor per group, routed by state', () => {
  it('incident NY → only the NY-licensed counselor sees the group, with the reason; the NJ counselor sees nothing', async () => {
    const { app } = makeApp();
    const nj = await registerUser(app, 'loc.nj', 'counselor');
    const ny = await registerUser(app, 'loc.ny', 'counselor');
    licensed(app, ny, ['NY']);
    const a = await registerUser(app, 'survivor.a');
    const b = await registerUser(app, 'survivor.b');
    await sealMatch(app, a, 'email', 'person@example.com', undefined, 'A', undefined, { survivor: 'NJ' });
    await sealMatch(app, b, 'email', 'Person@Example.com', undefined, 'B', undefined, { incident: 'NY', survivor: 'NJ' });
    expect(await groupsOf(app, nj)).toEqual([]);
    const g = await groupsOf(app, ny);
    expect(g).toHaveLength(1);
    expect(g[0]!.assignment).toMatchObject({ reason: 'incident_state:NY' });
    expect(g[0]!.signals).toEqual({ accountsCreatedClose: true, newAccountEntries: 2 });
  });

  it('falls back to the survivor state; nobody licensed → not released to anyone', async () => {
    const { app } = makeApp();
    const nj = await registerUser(app, 'loc.nj', 'counselor');
    const a = await registerUser(app, 'survivor.a');
    const b = await registerUser(app, 'survivor.b');
    const c = await registerUser(app, 'survivor.c');
    const d = await registerUser(app, 'survivor.d');
    await sealMatch(app, a, 'email', 'one@example.com', undefined, 'A', undefined, { incident: 'CA', survivor: 'NJ' });
    await sealMatch(app, b, 'email', 'one@example.com', undefined, 'B', undefined, { incident: 'CA' });
    await sealMatch(app, c, 'email', 'two@example.com', undefined, 'C', undefined, { incident: 'TX' });
    await sealMatch(app, d, 'email', 'two@example.com', undefined, 'D', undefined, {});
    const g = await groupsOf(app, nj);
    expect(g).toHaveLength(1);
    expect(g[0]!.assignment?.reason).toBe('survivor_state:NJ');
  });
});

describe('matcher service: availability and attestation', () => {
  it('matcher down → entries are still created; the group is released after the matcher comes back', async () => {
    const m = flaky(inProcess().client);
    const { app, db } = makeApp({ matching: { matcher: { client: m.client, pins: { allowSimulated: true } } } });
    const loc = await registerUser(app, 'loc.nj', 'counselor');
    const a = await registerUser(app, 'survivor.a');
    const b = await registerUser(app, 'survivor.b');
    await sealMatch(app, a, 'phone', '(201) 555-0100');
    // the client cannot seal while it cannot verify the matcher: nothing is created
    m.state.attestDown = true;
    await expect(sealMatch(app, b, 'phone', '201.555.0100')).rejects.toMatchObject({ status: 503 });
    expect(db.prepare('SELECT COUNT(*) n FROM match_entries').get()).toEqual({ n: 1 });
    m.state.attestDown = false;
    // the matcher's API is down (its attestation still answers): the entry is created and waits
    m.state.down = true;
    const eb = await sealMatch(app, b, 'phone', '201.555.0100');
    expect(await groupsOf(app, loc)).toEqual([]); // fail closed: no assignment cached for a new group
    expect((db.prepare('SELECT matcher_synced FROM match_entries WHERE id = ?').get(eb.entry.id) as { matcher_synced: number }).matcher_synced).toBe(0);
    m.state.down = false;
    (app.locals as { matcherGateReset?: () => void }).matcherGateReset?.();
    const g = await groupsOf(app, loc);
    expect(g).toHaveLength(1);
    // already-released groups stay visible from the cache while the matcher is unreachable
    m.state.down = true;
    expect(await groupsOf(app, loc)).toHaveLength(1);
  });

  it('withdrawal while the matcher is down is delivered later: the group is withdrawn from the counselor', async () => {
    const m = flaky(inProcess().client);
    const { app } = makeApp({ matching: { matcher: { client: m.client, pins: { allowSimulated: true } } } });
    const loc = await registerUser(app, 'loc.nj', 'counselor');
    const a = await registerUser(app, 'survivor.a');
    const b = await registerUser(app, 'survivor.b');
    const ea = await sealMatch(app, a, 'email', 'x@example.com');
    await sealMatch(app, b, 'email', 'x@example.com');
    expect(await groupsOf(app, loc)).toHaveLength(1);
    m.state.down = true;
    expect((await request(app).delete(`/api/matching/entries/${ea.entry.id}`).set(a.auth)).body).toEqual({ ok: true });
    m.state.down = false;
    (app.locals as { matcherGateReset?: () => void }).matcherGateReset?.();
    await syncMatcher(app);
    expect(await m.client.assignments()).toEqual([]);
    expect(await groupsOf(app, loc)).toEqual([]);
  });

  it('the app server forwards nothing when the matcher measurement is not the pinned one', async () => {
    const mp = inProcess();
    const { app, db } = makeApp({
      matching: { matcher: { client: mp.client, pins: { platformKey: platformPublicKey(mp.platform), measurement: 'ff'.repeat(32), allowSimulated: true } } },
    });
    const loc = await registerUser(app, 'loc.nj', 'counselor');
    const a = await registerUser(app, 'survivor.a');
    const b = await registerUser(app, 'survivor.b');
    await sealMatch(app, a, 'email', 'x@example.com'); // (an unpinned client still seals)
    await sealMatch(app, b, 'email', 'x@example.com');
    await syncMatcher(app);
    expect(await groupsOf(app, loc)).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) n FROM match_entries WHERE matcher_synced = 1').get()).toEqual({ n: 0 });
    expect(mp.client.matcher.assignments()).toEqual([]);
    // with the right measurement pinned, everything goes through
    const ok = inProcess();
    const { app: app2 } = makeApp({
      matching: { matcher: { client: ok.client, pins: { platformKey: platformPublicKey(ok.platform), measurement: ok.client.attester.measurement, allowSimulated: true } } },
    });
    const loc2 = await registerUser(app2, 'loc.nj', 'counselor');
    for (const n of ['a', 'b']) await sealMatch(app2, await registerUser(app2, `survivor.${n}`), 'email', 'x@example.com');
    expect(await groupsOf(app2, loc2)).toHaveLength(1);
  });

  it('a pinned client refuses a matcher that is not the published build, before any key holder is asked', async () => {
    const mp = inProcess();
    const { app, db } = makeApp({ matching: { matcher: { client: mp.client, pins: { allowSimulated: true } } } });
    await registerUser(app, 'loc.nj', 'counselor');
    const a = await registerUser(app, 'survivor.a');
    const pins = { attestation: { platformKey: platformPublicKey(mp.platform), measurement: 'ee'.repeat(32) }, allowSimulatedAttestation: true };
    const err = await sealMatch(app, a, 'email', 'x@example.com', undefined, 'A', pins).catch((e) => e);
    expect(err).toBeInstanceOf(AttestationError);
    expect(err.code).toBe('measurement_mismatch');
    // a production build (pinned, not demo) refuses a simulated platform even with the right measurement
    const prod = { attestation: { platformKey: platformPublicKey(mp.platform), measurement: mp.client.attester.measurement } };
    expect((await sealMatch(app, a, 'email', 'x@example.com', undefined, 'A', prod).catch((e) => e)).code).toBe('simulated_not_allowed');
    // a different platform key → bad signature
    const other = { attestation: { platformKey: platformPublicKey(new Uint8Array(32).fill(1)), measurement: mp.client.attester.measurement }, allowSimulatedAttestation: true };
    expect((await sealMatch(app, a, 'email', 'x@example.com', undefined, 'A', other).catch((e) => e)).code).toBe('bad_signature');
    expect(db.prepare('SELECT COUNT(*) n FROM match_entries').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) n FROM oprf_quota').get()).toEqual({ n: 0 }); // nothing was charged
    // the demo build accepts it
    const demo = { attestation: { platformKey: platformPublicKey(mp.platform), measurement: mp.client.attester.measurement }, allowSimulatedAttestation: true };
    expect((await sealMatch(app, a, 'email', 'x@example.com', undefined, 'A', demo)).entry.status).toBe('sealed');
  });

  it('GET /api/matching/attestation proxies the matcher (public), needs a 64-hex nonce, and verifies', async () => {
    const mp = inProcess();
    const { app } = makeApp({ matching: { matcher: { client: mp.client, pins: { allowSimulated: true } } } });
    const nonce = newAttestationNonce();
    const r = await request(app).get(`/api/matching/attestation?nonce=${nonce}`);
    expect(r.status).toBe(200);
    const v = verifyAttestation(r.body, { nonce, platformKey: platformPublicKey(mp.platform), expectedMeasurement: mp.client.attester.measurement, allowSimulated: true });
    expect(v.encKey).toEqual(matcherKeysFromSeed(mp.key).encPublicJwk);
    expect((await request(app).get('/api/matching/attestation?nonce=abc')).status).toBe(400);
  });
});

describe('matcher service: what the app server keeps (privacy)', () => {
  it("no per-entry state in the app DB (only a released group's assignment reason names one); routing opens only with the matcher key and only under its own tag", async () => {
    const mp = inProcess();
    const { app, db } = makeApp({ matching: { matcher: { client: mp.client, pins: { allowSimulated: true } } } });
    await registerUser(app, 'loc.nj', 'counselor');
    const a = await registerUser(app, 'survivor.a');
    const b = await registerUser(app, 'survivor.b');
    await sealMatch(app, a, 'email', 'one@example.com', undefined, 'A', undefined, { incident: 'WY', survivor: 'VT' });
    await sealMatch(app, b, 'email', 'two@example.com', undefined, 'B', undefined, { incident: 'WY', survivor: 'VT' });
    const cols = (db.prepare("SELECT name FROM pragma_table_info('match_entries')").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols.filter((c) => /state/i.test(c))).toEqual([]);
    const dump = JSON.stringify(
      ['match_entries', 'match_assignments', 'matching_meta', 'audit_events', 'ledger'].map((t) => db.prepare(`SELECT * FROM ${t}`).all()),
    );
    expect(dump).not.toMatch(/"(WY|VT)"/);
    const rows = db.prepare('SELECT tag, routing_envelope FROM match_entries ORDER BY rowid').all() as Array<{ tag: string; routing_envelope: string }>;
    const env = JSON.parse(rows[0]!.routing_envelope) as RoutingEnvelope;
    const keys = matcherKeysFromSeed(mp.key);
    expect(await openRouting(env, keys.encPrivateJwk, rows[0]!.tag)).toMatchObject({ incidentState: 'WY', survivorState: 'VT' });
    await expect(openRouting(env, matcherKeysFromSeed(new Uint8Array(32).fill(5)).encPrivateJwk, rows[0]!.tag)).rejects.toThrow();
    await expect(openRouting(env, keys.encPrivateJwk, rows[1]!.tag)).rejects.toThrow();
  });

  it('the matcher gets a pseudonymous survivor reference and the account hour, never the user id', async () => {
    const mp = inProcess();
    const seen: unknown[] = [];
    const spy: MatcherClient = { ...mp.client, kind: 'in-process', attestation: (n) => mp.client.attestation(n), upsertEntry: async (e) => void seen.push(e), removeEntry: async () => {}, putRoster: async (r) => void seen.push(r), assignments: async () => [], decline: async () => {} };
    const { app } = makeApp({ matching: { matcher: { client: spy, pins: { allowSimulated: true } } } });
    await registerUser(app, 'loc.nj', 'counselor');
    const a = await registerUser(app, 'survivor.a');
    await sealMatch(app, a, 'email', 'one@example.com');
    await syncMatcher(app);
    const text = JSON.stringify(seen);
    expect(text).not.toContain(a.user.id);
    expect(text).not.toContain(a.user.username);
    const entry = seen.find((x) => (x as { entryId?: string }).entryId) as { survivorRef: string; accountCreatedAt: string };
    expect(entry.survivorRef).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.accountCreatedAt).toMatch(/T\d\d:00:00\.000Z$/);
  });
});

describe('matcher configuration', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'matra-matcher-'));
  it('production refuses the in-process (simulated) matcher unless MATRA_DEMO_MODE=1', () => {
    const dir = tmp();
    const base = { NODE_ENV: 'production', MATRA_DB_PATH: path.join(dir, 'db', 'matra.db'), MATRA_MATCHER_KEY: 'a'.repeat(64), MATRA_ATTESTATION_PLATFORM_KEY: 'b'.repeat(64) };
    expect(() => loadMatcherConfig(base, { releaseDelayHours: 0 })).toThrow(/matcher attestation \(simulated\).*cannot run in production/);
    expect(loadMatcherConfig({ ...base, MATRA_DEMO_MODE: '1' }, { releaseDelayHours: 0 }).client.kind).toBe('in-process');
    // its keys are never generated in production
    expect(() => loadMatcherConfig({ NODE_ENV: 'production', MATRA_DEMO_MODE: '1', MATRA_DB_PATH: base.MATRA_DB_PATH }, { releaseDelayHours: 0 })).toThrow(/MATRA_MATCHER_KEY/);
  });

  it('a separate matcher in production needs pins, a token, and https off-host; simulated is accepted only in demo mode', () => {
    const remote = { NODE_ENV: 'production', MATRA_MATCHER_URL: 'http://127.0.0.1:4320', MATRA_MATCHER_TOKEN: 't'.repeat(40) };
    expect(() => loadMatcherConfig(remote, { releaseDelayHours: 0 })).toThrow(/MATRA_MATCHER_MEASUREMENT must be set/);
    const pinned = { ...remote, MATRA_ATTESTATION_PLATFORM_PUBKEY: platformPublicKey(new Uint8Array(32)), MATRA_MATCHER_MEASUREMENT: 'ab'.repeat(32) };
    const c = loadMatcherConfig(pinned, { releaseDelayHours: 0 });
    expect(c.client.kind).toBe('http');
    expect(c.pins.allowSimulated).toBe(false);
    expect(loadMatcherConfig({ ...pinned, MATRA_DEMO_MODE: '1' }, { releaseDelayHours: 0 }).pins.allowSimulated).toBe(true);
    expect(() => loadMatcherConfig({ ...pinned, MATRA_MATCHER_URL: 'http://matcher.example.org' }, { releaseDelayHours: 0 })).toThrow(/plain http/);
    expect(() => loadMatcherConfig({ ...pinned, MATRA_MATCHER_TOKEN: 'short' }, { releaseDelayHours: 0 })).toThrow(/at least 32/);
    expect(() => loadMatcherConfig({ ...pinned, MATRA_MATCHER_MEASUREMENT: 'xyz' }, { releaseDelayHours: 0 })).toThrow(/64 hex/);
  });
});
