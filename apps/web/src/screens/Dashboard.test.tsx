import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { decryptJSON, publicKeyFingerprint, unwrapKeyWithPrivate } from '@matra/crypto';
import type { AttorneyProfile, Share } from '@matra/shared';
import { sampleRecord } from '../brief/fixtures';
import { useSession } from '../lib/session';
import { fakeAuthFetch } from '../test/fakeServer';
import { storedRecord, vaultRoutes, type StoredRecord } from '../test/fakeVault';
import { Harness, current } from '../test/sessionHarness';
import { Dashboard } from './Dashboard';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function Home() {
  return useSession().session ? <Dashboard /> : <p>Signed out</p>;
}

/** Home over a fake server: her records (with ledger entries), shares and attorneys, filled after she signs up. */
async function homeWith(username: string, fail: Parameters<typeof vaultRoutes>[1] = {}) {
  const base = fakeAuthFetch();
  const stored: StoredRecord[] = [];
  const shares: Share[] = [];
  const attorneys: AttorneyProfile[] = [];
  const routes = vaultRoutes(stored, fail);
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://x');
    const hit = routes(input, init);
    if (hit) return hit;
    if (url.pathname === '/api/vault/blobs') return json(200, { blobs: [] });
    if (url.pathname === '/api/shares') return json(200, { shares });
    if (url.pathname.endsWith('/renew')) return json(200, { share: shares[0], ledgerEntry: {} });
    if (url.pathname === '/api/attorneys') return json(200, { attorneys });
    if (url.pathname === '/api/audit') return json(200, { events: [] });
    return base.fetchImpl(input, init);
  });
  render(
    <Harness fetchImpl={fetchImpl as unknown as typeof fetch}>
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    </Harness>,
  );
  await act(async () => {
    await current!.register({ username, passphrase: 'acorn-otter-river-lilac-tulip-zebra', role: 'survivor', ageConfirmed18: true });
  });
  const mk = current!.session!.masterKey;
  /** Home loaded on sign-up, before the records existed: sign in again so it loads them */
  const reopen = async () => {
    await act(async () => {
      current!.lock();
    });
    await act(async () => {
      await current!.login(username, 'acorn-otter-river-lilac-tulip-zebra');
    });
  };
  return { fetchImpl, stored, shares, attorneys, mk, reopen };
}

const share = (id: string, recordId: string, extra: Partial<Share> = {}): Share => ({
  id, recordId, survivorId: 'u', attorneyId: `a-${id}`, status: 'active', consentStatement: 'I consent.', scope: ['record'],
  createdAt: '2026-08-21T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z', ledgerEntryId: 'l', attorneyVerified: true, ...extra,
});

