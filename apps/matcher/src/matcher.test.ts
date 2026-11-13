import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { generateRosterKey, matcherKeysFromSeed, newAttestationNonce, sealRouting, signCounselorRoster, toBase64, verifyAttestation } from '@matra/crypto';
import { createMatcher, createMatcherApp, SimulatedAttester, verifyAssignmentSignature, type MatcherEntryInput } from './index.js';
import { loadAttester, loadMatcherSettings } from './config.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const keys = matcherKeysFromSeed(new Uint8Array(32).fill(3));
const hex = (s: string) => createHash('sha256').update(s).digest('hex');
const TAG = hex('tag-1');
const TAG2 = hex('tag-2');
const ref = (n: string) => hex(`survivor-${n}`);
const T0 = Date.parse('2026-11-01T00:00:00.000Z');

function setup(o: { delayHours?: number; rosterKey?: Uint8Array } = {}) {
  let now = T0;
  const { matcher, store } = createMatcher({ dbPath: ':memory:', keys, releaseDelayMs: (o.delayHours ?? 0) * HOUR, rosterKey: o.rosterKey, now: () => now });
  return {
    matcher,
    store,
    tick: (ms: number) => void (now += ms),
    now: () => now,
  };
}

let seq = 0;
async function entry(o: { tag?: string; who: string; incident?: string; survivor?: string; at?: number; accountAt?: number; routingTag?: string }): Promise<MatcherEntryInput> {
  const tag = o.tag ?? TAG;
  return {
    entryId: `e${++seq}`,
    tag,
    survivorRef: ref(o.who),
    createdAt: new Date(o.at ?? T0).toISOString(),
    accountCreatedAt: new Date(o.accountAt ?? T0 - 30 * DAY).toISOString(),
    routing: await sealRouting({ v: 1, tag: o.routingTag ?? tag, incidentState: o.incident, survivorState: o.survivor }, keys.encPublicJwk),
  };
}

const roster = (list: Array<[string, string[]]>) => ({
  verifiedIds: list.map(([id]) => id),
  counselors: list.map(([userId, licensedStates]) => ({ userId, licensedStates })),
});

describe('matcher: groups and release', () => {
  it('a group needs 2 distinct survivors; 2 entries from one survivor are not a group', async () => {
    const { matcher } = setup();
    matcher.putRoster(roster([['c-nj', ['NJ']]]));
    await matcher.upsertEntry(await entry({ who: 'a', incident: 'NJ' }));
    await matcher.upsertEntry(await entry({ who: 'a', incident: 'NJ' }));
    expect(matcher.assignments()).toEqual([]);
    await matcher.upsertEntry(await entry({ who: 'b', incident: 'NJ' }));
    expect(matcher.assignments()).toMatchObject([{ tag: TAG, counselorId: 'c-nj', reason: 'incident_state:NJ' }]);
  });

  it('the release delay is respected (fake clock)', async () => {
    const t = setup({ delayHours: 72 });
    t.matcher.putRoster(roster([['c-nj', ['NJ']]]));
    await t.matcher.upsertEntry(await entry({ who: 'a', incident: 'NJ', at: t.now() }));
    await t.matcher.upsertEntry(await entry({ who: 'b', incident: 'NJ', at: t.now() + HOUR }));
    t.tick(72 * HOUR);
    expect(t.matcher.assignments()).toEqual([]); // b's entry is 71 h old
    t.tick(HOUR);
    expect(t.matcher.assignments()).toHaveLength(1);
  });

  it('a withdrawal that leaves one survivor dissolves the group and its assignment', async () => {
    const { matcher } = setup();
    matcher.putRoster(roster([['c-nj', ['NJ']]]));
    const a = await entry({ who: 'a', incident: 'NJ' });
    await matcher.upsertEntry(a);
    await matcher.upsertEntry(await entry({ who: 'b', incident: 'NJ' }));
    expect(matcher.assignments()).toHaveLength(1);
    matcher.removeEntry(a.entryId);
    expect(matcher.assignments()).toEqual([]);
  });

  it('records Sybil signals (accounts created within a day; entries < 7 days after account creation)', async () => {
    const { matcher } = setup();
    matcher.putRoster(roster([['c-nj', ['NJ']]]));
    await matcher.upsertEntry(await entry({ who: 'a', incident: 'NJ', accountAt: T0 - 2 * DAY }));
    await matcher.upsertEntry(await entry({ who: 'b', incident: 'NJ', accountAt: T0 - 2 * DAY + 3 * HOUR }));
    expect(matcher.assignments()[0]!.signals).toEqual({ accountsCreatedClose: true, newAccountEntries: 2 });
  });
});

