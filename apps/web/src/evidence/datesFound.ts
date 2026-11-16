/**
 * "Dates found in your files" (PR 35): date strings found in the text read from her images and in the dates her files' own
 * metadata held, each shown EXACTLY as written, with the file it came from. Nothing is converted, completed, ordered into a
 * timeline, compared with her account, or merged into it: it is a list of strings and where they were.
 *
 * Behind MATRA_DATES_FOUND (off by default; see ./datesFlag.ts). The part of the plan that needs P2 (her narrative sealed
 * first, shown only when she asks) is the caller's job, and is not built here because P2 does not exist.
 *
 * chrono-node only FINDS where a date is written; what is shown is the characters at that place in the text, never its parse.
 */
import * as chrono from 'chrono-node';
import type { ExifString } from './imageFacts';

export interface FoundDate {
  /** the characters exactly as they appear in the file */
  text: string;
  source: 'text-in-image' | 'file-metadata';
  /** for a metadata date: the field's own name, e.g. DateTimeOriginal */
  field?: string;
  /** exhibit number and name of the file */
  exhibit: number;
  fileName: string;
}

const MONTH = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i;
/** a numeric date written with separators: 03/04/2026, 3.4.26, 2026-03-10, 2026:03:02 */
const NUMERIC_DATE = /\b\d{1,4}[/.:-]\d{1,2}[/.:-]\d{1,4}\b/;

/** The date strings written in a text, exactly as written, each once, in order of appearance. */
export function datesInText(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of chrono.parse(text)) {
    const s = r.text;
    const written = r.start.isCertain('day') || r.start.isCertain('month') || r.start.isCertain('year');
    if (!written || !(NUMERIC_DATE.test(s) || MONTH.test(s)) || text.slice(r.index, r.index + s.length) !== s) continue;
    if (!seen.has(s)) (seen.add(s), out.push(s));
  }
  return out;
}

export interface DatesSource {
  exhibit: number;
  fileName: string;
  ocrText?: string;
  /** date strings from the file's metadata, as read at import (EXIF fields) */
  metadataDates?: readonly ExifString[];
}

export function datesFound(files: readonly DatesSource[]): FoundDate[] {
  const out: FoundDate[] = [];
  for (const f of files) {
    for (const m of f.metadataDates ?? []) out.push({ text: m.value, source: 'file-metadata', field: m.tag, exhibit: f.exhibit, fileName: f.fileName });
    if (f.ocrText) for (const text of datesInText(f.ocrText)) out.push({ text, source: 'text-in-image', exhibit: f.exhibit, fileName: f.fileName });
  }
  return out;
}
