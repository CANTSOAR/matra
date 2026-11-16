import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_KDF_ITERATIONS, derivePassphraseKeys, legacyAccountSecret, unwrapAccountSecret } from '@matra/crypto';
import type { ChangePassphraseRequest, PublicUser } from '@matra/shared';
import { useSession } from '../lib/session';
import { fakeAuthFetch } from '../test/fakeServer';
import { Harness, current } from '../test/sessionHarness';
import { ChangePassphrase } from './ChangePassphrase';

const PASS = 'acorn-otter-river-lilac-tulip-zebra';

function Gate() {
  return useSession().session ? <ChangePassphrase /> : <p>Signed out</p>;
}

async function setup() {
  const user = userEvent.setup();
  const base = fakeAuthFetch();
  const calls: Array<{ route: string; body: unknown }> = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://x');
    const route = `${init?.method ?? 'GET'} ${url.pathname}`;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const reg = base.users.get('wren-21');
    if (route === 'GET /api/auth/sessions')
      return json(200, {
        sessions: [
          { signedInAt: '2026-11-15T10:00:00.000Z', expiresAt: '2026-11-15T22:00:00.000Z', current: true },
          { signedInAt: '2026-11-14T09:00:00.000Z', expiresAt: '2026-11-14T21:00:00.000Z', current: false },
        ],
      });
    if (route === 'POST /api/account/passphrase') {
      calls.push({ route, body });
      if (body.authKey !== reg!.authKey) return json(401, { error: 'That passphrase is incorrect.', code: 'invalid_credentials' });
      const me = (await (await base.fetchImpl('/api/me')).json()).user as PublicUser;
      return json(200, { user: { ...me, keyVersion: 2, wrappedAccountKey: body.wrappedAccountKey }, endedSessions: 1 });
    }
    if (route === 'POST /api/auth/sessions/revoke-others') {
      calls.push({ route, body });
      if (body.authKey !== reg!.authKey) return json(401, { error: 'That passphrase is incorrect.', code: 'invalid_credentials' });
      return json(200, { endedSessions: 1 });
    }
    return base.fetchImpl(input, init);
  });
  render(
    <Harness fetchImpl={fetchImpl as unknown as typeof fetch}>
      <MemoryRouter initialEntries={['/vault/passphrase']}>
        <Routes>
          <Route path="/vault/passphrase" element={<Gate />} />
        </Routes>
      </MemoryRouter>
    </Harness>,
  );
  await act(async () => {
    await current!.register({ username: 'wren-21', passphrase: PASS, role: 'survivor', ageConfirmed18: true });
  });
  return { user, calls, reg: base.users.get('wren-21')! };
}

describe('Passphrase and devices', () => {
  it('says plainly what changing it does and what it can’t do (someone who already copied the key)', async () => {
    await setup();
    const caveat = screen.getByTestId('change-caveat');
    expect(caveat).toHaveTextContent(/old passphrase stops working for signing in/);
    expect(caveat).toHaveTextContent(/anyone signed in to your account on another device is signed out/);
    expect(caveat).toHaveTextContent(/may have kept a copy of the key that unlocks it/);
    expect(caveat).toHaveTextContent(/still opens for them/);
    expect(screen.getByText(/If you have a recovery code, it keeps working\./)).toBeInTheDocument();
  });

  it('re-wraps the same account secret under the new passphrase on her device, and sends only wrapped material', async () => {
    const { user, calls, reg } = await setup();
    const submit = screen.getByTestId('change-submit');
    await user.type(screen.getByTestId('change-current'), PASS);
    // a weak new passphrase keeps the button off
    await user.type(screen.getByTestId('change-new'), 'password password password password');
    await user.type(screen.getByTestId('change-new-again'), 'password password password password');
    expect(submit).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Use this passphrase' }));
    const next = (screen.getByTestId('change-new') as HTMLInputElement).value;
    await user.type(screen.getByTestId('change-new-again'), next);
    expect(submit).toBeEnabled();
    await user.click(submit);
    await waitFor(() => expect(screen.getByTestId('change-done')).toHaveTextContent(/Your passphrase is changed\. .*1 other session was signed out\./), { timeout: 20_000 });

    expect(calls).toHaveLength(1);
    const body = calls[0]!.body as ChangePassphraseRequest;
    expect(Object.keys(body).sort()).toEqual(['authKey', 'kdfIterations', 'kdfSalt', 'newAuthKey', 'wrappedAccountKey']);
    expect(JSON.stringify(body)).not.toContain(next);
    expect(JSON.stringify(body)).not.toContain(PASS);
    expect(body.kdfIterations).toBe(DEFAULT_KDF_ITERATIONS);
    expect(body.kdfSalt).not.toBe(reg.kdfSalt);
    // the new wrap opens with the new passphrase to exactly her old (version 1) account secret
    const nk = await derivePassphraseKeys(next, body.kdfSalt, body.kdfIterations);
    expect(nk.authKey).toBe(body.newAuthKey);
    const as = await unwrapAccountSecret(body.wrappedAccountKey, nk.kek);
    const old = await legacyAccountSecret((await derivePassphraseKeys(PASS, reg.kdfSalt, reg.kdfIterations)).ikm);
    expect(Array.from(as)).toEqual(Array.from(old));
    expect(current!.session!.user.keyVersion).toBe(2);
  }, 60_000);

  it('a wrong current passphrase sends nothing and says nothing changed', async () => {
    const { user, calls } = await setup();
    await user.type(screen.getByTestId('change-current'), 'not my passphrase at all');
    await user.click(screen.getByRole('button', { name: 'Use this passphrase' }));
    await user.type(screen.getByTestId('change-new-again'), (screen.getByTestId('change-new') as HTMLInputElement).value);
    await user.click(screen.getByTestId('change-submit'));
    await waitFor(() => expect(screen.getByText('That passphrase isn’t right. Nothing was changed.')).toBeInTheDocument(), { timeout: 20_000 });
    expect(calls).toHaveLength(0);
  }, 60_000);

  it('lists sign-ins (times only) and signs out everywhere else with her passphrase', async () => {
    const { user, calls, reg } = await setup();
    await waitFor(() => expect(screen.getByTestId('session-list').querySelectorAll('li')).toHaveLength(2));
    expect(screen.getByTestId('session-list')).toHaveTextContent(/This device: since/);
    expect(screen.getByTestId('session-list')).toHaveTextContent(/Another sign-in: since/);
    // a reloaded or closed tab keeps its first session for up to 12 hours, so one device can show twice: the screen says so
    expect(screen.getByTestId('sessions')).toHaveTextContent(/closed or reloaded without choosing Lock & sign out still shows here until it ends/);
    await user.type(screen.getByTestId('signout-others-passphrase'), PASS);
    await user.click(screen.getByTestId('signout-others'));
    await waitFor(() => expect(screen.getByTestId('signout-others-done')).toHaveTextContent('Done. 1 other session was signed out.'), { timeout: 20_000 });
    expect(calls).toEqual([{ route: 'POST /api/auth/sessions/revoke-others', body: { authKey: reg.authKey } }]);
  }, 60_000);
});
