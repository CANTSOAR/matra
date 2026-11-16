import type { LedgerEntry } from '@matra/shared';

export interface BriefOptions {
  /** Vault record id of the sealed (encrypted) IntakeRecord. */
  recordId?: string;
  /** SHA-256 (hex) of the record ciphertext, as attested in the ledger. */
  recordContentHash?: string;
  /** Ledger entry that sealed the record (type 'record.sealed'). */
  ledgerEntry?: LedgerEntry;
  generatedAt?: Date;
  /** Hide the survivor's phone/email and witness contact details. */
  redactContactInfo?: boolean;
  /** e.g. "Middlesex County Prosecutor's Office — Special Victims Unit" */
  preparedFor?: string;
  /** Address of the in-browser checker printed in "How to verify" (default: this app's origin + /verify). */
  verifyUrl?: string;
  /**
   * Evidence item id -> the SALTED commitment to the hash of the file as she added it (src/evidence/commitment.ts). Listed
   * in the Evidence Inventory when given. Never a plain hash of the original, and never the salt.
   */
  exhibitFingerprints?: Record<string, string>;
  /**
   * Stored file (blob id) -> its exhibit number, from the one numbering (src/evidence/exhibits.ts buildExhibits), so the number
   * printed here is the number on her screen and in her exhibit list. When given, rows are ordered by it and a file with no
   * number (it was never stored) shows "–"; when absent, rows are simply counted in the order of the record (callers with no file list).
   */
  exhibitNumbers?: Record<string, number>;
}

export interface BriefRow {
  label: string;
  value: string;
  /** Value is survivor-authored text — reproduce verbatim. */
  verbatim?: boolean;
  /** Value is a hash/identifier — render monospace. */
  mono?: boolean;
  /** VCCO draft: this answer still needs to be supplied. */
  needed?: boolean;
}

export interface BriefTableRow {
  cells: string[];
  /** Full-width line under the row (e.g. a SHA-256 digest). */
  detail?: { label: string; value: string; mono?: boolean };
}

export type BriefBlock =
  | { kind: 'rows'; rows: BriefRow[] }
  /** Survivor-authored text. `text` is the exact original string. */
  | { kind: 'verbatim'; label?: string; text: string }
  /** Software-authored explanatory prose. */
  | { kind: 'paragraph'; text: string }
  | { kind: 'note'; text: string; tone?: 'info' | 'warning' }
  | { kind: 'subheading'; text: string }
  | { kind: 'table'; columns: Array<{ header: string; width: number }>; rows: BriefTableRow[] }
  | { kind: 'signature'; lines: Array<{ label: string; wide?: boolean }> }
  | { kind: 'checklist'; items: Array<{ text: string; status: 'ok' | 'needed' | 'warning' | 'info' }> };

export interface BriefSection {
  id: string;
  title: string;
  blocks: BriefBlock[];
  /** PDF: minimum vertical space (pt) required to start this section on the current page. */
  minSpace?: number;
}
