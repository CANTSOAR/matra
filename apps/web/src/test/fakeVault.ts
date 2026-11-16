/**
 * Her records as the server would store them, for tests: a real envelope under a per-record key wrapped by her master
 * key, the content hash the server would compute, and the ledger entry that attests it. `vaultRoutes` answers the
 * records and ledger routes from such a list (for screens tested through a fetch mock); `vaultApi` is the same as an
 * ApiClient-shaped object (for lib tests). Tests break one of these on purpose to check that loading fails closed.
 */
import { encryptJSON, generateContentKey, wrapKeyWithMaster } from '@matra/crypto';
import type { LedgerEntry, VaultRecord } from '@matra/shared';
import { ApiError, envelopeHash, type ApiClient } from '../api/client';

export interface StoredRecord {
  record: VaultRecord;
  ledger: LedgerEntry;
}

let seq = 0;

/** Seal `payload` the way the server stores a record (no API call). */
export async function storedRecord(
  masterKey: CryptoKey,
  payload: unknown,
  opts: { id: string; createdAt?: string; supersedes?: string },
): Promise<StoredRecord> {
  const key = await generateContentKey();
  const envelope = await encryptJSON(payload, key);
  const contentHash = await envelopeHash(envelope);
  const createdAt = opts.createdAt ?? new Date(Date.UTC(2026, 0, 1, 0, ++seq)).toISOString();
  const ledgerId = `l-${opts.id}`;
  const record: VaultRecord = {
    id: opts.id,
    ownerId: 'u',
    ...(opts.supersedes && { supersedes: opts.supersedes }),
    createdAt,
    contentHash,
    ledgerEntryId: ledgerId,
    envelope,
    ownerWrappedKey: await wrapKeyWithMaster(key, masterKey),
  };
  const ledger: LedgerEntry = {
    seq: ++seq,
    id: ledgerId,
    type: 'record.sealed',
    subjectId: opts.id,
    contentHash,
    timestamp: createdAt,
    prevHash: '0'.repeat(64),
    entryHash: '1'.repeat(64),
  };
  return { record, ledger };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Answers GET /api/vault/records, /api/vault/records/:id and /api/ledger/entries/:id from `stored` (read at call time,
 * so tests can add records later). Returns null for any other route. `fail` can answer a record or ledger id with an
 * error status instead.
 */
export function vaultRoutes(stored: StoredRecord[], fail: { record?: Record<string, number>; ledger?: Record<string, number> } = {}) {
  return (input: RequestInfo | URL, init?: RequestInit): Response | null => {
    const url = new URL(String(input), 'http://x');
    if ((init?.method ?? 'GET') !== 'GET') return null;
    if (url.pathname === '/api/vault/records') return json(200, { records: stored.map((s) => metaOf(s.record)) });
    if (url.pathname.startsWith('/api/vault/records/')) {
      const id = decodeURIComponent(url.pathname.split('/').pop()!);
      if (fail.record?.[id]) return json(fail.record[id]!, { error: 'Something went wrong' });
      const s = stored.find((x) => x.record.id === id);
      return s ? json(200, { record: s.record }) : json(404, { error: 'not found' });
    }
    if (url.pathname.startsWith('/api/ledger/entries/')) {
      const id = decodeURIComponent(url.pathname.split('/').pop()!);
      if (fail.ledger?.[id]) return json(fail.ledger[id]!, { error: 'Something went wrong' });
      const s = stored.find((x) => x.ledger.id === id);
      return s ? json(200, { entry: s.ledger }) : json(404, { error: 'not found' });
    }
    return null;
  };
}

function metaOf(r: VaultRecord) {
  const { envelope: _e, ownerWrappedKey: _k, ...meta } = r;
  return meta;
}

/** The same, as an ApiClient-shaped object; `slot` answers getSlot (default: no slot). */
export function vaultApi(stored: StoredRecord[], opts: { slot?: () => Promise<unknown> } = {}): ApiClient {
  const routes = vaultRoutes(stored);
  const call = async <T,>(path: string): Promise<T> => {
    const res = routes(path)!;
    const body = await res.json();
    if (!res.ok) throw new ApiError(res.status, body.error);
    return body as T;
  };
  return {
    listRecords: () => call('/api/vault/records'),
    getRecord: (id: string) => call(`/api/vault/records/${encodeURIComponent(id)}`),
    getLedgerEntry: (id: string) => call(`/api/ledger/entries/${encodeURIComponent(id)}`),
    getSlot: opts.slot ?? (async () => ({ slot: null, draftMode: 'slot' })),
  } as unknown as ApiClient;
}
