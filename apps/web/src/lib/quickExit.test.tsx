import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUICK_EXIT_URL, QuickExitButton, exitDeps } from './quickExit';
import { fakeAuthFetch } from '../test/fakeServer';
import { Harness, current } from '../test/sessionHarness';

describe('quick exit', () => {
  let replace: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    replace = vi.spyOn(exitDeps, 'replace').mockImplementation(() => {});
    document.body.style.visibility = '';
  });
  afterEach(() => vi.restoreAllMocks());

  it('wipes the in-memory session and replaces location', async () => {
    const { fetchImpl } = fakeAuthFetch();
    render(
      <Harness fetchImpl={fetchImpl}>
        <QuickExitButton />
      </Harness>,
    );
    await act(async () => {
      await current!.register({ username: 'wren', passphrase: 'pebble-lantern-fjord-mango-heron', role: 'survivor', ageConfirmed18: true });
    });
    expect(screen.getByTestId('state')).toHaveTextContent('in:wren');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /quick exit/i }));
    });
    expect(screen.getByTestId('state')).toHaveTextContent('out');
    expect(current!.session).toBeNull();
    expect(replace).toHaveBeenCalledWith(QUICK_EXIT_URL);
    expect(document.title).toBe('Notes');
  }, 60_000);

  it('idle lock: a survivor leaves to the same neutral page as Quick exit, with the same wipe', async () => {
    const { fetchImpl } = fakeAuthFetch();
    render(<Harness fetchImpl={fetchImpl} idleMs={50} />);
    await act(async () => {
      await current!.register({ username: 'wren', passphrase: 'pebble-lantern-fjord-mango-heron', role: 'survivor', ageConfirmed18: true });
    });
    await waitFor(() => expect(replace).toHaveBeenCalledWith(QUICK_EXIT_URL));
    expect(screen.getByTestId('state')).toHaveTextContent('out');
    expect(current!.session).toBeNull();
    // no "Welcome back" idle note is queued for whoever opens the app next
    expect(current!.lockReason).toBeNull();
    expect(document.body.style.visibility).toBe('hidden');
    expect(document.title).toBe('Notes');
  }, 60_000);

  it('idle lock: an attorney is signed out with the idle note, not sent to the neutral page', async () => {
    const { fetchImpl } = fakeAuthFetch();
    render(<Harness fetchImpl={fetchImpl} idleMs={50} />);
    await act(async () => {
      await current!.register({ username: 'counsel-1', passphrase: 'pebble-lantern-fjord-mango-heron', role: 'attorney' });
    });
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('out'));
    expect(current!.lockReason).toBe('idle');
    expect(replace).not.toHaveBeenCalled();
  }, 60_000);

  it('triggers on Escape pressed three times quickly', () => {
    render(<QuickExitButton />);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(replace).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith(QUICK_EXIT_URL);
  });

  it('does not trigger when presses are spread out', () => {
    vi.useFakeTimers();
    try {
      render(<QuickExitButton />);
      for (let i = 0; i < 3; i++) {
        fireEvent.keyDown(window, { key: 'Escape' });
        vi.advanceTimersByTime(1500);
      }
      expect(replace).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
