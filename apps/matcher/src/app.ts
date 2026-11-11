/**
 * The matcher's HTTP API (src/server.ts runs it; tests import createMatcherApp). Only the app server talks to it,
 * with a bearer token (MATRA_MATCHER_TOKEN, compared in constant time); the attestation and health endpoints are
 * public, so a survivor's client can fetch the attestation through the app server's proxy.
 *
 *   GET    /v1/attestation?nonce=<64 hex>   → AttestationDocument
 *   GET    /v1/health                        → { ok, measurement, platform, unassigned }
 *   PUT    /v1/roster   { roster?, verifiedIds, counselors? }                         → { ok, counselors }
 *   POST   /v1/entries  { entryId, tag, survivorRef, createdAt, accountCreatedAt, routing } → { ok: true }
 *                       (idempotent; the same answer whether or not the entry completes a group)
 *   DELETE /v1/entries/:entryId                                                       → { ok: true }
 *   GET    /v1/assignments                   → { assignments: MatcherAssignment[] }
 *   POST   /v1/assignments/:tag/decline { counselorId }                              → { ok: true } (reassigns)
 *
 * Logs `METHOD <route pattern> status ms` only: never ids, tags, bodies, tokens, IPs or query strings.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AttestationProvider } from './attestation.js';
import { MatcherError, type Matcher } from './matcher.js';

export interface MatcherAppOptions {
  matcher: Matcher;
  attester: AttestationProvider;
  /** bearer token shared with the app server */
  token: string;
  logRequests?: boolean;
}

const digest = (s: string) => createHash('sha256').update(s).digest();

export function createMatcherApp(o: MatcherAppOptions): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.use((_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
    next();
  });
  if (o.logRequests)
    app.use((req, res, next) => {
      const t0 = Date.now();
      res.on('finish', () => console.log(`[matcher] ${req.method} ${req.route?.path ?? '(unmatched)'} ${res.statusCode} ${Date.now() - t0}ms`));
      next();
    });
  app.use(express.json({ limit: '64kb' }));

  const want = digest(o.token);
  const requireToken = (req: Request, _res: Response, next: NextFunction) => {
    const h = req.get('authorization') ?? '';
    const got = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!got || !timingSafeEqual(digest(got), want)) throw new MatcherError(401, 'unauthorized', 'Unauthorized');
    next();
  };

  app.get('/v1/attestation', async (req, res) => {
    const nonce = typeof req.query.nonce === 'string' ? req.query.nonce : '';
    if (!/^[0-9a-f]{64}$/.test(nonce)) throw new MatcherError(400, 'invalid_request', 'nonce must be 64 hex chars');
    res.json(await o.attester.attest(nonce));
  });
  app.get('/v1/health', (_req, res) => {
    res.json({ ok: true, measurement: o.attester.measurement, platform: o.attester.platform, unassigned: o.matcher.unassignedCount() });
  });
  app.put('/v1/roster', requireToken, (req, res) => {
    res.json(o.matcher.putRoster(req.body ?? {}));
  });
  app.post('/v1/entries', requireToken, async (req, res) => {
    const b = req.body ?? {};
    await o.matcher.upsertEntry({
      entryId: b.entryId,
      tag: b.tag,
      survivorRef: b.survivorRef,
      createdAt: b.createdAt,
      accountCreatedAt: b.accountCreatedAt,
      routing: b.routing ?? null,
    });
    res.json({ ok: true });
  });
  app.delete('/v1/entries/:entryId', requireToken, (req, res) => {
    res.json(o.matcher.removeEntry(String(req.params.entryId)));
  });
  app.get('/v1/assignments', requireToken, (_req, res) => {
    res.json({ assignments: o.matcher.assignments() });
  });
  app.post('/v1/assignments/:tag/decline', requireToken, (req, res) => {
    const counselorId = req.body?.counselorId;
    if (typeof counselorId !== 'string' || !counselorId) throw new MatcherError(400, 'invalid_request', 'counselorId');
    res.json(o.matcher.decline(String(req.params.tag), counselorId));
  });
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found', code: 'not_found' });
  });
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof MatcherError) return res.status(err.status).json({ error: err.message, code: err.code });
    const e = err as { status?: number; message?: string; type?: string };
    if (typeof e?.status === 'number' && e.status >= 400 && e.status < 500) return res.status(e.status).json({ error: 'Bad request', code: 'invalid_request' });
    console.error('[matcher] internal error:', e?.message ?? err);
    res.status(500).json({ error: 'Internal error', code: 'internal' });
  });
  return app;
}
