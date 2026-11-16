/**
 * Redacted copies (PR 36). She draws boxes over part of an image; a NEW image is made with those areas painted solid black,
 * and it is added as its own file, labelled "Redacted copy of exhibit N". The original is never changed, replaced or removed.
 *
 * Images only. The copy is re-encoded as a PNG (lossless), so it carries no metadata from the original, and the painted
 * pixels are gone from the copy: they are overwritten with opaque black, not covered by a layer that could be lifted.
 *
 * No suggestions: nothing looks at the picture to guess what should be covered (no face or object detection). She draws every
 * box herself.
 */
export interface Box {
  /** pixels of the image itself, from its top left corner */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, row by row */
  data: Uint8ClampedArray;
}

/** A box inside the image, whole pixels, or null when nothing of it is inside (or it has no area). */
export function clampBox(b: Box, width: number, height: number): Box | null {
  const x0 = Math.max(0, Math.floor(Math.min(b.x, b.x + b.w)));
  const y0 = Math.max(0, Math.floor(Math.min(b.y, b.y + b.h)));
  const x1 = Math.min(width, Math.ceil(Math.max(b.x, b.x + b.w)));
  const y1 = Math.min(height, Math.ceil(Math.max(b.y, b.y + b.h)));
  if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Paint the boxes opaque black in place. Returns how many boxes had any area inside the image. */
export function paintBlack(img: Pixels, boxes: readonly Box[]): number {
  let painted = 0;
  for (const raw of boxes) {
    const b = clampBox(raw, img.width, img.height);
    if (!b) continue;
    painted++;
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        const i = (y * img.width + x) * 4;
        img.data[i] = 0;
        img.data[i + 1] = 0;
        img.data[i + 2] = 0;
        img.data[i + 3] = 255;
      }
    }
  }
  return painted;
}

/** Decode an image, black out the boxes, and return a PNG. Throws if the browser cannot decode it or there is no box. */
export async function redactImage(source: Blob, boxes: readonly Box[]): Promise<Blob> {
  if (typeof createImageBitmap !== 'function') throw new Error('This browser cannot edit images.');
  const bmp = await createImageBitmap(source, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  try {
    const canvas: OffscreenCanvas | HTMLCanvasElement =
      typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error('2d context unavailable');
    ctx.drawImage(bmp, 0, 0);
    const px = ctx.getImageData(0, 0, bmp.width, bmp.height);
    if (paintBlack(px, boxes) === 0) throw new Error('Draw at least one box on the image first.');
    ctx.putImageData(px, 0, 0);
    if ('convertToBlob' in canvas) return await canvas.convertToBlob({ type: 'image/png' });
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
  } finally {
    bmp.close?.();
  }
}
