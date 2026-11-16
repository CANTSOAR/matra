import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@matra/shared';
import { buildExhibits, csvCell, exhibitListCsv, exhibitNumbersByBlob, fingerprintsById, MissingFilesError, numberExhibits, redactedCopyDescription, redactedCopyLabel } from './exhibits';
import { EvidenceIndex, fold } from './search';
import { originalBlobIds, type PrivateItem } from './privateStore';

const item = (id: string, name: string, over: Partial<EvidenceItem> = {}): EvidenceItem => ({
  id, kind: 'photo', fileName: name, mimeType: 'image/png', sizeBytes: 1500, sha256: 'a'.repeat(64), blobId: `b-${id}`, metadataStripped: true, ...over,
});
const blob = (id: string, createdAt: string) => ({ id: `b-${id}`, createdAt, sizeBytes: 1500 });
const C = (n: string) => n.repeat(64);

describe('exhibit list', () => {
  const items = [item('i1', 'receipt.png', { description: 'Receipt from the pharmacy' }), item('i2', 'texts.pdf', { kind: 'document', mimeType: 'application/pdf', sizeBytes: 5000 }), item('i3', 'copy.png')];
  const blobs = [blob('i2', '2026-11-02T10:00:00Z'), blob('i1', '2026-11-01T10:00:00Z'), blob('i3', '2026-11-03T10:00:00Z'), { id: 'b-orig', createdAt: '2026-11-01T10:00:01Z', sizeBytes: 9 }];
  const priv: Record<string, PrivateItem> = {
    i1: { commitment: C('c'), importedAt: '2026-11-01T09:59:59.000Z', originalBlobId: 'b-orig', ocr: { text: 'Total $12.50', engine: 'x', at: 'y' } },
    i3: { derivedFrom: 'i1', commitment: C('d') },
  };

  it('numbers files in the order they were added, leaves a kept original out of the list, and carries the details', () => {
    const list = buildExhibits(blobs, items, priv);
    expect(list.map((e) => [e.number, e.fileName])).toEqual([[1, 'receipt.png'], [2, 'texts.pdf'], [3, 'copy.png']]);
    expect(list[0]).toMatchObject({ addedAt: '2026-11-01T09:59:59.000Z', kindLabel: 'Photo', fingerprint: C('c'), ocrText: 'Total $12.50' });
    expect(list[1]).toMatchObject({ addedAt: '2026-11-02T10:00:00Z', kindLabel: 'Document', fingerprint: '' });
    expect(list[2]!.derivedFrom).toBe('i1');
    expect(fingerprintsById(list)).toEqual({ i1: C('c'), i3: C('d') });
  });

  it('exports number, name, date added, type, size and the salted fingerprint, and nothing about what a file shows', () => {
    const csv = exhibitListCsv(buildExhibits(blobs, items, priv));
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe('"Exhibit","File name","Date added","Type","Size","Salted fingerprint of the original"');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe(`"1","receipt.png","2026-11-01T09:59:59.000Z","Photo (image/png)","1.5 KB (1500 bytes)","${C('c')}"`);
    expect(csv).not.toContain('Total $12.50'); // the text read from an image is not in the list
    expect(csv).not.toContain('pharmacy'); // nor her descriptions
  });

  it('a file name cannot run as a formula in a spreadsheet, and quotes are doubled', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    for (const bad of ['+1', '-2', '@SUM(1)', '\tx', '\rx']) expect(csvCell(bad).startsWith(`"'`)).toBe(true);
    expect(csvCell('plain, with comma')).toBe('"plain, with comma"');
  });

  it('labels a redacted copy and says the original is unchanged', () => {
    expect(redactedCopyLabel(3)).toBe('Redacted copy of exhibit 3');
    expect(redactedCopyDescription(3)).toMatch(/Redacted copy of exhibit 3\. The original file is unchanged/);
  });
});

describe('local search', () => {
  const list = buildExhibits(
    [blob('i1', '2026-11-01T10:00:00Z'), blob('i2', '2026-11-02T10:00:00Z')],
    [item('i1', 'Pharmacy receipt.png', { description: 'Café receipt from Friday' }), item('i2', 'texts.pdf')],
    { i1: { ocr: { text: 'INVOICE 4471\nPaid 03/04/2026\nTotal $12.50', engine: 'e', at: 'a' } } },
  );
  const index = new EvidenceIndex(list);

  it('finds words in names, descriptions and image text, ignoring case and accents, and says where', () => {
    expect(index.search('pharmacy').map((h) => [h.number, h.fields])).toEqual([[1, ['name']]]);
    expect(index.search('CAFE')[0]).toMatchObject({ number: 1, fields: ['description'] });
    const hit = index.search('4471')[0]!;
    expect(hit).toMatchObject({ number: 1, fields: ['text'] });
    // the excerpt is the original words, with the match inside it
    expect(hit.excerpt!.text.slice(hit.excerpt!.start, hit.excerpt!.end)).toBe('4471');
    expect(hit.excerpt!.text).toContain('INVOICE 4471');
  });

  it('needs every word, at the start of a word; no match, empty or whitespace gives nothing', () => {
    expect(index.search('receipt friday')).toHaveLength(1);
    expect(index.search('receipt 9999')).toEqual([]);
    expect(index.search('eceipt')).toEqual([]); // inside a word is not a match
    expect(index.search('')).toEqual([]);
    expect(index.search('   ')).toEqual([]);
    expect(index.search('texts')[0]!.excerpt).toBeUndefined(); // a name match needs no excerpt
  });

  it('keeps the original text intact across accents and odd characters', () => {
    const { norm, map } = fold('Café 😀 É');
    expect(norm).toBe('cafe 😀 e');
    expect(map.length).toBe([...norm].length);
  });
});

