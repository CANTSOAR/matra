import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '../lib/session';
import { CreateAccountForm, SignInForm } from './AuthForms';

describe('SignInForm', () => {
  it('keeps the browser’s username/password autofill, and says not to let a shared browser save the passphrase', () => {
    render(
      <SessionProvider fetchImpl={vi.fn() as unknown as typeof fetch}>
        <MemoryRouter>
          <SignInForm role="survivor" />
        </MemoryRouter>
      </SessionProvider>,
    );
    expect(screen.getByTestId('signin-username')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByTestId('signin-passphrase')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByTestId('signin-shared-device')).toHaveTextContent(
      'On a shared or borrowed device, say no if the browser offers to save your passphrase.',
    );
  });
});

describe('CreateAccountForm (survivor) — 18+ gate', () => {
  it('requires "I am 18 or older" before the vault can be created', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn();
    render(
      <SessionProvider fetchImpl={fetchImpl as unknown as typeof fetch}>
        <MemoryRouter>
          <CreateAccountForm role="survivor" />
        </MemoryRouter>
      </SessionProvider>,
    );
    await user.type(screen.getByLabelText(/Choose an alias/), 'wren-77');
    await user.type(screen.getByLabelText('Passphrase'), 'pebble lantern fjord mango heron willow copper tundra violin saffron');
    await user.type(screen.getByLabelText('Type it again'), 'pebble lantern fjord mango heron willow copper tundra violin saffron');
    await user.click(screen.getByLabelText(/written my passphrase down/));
    const create = screen.getByRole('button', { name: 'Create my private space' });
    expect(create).toBeDisabled();
    await user.click(screen.getByLabelText('I am 18 or older.'));
    expect(create).toBeEnabled();
  });

  it('under 18: shows age-appropriate help, sends nothing, and "Go back" leaves the form (no ticking 18+ straight away)', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn();
    render(
      <SessionProvider fetchImpl={fetchImpl as unknown as typeof fetch}>
        <MemoryRouter initialEntries={['/start']}>
          <Routes>
            <Route path="/" element={<p>Start page</p>} />
            <Route path="/start" element={<CreateAccountForm role="survivor" />} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>,
    );
    await user.type(screen.getByLabelText(/Choose an alias/), 'kid-alias');
    await user.click(screen.getByRole('button', { name: 'I’m under 18' }));
    expect(screen.getByRole('heading', { name: 'Thank you for telling us' })).toBeInTheDocument();
    expect(screen.getByText(/built for adults/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '1-800-422-4453' })).toHaveAttribute('href', 'tel:+18004224453');
    expect(screen.getByRole('link', { name: '800-656-4673' })).toHaveAttribute('href', 'tel:+18006564673');
    expect(screen.queryByLabelText(/Choose an alias/)).not.toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Go back' }));
    expect(screen.getByText('Start page')).toBeInTheDocument();
    expect(screen.queryByLabelText('I am 18 or older.')).not.toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('CreateAccountForm — passphrases (PR 7)', () => {
  function renderForm(role: 'survivor' | 'attorney') {
    render(
      <SessionProvider fetchImpl={vi.fn() as unknown as typeof fetch}>
        <MemoryRouter>
          <CreateAccountForm role={role} />
        </MemoryRouter>
      </SessionProvider>,
    );
  }

  it('survivor: suggests six random words; weak phrases keep the button off', async () => {
    const user = userEvent.setup();
    renderForm('survivor');
    expect(screen.getByText(/^Six random words made on your device are the safest choice/)).toBeInTheDocument();
    expect(screen.getByTestId('wordlist-credit')).toHaveTextContent(/EFF Short Wordlist #1.*CC BY 4\.0/);
    await user.type(screen.getByLabelText(/Choose an alias/), 'wren-77');
    await user.click(screen.getByLabelText(/written my passphrase down/));
    await user.click(screen.getByLabelText('I am 18 or older.'));
    const create = screen.getByRole('button', { name: 'Create my private space' });
    for (const weak of ['password password password password', 'a'.repeat(28), 'pebble lantern fjord mango heron']) {
      await user.clear(screen.getByLabelText('Passphrase'));
      await user.clear(screen.getByLabelText('Type it again'));
      await user.type(screen.getByLabelText('Passphrase'), weak);
      await user.type(screen.getByLabelText('Type it again'), weak);
      expect(screen.getByTestId('passphrase-strength')).not.toHaveTextContent(/^Strong/);
      expect(create).toBeDisabled();
    }
    await user.click(screen.getByRole('button', { name: 'Use this passphrase' }));
    const suggested = (screen.getByLabelText('Passphrase') as HTMLInputElement).value;
    expect(suggested.split('-')).toHaveLength(6);
    await user.type(screen.getByLabelText('Type it again'), suggested);
    expect(screen.getByTestId('passphrase-strength')).toHaveTextContent(/^Strong/);
    expect(create).toBeEnabled();
  });

  it('attorney: seven generated words and no box to type one of her own; only the generated words enable the button', async () => {
    const user = userEvent.setup();
    renderForm('attorney');
    expect(screen.queryByLabelText('Passphrase')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use this passphrase' })).not.toBeInTheDocument();
    const generated = screen.getByTestId('generated-passphrase').textContent!;
    expect(generated.split('-')).toHaveLength(7);
    await user.type(screen.getByLabelText(/^Username/), 'counsel-1');
    await user.type(screen.getByLabelText('Display name'), 'A. Counsel');
    await user.click(screen.getByLabelText(/written my passphrase down/));
    const create = screen.getByRole('button', { name: 'Create attorney account' });
    await user.type(screen.getByLabelText('Type it again'), 'my own very long and very strong passphrase here');
    expect(create).toBeDisabled();
    await user.clear(screen.getByLabelText('Type it again'));
    await user.type(screen.getByLabelText('Type it again'), generated);
    expect(create).toBeEnabled();
    // different words: she has to copy the new ones
    await user.click(screen.getByRole('button', { name: 'Different words' }));
    expect(screen.getByTestId('generated-passphrase').textContent).not.toBe(generated);
    expect(create).toBeDisabled();
  });
});
