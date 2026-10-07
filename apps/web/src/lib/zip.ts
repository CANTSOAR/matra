/**
 * Minimal ZIP writer (STORE only — no compression), so a survivor can download her decrypted data as one file
 * without adding a dependency. Supports UTF-8 file names (general-purpose flag bit 11) and files < 4 GiB
 * (no ZIP64). Spec: PKWARE APPNOTE.TXT §4.3.
 */

let crcTable: Uint32Array | undefined;

/** CRC-32 (IEEE 802.3, reflected, polynomial 0xEDB88320) as used by ZIP. */
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Path inside the archive, '/'-separated, e.g. "evidence/photo.jpg". */
  name: string;
  data: Uint8Array | string;
  /** Modification time stored in the entry (local DOS time). Default: now. */
  date?: Date;
}

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Build a STORE-only .zip archive. Duplicate names are made unique ("a.txt" → "a (2).txt"). */
export function createZip(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const used = new Set<string>();
  const files = entries.map((e) => {
    let name = e.name.replace(/\\/g, '/').replace(/^\/+/, '');
    if (used.has(name)) {
      const dot = name.lastIndexOf('.');
      const [base, ext] = dot > name.lastIndexOf('/') + 1 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
      let i = 2;
      while (used.has(`${base} (${i})${ext}`)) i++;
      name = `${base} (${i})${ext}`;
    }
    used.add(name);
    const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    if (data.length > 0xfffffffe) throw new Error(`${name} is too large for this export`);
    return { nameBytes: enc.encode(name), data, crc: crc32(data), ...dosDateTime(e.date ?? new Date()) };
  });

  const localSize = files.reduce((n, f) => n + 30 + f.nameBytes.length + f.data.length, 0);
  const centralSize = files.reduce((n, f) => n + 46 + f.nameBytes.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let p = 0;
  const u16 = (v: number) => { view.setUint16(p, v, true); p += 2; };
  const u32 = (v: number) => { view.setUint32(p, v >>> 0, true); p += 4; };
  const bytes = (b: Uint8Array) => { out.set(b, p); p += b.length; };

  const offsets: number[] = [];
  for (const f of files) {
    offsets.push(p);
    u32(0x04034b50); // local file header
    u16(20); // version needed (2.0)
    u16(0x0800); // flags: UTF-8 names
    u16(0); // method: STORE
    u16(f.time); u16(f.date);
    u32(f.crc); u32(f.data.length); u32(f.data.length);
    u16(f.nameBytes.length); u16(0);
    bytes(f.nameBytes);
    bytes(f.data);
  }
  const cdStart = p;
  files.forEach((f, i) => {
    u32(0x02014b50); // central directory header
    u16(20); // version made by
    u16(20); u16(0x0800); u16(0);
    u16(f.time); u16(f.date);
    u32(f.crc); u32(f.data.length); u32(f.data.length);
    u16(f.nameBytes.length); u16(0); u16(0); // name, extra, comment lengths
    u16(0); u16(0); u32(0); // disk no., internal attrs, external attrs
    u32(offsets[i]);
    bytes(f.nameBytes);
  });
  const cdSize = p - cdStart;
  u32(0x06054b50); // end of central directory
  u16(0); u16(0);
  u16(files.length); u16(files.length);
  u32(cdSize); u32(cdStart);
  u16(0);
  return out;
}

/** Keep only characters that are safe in a file name on every OS. */
export function safeFileName(name: string, fallback = 'file'): string {
  const cleaned = name
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}
