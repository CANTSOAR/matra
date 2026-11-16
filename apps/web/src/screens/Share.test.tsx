import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { decryptJSON, sealSlot, unwrapKeyWithPrivate } from '@matra/crypto';
import type { AttorneyProfile, WrappedKey } from '@matra/shared';
import { sampleRecord } from '../brief/fixtures';
import { useSession } from '../lib/session';
import { fakeAuthFetch } from '../test/fakeServer';
import { storedRecord, vaultRoutes, type StoredRecord } from '../test/fakeVault';
import { Harness, current } from '../test/sessionHarness';
import { Share } from './Share';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function Gate() {
  return useSession().session ? <Share /> : <p>Signed out</p>;
}

describe('Share fails closed: only a space that loaded cleanly is offered', () => {
  async function shareWith(username: string, opts: { failNewest?: () => boolean; slotSays?: string } = {}) {
    const base = fakeAuthFetch();
    const stored: StoredRecord[] = [];
    const attorneys: AttorneyProfile[] = [];
    const routes = vaultRoutes(stored);
    let slot: unknown = null;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://x');
      // her newest sealed version can't be fetched right now
      if (url.pathname === '/api/vault/records/r-newest' && opts.failNewest?.()) return json(500, { error: 'Something went wrong' });
      if (url.pathname.startsWith('/api/vault/slots/')) return json(200, { slot, draftMode: 'slot' });
      const hit = routes(input, init);
      if (hit) return hit;
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
      await current!.register({ username, passphrase: 'acorn-otter-river-lilac-tulip-zebra', role: 'survivor', ageConfirmed18: true });
    });
    const mk = current!.session!.masterKey;
    stored.push(await storedRecord(mk, { kind: 'final', record: sampleRecord, savedAt: '2026-08-19T00:00:00Z' }, { id: 'r-older' }));
    if (opts.failNewest) stored.push(await storedRecord(mk, { kind: 'final', record: sampleRecord, savedAt: '2026-08-20T00:00:00Z' }, { id: 'r-newest', supersedes: 'r-older' }));
    if (opts.slotSays)
      slot = { ...(await sealSlot({ kind: 'draft', slotVersion: 1, draft: { answers: {} }, evidence: [], sealedRecordId: opts.slotSays, savedAt: '2026-08-20T00:00:00Z' }, mk)), version: 'v1', updatedDay: '2026-08-20' };
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
      await current!.login(username, 'acorn-otter-river-lilac-tulip-zebra');
    });
    return { fetchImpl };
  }
  const posted = (f: ReturnType<typeof vi.fn>) => f.mock.calls.some(([u, i]) => String(u).endsWith('/api/shares') && (i as RequestInit | undefined)?.method === 'POST');

  it('her newest version can’t be fetched: "couldn’t reach us", no attorney to choose; Try again once it is back', async () => {
    const user = userEvent.setup();
    let down = true;
    const { fetchImpl } = await shareWith('wren-share', { failNewest: () => down });
    const stopped = await screen.findByTestId('vault-stopped', {}, { timeout: 15_000 });
    expect(stopped).toHaveTextContent(/We couldn’t reach Matra to open all of your space just now/);
    expect(screen.queryByRole('button', { name: 'Review and decide' })).toBeNull();
    expect(posted(fetchImpl)).toBe(false);
    down = false;
    await user.click(within(stopped).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Review and decide' }, { timeout: 15_000 })).toBeInTheDocument();
  }, 60_000);

  it('her draft says it became a sealed version the server doesn’t list: "doesn’t match what you saved", nothing offered', async () => {
    const { fetchImpl } = await shareWith('wren-hidden', { slotSays: 'r-hidden' });
    const stopped = await screen.findByTestId('vault-stopped', {}, { timeout: 15_000 });
    expect(stopped).toHaveTextContent(/doesn’t match what you saved/);
    expect(screen.queryByRole('button', { name: 'Review and decide' })).toBeNull();
    expect(posted(fetchImpl)).toBe(false);
  }, 60_000);
});

describe('Share: only the sealed account itself is ever shared', () => {
  it.each([
    ['a version sealed now ({kind, record, savedAt})', false],
    ['a version sealed before draft slots (it also holds her draft and matching fingerprints)', true],
  ])('%s', async (_name, legacy) => {
    const user = userEvent.setup();
    const base = fakeAuthFetch();
    const stored: StoredRecord[] = [];
    const routes = vaultRoutes(stored);
    const attorneys: AttorneyProfile[] = [];
    const shares: Array<{ recordId: string; recipientWrappedKey: WrappedKey }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://x');
      const hit = routes(input, init);
      if (hit) return hit;
      if (url.pathname === '/api/attorneys') return json(200, { attorneys });
      if (url.pathname === '/api/vault/blobs') return json(200, { blobs: [] });
      if (url.pathname === '/api/shares' && init?.method === 'POST') {
        shares.push(JSON.parse(String(init.body)));
        return json(201, { share: {}, ledgerEntry: {} });
      }
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
      await current!.register({ username: 'wren-clean', passphrase: 'acorn-otter-river-lilac-tulip-zebra', role: 'survivor', ageConfirmed18: true });
    });
    const payload = legacy
      ? { kind: 'final', record: sampleRecord, draft: { answers: { 'person.matchContact': { detail: '555-0100' } } }, escrowedHashes: ['ab12'], savedAt: '2026-08-19T00:00:00Z' }
      : { kind: 'final', record: sampleRecord, savedAt: '2026-08-19T00:00:00Z' };
    stored.push(await storedRecord(current!.session!.masterKey, payload, { id: 'r-final', createdAt: '2026-08-19T00:00:00Z' }));
    // the attorney's key is her own here, so the test can open what the attorney would receive
    attorneys.push({
      userId: 'a1', displayName: 'Attorney Test', jurisdictions: ['NJ'], practiceAreas: [], verified: true, acceptsProBono: true,
      publicKey: current!.session!.user.publicKey,
    });
    await act(async () => {
      current!.lock();
    });
    await act(async () => {
      await current!.login('wren-clean', 'acorn-otter-river-lilac-tulip-zebra');
    });

    await user.click(await screen.findByRole('button', { name: 'Review and decide' }, { timeout: 15_000 }));
    await user.click(screen.getByLabelText('I agree to the statement above.'));
    const yes = screen.getByRole('button', { name: /Yes, share with Attorney Test/ });
    if (legacy) {
      expect(screen.getByText(/saved in an older format that also keeps your working notes/)).toBeInTheDocument();
      expect(yes).toBeDisabled();
      expect(shares).toHaveLength(0);
      return;
    }
    expect(yes).toBeEnabled();
    await user.click(yes);
    await screen.findByText(/Shared with Attorney Test/, {}, { timeout: 15_000 });
    expect(shares).toHaveLength(1);
    // what the attorney can open: exactly her account
    const recordKey = await unwrapKeyWithPrivate(shares[0]!.recipientWrappedKey, current!.session!.privateKey);
    const opened = await decryptJSON<Record<string, unknown>>(stored.find((r) => r.record.id === shares[0]!.recordId)!.record.envelope, recordKey);
    expect(Object.keys(opened).sort()).toEqual(['kind', 'record', 'savedAt']);
  }, 60_000);
});
