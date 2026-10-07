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
  signCounselorRoster,
  decryptJSON,
  encryptJSON,
  generateContentKey,
  reconstructMatchGroup,
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
    for (const h of ['a', 'b']) {
      expect((await request(app).post(`/api/matching/oprf-${h}`).set(s.auth).send(blinded())).status).toBe(200);
      const c = await request(app).post(`/api/matching/oprf-${h}`).set(loc.auth).send(blinded());
      expect(c.status).toBe(403);
      expect(c.body.code).toBe('forbidden_role');
      expect((await request(app).post(`/api/matching/oprf-${h}`).set(atty.auth).send(blinded())).status).toBe(403);
      expect((await request(app).post(`/api/matching/oprf-${h}`).send(blinded())).status).toBe(401);
    }
    expect((await request(app).get('/api/matching/config').set(loc.auth)).status).toBe(403);
    expect((await request(app).post('/api/matching/entries').set(loc.auth).send({})).status).toBe(403);

    // a survivor account without a stored 18+ confirmation (created before that existed) is refused
    db.prepare('UPDATE users SET age_confirmed_18 = 0 WHERE id = ?').run(s.user.id);
    const r = await request(app).post('/api/matching/oprf-a').set(s.auth).send(blinded());
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('age_not_confirmed');

    // invalid group element → 400, not counted
    const s2 = await registerUser(app, 'survivor.two');
    expect((await request(app).post('/api/matching/oprf-a').set(s2.auth).send({ blinded: toBase64(new Uint8Array(32).fill(255)) })).status).toBe(400);
    expect(db.prepare('SELECT * FROM oprf_quota WHERE user_id = ?').all(s2.user.id)).toEqual([]);
  });

  it('rate-limits per account and per key holder (daily + lifetime)', async () => {
    const { app, db } = makeApp({ matching: { limits: { perDay: 3, lifetime: 5 } } });
    const s = await registerUser(app, 'survivor.rl');
    const other = await registerUser(app, 'survivor.other');
    const hit = (u: TestUser, h = 'a') => request(app).post(`/api/matching/oprf-${h}`).set(u.auth).send(blinded());
    for (let i = 0; i < 3; i++) expect((await hit(s)).status).toBe(200);
    const d = await hit(s);
    expect(d.status).toBe(429);
    expect(d.body.code).toBe('rate_limited_daily');
    expect((await hit(other)).status).toBe(200); // per account
    expect((await hit(s, 'b')).status).toBe(200); // holder B keeps its own counters

    // next day: allowed again until the lifetime cap
    db.prepare(`UPDATE oprf_quota SET day = '2000-01-01' WHERE user_id = ? AND holder = 'a'`).run(s.user.id);
    expect((await hit(s)).status).toBe(200);
    expect((await hit(s)).status).toBe(200);
    db.prepare(`UPDATE oprf_quota SET day = '2000-01-01' WHERE user_id = ? AND holder = 'a'`).run(s.user.id);
    const l = await hit(s);
    expect(l.status).toBe(429);
    expect(l.body.code).toBe('rate_limited_lifetime');
    // only a day + counts are stored, no timestamps per call
    expect(Object.keys(db.prepare('SELECT * FROM oprf_quota LIMIT 1').get() as object).sort()).toEqual(['day', 'day_count', 'holder', 'lifetime_count', 'user_id']);
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
    const groups = await groupsOf(app, loc);
    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g.tag).toBe(ea.tag);
    expect(g.entries).toHaveLength(2);
    expect(g.entries.every((e) => e.seal.counselorId === loc.user.id)).toBe(true);
    const text = JSON.stringify(groups);
    for (const u of [a, b, c]) {
      expect(text).not.toContain(u.user.id);
      expect(text).not.toContain(u.user.username);
    }

    const r = await reconstructMatchGroup(g.tag, g.entries, loc.privateKey, loc.user.id);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.failed).toEqual([]);
      expect(r.bundles.map((x) => x.bundle.contact.name).sort()).toEqual(['Alex', 'Blair']);
      expect(r.bundles[0]!.bundle.identifier).toEqual({ kind: 'social', canonical: 'instagram:bad_guy' });
    }
    // the second counselor gets only the seals addressed to them, and can reconstruct independently
    const g2 = (await groupsOf(app, loc2))[0]!;
    expect(g2.entries.every((e) => e.seal.counselorId === loc2.user.id)).toBe(true);
    expect((await reconstructMatchGroup(g2.tag, g2.entries, loc2.privateKey, loc2.user.id)).ok).toBe(true);
    // ...and cannot use the first counselor's seals
    expect((await reconstructMatchGroup(g.tag, g.entries, loc2.privateKey, loc2.user.id)).ok).toBe(false);

    // C's unrelated entry was never released
    expect(text).not.toContain('Casey');

    // counselor notes: encrypted to the counselor, stored per group
    const env = await encryptJSON({ status: 'reached_out', text: 'Left a text at 6pm.' }, loc.masterKey);
    const n = await request(app).post(`/api/counselor/groups/${g.id}/notes`).set(loc.auth).send({ entryId: g.entries[0]!.entryId, envelope: env });
    expect(n.status).toBe(201);
    const again = (await groupsOf(app, loc))[0]!;
    expect(again.notes).toHaveLength(1);
    expect(await decryptJSON(again.notes[0]!.envelope, loc.masterKey)).toEqual({ status: 'reached_out', text: 'Left a text at 6pm.' });
    expect((await groupsOf(app, loc2))[0]!.notes).toEqual([]);
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
      .send({ tag: first.tag, bundle: env, labelEnvelope: env, seals: [{ counselorId: loc.user.id, wrappedKey: { v: 1, alg: 'RSA-OAEP-256', data: 'AAAA' }, envelope: env }] });
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
    db.prepare('UPDATE match_entries SET created_at = ? WHERE user_id = ?').run(old, a.user.id);
    expect(await groupsOf(app, loc)).toEqual([]); // only one entry is old enough
    db.prepare('UPDATE match_entries SET created_at = ? WHERE user_id = ?').run(old, b.user.id);
    const g = await groupsOf(app, loc);
    expect(g).toHaveLength(1);
    // both accounts were created seconds apart and sealed within 7 days of creation
    expect(g[0]!.signals).toEqual({ accountsCreatedClose: true, newAccountEntries: 2 });
    // an older account, created weeks earlier, is not flagged
    db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 60 * 86_400_000).toISOString(), a.user.id);
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
    const g2 = (await groupsOf(app, loc2))[0]!;
    expect((await reconstructMatchGroup(g2.tag, g2.entries, loc2.privateKey, loc2.user.id)).ok).toBe(true);
    // idempotent
    expect(await refreshMatchEntries(matchTransport(app, b), { masterKey: b.masterKey })).toEqual({ resealed: 0, sealsAdded: 0, skipped: 0 });
    // the seals endpoint is owner-only
    const seal = g2.entries[0]!.seal;
    expect((await request(app).post(`/api/matching/entries/${ea.entry.id}/seals`).set(b.auth).send({ seals: [seal] })).status).toBe(404);
    // loc1 is removed: its seals are deleted server-side
    db.prepare('UPDATE counselor_profiles SET verified = 0 WHERE user_id = ?').run(loc1.user.id);
    await request(app).get('/api/matching/config').set(a.auth);
    expect(db.prepare('SELECT COUNT(*) n FROM match_seals WHERE counselor_id = ?').get(loc1.user.id)).toEqual({ n: 0 });
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
    const [kA, kB, kA2] = [generateOprfKey(), generateOprfKey(), generateOprfKey()];
    const app1 = createApp({ dbPath, pepper: TEST_PEPPER, matching: { keyA: kA, keyB: kB, releaseDelayHours: 0 } });
    const loc = await registerUser(app1, 'loc.one', 'counselor');
    const a = await registerUser(app1, 'survivor.a');
    const b = await registerUser(app1, 'survivor.b');
    await sealMatch(app1, a, 'phone', '(201) 555-0142');
    await sealMatch(app1, b, 'phone', '+12015550142');
    const tagBefore = (await groupsOf(app1, loc))[0]!.tag;
    getDb(app1).close();

    expect(() => createApp({ dbPath, pepper: TEST_PEPPER, matching: { keyA: kA2, keyB: kB } })).toThrow(/MATRA_OPRF_ROTATE/);
    const app2 = createApp({ dbPath, pepper: TEST_PEPPER, matching: { keyA: kA2, keyB: kB, releaseDelayHours: 0, allowKeyRotation: true } });
    const cfg = (await request(app2).get('/api/matching/config').set(a.auth)).body;
    expect(cfg.keyEpoch).toBe(2);
    // a restart with the rotated keys (no flag) is fine
    getDb(app2).close();
    const app3 = createApp({ dbPath, pepper: TEST_PEPPER, matching: { keyA: kA2, keyB: kB, releaseDelayHours: 0 } });
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
});
