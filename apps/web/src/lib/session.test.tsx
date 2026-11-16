import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KDF_ITERATIONS, deriveRecoveryKeys, derivePassphraseKeys, generateRecoveryCode, legacyAccountSecret, wrapAccountSecret } from '@matra/crypto';
import type { PublicUser, RegisterRequest } from '@matra/shared';
import { fakeAuthFetch } from '../test/fakeServer';
import { Harness, current } from '../test/sessionHarness';
import { generatePassphrase } from './passphrase';
import { PassphraseMaybeChangedError, RecoveryMaybeFinishedError, checkKdfIterations, type RecoveryReset } from './session';

describe('session', () => {
  afterEach(() => vi.restoreAllMocks());

  it('registers, locks, logs back in — and never writes to web storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const local = vi.spyOn(window.localStorage, 'setItem');
    const sess = vi.spyOn(window.sessionStorage, 'setItem');
    const cookie = vi.spyOn(document, 'cookie', 'set');
    const idb = window.indexedDB ? vi.spyOn(window.indexedDB, 'open') : null;
    const { fetchImpl } = fakeAuthFetch();
    render(<Harness fetchImpl={fetchImpl} />);

    await act(async () => {
      await current!.register({ username: 'bluebird-42', passphrase: 'acorn-otter-river-lilac-tulip-zebra', role: 'survivor', ageConfirmed18: true });
    });
    expect(screen.getByTestId('state')).toHaveTextContent('in:bluebird-42');
    await act(async () => {
      await current!.setWorkingData({ draft: null, evidence: [] });
    });

    act(() => current!.lock('idle'));
    expect(screen.getByTestId('state')).toHaveTextContent('out');
    expect(current!.lockReason).toBe('idle');

    // wrong passphrase fails gracefully
    await act(async () => {
      await expect(current!.login('bluebird-42', 'wrong passphrase here')).rejects.toThrow(/don’t match|incorrect/);
    });

    await act(async () => {
      const s = await current!.login('bluebird-42', 'acorn-otter-river-lilac-tulip-zebra');
      expect(s.privateKey.type).toBe('private');
    });
    expect(screen.getByTestId('state')).toHaveTextContent('in:bluebird-42');

    for (const spy of [setItem, local, sess, cookie]) expect(spy).not.toHaveBeenCalled();
    if (idb) expect(idb).not.toHaveBeenCalled();
  }, 60_000);
});

