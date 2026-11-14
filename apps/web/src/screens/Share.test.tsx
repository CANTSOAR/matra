import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { encryptJSON, generateContentKey, wrapKeyWithMaster } from '@matra/crypto';
import type { AttorneyProfile, VaultRecord } from '@matra/shared';
import { envelopeHash } from '../api/client';
import { sampleRecord } from '../brief/fixtures';
import { useSession } from '../lib/session';
import { fakeAuthFetch } from '../test/fakeServer';
import { Harness, current } from '../test/sessionHarness';
import { Share } from './Share';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function Gate() {
  return useSession().session ? <Share /> : <p>Signed out</p>;
}

describe('Share: saved versions that could not be opened', () => {
  it('tells her, and keeps "Yes, share" off, so an older version is never shared silently', async () => {
    const user = userEvent.setup();
    const base = fakeAuthFetch();
    const records: VaultRecord[] = [];
    const attorneys: AttorneyProfile[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://x');
      if (url.pathname === '/api/vault/records') return json(200, { records });
      if (url.pathname.startsWith('/api/vault/records/')) {
        const id = decodeURIComponent(url.pathname.split('/').pop()!);
        // her newest sealed version can't be fetched right now
        if (id === 'r-newest') return json(500, { error: 'Something went wrong' });
        return json(200, { record: records.find((r) => r.id === id) });
      }
      if (url.pathname.startsWith('/api/ledger/entries/')) return json(404, { error: 'not found' });
      if (url.pathname === '/api/attorneys') return json(200, { attorneys });
      return base.fetchImpl(input, init);
    });
    render(
      <Harness fetchImpl={fetchImpl as unknown as typeof fetch}>
        <MemoryRouter>
          <Gate />
        </MemoryRouter>
      </Harness>,
    );
    await act(async () => {
      await current!.register({ username: 'wren-share', passphrase: 'acorn-maple-violin-otter-quartz', role: 'survivor', ageConfirmed18: true });
    });
    // fill her vault after sign-up (her master key exists now): one readable sealed version, one that fails to load
    const key = await generateContentKey();
    const envelope = await encryptJSON({ kind: 'final', record: sampleRecord, savedAt: '2026-08-19T00:00:00Z' }, key);
    const older: VaultRecord = {
      id: 'r-older', ownerId: 'u', createdAt: '2026-08-19T00:00:00Z', contentHash: await envelopeHash(envelope),
      ledgerEntryId: 'l1', envelope, ownerWrappedKey: await wrapKeyWithMaster(key, current!.session!.masterKey),
    };
    records.push(older, { ...older, id: 'r-newest', createdAt: '2026-08-20T00:00:00Z', supersedes: 'r-older' });
    // any valid RSA key will do for the attorney (this test build pins no org key, so it shows as unpinned)
    attorneys.push({
      userId: 'a1', displayName: 'Attorney Test', jurisdictions: ['NJ'], practiceAreas: [], verified: true, acceptsProBono: true,
      publicKey: current!.session!.user.publicKey,
    });
    // the screen loaded its vault on mount, before the records existed; remount it now that they do
    await act(async () => {
      current!.lock();
    });
    await act(async () => {
      await current!.login('wren-share', 'acorn-maple-violin-otter-quartz');
    });

    const note = await screen.findByTestId('vault-unreadable', {}, { timeout: 15_000 });
    expect(note).toHaveTextContent(/couldn’t open one saved version.*may not be your newest save/);

    await user.click(await screen.findByRole('button', { name: 'Review and decide' }, { timeout: 15_000 }));
    await user.click(screen.getByLabelText('I agree to the statement above.'));
    expect(screen.getByRole('button', { name: /Yes, share with Attorney Test/ })).toBeDisabled();
    expect(fetchImpl.mock.calls.some(([u, i]) => String(u).endsWith('/api/shares') && i?.method === 'POST')).toBe(false);
  }, 60_000);
});
