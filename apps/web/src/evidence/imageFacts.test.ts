import { describe, expect, it } from 'vitest';
import { readImageFacts } from './imageFacts';
import { isScreenSize, screenshotSignals } from './screenshot';

const enc = (s: string) => Array.from(new TextEncoder().encode(s));

/** A little-endian TIFF block with the entries asked for (ASCII values stored after the table). */
function tiff(opts: { make?: string; model?: string; dateTime?: string; original?: string; gps?: boolean }): number[] {
  const strings: Array<{ tag: number; value: string }> = [];
  if (opts.make) strings.push({ tag: 0x010f, value: opts.make });
  if (opts.model) strings.push({ tag: 0x0110, value: opts.model });
  if (opts.dateTime) strings.push({ tag: 0x0132, value: opts.dateTime });
  const exif: Array<{ tag: number; value: string }> = opts.original ? [{ tag: 0x9003, value: opts.original }] : [];
  const out: number[] = [0x49, 0x49, 42, 0, 8, 0, 0, 0];
  const u16 = (n: number) => [n & 255, n >> 8];
  const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  const ifd0Entries = strings.length + (exif.length ? 1 : 0) + (opts.gps ? 1 : 0);
  const ifd0Size = 2 + ifd0Entries * 12 + 4;
  let dataAt = 8 + ifd0Size;
  const exifIfdAt = dataAt;
  const exifIfdSize = exif.length ? 2 + exif.length * 12 + 4 : 0;
  dataAt += exifIfdSize;
  const blobs: number[] = [];
  const entry = (tag: number, value: string) => {
    const bytes = [...enc(value), 0];
    const e = [...u16(tag), ...u16(2), ...u32(bytes.length), ...u32(dataAt + blobs.length)];
    blobs.push(...bytes);
    return e;
  };
  const ifd0: number[] = [...u16(ifd0Entries)];
  for (const s of strings) ifd0.push(...entry(s.tag, s.value));
  if (exif.length) ifd0.push(...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifIfdAt));
  if (opts.gps) ifd0.push(...u16(0x8825), ...u16(4), ...u32(1), ...u32(0));
  ifd0.push(...u32(0));
  const exifIfd: number[] = exif.length ? [...u16(exif.length)] : [];
  for (const s of exif) exifIfd.push(...entry(s.tag, s.value));
  if (exif.length) exifIfd.push(...u32(0));
  return [...out, ...ifd0, ...exifIfd, ...blobs];
}

function jpeg(width: number, height: number, exif?: number[]): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  if (exif) {
    const payload = [...enc('Exif'), 0, 0, ...exif];
    parts.push(0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload);
  }
  parts.push(0xff, 0xc0, 0, 11, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0);
  parts.push(0xff, 0xda, 0, 2);
  return new Uint8Array(parts);
}

describe('image facts (read from the bytes; says nothing about what the picture shows)', () => {
  it('reads size, camera fields, GPS presence and date strings exactly as written', () => {
    const f = readImageFacts(jpeg(4032, 3024, tiff({ make: 'Acme', model: 'Phone 9', dateTime: '2026:03:03 14:22:10', original: '2026:03:02 09:00:01', gps: true })));
    expect(f).toMatchObject({ width: 4032, height: 3024, hasCameraData: true, hasLocation: true });
    expect(f.exifDates).toEqual([
      { tag: 'DateTime', value: '2026:03:03 14:22:10' },
      { tag: 'DateTimeOriginal', value: '2026:03:02 09:00:01' },
    ]);
  });

  it('a file with no EXIF has no camera data, no location and no dates', () => {
    expect(readImageFacts(jpeg(1170, 2532))).toEqual({ width: 1170, height: 2532, hasCameraData: false, hasLocation: false, exifDates: [] });
  });

  it('reads PNG and WebP sizes, and never throws on junk or truncated files', () => {
    const png = new Uint8Array(40);
    png.set([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 4, 0x82, 0, 0, 9, 0xc4]);
    expect(readImageFacts(png)).toMatchObject({ width: 1154, height: 2500 });
    const webp = new Uint8Array(30);
    webp.set(enc('RIFF'), 0);
    webp.set(enc('WEBP'), 8);
    webp.set(enc('VP8X'), 12);
    webp.set([10, 0, 0, 0, 0, 0, 0, 0, 0x7f, 0x02, 0, 0xe6, 0x03, 0], 16); // chunk length, flags (4), then 3-byte (w-1) and (h-1)
    expect(readImageFacts(webp)).toMatchObject({ width: 640, height: 999 });
    for (const junk of [new Uint8Array(0), new Uint8Array([0xff, 0xd8]), new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]), new Uint8Array(100).fill(0xff), jpeg(10, 10, [0x49, 0x49, 42, 0, 255, 255, 255, 255])])
      expect(() => readImageFacts(junk)).not.toThrow();
    // an EXIF that points outside the file gives nothing, not an error
    expect(readImageFacts(jpeg(10, 10, [0x49, 0x49, 42, 0, 255, 255, 255, 255])).hasCameraData).toBe(false);
  });
});

describe('screenshot label', () => {
  const base = { mimeType: 'image/png', hasCameraData: false };
  it('by file name', () => {
    for (const n of ['Screenshot 2026-03-03 at 10.12.04.png', 'Screenshot_20260303-101204.png', 'Bildschirmfoto 2026-03-03.png', 'screen shot (2).png'])
      expect(screenshotSignals({ ...base, fileName: n }), n).toEqual({ likely: true, reasons: ['file-name'] });
  });
  it('by a screen size with no camera data, either orientation', () => {
    expect(screenshotSignals({ ...base, fileName: 'IMG_1.PNG', width: 1170, height: 2532 }).likely).toBe(true);
    expect(screenshotSignals({ ...base, fileName: 'IMG_1.PNG', width: 2532, height: 1170 }).likely).toBe(true);
    expect(isScreenSize(1920, 1080)).toBe(true);
  });
  it('not for a camera photo of a screen-sized frame, an odd size, a non-image, or no size', () => {
    expect(screenshotSignals({ ...base, fileName: 'IMG_1.JPG', mimeType: 'image/jpeg', hasCameraData: true, width: 1920, height: 1080 }).likely).toBe(false);
    expect(screenshotSignals({ ...base, fileName: 'IMG_1.PNG', width: 1234, height: 987 }).likely).toBe(false);
    expect(screenshotSignals({ ...base, fileName: 'Screenshot.pdf', mimeType: 'application/pdf' }).likely).toBe(false);
    expect(screenshotSignals({ ...base, fileName: 'IMG_1.PNG' }).likely).toBe(false);
  });
});
