import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { sealSlot, slotName } from '@matra/crypto';
import { fakeAuthFetch } from '../test/fakeServer';
import { Harness, current } from '../test/sessionHarness';
import { Evidence } from './Evidence';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// What the import returns when the private signal says "screenshot" but the shared record's `kind` says "photo".
vi.mock('../lib/vault', async (orig) => {
  const real = await orig<typeof import('../lib/vault')>();
  return {
    ...real,
    uploadEvidence: async (_api: unknown, _key: unknown, file: File) => ({
      item: { id: 'i-new', kind: 'photo', fileName: file.name, mimeType: 'image/png', sizeBytes: 3, sha256: 'a'.repeat(64), blobId: 'e'.repeat(32), metadataStripped: true },
      details: { screenshotLikely: true },
      plaintext: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
      note: 'ok',
      warning: null,
      privateNote: null,
      ledgerEntry: { id: 'l9', seq: 9, type: 'blob.sealed', subjectId: 'e'.repeat(32), contentHash: 'h', prevHash: 'p', entryHash: 'e', timestamp: '2026-11-16T00:00:00Z' },
    }),
  };
});

describe('Evidence: the screenshot badge and note follow either signal', () => {
  it('shows them when only the private signal says screenshot (just added), and the badge on a listed file', async () => {
    const user = userEvent.setup();
    const base = fakeAuthFetch();
    type Slot = { name: string; envelope: unknown; wrappedKey: unknown; version: string; updatedDay: string };
    const slots = new Map<string, Slot>();
    const at = '2026-11-16T00:00:00Z';
    const blobs = [{ id: 'f'.repeat(32), ownerId: 'u', sizeBytes: 3, contentHash: 'h', createdAt: at, ledgerEntryId: 'l1', ownerWrappedKey: {} }];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://x');
      const method = init?.method ?? 'GET';
      if (url.pathname === '/api/vault/records' && method === 'GET') return json(200, { records: [] });
      if (url.pathname.startsWith('/api/vault/slots/') && method === 'GET') return json(200, { slot: slots.get(url.pathname.split('/').pop()!) ?? null, draftMode: 'slot' });
      if (url.pathname.startsWith('/api/vault/slots/') && method === 'PUT') {
        const body = JSON.parse(String(init!.body));
        const name = url.pathname.split('/').pop()!;
        const saved = { name, envelope: body.envelope, wrappedKey: body.wrappedKey, version: 'b'.repeat(32), updatedDay: '2026-11-16' };
        slots.set(name, saved);
        return json(200, { version: saved.version, updatedDay: saved.updatedDay, draftMode: 'slot' });
      }
      if (url.pathname === '/api/vault/blobs' && method === 'GET') return json(200, { blobs });
      if (url.pathname.startsWith('/api/ledger/entries/')) return json(404, { error: 'not found' });
      return base.fetchImpl(input, init);
    });
    const { rerender } = render(<Harness fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await act(async () => {
      await current!.register({ username: 'wren-shot', passphrase: 'acorn-otter-river-lilac-tulip-zebra', role: 'survivor', ageConfirmed18: true });
    });
    const s = current!.session!;
    // a listed file whose shared record says "photo" but whose private details say "screenshot"
    const item = { id: 'i-old', kind: 'photo', fileName: 'chat.png', mimeType: 'image/png', sizeBytes: 3, sha256: 'c'.repeat(64), blobId: blobs[0]!.id, metadataStripped: true };
    const draftName = await slotName(s.masterKey, 'draft');
    const privName = await slotName(s.masterKey, 'evidence-private');
    slots.set(draftName, { name: draftName, ...(await sealSlot({ kind: 'draft', slotVersion: 1, evidence: [item], savedAt: at }, s.masterKey)), version: 'a'.repeat(32), updatedDay: '2026-11-16' } as Slot);
    slots.set(privName, { name: privName, ...(await sealSlot({ kind: 'evidence-private', v: 1, savedAt: at, items: { 'i-old': { screenshotLikely: true } } }, s.masterKey)), version: 'a'.repeat(32), updatedDay: '2026-11-16' } as Slot);
    rerender(
      <Harness fetchImpl={fetchImpl as unknown as typeof fetch}>
        <MemoryRouter>
          <Evidence />
        </MemoryRouter>
      </Harness>,
    );
    const listed = await screen.findByTestId('file-1', {}, { timeout: 15_000 });
    expect(within(listed).getByText('Screenshot')).toBeInTheDocument();

    await user.upload(await screen.findByLabelText('Choose evidence files'), new File([new Uint8Array([1, 2, 3])], 'IMG_0001.png', { type: 'image/png' }));
    const row = await screen.findByTestId('evidence-just-added', {}, { timeout: 15_000 });
    expect(within(row).getByText('Screenshot')).toBeInTheDocument();
    expect(within(row).getByTestId('screenshot-note')).toHaveTextContent(/Please keep the original messages on your phone too/);
  }, 60_000);
});

