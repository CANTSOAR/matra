import { act, fireEvent, render, screen } from '@testing-library/react';
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
