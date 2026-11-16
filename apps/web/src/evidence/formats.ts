/**
 * What the app really does to each kind of file at import, and the plain wording for it (PLAN_REVIEW finding 4).
 * Only JPEG, PNG and WebP are re-encoded in the browser, which drops their hidden details. HEIC, every video, audio and PDF,
 * and any other file are stored exactly as they were, location data and author names included.
 *
 * Wording is survivor-facing: flagged for advocate review in the P6 log.
 */
import { canStrip } from '../lib/metadata';

/** Shown next to the file chooser, before she adds anything. */
export const IMPORT_FORMAT_NOTICE =
  'Matra removes hidden details (like location and camera info) only from JPEG, PNG and WebP photos. Everything else is stored exactly as it is, with whatever is hidden inside it: HEIC photos, videos, recordings, PDFs and other documents can carry a location, a date, a device name or an author’s name.';

/** True when this type's hidden details cannot be removed here (the file is stored exactly as it is). */
export const storedExactly = (mimeType: string): boolean => !canStrip(mimeType);

/**
 * The line shown for a file that was NOT cleaned: plain, and it says what was kept. Null for a cleaned file.
 */
export function unstrippedWarning(mimeType: string, stripped: boolean): string | null {
  if (stripped) return null;
  return `Hidden details were not removed from this file. It is stored exactly as you added it, including anything hidden inside it, such as a location, a date or a name.`;
}

/**
 * What the fingerprint of the original does and does not show. Deliberately modest: the cleaned copy is not byte-for-byte
 * the original, so the fingerprint cannot show it came from that file.
 */
export const FINGERPRINT_NOTE =
  'Matra also keeps a private fingerprint of the file exactly as you chose it, locked in your space. Only a scrambled version of it is ever sent to Matra’s server. If you ever need to show the file existed when you added it, you can, with the key kept in your space. It doesn’t show that the cleaned copy came from that file.';
