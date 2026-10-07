/**
 * Text handling for pdf-lib StandardFonts, which can only encode WinAnsi (CP1252).
 *
 * Policy (the narrative must never be silently corrupted):
 *  - Characters the font can draw are kept exactly.
 *  - Pure typographic variants are mapped to their WinAnsi equivalent (e.g. non-breaking hyphen → "-",
 *    thin space → " ", "→" → "->"). Meaning is unchanged.
 *  - Latin letters with diacritics outside WinAnsi (e.g. "ł", "ő", "ș") are shown as their base letter,
 *    and the document notes that accents were dropped.
 *  - Anything else (emoji, Cyrillic, CJK, Arabic, …) becomes "[?]" — one marker per contiguous run of
 *    unsupported characters, so word boundaries are preserved — and the document notes that the exact
 *    original text is preserved in the encrypted record.
 */

export const UNSUPPORTED_MARK = '[?]';

const TYPOGRAPHIC: Record<number, string> = {
  0x2010: '-', 0x2011: '-', 0x2012: '-', 0x2015: '—', 0x2212: '-',
  0x2000: ' ', 0x2001: ' ', 0x2002: ' ', 0x2003: ' ', 0x2004: ' ', 0x2005: ' ', 0x2006: ' ',
  0x2007: ' ', 0x2008: ' ', 0x2009: ' ', 0x200a: ' ', 0x202f: ' ', 0x205f: ' ', 0x3000: ' ',
  0x2032: "'", 0x2033: '"', 0x201b: '‘', 0x201f: '“', 0x2039: '‹', 0x203a: '›',
  0x2190: '<-', 0x2192: '->', 0x2194: '<->', 0x21d2: '=>', 0x2264: '<=', 0x2265: '>=', 0x2260: '!=',
  0x2022: '•', 0x2023: '•', 0x2043: '-', 0x2219: '·', 0x00a0: ' ',
  0x2028: '\n', 0x2029: '\n',
};

/** Latin letters that do not decompose under NFKD. */
const LATIN_EXTRA: Record<string, string> = {
  'Ł': 'L', 'ł': 'l', 'Đ': 'D', 'đ': 'd', 'Ħ': 'H', 'ħ': 'h', 'ı': 'i', 'Ŧ': 'T', 'ŧ': 't', 'Ŀ': 'L', 'ŀ': 'l',
  'ĸ': 'k', 'Ŋ': 'N', 'ŋ': 'n', 'ƒ': 'f', 'Ɖ': 'D', 'ɖ': 'd',
};

/** Code points that are invisible joiners/modifiers: dropped alone, absorbed into an adjacent unsupported run. */
function isJoiner(cp: number): boolean {
  return (
    cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0xfeff || cp === 0x2060 ||
    (cp >= 0xfe00 && cp <= 0xfe0f) || // variation selectors
    (cp >= 0x1f3fb && cp <= 0x1f3ff) || // skin-tone modifiers
    (cp >= 0xe0020 && cp <= 0xe007f) || // tag characters (flag sequences)
    (cp >= 0x0300 && cp <= 0x036f) // combining diacritics (handled via NFC first)
  );
}

export interface SanitizeResult {
  text: string;
  /** "[?]" markers were inserted. */
  replaced: boolean;
  /** accented letters were shown without accents. */
  transliterated: boolean;
}

export type Sanitizer = (input: string) => SanitizeResult;

export function makeSanitizer(charset: Iterable<number>): Sanitizer {
  const ok = new Set(charset);
  const cache = new Map<string, SanitizeResult>();

  return (input: string): SanitizeResult => {
    const hit = cache.get(input);
    if (hit) return hit;
    let replaced = false;
    let transliterated = false;
    let out = '';
    let inRun = false;
    const src = input.replace(/\r\n?/g, '\n').normalize('NFC');
    for (const ch of src) {
      const cp = ch.codePointAt(0)!;
      if (ch === '\n') { out += '\n'; inRun = false; continue; }
      if (ch === '\t') { out += '    '; inRun = false; continue; }
      if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0 && !ok.has(cp))) { continue; }
      if (ok.has(cp)) { out += ch; inRun = false; continue; }
      if (isJoiner(cp)) continue; // absorbed into any surrounding run, or dropped
      const typo = TYPOGRAPHIC[cp];
      if (typo !== undefined && [...typo].every((c) => c === '\n' || ok.has(c.codePointAt(0)!))) {
        out += typo; inRun = false; continue;
      }
      // Latin letter with diacritic → base letter, if the base is drawable.
      const base = LATIN_EXTRA[ch] ?? ch.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
      if (base && base !== ch && /^[A-Za-z]+$/.test(base) && (cp < 0x0370 || (cp >= 0x1e00 && cp <= 0x1eff))) {
        out += base; transliterated = true; inRun = false; continue;
      }
      if (!inRun) { out += UNSUPPORTED_MARK; inRun = true; replaced = true; }
    }
    const res = { text: out, replaced, transliterated };
    if (cache.size < 5000) cache.set(input, res);
    return res;
  };
}

export interface MeasureFont {
  widthOfTextAtSize(text: string, size: number): number;
}

/**
 * Word-wrap a single paragraph (no newlines) to `maxWidth`. Words longer than a line
 * (hashes, URLs) are broken by character.
 */
export function wrapLine(text: string, font: MeasureFont, size: number, maxWidth: number): string[] {
  if (text === '') return [''];
  const lines: string[] = [];
  const words = text.split(' ');
  const spaceW = font.widthOfTextAtSize(' ', size);
  let line = '';
  let lineW = 0;
  for (const word of words) {
    const w = font.widthOfTextAtSize(word, size);
    if (line === '' && lineW === 0) {
      if (w <= maxWidth) { line = word; lineW = w; continue; }
    } else if (lineW + spaceW + w <= maxWidth) {
      line += ' ' + word; lineW += spaceW + w; continue;
    } else {
      lines.push(line);
      line = ''; lineW = 0;
      if (w <= maxWidth) { line = word; lineW = w; continue; }
    }
    // break an over-long word
    let chunk = '';
    for (const ch of word) {
      if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth && chunk) { lines.push(chunk); chunk = ch; }
      else chunk += ch;
    }
    line = chunk; lineW = font.widthOfTextAtSize(chunk, size);
  }
  lines.push(line);
  return lines;
}

/** Wrap multi-paragraph text; returns lines, with '' for blank lines. */
export function wrapText(text: string, font: MeasureFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) out.push(...wrapLine(para, font, size, maxWidth));
  return out;
}
