import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { useSession } from '../lib/session';
import { fakeAuthFetch } from '../test/fakeServer';
import { Harness, current } from '../test/sessionHarness';
import { DeleteAccount, confirmMatches } from './DeleteAccount';

function Home() {
  const loc = useLocation();
  return <p>Public home{(loc.state as { deleted?: boolean } | null)?.deleted ? ' — deleted' : ''}</p>;
}

async function setup(opts: { deleteFails?: boolean } = {}) {
  const user = userEvent.setup();
  const { fetchImpl } = fakeAuthFetch(opts);
  render(
    <Harness fetchImpl={fetchImpl}>
      <MemoryRouter initialEntries={['/vault/delete']}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/vault" element={<p>Vault home</p>} />
          <Route path="/vault/delete" element={<Gate />} />
        </Routes>
      </MemoryRouter>
    </Harness>,
  );
  await act(async () => {
    await current!.register({ username: 'wren-12', passphrase: 'acorn-maple-violin-otter-quartz', role: 'survivor', ageConfirmed18: true });
  });
  return { user, fetchImpl: fetchImpl as unknown as { mock: { calls: [RequestInfo | URL, RequestInit | undefined][] } } };
}

/** Like RequireSession: the screen only renders while signed in. */
function Gate() {
  return useSession().session ? <DeleteAccount /> : <p>Signed out</p>;
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
    expect(within(screen.getByTestId('delete-export')).getByRole('button', { name: 'Download my data' })).toBeInTheDocument();

    const button = screen.getByRole('button', { name: 'Delete everything now' });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText(/To confirm, type DELETE/), 'delet');
    expect(button).toBeDisabled();
    expect(deleteCalls(fetchImpl)).toHaveLength(0);
    await user.type(screen.getByLabelText(/To confirm, type DELETE/), 'e');
    expect(button).toBeEnabled();
    await user.click(button);

    expect(await screen.findByText('Public home — deleted')).toBeInTheDocument();
    expect(deleteCalls(fetchImpl)).toHaveLength(1);
    expect(screen.getByTestId('state')).toHaveTextContent('out');
    expect(current!.session).toBeNull();
  }, 60_000);

  it('if deleting fails, nothing changes and she can try again', async () => {
    const { user } = await setup({ deleteFails: true });
    await user.type(screen.getByLabelText(/To confirm, type DELETE/), 'DELETE');
    await user.click(screen.getByRole('button', { name: 'Delete everything now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Nothing was deleted/);
    expect(screen.getByTestId('state')).toHaveTextContent('in:wren-12');
    expect(screen.getByRole('button', { name: 'Delete everything now' })).toBeEnabled();
  }, 60_000);
});
