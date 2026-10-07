import { describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  blindMatchIdentifier,
  decryptJSON,
  encryptJSON,
  generateContentKey,
  reconstructMatchGroup,
  toBase64,
} from '@matra/crypto';
import type { CounselorMatchGroup } from '@matra/shared';
import { makeApp, registerUser, sealMatch, type TestUser } from './test-helpers.js';
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
    expect(Object.keys(ea.entry).sort()).toEqual(['createdAt', 'id', 'labelEnvelope', 'ledgerEntryId', 'status']);
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
