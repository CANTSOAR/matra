import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '../lib/session';
import { CreateAccountForm } from './AuthForms';

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
    await user.type(screen.getByLabelText('Passphrase'), 'pebble lantern fjord mango heron');
    await user.type(screen.getByLabelText('Type it again'), 'pebble lantern fjord mango heron');
    await user.click(screen.getByLabelText(/written my passphrase down/));
    const create = screen.getByRole('button', { name: 'Create my private vault' });
    expect(create).toBeDisabled();
    await user.click(screen.getByLabelText('I am 18 or older.'));
    expect(create).toBeEnabled();
  });

  it('under 18: shows age-appropriate help, sends nothing, and can go back', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn();
    render(
      <SessionProvider fetchImpl={fetchImpl as unknown as typeof fetch}>
        <MemoryRouter>
          <CreateAccountForm role="survivor" />
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
    expect(screen.getByLabelText(/Choose an alias/)).toHaveValue('');
  });
});