describe('new passphrases (PR 7)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('an attorney or counselor account can only be made with the 7 words this device generated', async () => {
    const { fetchImpl } = fakeAuthFetch();
    render(<Harness fetchImpl={fetchImpl} />);
    const attorneyProfile = { displayName: 'A. Counsel', jurisdictions: ['NJ'], practiceAreas: [], acceptsProBono: true };
    for (const passphrase of ['my own very long and very strong passphrase here', generatePassphrase(6), generatePassphrase(7).replace(/-/g, ' ')])
      await act(async () => {
        await expect(current!.register({ username: 'counsel-1', passphrase, role: 'attorney', attorneyProfile })).rejects.toThrow(
          /use the 7 words made on this device/,
        );
      });
    expect(fetchImpl).not.toHaveBeenCalled();
    await act(async () => {
      await current!.register({ username: 'counsel-1', passphrase: generatePassphrase(7), role: 'attorney', attorneyProfile });
    });
    expect(screen.getByTestId('state')).toHaveTextContent('in:counsel-1');
  }, 60_000);

  it('a survivor’s own passphrase must pass the meter; nothing is sent otherwise', async () => {
    const { fetchImpl } = fakeAuthFetch();
    render(<Harness fetchImpl={fetchImpl} />);
    for (const passphrase of ['password password password password', 'a'.repeat(28), 'acorn-maple-violin-otter-quartz', 'wren-13 quiet harbor maple lantern seven'])
      await act(async () => {
        await expect(current!.register({ username: 'wren-13', passphrase, role: 'survivor', ageConfirmed18: true })).rejects.toThrow(/too easy to guess/);
      });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('a passphrase change whose answer is lost (B4 review M2)', () => {
  afterEach(() => vi.restoreAllMocks());
  const OLD = 'acorn-otter-river-lilac-tulip-zebra';
  const NEW = 'lemon-river-otter-lilac-cedar-tulip';

  /** The server commits the change, then the answer never arrives. `meFails`: /api/me can't be reached afterwards either. */
  function droppingServer({ meFails = false } = {}) {
    const base = fakeAuthFetch();
    let now: { kdfSalt: string; kdfIterations: number; authKey: string; wrappedAccountKey: unknown } | null = null;
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://x');
      const route = `${init?.method ?? 'GET'} ${url.pathname}`;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      const reg = base.users.get('wren-40');
      const authKey = now?.authKey ?? reg?.authKey;
      if (route === 'GET /api/auth/prelogin' && now) return json(200, { kdfSalt: now.kdfSalt, kdfIterations: now.kdfIterations });
      if (route === 'GET /api/me' && now) {
        if (meFails) throw new TypeError('Failed to fetch');
        const user = (await (await base.fetchImpl('/api/me')).json()).user as PublicUser;
        return json(200, { user: { ...user, keyVersion: 2, wrappedAccountKey: now.wrappedAccountKey } });
      }
      if (route === 'POST /api/account/passphrase') {
        if (body.authKey !== authKey) return json(401, { error: 'That passphrase is incorrect.', code: 'invalid_credentials' });
        now = { kdfSalt: body.kdfSalt, kdfIterations: body.kdfIterations, authKey: body.newAuthKey, wrappedAccountKey: body.wrappedAccountKey };
        throw new TypeError('Failed to fetch'); // saved, but the answer is lost
      }
      if (route === 'POST /api/auth/sessions/revoke-others') {
        if (body.authKey !== authKey) return json(401, { error: 'That passphrase is incorrect.', code: 'invalid_credentials' });
        return json(200, { endedSessions: 0 });
      }
      return base.fetchImpl(input, init);
    });
    return fetchImpl as unknown as typeof fetch;
  }

  it('asks the server again: the change was saved, so it is done, and the new passphrase works from this session', async () => {
    render(<Harness fetchImpl={droppingServer()} />);
    await act(async () => {
      await current!.register({ username: 'wren-40', passphrase: OLD, role: 'survivor', ageConfirmed18: true });
    });
    await act(async () => {
      await expect(current!.changePassphrase(OLD, NEW)).resolves.toEqual({ endedSessions: null });
    });
    expect(current!.session!.user.keyVersion).toBe(2);
    // never the cached wrap: the new passphrase is right, the old one is (truthfully) wrong
    await act(async () => {
      await expect(current!.signOutOtherSessions(NEW)).resolves.toEqual({ endedSessions: 0 });
      await expect(current!.signOutOtherSessions(OLD)).rejects.toThrow('That passphrase isn’t right. No one was signed out.');
    });
  }, 60_000);

  it('when it can’t be confirmed either way, says the new passphrase may already be active (never "nothing was changed")', async () => {
    render(<Harness fetchImpl={droppingServer({ meFails: true })} />);
    await act(async () => {
      await current!.register({ username: 'wren-40', passphrase: OLD, role: 'survivor', ageConfirmed18: true });
    });
    let err: unknown;
    await act(async () => {
      err = await current!.changePassphrase(OLD, NEW).catch((e: unknown) => e);
    });
    expect(err).toBeInstanceOf(PassphraseMaybeChangedError);
    expect((err as Error).message).toMatch(/Your new passphrase may already be active\. Try signing in with it/);
    expect((err as Error).message).not.toMatch(/Nothing was changed/);
  }, 60_000);
});

describe('her account is read fresh before re-authenticating', () => {
  it('saving a recovery code still updates this session (its user copy was refreshed from the server first)', async () => {
    const base = fakeAuthFetch();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input), 'http://x').pathname === '/api/account/recovery') {
        const user = (await (await base.fetchImpl('/api/me')).json()).user as PublicUser;
        return new Response(JSON.stringify({ user: { ...user, hasRecoveryCode: true } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return base.fetchImpl(input, init);
    });
    render(<Harness fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await act(async () => {
      await current!.register({ username: 'wren-41', passphrase: 'acorn-otter-river-lilac-tulip-zebra', role: 'survivor', ageConfirmed18: true });
    });
    await act(async () => {
      const pending = await current!.prepareRecoveryCode('acorn-otter-river-lilac-tulip-zebra');
      await pending.commit();
    });
    expect(current!.session!.user.hasRecoveryCode).toBe(true);
  }, 60_000);
});

