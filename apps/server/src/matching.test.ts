import { describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  blindMatchIdentifier,
  generateOprfKey,
  generateRosterKey,
  refreshMatchEntries,
  splitOprfKey,
  signCounselorRoster,
  decryptJSON,
  encryptJSON,
  generateContentKey,
  matcherKeysFromSeed,
  reconstructMatchGroup,
  sealRouting,
  toBase64,
} from '@matra/crypto';
import type { CounselorMatchGroup } from '@matra/shared';
import { createApp, getDb } from './app.js';
import { TEST_PEPPER, makeApp, matchTransport, registerUser, sealMatch, type TestUser } from './test-helpers.js';
import type express from 'express';

const blinded = () => ({ blinded: toBase64(blindMatchIdentifier('email:x@example.com').blinded) });
const groupsOf = async (app: express.Express, c: TestUser) => {
  const r = await request(app).get('/api/counselor/groups').set(c.auth);
  expect(r.status).toBe(200);
  return r.body.groups as CounselorMatchGroup[];
};
const ledgerLen = (db: ReturnType<typeof makeApp>['db']) => (db.prepare('SELECT COUNT(*) n FROM ledger').get() as { n: number }).n;

describe('sealed matching: access control and rate limits', () => {
  it('only verified-adult survivors can call the OPRF endpoints; counselors and attorneys cannot', async () => {
    const { app, db } = makeApp();
    const s = await registerUser(app, 'survivor.ok');
    const loc = await registerUser(app, 'loc.one', 'counselor');
    const atty = await registerUser(app, 'atty.one', 'attorney');
    for (const h of [1, 2, 3]) {
      expect((await request(app).post(`/api/matching/oprf/${h}`).set(s.auth).send(blinded())).status).toBe(200);
      const c = await request(app).post(`/api/matching/oprf/${h}`).set(loc.auth).send(blinded());
      expect(c.status).toBe(403);
      expect(c.body.code).toBe('forbidden_role');
      expect((await request(app).post(`/api/matching/oprf/${h}`).set(atty.auth).send(blinded())).status).toBe(403);
      expect((await request(app).post(`/api/matching/oprf/${h}`).send(blinded())).status).toBe(401);
    }
    // no such holder (and no old additive endpoints)
    for (const p of ['/api/matching/oprf/0', '/api/matching/oprf/4', '/api/matching/oprf/x', '/api/matching/oprf-a'])
      expect((await request(app).post(p).set(s.auth).send(blinded())).status).toBe(404);
    // each holder's share public key is public; the config lists all three and the group key
    const cfg = (await request(app).get('/api/matching/config').set(s.auth)).body;
    expect(cfg.oprf).toMatchObject({ suite: 'ristretto255-SHA512', mode: 'voprf', t: 2, m: 3 });
    for (const h of [1, 2, 3]) expect((await request(app).get(`/api/matching/oprf/${h}/key`)).body).toEqual(cfg.oprf.holders[h - 1]);
    expect((await request(app).get('/api/matching/config').set(loc.auth)).status).toBe(403);
    expect((await request(app).post('/api/matching/entries').set(loc.auth).send({})).status).toBe(403);

    // a survivor account without a stored 18+ confirmation (created before that existed) is refused
    db.prepare('UPDATE users SET age_confirmed_18 = 0 WHERE id = ?').run(s.user.id);
    const r = await request(app).post('/api/matching/oprf/1').set(s.auth).send(blinded());
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('age_not_confirmed');

    // invalid group element → 400, not counted
    const s2 = await registerUser(app, 'survivor.two');
    expect((await request(app).post('/api/matching/oprf/1').set(s2.auth).send({ blinded: toBase64(new Uint8Array(32).fill(255)) })).status).toBe(400);
    expect(db.prepare('SELECT * FROM oprf_quota WHERE user_id = ?').all(s2.user.id)).toEqual([]);
  });

  it('rate-limits per account (daily + lifetime), one unit per distinct blinded element whichever holders it goes to', async () => {
    const { app, db } = makeApp({ matching: { limits: { perDay: 3, lifetime: 5 } } });
    const s = await registerUser(app, 'survivor.rl');
    const other = await registerUser(app, 'survivor.other');
    const hit = (u: TestUser, h = 1, b = blinded()) => request(app).post(`/api/matching/oprf/${h}`).set(u.auth).send(b);
    const third = blinded();
    expect((await hit(s)).status).toBe(200);
    expect((await hit(s)).status).toBe(200);
    expect((await hit(s, 1, third)).status).toBe(200);
    const d = await hit(s);
    expect(d.status).toBe(429);
    expect(d.body.code).toBe('rate_limited_daily');
    expect((await hit(other)).status).toBe(200); // per account
    expect((await hit(s, 2, third)).status).toBe(200); // the same blinded element at another holder is not charged again
    const n = await hit(s, 2); // a NEW element at another holder is: the account's budget is spent
    expect(n.status).toBe(429);
    expect(n.body.code).toBe('rate_limited_daily');

    // next day: allowed again until the lifetime cap
    db.prepare(`UPDATE oprf_quota SET day = '2000-01-01' WHERE user_id = ?`).run(s.user.id);
    expect((await hit(s)).status).toBe(200);
    expect((await hit(s)).status).toBe(200);
    db.prepare(`UPDATE oprf_quota SET day = '2000-01-01' WHERE user_id = ?`).run(s.user.id);
    const l = await hit(s);
    expect(l.status).toBe(429);
    expect(l.body.code).toBe('rate_limited_lifetime');
    // only a day + counts are stored, no timestamps per call
    expect(Object.keys(db.prepare('SELECT * FROM oprf_quota LIMIT 1').get() as object).sort()).toEqual(['day', 'day_count', 'holder', 'lifetime_count', 'user_id']);
  });

  it('spreading guesses over different t-subsets of holders does not multiply the account budget (2-of-3)', async () => {
    const { app, db } = makeApp({ matching: { limits: { perDay: 3, lifetime: 50 } } });
    const s = await registerUser(app, 'survivor.spread');
    const pairs = [[1, 2], [1, 3], [2, 3], [1, 2], [1, 3], [2, 3]];
    const ok: number[][] = [];
    for (const p of pairs) {
      const b = blinded();
      const r = await Promise.all(p.map((h) => request(app).post(`/api/matching/oprf/${h}`).set(s.auth).send(b)));
      if (r.every((x) => x.status === 200)) ok.push(p);
      else expect(r.every((x) => x.status === 429 && x.body.code === 'rate_limited_daily')).toBe(true);
    }
    // per-holder counting alone would have allowed ⌊3·3/2⌋ = 4 guesses today; the account limit is 3
    expect(ok).toHaveLength(3);
    expect(db.prepare(`SELECT day_count FROM oprf_quota WHERE user_id = ? AND holder = 'account'`).get(s.user.id)).toEqual({ day_count: 3 });
  });

  it('unverified counselors get nothing and are not offered to survivors', async () => {
    const { app } = makeApp();
    const pending = await registerUser(app, 'loc.pending', 'counselor', { verify: false });
    expect((await request(app).get('/api/counselor/groups').set(pending.auth)).body.code).toBe('counselor_not_verified');
    const s = await registerUser(app, 'survivor.x');
    expect((await request(app).get('/api/matching/config').set(s.auth)).body.counselors).toEqual([]);
    await expect(sealMatch(app, s, 'email', 'a@example.com')).rejects.toThrow(/no counselor/);
    const me = await request(app).get('/api/me').set(pending.auth);
    expect(me.body.counselorProfile).toMatchObject({ verified: false, organization: 'Test LOC' });
    expect(me.body.user.role).toBe('counselor');
  });
});

