/**
 * Draft slots: one encrypted, overwritable envelope per (account, opaque name), kept apart from the WORM records and
 * the ledger (apps/server/src/slots.ts, packages/crypto/src/slots.ts). Her draft autosaves here; sealing writes a WORM
 * record as before and leaves the slot in place, so she can add to a sealed version later.
 *
 * MATRA_DRAFT_MODE=slot|keep-versions decides whether the server also keeps each earlier draft (counsel question Q-004
 * decides the launch default; until then it is "slot"):
 *   slot           each save replaces the one before. Only the newest draft exists on the server.
 *   keep-versions  each save ALSO files the same envelope as a WORM record with a ledger entry (how every draft save
 *                  worked before slots), so every earlier draft is kept until she deletes her account.
 */
import type { Envelope, WrappedKey } from './index.js';

export type DraftMode = 'slot' | 'keep-versions';

/** The value of MATRA_DRAFT_MODE: "slot" when unset or empty; anything other than "slot" or "keep-versions" throws. */
export function parseDraftMode(raw: string | undefined): DraftMode {
  const v = raw?.trim().toLowerCase();
  if (!v) return 'slot';
  if (v === 'slot' || v === 'keep-versions') return v;
  throw new Error(`MATRA_DRAFT_MODE must be "slot" or "keep-versions", got "${raw}"`);
}

/**
 * Slot ciphertext (with its 16-byte GCM tag) is always a whole number of these, so the server learns her draft's size
 * only to the nearest 16 KiB.
 */
export const SLOT_BUCKET_BYTES = 16 * 1024;
/** Largest slot ciphertext the server accepts (192 buckets, 3 MiB; its base64 fits the server's 5 MB JSON limit). */
export const SLOT_MAX_BYTES = 192 * SLOT_BUCKET_BYTES;
/** Most slots one account may hold (the planned set is draft, case card, dates, expenses, contacts, contact log, guide). */
export const SLOT_MAX_PER_ACCOUNT = 16;
/** A slot name is 64 lowercase hex characters: HMAC-SHA256 under her slot-name key, so the server can't tell slots apart. */
export const SLOT_NAME_RE = /^[0-9a-f]{64}$/;

export interface VaultSlot {
  name: string;
  envelope: Envelope;
  /** the slot's content key, wrapped under her master key */
  wrappedKey: WrappedKey;
  /** random tag (32 hex), new on every write; a write must name the version it read (compare-and-swap) */
  version: string;
  /** UTC day of the last write (YYYY-MM-DD); no finer time is stored */
  updatedDay: string;
}

/** GET /api/vault/slots/:name. `slot` is null when she has none by that name. */
export interface GetSlotResponse {
  slot: VaultSlot | null;
  draftMode: DraftMode;
}

/** PUT /api/vault/slots/:name. `expectedVersion` is the version she read (null = no slot yet). Stale → 409 `slot_conflict`. */
export interface PutSlotRequest {
  envelope: Envelope;
  wrappedKey: WrappedKey;
  expectedVersion: string | null;
}

export interface PutSlotResponse {
  version: string;
  updatedDay: string;
  draftMode: DraftMode;
}