describe('signed out elsewhere (PR 8)', () => {
  afterEach(() => vi.restoreAllMocks());

  function serverThatEnds() {
    const base = fakeAuthFetch();
    const state = { ended: false };
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), 'http://x').pathname;
      if (path === '/api/auth/sessions' && state.ended) return json(401, { error: 'Session invalid or expired', code: 'unauthorized' });
      if (path === '/api/auth/sessions/revoke-others') return json(401, { error: 'That passphrase is incorrect.', code: 'invalid_credentials' });
      if (path === '/api/auth/sessions') return json(200, { sessions: [] });
      return base.fetchImpl(input, init);
    });
    return { fetchImpl: fetchImpl as unknown as typeof fetch, state };
  }

  it('a request the server refuses because this session is gone forgets everything here, and says why', async () => {
    const { fetchImpl, state } = serverThatEnds();
    render(<Harness fetchImpl={fetchImpl} />);
    await act(async () => {
      await current!.register({ username: 'wren-30', passphrase: 'acorn-otter-river-lilac-tulip-zebra', role: 'survivor', ageConfirmed18: true });
    });
    // a wrong passphrase is not a signed-out session
    await act(async () => {
      await expect(current!.api.revokeOtherSessions({ authKey: 'AAAAAAAAAAAAAAAAAAAAAA==' })).rejects.toThrow();
    });
    expect(screen.getByTestId('state')).toHaveTextContent('in:wren-30');
    state.ended = true;
    await act(async () => {
      await expect(current!.api.listSessions()).rejects.toThrow();
    });
    expect(screen.getByTestId('state')).toHaveTextContent('out');
    expect(current!.lockReason).toBe('ended');
  }, 60_000);

  it('signing out on purpose is not "signed out elsewhere", even if a request fails because of it', async () => {
    const { fetchImpl, state } = serverThatEnds();
    render(<Harness fetchImpl={fetchImpl} />);
    await act(async () => {
      await current!.register({ username: 'wren-31', passphrase: 'acorn-otter-river-lilac-tulip-zebra', role: 'survivor', ageConfirmed18: true });
    });
    state.ended = true;
    const api = current!.api;
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = api.listSessions().catch(() => undefined);
      await current!.logout();
      await pending;
    });
    expect(screen.getByTestId('state')).toHaveTextContent('out');
    expect(current!.lockReason).toBe(null);
  }, 60_000);
});

