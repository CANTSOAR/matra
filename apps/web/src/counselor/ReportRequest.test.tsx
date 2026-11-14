import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { encryptJSON, generateContentKey, wrapKeyWithMaster } from '@matra/crypto';
import type { SurvivorReportRequest, VaultRecord } from '@matra/shared';
import { envelopeHash } from '../api/client';
import { sampleRecord } from '../brief/fixtures';
import { fakeAuthFetch } from '../test/fakeServer';
import { Harness, current } from '../test/sessionHarness';
import { ReportRequest } from './ReportRequest';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('ReportRequest: saved versions that could not be opened', () => {
  it('shows the note and keeps "Yes, share my report" off, so an older version is never wrapped to the counselor', async () => {
    const user = userEvent.setup();
    const base = fakeAuthFetch();
    const records: VaultRecord[] = [];
    const requests: SurvivorReportRequest[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://x');
      if (url.pathname === '/api/report-requests') return json(200, { requests });
      if (url.pathname === '/api/escrow') return json(200, { entries: [] });
      if (url.pathname === '/api/vault/records') return json(200, { records });
      if (url.pathname.startsWith('/api/vault/records/')) {
        const id = decodeURIComponent(url.pathname.split('/').pop()!);
        if (id === 'r-newest') return json(500, { error: 'Something went wrong' }); // her newest sealed version
        return json(200, { record: records.find((r) => r.id === id) });
      }
      if (url.pathname.startsWith('/api/ledger/entries/')) return json(404, { error: 'not found' });
      return base.fetchImpl(input, init);
    });
    const { rerender } = render(<Harness fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await act(async () => {
      await current!.register({ username: 'wren-report', passphrase: 'acorn-maple-violin-otter-quartz', role: 'survivor', ageConfirmed18: true });
    });
    const s = current!.session!;
    const key = await generateContentKey();
    const envelope = await encryptJSON({ kind: 'final', record: sampleRecord, savedAt: '2026-08-19T00:00:00Z' }, key);
    const older: VaultRecord = {
      id: 'r-older', ownerId: s.user.id, createdAt: '2026-08-19T00:00:00Z', contentHash: await envelopeHash(envelope),
      ledgerEntryId: 'l1', envelope, ownerWrappedKey: await wrapKeyWithMaster(key, s.masterKey),
    };
    records.push(older, { ...older, id: 'r-newest', createdAt: '2026-08-20T00:00:00Z', supersedes: 'r-older' });
    requests.push({
      id: 'rq1', entryId: 'e1', status: 'pending', createdAt: '2026-09-01T00:00:00Z',
      counselor: { userId: 'c1', displayName: 'Counselor Test', jurisdictions: ['NJ'], publicKey: s.user.publicKey },
    });
    rerender(
      <Harness fetchImpl={fetchImpl as unknown as typeof fetch}>
        <MemoryRouter initialEntries={['/vault/requests/rq1']}>
          <Routes>
            <Route path="/vault/requests/:id" element={<ReportRequest />} />
          </Routes>
        </MemoryRouter>
      </Harness>,
    );

    expect(await screen.findByTestId('vault-unreadable', {}, { timeout: 15_000 })).toHaveTextContent(/couldn’t open one saved version/);
    // this build pins no roster key, so she confirms the fingerprint by hand; even with both boxes ticked, sharing stays off
    await user.click(screen.getByLabelText('This matches what the counselor told me.'));
    await user.click(screen.getByLabelText('I agree to the statement above.'));
    expect(screen.getByRole('button', { name: 'Yes, share my report' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'No, don’t share' })).toBeEnabled();
    expect(fetchImpl.mock.calls.some(([u]) => String(u).includes('/consent'))).toBe(false);
  }, 60_000);
});
