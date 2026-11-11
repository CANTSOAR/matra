/**
 * Phone verify-then-forget before sealed matching (W13, W19; src/sms.ts, docs/design/WEEKEND_MVP.md §3.4).
 * The raw number and the code must never reach the database or a log line; the only trace is a keyed hash in a table
 * that has no user id and no rowid, and a flag on her account.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { blindMatchIdentifier, toBase64 } from '@matra/crypto';
import { createApp, flushPhoneTokens, getDb } from './app.js';
import { loadPhoneVerification, loadSmsVerifier, assertMockAllowed } from './config.js';
import { openDb } from './db.js';
import { MockSmsVerifier, TwilioVerifySmsVerifier, phoneToken, type SmsVerifier } from './sms.js';
import { TEST_PEPPER, makeApp, registerUser, sealMatch, verifyPhone } from './test-helpers.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'matra-sms-'));
const blinded = () => ({ blinded: toBase64(blindMatchIdentifier('email:x@example.com').blinded) });
const start = (app: ReturnType<typeof makeApp>['app'], auth: { Authorization: string }, phone = '(201) 555-0100') =>
  request(app).post('/api/matching/verification/start').set(auth).send({ phone });
const check = (app: ReturnType<typeof makeApp>['app'], auth: { Authorization: string }, challengeId: string, code: string) =>
  request(app).post('/api/matching/verification/check').set(auth).send({ challengeId, code });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('phone verification gate (W13)', () => {
  it('sealed entries need a confirmed phone; status, config and listing stay readable so the UI can explain', async () => {
    const { app, db } = makeApp();
    await registerUser(app, 'loc.one', 'counselor');
    const s = await registerUser(app, 'survivor.unverified', 'survivor', { phoneVerified: false });
    expect((await request(app).get('/api/matching/verification').set(s.auth)).body).toEqual({ required: true, verified: false });
    for (const r of [
      await request(app).post('/api/matching/oprf/1').set(s.auth).send(blinded()),
      await request(app).post('/api/matching/entries').set(s.auth).send({}),
    ]) {
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('phone_not_verified');
    }
    // the client sees every holder refuse (so the web app asks GET /verification first, lib/vault.ts lodgeEscrow)
    await expect(sealMatch(app, s, 'email', 'someone@example.com')).rejects.toMatchObject({ code: 'holders_unavailable' });
    expect(db.prepare('SELECT COUNT(*) n FROM match_entries').get()).toEqual({ n: 0 });
    expect((await request(app).get('/api/matching/config').set(s.auth)).status).toBe(200);
    expect((await request(app).get('/api/matching/entries').set(s.auth)).status).toBe(200);
    // nothing was charged against her OPRF budget by the refused call
    expect(db.prepare('SELECT * FROM oprf_quota WHERE user_id = ?').all(s.user.id)).toEqual([]);

    const ok = await verifyPhone(app, s);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ verified: true });
    expect((await request(app).get('/api/matching/verification').set(s.auth)).body).toEqual({ required: true, verified: true });
    await expect(sealMatch(app, s, 'email', 'someone@example.com')).resolves.toBeDefined();
    // no timestamped audit row for her account that could be lined up with the SMS provider's (number, time) (W19)
    const events = (await request(app).get('/api/audit').set(s.auth)).body.events as Array<{ action: string }>;
    expect(events.some((e) => /phone/.test(e.action))).toBe(false);
    expect(db.prepare(`SELECT COUNT(*) n FROM audit_events WHERE action LIKE '%phone%'`).get()).toEqual({ n: 0 });
  });

  it('counselors, attorneys and accounts without an 18+ confirmation cannot start a verification', async () => {
    const { app } = makeApp();
    const loc = await registerUser(app, 'loc.two', 'counselor');
    const atty = await registerUser(app, 'atty.two', 'attorney');
    const minor = await registerUser(app, 'survivor.noage', 'survivor', { phoneVerified: false });
    getDb(app).prepare('UPDATE users SET age_confirmed_18 = 0 WHERE id = ?').run(minor.user.id);
    expect((await start(app, loc.auth)).status).toBe(403);
    expect((await start(app, atty.auth)).status).toBe(403);
    expect((await start(app, minor.auth)).body.code).toBe('age_not_confirmed');
    expect((await request(app).post('/api/matching/verification/start').send({ phone: '2015550100' })).status).toBe(401);
  });

  it('can be turned off (development only): then entries need only the 18+ confirmation', async () => {
    const { app } = makeApp({ matching: { requirePhoneVerification: false } });
    const s = await registerUser(app, 'survivor.devmode', 'survivor', { phoneVerified: false });
    expect((await request(app).get('/api/matching/verification').set(s.auth)).body).toEqual({ required: false, verified: false });
    expect((await request(app).post('/api/matching/oprf/1').set(s.auth).send(blinded())).status).toBe(200);
  });
});

describe('verify-then-forget flow', () => {
  it('rejects anything that is not one plain phone number, gently', async () => {
    const { app } = makeApp();
    const s = await registerUser(app, 'survivor.badphone', 'survivor', { phoneVerified: false });
    for (const phone of ['hello', '555-0100', '+1 (201) 000-0000', 'a@b.com'])
      expect((await start(app, s.auth, phone)).body.code).toBe('phone_invalid');
  });

  it('a wrong code is refused; five wrong codes end the challenge, even the right code afterwards', async () => {
    const { app } = makeApp();
    const s = await registerUser(app, 'survivor.wrong', 'survivor', { phoneVerified: false });
    const st = await start(app, s.auth);
    expect(st.status).toBe(200);
    expect(st.body.demoCode).toMatch(/^\d{6}$/);
    const wrong = st.body.demoCode === '000000' ? '111111' : '000000';
    for (let i = 1; i <= 4; i++) expect((await check(app, s.auth, st.body.challengeId, wrong)).body.code).toBe('code_invalid');
    expect((await check(app, s.auth, st.body.challengeId, wrong)).body.code).toBe('code_expired'); // 5th wrong: gone
    expect((await check(app, s.auth, st.body.challengeId, st.body.demoCode)).body.code).toBe('code_expired');
    expect((await request(app).get('/api/matching/verification').set(s.auth)).body.verified).toBe(false);
  });

  it('a code expires after 10 minutes; a challenge is usable only by the account that started it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { app } = makeApp();
    const s = await registerUser(app, 'survivor.slow', 'survivor', { phoneVerified: false });
    const other = await registerUser(app, 'survivor.thief', 'survivor', { phoneVerified: false });
    const st = await start(app, s.auth);
    expect((await check(app, other.auth, st.body.challengeId, st.body.demoCode)).body.code).toBe('code_expired');
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1);
    expect((await check(app, s.auth, st.body.challengeId, st.body.demoCode)).body.code).toBe('code_expired');
    expect((await request(app).get('/api/matching/verification').set(s.auth)).body.verified).toBe(false);
  });

  it('one phone, in any format, enables at most 2 accounts; the third is refused and stays unverified', async () => {
    const { app, db } = makeApp();
    const [a, b, c] = await Promise.all(['one', 'two', 'three'].map((n) => registerUser(app, `survivor.p${n}`, 'survivor', { phoneVerified: false })));
    expect((await verifyPhone(app, a!, '(201) 555-0100')).status).toBe(200);
    expect((await verifyPhone(app, b!, '+1 201-555-0100')).status).toBe(200);
    const third = await verifyPhone(app, c!, '+12015550100');
    expect(third.status).toBe(409);
    expect(third.body.code).toBe('phone_limit_reached');
    expect((await request(app).get('/api/matching/verification').set(c!.auth)).body.verified).toBe(false);
    // the counts are still only in memory (flushed later, in their own transaction: W19), yet the limit counted them
    expect(db.prepare('SELECT COUNT(*) n FROM phone_tokens').get()).toEqual({ n: 0 });
    flushPhoneTokens(app);
    // one token for all three spellings, counting the two accounts it enabled
    expect(db.prepare('SELECT accounts FROM phone_tokens').all()).toEqual([{ accounts: 2 }]);
    // and the limit holds across a flush (DB count + buffer)
    expect((await verifyPhone(app, c!, '(201) 555-0100')).body.code).toBe('phone_limit_reached');
    // a different phone works for the third account
    expect((await verifyPhone(app, c!, '(201) 555-0111')).status).toBe(200);
    // verifying again from an already verified account does not use up another slot
    expect((await verifyPhone(app, a!, '(201) 555-0111')).status).toBe(200);
    flushPhoneTokens(app);
    expect(db.prepare('SELECT accounts FROM phone_tokens ORDER BY accounts').all()).toEqual([{ accounts: 1 }, { accounts: 2 }]);
  });

  it('the limit is configurable', async () => {
    const { app } = makeApp({ matching: { phone: { maxAccountsPerPhone: 1 } } });
    const a = await registerUser(app, 'survivor.one1', 'survivor', { phoneVerified: false });
    const b = await registerUser(app, 'survivor.one2', 'survivor', { phoneVerified: false });
    expect((await verifyPhone(app, a)).status).toBe(200);
    expect((await verifyPhone(app, b)).body.code).toBe('phone_limit_reached');
  });

  it('rate-limits code requests: 3 per (account, phone) per hour, 5 per account per day', async () => {
    const { app } = makeApp();
    const s = await registerUser(app, 'survivor.spam', 'survivor', { phoneVerified: false });
    for (let i = 0; i < 3; i++) expect((await start(app, s.auth, '(201) 555-0100')).status).toBe(200);
    expect((await start(app, s.auth, '(201) 555-0100')).body.code).toBe('rate_limited');
    expect((await start(app, s.auth, '(201) 555-0122')).status).toBe(200);
    expect((await start(app, s.auth, '(201) 555-0133')).body.code).toBe('rate_limited'); // 6th of the day for this account
  });

  it('the per-phone limit is per account: other accounts can neither see nor exhaust it for her number', async () => {
    const { app } = makeApp();
    const attackers = await Promise.all([1, 2].map((i) => registerUser(app, `survivor.att${i}`, 'survivor', { phoneVerified: false })));
    for (const a of attackers) for (let i = 0; i < 3; i++) expect((await start(app, a.auth, '(201) 555-0199')).status).toBe(200);
    // six requests for her number from other accounts in the last hour: she still gets her codes, and verifies
    const owner = await registerUser(app, 'survivor.owner', 'survivor', { phoneVerified: false });
    expect((await verifyPhone(app, owner, '(201) 555-0199')).status).toBe(200);
  });

  it('caps sends per client IP and globally (SMS pumping), and refuses numbers outside the allowed countries first', async () => {
    const calls: string[] = [];
    const counting: SmsVerifier = {
      name: 'mock',
      start: async (e164) => (calls.push(e164), { providerRef: `r${calls.length}` }),
      check: async () => 'wrong_code',
    };
    const perIp = makeApp({ matching: { phone: { verifier: counting, sendLimits: { perIpPerHour: 3 } } } });
    const users = await Promise.all([1, 2].map((i) => registerUser(perIp.app, `survivor.ip${i}`, 'survivor', { phoneVerified: false })));
    for (const p of ['(201) 555-0101', '(201) 555-0102']) expect((await start(perIp.app, users[0]!.auth, p)).status).toBe(200);
    expect((await start(perIp.app, users[1]!.auth, '(201) 555-0103')).status).toBe(200);
    // a fresh account from the same IP does not help
    const r = await start(perIp.app, users[1]!.auth, '(201) 555-0104');
    expect(r.status).toBe(429);
    expect(r.body.code).toBe('rate_limited');
    expect(calls).toHaveLength(3);
    // a different client IP (behind a trusted proxy) has its own allowance
    const proxied = makeApp({ matching: { phone: { verifier: counting, sendLimits: { perIpPerHour: 1 } } } });
    proxied.app.set('trust proxy', 1);
    const p1 = await registerUser(proxied.app, 'survivor.px', 'survivor', { phoneVerified: false });
    const viaIp = (ip: string, phone: string) =>
      request(proxied.app).post('/api/matching/verification/start').set(p1.auth).set('X-Forwarded-For', ip).send({ phone });
    expect((await viaIp('198.51.100.7', '(201) 555-0111')).status).toBe(200);
    expect((await viaIp('198.51.100.7', '(201) 555-0112')).body.code).toBe('rate_limited');
    expect((await viaIp('198.51.100.8', '(201) 555-0112')).status).toBe(200);

    calls.length = 0;
    const global = makeApp({ matching: { phone: { verifier: counting, sendLimits: { globalPerHour: 2 } } } });
    const g = await Promise.all([1, 2, 3].map((i) => registerUser(global.app, `survivor.g${i}`, 'survivor', { phoneVerified: false })));
    expect((await start(global.app, g[0]!.auth, '(201) 555-0121')).status).toBe(200);
    expect((await start(global.app, g[1]!.auth, '(201) 555-0122')).status).toBe(200);
    const busy = await start(global.app, g[2]!.auth, '(201) 555-0123');
    expect(busy.status).toBe(503);
    expect(busy.body.code).toBe('sms_unavailable');
    expect(calls).toHaveLength(2);

    calls.length = 0;
    for (const phone of ['+44 20 7946 0958', '+882 1234 5678']) {
      const f = await start(global.app, g[2]!.auth, phone);
      expect(f.status).toBe(400);
      expect(f.body.code).toBe('phone_not_supported');
    }
    expect(calls).toHaveLength(0);
    // allowed when configured
    const uk = makeApp({ matching: { phone: { verifier: counting, allowedCountryCodes: ['1', '44'] } } });
    const u = await registerUser(uk.app, 'survivor.uk', 'survivor', { phoneVerified: false });
    expect((await start(uk.app, u.auth, '+44 20 7946 0958')).status).toBe(200);
  });

  it('the 5-try cap holds against concurrent checks: no more than 5 ever reach the provider', async () => {
    let checks = 0;
    const slow: SmsVerifier = {
      name: 'twilio',
      start: async () => ({ providerRef: 'VE1' }),
      check: async () => {
        checks++;
        await new Promise((r) => setTimeout(r, 20));
        return 'wrong_code';
      },
    };
    const { app } = makeApp({ matching: { phone: { verifier: slow } } });
    const s = await registerUser(app, 'survivor.burst', 'survivor', { phoneVerified: false });
    const st = await start(app, s.auth);
    const results = await Promise.all(Array.from({ length: 12 }, () => check(app, s.auth, st.body.challengeId, '123456')));
    expect(checks).toBe(5);
    expect(results.every((r) => r.status === 400)).toBe(true);
    expect((await check(app, s.auth, st.body.challengeId, '123456')).body.code).toBe('code_expired');
    expect(checks).toBe(5);
  });

  it('Twilio\'s own limits: a 429 on sending is rate_limited; a 429 on checking ends the challenge', async () => {
    const responses: Array<[number, unknown]> = [
      [200, { line_type_intelligence: { type: 'mobile' } }],
      [429, { code: 60203 }],
      [200, { line_type_intelligence: { type: 'mobile' } }],
      [201, { sid: 'VE1' }],
      [429, { code: 60202 }],
    ];
    const v = new TwilioVerifySmsVerifier({
      accountSid: 'AC',
      authToken: 't',
      verifyServiceSid: 'VA',
      fetchImpl: (async () => {
        const [status, body] = responses.shift()!;
        return new Response(JSON.stringify(body), { status });
      }) as unknown as typeof fetch,
    });
    const { app } = makeApp({ matching: { phone: { verifier: v } } });
    const s = await registerUser(app, 'survivor.tw429', 'survivor', { phoneVerified: false });
    const r1 = await start(app, s.auth);
    expect(r1.status).toBe(429);
    expect(r1.body.code).toBe('rate_limited');
    const r2 = await start(app, s.auth);
    expect(r2.status).toBe(200);
    expect((await check(app, s.auth, r2.body.challengeId, '123456')).body.code).toBe('code_expired');
    // the challenge is gone: no further provider call (no response is queued; one would throw)
    expect((await check(app, s.auth, r2.body.challengeId, '123456')).body.code).toBe('code_expired');
  });

  it('the demo code is never returned when the app is told not to expose it, nor by a real provider', async () => {
    const { app } = makeApp({ matching: { phone: { exposeDemoCode: false } } });
    const s = await registerUser(app, 'survivor.nodemo', 'survivor', { phoneVerified: false });
    const st = await start(app, s.auth);
    expect(st.status).toBe(200);
    expect(st.body.demoCode).toBeUndefined();
  });

  it('provider errors map to calm codes (VoIP refused → phone_not_supported, outage → sms_unavailable)', async () => {
    const twilio = (status: number, body: unknown) =>
      new TwilioVerifySmsVerifier({ accountSid: 'AC1', authToken: 't', verifyServiceSid: 'VA1', fetchImpl: (async () => new Response(JSON.stringify(body), { status })) as typeof fetch });
    const voip = makeApp({ matching: { phone: { verifier: twilio(200, { line_type_intelligence: { type: 'nonFixedVoip' } }) } } });
    const s = await registerUser(voip.app, 'survivor.voip', 'survivor', { phoneVerified: false });
    const r = await start(voip.app, s.auth);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('phone_not_supported');
    const down = makeApp({ matching: { phone: { verifier: twilio(500, {}) } } });
    const d = await registerUser(down.app, 'survivor.down', 'survivor', { phoneVerified: false });
    expect((await start(down.app, d.auth)).body.code).toBe('sms_unavailable');
  });
});

describe('what is kept (W19)', () => {
  it('phone_tokens has no user id and no rowid; the number and the code are in no DB byte and no log line', async () => {
    const dir = tmp();
    const dbPath = path.join(dir, 'matra.db');
    const logs: string[] = [];
    for (const m of ['log', 'warn', 'error', 'info'] as const) vi.spyOn(console, m).mockImplementation((...a) => void logs.push(a.join(' ')));
    const hashKey = new Uint8Array(32).fill(7);
    // with the request log on, as in production
    const app = createApp({
      dbPath,
      pepper: TEST_PEPPER,
      logRequests: true,
      matching: { releaseDelayHours: 0, phone: { hashKey, verifier: new MockSmsVerifier({ log: false }) } },
    });
    const s = await registerUser(app, 'survivor.private', 'survivor', { phoneVerified: false });
    const st = await start(app, s.auth, '(201) 555-0187');
    const code = st.body.demoCode as string;
    expect((await check(app, s.auth, st.body.challengeId, code)).status).toBe(200);
    const db = getDb(app);
    const token = phoneToken(hashKey, '+12015550187');
    const read = (f: string) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f)) : Buffer.alloc(0));
    // Right after verifying, WITHOUT a checkpoint by the test: the token is in no file at all (it is buffered in memory),
    // so no WAL commit pairs it with her users row; and her own flag commit was checkpointed out of the WAL.
    for (const f of ['matra.db', 'matra.db-wal']) expect(read(f).includes(Buffer.from(token)), `${f} has the token`).toBe(false);
    expect(read('matra.db-wal').length).toBe(0);
    // A second survivor verifies; then the buffered counts are flushed together in their own commit, and checkpointed.
    const s2 = await registerUser(app, 'survivor.private2', 'survivor', { phoneVerified: false });
    expect((await verifyPhone(app, s2, '(201) 555-0188')).status).toBe(200);
    flushPhoneTokens(app);
    const wal = read('matra.db-wal');
    for (const id of [s.user.id, s2.user.id]) expect(wal.includes(Buffer.from(id)), 'WAL has a user id next to the tokens').toBe(false);
    expect(wal.includes(Buffer.from(token))).toBe(false);
    expect(read('matra.db').includes(Buffer.from(token))).toBe(true);
    const cols = (db.pragma('table_info(phone_tokens)') as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toEqual(['token_hash', 'accounts']);
    expect((db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'phone_tokens'`).get() as { sql: string }).sql).toMatch(/WITHOUT ROWID/);
    expect(db.prepare('SELECT token_hash FROM phone_tokens ORDER BY token_hash').all()).toEqual(
      [token, phoneToken(hashKey, '+12015550188')].sort().map((token_hash) => ({ token_hash })),
    );
    expect(db.prepare('SELECT matching_verified FROM users WHERE id = ?').get(s.user.id)).toEqual({ matching_verified: 1 });
    db.pragma('wal_checkpoint(TRUNCATE)');
    const bytes = Buffer.concat(fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f))));
    for (const needle of ['2015550187', '201) 555-0187', '555-0187', '5550187', `"${code}"`])
      expect(bytes.includes(Buffer.from(needle)), `DB contains ${needle}`).toBe(false);
    const all = logs.join('\n');
    expect(all).toMatch(/POST \/api\/matching\/verification\/check 200/); // the log ran
    expect(all).not.toContain('0187');
    expect(all).not.toContain(code);
  });

  it('the mock dev outbox masks the number', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => void lines.push(a.join(' ')));
    const m = new MockSmsVerifier({ log: true });
    const { demoCode } = await m.start('+12015550100');
    expect(lines).toEqual([`[matra] DEV SMS to +1•••0100: code ${demoCode}`]);
    expect(await m.check('nope', '+12015550100', demoCode!)).toBe('expired');
  });

  it('migration v7 grandfathers accounts that already have sealed entries', async () => {
    const file = path.join(tmp(), 'old.db');
    const { app } = makeApp({ dbPath: file });
    await registerUser(app, 'loc.mig', 'counselor');
    const sealed = await registerUser(app, 'survivor.sealed');
    const fresh = await registerUser(app, 'survivor.fresh', 'survivor', { phoneVerified: false });
    await sealMatch(app, sealed, 'email', 'person@example.com');
    // turn it back into a v6 database: no phone_tokens, no matching_verified
    const db = getDb(app);
    db.exec('DROP TABLE phone_tokens; ALTER TABLE users DROP COLUMN matching_verified;');
    // (and undo the later migrations, which run again after v7)
    db.exec(
      'ALTER TABLE match_entries DROP COLUMN routing_envelope; ALTER TABLE match_entries DROP COLUMN matcher_synced; DROP TABLE match_assignments; DROP TABLE matcher_pending_deletes;',
    );
    db.pragma('user_version = 6');
    db.close();
    const db2 = openDb(file);
    expect(db2.pragma('user_version', { simple: true })).toBe(8);
    const row = (id: string) => db2.prepare('SELECT matching_verified FROM users WHERE id = ?').get(id);
    expect(row(sealed.user.id)).toEqual({ matching_verified: 1 });
    expect(row(fresh.user.id)).toEqual({ matching_verified: 0 });
    db2.close();
  });
});

describe('provider configuration', () => {
  it('production refuses the mock SMS provider unless MATRA_DEMO_MODE=1', () => {
    expect(() => loadSmsVerifier({ NODE_ENV: 'production', MATRA_SMS_PROVIDER: 'mock' })).toThrow(/mock\/simulated provider and cannot run in production/);
    expect(() => assertMockAllowed('X', { NODE_ENV: 'production' })).toThrow(/MATRA_DEMO_MODE=1/);
    expect(loadSmsVerifier({ NODE_ENV: 'production', MATRA_SMS_PROVIDER: 'mock', MATRA_DEMO_MODE: '1' }).name).toBe('mock');
    // production defaults to twilio, which needs its credentials
    expect(() => loadSmsVerifier({ NODE_ENV: 'production' })).toThrow(/TWILIO_ACCOUNT_SID/);
    expect(loadSmsVerifier({ NODE_ENV: 'production', TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 't', TWILIO_VERIFY_SERVICE_SID: 'VA' }).name).toBe('twilio');
    expect(() => loadSmsVerifier({ MATRA_SMS_PROVIDER: 'carrier-pigeon' })).toThrow(/mock" or "twilio/);
  });

  it('production needs MATRA_PHONE_HASH_KEY (outside the DB dir), refuses turning verification off, and never exposes demo codes without demo mode', () => {
    const dir = tmp();
    const base = { NODE_ENV: 'production', MATRA_DB_PATH: path.join(dir, 'matra.db'), MATRA_SMS_PROVIDER: 'mock', MATRA_DEMO_MODE: '1' };
    expect(() => loadPhoneVerification(base)).toThrow(/MATRA_PHONE_HASH_KEY .*must be set in production/);
    const inside = path.join(dir, 'phone.key');
    fs.writeFileSync(inside, 'ab'.repeat(32));
    expect(() => loadPhoneVerification({ ...base, MATRA_PHONE_HASH_KEY_FILE: inside })).toThrow(/outside the database directory/);
    const key = 'cd'.repeat(32);
    const ok = loadPhoneVerification({ ...base, MATRA_PHONE_HASH_KEY: key });
    expect(ok).toMatchObject({ required: true, maxAccountsPerPhone: 2, exposeDemoCode: true });
    expect(() => loadPhoneVerification({ ...base, MATRA_PHONE_HASH_KEY: key, MATRA_REQUIRE_PHONE_VERIFICATION: '0' })).toThrow(/refused in production/);
    const twilio = loadPhoneVerification({
      NODE_ENV: 'production',
      MATRA_DB_PATH: base.MATRA_DB_PATH,
      MATRA_PHONE_HASH_KEY: key,
      TWILIO_ACCOUNT_SID: 'AC',
      TWILIO_AUTH_TOKEN: 't',
      TWILIO_VERIFY_SERVICE_SID: 'VA',
      MATRA_SMS_MAX_ACCOUNTS_PER_PHONE: '3',
    });
    expect(twilio).toMatchObject({ exposeDemoCode: false, maxAccountsPerPhone: 3 });
    expect(() => loadPhoneVerification({ ...base, MATRA_PHONE_HASH_KEY: key, MATRA_SMS_MAX_ACCOUNTS_PER_PHONE: '0' })).toThrow(/positive integer/);
    // send caps and the country allowlist (SMS pumping): defaults, overrides, and refusals
    expect(ok).toMatchObject({ allowedCountryCodes: ['1'], sendLimits: { perIpPerHour: 10, globalPerHour: 200, globalPerDay: 1000, perAccountPerDay: 5 } });
    const tuned = loadPhoneVerification({
      ...base,
      MATRA_PHONE_HASH_KEY: key,
      MATRA_SMS_ALLOWED_COUNTRY_CODES: '1, +44',
      MATRA_SMS_MAX_PER_IP_PER_HOUR: '4',
      MATRA_SMS_MAX_PER_HOUR: '50',
      MATRA_SMS_MAX_PER_DAY: '300',
    });
    expect(tuned).toMatchObject({ allowedCountryCodes: ['1', '44'], sendLimits: { perIpPerHour: 4, globalPerHour: 50, globalPerDay: 300 } });
    expect(() => loadPhoneVerification({ ...base, MATRA_PHONE_HASH_KEY: key, MATRA_SMS_ALLOWED_COUNTRY_CODES: '1,*' })).toThrow(/country calling codes/);
    expect(() => loadPhoneVerification({ ...base, MATRA_PHONE_HASH_KEY: key, MATRA_SMS_MAX_PER_DAY: '-1' })).toThrow(/MATRA_SMS_MAX_PER_DAY must be a positive integer/);
  });
});

describe('Twilio Verify adapter (stubbed fetch; never run against the real service)', () => {
  const stub = (responses: Array<[number, unknown]>) => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const [status, body] = responses.shift()!;
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    const v: SmsVerifier = new TwilioVerifySmsVerifier({ accountSid: 'AC123', authToken: 'secret', verifyServiceSid: 'VA456', fetchImpl });
    return { v, calls };
  };

  it('looks up the line type, then starts a Verify SMS with Basic auth and form fields', async () => {
    const { v, calls } = stub([
      [200, { line_type_intelligence: { type: 'mobile' } }],
      [201, { sid: 'VE789', status: 'pending' }],
    ]);
    expect(await v.start('+12015550100')).toEqual({ providerRef: 'VE789' });
    expect(calls[0]!.url).toBe('https://lookups.twilio.com/v2/PhoneNumbers/%2B12015550100?Fields=line_type_intelligence');
    expect(calls[0]!.init.method).toBe('GET');
    expect(calls[1]!.url).toBe('https://verify.twilio.com/v2/Services/VA456/Verifications');
    expect(calls[1]!.init.method).toBe('POST');
    const h = calls[1]!.init.headers as Record<string, string>;
    expect(h.Authorization).toBe(`Basic ${Buffer.from('AC123:secret').toString('base64')}`);
    expect(h['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(calls[1]!.init.body as string))).toEqual({ To: '+12015550100', Channel: 'sms' });
  });

  it('refuses VoIP numbers before sending anything', async () => {
    for (const type of ['nonFixedVoip', 'fixedVoip']) {
      const { v, calls } = stub([[200, { line_type_intelligence: { type } }]]);
      await expect(v.start('+12015550100')).rejects.toMatchObject({ code: 'phone_not_supported' });
      expect(calls).toHaveLength(1);
    }
  });

  it('fails closed: no line type (add-on off, lookup error, no coverage) or anything but mobile gets no code', async () => {
    const warns: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...a) => void warns.push(a.join(' ')));
    const unchecked = [null, undefined, { type: null, error_code: 60600 }, { type: 'mobile', error_code: 60601 }, {}];
    for (const lti of unchecked) {
      const { v, calls } = stub([[200, lti === undefined ? {} : { line_type_intelligence: lti }]]);
      await expect(v.start('+12015550100')).rejects.toMatchObject({ code: 'sms_unavailable' });
      expect(calls).toHaveLength(1);
    }
    expect(warns.length).toBeGreaterThan(0);
    expect(warns[0]).toMatch(/line type intelligence add-on/);
    for (const type of ['unknown', 'landline', 'personal', 'tollFree', 'premium', 'pager', 'voicemail', 'sharedCost', 'uan']) {
      const { v, calls } = stub([[200, { line_type_intelligence: { type, error_code: null } }]]);
      await expect(v.start('+12015550100')).rejects.toMatchObject({ code: 'phone_not_supported' });
      expect(calls).toHaveLength(1);
    }
  });

  it('warns about a missing line type only once per process', async () => {
    const warns: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...a) => void warns.push(a.join(' ')));
    const { v } = stub([
      [200, { line_type_intelligence: null }],
      [200, { line_type_intelligence: null }],
    ]);
    await expect(v.start('+12015550100')).rejects.toMatchObject({ code: 'sms_unavailable' });
    await expect(v.start('+12015550100')).rejects.toMatchObject({ code: 'sms_unavailable' });
    expect(warns).toHaveLength(1);
  });

  it('VoIP lookup can be turned off; checks map Twilio statuses', async () => {
    const calls: string[] = [];
    const responses: Array<[number, unknown]> = [
      [201, { sid: 'VE1' }],
      [200, { status: 'pending' }],
      [200, { status: 'approved' }],
      [404, { code: 20404 }],
      [200, { status: 'canceled' }],
    ];
    const v = new TwilioVerifySmsVerifier({
      accountSid: 'AC',
      authToken: 't',
      verifyServiceSid: 'VA',
      rejectVoip: false,
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push(`${init.method} ${url} ${init.body ?? ''}`);
        const [status, body] = responses.shift()!;
        return new Response(JSON.stringify(body), { status });
      }) as unknown as typeof fetch,
    });
    expect((await v.start('+12015550100')).providerRef).toBe('VE1');
    expect(await v.check('VE1', '+12015550100', '123456')).toBe('wrong_code');
    expect(await v.check('VE1', '+12015550100', '123456')).toBe('approved');
    expect(await v.check('VE1', '+12015550100', '123456')).toBe('expired');
    expect(await v.check('VE1', '+12015550100', '123456')).toBe('expired');
    expect(calls[0]).toMatch(/^POST https:\/\/verify\.twilio\.com\/v2\/Services\/VA\/Verifications /);
    expect(calls[1]).toBe('POST https://verify.twilio.com/v2/Services/VA/VerificationCheck VerificationSid=VE1&Code=123456');
  });

  it('a network failure is sms_unavailable', async () => {
    const v = new TwilioVerifySmsVerifier({
      accountSid: 'AC',
      authToken: 't',
      verifyServiceSid: 'VA',
      fetchImpl: (async () => {
        throw new Error('ECONNRESET');
      }) as unknown as typeof fetch,
    });
    await expect(v.start('+12015550100')).rejects.toMatchObject({ code: 'sms_unavailable' });
  });
});
