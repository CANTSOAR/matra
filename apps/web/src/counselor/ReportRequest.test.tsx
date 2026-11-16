import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { SurvivorReportRequest } from '@matra/shared';
import { sampleRecord } from '../brief/fixtures';
import { fakeAuthFetch } from '../test/fakeServer';
import { storedRecord, vaultRoutes, type StoredRecord } from '../test/fakeVault';
import { Harness, current } from '../test/sessionHarness';
import { ReportRequest } from './ReportRequest';

// This file tests sealed matching: it runs with it on (MATRA_MATCHING=on), whatever the build default is. Set before
// any import is evaluated, because the matching screens and questions are chosen when their modules load.
vi.hoisted(() => {
  (globalThis as { __MATRA_MATCHING__?: boolean }).__MATRA_MATCHING__ = true;
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('ReportRequest fails closed: only a space that loaded cleanly is released', () => {
  it('her newest version doesn’t match what she saved: she sees why, and there is nothing to say yes to', async () => {
    const base = fakeAuthFetch();
    const stored: StoredRecord[] = [];
    const routes = vaultRoutes(stored);
    const requests: SurvivorReportRequest[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://x');
      if (url.pathname === '/api/report-requests') return json(200, { requests });
      if (url.pathname === '/api/escrow') return json(200, { entries: [] });
      return routes(input, init) ?? base.fetchImpl(input, init);
    });
    const { rerender } = render(<Harness fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await act(async () => {
      await current!.register({ username: 'wren-report', passphrase: 'acorn-otter-river-lilac-tulip-zebra', role: 'survivor', ageConfirmed18: true });
    });
    const s = current!.session!;
    stored.push(
      await storedRecord(s.masterKey, { kind: 'final', record: sampleRecord, savedAt: '2026-08-19T00:00:00Z' }, { id: 'r-older' }),
      await storedRecord(s.masterKey, { kind: 'final', record: sampleRecord, savedAt: '2026-08-20T00:00:00Z' }, { id: 'r-newest', supersedes: 'r-older' }),
    );
    // her newest sealed version's ciphertext was changed on the server
    const env = stored[1]!.record.envelope;
    stored[1]!.record.envelope = { ...env, ct: env.ct.slice(0, -8) + 'AAAAAAA=' };
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

    expect(await screen.findByTestId('vault-stopped', {}, { timeout: 15_000 })).toHaveTextContent(/doesn’t match what you saved/);
    expect(screen.queryByRole('button', { name: 'Yes, share my report' })).toBeNull();
    expect(fetchImpl.mock.calls.some(([u]) => String(u).includes('/consent'))).toBe(false);
  }, 60_000);
});

describe('ReportRequest: only the sealed account itself is ever released', () => {
  it('a version sealed before draft slots (also holding her draft and fingerprints) is never wrapped to the counselor', async () => {
    const user = userEvent.setup();
    const base = fakeAuthFetch();
    const stored: StoredRecord[] = [];
    const routes = vaultRoutes(stored);
    const requests: SurvivorReportRequest[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://x');
      if (url.pathname === '/api/report-requests') return json(200, { requests });
      if (url.pathname === '/api/escrow') return json(200, { entries: [] });
      return routes(input, init) ?? base.fetchImpl(input, init);
    });
    const { rerender } = render(<Harness fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await act(async () => {
      await current!.register({ username: 'wren-legacy', passphrase: 'acorn-otter-river-lilac-tulip-zebra', role: 'survivor', ageConfirmed18: true });
    });
    const s = current!.session!;
    stored.push(
      await storedRecord(
        s.masterKey,
        { kind: 'final', record: sampleRecord, draft: { answers: { 'person.matchContact': { detail: '555-0100' } } }, escrowedHashes: ['ab12'], savedAt: '2026-08-19T00:00:00Z' },
        { id: 'r-legacy', createdAt: '2026-08-19T00:00:00Z' },
      ),
    );
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

    expect(await screen.findByText(/saved in an older format that also keeps your working notes/, {}, { timeout: 15_000 })).toBeInTheDocument();
    await user.click(screen.getByLabelText('This matches what the counselor told me.'));
    await user.click(screen.getByLabelText('I agree to the statement above.'));
    expect(screen.getByRole('button', { name: 'Yes, share my report' })).toBeDisabled();
    expect(fetchImpl.mock.calls.some(([u]) => String(u).includes('/consent'))).toBe(false);
  }, 60_000);
});
