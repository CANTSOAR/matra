/**
 * The only request log line any Matra service writes (W11; docs/PRIVACY_DATA_INVENTORY.md §3): method, the matched
 * ROUTE PATTERN (never the URL, so no ids, usernames, tags, nonces or query strings), status and duration. No IP, no
 * user agent, no referrer, no account, no body. Shared by the app server, the OPRF key holders and the matcher.
 *
 * Typed structurally (no express import) so this package stays free of server dependencies.
 */
export interface LoggableRequest {
  method: string;
  route?: { path?: unknown };
}
export interface LoggableResponse {
  statusCode: number;
  on(event: 'finish', listener: () => void): unknown;
}

export function requestLogLine(prefix: string, req: LoggableRequest, res: Pick<LoggableResponse, 'statusCode'>, ms: number): string {
  const route = typeof req.route?.path === 'string' ? req.route.path : '(unmatched)';
  return `${prefix ? `${prefix} ` : ''}${req.method} ${route} ${res.statusCode} ${ms}ms`;
}

/** Express-compatible middleware that logs requestLogLine for every request once its response is sent. */
export function logRequests(prefix: string, log: (line: string) => void = (line) => console.log(line)) {
  return (req: LoggableRequest, res: LoggableResponse, next: () => void) => {
    const t0 = Date.now();
    res.on('finish', () => log(requestLogLine(prefix, req, res, Date.now() - t0)));
    next();
  };
}

/** What an error handler may log about a thrown value: its message if it has a string one, never the object itself
 *  (which can carry the request, its body or headers). */
export function errorMessageForLog(err: unknown): string {
  const m = (err as { message?: unknown } | null | undefined)?.message;
  return typeof m === 'string' ? m : 'unknown';
}
