import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { openSlot, slotName } from '@matra/crypto';
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
    // one slot per name: her draft slot, and the private evidence slot the evidence reader keeps beside it
    type Slot = { name: string; envelope: unknown; wrappedKey: unknown; version: string; updatedDay: string };
    const slots = new Map<string, Slot>();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://x');
      const method = init?.method ?? 'GET';
      if (url.pathname === '/api/vault/records' && method === 'GET') return json(200, { records: [] });
      if (url.pathname === '/api/vault/records' && method === 'POST') return json(500, { error: 'must not be called' });
      if (url.pathname.startsWith('/api/vault/slots/') && method === 'GET') return json(200, { slot: slots.get(url.pathname.split('/').pop()!) ?? null, draftMode: 'slot' });
      if (url.pathname.startsWith('/api/vault/slots/') && method === 'PUT') {
        const body = JSON.parse(String(init!.body));
        const name = url.pathname.split('/').pop()!;
        if ((slots.get(name)?.version ?? null) !== body.expectedVersion) return json(409, { error: 'stale', code: 'slot_conflict' });
        const saved = { name, envelope: body.envelope, wrappedKey: body.wrappedKey, version: 'a'.repeat(32), updatedDay: '2026-11-14' };
        slots.set(name, saved);
        return json(200, { version: saved.version, updatedDay: saved.updatedDay, draftMode: 'slot' });
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
    const s = current!.session!;
    const slot = slots.get(await slotName(s.masterKey, 'draft'));
    expect(slot!.version).toBe('a'.repeat(32));
    const opened = await openSlot<{ kind: string; evidence: Array<{ fileName: string }> }>(slot as never, s.masterKey);
    expect(opened.kind).toBe('draft');
    expect(opened.evidence.map((e) => e.fileName)).toEqual(['note.pdf']);
    expect((await current!.getWorkingData())?.slotVersion).toBe('a'.repeat(32));
  }, 60_000);
});

