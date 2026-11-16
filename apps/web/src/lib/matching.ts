/**
 * Sealed matching on her device (Callisto-style; packages/crypto/src/matching.ts): which identifiers she chose to
 * seal, sealing them, re-sealing after a key rotation, withdrawing, and the labels she sees.
 *
 * Only builds with MATRA_MATCHING=on reach this module: every caller imports it behind `__MATRA_MATCHING__`, so a
 * matching-off build leaves it, the OPRF client and its API routes out entirely (scripts/audit-web-build.mjs).
 */
import {
  AttestationError,
  decryptJSON,
  normalizeMatchIdentifier,
  refreshMatchEntries,
  sha256Hex,
  submitMatchEntry,
  ThresholdOprfError,
} from '@matra/crypto';
import type { IntakeRecord, MatchContactPreferences } from '@matra/shared';
import { matchingApi, type MatchingApiClient } from '../api/matching';
import { matchContactOf } from '../intake/record';
import { MATCH_PINS } from '../matchPins';
import { mirror } from '../dev/mirror';
import { MATCHING_CONSENT_LINES } from './disclosures';
import { useRequiredSession } from './session';
import * as vault from './vault';
import { updateDraftSlot } from './draftSlot';

const ESCROW_KIND_LABEL: Record<string, string> = {
  email: 'email',
  phone: 'phone number',
  social: 'social media handle',
};

/**
 * The explanation she agrees to when she opts in. Stored verbatim (encrypted) in her contact bundle, so the counselor
 * sees exactly what she was told: it is built from the same lines the opt-in shows her (lib/disclosures.ts).
 */
export const MATCHING_CONSENT_STATEMENT = /* @__PURE__ */ MATCHING_CONSENT_LINES.join(' ');

/** How she said a counselor may reach her (the intake's person.matchContact answer). */
export interface MatchContactInput {
  method?: string;
  detail?: string;
  notes?: string;
}

/** Build contact preferences from her explicit answer, falling back to the safe-contact details in her record. */
export function matchContactFrom(record: IntakeRecord, input?: MatchContactInput): MatchContactPreferences | null {
  const s = record.survivor;
  const base = {
    ...(s.preferredName && { name: s.preferredName }),
    ...(s.preferredLanguage && { language: s.preferredLanguage }),
  };
  const detail = input?.detail?.trim();
  if (input?.method && detail) {
    const notes = input.notes?.trim() || s.safeContactNotes;
    const n = notes ? { notes } : {};
    if (input.method === 'email') return detail.includes('@') ? { ...base, ...n, methods: ['email'], email: detail } : null;
    if (input.method === 'phone' || input.method === 'call') return { ...base, ...n, methods: ['call'], phone: detail };
    if (input.method === 'text') return { ...base, ...n, methods: ['text'], phone: detail };
  }
  const methods: MatchContactPreferences['methods'] = [];
  if (s.phone && s.safeContact?.phone) methods.push('call');
  if (s.phone && s.safeContact?.text) methods.push('text');
  if (s.phone && s.safeContact?.voicemail) methods.push('voicemail');
  if (s.email && s.safeContact?.email) methods.push('email');
  if (!methods.length) return null;
  return {
    ...base,
    methods,
    ...(methods.some((m) => m !== 'email') && s.phone && { phone: s.phone }),
    ...(methods.includes('email') && s.email && { email: s.email }),
    ...(s.safeContactNotes && { notes: s.safeContactNotes }),
  };
}

export class MatchingError extends Error {
  /** `phone_verification_required`: she has to confirm a phone number first (counselor/PhoneVerify.tsx). */
  constructor(
    message: string,
    readonly code?: 'phone_verification_required',
  ) {
    super(message);
    this.name = 'MatchingError';
  }
}

/** The message the sealed screen and Home show when a sealed match waits for her phone confirmation. */
export const PHONE_VERIFICATION_NEEDED = 'Your story is sealed. To turn on your sealed match, confirm a phone number first.';

/** Local (vault-only) fingerprint of a canonical identifier, for de-duplication. Never sent to the server. */
const localKey = (canonical: string) => sha256Hex(`matra/match/v1/local|${canonical}`);

type MatchTodo = { label: string; id: Extract<ReturnType<typeof normalizeMatchIdentifier>, { ok: true }>; key: string };

