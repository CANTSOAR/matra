// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { deriveKeys, encryptBlob, encryptJSON, generateContentKey, newKdfSalt, sealSlot, sha256Hex, slotName, wrapKeyWithMaster } from '@matra/crypto';
import type { BlobMeta, VaultRecord } from '@matra/shared';
import { envelopeHash, type ApiClient } from '../api/client';
import { MatchingApiClient } from '../api/matching';
import { buildDataExport } from './export';
import { spaceEvidence } from './vault';
import { storedRecord, vaultApi } from '../test/fakeVault';
import { sampleRecord } from '../brief/fixtures';
import { briefSections } from '../brief';
import { buildExhibits, exhibitNumbersByBlob, numberExhibits } from '../evidence/exhibits';

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

describe('buildDataExport: the evidence reader’s lists', () => {
  it('adds the exhibit list and her private details (salt, original hash, text read), which verify a salted fingerprint', async () => {
    g.__MATRA_MATCHING__ = false;
    const { masterKey } = await deriveKeys('export reader test passphrase', newKdfSalt(), 1000);
    const bytes = new TextEncoder().encode('a stored copy');
    const blobKey = await generateContentKey();
    const blob: BlobMeta = { id: 'b'.repeat(32), ownerId: 'u', sizeBytes: 0, contentHash: 'x', createdAt: '2026-08-15T00:00:00Z', ledgerEntryId: 'l2', ownerWrappedKey: await wrapKeyWithMaster(blobKey, masterKey) };
    const blobCt = await encryptBlob(bytes, blobKey);
    const original = new TextEncoder().encode('the original');
    const originalSha = await sha256Hex(original);
    const salt = '5'.repeat(64);
    const raw = new Uint8Array(64);
    for (let i = 0; i < 32; i++) (raw[i] = parseInt(salt.slice(i * 2, i * 2 + 2), 16)), (raw[32 + i] = parseInt(originalSha.slice(i * 2, i * 2 + 2), 16));
    const commitment = await sha256Hex(raw);
    const item = { id: 'i1', kind: 'photo', fileName: 'wrists.jpg', mimeType: 'image/jpeg', sizeBytes: bytes.length, sha256: await sha256Hex(bytes), blobId: blob.id, metadataStripped: true };
    const draft = { name: await slotName(masterKey, 'draft'), ...(await sealSlot({ kind: 'draft', slotVersion: 1, evidence: [item], savedAt: '2026-09-01T00:00:00Z' }, masterKey)), version: '4'.repeat(32), updatedDay: '2026-09-01' };
    const priv = {
      name: await slotName(masterKey, 'evidence-private'),
      ...(await sealSlot({ kind: 'evidence-private', v: 1, savedAt: 'x', items: { i1: { originalSha256: originalSha, salt, commitment, importedAt: '2026-08-14T23:00:00.000Z', ocr: { text: 'Total $12.50', engine: 'tesseract', at: 'z' } } } }, masterKey)),
      version: '5'.repeat(32),
      updatedDay: '2026-09-01',
    };
    const fake = {
      listRecords: async () => ({ records: [] }),
      getRecord: async () => ({ record: undefined }),
      getSlot: async (name: string) => ({ slot: name === draft.name ? draft : name === priv.name ? priv : null, draftMode: 'slot' }),
      getLedgerEntry: async () => ({ entry: undefined }),
      listBlobs: async () => ({ blobs: [blob] }),
      downloadBlob: async () => blobCt,
      listShares: async () => ({ shares: [] }),
      listAudit: async () => ({ events: [] }),
    } as unknown as ApiClient;
    const built = await buildDataExport(fake, masterKey, 'bluebird', new Date('2026-10-07T12:00:00Z'));
    expect(built.evidenceCount).toBe(1); // the two lists are not evidence files
    const files = unzip(built.zip);
    const text = (n: string) => new TextDecoder().decode(files.get(n)!);
    expect(text('evidence/exhibit-list.csv')).toContain(`"1","wrists.jpg","2026-08-14T23:00:00.000Z","Photo (image/jpeg)"`);
    expect(text('evidence/exhibit-list.csv')).toContain(commitment);
    const details = JSON.parse(text('evidence/private-details.json')) as { files: Array<{ originalSha256: string; salt: string; saltedFingerprint: string; textRead: string }> };
    expect(details.files[0]).toMatchObject({ originalSha256: originalSha, salt, saltedFingerprint: commitment, textRead: 'Total $12.50' });
    expect(text('README.txt')).toContain('evidence/private-details.json');
    // a file whose details were never saved is listed as such, not left out
    expect(text('evidence/exhibit-list.csv')).not.toContain('(name not saved)');
    // the exhibit list (shareable) never holds the salt or the plain hash
    expect(text('evidence/exhibit-list.csv')).not.toContain(salt);
    expect(text('evidence/exhibit-list.csv')).not.toContain(originalSha);
  });
});


