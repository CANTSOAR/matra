/**
 * Metadata stripping, done on-device BEFORE encryption.
 * JPEG/PNG/WebP are re-encoded through a canvas, which keeps only pixels — EXIF (incl. GPS),
 * XMP, IPTC, camera serials and embedded thumbnails are dropped.
 * Other formats cannot be cleaned reliably in the browser; we say so honestly.
 */
export const STRIPPABLE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export interface StripResult {
  blob: Blob;
  stripped: boolean;
  /** Plain-language explanation shown to the survivor. */
  note: string;
}

export function canStrip(mime: string): boolean {
  return (STRIPPABLE_TYPES as readonly string[]).includes(mime.toLowerCase());
}

export function adviceFor(mime: string): string {
  const m = mime.toLowerCase();
  if (m.startsWith('video/'))
    return 'We couldn’t remove hidden details from this video automatically. Videos can include the date, device and sometimes location. If that worries you, an attorney or advocate can help you review it.';
  if (m.startsWith('audio/'))
    return 'We couldn’t remove hidden details from this recording automatically. Audio files can include the recording date and device name.';
  if (m === 'application/pdf')
    return 'We couldn’t remove hidden details from this PDF automatically. PDFs can include an author name and the software used. Printing to a new PDF can remove some of this. If you do that, please keep the original PDF too.';
  if (m.startsWith('image/'))
    return 'This image type can’t be cleaned automatically (e.g. HEIC). If you’d like to remove location details, you can take a screenshot of it and upload the screenshot instead. Please keep the original photo too — it can show things the screenshot can’t, like when it was taken.';
  return 'We couldn’t remove hidden details from this file automatically. It is still encrypted before it leaves your device.';
}

async function canvasToBlob(width: number, height: number, draw: (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => void, type: string): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(width, height);
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    draw(ctx);
    return c.convertToBlob({ type, quality: 0.92 });
  }
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  draw(ctx);
  return new Promise<Blob>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, 0.92),
  );
}

export async function stripMetadata(file: Blob & { type: string }): Promise<StripResult> {
  const type = (file.type || '').toLowerCase();
  if (!canStrip(type) || typeof createImageBitmap !== 'function') {
    return { blob: file, stripped: false, note: adviceFor(type) };
  }
  try {
    // honour EXIF orientation so the cleaned image isn't rotated
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    try {
      const blob = await canvasToBlob(bmp.width, bmp.height, (ctx) => ctx.drawImage(bmp, 0, 0), type);
      return {
        blob,
        stripped: true,
        note: 'Hidden details (like location and camera info) were removed from the copy saved here, on your device, before encryption. Please keep your original file too.',
      };
    } finally {
      bmp.close?.();
    }
  } catch {
    return {
      blob: file,
      stripped: false,
      note: 'We tried to remove hidden details from this image but couldn’t. ' + adviceFor('image/other'),
    };
  }
}