describe('sealed matching: threshold release to counselors', () => {
  it('unmatched entries are never released; 2 distinct survivors → one group; counselor reconstructs both bundles', async () => {
    const { app, db } = makeApp();
    const loc = await registerUser(app, 'loc.one', 'counselor');
    const loc2 = await registerUser(app, 'loc.two', 'counselor');
    const a = await registerUser(app, 'survivor.a');
    const b = await registerUser(app, 'survivor.b');
    const c = await registerUser(app, 'survivor.c');

    const ea = await sealMatch(app, a, 'social_handle', 'https://www.instagram.com/Bad_Guy/', undefined, 'Alex');
    await sealMatch(app, c, 'phone', '(201) 555-0100', undefined, 'Casey');
    expect(ea.entry.status).toBe('sealed');
    expect(Object.keys(ea.entry).sort()).toEqual(['counselorIds', 'createdAt', 'id', 'keyEpoch', 'labelEnvelope', 'ledgerEntryId', 'status']);
    // nothing matched → nothing released, to anyone
    expect(await groupsOf(app, loc)).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) n FROM match_groups').get()).toEqual({ n: 0 });

    const eb = await sealMatch(app, b, 'social_handle', '@bad_guy', 'Instagram', 'Blair');
    expect(eb.tag).toBe(ea.tag); // different forms, same person
    // the matcher gives the group to ONE of the two NJ-licensed counselors
    const [mine, other] = (await groupsOf(app, loc)).length ? [loc, loc2] : [loc2, loc];
    const groups = await groupsOf(app, mine);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.assignment?.reason).toBe('incident_state:NJ');
    expect(await groupsOf(app, other)).toEqual([]);
    const g = groups[0]!;
    expect(g.tag).toBe(ea.tag);
    expect(g.entries).toHaveLength(2);
    expect(g.entries.every((e) => e.seal.counselorId === mine.user.id)).toBe(true);
    const text = JSON.stringify(groups);
    for (const u of [a, b, c]) {
      expect(text).not.toContain(u.user.id);
      expect(text).not.toContain(u.user.username);
    }

    const r = await reconstructMatchGroup(g.tag, g.entries, mine.privateKey, mine.user.id);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.failed).toEqual([]);
      expect(r.bundles.map((x) => x.bundle.contact.name).sort()).toEqual(['Alex', 'Blair']);
      expect(r.bundles[0]!.bundle.identifier).toEqual({ kind: 'social', canonical: 'instagram:bad_guy' });
    }
    // the other counselor could not use the assigned counselor's seals even if she had them
    expect((await reconstructMatchGroup(g.tag, g.entries, other.privateKey, other.user.id)).ok).toBe(false);

    // C's unrelated entry was never released
    expect(text).not.toContain('Casey');

    // counselor notes: encrypted to the counselor, stored per group
    const env = await encryptJSON({ status: 'reached_out', text: 'Left a text at 6pm.' }, mine.masterKey);
    const n = await request(app).post(`/api/counselor/groups/${g.id}/notes`).set(mine.auth).send({ entryId: g.entries[0]!.entryId, envelope: env });
    expect(n.status).toBe(201);
    const again = (await groupsOf(app, mine))[0]!;
    expect(again.notes).toHaveLength(1);
    expect(await decryptJSON(again.notes[0]!.envelope, mine.masterKey)).toEqual({ status: 'reached_out', text: 'Left a text at 6pm.' });
    // a counselor the group was not assigned to cannot add notes to it
    expect((await request(app).post(`/api/counselor/groups/${g.id}/notes`).set(other.auth).send({ envelope: env })).body.code).toBe('group_not_found');
    expect((await request(app).post(`/api/counselor/groups/${g.id}/notes`).set(a.auth).send({ envelope: env })).status).toBe(403);
  });

  it('the same survivor naming the same person twice never matches', async () => {
    const { app, db } = makeApp();
    const loc = await registerUser(app, 'loc.one', 'counselor');
    const a = await registerUser(app, 'survivor.a');
    const first = await sealMatch(app, a, 'email', 'Bad.Actor+x@gmail.com');
    await expect(sealMatch(app, a, 'email', 'badactor@gmail.com')).rejects.toMatchObject({ code: 'already_sealed' });
    // even a hand-crafted second entry for the same tag is refused
    const env = await encryptJSON({ x: 1 }, await generateContentKey());
    const forged = await request(app)
      .post('/api/matching/entries')
      .set(a.auth)
      .send({
        tag: first.tag,
        bundle: env,
        labelEnvelope: env,
        seals: [{ counselorId: loc.user.id, wrappedKey: { v: 1, alg: 'RSA-OAEP-256', data: 'AAAA' }, envelope: env }],
        routing: await sealRouting({ v: 1, tag: first.tag }, matcherKeysFromSeed(new Uint8Array(32)).encPublicJwk),
      });
    expect(forged.status).toBe(409);
    expect(await groupsOf(app, loc)).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) n FROM match_entries').get()).toEqual({ n: 1 });
  });

  it('withdrawal deletes her entry; a group that drops below 2 survivors is no longer released', async () => {
    const { app, db } = makeApp();
    const loc = await registerUser(app, 'loc.one', 'counselor');
    const a = await registerUser(app, 'survivor.a');
    const b = await registerUser(app, 'survivor.b');
    await sealMatch(app, a, 'phone', '+1 201 555 0100');
    const eb = await sealMatch(app, b, 'phone', '201.555.0100');
    expect(await groupsOf(app, loc)).toHaveLength(1);

    expect((await request(app).delete(`/api/matching/entries/${eb.entry.id}`).set(a.auth)).status).toBe(404); // not hers
    expect((await request(app).delete(`/api/matching/entries/${eb.entry.id}`).set(loc.auth)).status).toBe(403);
    const w = await request(app).delete(`/api/matching/entries/${eb.entry.id}`).set(b.auth);
    expect(w.body).toEqual({ ok: true });
    expect((await request(app).get('/api/matching/entries').set(b.auth)).body.entries).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) n FROM match_seals WHERE entry_id = ?').get(eb.entry.id)).toEqual({ n: 0 });
    expect(await groupsOf(app, loc)).toEqual([]);
    // she can choose to seal again later
    await sealMatch(app, b, 'phone', '(201) 555-0100');
    expect(await groupsOf(app, loc)).toHaveLength(1);
  });

  it('survivors only ever see "sealed"; one ledger entry per submission; nothing reveals a match', async () => {
    const { app, db } = makeApp();
    await registerUser(app, 'loc.one', 'counselor');
    const victim = await registerUser(app, 'survivor.v');
    const perp = await registerUser(app, 'not.a.survivor');
    let before = ledgerLen(db);
    const head = async () => (await request(app).get('/api/ledger/head')).body.seq as number;
    const h0 = await head();
    await sealMatch(app, victim, 'phone', '(201) 555-0100');
    expect(ledgerLen(db)).toBe(before + 1);
    before = ledgerLen(db);
    // a perpetrator posing as a survivor submits his own number: the match happens, but he can't tell
    const p1 = await sealMatch(app, perp, 'phone', '+1 201 555 0100');
    expect(ledgerLen(db)).toBe(before + 1);
    expect(await head()).toBe(h0 + 2);
    expect(p1.entry.status).toBe('sealed');
    expect(p1.entry).not.toHaveProperty('matchedAt');
    expect(db.prepare('SELECT COUNT(*) n FROM match_groups').get()).toEqual({ n: 1 }); // it really matched

    for (const u of [victim, perp]) {
      for (const path of ['/api/matching/entries', '/api/escrow']) {
        const entries = (await request(app).get(path).set(u.auth)).body.entries as Array<Record<string, unknown>>;
        expect(entries).toHaveLength(1);
        for (const e of entries) {
          expect(e.status).toBe('sealed');
          expect(e).not.toHaveProperty('matchedAt');
          expect(e).not.toHaveProperty('tag');
        }
      }
      const events = JSON.stringify((await request(app).get('/api/audit').set(u.auth)).body.events);
      expect(events).not.toMatch(/match(ed)?\b|counselor/i);
    }
    const types = (db.prepare('SELECT DISTINCT type FROM ledger').all() as Array<{ type: string }>).map((r) => r.type);
    expect(types).toEqual(['escrow.sealed']);
    // the tag is not in the ledger
    const tag = (db.prepare('SELECT tag FROM match_entries LIMIT 1').get() as { tag: string }).tag;
    expect(JSON.stringify(db.prepare('SELECT * FROM ledger').all())).not.toContain(tag);
    expect((await request(app).get('/api/ledger/verify')).body.ok).toBe(true);
  });

  it('names cannot be submitted for matching', async () => {
    const { app } = makeApp();
    await registerUser(app, 'loc.one', 'counselor');
    const a = await registerUser(app, 'survivor.a');
    await expect(sealMatch(app, a, 'full_name', 'Ryan Smith')).rejects.toThrow(/name_not_unique/);
  });
});

