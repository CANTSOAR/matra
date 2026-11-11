/**
 * A standalone OPRF key holder (threshold OPRF; see src/oprf.ts and src/holders.ts). Run one per institution:
 *
 *   MATRA_HOLDER_INDEX=2 MATRA_OPRF_SHARE_FILE=/secrets/oprf-share-2.key MATRA_HOLDER_TOKEN_PUBKEY=<base64> \
 *   MATRA_HOLDER_DB_PATH=/var/lib/matra-holder/quota.db PORT=4312 npm run -w @matra/server holder
 *
 * It holds ONE Shamir share k_i of the matching key and nothing else: no user ids (only the app server's pseudonymous
 * token subject), no identifiers (only blinded elements), no OPRF outputs (the client unblinds). Its database is a
 * quota table: per subject, today's count and a lifetime total.
 *
 *   GET  /key       → { index, publicKey }                 (share public key pk_i; clients pin it)
 *   POST /evaluate  { blinded } + X-Matra-Holder-Token    → { evaluated, proof }  (RFC 9497 BlindEvaluate under k_i)
 *   GET  /health    → { ok: true }
 *
 * The token is signed by the app server (MATRA_HOLDER_TOKEN_PUBKEY pins its key); this holder checks the signature,
 * that `aud` is its own index, expiry, and replay. It trusts the app server's statement that the subject is an
 * eligible survivor — it cannot check that itself (docs/threat-model.md W14).
 *
 * createHolderApp is exported for tests; the process entrypoint is src/holder-server.ts.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import type { OprfKeyPair } from '@matra/crypto';
import { openHolderDb, type DB } from './db.js';
import { HOLDER_TOKEN_HEADER, HolderTokenVerifier, holderTokenPublicKey } from './holders.js';
import { DEFAULT_OPRF_LIMITS, OprfKeyHolder, SqliteQuotaStore, type OprfLimits } from './oprf.js';
import * as S from './schemas.js';

export interface HolderAppOptions {
  index: number;
  share: OprfKeyPair;
  /** raw 32-byte Ed25519 public key of the app server's holder-token key */
  tokenPublicKey: Uint8Array;
  /** this holder's own SQLite file (quota counters only), or ':memory:' */
  dbPath: string;
  limits?: Partial<OprfLimits>;
  /** log `METHOD <route> status ms` (never bodies, tokens, IPs or query strings) */
  logRequests?: boolean;
}

export function createHolderApp(opts: HolderAppOptions): express.Express {
  const db: DB = openHolderDb(opts.dbPath);
  const holder = new OprfKeyHolder(opts.index, opts.share, new SqliteQuotaStore(db), { ...DEFAULT_OPRF_LIMITS, ...opts.limits });
  const tokens = new HolderTokenVerifier(holderTokenPublicKey(opts.tokenPublicKey), opts.index);

  const app = express();
  app.locals.db = db;
  app.disable('x-powered-by');
  app.set('etag', false);
  app.use((_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
    next();
  });
  if (opts.logRequests)
    app.use((req, res, next) => {
      const t0 = Date.now();
      // route pattern only: never ids, tokens, query strings or bodies
      res.on('finish', () => console.log(`[holder ${opts.index}] ${req.method} ${req.route?.path ?? '(unmatched)'} ${res.statusCode} ${Date.now() - t0}ms`));
      next();
    });
  app.use(express.json({ limit: '4kb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/key', (_req, res) => {
    res.json({ index: holder.index, publicKey: holder.publicKey });
  });
  app.post('/evaluate', (req, res) => {
    const tok = tokens.verify(req.get(HOLDER_TOKEN_HEADER));
    if (!tok) return void res.status(401).json({ error: 'Unauthorized', code: 'unauthorized' });
    const parsed = S.oprfEvaluateRequest.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: 'Invalid request', code: 'invalid_request' });
    const r = holder.evaluate(tok.sub, parsed.data.blinded);
    if (r.ok) return void res.json(r.response);
    if (r.code === 'invalid_element') return void res.status(400).json({ error: 'Not a valid group element', code: 'invalid_element' });
    res.status(429).json({ error: 'Rate limited', code: r.code });
  });
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found', code: 'not_found' });
  });
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const e = err as { type?: string; status?: number; message?: string };
    if (typeof e?.status === 'number' && e.status >= 400 && e.status < 500)
      return void res.status(e.status).json({ error: 'Bad request', code: 'invalid_request' });
    console.error(`[holder ${opts.index}] internal error:`, e?.message ?? 'unknown');
    res.status(500).json({ error: 'Internal server error', code: 'internal' });
  });
  return app;
}
