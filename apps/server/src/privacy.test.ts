/**
 * Metadata minimization (W11; src/privacy.ts, docs/PRIVACY_DATA_INVENTORY.md): no client IP address or user agent
 * reaches the database, its WAL, or any log line; per-client rate limits key on a daily-salted HMAC held in memory.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { createApp, flushPhoneTokens, getDb } from './app.js';
import { MAX_RATE_LIMIT_WINDOW_MS, RateLimiter } from './auth.js';
import { ClientKeyer, requestLogLine } from './privacy.js';
import { TEST_PEPPER, createRecord, registerUser, sealMatch, syncMatcher, uploadBlob, verifyPhone } from './test-helpers.js';

afterEach(() => vi.restoreAllMocks());

describe('ClientKeyer: daily-salted keyed hash of the client address', () => {
  it('is stable within a UTC day, differs between addresses, and never contains the address', () => {
    const k = new ClientKeyer(() => Date.parse('2026-11-11T08:00:00Z'));
    const a = k.keyFor('203.0.113.77');
    expect(k.keyFor('203.0.113.77')).toBe(a);
    expect(k.keyFor('203.0.113.78')).not.toBe(a);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toContain('203');
  });

  it('rotates its salt at midnight UTC, so keys cannot be linked across days', () => {
    let now = Date.parse('2026-11-11T23:59:59Z');
    const k = new ClientKeyer(() => now);
    const before = k.keyFor('203.0.113.77');
    now = Date.parse('2026-11-12T00:00:01Z');
    const after = k.keyFor('203.0.113.77');
    expect(after).not.toBe(before);
    expect(k.keyFor('203.0.113.77')).toBe(after);
  });

  it('its limiters forget every entry when the salt rotates, and never hold the address', () => {
    let now = Date.parse('2026-11-11T23:59:00Z');
    const k = new ClientKeyer(() => now);
    const l = k.limiter(1, 3_600_000);
    expect(l.hit(k.keyFor('203.0.113.77'))).toBe(true);
    expect(l.hit(k.keyFor('203.0.113.77'))).toBe(false);
    expect(l.keys().join()).not.toContain('203.0.113.77');
    now = Date.parse('2026-11-12T00:00:30Z'); // inside the hour window, but a new UTC day
    expect(l.hit(k.keyFor('203.0.113.77'))).toBe(true);
    expect(l.keys()).toHaveLength(1);
  });

  it('two processes (or a restart) never share a salt', () => {
    const t = () => Date.parse('2026-11-11T08:00:00Z');
    expect(new ClientKeyer(t).keyFor('203.0.113.77')).not.toBe(new ClientKeyer(t).keyFor('203.0.113.77'));
  });
});

describe('RateLimiter retention', () => {
  it('refuses windows longer than 24 hours', () => {
    expect(() => new RateLimiter(1, MAX_RATE_LIMIT_WINDOW_MS + 1)).toThrow(/24 hours/);
    expect(() => new RateLimiter(1, 0)).toThrow();
    expect(() => new RateLimiter(1, MAX_RATE_LIMIT_WINDOW_MS)).not.toThrow();
  });

  it('drops expired entries on the next use (sweeps at least once a minute)', () => {
    let now = 0;
    const l = new RateLimiter(1, MAX_RATE_LIMIT_WINDOW_MS, () => now);
    expect(l.hit('client-a')).toBe(true);
    expect(l.hit('client-a')).toBe(false);
    now += MAX_RATE_LIMIT_WINDOW_MS; // a day later: client-a's entry has expired
    expect(l.hit('client-b')).toBe(true);
    expect(l.keys()).toEqual(['client-b']);
  });
});

describe('request log line', () => {
  it('is the route pattern, status and duration: never the URL, IP or user agent', () => {
    const req = { method: 'GET', route: { path: '/api/shares/:id' }, ip: '203.0.113.77', originalUrl: '/api/shares/abc?x=1', headers: { 'user-agent': 'UA' } };
    const line = requestLogLine('[matra]', req as unknown as express.Request, { statusCode: 200 } as express.Response, 3);
    expect(line).toBe('[matra] GET /api/shares/:id 200 3ms');
    expect(requestLogLine('', { method: 'GET' } as express.Request, { statusCode: 404 } as express.Response, 1)).toBe('GET (unmatched) 404 1ms');
  });
});

describe('no client IP or user agent on disk or in logs (W11)', () => {
  it('a full session behind a proxy leaves no trace of the IP or user agent in the DB files or log output', async () => {
    const IP = '203.0.113.77';
    const IP6 = '2001:db8::77';
    const UA = 'MatraLeakProbe/9.9 (privacy-test)';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matra-privacy-'));
    const dbPath = path.join(dir, 'matra.db');
    onTestFinished(() => fs.rmSync(dir, { recursive: true, force: true }));

    const logged: string[] = [];
    const capture = (...args: unknown[]) => void logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, m).mockImplementation(capture);

    const inner = createApp({ dbPath, pepper: TEST_PEPPER, trustProxy: 1, logRequests: true, matching: { releaseDelayHours: 0 } });
    // Every request arrives as if through one reverse proxy, alternately from IP and IP6, with a distinctive user agent.
    const seen: Array<string | undefined> = [];
    const app = Object.assign(
      (req: express.Request, res: express.Response) => {
        req.headers['x-forwarded-for'] = seen.length % 2 ? IP6 : IP;
        req.headers['user-agent'] = UA;
        req.headers.referer = `https://${IP}/from`;
        res.on('finish', () => seen.push(req.ip));
        inner(req, res);
      },
      { locals: inner.locals },
    ) as unknown as express.Express;

    // Sign-ups, a failed and a good sign-in, vault writes, a share, phone verification, sealed matching (a matched
    // group), the counselor's view, the audit trail, the attestation, errors (404, malformed JSON) and logout.
    await registerUser(app, 'loc.privacy', 'counselor');
    const atty = await registerUser(app, 'atty.privacy', 'attorney');
    const a = await registerUser(app, 'survivor.privacy.a', 'survivor', { phoneVerified: false });
    const b = await registerUser(app, 'survivor.privacy.b', 'survivor');
    const pre = await request(app).get('/api/auth/prelogin').query({ username: a.user.username });
    expect(pre.status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ username: a.user.username, authKey: Buffer.alloc(32, 7).toString('base64') })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ username: a.user.username, authKey: a.authKey })).status).toBe(200);
    expect((await createRecord(app, a)).res.status).toBe(201);
    expect((await uploadBlob(app, a)).res.status).toBe(201);
    expect((await verifyPhone(app, a)).status).toBe(200);
    flushPhoneTokens(inner);
    await sealMatch(app, a, 'email', 'same.person@example.com');
    await sealMatch(app, b, 'email', 'Same.Person@example.com');
    await syncMatcher(app);
    expect((await request(app).get('/api/attorneys').set(a.auth)).status).toBe(200);
    expect((await request(app).get('/api/audit').set(a.auth)).status).toBe(200);
    expect((await request(app).get('/api/audit').set(atty.auth)).status).toBe(200);
    expect((await request(app).get('/api/matching/attestation').query({ nonce: 'A'.repeat(43) })).status).toBeLessThan(500);
    expect((await request(app).get('/api/nope')).status).toBe(404);
    expect((await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send(`{"x": "${IP}"`)).status).toBe(400);
    expect((await request(app).post('/api/auth/logout').set(b.auth)).status).toBeLessThan(300);

    // The test is only meaningful if the server really saw IP as the client address.
    expect(seen.length).toBeGreaterThan(10);
    expect(new Set(seen)).toEqual(new Set([IP, IP6]));
    expect(logged.some((l) => /POST \/api\/auth\/login 401/.test(l))).toBe(true); // request logging was on

    const db = getDb(inner);
    expect(db.prepare('SELECT COUNT(*) n FROM match_groups').get()).toEqual({ n: 1 }); // the matching path really ran
    // The DB as SQL sees it, then every byte of the files on disk (main DB, WAL, shared memory), before and after close.
    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>).map((t) => t.name);
    const dump = tables.map((t) => JSON.stringify(db.prepare(`SELECT * FROM "${t}"`).all(), (_k, v) => (Buffer.isBuffer(v) ? v.toString('latin1') : v))).join('\n');
    const files = () => fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f)).toString('latin1')).join('\n');
    const needles = [IP, IP6, UA, 'MatraLeakProbe', '127.0.0.1', '::ffff:'];
    const onDiskOpen = files();
    db.close();
    const onDiskClosed = files();
    for (const n of needles) {
      expect(dump, `DB contents contain ${n}`).not.toContain(n);
      expect(onDiskOpen, `DB files contain ${n}`).not.toContain(n);
      expect(onDiskClosed, `DB files contain ${n}`).not.toContain(n);
      expect(logged.join('\n'), `log output contains ${n}`).not.toContain(n);
    }
  }, 60_000);
});
