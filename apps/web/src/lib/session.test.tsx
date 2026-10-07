import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeAuthFetch } from '../test/fakeServer';
import { Harness, current } from '../test/sessionHarness';

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
      await current!.register({ username: 'bluebird-42', passphrase: 'acorn-maple-violin-otter-quartz', role: 'survivor', adultAffirmed: true });
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
