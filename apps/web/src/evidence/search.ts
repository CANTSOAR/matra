/**
 * Search over her files, on her device (PR 34): file names, her own descriptions, and the text read from images when she
 * asked for it. The query is held in memory only: it is not stored, logged or sent anywhere.
 *
 * The index is built in memory from what her encrypted space holds (her draft's file details and her private evidence slot)
 * and is dropped with the page (lock and quick exit clear screen state). It is not written anywhere else, so there is no
 * second copy of her text to protect.
 *
 * Matching is plain: every word of the query must appear, as the start of a word, ignoring case and accents. A result shows
 * the exact words as they are in her file (an excerpt of the original text, never a paraphrase).
 */
import type { Exhibit } from './exhibits';

export type SearchField = 'name' | 'description' | 'text';

export interface SearchHit {
  id: string;
  number: number;
  fileName: string;
  /** where the words were found, best first */
  fields: SearchField[];
  /** exact words from the file around the first match, with the match's position inside it */
  excerpt?: { text: string; start: number; end: number; field: SearchField };
}

interface Doc {
  exhibit: Exhibit;
  fields: Array<{ field: SearchField; original: string; norm: string; map: number[] }>;
}

/** Lowercase, accents removed; `map[i]` is the index in the original of the i-th normalised character. */
export function fold(s: string): { norm: string; map: number[] } {
  let norm = '';
  const map: number[] = [];
  let i = 0;
  for (const ch of s) {
    const f = ch.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
    for (const c of f) {
      norm += c;
      map.push(i);
    }
    i += ch.length;
  }
  return { norm, map };
}

const wordsOf = (q: string): string[] => fold(q).norm.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

export class EvidenceIndex {
  private readonly docs: Doc[];
  constructor(exhibits: readonly Exhibit[]) {
    this.docs = exhibits.map((exhibit) => ({
      exhibit,
      fields: (
        [
          ['name', exhibit.fileName],
          ['description', exhibit.description ?? ''],
          ['text', exhibit.ocrText ?? ''],
        ] as Array<[SearchField, string]>
      )
        .filter(([, v]) => v)
        .map(([field, original]) => ({ field, original, ...fold(original) })),
    }));
  }

  /** Exhibits where every query word starts a word in the name, description or text (together). Empty query: nothing. */
  search(query: string, limit = 50): SearchHit[] {
    const words = wordsOf(query);
    if (!words.length) return [];
    const hits: SearchHit[] = [];
    for (const d of this.docs) {
      const found = words.map((w) => d.fields.map((f) => ({ f, at: indexOfWordStart(f.norm, w) })).filter((x) => x.at >= 0));
      if (found.some((x) => x.length === 0)) continue;
      const fields = [...new Set(found.flat().map((x) => x.f.field))];
      const first = found[0]![0]!;
      const start = first.f.map[first.at]!;
      const last = Math.min(first.at + words[0]!.length, first.f.map.length) - 1;
      const end = (first.f.map[last] ?? start) + 1;
      const from = Math.max(0, start - 40);
      const to = Math.min(first.f.original.length, end + 60);
      hits.push({
        id: d.exhibit.id,
        number: d.exhibit.number,
        fileName: d.exhibit.fileName,
        fields,
        ...(first.f.field !== 'name' && { excerpt: { text: first.f.original.slice(from, to), start: start - from, end: end - from, field: first.f.field } }),
      });
      if (hits.length >= limit) break;
    }
    return hits;
  }
}

/** Index of the first place `w` starts a word in `norm`, or -1. */
function indexOfWordStart(norm: string, w: string): number {
  let at = norm.indexOf(w);
  while (at >= 0) {
    if (at === 0 || !/[\p{L}\p{N}]/u.test(norm[at - 1]!)) return at;
    at = norm.indexOf(w, at + 1);
  }
  return -1;
}