describe('review fixes: release delay and Sybil signals (M2)', () => {
  it('a group is released only once two distinct entries are older than the delay, with Sybil signals', async () => {
    const { app, db } = makeApp({ matching: { releaseDelayHours: 72 } });
    const loc = await registerUser(app, 'loc.one', 'counselor');
    const a = await registerUser(app, 'survivor.a');
    const b = await registerUser(app, 'survivor.b');
    await sealMatch(app, a, 'email', 'bad.actor@example.com');
    await sealMatch(app, b, 'email', 'Bad.Actor@Example.com');
    expect(db.prepare('SELECT COUNT(*) n FROM match_groups').get()).toEqual({ n: 1 }); // it matched…
    expect(await groupsOf(app, loc)).toEqual([]); // …but nothing is released yet
    const old = new Date(Date.now() - 73 * 3_600_000).toISOString();
    // (time travel: the matcher keeps its own copy of the times, so the entries are re-sent to it)
    const age = (userId: string) => db.prepare('UPDATE match_entries SET created_at = ?, matcher_synced = 0 WHERE user_id = ?').run(old, userId);
    age(a.user.id);
    expect(await groupsOf(app, loc)).toEqual([]); // only one entry is old enough
    age(b.user.id);
    const g = await groupsOf(app, loc);
    expect(g).toHaveLength(1);
    // both accounts were created seconds apart and sealed within 7 days of creation
    expect(g[0]!.signals).toEqual({ accountsCreatedClose: true, newAccountEntries: 2 });
    // an older account, created weeks earlier, is not flagged
    db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 60 * 86_400_000).toISOString(), a.user.id);
    db.prepare('UPDATE match_entries SET matcher_synced = 0').run();
    expect((await groupsOf(app, loc))[0]!.signals).toEqual({ accountsCreatedClose: false, newAccountEntries: 1 });
  });
});