describe('matcher: routing by incident state, then survivor state', () => {
  it('prefers a counselor licensed in the incident state over the survivor state', async () => {
    const { matcher } = setup();
    matcher.putRoster(roster([['c-nj', ['NJ']], ['c-ny', ['NY']]]));
    await matcher.upsertEntry(await entry({ who: 'a', incident: 'NY', survivor: 'NJ' }));
    await matcher.upsertEntry(await entry({ who: 'b', survivor: 'NJ' }));
    expect(matcher.assignments()).toMatchObject([{ counselorId: 'c-ny', reason: 'incident_state:NY' }]);
  });

  it('falls back to the survivor state when nobody is licensed in the incident state', async () => {
    const { matcher } = setup();
    matcher.putRoster(roster([['c-nj', ['NJ']]]));
    await matcher.upsertEntry(await entry({ who: 'a', incident: 'CA', survivor: 'NJ' }));
    await matcher.upsertEntry(await entry({ who: 'b', incident: 'CA' }));
    expect(matcher.assignments()).toMatchObject([{ counselorId: 'c-nj', reason: 'survivor_state:NJ' }]);
  });

  it('the most frequent incident state wins; ties are alphabetical', async () => {
    const { matcher } = setup();
    matcher.putRoster(roster([['c-nj', ['NJ']], ['c-ny', ['NY']], ['c-ca', ['CA']]]));
    await matcher.upsertEntry(await entry({ who: 'a', incident: 'NY' }));
    await matcher.upsertEntry(await entry({ who: 'b', incident: 'NJ' }));
    expect(matcher.assignments()[0]!.reason).toBe('incident_state:NJ');
    await matcher.upsertEntry(await entry({ tag: TAG2, who: 'a', incident: 'NY' }));
    await matcher.upsertEntry(await entry({ tag: TAG2, who: 'b', incident: 'NY' }));
    await matcher.upsertEntry(await entry({ tag: TAG2, who: 'c', incident: 'CA' }));
    expect(matcher.assignments().find((a) => a.tag === TAG2)!.reason).toBe('incident_state:NY');
  });

  it('nobody licensed in any of its states → unassigned (not released), counted for ops', async () => {
    const { matcher } = setup();
    matcher.putRoster(roster([['c-nj', ['NJ']]]));
    await matcher.upsertEntry(await entry({ who: 'a', incident: 'CA', survivor: 'TX' }));
    await matcher.upsertEntry(await entry({ who: 'b' }));
    expect(matcher.assignments()).toEqual([]);
    expect(matcher.unassignedCount()).toBe(1);
    // a counselor licensed in CA joins: assigned on the next pass
    matcher.putRoster(roster([['c-nj', ['NJ']], ['c-ca', ['CA']]]));
    expect(matcher.assignments()).toMatchObject([{ counselorId: 'c-ca', reason: 'incident_state:CA' }]);
  });

  it('no states at all → still released: the least-loaded counselor on the whole roster, fallback:no_state', async () => {
    const { matcher, store } = setup();
    // nobody on the roster yet: kept, not released
    await matcher.upsertEntry(await entry({ who: 'a' }));
    await matcher.upsertEntry(await entry({ who: 'b' }));
    expect(matcher.assignments()).toEqual([]);
    expect(store.assignments()[0]!.reason).toBe('unassigned:no_counselor');
    matcher.putRoster(roster([['c-nj', ['NJ']], ['c-ny', ['NY']]]));
    const [a] = matcher.assignments();
    expect(a).toMatchObject({ reason: 'fallback:no_state' });
    // balanced: a second no-state group goes to the other counselor
    await matcher.upsertEntry(await entry({ tag: TAG2, who: 'a', at: T0 - 1 }));
    await matcher.upsertEntry(await entry({ tag: TAG2, who: 'b', at: T0 - 1 }));
    const b = matcher.assignments().find((x) => x.tag === TAG2)!;
    expect(b.reason).toBe('fallback:no_state');
    expect(b.counselorId).not.toBe(a!.counselorId);
    // sticky across calls
    expect(matcher.assignments().find((x) => x.tag === TAG)).toEqual(a);
  });

  it('one entry with a state routes the whole group', async () => {
    const { matcher } = setup();
    matcher.putRoster(roster([['c-nj', ['NJ']], ['c-ny', ['NY']]]));
    await matcher.upsertEntry(await entry({ who: 'a' }));
    await matcher.upsertEntry(await entry({ who: 'b', survivor: 'NJ' }));
    expect(matcher.assignments()).toMatchObject([{ counselorId: 'c-nj', reason: 'survivor_state:NJ' }]);
  });

  it('routing data that does not open (moved from another entry, or no routing) counts as no state', async () => {
    const { matcher } = setup();
    matcher.putRoster(roster([['c-ny', ['NY']]]));
    await matcher.upsertEntry(await entry({ who: 'a', incident: 'NY', routingTag: TAG2 })); // sealed for another tag
    await matcher.upsertEntry({ ...(await entry({ who: 'b' })), routing: null });
    expect(matcher.assignments()).toMatchObject([{ counselorId: 'c-ny', reason: 'fallback:no_state' }]);
  });
});