describe('Home: sharing', () => {
  it('a share of a version sealed before draft slots (it also holds her draft) can’t be renewed; a share of a clean one can', async () => {
    const h = await homeWith('wren-renew');
    h.stored.push(
      await storedRecord(h.mk, { kind: 'final', record: sampleRecord, draft: { answers: {} }, escrowedHashes: ['ab'], savedAt: '2026-08-19T00:00:00Z' }, { id: 'r-legacy' }),
      await storedRecord(h.mk, { kind: 'final', record: sampleRecord, savedAt: '2026-08-20T00:00:00Z' }, { id: 'r-clean' }),
    );
    h.shares.push(share('s-legacy', 'r-legacy'), share('s-clean', 'r-clean'));
    await h.reopen();

    const legacyNote = await screen.findByTestId('share-legacy', {}, { timeout: 15_000 });
    const legacyRow = legacyNote.closest('li')!;
    expect(within(legacyRow).queryByRole('button', { name: /^Renew/ })).toBeNull();
    expect(within(legacyRow).getByTestId('share-revoke')).toBeInTheDocument();
    const rows = screen.getAllByTestId('share-revoke').map((b) => b.closest('li')!);
    const cleanRow = rows.find((r) => r !== legacyRow)!;
    expect(within(cleanRow).getByRole('button', { name: /^Renew/ })).toBeInTheDocument();
  }, 60_000);

  it('renewing a share whose keys were deleted locks her file for the attorney again on her device, to the key she confirmed', async () => {
    const user = userEvent.setup();
    const h = await homeWith('wren-rewrap');
    const r = await storedRecord(h.mk, { kind: 'final', record: sampleRecord, savedAt: '2026-08-20T00:00:00Z' }, { id: 'r-clean' });
    h.stored.push(r);
    // any valid RSA key will do for the attorney (this test build pins no org key): her own
    const attorneyKey = current!.session!.user.publicKey;
    const fp = await publicKeyFingerprint(attorneyKey);
    h.attorneys.push({ userId: 'a-s1', displayName: 'Attorney Test', jurisdictions: ['NJ'], practiceAreas: [], verified: true, acceptsProBono: true, publicKey: attorneyKey });
    h.shares.push(share('s1', 'r-clean', { expiresAt: '2026-01-01T00:00:00Z', keyDeleted: true, blobIds: [], consentStatement: `I consent. Key ${fp}.` }));
    await h.reopen();

    expect(await screen.findByTestId('share-key-deleted', {}, { timeout: 15_000 })).toHaveTextContent(/deleted the attorney’s copy of the key/);
    await user.click(await screen.findByRole('button', { name: /^Renew/ }, { timeout: 15_000 }));
    await vi.waitFor(() => expect(h.fetchImpl.mock.calls.some(([u]) => String(u).endsWith('/renew'))).toBe(true), { timeout: 15_000 });
    const [, init] = h.fetchImpl.mock.calls.find(([u]) => String(u).endsWith('/renew'))!;
    const body = JSON.parse(String(init!.body));
    expect(body.blobs).toEqual([]);
    // the attorney's private key (here: hers) opens the record key the server never saw unwrapped
    const key = await unwrapKeyWithPrivate(body.recipientWrappedKey, current!.session!.privateKey);
    expect(await decryptJSON(r.record.envelope, key)).toMatchObject({ kind: 'final', savedAt: '2026-08-20T00:00:00Z' });
    expect(body.expiresInDays).toBeGreaterThan(0);
  }, 60_000);

  it('does not re-wrap to a key she never confirmed', async () => {
    const user = userEvent.setup();
    const h = await homeWith('wren-swapped');
    h.stored.push(await storedRecord(h.mk, { kind: 'final', record: sampleRecord, savedAt: '2026-08-20T00:00:00Z' }, { id: 'r-clean' }));
    h.attorneys.push({ userId: 'a-s1', displayName: 'Attorney Test', jurisdictions: ['NJ'], practiceAreas: [], verified: true, acceptsProBono: true, publicKey: current!.session!.user.publicKey });
    h.shares.push(share('s1', 'r-clean', { expiresAt: '2026-01-01T00:00:00Z', keyDeleted: true, blobIds: [], consentStatement: 'I consent. Key AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-0000-1111.' }));
    await h.reopen();

    await user.click(await screen.findByRole('button', { name: /^Renew/ }, { timeout: 15_000 }));
    expect(await screen.findByText(/isn’t the one you confirmed when you shared, so nothing was renewed/, {}, { timeout: 15_000 })).toBeInTheDocument();
    expect(h.fetchImpl.mock.calls.some(([u]) => String(u).endsWith('/renew'))).toBe(false);
  }, 60_000);
});

describe('Home reads partially, and says what is left out and why', () => {
  it('a saved version that doesn’t match what she saved: left out, with the "doesn’t match" note', async () => {
    const h = await homeWith('wren-partial');
    h.stored.push(
      await storedRecord(h.mk, { kind: 'final', record: sampleRecord, savedAt: '2026-08-19T00:00:00Z' }, { id: 'r-old' }),
      await storedRecord(h.mk, { kind: 'final', record: sampleRecord, savedAt: '2026-08-20T00:00:00Z' }, { id: 'r-new', supersedes: 'r-old' }),
    );
    h.stored[1]!.ledger.contentHash = 'f'.repeat(64);
    await h.reopen();
    const note = await screen.findByTestId('vault-unreadable', {}, { timeout: 15_000 });
    expect(note).toHaveAttribute('data-kind', 'integrity');
    expect(note).toHaveTextContent(/One saved version of your space doesn’t match what you saved, so it is left out here/);
  }, 60_000);

  it('one that couldn’t be fetched: the "couldn’t reach Matra" note', async () => {
    const h = await homeWith('wren-away', { record: { 'r-new': 503 } });
    h.stored.push(await storedRecord(h.mk, { kind: 'final', record: sampleRecord, savedAt: '2026-08-20T00:00:00Z' }, { id: 'r-new' }));
    await h.reopen();
    const note = await screen.findByTestId('vault-unreadable', {}, { timeout: 15_000 });
    expect(note).toHaveAttribute('data-kind', 'unavailable');
    expect(note).toHaveTextContent(/We couldn’t reach Matra to open one saved version of your space just now/);
  }, 60_000);
});

describe('Home: your data', () => {
  it('links to "Passphrase and devices" from the Your data group', async () => {
    await homeWith('wren-pass');
    const data = await screen.findByTestId('home-data', {}, { timeout: 15_000 });
    expect(within(data).getByTestId('passphrase-link')).toHaveTextContent('Passphrase and devices');
  }, 60_000);
});
