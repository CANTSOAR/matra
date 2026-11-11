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
import { createApp, getDb } from './app.js';
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
    const events = (await request(app).get('/api/audit').set(s.auth)).body.events as Array<{ detail: string }>;
    expect(events.some((e) => e.detail === 'You confirmed a phone number for sealed matching. The number itself was not kept.')).toBe(true);
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
    // one token for all three spellings, counting the two accounts it enabled
    expect(db.prepare('SELECT accounts FROM phone_tokens').all()).toEqual([{ accounts: 2 }]);
    // a different phone works for the third account
    expect((await verifyPhone(app, c!, '(201) 555-0111')).status).toBe(200);
    // verifying again from an already verified account does not use up another slot
    expect((await verifyPhone(app, a!, '(201) 555-0111')).status).toBe(200);
    expect(db.prepare('SELECT accounts FROM phone_tokens ORDER BY accounts').all()).toEqual([{ accounts: 1 }, { accounts: 2 }]);
  });

  it('the limit is configurable', async () => {
    const { app } = makeApp({ matching: { phone: { maxAccountsPerPhone: 1 } } });
    const a = await registerUser(app, 'survivor.one1', 'survivor', { phoneVerified: false });
    const b = await registerUser(app, 'survivor.one2', 'survivor', { phoneVerified: false });
    expect((await verifyPhone(app, a)).status).toBe(200);
    expect((await verifyPhone(app, b)).body.code).toBe('phone_limit_reached');
  });

  it('rate-limits code requests: 3 per phone per hour, 5 per account per day', async () => {
    const { app } = makeApp();
    const s = await registerUser(app, 'survivor.spam', 'survivor', { phoneVerified: false });
    for (let i = 0; i < 3; i++) expect((await start(app, s.auth, '(201) 555-0100')).status).toBe(200);
    expect((await start(app, s.auth, '(201) 555-0100')).body.code).toBe('rate_limited');
    expect((await start(app, s.auth, '(201) 555-0122')).status).toBe(200);
    expect((await start(app, s.auth, '(201) 555-0133')).body.code).toBe('rate_limited'); // 6th of the day for this account
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
    const cols = (db.pragma('table_info(phone_tokens)') as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toEqual(['token_hash', 'accounts']);
    expect((db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'phone_tokens'`).get() as { sql: string }).sql).toMatch(/WITHOUT ROWID/);
    expect(db.prepare('SELECT token_hash FROM phone_tokens').all()).toEqual([{ token_hash: phoneToken(hashKey, '+12015550187') }]);
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
    db.pragma('user_version = 6');
    db.close();
    const db2 = openDb(file);
    expect(db2.pragma('user_version', { simple: true })).toBe(7);
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
