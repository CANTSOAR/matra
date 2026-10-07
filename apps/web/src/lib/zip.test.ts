// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { crc32, createZip, safeFileName } from './zip';

/** Independent reader: walks the central directory and checks every local header + CRC. */
function readZip(zip: Uint8Array): Array<{ name: string; data: Uint8Array }> {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out: Array<{ name: string; data: Uint8Array }> = [];
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(zip.subarray(p + 46, p + 46 + nameLen));
    expect(v.getUint32(local, true)).toBe(0x04034b50);
    expect(v.getUint16(local + 8, true)).toBe(0); // STORE
    const lnameLen = v.getUint16(local + 26, true);
    const start = local + 30 + lnameLen + v.getUint16(local + 28, true);
    const data = zip.subarray(start, start + size);
    expect(crc32(data)).toBe(crc);
    out.push({ name, data });
    p += 46 + nameLen;
  }
  return out;
}

describe('crc32', () => {
  it('matches known vectors', () => {
    expect(crc32(new TextEncoder().encode(''))).toBe(0);
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new TextEncoder().encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });
});

describe('createZip', () => {
  it('round-trips text and binary entries with UTF-8 names', () => {
    const bin = new Uint8Array(70_000).map((_, i) => (i * 31) & 0xff);
    const zip = createZip([
      { name: 'records.json', data: '{"narrative":"He said “stay” 😶"}' },
      { name: 'evidence/fotografía.jpg', data: bin },
      { name: 'evidence/empty.txt', data: new Uint8Array(0) },
    ]);
    const files = readZip(zip);
    expect(files.map((f) => f.name)).toEqual(['records.json', 'evidence/fotografía.jpg', 'evidence/empty.txt']);
    expect(new TextDecoder().decode(files[0].data)).toBe('{"narrative":"He said “stay” 😶"}');
    expect(Array.from(files[1].data)).toEqual(Array.from(bin));
    expect(files[2].data.length).toBe(0);
  });

  it('makes duplicate names unique and strips leading slashes', () => {
    const files = readZip(createZip([{ name: '/a/x.png', data: 'a' }, { name: 'a/x.png', data: 'b' }, { name: 'a/x.png', data: 'c' }]));
    expect(files.map((f) => f.name)).toEqual(['a/x.png', 'a/x (2).png', 'a/x (3).png']);
  });

  it('produces an empty but valid archive', () => {
    expect(readZip(createZip([]))).toEqual([]);
  });
});

describe('safeFileName', () => {
  it('removes path separators and control characters', () => {
    expect(safeFileName('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(safeFileName('a:b*c?.jpg')).toBe('a_b_c_.jpg');
    expect(safeFileName('   ')).toBe('file');
  });
});
