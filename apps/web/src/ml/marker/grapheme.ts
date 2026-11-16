/**
 * Is an offset on a character boundary? A mark must not cut a user-perceived character: half of an emoji (a UTF-16 surrogate
 * pair), a letter without its combining accent (NFD "Dana" + U+0301), or a ZWJ sequence. The quote shown to her would then be a
 * different word from the one she wrote, or an unpaired surrogate.
 *
 * Uses Intl.Segmenter (graphemes) where it exists and a rule-based fallback otherwise, so the answer never depends on the engine.
 */
const FALLBACK_CONTINUATION = /[\p{M}‍️︎\u{1f3fb}-\u{1f3ff}\u{e0020}-\u{e007f}]/u;
const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** Boundary test by rule, for runtimes without Intl.Segmenter (and as a second opinion). Conservative: when unsure, "not a boundary". */
export function isBoundaryByRule(text: string, i: number): boolean {
  if (i <= 0 || i >= text.length) return i === 0 || i === text.length;
  const prev = text.charCodeAt(i - 1);
  const cur = text.charCodeAt(i);
  if (isHigh(prev) && isLow(cur)) return false; // inside a surrogate pair
  if (isLow(cur) || isHigh(prev)) return false; // an unpaired surrogate: never a place to cut
  const cp = text.codePointAt(i)!;
  if (FALLBACK_CONTINUATION.test(String.fromCodePoint(cp))) return false; // combining mark, ZWJ, variation selector, skin tone, tag
  const before = text.slice(Math.max(0, i - 2), i);
  if (before.endsWith('‍')) return false; // right after a ZWJ: the next character is part of the sequence
  return true;
}

/**
 * Returns a function that says whether an offset is a grapheme boundary of `text`. Segments the text once, on first use.
 */
export function boundaryChecker(text: string): (i: number) => boolean {
  let set: Set<number> | null | undefined;
  return (i) => {
    if (!isBoundaryByRule(text, i)) return false; // the rules alone can already say no
    if (set === undefined) {
      set = null;
      const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: 'grapheme' }) => { segment(s: string): Iterable<{ index: number }> } }).Segmenter;
      if (Seg) {
        try {
          set = new Set<number>();
          for (const s of new Seg('und', { granularity: 'grapheme' }).segment(text)) set.add(s.index);
          set.add(text.length);
        } catch {
          set = null;
        }
      }
    }
    return set ? set.has(i) : true;
  };
}
