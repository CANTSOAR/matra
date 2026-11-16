import { describe, expect, it } from 'vitest';
import { clampBox, paintBlack, type Pixels } from './redact';

const img = (w: number, h: number, fill = 200): Pixels => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(fill) });
const px = (i: Pixels, x: number, y: number) => Array.from(i.data.slice((y * i.width + x) * 4, (y * i.width + x) * 4 + 4));

describe('redaction pixels', () => {
  it('overwrites the boxed area with opaque black and leaves every other pixel as it was', () => {
    const a = img(10, 10);
    const before = new Uint8ClampedArray(a.data);
    expect(paintBlack(a, [{ x: 2, y: 3, w: 4, h: 2 }])).toBe(1);
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 10; x++) {
        const inside = x >= 2 && x < 6 && y >= 3 && y < 5;
        expect(px(a, x, y), `${x},${y}`).toEqual(inside ? [0, 0, 0, 255] : [200, 200, 200, 200]);
      }
    expect(before.every((v) => v === 200)).toBe(true); // (the input copy is not the output)
  });

  it('the painted pixels carry no trace of what was there (they are overwritten, not covered)', () => {
    const a = img(4, 4);
    a.data.set([12, 34, 56, 255], 0);
    paintBlack(a, [{ x: 0, y: 0, w: 4, h: 4 }]);
    for (let i = 0; i < a.data.length; i += 4) expect(Array.from(a.data.slice(i, i + 4))).toEqual([0, 0, 0, 255]);
  });

  it('clamps boxes to the picture, accepts a box drawn backwards, and ignores empty or outside ones', () => {
    expect(clampBox({ x: -5, y: -5, w: 100, h: 100 }, 10, 8)).toEqual({ x: 0, y: 0, w: 10, h: 8 });
    expect(clampBox({ x: 6, y: 5, w: -4, h: -3 }, 10, 10)).toEqual({ x: 2, y: 2, w: 4, h: 3 });
    expect(clampBox({ x: 20, y: 0, w: 5, h: 5 }, 10, 10)).toBeNull();
    expect(clampBox({ x: 1, y: 1, w: 0, h: 5 }, 10, 10)).toBeNull();
    expect(clampBox({ x: NaN, y: 0, w: 5, h: 5 }, 10, 10)).toBeNull();
    const a = img(5, 5);
    expect(paintBlack(a, [{ x: 50, y: 50, w: 3, h: 3 }])).toBe(0);
    expect(a.data.every((v) => v === 200)).toBe(true);
  });
});