/** The opted-in, matchable identifiers in `record` that are not sealed yet (not in `done`). */
async function matchTodo(record: IntakeRecord, done: Set<string>): Promise<MatchTodo[]> {
  const todo: MatchTodo[] = [];
  for (const p of record.perpetrators) {
    if (!p.escrowOptIn) continue;
    for (const raw of p.identifiers) {
      // Only unique identifiers: free text ('other') and names are never sealed, whatever they look like.
      if (raw.kind !== 'email' && raw.kind !== 'phone' && raw.kind !== 'social_handle') continue;
      const id = normalizeMatchIdentifier(raw.kind, raw.value, raw.platform);
      if (!id.ok) continue; // names and unrecognised text are never sealed
      const key = await localKey(id.canonical);
      if (done.has(key) || todo.some((t) => t.key === key)) continue;
      const label = `${p.name?.trim() || 'A person you named'} · ${ESCROW_KIND_LABEL[id.kind] ?? 'identifier'}${id.platform ? ` (${id.platform})` : ''}`;
      todo.push({ label, id, key });
    }
  }
  return todo;
}

/** Does her sealed record still have identifiers she chose to seal for matching that aren't sealed yet? */
export async function hasUnsealedMatches(record: IntakeRecord | undefined, alreadyLodged: string[] = []): Promise<boolean> {
  return !!record && (await matchTodo(record, new Set(alreadyLodged))).length > 0;
}

/**
 * Seal every opted-in perpetrator identifier for sealed matching (Callisto-style; see packages/crypto/src/matching.ts).
 * Names are never used. Returns the local fingerprints sealed so far (keep them in her draft slot as `escrowedHashes`,
 * lib/draftSlot.ts: encrypted in her own vault, and never in a sealed record she may share).
 *
 * `opts.contact` is how a legal options counselor may reach her if there is a match; without it, her safe-contact
 * details from the record are used. With neither, nothing is sealed and a MatchingError explains why.
 * The server always answers 'sealed' — survivors never see match results (anti-self-check).
 */
export async function lodgeEscrow(
  api: MatchingApiClient,
  masterKey: CryptoKey,
  record: IntakeRecord,
  alreadyLodged: string[] = [],
  opts: { contact?: MatchContactInput; consentStatement?: string } = {},
): Promise<string[]> {
  const done = new Set(alreadyLodged);
  const todo = await matchTodo(record, done);
  if (!todo.length) return Array.from(done);
  const contact = matchContactFrom(record, opts.contact);
  if (!contact)
    throw new MatchingError('To use a sealed match, add a safe way for a legal options counselor to reach you (a phone number or email).');
  // Phone verify-then-forget (W13): asked first, because without it every key holder refuses and the error says nothing.
  const phone = await api.phoneVerificationStatus();
  if (phone.required && !phone.verified) throw new MatchingError(PHONE_VERIFICATION_NEEDED, 'phone_verification_required');
  const config = await api.matchingConfig();
  if (!config.counselors.length) throw new MatchingError('Sealed matching isn’t available right now. Nothing was sealed.');
  const transport = { ...matchTransport(api), config: async () => config };
  for (const t of todo) {
    // Her (padded, encrypted) label keeps the canonical identifier, contact and share, so her client can re-seal after
    // a key rotation and add seals for new counselors without asking her again.
    mirror(
      'Sealed match: the person she named',
      `${t.id.canonical} · happened in ${record.incident.jurisdiction?.state ?? '(no state)'} · she lives in ${record.survivor.residenceState ?? '(no state)'} · contact by ${contact.methods.join(', ')}`,
      'Blinded here: each key holder gets a random-looking group element, the app server a tag it cannot reverse. The two states are sealed to the matcher’s key only (its attestation is simulated in this demo); her contact details to the counselors on the signed roster.',
    );
    try {
      await submitMatchEntry(transport, {
        masterKey,
        identifier: t.id,
        contact,
        consentStatement: opts.consentStatement ?? MATCHING_CONSENT_STATEMENT,
        // routing: a counselor licensed where it happened, else where she lives (sealed to the matcher only)
        states: { incident: record.incident.jurisdiction?.state, survivor: record.survivor.residenceState },
        label: t.label,
        config,
        pins: MATCH_PINS,
      });
    } catch (e) {
      // Fewer than t key holders answered (or one answered with a key other than its published one): nothing sealed.
      if (e instanceof ThresholdOprfError || (e as { code?: string }).code === 'holders_unavailable' || (e as { code?: string }).code === 'matcher_unavailable')
        throw new MatchingError('Sealed matching isn’t available right now. Nothing was sealed.');
      // The matcher's attestation did not verify (not the published code, not the trusted platform): nothing was sent.
      if (e instanceof AttestationError) throw new MatchingError(MATCHER_NOT_TRUSTED);
      if ((e as { code?: string }).code !== 'already_sealed') throw e;
    }
    done.add(t.key);
  }
  return Array.from(done);
}

/** Shown when the matcher's attestation fails: it is not running the code (or on the platform) this app trusts. */
export const MATCHER_NOT_TRUSTED = 'This matcher isn’t running the code this app trusts, so nothing was sealed. Your story is saved.';

