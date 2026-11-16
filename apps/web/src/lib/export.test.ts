// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { deriveKeys, encryptBlob, encryptJSON, generateContentKey, newKdfSalt, sealSlot, sha256Hex, slotName, wrapKeyWithMaster } from '@matra/crypto';
import type { BlobMeta, VaultRecord } from '@matra/shared';
import { envelopeHash, type ApiClient } from '../api/client';
import { MatchingApiClient } from '../api/matching';
import { buildDataExport } from './export';
import { storedRecord, vaultApi } from '../test/fakeVault';
import { sampleRecord } from '../brief/fixtures';

/** Pull every file out of a STORE zip (central directory walk). */
function unzip(zip: Uint8Array): Map<string, Uint8Array> {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  let p = v.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < v.getUint16(eocd + 10, true); i++) {
    const size = v.getUint32(p + 24, true);
    const n = v.getUint16(p + 28, true);
    const local = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + n));
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    out.set(name, zip.subarray(start, start + size));
    p += 46 + n;
  }
  return out;
}

/** Sealed matching on or off for one test (the export reads __MATRA_MATCHING__ when it runs). */
const g = globalThis as { __MATRA_MATCHING__?: boolean };
const initial = g.__MATRA_MATCHING__;
afterEach(() => {
  g.__MATRA_MATCHING__ = initial;
});