describe('review fixes: group cleanup (L3)', () => {
  it('withdrawal and account deletion remove empty groups and their counselor notes', async () => {
    const { app, db } = makeApp();
    const loc = await registerUser(app, 'loc.one', 'counselor');
    const a = await registerUser(app, 'survivor.a');
    const b = await registerUser(app, 'survivor.b');
    const ea = await sealMatch(app, a, 'phone', '+1 201 555 0100');
    await sealMatch(app, b, 'phone', '201.555.0100');
    const g = (await groupsOf(app, loc))[0]!;
    const env = await encryptJSON({ status: 'reached_out' }, loc.masterKey);
    await request(app).post(`/api/counselor/groups/${g.id}/notes`).set(loc.auth).send({ entryId: g.entries[0]!.entryId, envelope: env });
    await request(app).post(`/api/counselor/groups/${g.id}/notes`).set(loc.auth).send({ envelope: env });
    const count = (t: string) => (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;
    expect([count('match_groups'), count('counselor_notes')]).toEqual([1, 2]);
    await request(app).delete(`/api/matching/entries/${ea.entry.id}`).set(a.auth);
    expect(count('match_groups')).toBe(1); // b's entry remains
    expect(count('counselor_notes')).toBe(1); // the note about a's (deleted) entry is gone
    expect((await request(app).post('/api/account/delete').set(b.auth)).status).toBe(200);
    expect([count('match_groups'), count('counselor_notes'), count('match_entries')]).toEqual([0, 0, 0]);
  });
});

describe('review fixes: counselor roster changes (M6) and signed roster (M4)', () => {
  it('new counselors get seals on her next sign-in; removed counselors lose theirs; the cap is 200', async () => {
    const { app, db } = makeApp();
    const loc1 = await registerUser(app, 'loc.one', 'counselor');
    const loc2 = await registerUser(app, 'loc.two', 'counselor', { verify: false });
    const a = await registerUser(app, 'survivor.a');
    const b = await registerUser(app, 'survivor.b');
    const ea = await sealMatch(app, a, 'email', 'x1@example.com');
    await sealMatch(app, b, 'email', 'x1@example.com');
    expect(ea.entry.counselorIds).toEqual([loc1.user.id]);
    db.prepare('UPDATE counselor_profiles SET verified = 1 WHERE user_id = ?').run(loc2.user.id);
    expect((await request(app).get('/api/counselor/groups').set(loc2.auth)).body.groups).toEqual([]);
    // only one survivor has signed in since: a group needs ≥ 2 entries holding a seal for that counselor
    expect(await refreshMatchEntries(matchTransport(app, a), { masterKey: a.masterKey })).toEqual({ resealed: 0, sealsAdded: 1, skipped: 0 });
    expect(await groupsOf(app, loc2)).toEqual([]);
    await refreshMatchEntries(matchTransport(app, b), { masterKey: b.masterKey });
    // the group stays with loc1 (sticky) while loc1 is on the roster
    expect(await groupsOf(app, loc2)).toEqual([]);
    expect(await groupsOf(app, loc1)).toHaveLength(1);
    // idempotent
    expect(await refreshMatchEntries(matchTransport(app, b), { masterKey: b.masterKey })).toEqual({ resealed: 0, sealsAdded: 0, skipped: 0 });
    // loc1 is removed: its seals are deleted server-side, and the matcher reassigns the group to loc2
    db.prepare('UPDATE counselor_profiles SET verified = 0 WHERE user_id = ?').run(loc1.user.id);
    await request(app).get('/api/matching/config').set(a.auth);
    expect(db.prepare('SELECT COUNT(*) n FROM match_seals WHERE counselor_id = ?').get(loc1.user.id)).toEqual({ n: 0 });
    const g2 = (await groupsOf(app, loc2))[0]!;
    expect(g2.assignment?.reason).toBe('reassigned:incident_state:NJ');
    expect((await reconstructMatchGroup(g2.tag, g2.entries, loc2.privateKey, loc2.user.id)).ok).toBe(true);
    // the seals endpoint is owner-only
    const seal = g2.entries[0]!.seal;
    expect((await request(app).post(`/api/matching/entries/${ea.entry.id}/seals`).set(b.auth).send({ seals: [seal] })).status).toBe(404);
    // 20-counselor cap raised to 200
    const many = Array.from({ length: 21 }, (_, i) => ({ ...seal, counselorId: i.toString(16).padStart(32, '0') }));
    const r = await request(app).post(`/api/matching/entries/${ea.entry.id}/seals`).set(a.auth).send({ seals: many });
    expect(r.body.code).toBe('counselor_not_found'); // past schema validation (was: max 20)
  });

  it('with a pinned org key, survivors seal only to counselors on the signed roster; the server refuses others', async () => {
    const { app, db } = makeApp();
    const loc1 = await registerUser(app, 'loc.one', 'counselor');
    const loc2 = await registerUser(app, 'loc.two', 'counselor');
    const a = await registerUser(app, 'survivor.a');
    const org = generateRosterKey();
    const pins = { rosterKey: toBase64(org.publicKey) };
    // unsigned → refused when the build pins a roster key
    await expect(sealMatch(app, a, 'email', 'y@example.com', undefined, 'A', pins)).rejects.toThrow(/not signed/);
    const roster = signCounselorRoster([{ userId: loc2.user.id, publicKey: loc2.user.publicKey }], org.secretKey);
    db.prepare(`INSERT INTO matching_meta (key, value) VALUES ('counselor_roster', ?)`).run(JSON.stringify(roster));
    const e = await sealMatch(app, a, 'email', 'y@example.com', undefined, 'A', pins);
    expect(e.entry.counselorIds).toEqual([loc2.user.id]);
    const cfg = (await request(app).get('/api/matching/config').set(a.auth)).body;
    expect(cfg.counselors.map((c: { userId: string }) => c.userId)).toEqual([loc2.user.id]);
    expect(cfg.roster).toEqual(roster);
    const g = await request(app)
      .post(`/api/matching/entries/${e.entry.id}/seals`)
      .set(a.auth)
      .send({ seals: [{ counselorId: loc1.user.id, wrappedKey: { v: 1, alg: 'RSA-OAEP-256', data: 'AAAA' }, envelope: e.entry.labelEnvelope }] });
    expect(g.body.code).toBe('counselor_not_listed');
  });
});

describe('review fixes: OPRF key pinning and rotation (M5)', () => {
  it('refuses to boot with different keys; an explicit rotation starts a new epoch and clients re-seal on sign-in', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matra-rot-'));
    const dbPath = path.join(dir, 'm.db');
    const deal = () => ({ t: 2, shares: splitOprfKey(generateOprfKey().secretKey, 2, 3) });
    const [k1, k2] = [deal(), deal()];
    const app1 = createApp({ dbPath, pepper: TEST_PEPPER, matching: { oprf: k1, releaseDelayHours: 0 } });
    const loc = await registerUser(app1, 'loc.one', 'counselor');
    const a = await registerUser(app1, 'survivor.a');
    const b = await registerUser(app1, 'survivor.b');
    await sealMatch(app1, a, 'phone', '(201) 555-0142');
    await sealMatch(app1, b, 'phone', '+12015550142');
    const tagBefore = (await groupsOf(app1, loc))[0]!.tag;
    getDb(app1).close();

    // a restart with the same shares is fine; ANY change (new key, other t, one share swapped) is refused
    getDb(createApp({ dbPath, pepper: TEST_PEPPER, matching: { oprf: k1 } })).close();
    expect(() => createApp({ dbPath, pepper: TEST_PEPPER, matching: { oprf: k2 } })).toThrow(/MATRA_OPRF_ROTATE/);
    const k1as3of3 = { t: 3, shares: k1.shares };
    expect(() => createApp({ dbPath, pepper: TEST_PEPPER, matching: { oprf: k1as3of3 } })).toThrow(/MATRA_OPRF_ROTATE/);
    // shares that are not from one ceremony are refused outright (inconsistent key set), rotation or not
    const mixed = { t: 2, shares: [k1.shares[0]!, k1.shares[1]!, k2.shares[2]!] };
    expect(() => createApp({ dbPath, pepper: TEST_PEPPER, matching: { oprf: mixed, allowKeyRotation: true } })).toThrow(/inconsistent/);
    const app2 = createApp({ dbPath, pepper: TEST_PEPPER, matching: { oprf: k2, releaseDelayHours: 0, allowKeyRotation: true } });
    const cfg = (await request(app2).get('/api/matching/config').set(a.auth)).body;
    expect(cfg.keyEpoch).toBe(2);
    // a restart with the rotated keys (no flag) is fine
    getDb(app2).close();
    const app3 = createApp({ dbPath, pepper: TEST_PEPPER, matching: { oprf: k2, releaseDelayHours: 0 } });
    for (const u of [a, b]) {
      expect(await refreshMatchEntries(matchTransport(app3, u), { masterKey: u.masterKey })).toEqual({ resealed: 1, sealsAdded: 0, skipped: 0 });
      const entries = (await request(app3).get('/api/matching/entries').set(u.auth)).body.entries;
      expect(entries.map((e: { keyEpoch: number }) => e.keyEpoch)).toEqual([2]);
    }
    const groups = await groupsOf(app3, loc);
    expect(groups).toHaveLength(1); // the old-epoch group was cleaned up; the re-sealed entries match again
    expect(groups[0]!.tag).not.toBe(tagBefore);
    const r = await reconstructMatchGroup(groups[0]!.tag, groups[0]!.entries, loc.privateKey, loc.user.id);
    expect(r.ok && r.bundles[0]!.bundle.identifier.canonical).toBe('phone:+12015550142');
    getDb(app3).close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a database pinned to the old additive keys (oprf_pk_a/b) counts as a key change: refused without rotation', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matra-legacy-'));
    const dbPath = path.join(dir, 'm.db');
    const db = createApp({ dbPath, pepper: TEST_PEPPER }).locals.db as ReturnType<typeof getDb>;
    db.prepare(`DELETE FROM matching_meta WHERE key LIKE 'oprf_%'`).run();
    db.prepare(`INSERT INTO matching_meta (key, value) VALUES ('oprf_pk_a', 'AAAA'), ('oprf_pk_b', 'BBBB')`).run();
    db.close();
    const oprf = { t: 2, shares: splitOprfKey(generateOprfKey().secretKey, 2, 3) };
    expect(() => createApp({ dbPath, pepper: TEST_PEPPER, matching: { oprf } })).toThrow(/MATRA_OPRF_ROTATE/);
    const app = createApp({ dbPath, pepper: TEST_PEPPER, matching: { oprf, allowKeyRotation: true } });
    const meta = Object.fromEntries((getDb(app).prepare('SELECT key, value FROM matching_meta').all() as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]));
    expect(meta.oprf_pk_a).toBeUndefined();
    expect(meta.oprf_t).toBe('2');
    expect(meta.key_epoch).toBe('2');
    getDb(app).close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