describe('matcher: load balancing, stickiness, declines, roster', () => {
  it('balances across two counselors licensed in the same state (alternates), deterministically', async () => {
    const run = async () => {
      const { matcher } = setup();
      matcher.putRoster(roster([['c-nj-1', ['NJ']], ['c-nj-2', ['NJ']]]));
      for (let g = 0; g < 4; g++) {
        const tag = hex(`group-${g}`);
        await matcher.upsertEntry(await entry({ tag, who: 'a', incident: 'NJ', at: T0 - 10 + g }));
        await matcher.upsertEntry(await entry({ tag, who: 'b', incident: 'NJ', at: T0 - 10 + g }));
      }
      return matcher.assignments().map((a) => [a.tag, a.counselorId]);
    };
    const first = await run();
    const counts = first.reduce<Record<string, number>>((n, [, c]) => ({ ...n, [c!]: (n[c!] ?? 0) + 1 }), {});
    expect(counts).toEqual({ 'c-nj-1': 2, 'c-nj-2': 2 });
    expect(await run()).toEqual(first);
  });

  it('ties go to the lowest sha256(tag | counselorId)', async () => {
    const { matcher } = setup();
    matcher.putRoster(roster([['x', ['NJ']], ['y', ['NJ']]]));
    await matcher.upsertEntry(await entry({ who: 'a', incident: 'NJ' }));
    await matcher.upsertEntry(await entry({ who: 'b', incident: 'NJ' }));
    const want = hex(`${TAG}|x`) < hex(`${TAG}|y`) ? 'x' : 'y';
    expect(matcher.assignments()[0]!.counselorId).toBe(want);
  });

  it('sticky across calls and new entries; signed with the matcher key', async () => {
    const { matcher } = setup();
    matcher.putRoster(roster([['c1', ['NJ']], ['c2', ['NJ']]]));
    await matcher.upsertEntry(await entry({ who: 'a', incident: 'NJ' }));
    await matcher.upsertEntry(await entry({ who: 'b', incident: 'NJ' }));
    const [a] = matcher.assignments();
    await matcher.upsertEntry(await entry({ who: 'c', incident: 'NJ' }));
    matcher.putRoster(roster([['c1', ['NJ']], ['c2', ['NJ']], ['c3', ['NJ']]]));
    expect(matcher.assignments()).toEqual([a]);
    expect(verifyAssignmentSignature(a!, keys.signPublicKey)).toBe(true);
    expect(verifyAssignmentSignature({ ...a!, counselorId: 'c3' }, keys.signPublicKey)).toBe(false);
  });

  it('decline → reassigned with the decliner excluded and a reassigned: reason', async () => {
    const { matcher } = setup();
    matcher.putRoster(roster([['c1', ['NJ']], ['c2', ['NJ']]]));
    await matcher.upsertEntry(await entry({ who: 'a', incident: 'NJ' }));
    await matcher.upsertEntry(await entry({ who: 'b', incident: 'NJ' }));
    const first = matcher.assignments()[0]!;
    matcher.decline(TAG, first.counselorId);
    const second = matcher.assignments()[0]!;
    expect(second.counselorId).not.toBe(first.counselorId);
    expect(second.reason).toBe('reassigned:incident_state:NJ');
    // the second declines too: nobody left → unassigned, and the first is not brought back
    matcher.decline(TAG, second.counselorId);
    expect(matcher.assignments()).toEqual([]);
    expect(() => matcher.decline(TAG, 'c1')).toThrow(/No such assignment/);
  });

  it('a decline survives the group dissolving and forming again; erased once the tag has no entries', async () => {
    const { matcher, store } = setup();
    matcher.putRoster(roster([['c1', ['NJ']], ['c2', ['NJ']]]));
    const a = await entry({ who: 'a', incident: 'NJ' });
    await matcher.upsertEntry(a);
    await matcher.upsertEntry(await entry({ who: 'b', incident: 'NJ' }));
    const first = matcher.assignments()[0]!;
    matcher.decline(TAG, first.counselorId);
    const other = matcher.assignments()[0]!.counselorId;
    expect(other).not.toBe(first.counselorId);
    // a withdraws: the group dissolves; she seals again: it forms again, and does not go back to the decliner
    matcher.removeEntry(a.entryId);
    expect(matcher.assignments()).toEqual([]);
    await matcher.upsertEntry(await entry({ who: 'a', incident: 'NJ' }));
    expect(matcher.assignments()).toMatchObject([{ counselorId: other }]);
    expect(store.exclusionsFor(TAG)).toEqual([first.counselorId]);
    // every entry withdrawn: the decline is erased with them
    for (const e of store.eligibleEntries(new Date(T0 + DAY).toISOString())) matcher.removeEntry(e.entry_id);
    expect(store.exclusionsFor(TAG)).toEqual([]);
  });

  it('a counselor removed from the roster → reassigned', async () => {
    const { matcher } = setup();
    matcher.putRoster(roster([['c1', ['NJ']], ['c2', ['NJ']]]));
    await matcher.upsertEntry(await entry({ who: 'a', incident: 'NJ' }));
    await matcher.upsertEntry(await entry({ who: 'b', incident: 'NJ' }));
    const first = matcher.assignments()[0]!;
    const other = first.counselorId === 'c1' ? 'c2' : 'c1';
    matcher.putRoster(roster([[other, ['NJ']]]));
    expect(matcher.assignments()).toMatchObject([{ counselorId: other, reason: 'reassigned:incident_state:NJ' }]);
    // unverified counselors are dropped even if listed
    matcher.putRoster({ ...roster([[other, ['NJ']]]), verifiedIds: [] });
    expect(matcher.assignments()).toEqual([]);
  });

  it('pinned roster key: unsigned or badly signed rosters are refused (the old one stays); v1 roster → nothing assigned', async () => {
    const org = generateRosterKey();
    const { matcher } = setup({ rosterKey: org.publicKey });
    const pk = { kty: 'RSA', n: 'nnn', e: 'AQAB' } as JsonWebKey;
    expect(() => matcher.putRoster(roster([['c-nj', ['NJ']]]))).toThrow(/not signed/);
    const signed = signCounselorRoster([{ userId: 'c-nj', publicKey: pk, licensedStates: ['NJ'] }], org.secretKey);
    const forged = { ...signed, payload: signed.payload.replace('"NJ"', '"NY"') };
    expect(() => matcher.putRoster({ roster: forged, verifiedIds: ['c-nj'] })).toThrow(/not signed/);
    // the app server cannot add licensed states of its own when the roster is pinned
    matcher.putRoster({ roster: signed, verifiedIds: ['c-nj'], counselors: [{ userId: 'c-nj', licensedStates: ['NY'] }] });
    await matcher.upsertEntry(await entry({ who: 'a', incident: 'NY' }));
    await matcher.upsertEntry(await entry({ who: 'b', incident: 'NY' }));
    expect(matcher.assignments()).toEqual([]);
    await matcher.upsertEntry(await entry({ tag: TAG2, who: 'a', incident: 'NJ' }));
    await matcher.upsertEntry(await entry({ tag: TAG2, who: 'b', incident: 'NJ' }));
    expect(matcher.assignments()).toMatchObject([{ tag: TAG2, counselorId: 'c-nj' }]);
    // a v1 roster (no licensed states) verifies but lists nobody as licensed anywhere
    const { ed25519 } = await import('@noble/curves/ed25519.js');
    const v1payload = JSON.stringify({ v: 1, issuedAt: 'x', counselors: [{ userId: 'c-nj', publicKey: { kty: 'RSA', n: 'nnn', e: 'AQAB' } }] });
    const v1 = { payload: v1payload, signature: toBase64(ed25519.sign(new TextEncoder().encode(`matra/counselor-roster/v1|${v1payload}`), org.secretKey)) };
    matcher.putRoster({ roster: v1, verifiedIds: ['c-nj'] });
    expect(matcher.assignments()).toEqual([]);
  });
});

