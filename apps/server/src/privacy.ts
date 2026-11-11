/**
 * Metadata minimization (W11; docs/PRIVACY_DATA_INVENTORY.md).
 *
 * The services (app server, OPRF key holders, matcher) never write a client's IP address or user agent anywhere: not
 * to the database, the ledger, or a log line. The one thing an IP is used for is per-client rate limiting, and there it
 * is replaced at once by a keyed hash:
 *
 *   ClientKeyer.key(req) = base64url(HMAC-SHA256(salt_day, "matra/client/v1|" + ip))
 *
 * salt_day is 32 random bytes generated in memory for the current UTC day and replaced (the old one dropped) at the
 * first request after midnight UTC. It is never written anywhere, so a key cannot be recomputed from a guessed IP once
 * the day is over (or the process restarts), and keys from different days cannot be linked. The limiters that hold these
 * keys are in memory only, with windows of at most 24 h (auth.ts RateLimiter), and the ones created through
 * ClientKeyer.limiter are cleared when the salt rotates, so no per-client entry survives past midnight UTC. (Both are
 * checked on use: an idle process may keep a few expired entries until its next request, under a salt that is gone.)
 * Cost: a per-IP window that straddles midnight UTC starts again from zero; per-IP limits are a speed bump, not a
 * security boundary (the per-account and global limits are what bound SMS spend and OPRF guessing).
 *
 * The reverse proxy in front of the server (Render / Fly / the confidential-computing host) has its own access logs;
 * docs/DEPLOY.md says to turn IP logging off there, which this code cannot enforce.
 */
import { createHmac, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { RateLimiter } from './auth.js';

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export class ClientKeyer {
  private day = '';
  private salt = Buffer.alloc(0);
  private readonly limiters: RateLimiter[] = [];
  constructor(private readonly now: () => number = Date.now) {}

  /** A per-client RateLimiter (keys from this keyer) that is emptied whenever the daily salt rotates. */
  limiter(max: number, windowMs: number): RateLimiter {
    const l = new RateLimiter(max, windowMs, this.now);
    this.limiters.push(l);
    return l;
  }

  /** A keyed hash of the client's address (as Express resolves it under `trust proxy`), valid for today only. */
  key(req: Request): string {
    return this.keyFor(req.ip ?? req.socket.remoteAddress ?? 'unknown');
  }

  /** Same, from an address string (tests). */
  keyFor(address: string): string {
    const today = utcDay(this.now());
    if (today !== this.day) {
      this.salt.fill(0);
      this.salt = randomBytes(32);
      this.day = today;
      for (const l of this.limiters) l.clear();
    }
    return createHmac('sha256', this.salt).update(`matra/client/v1|${address}`).digest('base64url');
  }
}

/**
 * The only request log line any Matra service writes: method, the matched ROUTE PATTERN (never the URL, so no ids,
 * usernames, nonces or query strings), status and duration. No IP, no user agent, no referrer, no account, no body.
 */
export function requestLogLine(prefix: string, req: Request, res: Response, ms: number): string {
  const route = (req.route?.path as string | undefined) ?? '(unmatched)';
  return `${prefix ? `${prefix} ` : ''}${req.method} ${route} ${res.statusCode} ${ms}ms`;
}

/** Express middleware that logs requestLogLine for every request once its response is sent. */
export function logRequests(prefix: string, log: (line: string) => void = (line) => console.log(line)) {
  return (req: Request, res: Response, next: () => void) => {
    const t0 = Date.now();
    res.on('finish', () => log(requestLogLine(prefix, req, res, Date.now() - t0)));
    next();
  };
}