describe('Evidence: exhibit numbers on the screen', () => {
  it('a file that cannot be traced to a file she has details for takes no number, and the exhibit list and the rows agree', async () => {
    const base = fakeAuthFetch();
    type Slot = { name: string; envelope: unknown; wrappedKey: unknown; version: string; updatedDay: string };
    const slots = new Map<string, Slot>();
    const blob = (id: string, createdAt: string, contentHash = 'h') => ({ id: id.repeat(32), ownerId: 'u', sizeBytes: 3, contentHash, createdAt, ledgerEntryId: `l${id}`, ownerWrappedKey: {} });
    const PENDING = 'c'.repeat(64);
    const blobs = [blob('1', '2026-11-01T00:00:00Z'), blob('2', '2026-11-02T00:00:00Z'), blob('3', '2026-11-02T00:00:01Z', PENDING), blob('4', '2026-11-03T00:00:00Z')];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://x');
      const method = init?.method ?? 'GET';
      if (url.pathname === '/api/vault/records' && method === 'GET') return json(200, { records: [] });
      if (url.pathname.startsWith('/api/vault/slots/') && method === 'GET') return json(200, { slot: slots.get(url.pathname.split('/').pop()!) ?? null, draftMode: 'slot' });
      if (url.pathname === '/api/vault/blobs' && method === 'GET') return json(200, { blobs });
      return base.fetchImpl(input, init);
    });
    const { rerender } = render(<Harness fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await act(async () => {
      await current!.register({ username: 'wren-nums', passphrase: 'acorn-otter-river-lilac-tulip-zebra', role: 'survivor', ageConfirmed18: true });
    });
    const s = current!.session!;
    const mk = (id: string, name: string, blobId: string) => ({ id, kind: 'photo', fileName: name, mimeType: 'image/png', sizeBytes: 3, sha256: 'c'.repeat(64), blobId, metadataStripped: true });
    const evidence = [mk('iA', 'receipt.png', blobs[1]!.id), mk('iB', 'Redacted copy of exhibit 1 - receipt.png', blobs[3]!.id)];
    const draftName = await slotName(s.masterKey, 'draft');
    const privName = await slotName(s.masterKey, 'evidence-private');
    const at = '2026-11-16T00:00:00Z';
    slots.set(draftName, { name: draftName, ...(await sealSlot({ kind: 'draft', slotVersion: 1, evidence, savedAt: at }, s.masterKey)), version: 'a'.repeat(32), updatedDay: '2026-11-16' } as Slot);
    slots.set(privName, { name: privName, ...(await sealSlot({ kind: 'evidence-private', v: 1, savedAt: at, items: { iA: { originalPending: { ciphertextSha256: PENDING, blobId: blobs[2]!.id } }, iB: { derivedFrom: 'iA' } } }, s.masterKey)), version: 'a'.repeat(32), updatedDay: '2026-11-16' } as Slot);
    rerender(
      <Harness fetchImpl={fetchImpl as unknown as typeof fetch}>
        <MemoryRouter>
          <Evidence />
        </MemoryRouter>
      </Harness>,
    );
    expect(await screen.findByTestId('file-1', {}, { timeout: 15_000 })).toHaveTextContent(/1\. receipt\.png/);
    expect(screen.getByTestId('file-2')).toHaveTextContent(/2\. Redacted copy of exhibit 1/);
    expect(screen.queryByTestId('file-3')).toBeNull(); // the unnamed file and the unlinked original take no number
    const table = screen.getByTestId('exhibit-list');
    expect(within(table).getByTestId('exhibit-row-1')).toHaveTextContent('receipt.png');
    expect(within(table).getByTestId('exhibit-row-2')).toHaveTextContent('Redacted copy of exhibit 1');
    expect(within(table).queryByTestId('exhibit-row-3')).toBeNull();
    // the original her own record names (the id saved when its upload returned) is not listed as a file of its own; the unnamed one still is (as a locked file, no number). The server's hash for a blob never hides it.
    expect(within(screen.getByTestId('evidence-in-space')).getAllByText('Locked file')).toHaveLength(1);
  }, 60_000);
});