describe('buildDataExport', () => {
  it.each([
    ['off', false, ['README.txt', 'records.json', 'draft.json', 'evidence/manifest.json', 'evidence/001-wrists.jpg', 'shares.json', 'activity.json']],
    ['on', true, ['README.txt', 'records.json', 'draft.json', 'evidence/manifest.json', 'evidence/001-wrists.jpg', 'escrow.json', 'shares.json', 'activity.json']],
  ])('decrypts every record and evidence file into one archive, with a verifiable manifest (matching %s)', async (_mode, on, names) => {
    g.__MATRA_MATCHING__ = on;
    const { masterKey } = await deriveKeys('export test passphrase', newKdfSalt(), 1000);
    const photo = new TextEncoder().encode('pretend-jpeg-bytes');
    const photoSha = await sha256Hex(photo);
    const blobKey = await generateContentKey();
    const blob: BlobMeta = {
      id: 'b'.repeat(32), ownerId: 'u', sizeBytes: 0, contentHash: 'x', createdAt: '2026-08-15T00:00:00Z',
      ledgerEntryId: 'l2', ownerWrappedKey: await wrapKeyWithMaster(blobKey, masterKey),
    };
    const blobCt = await encryptBlob(photo, blobKey);
    const record = { ...sampleRecord, evidence: [{ ...sampleRecord.evidence[1], blobId: blob.id, sha256: photoSha, fileName: 'wrists.jpg' }] };
    const stored = await storedRecord(masterKey, { kind: 'final', record, savedAt: '2026-08-19T00:00:00Z' }, { id: 'r'.repeat(32), createdAt: '2026-08-19T00:00:00Z' });
    const rec = stored.record;
    // her draft slot: what she is still adding to
    const slot = { name: await slotName(masterKey, 'draft'), ...(await sealSlot({ kind: 'draft', slotVersion: 1, draft: { answers: { 'about.name': 'Wren' } }, evidence: [], savedAt: '2026-09-01T00:00:00Z' }, masterKey)), version: '4'.repeat(32), updatedDay: '2026-09-01' };
    const fake = {
      listRecords: async () => ({ records: [rec] }),
      getRecord: async () => ({ record: rec }),
      getSlot: async () => ({ slot, draftMode: 'slot' }),
      getLedgerEntry: async () => ({ entry: stored.ledger }),
      listBlobs: async () => ({ blobs: [blob] }),
      downloadBlob: async () => blobCt,
      listEscrow: async () => ({ entries: [] }),
      listShares: async () => ({ shares: [] }),
      listAudit: async () => ({ events: [] }),
    };
    // a build with sealed matching has the matching client (lib/session.tsx); a pilot build has the plain one
    const api = (on ? Object.assign(Object.create(MatchingApiClient.prototype), fake) : fake) as ApiClient;

    const out = await buildDataExport(api, masterKey, 'bluebird', new Date('2026-10-07T12:00:00Z'));
    expect(out.fileName).toBe('matra-my-data-2026-10-07.zip');
    expect(out).toMatchObject({ recordCount: 1, evidenceCount: 1, problems: [] });
    const files = unzip(out.zip);
    expect([...files.keys()]).toEqual(names);
    const readme = new TextDecoder().decode(files.get('README.txt'));
    expect(readme).toMatch(/NOT encrypted/);
    // the README lists escrow.json only where the archive has one
    expect(readme.includes('escrow.json')).toBe(on);
    const records = JSON.parse(new TextDecoder().decode(files.get('records.json')));
    expect(records.records[0].payload.record.narrative.freeRecall).toBe(sampleRecord.narrative.freeRecall);
    expect(records.records[0].fingerprintVerified).toBe(true);
    expect(Array.from(files.get('evidence/001-wrists.jpg')!)).toEqual(Array.from(photo));
    const manifest = JSON.parse(new TextDecoder().decode(files.get('evidence/manifest.json')));
    expect(manifest.files[0]).toMatchObject({ fileName: 'wrists.jpg', sha256: photoSha, sha256Matches: true });
    expect(manifest.problems).toEqual([]);
    expect(records.unreadableRecords).toBe(0);
    const draft = JSON.parse(new TextDecoder().decode(files.get('draft.json')));
    expect(draft.draft).toMatchObject({ kind: 'draft', draft: { answers: { 'about.name': 'Wren' } }, savedAt: '2026-09-01T00:00:00Z', savedOnDay: '2026-09-01' });
    expect(readme).toMatch(/draft\.json\s+Your current draft/);
  });

  it('says in the manifest and the result what is left out, and whether it couldn’t be fetched or didn’t match (never a silently partial copy)', async () => {
    g.__MATRA_MATCHING__ = false; // not about sealed matching; a plain client, as in a pilot build
    const { masterKey } = await deriveKeys('export test passphrase', newKdfSalt(), 1000);
    const ok = await storedRecord(masterKey, { kind: 'final', record: sampleRecord, savedAt: '2026-08-19T00:00:00Z' }, { id: 'r'.repeat(32) });
    const lost = await storedRecord(masterKey, { kind: 'final', record: sampleRecord, savedAt: '2026-08-20T00:00:00Z' }, { id: 's'.repeat(32) });
    const changed = await storedRecord(masterKey, { kind: 'final', record: sampleRecord, savedAt: '2026-08-21T00:00:00Z' }, { id: 't'.repeat(32) });
    changed.record.contentHash = 'f'.repeat(64);
    const api = vaultApi([ok, lost, changed]);
    const get = api.getRecord.bind(api);
    Object.assign(api, {
      getRecord: async (id: string) => {
        if (id === lost.record.id) throw new Error('network');
        return get(id);
      },
      listBlobs: async () => ({ blobs: [] }),
      listShares: async () => ({ shares: [] }),
      listAudit: async () => ({ events: [] }),
    });

    const out = await buildDataExport(api, masterKey, 'bluebird', new Date('2026-10-07T12:00:00Z'));
    expect(out).toMatchObject({ recordCount: 1, unreadableRecords: 2, problems: [] });
    const files = unzip(out.zip);
    const manifest = JSON.parse(new TextDecoder().decode(files.get('evidence/manifest.json')));
    expect(manifest.problems).toEqual([
      `Saved version ${'s'.repeat(32)} could not be fetched just now and is not in records.json`,
      `Saved version ${'t'.repeat(32)} does not match its recorded fingerprint (SHA-256), so it is not in records.json`,
    ]);
    const records = JSON.parse(new TextDecoder().decode(files.get('records.json')));
    expect(records.unreadableRecords).toBe(2);
    expect(records.notIncluded).toEqual([
      { kind: 'unavailable', id: 's'.repeat(32) },
      { kind: 'integrity', reason: 'hash', id: 't'.repeat(32) },
    ]);
  });
});
