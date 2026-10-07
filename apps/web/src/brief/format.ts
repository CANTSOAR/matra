import type { IncidentType, EvidenceKind, IdentifierKind, Disclosure } from '@matra/shared';

export const NOT_PROVIDED = 'Not provided';

export function has(v: string | undefined | null): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

export function orNP(v: string | undefined | null): string {
  return has(v) ? v : NOT_PROVIDED;
}

export function yesNo(v: boolean | undefined): string {
  return v === undefined ? NOT_PROVIDED : v ? 'Yes' : 'No';
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Parse YYYY-MM-DD (date-only) without time-zone shifting. */
export function parseDateOnly(s: string | undefined): { y: number; m: number; d: number } | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

/** Parse any ISO-ish date to a UTC Date (date-only → midnight UTC). */
export function parseIsoDate(s: string | undefined): Date | null {
  if (!s) return null;
  const d = parseDateOnly(s);
  if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d));
  if (/^\d{4}-\d{2}-\d{2}T/.test(s.trim())) {
    const t = new Date(s.trim());
    return isNaN(t.getTime()) ? null : t;
  }
  return null;
}

export function formatDateUTC(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function formatTimestamp(d: Date): string {
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${formatDateUTC(d)}, ${hh}:${mm} UTC`;
}

/**
 * Human-friendly rendering of a survivor-supplied date. ISO dates are reformatted;
 * anything else (free text like "late March, around spring break") is returned untouched.
 */
export function formatDate(s: string | undefined): string {
  if (!has(s)) return NOT_PROVIDED;
  const t = s.trim();
  const d = parseDateOnly(t);
  if (d) return formatDateUTC(new Date(Date.UTC(d.y, d.m - 1, d.d)));
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(t)) {
    const x = new Date(t);
    if (!isNaN(x.getTime())) return formatTimestamp(x);
  }
  return s;
}

export const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  sexual_assault: 'Sexual assault',
  rape: 'Rape',
  attempted_sexual_assault: 'Attempted sexual assault',
  unwanted_touching: 'Unwanted sexual touching',
  stalking: 'Stalking',
  harassment: 'Harassment',
  domestic_violence: 'Domestic violence',
  dating_violence: 'Dating violence',
  image_based_abuse: 'Image-based sexual abuse',
  drugging_suspected: 'Suspected drugging / drug-facilitated',
  other: 'Other',
};

export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  photo: 'Photo',
  video: 'Video',
  screenshot: 'Screenshot',
  audio: 'Audio',
  document: 'Document',
  message_export: 'Message export',
  other: 'Other',
};

export const IDENTIFIER_LABELS: Record<IdentifierKind, string> = {
  email: 'Email',
  phone: 'Phone',
  social_handle: 'Social media',
  full_name: 'Full name',
  other: 'Other identifier',
};

export const DISCLOSURE_METHOD_LABELS: Record<NonNullable<Disclosure['method']>, string> = {
  in_person: 'In person',
  phone: 'Phone call',
  text: 'Text message',
  social_media: 'Social media message',
  email: 'Email',
  other: 'Other',
};

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return NOT_PROVIDED;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function goalLabel(v: 'yes' | 'no' | 'undecided' | 'unsure' | undefined): string {
  switch (v) {
    case 'yes': return 'Yes';
    case 'no': return 'No';
    case 'undecided': return 'Undecided';
    case 'unsure': return 'Unsure';
    default: return NOT_PROVIDED;
  }
}