function matchTransport(api: MatchingApiClient) {
  return {
    config: () => api.matchingConfig(),
    attestation: (nonce: string) => api.matcherAttestation(nonce),
    evaluate: (i: number, req: { blinded: string }) => api.oprfEvaluate(i, req),
    // Sealing still went ahead with t valid holders. Indices only (no identifier); there is no operator report channel yet.
    onBadHolders: (indices: number[]) =>
      console.warn(`[matra] OPRF key holder${indices.length > 1 ? 's' : ''} ${indices.join(', ')} answered with an invalid proof; sealed using the others.`),
    createEntry: (req: Parameters<MatchingApiClient['createMatchEntry']>[0]) => api.createMatchEntry(req),
    listEntries: () => api.listMatchEntries(),
    addSeals: (id: string, req: Parameters<MatchingApiClient['addMatchSeals']>[1]) => api.addMatchSeals(id, req),
  };
}

/**
 * On sign-in (survivor, best effort): re-seal entries from an older OPRF key epoch and add seals for counselors who
 * joined the signed roster since she sealed (packages/crypto refreshMatchEntries). Never shows anything about matches.
 */
export async function refreshSealedMatches(api: MatchingApiClient, masterKey: CryptoKey) {
  return refreshMatchEntries(matchTransport(api), { masterKey, pins: MATCH_PINS });
}

/** Withdraw (delete) one of her sealed identifiers. */
export async function withdrawEscrow(api: MatchingApiClient, entryId: string): Promise<void> {
  await api.withdrawMatchEntry(entryId);
}

export async function escrowLabel(env: Parameters<typeof decryptJSON>[0], masterKey: CryptoKey): Promise<string> {
  try {
    return (await decryptJSON<{ label: string }>(env, masterKey)).label;
  } catch {
    return 'A person you named';
  }
}

// ───────────── from Story and the phone step ─────────────

export interface MatchContact {
  method?: string;
  detail?: string;
  notes?: string;
}

/**
 * Lodge the sealed-match codes for the people she opted in (Story's seal step). `contact` is how a legal options
 * counselor may reach her on a match.
 */
export async function lodgeMatches(
  api: MatchingApiClient,
  masterKey: CryptoKey,
  record: IntakeRecord,
  alreadyLodged: string[],
  contact: MatchContact | undefined,
): Promise<string[]> {
  // Only unique identifiers are ever matched; names are dropped before anything is sealed.
  const matchable: IntakeRecord = {
    ...record,
    perpetrators: record.perpetrators.map((p) => ({
      ...p,
      identifiers: p.identifiers.filter((i) => i.kind === 'email' || i.kind === 'phone' || i.kind === 'social_handle'),
    })),
  };
  return lodgeEscrow(api, masterKey, matchable, alreadyLodged, { contact });
}

/**
 * After she confirms a phone number (counselor/PhoneVerify.tsx): seal the identifiers her current sealed record chose
 * for a sealed match but that could not be sealed yet. The fingerprints of what is now sealed go into her draft slot
 * (never into a sealed record, which she may share), so a later re-seal never resubmits, or undoes the withdrawal of,
 * an identifier. Returns how many identifiers were newly sealed.
 */
export async function retrySealedMatches(api: MatchingApiClient, masterKey: CryptoKey): Promise<number> {
  // Fails closed (lib/vault.ts loadSpace): if anything didn't load, the "latest" sealed version here may be older than
  // hers, and matching from it could seal what she has since taken out. Do nothing; the caller shows why.
  const { vault: opened, slot } = await vault.loadSpace(api, masterKey, { withLedger: false });
  const resume = vault.resumeFrom(slot.slot, opened);
  const record = resume.final?.payload.record;
  const before = resume.escrowedHashes;
  if (!record || !(await hasUnsealedMatches(record, before))) return 0;
  const after = await lodgeMatches(api, masterKey, record, before, resume.draft ? matchContactOf(resume.draft) : undefined);
  const added = after.filter((h) => !before.includes(h)).length;
  if (added)
    await updateDraftSlot(api, masterKey, (cur) => ({
      // only the fingerprints change: her draft (or, with no slot yet, the answers she resumed from) stays as it is
      ...(cur ?? { draft: resume.draft, evidence: resume.evidence }),
      escrowedHashes: Array.from(new Set([...(cur?.escrowedHashes ?? []), ...after])),
    }));
  return added;
}

/** useRequiredSession for the matching screens: the same session, with the matching API client. */
export function useMatchingSession() {
  const s = useRequiredSession();
  return { ...s, api: matchingApi(s.api) };
}
