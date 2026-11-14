import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { useSession } from '../lib/session';
import { fakeAuthFetch } from '../test/fakeServer';
import { Harness, current } from '../test/sessionHarness';
import { DeleteAccount, confirmMatches } from './DeleteAccount';

function Home() {
  const loc = useLocation();
  return <p>Public home{(loc.state as { deleted?: boolean } | null)?.deleted ? ' — deleted' : ''}</p>;
}

const PASS = 'acorn-maple-violin-otter-quartz';

async function setup(opts: { deleteFails?: boolean; holdDelete?: Promise<void> } = {}) {
  const user = userEvent.setup();
  const { fetchImpl } = fakeAuthFetch(opts);
  const hold = opts.holdDelete;
  // optionally keep the delete request in flight until the test lets it through
  const served = hold
    ? (vi.fn(async (u: RequestInfo | URL, i?: RequestInit) => {
        if (String(u).endsWith('/api/account/delete')) await hold;
        return fetchImpl(u, i);
      }) as unknown as typeof fetch)
    : fetchImpl;
  render(
    <Harness fetchImpl={served}>
      <MemoryRouter initialEntries={['/vault/delete']}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/vault" element={<VaultHome />} />
          <Route path="/signin" element={<p>Welcome back</p>} />
          <Route path="/vault/delete" element={<Gate />} />
        </Routes>
      </MemoryRouter>
    </Harness>,
  );
  await act(async () => {
    await current!.register({ username: 'wren-12', passphrase: PASS, role: 'survivor', ageConfirmed18: true });
  });
  return { user, fetchImpl: served as unknown as { mock: { calls: [RequestInfo | URL, RequestInit | undefined][] } } };
}

/** Like RequireSession: the screen only renders while signed in. */
function Gate() {
  return useSession().session ? <DeleteAccount /> : <p>Signed out</p>;
}

/** Like the real vault home behind RequireSession: signed out, it sends her to sign in. */
function VaultHome() {
  return useSession().session ? <p>Vault home</p> : <Navigate to="/signin" replace />;
}

const deleteCalls = (f: { mock: { calls: [RequestInfo | URL, RequestInit | undefined][] } }) =>
  f.mock.calls.filter(([u, i]) => String(u).endsWith('/api/account/delete') && i?.method === 'POST');

describe('Delete everything', () => {
  it('accepts only the typed word', () => {
    expect(confirmMatches('DELETE')).toBe(true);
    expect(confirmMatches('  delete ')).toBe(true);
    expect(confirmMatches('delet')).toBe(false);
    expect(confirmMatches('')).toBe(false);
  });

  it('explains first (spoliation caution, what is and isn’t deleted, a copy first), then deletes, wipes the session and lands on the public home', async () => {
    const { user, fetchImpl } = await setup();
    expect(screen.getByRole('heading', { name: 'Delete everything', level: 1 })).toBeInTheDocument();
    const caution = screen.getByTestId('notice-deleting');
    expect(caution).toHaveTextContent(/talk to a lawyer before you delete anything/);
    expect(caution).toHaveTextContent(/not legal advice/);
    expect(screen.getByText(/This can’t be undone\./)).toBeInTheDocument();
    expect(screen.getByText(/Copies an attorney already downloaded or saved\./)).toBeInTheDocument();
    expect(screen.getByText(/fingerprints \(hashes\)/)).toBeInTheDocument();
    // not a crypto-shred: an earlier backup still opens with her passphrase, and the page says so
    expect(screen.getByText(/Any backup of our server made before you delete\./)).toBeInTheDocument();
    expect(screen.queryByText(/they can’t be opened/)).not.toBeInTheDocument();
    expect(within(screen.getByTestId('delete-export')).getByRole('button', { name: 'Download my data' })).toBeInTheDocument();

    const button = screen.getByRole('button', { name: 'Delete everything now' });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText(/To confirm, type DELETE/), 'delet');
    expect(button).toBeDisabled();
    expect(deleteCalls(fetchImpl)).toHaveLength(0);
    await user.type(screen.getByLabelText(/To confirm, type DELETE/), 'e');
    // the typed word is not enough: her passphrase too
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText(/type your passphrase/), PASS);
    expect(button).toBeEnabled();
    await user.click(button);

    expect(await screen.findByText('Public home — deleted', {}, { timeout: 15_000 })).toBeInTheDocument();
    expect(deleteCalls(fetchImpl)).toHaveLength(1);
    expect(JSON.parse(String(deleteCalls(fetchImpl)[0][1]!.body))).toHaveProperty('authKey');
    expect(screen.getByTestId('state')).toHaveTextContent('out');
    expect(current!.session).toBeNull();
  }, 60_000);

  it('a wrong passphrase deletes nothing and says so', async () => {
    const { user, fetchImpl } = await setup();
    await user.type(screen.getByLabelText(/To confirm, type DELETE/), 'DELETE');
    await user.type(screen.getByLabelText(/type your passphrase/), 'not-my-passphrase');
    await user.click(screen.getByRole('button', { name: 'Delete everything now' }));
    expect(await screen.findByRole('alert', {}, { timeout: 15_000 })).toHaveTextContent('That passphrase isn’t right. Nothing was deleted.');
    expect(deleteCalls(fetchImpl)).toHaveLength(0); // checked on her device first
    expect(screen.getByTestId('state')).toHaveTextContent('in:wren-12');
  }, 60_000);

  it('if deleting fails, nothing changes and she can try again', async () => {
    const { user } = await setup({ deleteFails: true });
    await user.type(screen.getByLabelText(/To confirm, type DELETE/), 'DELETE');
    await user.type(screen.getByLabelText(/type your passphrase/), PASS);
    await user.click(screen.getByRole('button', { name: 'Delete everything now' }));
    expect(await screen.findByRole('alert', {}, { timeout: 15_000 })).toHaveTextContent(/Nothing was deleted/);
    expect(screen.getByTestId('state')).toHaveTextContent('in:wren-12');
    expect(screen.getByRole('button', { name: 'Delete everything now' })).toBeEnabled();
  }, 60_000);

  it('if she leaves the screen while it is deleting, the session is still wiped and she lands on the public home', async () => {
    let release!: () => void;
    const { user, fetchImpl } = await setup({ holdDelete: new Promise<void>((r) => (release = r)) });
    await user.type(screen.getByLabelText(/To confirm, type DELETE/), 'DELETE');
    await user.type(screen.getByLabelText(/type your passphrase/), PASS);
    await user.click(screen.getByRole('button', { name: 'Delete everything now' }));
    await vi.waitFor(() => expect(deleteCalls(fetchImpl)).toHaveLength(1), { timeout: 15_000 });
    await user.click(screen.getByRole('link', { name: 'Keep my space' }));
    expect(screen.getByText('Vault home')).toBeInTheDocument();
    await act(async () => release());

    expect(await screen.findByText('Public home — deleted', {}, { timeout: 15_000 })).toBeInTheDocument();
    expect(screen.getByTestId('state')).toHaveTextContent('out');
    expect(current!.session).toBeNull();
  }, 60_000);
});
