import { vi } from 'vitest';
import type { PublicUser, RegisterRequest } from '@matra/shared';

/** Minimal in-memory auth server for session tests (fetch mock). */
export function fakeAuthFetch() {
  const users = new Map<string, RegisterRequest>();
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const toUser = (r: RegisterRequest): PublicUser => ({
    id: `u-${r.username}`,
    username: r.username,
    role: r.role,
    publicKey: r.publicKey,
    wrappedPrivateKey: r.wrappedPrivateKey,
    createdAt: new Date(0).toISOString(),
  });
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://x');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    switch (`${init?.method ?? 'GET'} ${url.pathname}`) {
      case 'POST /api/auth/register': {
        users.set(body.username, body);
        return json(200, { token: 'tok-1', user: toUser(body) });
      }
      case 'GET /api/auth/prelogin': {
        const u = users.get(url.searchParams.get('username') ?? '');
        return json(200, { kdfSalt: u?.kdfSalt ?? 'AAAAAAAAAAAAAAAAAAAAAA==', kdfIterations: u?.kdfIterations ?? 600000 });
      }
      case 'POST /api/auth/login': {
        const u = users.get(body.username);
        if (!u || u.authKey !== body.authKey) return json(401, { error: 'invalid credentials' });
        return json(200, { token: 'tok-2', user: toUser(u) });
      }
      case 'POST /api/auth/logout':
        return json(200, { ok: true });
      case 'GET /api/me':
        return json(200, { user: toUser(users.values().next().value!) });
      default:
        return json(404, { error: 'not found' });
    }
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, users };
}
