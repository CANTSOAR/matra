import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { deriveKeys, newKdfSalt, sealSlot } from '@matra/crypto';
import { emptyDraft } from '../integration/intakeAdapter';
import { fakeAuthFetch } from '../test/fakeServer';
import { storedRecord, vaultRoutes, type StoredRecord } from '../test/fakeVault';
import { Harness, current } from '../test/sessionHarness';
import { Story } from './Story';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('My story fails closed', () => {
  it('a saved version that doesn’t match what she saved: nothing opens or saves; Try again once it matches', async () => {
    const user = userEvent.setup();
    const base = fakeAuthFetch();
    const stored: StoredRecord[] = [];
    const routes = vaultRoutes(stored);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://x');
      const method = init?.method ?? 'GET';
      if (method !== 'GET' && (url.pathname.startsWith('/api/vault/slots/') || url.pathname === '/api/vault/records')) return json(500, { error: 'must not be called' });
      if (url.pathname.startsWith('/api/vault/slots/')) return json(200, { slot: null, draftMode: 'slot' });
      return routes(input, init) ?? base.fetchImpl(input, init);
    });
    const { rerender } = render(<Harness fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await act(async () => {
      await current!.register({ username: 'wren-story', passphrase: 'acorn-otter-river-lilac-tulip-zebra', role: 'survivor', ageConfirmed18: true });
    });
    const mk = current!.session!.masterKey;
    stored.push(await storedRecord(mk, { kind: 'draft', draft: emptyDraft(), savedAt: '2026-08-19T00:00:00Z' }, { id: 'r1' }));
    const real = stored[0]!.ledger.contentHash;
    stored[0]!.ledger.contentHash = 'f'.repeat(64); // the ledger attests something else
    rerender(
      <Harness fetchImpl={fetchImpl as unknown as typeof fetch}>
        <MemoryRouter>
          <Story />
        </MemoryRouter>
      </Harness>,
    );

    const stopped = await screen.findByTestId('vault-stopped', {}, { timeout: 15_000 });
    expect(stopped).toHaveTextContent(/doesn’t match what you saved, so we stopped here rather than show it or save over it\. Nothing was changed\./);
    expect(screen.queryByText('Opening your draft…')).toBeNull();
    // no "keep writing from what opened": a story that didn't load cleanly is never resumed

    stored[0]!.ledger.contentHash = real;
    await user.click(within(stopped).getByRole('button', { name: 'Try again' }));
    await vi.waitFor(() => expect(screen.queryByTestId('vault-stopped')).toBeNull(), { timeout: 15_000 });
    await vi.waitFor(() => expect(screen.queryByText('Opening your draft…')).toBeNull(), { timeout: 15_000 });
    const writes = fetchImpl.mock.calls.filter(([, i]) => i?.method === 'PUT' || (i?.method === 'POST' && String(i?.body ?? '').includes('envelope')));
    expect(writes).toHaveLength(0);
  }, 60_000);

  it('her draft opened but points at a sealed version the server doesn’t list: she reads it, keeps writing in it, and sealing stays off', async () => {
    const user = userEvent.setup();
    const base = fakeAuthFetch();
    const stored: StoredRecord[] = [];
    const routes = vaultRoutes(stored);
    let slot: unknown = null;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://x');
      const method = init?.method ?? 'GET';
      if (url.pathname === '/api/vault/records' && method === 'POST') return json(500, { error: 'must not be called' });
      if (url.pathname.startsWith('/api/vault/slots/') && method === 'GET') return json(200, { slot, draftMode: 'slot' });
      return routes(input, init) ?? base.fetchImpl(input, init);
    });
    const { rerender } = render(<Harness fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await act(async () => {
      await current!.register({ username: 'wren-lost', passphrase: 'acorn-otter-river-lilac-tulip-zebra', role: 'survivor', ageConfirmed18: true });
    });
    const mk = current!.session!.masterKey;
    const draft = { ...emptyDraft(), entries: [{ id: 'e1', createdAt: '2026-08-19T00:00:00Z', text: 'Her words, still here.', source: 'typed' as const }] };
    // the main database came back from an older backup: the seal her draft names is gone
    slot = { ...(await sealSlot({ kind: 'draft', slotVersion: 1, draft, evidence: [], sealedRecordId: 'f-lost', savedAt: '2026-08-20T00:00:00Z' }, mk)), version: 'v1', updatedDay: '2026-08-20' };
    rerender(
      <Harness fetchImpl={fetchImpl as unknown as typeof fetch}>
        <MemoryRouter>
          <Story />
        </MemoryRouter>
      </Harness>,
    );

    expect(await screen.findByTestId('vault-stopped', {}, { timeout: 15_000 })).toHaveTextContent(/doesn’t match what you saved/);
    // she can read her words without downloading anything
    expect(screen.getByTestId('draft-words')).toHaveTextContent('Her words, still here.');
    await user.click(within(screen.getByTestId('story-keep-writing')).getByRole('button', { name: 'Keep writing in your draft' }));
    expect(await screen.findByTestId('story-draft-only', {}, { timeout: 15_000 })).toHaveTextContent(/sealing and sharing are off/);
    expect(screen.queryByTestId('vault-stopped')).toBeNull();
    expect(fetchImpl.mock.calls.some(([u, i]) => String(u).endsWith('/api/vault/records') && i?.method === 'POST')).toBe(false);
  }, 60_000);

  it('a draft that doesn’t open: no "keep writing", nothing to read', async () => {
    const base = fakeAuthFetch();
    const other = await deriveKeys('someone else', newKdfSalt(), 1000);
    const slot = { ...(await sealSlot({ kind: 'draft', slotVersion: 1, draft: emptyDraft(), evidence: [], savedAt: 'x' }, other.masterKey)), version: 'v1', updatedDay: '2026-08-20' };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://x');
      if (url.pathname.startsWith('/api/vault/slots/')) return json(200, { slot, draftMode: 'slot' });
      return vaultRoutes([])(input, init) ?? base.fetchImpl(input, init);
    });
    const { rerender } = render(<Harness fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await act(async () => {
      await current!.register({ username: 'wren-baddraft', passphrase: 'acorn-otter-river-lilac-tulip-zebra', role: 'survivor', ageConfirmed18: true });
    });
    rerender(
      <Harness fetchImpl={fetchImpl as unknown as typeof fetch}>
        <MemoryRouter>
          <Story />
        </MemoryRouter>
      </Harness>,
    );
    expect(await screen.findByTestId('vault-stopped', {}, { timeout: 15_000 })).toBeInTheDocument();
    expect(screen.queryByTestId('story-keep-writing')).toBeNull();
    expect(screen.queryByTestId('draft-words')).toBeNull();
  }, 60_000);
});
