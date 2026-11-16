import { describe, expect, it } from 'vitest';
import { datesFound, datesInText } from './datesFound';

describe('dates found in your files', () => {
  it('shows date strings exactly as written, never a converted form', () => {
    const text = 'Paid on 03/04/2026 at the desk.\nReturn by March 9, 2026 or on 2026-03-10.\nCall me on the 5th of May.';
    const found = datesInText(text);
    expect(found).toContain('03/04/2026');
    expect(found).toContain('March 9, 2026');
    expect(found).toContain('2026-03-10');
    // every one is a substring of the original, character for character
    for (const f of found) expect(text).toContain(f);
  });

  it('does not list a time, a price, a word like "tomorrow", or text with no date', () => {
    expect(datesInText('Total $12.50 at 10:30 tomorrow, see you soon. Invoice 4471.')).toEqual([]);
  });

  it('lists each string once, with the file it came from, metadata dates as written in the file, and does not sort, merge or compare', () => {
    const out = datesFound([
      { exhibit: 2, fileName: 'b.jpg', metadataDates: [{ tag: 'DateTimeOriginal', value: '2026:03:02 09:00:01' }] },
      { exhibit: 1, fileName: 'a.png', ocrText: 'Due 03/04/2026. Again 03/04/2026.' },
    ]);
    expect(out).toEqual([
      { text: '2026:03:02 09:00:01', source: 'file-metadata', field: 'DateTimeOriginal', exhibit: 2, fileName: 'b.jpg' },
      { text: '03/04/2026', source: 'text-in-image', exhibit: 1, fileName: 'a.png' },
    ]);
  });
});
