import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { openSlot } from '@matra/crypto';
import { emptyDraft } from '../integration/intakeAdapter';
import { fakeAuthFetch } from '../test/fakeServer';
import { storedRecord, vaultRoutes, type StoredRecord } from '../test/fakeVault';
import { Harness, current } from '../test/sessionHarness';
import { Evidence } from './Evidence';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('Evidence fails closed: nothing is uploaded unless her space loaded cleanly', () => {
  it('her newest version can’t be fetched: she sees why, with Try again, and no file goes up or into a draft', async () => {
    const user = userEvent.setup();
    const base = fakeAuthFetch();
    const stored: StoredRecord[] = [];
    let down = true;
    const routes = vaultRoutes(stored);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://x');
      const method = init?.method ?? 'GET';
      if (url.pathname === '/api/vault/records' && method === 'POST') return json(500, { error: 'must not be called' });
      if (url.pathname === '/api/vault/records/r-newest' && down) return json(500, { error: 'Something went wrong' }); // her newest draft
      const hit = routes(input, init);
      if (hit) return hit;
      if (url.pathname.startsWith('/api/vault/slots/') && method === 'GET') return json(200, { slot: null, draftMode: 'slot' });
      if (url.pathname.startsWith('/api/vault/slots/')) return json(500, { error: 'must not be called' });
      if (url.pathname === '/api/vault/blobs' && method === 'GET') return json(200, { blobs: [] });
      if (url.pathname === '/api/vault/blobs' && method === 'POST') return json(500, { error: 'must not be called' });
      return base.fetchImpl(input, init);
    });
    const { rerender } = render(<Harness fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await act(async () => {
      await current!.register({ username: 'wren-evidence', passphrase: 'acorn-otter-river-lilac-tulip-zebra', role: 'survivor', ageConfirmed18: true });
    });
    const s = current!.session!;
    stored.push(
      await storedRecord(s.masterKey, { kind: 'draft', draft: emptyDraft(), savedAt: '2026-08-19T00:00:00Z' }, { id: 'r-older' }),
      await storedRecord(s.masterKey, { kind: 'draft', draft: emptyDraft(), savedAt: '2026-08-20T00:00:00Z' }, { id: 'r-newest', supersedes: 'r-older' }),
    );
    rerender(
      <Harness fetchImpl={fetchImpl as unknown as typeof fetch}>
        <MemoryRouter>
          <Evidence />
        </MemoryRouter>
      </Harness>,
    );

    const stopped = await screen.findByTestId('vault-stopped', {}, { timeout: 15_000 });
    expect(stopped).toHaveTextContent(/We couldn’t reach Matra to open all of your space just now/);
    // no way to add a file from a space that didn't load; her files stay listed (read-only)
    expect(screen.queryByLabelText('Choose evidence files')).toBeNull();
    expect(await screen.findByTestId('evidence-in-space')).toBeInTheDocument();
    const writes = fetchImpl.mock.calls.filter(([u, i]) => {
      const path = new URL(String(u), 'http://x').pathname;
      return i?.method && i.method !== 'GET' && (path === '/api/vault/blobs' || path === '/api/vault/records' || path.startsWith('/api/vault/slots/'));
    });
    expect(writes).toHaveLength(0);

    // the server is back: Try again opens it, and the upload form comes back
    down = false;
    await user.click(within(stopped).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Choose evidence files', {}, { timeout: 15_000 })).toBeInTheDocument();
    expect(screen.queryByTestId('vault-stopped')).toBeNull();
  }, 60_000);
});

describe('Evidence: file details go to her draft slot', () => {
  it('saves the file details into her draft slot (never a new record), naming the seq it read', async () => {
    const user = userEvent.setup();
    const base = fakeAuthFetch();
    let slot: { name: string; envelope: unknown; wrappedKey: unknown; version: string; updatedDay: string } | null = null;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://x');
      const method = init?.method ?? 'GET';
      if (url.pathname === '/api/vault/records' && method === 'GET') return json(200, { records: [] });
      if (url.pathname === '/api/vault/records' && method === 'POST') return json(500, { error: 'must not be called' });
      if (url.pathname.startsWith('/api/vault/slots/') && method === 'GET') return json(200, { slot, draftMode: 'slot' });
      if (url.pathname.startsWith('/api/vault/slots/') && method === 'PUT') {
        const body = JSON.parse(String(init!.body));
        if ((slot?.version ?? null) !== body.expectedVersion) return json(409, { error: 'stale', code: 'slot_conflict' });
        slot = { name: url.pathname.split('/').pop()!, envelope: body.envelope, wrappedKey: body.wrappedKey, version: 'a'.repeat(32), updatedDay: '2026-11-14' };
        return json(200, { version: slot.version, updatedDay: slot.updatedDay, draftMode: 'slot' });
      }
      if (url.pathname === '/api/vault/blobs' && method === 'GET') return json(200, { blobs: [] });
      if (url.pathname === '/api/vault/blobs' && method === 'POST') {
        const at = '2026-09-01T00:00:00Z';
        return json(201, {
          blob: { id: 'c'.repeat(32), ownerId: 'u', sizeBytes: 4, contentHash: 'h', createdAt: at, ledgerEntryId: 'l9', ownerWrappedKey: {} },
          ledgerEntry: { id: 'l9', seq: 9, type: 'blob.sealed', subjectId: 'c'.repeat(32), contentHash: 'h', prevHash: 'p', entryHash: 'e', timestamp: at },
        });
      }
      if (url.pathname.startsWith('/api/ledger/entries/')) return json(404, { error: 'not found' });
      return base.fetchImpl(input, init);
    });
    const { rerender } = render(<Harness fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await act(async () => {
      await current!.register({ username: 'wren-slot', passphrase: 'acorn-otter-river-lilac-tulip-zebra', role: 'survivor', ageConfirmed18: true });
    });
    rerender(
      <Harness fetchImpl={fetchImpl as unknown as typeof fetch}>
        <MemoryRouter>
          <Evidence />
        </MemoryRouter>
      </Harness>,
    );
    await user.upload(await screen.findByLabelText('Choose evidence files'), new File(['note'], 'note.pdf', { type: 'application/pdf' }));
    expect(await screen.findByText('Saved to your space and added to your draft story.', {}, { timeout: 15_000 })).toBeInTheDocument();
    const posts = fetchImpl.mock.calls.filter(([u, i]) => new URL(String(u), 'http://x').pathname === '/api/vault/records' && i?.method === 'POST');
    expect(posts).toHaveLength(0);
    expect(slot!.version).toBe('a'.repeat(32));
    const s = current!.session!;
    const opened = await openSlot<{ kind: string; evidence: Array<{ fileName: string }> }>(slot as never, s.masterKey);
    expect(opened.kind).toBe('draft');
    expect(opened.evidence.map((e) => e.fileName)).toEqual(['note.pdf']);
    expect((await current!.getWorkingData())?.slotVersion).toBe('a'.repeat(32));
  }, 60_000);
});
