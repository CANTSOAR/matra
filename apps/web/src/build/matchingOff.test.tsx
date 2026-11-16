/**
 * A build without sealed matching (MATRA_MATCHING=off, the pilot default): no matching question is asked, nothing
 * opts in, no matching or counselor screen exists, Home shows no sealed-match section, and nothing she does calls a
 * matching route. The bundle check for the same thing is scripts/audit-web-build.mjs; the end-to-end one is
 * e2e/pilot.spec.ts.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { ApiClient } from '../api/client';
import { matchingApi } from '../api/matching';
import { draftToRecord, emptyDraft, STEPS, type IntakeDraft } from '../intake';
import { SPACE_PROMPTS } from '../intake/script';
import { COPY } from '../space/copy';
import { topicById } from '../space/topics';
import { buildDataExport } from '../lib/export';
import { fakeAuthFetch } from '../test/fakeServer';
import { Harness, current } from '../test/sessionHarness';
import { useSession } from '../lib/session';
import { Dashboard } from '../screens/Dashboard';

// Off, whatever MATRA_MATCHING this test run was started with (the CI matrix also runs the suite with it on).
vi.hoisted(() => {
  (globalThis as { __MATRA_MATCHING__?: boolean }).__MATRA_MATCHING__ = false;
});

const MATCHING_ROUTES = /^\/api\/(matching|escrow|counselor|report-requests|report-releases)(\/|$)/;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A fake server for a signed-in survivor with an empty vault, recording every path the app asks for. */
function recordingServer() {
  const base = fakeAuthFetch();
  const paths: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://x');
    paths.push(url.pathname);
    if (MATCHING_ROUTES.test(url.pathname)) return json(404, { error: 'Sealed matching isn’t part of this service.', code: 'matching_disabled' });
    if (url.pathname === '/api/vault/records') return json(200, { records: [] });
    if (url.pathname === '/api/vault/blobs') return json(200, { blobs: [] });
    if (url.pathname.startsWith('/api/vault/slots/')) return json(200, { slot: null, draftMode: 'slot' });
    if (url.pathname === '/api/shares') return json(200, { shares: [] });
    if (url.pathname === '/api/attorneys') return json(200, { attorneys: [] });
    if (url.pathname === '/api/audit') return json(200, { events: [] });
    return base.fetchImpl(input, init);
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, paths };
}

function Home() {
  return useSession().session ? <Dashboard /> : <p>Signed out</p>;
}

describe('matching off: the interview', () => {
  it('never asks for a sealed match or a counselor contact', () => {
    const ids = STEPS.map((s) => s.id);
    expect(ids).not.toContain('person.escrow');
    expect(ids).not.toContain('person.matchContact');
    expect(STEPS.some((s) => s.kind === 'escrow')).toBe(false);
    expect(Object.keys(SPACE_PROMPTS)).not.toContain('person.escrow');
    expect(topicById('person').steps).toEqual(['person.list']);
    // and the "you can choose a sealed match next" hint under her identifiers is not there to show
    expect(COPY.panel.onlineWhy).toBe('');
    expect(COPY.panel.escrowMore).toBe('');
  });

  it('never opts anyone in, even from an older draft that said yes', () => {
    const draft: IntakeDraft = {
      ...emptyDraft(new Date('2026-01-01T00:00:00Z')),
      answers: {
        'person.list': [{ id: 'p1', values: { name: 'R.', email: 'someone@example.com' } }],
        'person.escrow': { p1: 'yes' },
      },
    };
    const r = draftToRecord(draft);
    expect(r.perpetrators).toHaveLength(1);
    expect(r.perpetrators[0].escrowOptIn).toBe(false);
  });
});

describe('matching off: the app', () => {
  it('has no counselor link or route, and the session client has no matching calls', async () => {
    const { fetchImpl } = recordingServer();
    render(
      <Harness fetchImpl={fetchImpl}>
        <MemoryRouter initialEntries={['/counselor']}>
          <AppRoutes />
        </MemoryRouter>
      </Harness>,
    );
    // /counselor is not a route here: the catch-all sends her to the welcome page
    await screen.findByTestId('attorney-link');
    expect(screen.queryByTestId('counselor-link')).not.toBeInTheDocument();
    expect(current!.api).toBeInstanceOf(ApiClient);
    expect(() => matchingApi(current!.api)).toThrow(/not part of this build/);
  });

  it('Home never asks the server about sealed matches or report requests, and shows no sealed-match section', async () => {
    const { fetchImpl, paths } = recordingServer();
    render(
      <Harness fetchImpl={fetchImpl}>
        <MemoryRouter>
          <Home />
        </MemoryRouter>
      </Harness>,
    );
    await act(async () => {
      await current!.register({ username: 'wren-pilot', passphrase: 'acorn-otter-river-lilac-tulip-zebra', role: 'survivor', ageConfirmed18: true });
    });
    await screen.findByTestId('tile-sharing');
    await waitFor(() => expect(paths).toContain('/api/audit'));
    expect(screen.queryByTestId('home-escrow')).not.toBeInTheDocument();
    expect(screen.queryByText(/sealed match/i)).not.toBeInTheDocument();
    expect(paths.filter((p) => MATCHING_ROUTES.test(p))).toEqual([]);
  });

  it('(the same Home, in a build with sealed matching, does ask: so the check above can fail)', async () => {
    const g = globalThis as { __MATRA_MATCHING__?: boolean };
    g.__MATRA_MATCHING__ = true;
    try {
      const { fetchImpl, paths } = recordingServer();
      render(
        <Harness fetchImpl={fetchImpl}>
          <MemoryRouter>
            <Home />
          </MemoryRouter>
        </Harness>,
      );
      await act(async () => {
        await current!.register({ username: 'wren-on', passphrase: 'acorn-otter-river-lilac-tulip-zebra', role: 'survivor', ageConfirmed18: true });
      });
      await screen.findByTestId('home-escrow');
      await waitFor(() => expect(paths).toEqual(expect.arrayContaining(['/api/escrow', '/api/report-requests'])));
    } finally {
      g.__MATRA_MATCHING__ = false;
    }
  });

  it('“Download my data” has no escrow.json and never lists sealed entries', async () => {
    const { fetchImpl, paths } = recordingServer();
    const api = new ApiClient({ getToken: () => 't', fetchImpl });
    const { deriveKeys, newKdfSalt } = await import('@matra/crypto');
    const { masterKey } = await deriveKeys('pilot export passphrase', newKdfSalt(), 1000);
    const out = await buildDataExport(api, masterKey, 'wren');
    expect(new TextDecoder().decode(out.zip)).not.toMatch(/escrow\.json/);
    expect(paths.filter((p) => MATCHING_ROUTES.test(p))).toEqual([]);
  });
});