describe('Evidence: the evidence reader (PR 31)', () => {
  it('says plainly which files are not cleaned, warns for one that is not, and sends the server only a salted commitment', async () => {
    const user = userEvent.setup();
    const base = fakeAuthFetch();
    const slots = new Map<string, { name: string; envelope: unknown; wrappedKey: unknown; version: string; updatedDay: string }>();
    let v = 0;
    const sent: string[] = [];
    let blobHeaders: Record<string, string> = {};
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://x');
      const method = init?.method ?? 'GET';
      if (method !== 'GET') sent.push(`${method} ${url.pathname} ${JSON.stringify(init?.headers ?? {})} ${typeof init?.body === 'string' ? init.body : ''}`);
      if (url.pathname === '/api/vault/records' && method === 'GET') return json(200, { records: [] });
      if (url.pathname.startsWith('/api/vault/slots/') && method === 'GET') return json(200, { slot: slots.get(url.pathname.split('/').pop()!) ?? null, draftMode: 'slot' });
      if (url.pathname.startsWith('/api/vault/slots/') && method === 'PUT') {
        const body = JSON.parse(String(init!.body));
        const name = url.pathname.split('/').pop()!;
        if ((slots.get(name)?.version ?? null) !== body.expectedVersion) return json(409, { error: 'stale', code: 'slot_conflict' });
        const saved = { name, envelope: body.envelope, wrappedKey: body.wrappedKey, version: (++v).toString(16).padStart(32, '0'), updatedDay: '2026-11-16' };
        slots.set(name, saved);
        return json(200, { version: saved.version, updatedDay: saved.updatedDay, draftMode: 'slot' });
      }
      if (url.pathname === '/api/vault/blobs' && method === 'GET') return json(200, { blobs: [] });
      if (url.pathname === '/api/vault/blobs' && method === 'POST') {
        blobHeaders = init!.headers as Record<string, string>;
        sent.push(Array.from(init!.body as Uint8Array, (b) => b.toString(16).padStart(2, '0')).join(''));
        const at = '2026-11-16T00:00:00Z';
        const entry = (type: string, h: string) => ({ id: `l-${type}`, seq: 9, type, subjectId: 'c'.repeat(32), contentHash: h, prevHash: 'p', entryHash: 'e', timestamp: at });
        return json(201, {
          blob: { id: 'c'.repeat(32), ownerId: 'u', sizeBytes: 4, contentHash: 'h', createdAt: at, ledgerEntryId: 'l9', ownerWrappedKey: {} },
          ledgerEntry: entry('blob.sealed', 'h'),
          ...(blobHeaders['X-Evidence-Commitment'] && { commitmentEntry: entry('evidence.committed', blobHeaders['X-Evidence-Commitment']) }),
        });
      }
      if (url.pathname.startsWith('/api/ledger/entries/')) return json(404, { error: 'not found' });
      return base.fetchImpl(input, init);
    });
    const { rerender } = render(<Harness fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await act(async () => {
      await current!.register({ username: 'wren-reader', passphrase: 'acorn-otter-river-lilac-tulip-zebra', role: 'survivor', ageConfirmed18: true });
    });
    rerender(
      <Harness fetchImpl={fetchImpl as unknown as typeof fetch}>
        <MemoryRouter>
          <Evidence />
        </MemoryRouter>
      </Harness>,
    );
    // before anything is added she is told, in plain words, which files are cleaned and which are not
    expect(await screen.findByTestId('import-format-notice')).toHaveTextContent(/only from JPEG, PNG and WebP photos/);
    expect(screen.getByTestId('import-format-notice')).toHaveTextContent(/HEIC photos, videos, recordings, PDFs/);

    const bytes = new TextEncoder().encode('some pdf bytes that only I have');
    const plain = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
    await user.upload(await screen.findByLabelText('Choose evidence files'), new File([bytes], 'texts.pdf', { type: 'application/pdf' }));
    const row = await screen.findByTestId('evidence-just-added', {}, { timeout: 15_000 });
    expect(within(row).getByTestId('unstripped-warning')).toHaveTextContent(/Hidden details were not removed from this file/);
    const commitment = within(row).getByTestId('commitment').textContent!.replace(/^.*: /, '');
    expect(commitment).toMatch(/^[0-9a-f]{64}$/);
    expect(commitment).not.toBe(plain);
    expect(blobHeaders['X-Evidence-Commitment']).toBe(commitment);
    // nothing sent to the server (bodies, headers, URLs) contains the plain hash of her original
    for (const line of sent) expect(line).not.toContain(plain);
    // it is not on the sealed-record side either: the draft slot's file details carry no salt and no original hash
    expect(await screen.findByText('Saved to your space and added to your draft story.', {}, { timeout: 15_000 })).toBeInTheDocument();
    const s = current!.session!;
    const draft = await openSlot<{ evidence: object[] }>(slots.get(await slotName(s.masterKey, 'draft')) as never, s.masterKey);
    expect(JSON.stringify(draft.evidence)).not.toContain(commitment);
    const priv = await openSlot<{ items: Record<string, { originalSha256: string; salt: string; commitment: string }> }>(slots.get(await slotName(s.masterKey, 'evidence-private')) as never, s.masterKey);
    const mine = Object.values(priv.items)[0]!;
    expect(mine.originalSha256).toBe(plain);
    expect(mine.commitment).toBe(commitment);
    expect(sent.join('\n')).not.toContain(mine.salt);
  }, 60_000);

  it('when the server keeps every save for good: "keep the original" is switched off with a plain reason, and the screenshot note still shows', async () => {
    const user = userEvent.setup();
    const base = fakeAuthFetch();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://x');
      const method = init?.method ?? 'GET';
      if (url.pathname === '/api/vault/records' && method === 'GET') return json(200, { records: [] });
      if (url.pathname.startsWith('/api/vault/slots/') && method === 'GET') return json(200, { slot: null, draftMode: 'keep-versions' });
      if (url.pathname.startsWith('/api/vault/slots/') && method === 'PUT') return json(200, { version: 'a'.repeat(32), updatedDay: '2026-11-16', draftMode: 'keep-versions' });
      if (url.pathname === '/api/vault/blobs' && method === 'GET') return json(200, { blobs: [] });
      if (url.pathname === '/api/vault/blobs' && method === 'POST') {
        const at = '2026-11-16T00:00:00Z';
        return json(201, {
          blob: { id: 'd'.repeat(32), ownerId: 'u', sizeBytes: 4, contentHash: 'h', createdAt: at, ledgerEntryId: 'l9', ownerWrappedKey: {} },
          ledgerEntry: { id: 'l9', seq: 9, type: 'blob.sealed', subjectId: 'd'.repeat(32), contentHash: 'h', prevHash: 'p', entryHash: 'e', timestamp: at },
        });
      }
      if (url.pathname.startsWith('/api/ledger/entries/')) return json(404, { error: 'not found' });
      return base.fetchImpl(input, init);
    });
    const { rerender } = render(<Harness fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await act(async () => {
      await current!.register({ username: 'wren-keepver', passphrase: 'acorn-otter-river-lilac-tulip-zebra', role: 'survivor', ageConfirmed18: true });
    });
    rerender(
      <Harness fetchImpl={fetchImpl as unknown as typeof fetch}>
        <MemoryRouter>
          <Evidence />
        </MemoryRouter>
      </Harness>,
    );
    await screen.findByLabelText('Choose evidence files');
    await user.click(await screen.findByText('More about fingerprints and originals'));
    const box = await screen.findByLabelText(/Also keep the original of the next file I add/);
    await vi.waitFor(() => expect(box).toBeDisabled());
    expect(screen.getByTestId('keep-original-unavailable')).toHaveTextContent(/isn’t available right now.*Please keep the original on your device/);
    await user.upload(screen.getByLabelText('Choose evidence files'), new File([new Uint8Array([1, 2, 3])], 'Screenshot 2026-03-03 at 10.12.04.png', { type: 'image/png' }));
    const row = await screen.findByTestId('evidence-just-added', {}, { timeout: 15_000 });
    expect(within(row).getByTestId('screenshot-note')).toHaveTextContent(/Its name or size matches a screenshot’s\. Please keep the original messages on your phone too/);
    expect(within(row).getByText(/keeps every save permanently/)).toBeInTheDocument();
  }, 60_000);
});
