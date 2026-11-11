import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { LEDGER_GENESIS_HASH, ledgerEntryHash, sha256Hex } from '@matra/crypto';
import type { LedgerProofResponse } from '@matra/shared';
import { generateIncidentSummary } from '../brief';
import { sampleBriefOptions, sampleRecord } from '../brief/fixtures';
import { Harness } from '../test/sessionHarness';
import { VerifyPage } from './VerifyPage';

const RECORD_HASH = 'a'.repeat(64);

/** A one-entry ledger sealing RECORD_HASH for record "rec-1". */
function ledger(): LedgerProofResponse {
  const e = { seq: 1, id: 'entry-1', type: 'record.sealed', subjectId: 'rec-1', contentHash: RECORD_HASH, timestamp: '2026-11-01T10:00:00.000Z', prevHash: LEDGER_GENESIS_HASH };
  const entry = { ...e, entryHash: ledgerEntryHash(e) };
  return { entries: [entry], links: [{ seq: 1, prevHash: entry.prevHash, entryHash: entry.entryHash }], head: { seq: 1, entryHash: entry.entryHash }, truncated: false };
}

async function setup(proof: LedgerProofResponse) {
  const asked: string[][] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://x');
    if (url.pathname === '/api/ledger/proof' && init?.method === 'POST') {
      const { contentHashes } = JSON.parse(String(init.body)) as { contentHashes: string[] };
      asked.push(contentHashes);
      const found = proof.entries.filter((e) => contentHashes.includes(e.contentHash));
      return new Response(JSON.stringify(found.length ? proof : { ...proof, entries: [], links: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
  render(
    <Harness fetchImpl={fetchImpl}>
      <MemoryRouter>
        <VerifyPage />
      </MemoryRouter>
    </Harness>,
  );
  return { user: userEvent.setup(), asked, fetchImpl: fetchImpl as unknown as ReturnType<typeof vi.fn> };
}

async function summaryWithEvidence(files: Uint8Array[], recordId = 'rec-1') {
  const evidence = await Promise.all(
    files.map(async (bytes, i) => ({ ...sampleRecord.evidence[0]!, id: `e${i}`, fileName: `file-${i}.jpg`, sha256: await sha256Hex(bytes), sizeBytes: bytes.length })),
  );
  const pdf = await generateIncidentSummary({ ...sampleRecord, evidence }, { ...sampleBriefOptions, recordId, recordContentHash: RECORD_HASH, ledgerEntry: undefined });
  return new File([pdf as BlobPart], 'summary.pdf', { type: 'application/pdf' });
}

const bytes = (s: string) => new TextEncoder().encode(s);

describe('Check a file (/verify)', () => {
  it('reads the PDF, hashes the files on this device, and shows green results; only the record hash is sent', async () => {
    const ev = [bytes('photo one'), bytes('photo two'), bytes('photo three')];
    const pdf = await summaryWithEvidence(ev);
    const { user, asked, fetchImpl } = await setup(ledger());
    await user.upload(screen.getByLabelText('Choose files to check'), [pdf, ...ev.map((b, i) => new File([b as BlobPart], `IMG_${i}.jpg`))]);
    const result = await screen.findByTestId('verify-result', {}, { timeout: 15_000 });
    await waitFor(() => expect(result).toHaveAttribute('data-tone', 'ok'));
    const lines = within(result).getAllByRole('listitem').filter((li) => li.hasAttribute('data-check'));
    expect(lines.map((l) => l.getAttribute('data-tone'))).toEqual(['ok', 'ok', 'ok']);
    expect(result).toHaveTextContent(/The sealed account behind this summary is in the ledger: sealed on /);
    expect(result).toHaveTextContent('3 of 3 evidence files match.');
    expect(result).toHaveTextContent('Ledger chain intact through entry 1.');
    // the only request: the record's hash. No file, no file hash.
    expect(asked).toEqual([[RECORD_HASH]]);
    expect(fetchImpl.mock.calls).toHaveLength(1);
  });

  it('a tampered evidence file is named in red', async () => {
    const ev = [bytes('original screenshot')];
    const pdf = await summaryWithEvidence(ev);
    const { user } = await setup(ledger());
    await user.upload(screen.getByLabelText('Choose files to check'), [pdf, new File([bytes('edited screenshot') as BlobPart], 'screenshot.png')]);
    const result = await screen.findByTestId('verify-result', {}, { timeout: 15_000 });
    await waitFor(() => expect(result).toHaveAttribute('data-tone', 'bad'));
    expect(result).toHaveTextContent('screenshot.png doesn’t match any file in this summary.');
  });

  it('a summary that names a different record than the ledger entry is red', async () => {
    const pdf = await summaryWithEvidence([], 'rec-other');
    const { user } = await setup(ledger());
    await user.upload(screen.getByLabelText('Choose files to check'), [pdf]);
    const result = await screen.findByTestId('verify-result', {}, { timeout: 15_000 });
    await waitFor(() => expect(result).toHaveTextContent(/belongs to a different record/));
    expect(result).toHaveAttribute('data-tone', 'bad');
  });

  it('a broken chain is red', async () => {
    const proof = ledger();
    proof.head = { seq: 2, entryHash: 'f'.repeat(64) }; // the chain sent does not reach the published head
    const pdf = await summaryWithEvidence([]);
    const { user } = await setup(proof);
    await user.upload(screen.getByLabelText('Choose files to check'), [pdf]);
    const result = await screen.findByTestId('verify-result', {}, { timeout: 15_000 });
    await waitFor(() => expect(result).toHaveTextContent(/The ledger chain is broken/));
  });
});
