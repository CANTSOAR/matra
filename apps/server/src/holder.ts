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
 * that `aud` is its own index, expiry, replay, and that the token is bound to this request's blinded element. It trusts
 * the app server's statement that the subject is an eligible survivor — it cannot check that itself, so whoever holds
 * the app server's token key can query it under fresh subjects without any per-subject limit (docs/threat-model.md W14).
 *
 * What this holder CAN do about that is make it visible and bounded: a global budget of `dailyBudget` evaluations per
 * UTC day across all subjects (MATRA_HOLDER_DAILY_BUDGET, default 1000). It warns in its log at 80% and when the
 * budget is spent, and then refuses further evaluations that day (503 holder_budget_exhausted; the app server treats
 * it as this holder being unavailable). Every day's total (evaluations served, evaluations refused for the budget) is
 * kept in an append-only table, `daily_totals`, that SQLite triggers stop anyone deleting or lowering through this
 * process: a record the institution running the holder can compare with the volume it expects. (The budget is also a
 * denial-of-service lever for whoever can mint tokens: spending it blocks honest sealing at this holder for the day.)
 *
 * createHolderApp is exported for tests; the process entrypoint is src/holder-server.ts.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import type { OprfKeyPair } from '@matra/crypto';
import { openHolderDb, type DB } from './db.js';
import { HOLDER_TOKEN_HEADER, HolderTokenVerifier, holderTokenPublicKey } from './holders.js';
import { DEFAULT_OPRF_LIMITS, OprfKeyHolder, SqliteQuotaStore, type OprfLimits } from './oprf.js';
import { errorMessageForLog, logRequests } from './privacy.js';
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
  /** global evaluations per UTC day across all subjects (default DEFAULT_HOLDER_DAILY_BUDGET) */
  dailyBudget?: number;
}

export const DEFAULT_HOLDER_DAILY_BUDGET = 1000;

/** The holder's global daily budget over its append-only `daily_totals` table (see the file comment). */
export class HolderDailyTotals {
  private readonly getQ;
  private readonly servedQ;
  private readonly refusedQ;
  private warned = '';
  constructor(
    db: DB,
    readonly budget: number,
    private readonly index: number,
  ) {
    if (!Number.isInteger(budget) || budget < 1) throw new Error(`holder daily budget must be a positive integer (got ${budget})`);
    this.getQ = db.prepare('SELECT evaluations FROM daily_totals WHERE day = ?');
    this.servedQ = db.prepare(
      'INSERT INTO daily_totals (day, evaluations, refused) VALUES (?, 1, 0) ON CONFLICT (day) DO UPDATE SET evaluations = evaluations + 1',
    );
    this.refusedQ = db.prepare(
      'INSERT INTO daily_totals (day, evaluations, refused) VALUES (?, 0, 1) ON CONFLICT (day) DO UPDATE SET refused = refused + 1',
    );
  }
  private static today = () => new Date().toISOString().slice(0, 10);
  /** False (and the refusal counted) once today's budget is spent. */
  allow(): boolean {
    const day = HolderDailyTotals.today();
    const n = (this.getQ.get(day) as { evaluations: number } | undefined)?.evaluations ?? 0;
    if (n < this.budget) return true;
    this.refusedQ.run(day);
    if (this.warned !== `${day}:full`) {
      this.warned = `${day}:full`;
      console.warn(`[holder ${this.index}] ALERT: daily evaluation budget (${this.budget}) spent for ${day}; refusing evaluations until the next UTC day.`);
    }
    return false;
  }
  served(): void {
    const day = HolderDailyTotals.today();
    this.servedQ.run(day);
    const n = (this.getQ.get(day) as { evaluations: number }).evaluations;
    if (n >= Math.ceil(this.budget * 0.8) && this.warned !== `${day}:80` && this.warned !== `${day}:full`) {
      this.warned = `${day}:80`;
      console.warn(`[holder ${this.index}] ALERT: ${n} evaluations today, 80% of the daily budget (${this.budget}).`);
    }
  }
}

export function createHolderApp(opts: HolderAppOptions): express.Express {
  const db: DB = openHolderDb(opts.dbPath);
  const holder = new OprfKeyHolder(opts.index, opts.share, new SqliteQuotaStore(db), { ...DEFAULT_OPRF_LIMITS, ...opts.limits });
  const tokens = new HolderTokenVerifier(holderTokenPublicKey(opts.tokenPublicKey), opts.index);
  const totals = new HolderDailyTotals(db, opts.dailyBudget ?? DEFAULT_HOLDER_DAILY_BUDGET, opts.index);

  const app = express();
  app.locals.db = db;
  app.disable('x-powered-by');
  app.set('etag', false);
  app.use((_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
    next();
  });
  // route pattern only: never ids, tokens, query strings, bodies, IPs or user agents (privacy.ts)
  if (opts.logRequests) app.use(logRequests(`[holder ${opts.index}]`));
  app.use(express.json({ limit: '4kb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/key', (_req, res) => {
    res.json({ index: holder.index, publicKey: holder.publicKey });
  });
  app.post('/evaluate', (req, res) => {
    // the token is bound to the blinded element in the body (bh), so check it against whatever string was sent
    const raw = typeof req.body?.blinded === 'string' ? (req.body.blinded as string) : '';
    const tok = tokens.verify(req.get(HOLDER_TOKEN_HEADER), raw);
    if (!tok) return void res.status(401).json({ error: 'Unauthorized', code: 'unauthorized' });
    const parsed = S.oprfEvaluateRequest.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: 'Invalid request', code: 'invalid_request' });
    if (!totals.allow()) return void res.status(503).json({ error: 'Daily evaluation budget spent', code: 'holder_budget_exhausted' });
    const r = holder.evaluate(tok.sub, parsed.data.blinded);
    if (r.ok) {
      totals.served();
      return void res.json(r.response);
    }
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
    console.error(`[holder ${opts.index}] internal error:`, errorMessageForLog(e));
    res.status(500).json({ error: 'Internal server error', code: 'internal' });
  });
  return app;
}
