// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { deriveKeys, encryptBlob, encryptJSON, generateContentKey, newKdfSalt, sha256Hex, wrapKeyWithMaster } from '@matra/crypto';
import type { BlobMeta, VaultRecord } from '@matra/shared';
import { envelopeHash, type ApiClient } from '../api/client';
import { buildDataExport } from './export';
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

describe('buildDataExport', () => {
  it('decrypts every record and evidence file into one archive, with a verifiable manifest', async () => {
    const { masterKey } = await deriveKeys('export test passphrase', newKdfSalt(), 1000);
    const photo = new TextEncoder().encode('pretend-jpeg-bytes');
    const photoSha = await sha256Hex(photo);
    const blobKey = await generateContentKey();
    const blob: BlobMeta = {
      id: 'b'.repeat(32), ownerId: 'u', sizeBytes: 0, contentHash: 'x', createdAt: '2026-08-15T00:00:00Z',
      ledgerEntryId: 'l2', ownerWrappedKey: await wrapKeyWithMaster(blobKey, masterKey),
    };
    const blobCt = await encryptBlob(photo, blobKey);
    const recKey = await generateContentKey();
    const record = { ...sampleRecord, evidence: [{ ...sampleRecord.evidence[1], blobId: blob.id, sha256: photoSha, fileName: 'wrists.jpg' }] };
    const envelope = await encryptJSON({ kind: 'final', record, savedAt: '2026-08-19T00:00:00Z' }, recKey);
    const rec: VaultRecord = {
      id: 'r'.repeat(32), ownerId: 'u', createdAt: '2026-08-19T00:00:00Z', contentHash: await envelopeHash(envelope),
      ledgerEntryId: 'l1', envelope, ownerWrappedKey: await wrapKeyWithMaster(recKey, masterKey),
    };
    const api = {
      listRecords: async () => ({ records: [rec] }),
      getRecord: async () => ({ record: rec }),
      getLedgerEntry: async () => { throw new Error('offline'); },
      listBlobs: async () => ({ blobs: [blob] }),
      downloadBlob: async () => blobCt,
      listEscrow: async () => ({ entries: [] }),
      listShares: async () => ({ shares: [] }),
      listAudit: async () => ({ events: [] }),
    } as unknown as ApiClient;

    const out = await buildDataExport(api, masterKey, 'bluebird', new Date('2026-10-07T12:00:00Z'));
    expect(out.fileName).toBe('matra-my-data-2026-10-07.zip');
    expect(out).toMatchObject({ recordCount: 1, evidenceCount: 1, problems: [] });
    const files = unzip(out.zip);
    expect([...files.keys()]).toEqual(['README.txt', 'records.json', 'evidence/manifest.json', 'evidence/001-wrists.jpg', 'escrow.json', 'shares.json', 'activity.json']);
    expect(new TextDecoder().decode(files.get('README.txt'))).toMatch(/NOT encrypted/);
    const records = JSON.parse(new TextDecoder().decode(files.get('records.json')));
    expect(records.records[0].payload.record.narrative.freeRecall).toBe(sampleRecord.narrative.freeRecall);
    expect(records.records[0].fingerprintVerified).toBe(true);
    expect(Array.from(files.get('evidence/001-wrists.jpg')!)).toEqual(Array.from(photo));
    const manifest = JSON.parse(new TextDecoder().decode(files.get('evidence/manifest.json')));
    expect(manifest.files[0]).toMatchObject({ fileName: 'wrists.jpg', sha256: photoSha, sha256Matches: true });
  });
});
