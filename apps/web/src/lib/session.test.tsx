import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveRecoveryKeys, derivePassphraseKeys, generateRecoveryCode, legacyAccountSecret, wrapAccountSecret } from '@matra/crypto';
import type { RegisterRequest } from '@matra/shared';
import { fakeAuthFetch } from '../test/fakeServer';
import { Harness, current } from '../test/sessionHarness';
import { RecoveryMaybeFinishedError, type RecoveryReset } from './session';

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
      await current!.register({ username: 'bluebird-42', passphrase: 'acorn-maple-violin-otter-quartz', role: 'survivor', ageConfirmed18: true });
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
      const s = await current!.login('bluebird-42', 'acorn-maple-violin-otter-quartz');
      expect(s.privateKey.type).toBe('private');
    });
    expect(screen.getByTestId('state')).toHaveTextContent('in:bluebird-42');

    for (const spy of [setItem, local, sess, cookie]) expect(spy).not.toHaveBeenCalled();
    if (idb) expect(idb).not.toHaveBeenCalled();
  }, 60_000);
});

describe('recovery reset (W20)', () => {
  afterEach(() => vi.restoreAllMocks());
  const PASS = 'acorn-maple-violin-otter-quartz';
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
      out = await reset.finish('brand new five word passphrase');
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
      await expect(reset.finish('brand new five word passphrase')).rejects.toThrow(/reach the server/);
      const err = await reset.finish('brand new five word passphrase').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RecoveryMaybeFinishedError);
      expect((err as Error).message).toMatch(/new passphrase could already be set/);
      // and the account secret is wiped: a third try can't send anything
      await expect(reset.finish('brand new five word passphrase')).rejects.toThrow(/This reset has ended/);
    });
    expect(calls).toHaveLength(2);
  }, 60_000);

  it('a 401 with no earlier unanswered attempt still means "enter your code again"', async () => {
    const { code } = await setup([401]);
    await act(async () => {
      const reset = await current!.beginRecovery('wren-11', code);
      const err = await reset.finish('brand new five word passphrase').catch((e: unknown) => e);
      expect(err).not.toBeInstanceOf(RecoveryMaybeFinishedError);
      expect((err as Error).message).toMatch(/enter your recovery code again/);
    });
  }, 60_000);
});
