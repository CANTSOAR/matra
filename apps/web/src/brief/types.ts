import type { LedgerEntry } from '@shield/shared';

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