describe('matcher HTTP API', () => {
  const platform = new Uint8Array(32).fill(9);
  const TOKEN = 't'.repeat(40);
  const make = () => {
    const { matcher } = createMatcher({ dbPath: ':memory:', keys, releaseDelayMs: 0 });
    const attester = new SimulatedAttester({ platformSecretKey: platform, measurement: 'ab'.repeat(32), keys });
    return createMatcherApp({ matcher, attester, token: TOKEN });
  };
  const auth = { Authorization: `Bearer ${TOKEN}` };

  it('logs route patterns and error messages only: never ids, tags, IPs, user agents or a thrown object (W11)', async () => {
    const lines: string[] = [];
    const capture = (...a: unknown[]) => void lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
    const spies = [vi.spyOn(console, 'log').mockImplementation(capture), vi.spyOn(console, 'error').mockImplementation(capture)];
    try {
      const { matcher } = createMatcher({ dbPath: ':memory:', keys, releaseDelayMs: 0 });
      // A thrown value with no message, carrying request data (what a careless error log would print whole).
      matcher.decline = () => {
        throw { leaked: 'tag-SECRET-203.0.113.9', headers: { 'user-agent': 'UA-SECRET' } };
      };
      const attester = new SimulatedAttester({ platformSecretKey: platform, measurement: 'ab'.repeat(32), keys });
      const app = createMatcherApp({ matcher, attester, token: TOKEN, logRequests: true });
      const r = await request(app)
        .post('/v1/assignments/tag-SECRET/decline')
        .set(auth)
        .set('User-Agent', 'UA-SECRET')
        .set('X-Forwarded-For', '203.0.113.9')
        .send({ counselorId: 'c-SECRET' });
      expect(r.status).toBe(500);
      await request(app).get('/v1/nope/tag-SECRET?x=1');
    } finally {
      for (const s of spies) s.mockRestore();
    }
    expect(lines).toContain('[matcher] internal error: unknown');
    expect(lines.some((l) => /^\[matcher\] POST \/v1\/assignments\/:tag\/decline 500 \d+ms$/.test(l))).toBe(true);
    expect(lines.some((l) => /^\[matcher\] GET \(unmatched\) 404 \d+ms$/.test(l))).toBe(true);
    for (const secret of ['SECRET', '203.0.113.9', 'UA-']) expect(lines.join('\n')).not.toContain(secret);
  });

  it('attestation is public, needs a 64-hex nonce, and verifies', async () => {
    const app = make();
    const nonce = newAttestationNonce();
    const r = await request(app).get(`/v1/attestation?nonce=${nonce}`);
    expect(r.status).toBe(200);
    const { platformPublicKey } = await import('@matra/crypto');
    const v = verifyAttestation(r.body, { nonce, platformKey: platformPublicKey(platform), expectedMeasurement: 'ab'.repeat(32), allowSimulated: true });
    expect(v.encKey).toEqual(keys.encPublicJwk);
    expect((await request(app).get('/v1/attestation?nonce=xyz')).status).toBe(400);
    expect((await request(app).get('/v1/health')).body).toEqual({ ok: true, measurement: 'ab'.repeat(32), platform: 'simulated' });
  });

  it('/v1/health reveals no counts (a match forming must not be observable); /v1/stats needs the token', async () => {
    const app = make();
    await request(app).put('/v1/roster').set(auth).send(roster([['c-nj', ['NJ']]])).expect(200);
    const before = (await request(app).get('/v1/health')).text;
    await request(app).post('/v1/entries').set(auth).send(await entry({ who: 'a', incident: 'QQ' })).expect(200);
    await request(app).post('/v1/entries').set(auth).send(await entry({ who: 'b', incident: 'QQ' })).expect(200);
    expect((await request(app).get('/v1/health')).text).toBe(before);
    expect((await request(app).get('/v1/stats')).status).toBe(401);
    expect((await request(app).get('/v1/stats').set(auth)).body).toEqual({ unassigned: 1 });
  });

  it('everything else needs the token', async () => {
    const app = make();
    expect((await request(app).get('/v1/assignments')).status).toBe(401);
    expect((await request(app).get('/v1/assignments').set({ Authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await request(app).get('/v1/assignments').set(auth)).body).toEqual({ assignments: [] });
  });

  it('POST /v1/entries answers identically for a match and a miss; assignments and decline work over HTTP', async () => {
    const app = make();
    await request(app).put('/v1/roster').set(auth).send(roster([['c1', ['NJ']], ['c2', ['NJ']]])).expect(200);
    const miss = await request(app).post('/v1/entries').set(auth).send(await entry({ who: 'a', incident: 'NJ' }));
    const match = await request(app).post('/v1/entries').set(auth).send(await entry({ who: 'b', incident: 'NJ' }));
    expect(miss.status).toBe(200);
    expect(match.status).toBe(200);
    expect(match.text).toBe(miss.text);
    expect(Object.keys(match.headers).sort()).toEqual(Object.keys(miss.headers).sort());
    const list = (await request(app).get('/v1/assignments').set(auth)).body.assignments;
    expect(list).toHaveLength(1);
    await request(app).post(`/v1/assignments/${TAG}/decline`).set(auth).send({ counselorId: list[0].counselorId }).expect(200);
    const after = (await request(app).get('/v1/assignments').set(auth)).body.assignments;
    expect(after[0].counselorId).not.toBe(list[0].counselorId);
    expect((await request(app).post('/v1/entries').set(auth).send({ entryId: 'x', tag: 'nothex' })).status).toBe(400);
  });

  it('production refuses to start without a pinned counselor-roster key (unless MATRA_DEMO_MODE=1)', () => {
    const env = {
      NODE_ENV: 'production',
      MATRA_ATTESTATION: 'nitro',
      MATRA_MATCHER_KEY: '11'.repeat(32),
      MATRA_MATCHER_TOKEN: 't'.repeat(40),
      MATRA_MATCHER_DB_PATH: ':memory:',
    };
    expect(() => loadMatcherSettings(env)).toThrow(/MATRA_COUNSELOR_ROSTER_PUBKEY must be set in production/);
    expect(loadMatcherSettings({ ...env, MATRA_DEMO_MODE: '1' }).rosterKey).toBeUndefined();
    const org = generateRosterKey();
    expect(loadMatcherSettings({ ...env, MATRA_COUNSELOR_ROSTER_PUBKEY: toBase64(org.publicKey) }).rosterKey).toEqual(org.publicKey);
    expect(() => loadMatcherSettings({ ...env, MATRA_COUNSELOR_ROSTER_PUBKEY: toBase64(new Uint8Array(5)) })).toThrow(/32 bytes/);
  });

  it('production refuses the simulated attester without MATRA_DEMO_MODE=1', () => {
    expect(() => loadAttester({ env: { NODE_ENV: 'production' }, keys, platformSecretKey: platform, measurement: 'ab'.repeat(32) })).toThrow(
      /cannot run in production/,
    );
    expect(loadAttester({ env: { NODE_ENV: 'production', MATRA_DEMO_MODE: '1' }, keys, platformSecretKey: platform, measurement: 'ab'.repeat(32) }).platform).toBe(
      'simulated',
    );
  });
});
