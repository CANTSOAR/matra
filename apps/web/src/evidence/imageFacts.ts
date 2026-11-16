/**
 * What an image file says about itself, read from its own bytes on this device: pixel size, whether it carries camera make
 * or model, whether it carries a GPS block, and the date strings in its EXIF (shown exactly as written in the file).
 *
 * It reads fields; it does not look at the picture. Nothing here says what the image shows. Never throws: a file that is
 * not what it claims, or is cut short, gives whatever was read before the problem (usually nothing).
 */
export interface ExifString {
  /** the EXIF tag's own name, as the spec writes it */
  tag: 'DateTime' | 'DateTimeOriginal' | 'DateTimeDigitized';
  /** the string exactly as stored in the file (for example "2026:03:03 14:22:10") */
  value: string;
}

export interface ImageFacts {
  width?: number;
  height?: number;
  /** a Make or Model field is present */
  hasCameraData: boolean;
  /** a GPS block is present (its coordinates are never read) */
  hasLocation: boolean;
  exifDates: ExifString[];
}

const empty = (): ImageFacts => ({ hasCameraData: false, hasLocation: false, exifDates: [] });

const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_DATETIME = 0x0132;
const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const TAG_DT_ORIGINAL = 0x9003;
const TAG_DT_DIGITIZED = 0x9004;
const MAX_ENTRIES = 512;

/** Reads a TIFF block (the payload of EXIF) into `out`. */
function readTiff(b: Uint8Array, start: number, out: ImageFacts): void {
  if (start < 0 || start + 8 > b.length) return;
  const little = b[start] === 0x49 && b[start + 1] === 0x49;
  if (!little && !(b[start] === 0x4d && b[start + 1] === 0x4d)) return;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u16 = (o: number) => dv.getUint16(o, little);
  const u32 = (o: number) => dv.getUint32(o, little);
  if (u16(start + 2) !== 42) return;
  const seen = new Set<number>();
  const ifd = (offset: number, depth: number) => {
    const at = start + offset;
    if (depth > 2 || seen.has(at) || at < start || at + 2 > b.length) return;
    seen.add(at);
    const n = Math.min(u16(at), MAX_ENTRIES);
    for (let i = 0; i < n; i++) {
      const e = at + 2 + i * 12;
      if (e + 12 > b.length) return;
      const tag = u16(e);
      const type = u16(e + 2);
      const count = u32(e + 4);
      if (tag === TAG_MAKE || tag === TAG_MODEL) {
        if (type === 2 && count > 1) out.hasCameraData = true;
      } else if (tag === TAG_GPS_IFD) {
        out.hasLocation = true;
      } else if (tag === TAG_EXIF_IFD && depth === 0) {
        ifd(u32(e + 8), depth + 1);
      } else if ((tag === TAG_DATETIME || tag === TAG_DT_ORIGINAL || tag === TAG_DT_DIGITIZED) && type === 2 && count > 1 && count < 64) {
        const valueAt = count <= 4 ? e + 8 : start + u32(e + 8);
        if (valueAt >= 0 && valueAt + count <= b.length) {
          let s = '';
          for (let k = 0; k < count && b[valueAt + k] !== 0; k++) s += String.fromCharCode(b[valueAt + k]!);
          if (s)
            out.exifDates.push({ tag: tag === TAG_DATETIME ? 'DateTime' : tag === TAG_DT_ORIGINAL ? 'DateTimeOriginal' : 'DateTimeDigitized', value: s });
        }
      }
    }
  };
  ifd(u32(start + 4), 0);
}

const ascii = (b: Uint8Array, at: number, len: number) => String.fromCharCode(...b.subarray(at, at + len));

function readPng(b: Uint8Array, out: ImageFacts): void {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 8;
  while (p + 12 <= b.length) {
    const len = dv.getUint32(p);
    const type = ascii(b, p + 4, 4);
    if (type === 'IHDR' && len >= 8) {
      out.width = dv.getUint32(p + 8);
      out.height = dv.getUint32(p + 12);
    } else if (type === 'eXIf') {
      readTiff(b, p + 8, out);
    } else if (type === 'IDAT' || type === 'IEND') break;
    p += 12 + len;
  }
}

function readJpeg(b: Uint8Array, out: ImageFacts): void {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 2;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) return;
    const marker = b[p + 1]!;
    if (marker === 0xff) {
      p += 1;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      p += 2;
      continue;
    }
    const len = dv.getUint16(p + 2);
    if (marker === 0xe1 && ascii(b, p + 4, 6) === 'Exif\0\0') readTiff(b, p + 10, out);
    const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (sof && p + 9 <= b.length) {
      out.height = dv.getUint16(p + 5);
      out.width = dv.getUint16(p + 7);
    }
    if (marker === 0xda) return; // start of scan: the headers are behind us
    p += 2 + len;
  }
}

function readWebp(b: Uint8Array, out: ImageFacts): void {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 12;
  while (p + 8 <= b.length) {
    const type = ascii(b, p, 4);
    const len = dv.getUint32(p + 4, true);
    const d = p + 8;
    if (type === 'VP8X' && d + 10 <= b.length) {
      out.width = 1 + (b[d + 4]! | (b[d + 5]! << 8) | (b[d + 6]! << 16));
      out.height = 1 + (b[d + 7]! | (b[d + 8]! << 8) | (b[d + 9]! << 16));
    } else if (type === 'VP8 ' && d + 10 <= b.length && out.width === undefined) {
      out.width = dv.getUint16(d + 6, true) & 0x3fff;
      out.height = dv.getUint16(d + 8, true) & 0x3fff;
    } else if (type === 'VP8L' && d + 5 <= b.length && out.width === undefined) {
      const bits = dv.getUint32(d + 1, true);
      out.width = 1 + (bits & 0x3fff);
      out.height = 1 + ((bits >> 14) & 0x3fff);
    } else if (type === 'EXIF') {
      const at = ascii(b, d, 6) === 'Exif\0\0' ? d + 6 : d;
      readTiff(b, at, out);
    }
    p = d + len + (len & 1);
  }
}

export function readImageFacts(bytes: Uint8Array): ImageFacts {
  const out = empty();
  try {
    if (bytes.length > 24 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') readPng(bytes, out);
    else if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) readJpeg(bytes, out);
    else if (bytes.length > 16 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') readWebp(bytes, out);
  } catch {
    /* keep what was read */
  }
  return out;
}
