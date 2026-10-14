import { afterEach, describe, expect, it, vi } from 'vitest';
import { adviceFor, canStrip, stripMetadata } from './metadata';

describe('stripMetadata', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('re-encodes JPEG/PNG/WebP through a canvas and returns a new Blob', async () => {
    const close = vi.fn();
    const bitmap = { width: 4, height: 3, close };
    const createImageBitmap = vi.fn(async () => bitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    vi.stubGlobal('OffscreenCanvas', undefined);
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const cleaned = new Blob([new Uint8Array([9, 9, 9])], { type: 'image/jpeg' });
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback, type?: string) {
        expect(this.width).toBe(4);
        expect(this.height).toBe(3);
        expect(type).toBe('image/jpeg');
        cb(cleaned);
      });

    const original = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 1, 2, 3])], 'IMG_0001.jpg', { type: 'image/jpeg' });
    const res = await stripMetadata(original);
    expect(res.stripped).toBe(true);
    expect(res.blob).not.toBe(original);
    expect(res.blob).toBe(cleaned);
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(toBlob).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it('flags non-image files as not stripped and returns them unchanged with advice', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn());
    for (const [type, word] of [['video/mp4', 'video'], ['audio/mpeg', 'recording'], ['application/pdf', 'PDF']] as const) {
      const f = new File([new Uint8Array([1])], 'x', { type });
      const res = await stripMetadata(f);
      expect(res.stripped).toBe(false);
      expect(res.blob).toBe(f);
      expect(res.note).toContain(word);
    }
    expect(canStrip('image/heic')).toBe(false);
  });

  it('never suggests replacing an original without keeping it', () => {
    // HEIC → screenshot and PDF → re-print are optional; the original is always worth keeping (Whitepaper §3).
    expect(adviceFor('image/heic')).toMatch(/keep the original photo too/);
    expect(adviceFor('application/pdf')).toMatch(/keep the original PDF too/);
  });

  it('falls back safely (not stripped) if decoding fails', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('bad'); }));
    const f = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' });
    const res = await stripMetadata(f);
    expect(res.stripped).toBe(false);
    expect(res.blob).toBe(f);
  });
});
