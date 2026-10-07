import { describe, expect, it } from 'vitest';
import { DEFAULT_KDF_ITERATIONS, deriveKeys, newKdfSalt } from '@matra/crypto';
import type { ApiClient } from '../api/client';
import { getProfile, loadVault, saveProfile, sealPayload } from './vault';

/** Minimal in-memory records API: stores exactly what the client sends, like the real server. */
function fakeRecordsApi() {
  const records: any[] = [];
  const sent: string[] = [];
  const api = {
    async createRecord(req: any) {
      sent.push(JSON.stringify(req));
      const rec = {
        id: `r${records.length + 1}`,
        ownerId: 'u1',
        supersedes: req.supersedes,
        contentHash: 'h',
        createdAt: new Date(Date.now() + records.length).toISOString(),
        ledgerEntryId: 'l',
        envelope: req.envelope,
        ownerWrappedKey: req.ownerWrappedKey,
      };
      records.push(rec);
      return { record: rec, ledgerEntry: { seq: records.length, timestamp: rec.createdAt } };
    },
    async listRecords() {
      return { records };
    },
    async getRecord(id: string) {
      return { record: records.find((r) => r.id === id) };
    },
  };
  return { api: api as unknown as ApiClient, sent, records };
}

describe('encrypted profile (preferred name)', () => {
  it('saves, reads back the latest, never sends the name in plaintext, and stays out of loadVault', async () => {
    const { masterKey } = await deriveKeys('profile test passphrase words', newKdfSalt(), Math.min(DEFAULT_KDF_ITERATIONS, 1000));
    const { api, sent } = fakeRecordsApi();

    expect(await getProfile(api, masterKey)).toBeNull();
    const first = await saveProfile(api, masterKey, { preferredName: '  Maya  ' });
    expect(first.profile.preferredName).toBe('Maya');
    const second = await saveProfile(api, masterKey, { preferredName: 'Mae' }, first.recordId);
    await sealPayload(api, masterKey, { kind: 'draft', savedAt: new Date().toISOString() });

    const got = await getProfile(api, masterKey);
    expect(got?.profile.preferredName).toBe('Mae');
    expect(got?.recordId).toBe(second.recordId);

    for (const body of sent) expect(body).not.toMatch(/Maya|Mae/);

    const vault = await loadVault(api, masterKey, { withLedger: false });
    expect(vault.map((r) => r.payload.kind)).toEqual(['draft']);

    // an empty name clears it
    const cleared = await saveProfile(api, masterKey, { preferredName: '  ' }, second.recordId);
    expect(cleared.profile.preferredName).toBeUndefined();
  });
});