describe('PBKDF2 rounds from the server', () => {
  afterEach(() => vi.restoreAllMocks());

  it('accepts the default or more, and refuses fewer (or nonsense)', () => {
    expect(checkKdfIterations(DEFAULT_KDF_ITERATIONS)).toBe(DEFAULT_KDF_ITERATIONS);
    expect(checkKdfIterations(DEFAULT_KDF_ITERATIONS * 2)).toBe(DEFAULT_KDF_ITERATIONS * 2);
    for (const n of [1000, DEFAULT_KDF_ITERATIONS - 1, 0, -1, 600000.5, Number.NaN, '600000', undefined, 1e12])
      expect(() => checkKdfIterations(n)).toThrow(/weaker protection/);
  });

  it('a server that lowers the count gets no auth key: sign-in stops before anything is sent', async () => {
    const base = fakeAuthFetch();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://x');
      if (url.pathname === '/api/auth/prelogin')
        return new Response(JSON.stringify({ kdfSalt: 'AAAAAAAAAAAAAAAAAAAAAA==', kdfIterations: 1000 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return base.fetchImpl(input, init);
    });
    render(<Harness fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await act(async () => {
      await expect(current!.login('bluebird-42', 'acorn-otter-river-lilac-tulip-zebra')).rejects.toThrow(/weaker protection/);
    });
    expect(fetchImpl.mock.calls.some(([u]) => String(u).endsWith('/api/auth/login'))).toBe(false);
    expect(screen.getByTestId('state')).toHaveTextContent('out');
  });
});

describe('recovery reset (W20)', () => {
  afterEach(() => vi.restoreAllMocks());
  const PASS = 'acorn-otter-river-lilac-tulip-zebra';
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  /** fakeAuthFetch plus recover/start, recover/finish (scripted) and POST /api/account/recovery, recording bodies. */
  async function setup(finishScript: Array<'network' | 401 | 500 | 'ok'>) {
    const base = fakeAuthFetch();
    const calls: Array<{ route: string; body: Record<string, unknown> }> = [];
    let recoveryWrappedKey: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://x');
      const route = `${init?.method ?? 'GET'} ${url.pathname}`;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const reg = base.users.values().next().value as RegisterRequest | undefined;
      const user = reg && { id: `u-${reg.username}`, username: reg.username, role: reg.role, publicKey: reg.publicKey,
        wrappedPrivateKey: reg.wrappedPrivateKey, createdAt: new Date(0).toISOString(), keyVersion: 2, hasRecoveryCode: false };
      if (route === 'POST /api/auth/recover/start') return json(200, { resetToken: 'A'.repeat(43), recoveryWrappedKey });
      if (route === 'POST /api/auth/recover/finish') {
        calls.push({ route, body });
        const next = finishScript.shift();
        if (next === 'network') throw new TypeError('Failed to fetch');
        if (next === 401) return json(401, { error: 'expired', code: 'invalid_credentials' });
        if (next === 500) return json(500, { error: 'Something went wrong' });
        return json(200, { token: 'tok-r', user });
      }
      if (route === 'POST /api/account/recovery') {
        calls.push({ route, body });
        return json(200, { user: { ...user, hasRecoveryCode: true } });
      }
      return base.fetchImpl(input, init);
    });
    render(<Harness fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await act(async () => {
      await current!.register({ username: 'wren-11', passphrase: PASS, role: 'survivor', ageConfirmed18: true });
    });
    // her (version 1) account secret, wrapped under a fresh recovery code, as the server would hold it
    const reg = base.users.get('wren-11')!;
    const as = await legacyAccountSecret((await derivePassphraseKeys(PASS, reg.kdfSalt, reg.kdfIterations)).ikm);
    const { bytes, code } = generateRecoveryCode();
    recoveryWrappedKey = await wrapAccountSecret(as, (await deriveRecoveryKeys(bytes)).kek);
    act(() => current!.lock());
    return { calls, code };
  }

  it('finish stores no new code; the new code is sent only on commit, with the new passphrase', async () => {
    const { calls, code } = await setup(['ok']);
    let out!: Awaited<ReturnType<RecoveryReset['finish']>>;
    await act(async () => {
      const reset = await current!.beginRecovery('wren-11', code);
      out = await reset.finish('lemon-river-otter-lilac-cedar-tulip');
    });
    expect(screen.getByTestId('state')).toHaveTextContent('in:wren-11');
    expect(calls.map((c) => c.route)).toEqual(['POST /api/auth/recover/finish']);
    expect(Object.keys(calls[0]!.body).sort()).toEqual(['authKey', 'kdfIterations', 'kdfSalt', 'resetToken', 'wrappedAccountKey']);
    expect(out.newCode.replacing).toBe(false);
    expect(out.newCode.code).not.toBe(code);
    expect(current!.session!.user.hasRecoveryCode).toBe(false);

    await act(async () => {
      await out.newCode.commit();
    });
    expect(calls[1]!.route).toBe('POST /api/account/recovery');
    expect(calls[1]!.body.authKey).toBe(calls[0]!.body.authKey);
    expect(current!.session!.user.hasRecoveryCode).toBe(true);
  }, 60_000);

  it('finish → network error → retry refused as spent: tells her the new passphrase may already be set', async () => {
    const { calls, code } = await setup(['network', 401]);
    await act(async () => {
      const reset = await current!.beginRecovery('wren-11', code);
      await expect(reset.finish('lemon-river-otter-lilac-cedar-tulip')).rejects.toThrow(/reach the server/);
      const err = await reset.finish('lemon-river-otter-lilac-cedar-tulip').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RecoveryMaybeFinishedError);
      expect((err as Error).message).toMatch(/new passphrase could already be set/);
      // and the account secret is wiped: a third try can't send anything
      await expect(reset.finish('lemon-river-otter-lilac-cedar-tulip')).rejects.toThrow(/This reset has ended/);
    });
    expect(calls).toHaveLength(2);
  }, 60_000);

  it('a 401 with no earlier unanswered attempt still means "enter your code again"', async () => {
    const { code } = await setup([401]);
    await act(async () => {
      const reset = await current!.beginRecovery('wren-11', code);
      const err = await reset.finish('lemon-river-otter-lilac-cedar-tulip').catch((e: unknown) => e);
      expect(err).not.toBeInstanceOf(RecoveryMaybeFinishedError);
      expect((err as Error).message).toMatch(/enter your recovery code again/);
    });
  }, 60_000);
});