describe('one numbering: files that cannot be traced to an item take no number', () => {
  it('leaves them out of the list, so they never take a number away from a real file', () => {
    const blobs = [blob('i1', '2026-11-01T10:00:00Z'), { id: 'b-orphan', createdAt: '2026-11-02T10:00:00Z', sizeBytes: 77 }, blob('i2', '2026-11-03T10:00:00Z')];
    const list = buildExhibits(blobs, [item('i1', 'a.png'), item('i2', 'b.png')], {});
    expect(list.map((e) => [e.number, e.fileName])).toEqual([[1, 'a.png'], [2, 'b.png']]);
    expect(list.every((e) => e.blobId !== 'b-orphan')).toBe(true);
    // the old "include unnamed" option is gone: the function takes no such switch
    expect(buildExhibits.length).toBe(3);
  });

  it('hides nothing because of what the server reports: a malicious server naming one of her real exhibits as a pending original cannot remove it from the list', () => {
    const H = 'e'.repeat(64);
    // the server reports the content hash of her real exhibit i2 as the hash her item i1 reserved for its original
    const blobs = [{ ...blob('i1', '2026-11-01T10:00:00Z'), contentHash: 'a'.repeat(64) }, { ...blob('i2', '2026-11-02T10:00:00Z'), contentHash: H }, { ...blob('i3', '2026-11-03T10:00:00Z'), contentHash: 'b'.repeat(64) }];
    const items = [item('i1', 'a.png'), item('i2', 'b.png'), item('i3', 'c.png')];
    const priv = { i1: { originalPending: { ciphertextSha256: H } } };
    expect(buildExhibits(blobs, items, priv).map((e) => [e.number, e.fileName])).toEqual([[1, 'a.png'], [2, 'b.png'], [3, 'c.png']]);
    expect(originalBlobIds(priv).size).toBe(0); // a hash alone puts no blob in the set
  });

  it('recognises an original by the blob id HER record saved (linked, or noted when the upload returned), and by nothing else', () => {
    expect(originalBlobIds({ a: { originalBlobId: 'b-1' }, b: { originalPending: { ciphertextSha256: 'e'.repeat(64), blobId: 'b-2' } }, c: { originalPending: { ciphertextSha256: 'f'.repeat(64) } } })).toEqual(new Set(['b-1', 'b-2']));
  });

  it('reports a file the story lists but the server did not list, instead of numbering around it', () => {
    const blobs = [blob('i1', '2026-11-01T10:00:00Z'), blob('i3', '2026-11-03T10:00:00Z')];
    const n = numberExhibits(blobs, [item('i1', 'a.png'), item('i2', 'gone.png'), item('i3', 'c.png')], {});
    expect(n.exhibits.map((e) => e.fileName)).toEqual(['a.png', 'c.png']);
    expect(n.missing.map((m) => m.fileName)).toEqual(['gone.png']);
    expect(new MissingFilesError(['gone.png']).message).toMatch(/Nothing was made/);
  });

  it('resolves derivedFrom against this same list: a redacted copy names the exhibit that is on the screen', () => {
    // an unnamed blob sits before both files: it must not shift the number the copy points at
    const blobs = [{ id: 'b-orphan', createdAt: '2026-10-31T10:00:00Z', sizeBytes: 5 }, blob('i1', '2026-11-01T10:00:00Z'), blob('i2', '2026-11-02T10:00:00Z'), blob('i3', '2026-11-03T10:00:00Z')];
    const items = [item('i1', 'receipt.png'), item('i2', 'other.png'), item('i3', 'copy.png')];
    const list = buildExhibits(blobs, items, { i3: { derivedFrom: 'i1' } });
    expect(list.map((e) => [e.number, e.fileName])).toEqual([[1, 'receipt.png'], [2, 'other.png'], [3, 'copy.png']]);
    expect(list[2]!.redactedCopyOf).toBe(1);
    expect(list[0]!.redactedCopyOf).toBeUndefined();
    // a copy of a file that is not in the list points at nothing rather than at a wrong number
    expect(buildExhibits(blobs, items, { i3: { derivedFrom: 'gone' } })[2]!.redactedCopyOf).toBeUndefined();
    expect(exhibitNumbersByBlob(list)).toEqual({ 'b-i1': 1, 'b-i2': 2, 'b-i3': 3 });
  });
});