describe('one numbering: the screen, the export, the CSV and the PDF agree on every exhibit number', () => {
  type PrivIn = Record<string, Record<string, unknown>>;
  /** blobs (oldest first), her file details (draft slot) and her private details, as the server would hold them */
  async function space(opts: { priv: (ids: { orig: string; copy: string }) => PrivIn; originalText?: string; missingItem?: boolean }) {
    g.__MATRA_MATCHING__ = false;
    const { masterKey } = await deriveKeys('numbering test passphrase', newKdfSalt(), 1000);
    const text = (t: string) => new TextEncoder().encode(t);
    const makeBlob = async (id: string, createdAt: string, content: string, contentHash = 'x') => {
      const key = await generateContentKey();
      return { blob: { id, ownerId: 'u', sizeBytes: 0, contentHash, createdAt, ledgerEntryId: `l-${id}`, ownerWrappedKey: await wrapKeyWithMaster(key, masterKey) } as BlobMeta, ct: await encryptBlob(text(content), key) };
    };
    const ORIGINAL_CT_HASH = 'd'.repeat(64);
    const made = [
      await makeBlob('1'.repeat(32), '2026-08-01T00:00:00Z', 'unnamed'), // another device saved its draft first: no file details
      await makeBlob('2'.repeat(32), '2026-08-02T00:00:00Z', 'receipt'), // receipt (exhibit 1)
      await makeBlob('3'.repeat(32), '2026-08-02T00:00:01Z', opts.originalText ?? 'the original', ORIGINAL_CT_HASH), // its original, link never saved
      await makeBlob('5'.repeat(32), '2026-08-02T12:00:00Z', 'letter'), // a file only in her draft slot, not in the sealed version (exhibit 2)
      await makeBlob('4'.repeat(32), '2026-08-03T00:00:00Z', 'copy'), // redacted copy of the receipt (exhibit 3)
    ];
    const mk = async (id: string, fileName: string, blobId: string, content: string) => ({ id, kind: 'photo', fileName, mimeType: 'image/png', sizeBytes: content.length, sha256: await sha256Hex(text(content)), blobId, metadataStripped: true });
    const iA = await mk('iA', 'receipt.png', made[1]!.blob.id, 'receipt');
    const iC = await mk('iC', 'letter.png', made[3]!.blob.id, 'letter');
    const iB = await mk('iB', 'Redacted copy of exhibit 1 - receipt.png', made[4]!.blob.id, 'copy');
    const draftItems = [iA, iC, iB, ...(opts.missingItem ? [await mk('iZ', 'ghost.png', '9'.repeat(32), 'ghost')] : [])];
    const privItems = opts.priv({ orig: made[2]!.blob.id, copy: made[4]!.blob.id });
    const draft = { name: await slotName(masterKey, 'draft'), ...(await sealSlot({ kind: 'draft', slotVersion: 1, evidence: draftItems, savedAt: '2026-09-01T00:00:00Z' }, masterKey)), version: '4'.repeat(32), updatedDay: '2026-09-01' };
    const priv = { name: await slotName(masterKey, 'evidence-private'), ...(await sealSlot({ kind: 'evidence-private', v: 1, savedAt: 'x', items: privItems }, masterKey)), version: '5'.repeat(32), updatedDay: '2026-09-01' };
    const blobs = made.map((m) => m.blob);
    const fake = {
      listRecords: async () => ({ records: [] }),
      getRecord: async () => ({ record: undefined }),
      getSlot: async (name: string) => ({ slot: name === draft.name ? draft : name === priv.name ? priv : null, draftMode: 'slot' }),
      getLedgerEntry: async () => ({ entry: undefined }),
      listBlobs: async () => ({ blobs }),
      downloadBlob: async (id: string) => made.find((m) => m.blob.id === id)!.ct,
      listShares: async () => ({ shares: [] }),
      listAudit: async () => ({ events: [] }),
    } as unknown as ApiClient;
    const run = async () => {
      const files = unzip((await buildDataExport(fake, masterKey, 'bluebird', new Date('2026-10-07T12:00:00Z'))).zip);
      const read = (n: string) => new TextDecoder().decode(files.get(n)!);
      const built = await buildDataExport(fake, masterKey, 'bluebird', new Date('2026-10-07T12:00:00Z'));
      return { files, read, manifest: (JSON.parse(read('evidence/manifest.json')) as unknown), problems: built.problems };
    };
    return { masterKey, blobs, items: draftItems, privItems, run, ORIGINAL_CT_HASH, makeBlob };
  }
  const manifestFiles = (m: unknown) => (Array.isArray(m) ? m : ((m as { files?: unknown[] }).files ?? [])) as Array<{ blobId: string; file: string | null; attributedToAFile?: boolean; attribution?: string; originalOf?: string; possibleOriginalOf?: string }>;

  it('with an unnamed file, a file only in her draft, an original whose link was never saved, and a redacted copy', async () => {
    const sp = await space({
      priv: () => ({
        iA: { commitment: 'a'.repeat(64), originalPending: { ciphertextSha256: 'd'.repeat(64) }, originalSha256: '' },
        iB: { commitment: 'b'.repeat(64), derivedFrom: 'iA' },
      }),
    });
    // the screen: the same function over the same blobs, merged details and private details (screens/Evidence.tsx)
    const onScreen = buildExhibits(sp.blobs, sp.items as never, sp.privItems as never);
    expect(onScreen.map((e) => [e.number, e.id])).toEqual([[1, 'iA'], [2, 'iC'], [3, 'iB']]);
    expect(onScreen[2]!.redactedCopyOf).toBe(1);

    // the export, its CSV and its private details
    const { files, read, manifest } = await sp.run();
    const csvRows = read('evidence/exhibit-list.csv').trimEnd().split('\r\n').slice(1);
    expect(csvRows.map((r) => r.split('","')[0]!.replace(/^"/, ''))).toEqual(onScreen.map((e) => String(e.number)));
    expect(csvRows[2]).toContain('Redacted copy of exhibit 1');
    const details = JSON.parse(read('evidence/private-details.json')) as { files: Array<{ exhibit: number; fileName: string; redactedCopyOf?: number }> };
    expect(details.files.map((f) => f.exhibit)).toEqual(onScreen.map((e) => e.number));
    expect(details.files[2]!.redactedCopyOf).toBe(1); // the receipt, exhibit 1, whatever else is in the archive
    expect(read('evidence/exhibit-list.csv')).not.toContain('name not saved');
    // the unnamed file takes no number and is kept apart
    expect(manifestFiles(manifest).filter((m) => m.attributedToAFile === false).map((m) => m.blobId)).toContain('1'.repeat(32));
    expect([...files.keys()].some((n) => n.startsWith(`evidence/unattributed/001-`))).toBe(true);

    // the PDF: its "#" column, built from the numbering the Brief screen computes (screens/Brief.tsx), over the SAME merged
    // set of file details though the sealed version lists only some files
    const record = { ...sampleRecord, evidence: [sp.items[2]!, sp.items[0]!] as never };
    const numbers = exhibitNumbersByBlob(numberExhibits(sp.blobs, spaceEvidence([], { value: { evidence: sp.items } } as never), sp.privItems as never).exhibits);
    const table = briefSections(record, { exhibitNumbers: numbers }).find((s) => s.id === 'evidence')!.blocks.find((b) => b.kind === 'table') as { rows: Array<{ cells: string[] }> };
    expect(table.rows.map((r) => [r.cells[0], r.cells[1]])).toEqual([['1', 'receipt.png'], ['3', 'Redacted copy of exhibit 1 - receipt.png']]);
  });

  it('a file the story lists but the server did not list is reported as a problem, not numbered around', async () => {
    const sp = await space({ priv: () => ({}), missingItem: true });
    const { read, problems } = await sp.run();
    expect(problems.some((p) => /ghost\.png.*not among your stored files/.test(p))).toBe(true);
    expect(read('evidence/exhibit-list.csv')).not.toContain('ghost.png');
  });

  it('a recorded blob id names the original, by her own record; no hash is needed', async () => {
    const sp = await space({ priv: ({ orig }) => ({ iA: { commitment: 'a'.repeat(64), originalPending: { ciphertextSha256: 'f'.repeat(64), blobId: orig } } }) });
    const { files, manifest } = await sp.run();
    expect([...files.keys()].some((n) => n.endsWith('original-of-receipt.png'))).toBe(true);
    expect(manifestFiles(manifest).find((m) => m.blobId === '3'.repeat(32))).toMatchObject({ originalOf: 'receipt.png' });
  });

  it('an original known only by its reserved hash is renamed only after its bytes match the original’s own hash', async () => {
    const original = new TextEncoder().encode('the original');
    const good = await space({ priv: () => ({ iA: { originalSha256: '', originalPending: { ciphertextSha256: 'd'.repeat(64) } } }) });
    // (the helper stored 'the original'; give the item its true hash)
    const sha = await sha256Hex(original);
    const verified = await space({ priv: () => ({ iA: { originalSha256: sha, salt: '1'.repeat(64), commitment: 'a'.repeat(64), originalPending: { ciphertextSha256: 'd'.repeat(64) } } }) });
    const v = await verified.run();
    expect([...v.files.keys()].some((n) => n.startsWith('evidence/') && n.endsWith('original-of-receipt.png') && !n.includes('unattributed'))).toBe(true);
    expect(manifestFiles(v.manifest).find((m) => m.blobId === '3'.repeat(32))).toMatchObject({ originalOf: 'receipt.png', attribution: 'verified' });
    // wrong bytes under that hash: marked probable, kept apart, never renamed
    const g2 = await good.run();
    const m = manifestFiles(g2.manifest).find((x) => x.blobId === '3'.repeat(32))!;
    expect(m.attribution).toBe('probable');
    expect(m.possibleOriginalOf).toBe('receipt.png');
    expect(m.attributedToAFile).toBe(false);
    expect([...g2.files.keys()].some((n) => n.includes('original-of-'))).toBe(false);
  });

  it('a malicious server that reports a real exhibit’s hash as an item’s pending original cannot change what is listed or renamed', async () => {
    const sp = await space({ priv: () => ({ iA: { commitment: 'a'.repeat(64), originalSha256: 'e'.repeat(64), originalPending: { ciphertextSha256: 'c'.repeat(64) } } }) });
    // the server now claims her real exhibit iC (blob 5) carries the hash item iA reserved
    const lie = sp.blobs.map((b) => (b.id === '5'.repeat(32) ? { ...b, contentHash: 'c'.repeat(64) } : b));
    expect(buildExhibits(lie, sp.items as never, sp.privItems as never).map((e) => e.fileName)).toEqual(['receipt.png', 'letter.png', 'Redacted copy of exhibit 1 - receipt.png']);
    const files = (await sp.run()).files;
    expect([...files.keys()].some((n) => n.includes('original-of-'))).toBe(false);
    expect(new TextDecoder().decode(files.get('evidence/exhibit-list.csv')!)).toContain('letter.png');
  });
});
