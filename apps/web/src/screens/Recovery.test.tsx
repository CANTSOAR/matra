import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { generateRecoveryCode } from '@matra/crypto';
import { RecoveryCodeCard } from '../components/RecoveryCode';
import { recoverFormProblem } from './Recovery';

describe('recovery code: show once, confirm the last 4', () => {
  it('runs onConfirmed only after the last 4 characters are typed (any case, spaces ignored)', async () => {
    const user = userEvent.setup();
    const onConfirmed = vi.fn();
    const { code } = generateRecoveryCode();
    render(<RecoveryCodeCard code={code} onConfirmed={onConfirmed} replacing />);
    expect(screen.getByTestId('recovery-code')).toHaveTextContent(code);
    expect(screen.getByText('Your old code will stop working.')).toBeInTheDocument();
    expect(screen.getByText(/Only you have it/)).toBeInTheDocument();

    await user.click(screen.getByTestId('recovery-confirm'));
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(screen.getByText(/Those aren’t the last 4 characters/)).toBeInTheDocument();

    const tail = code.slice(-4);
    const wrongTail = code.slice(-5, -1);
    await user.type(screen.getByTestId('recovery-confirm-input'), wrongTail === tail ? '0000' : wrongTail);
    await user.click(screen.getByTestId('recovery-confirm'));
    expect(onConfirmed).not.toHaveBeenCalled();

    await user.clear(screen.getByTestId('recovery-confirm-input'));
    await user.type(screen.getByTestId('recovery-confirm-input'), ` ${tail.slice(0, 2).toLowerCase()} ${tail.slice(2)}`);
    await user.click(screen.getByTestId('recovery-confirm'));
    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });

  it('warns that a downloaded copy is not encrypted before downloading', async () => {
    const user = userEvent.setup();
    render(<RecoveryCodeCard code={generateRecoveryCode().code} onConfirmed={() => undefined} />);
    expect(screen.queryByText(/The downloaded file is not encrypted/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Download as a text file' }));
    expect(screen.getByText(/The downloaded file is not encrypted/)).toBeInTheDocument();
  });
});

describe('Forgot your passphrase? form', () => {
  it('checks alias and code on this device before anything is sent', () => {
    const { code } = generateRecoveryCode();
    expect(recoverFormProblem('', code)).toBe('Please enter your alias.');
    expect(recoverFormProblem('wren-12', '')).toBe('Please enter your recovery code.');
    expect(recoverFormProblem('wren-12', code.slice(0, -2))).toMatch(/has 28 letters and numbers/);
    expect(recoverFormProblem('wren-12', `U${code.slice(1)}`)).toMatch(/isn’t used in recovery codes/);
    const last = code.at(-1) === '0' ? '1' : '0';
    expect(recoverFormProblem('wren-12', code.slice(0, -1) + last)).toMatch(/mistyped/);
    expect(recoverFormProblem('wren-12', code)).toBeNull();
    expect(recoverFormProblem('wren-12', code.toLowerCase().replace(/-/g, ' '))).toBeNull();
  });
});
