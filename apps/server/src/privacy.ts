/**
 * Metadata minimization (W11; docs/PRIVACY_DATA_INVENTORY.md).
 *
 * The services (app server, OPRF key holders, matcher) never write a client's IP address or user agent anywhere: not
 * to the database, the ledger, or a log line. The one thing an IP is used for is per-client rate limiting, and there it
 * is replaced at once by a keyed hash:
 *
 *   ClientKeyer.key(req) = base64url(HMAC-SHA256(salt_day, "matra/client/v1|" + ip))
 *
 * salt_day is 32 random bytes generated in memory for the current UTC day. It is never written anywhere. At midnight
 * UTC a timer zero-fills and drops it and empties every limiter created through ClientKeyer.limiter, whether or not a
 * request arrives (an idle process does not keep yesterday's salt next to yesterday's keys: with both, an IPv4 address
 * could be confirmed by trying all 2^32). The next request generates a fresh salt. So no per-client key outlives the
 * UTC day it was made in (or the process), and keys from different days cannot be linked. Limiter windows are at most
 * 24 h (auth.ts RateLimiter).
 * Cost: a per-IP window that straddles midnight UTC starts again from zero; per-IP limits are a speed bump, not a
 * security boundary (the per-account and global limits are what bound SMS spend and OPRF guessing).
 *
 * The reverse proxy in front of the server (Render / Fly / the confidential-computing host) has its own access logs;
 * docs/DEPLOY.md says to turn IP logging off there, which this code cannot enforce.
 */
import { createHmac, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { RateLimiter } from './auth.js';

// The request logger is shared with the matcher (one implementation, one rule): @matra/shared request-log.ts.
export { errorMessageForLog, logRequests, requestLogLine } from '@matra/shared';

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY_MS = 86_400_000;
/** ms from `ms` until the next 00:00:00.000 UTC (always > 0). */
export const msUntilUtcMidnight = (ms: number) => DAY_MS - (((ms % DAY_MS) + DAY_MS) % DAY_MS);

export class ClientKeyer {
  private day = '';
  private salt = Buffer.alloc(0);
  private readonly limiters: RateLimiter[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** `now` is the clock for day boundaries; the midnight timer uses real timers (fake ones in tests). */
  constructor(private readonly now: () => number = Date.now) {
    this.arm();
  }

  /** Schedule forget() for the next UTC midnight, then again every midnight after. Unref'd: never keeps a process up. */
  private arm(): void {
    this.timer = setTimeout(() => {
      this.forget();
      this.arm();
    }, msUntilUtcMidnight(this.now()) + 1);
    this.timer.unref?.();
  }

  /** Zero-fill and drop the salt and empty this keyer's limiters (at midnight UTC; also on stop). */
  forget(): void {
    this.salt.fill(0);
    this.salt = Buffer.alloc(0);
    this.day = '';
    for (const l of this.limiters) l.clear();
  }

  /** Cancel the midnight timer and forget everything (shutdown, tests). */
  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.forget();
  }

  /** Whether a salt is currently held (tests). */
  get hasSalt(): boolean {
    return this.salt.length > 0;
  }

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
