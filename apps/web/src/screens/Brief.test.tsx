import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sealSlot, slotName } from '@matra/crypto';
import { sampleRecord } from '../brief/fixtures';
import { fakeAuthFetch } from '../test/fakeServer';
import { storedRecord, vaultRoutes } from '../test/fakeVault';
import { Harness, current } from '../test/sessionHarness';
import { Brief } from './Brief';

const generated = vi.fn();
vi.mock('../integration/briefAdapter', () => ({
  BriefPreview: ({ opts }: { opts?: { exhibitNumbers?: Record<string, number> } }) => <div data-testid="preview">{JSON.stringify(opts?.exhibitNumbers ?? null)}</div>,
  downloadPdf: vi.fn(),
  generateIncidentSummary: async (...args: unknown[]) => {
    generated(...args);
    return new Uint8Array([1]);
  },
  generateVccoDraft: async () => new Uint8Array([1]),
  incidentSummaryFilename: () => 'summary.pdf',
}));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** blobs oldest first: 1 unnamed, 2 receipt (in the sealed version), 5 a file only in her draft slot, 4 a redacted copy (sealed) */
const blob = (id: string, createdAt: string) => ({ id: id.repeat(32), ownerId: 'u', sizeBytes: 3, contentHash: 'h', createdAt, ledgerEntryId: `l${id}`, ownerWrappedKey: {} });
const BLOBS = [blob('1', '2026-11-01T00:00:00Z'), blob('2', '2026-11-02T00:00:00Z'), blob('5', '2026-11-02T12:00:00Z'), blob('4', '2026-11-03T00:00:00Z')];
const item = (id: string, name: string, blobId: string) => ({ id, kind: 'photo', fileName: name, mimeType: 'image/png', sizeBytes: 3, sha256: 'c'.repeat(64), blobId, metadataStripped: true });

async function open(opts: { blobsStatus?: number; blobs?: typeof BLOBS } = {}) {
  const base = fakeAuthFetch();
  type Slot = { name: string; envelope: unknown; wrappedKey: unknown; version: string; updatedDay: string };
  const slots = new Map<string, Slot>();
  const stored: Awaited<ReturnType<typeof storedRecord>>[] = [];
  const routes = vaultRoutes(stored);
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://x');
    const method = init?.method ?? 'GET';
    const hit = routes(input, init);
    if (hit) return hit;
    if (url.pathname.startsWith('/api/vault/slots/') && method === 'GET') return json(200, { slot: slots.get(url.pathname.split('/').pop()!) ?? null, draftMode: 'slot' });
    if (url.pathname === '/api/vault/blobs' && method === 'GET') return opts.blobsStatus ? json(opts.blobsStatus, { error: 'Something went wrong' }) : json(200, { blobs: opts.blobs ?? BLOBS });
    return base.fetchImpl(input, init);
  });
  const { rerender } = render(<Harness fetchImpl={fetchImpl as unknown as typeof fetch} />);
  await act(async () => {
    await current!.register({ username: `wren-brief-${Math.random().toString(36).slice(2, 7)}`, passphrase: 'acorn-otter-river-lilac-tulip-zebra', role: 'survivor', ageConfirmed18: true });
  });
  const s = current!.session!;
  const sealedItems = [item('iA', 'receipt.png', '2'.repeat(32)), item('iB', 'Redacted copy of exhibit 1 - receipt.png', '4'.repeat(32))];
  stored.push(await storedRecord(s.masterKey, { kind: 'final', record: { ...sampleRecord, evidence: sealedItems }, savedAt: '2026-11-04T00:00:00Z' }, { id: 'r-final' }));
  const draftName = await slotName(s.masterKey, 'draft');
  slots.set(draftName, { name: draftName, ...(await sealSlot({ kind: 'draft', slotVersion: 1, evidence: [...sealedItems, item('iC', 'letter.png', '5'.repeat(32))], savedAt: '2026-11-04T00:00:00Z' }, s.masterKey)), version: 'a'.repeat(32), updatedDay: '2026-11-04' } as Slot);
  rerender(
    <Harness fetchImpl={fetchImpl as unknown as typeof fetch}>
      <MemoryRouter>
        <Brief />
      </MemoryRouter>
    </Harness>,
  );
}

beforeEach(() => generated.mockClear());

describe('Brief: the exhibit numbers in the summary are the ones on the Evidence screen', () => {
  it('numbers from her whole space (a file only in her draft takes its place), in the preview and in the PDF’s options', async () => {
    const user = userEvent.setup();
    await open();
    // numbered over the merged set: receipt 1, letter (draft only) 2, redacted copy 3. Numbering from the sealed version alone would give the copy 2.
    const expected = { ['2'.repeat(32)]: 1, ['5'.repeat(32)]: 2, ['4'.repeat(32)]: 3 };
    expect(JSON.parse((await screen.findByTestId('preview', {}, { timeout: 15_000 })).textContent!)).toEqual(expected);
    await user.click(await screen.findByRole('button', { name: /Download incident summary/ }));
    await vi.waitFor(() => expect(generated).toHaveBeenCalled());
    expect((generated.mock.calls[0]![1] as { exhibitNumbers: Record<string, number> }).exhibitNumbers).toEqual(expected);
  }, 60_000);

  it('the stored files cannot be listed: no preview and no summary, with the reason, never a table without numbers', async () => {
    const user = userEvent.setup();
    await open({ blobsStatus: 500 });
    await vi.waitFor(() => expect(screen.getByText(/Something went wrong|try again|couldn’t/i)).toBeInTheDocument(), { timeout: 15_000 });
    expect(screen.queryByTestId('preview')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Download incident summary/ }));
    await vi.waitFor(() => expect(screen.getAllByText(/Something went wrong|try again|couldn’t/i).length).toBeGreaterThan(0));
    expect(generated).not.toHaveBeenCalled();
  }, 60_000);

  it('the summary names a stored file the server did not list: an error, not a renumbering', async () => {
    const user = userEvent.setup();
    await open({ blobs: BLOBS.filter((b) => b.id !== '4'.repeat(32)) });
    await vi.waitFor(() => expect(screen.getByText(/couldn’t find a stored file that your story lists \(Redacted copy of exhibit 1 - receipt\.png\).*Nothing was made/)).toBeInTheDocument(), { timeout: 15_000 });
    expect(screen.queryByTestId('preview')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Download incident summary/ }));
    await vi.waitFor(() => expect(screen.getAllByText(/Nothing was made/).length).toBeGreaterThan(1));
    expect(generated).not.toHaveBeenCalled();
  }, 60_000);
});
