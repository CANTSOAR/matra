/**
 * @matra/shared — the single source of truth for data shapes that cross
 * module boundaries (intake → vault → brief → attorney) and for the HTTP API.
 *
 * Zero-knowledge rule: anything typed `Envelope` or `WrappedKey` is opaque
 * ciphertext to the server. The server must never receive an IntakeRecord
 * in plaintext.
 */

// ───────────────────────── Intake record (plaintext, client-only) ─────────────────────────

export type IncidentType =
  | 'sexual_assault'
  | 'rape'
  | 'attempted_sexual_assault'
  | 'unwanted_touching'
  | 'stalking'
  | 'harassment'
  | 'domestic_violence'
  | 'dating_violence'
  | 'image_based_abuse'
  | 'drugging_suspected'
  | 'other';

/** A three-way answer where "I'm not sure" is always a valid, recorded answer. */
export type TriAnswer = 'yes' | 'no' | 'unsure';

/** Force / coercion the survivor selected (after free recall). Her own description is kept separately, verbatim. */
export type ForceKind = 'physical_force' | 'restraint' | 'threats' | 'weapon' | 'other';

/** Alcohol / drug involvement, recorded neutrally (it never changes responsibility). */
export type SubstanceKind =
  | 'survivor_alcohol'
  | 'survivor_drugs'
  | 'suspected_drugging'
  | 'other_person_substances'
  | 'unsure';

/** Non-digital items the survivor kept. */
export type PhysicalEvidenceKind = 'clothing' | 'bedding' | 'condom' | 'containers' | 'other';

/** Who a prior report was made to. 'police' and 'prosecutor' count as law enforcement (NJ VCCO 9-month rule). */
export type ReportAgencyType = 'police' | 'prosecutor' | 'campus' | 'employer' | 'other';

export type IdentifierKind = 'email' | 'phone' | 'social_handle' | 'full_name' | 'other';

export interface PerpetratorIdentifier {
  kind: IdentifierKind;
  /** e.g. "instagram", "snapchat" for social_handle */
  platform?: string;
  value: string;
}

export interface Perpetrator {
  id: string;
  name?: string;
  relationship?: string; // "coworker", "stranger", "ex-partner", ...
  knownToSurvivor: boolean;
  physicalDescription?: string;
  identifiers: PerpetratorIdentifier[];
  /** Survivor opted in to sealed escrow matching for this person's identifiers. */
  escrowOptIn: boolean;
  /** Where they live, if known (her words). */
  address?: string;
  /** Where they work or study. */
  workplace?: string;
  /** Vehicle description / plate. */
  vehicle?: string;
  /** Where they might be now. */
  whereabouts?: string;
}

export interface Witness {
  id: string;
  name?: string;
  contact?: string;
  relationship?: string;
  whatTheyKnow?: string;
}

/** "Outcry"/fresh-complaint witnesses — people the survivor told afterwards. Legally significant. */
export interface Disclosure {
  id: string;
  toWhom: string;
  when?: string;
  method?: 'in_person' | 'phone' | 'text' | 'social_media' | 'email' | 'other';
  whatWasSaid?: string;
}

export type EvidenceKind = 'photo' | 'video' | 'screenshot' | 'audio' | 'document' | 'message_export' | 'other';

export interface EvidenceItem {
  id: string;
  kind: EvidenceKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** SHA-256 (hex) of the plaintext bytes AFTER metadata stripping — what an examiner can re-verify. */
  sha256: string;
  /** Server blob id of the encrypted bytes (set once uploaded). */
  blobId?: string;
  description?: string;
  /** When the survivor says it was captured/received (free text or ISO). */
  capturedAt?: string;
  metadataStripped: boolean;
}

export interface IntakeRecord {
  schemaVersion: 1;
  /** ISO timestamp the survivor finalized this version. */
  completedAt: string;

  survivor: {
    preferredName?: string;
    legalName?: string;
    dateOfBirth?: string;
    pronouns?: string;
    preferredLanguage?: string;
    phone?: string;
    email?: string;
    safeContact: { phone: boolean; text: boolean; email: boolean; voicemail: boolean };
    safeContactNotes?: string; // "only call after 6pm"
    residenceState?: string; // USPS code, e.g. "NJ"
    residenceCounty?: string;
    /** Interpreter / accessibility needs for anyone she later talks with. */
    accessibility?: {
      interpreter?: TriAnswer;
      interpreterLanguage?: string;
      /** Her words: disability access, advocate present, anything else. */
      otherNeeds?: string;
    };
  };

  incident: {
    /** ISO date or free text if unsure. */
    dateStart?: string;
    dateEnd?: string;
    dateIsApproximate: boolean;
    timeDescription?: string;
    locationDescription?: string;
    locationAddress?: string;
    jurisdiction: { state?: string; county?: string; city?: string; campus?: string };
    incidentTypes: IncidentType[];
    isOngoing: boolean;
    /** Physical force, restraint, threats, weapons — survivor-selected, plus her own words. */
    force?: { kinds: ForceKind[]; description?: string };
    /** Hands/arm/object on the neck or pressure on the throat (high-lethality indicator). Her answer as given. */
    strangulation?: TriAnswer;
    /** Alcohol / drug involvement and suspected incapacitation, as she described it. */
    substances?: { kinds: SubstanceKind[]; suspectedIncapacitation?: TriAnswer; description?: string };
  };

  /** Survivor's own words. Never rewritten or "improved" by software. */
  narrative: {
    freeRecall: string;
    sensory: { sight?: string; sound?: string; smell?: string; touch?: string; taste?: string };
    contextBefore?: string;
    contextAfter?: string;
    additionalDetails?: string;
    wordsSpoken?: string; // things the perpetrator said, verbatim if remembered
  };

  perpetrators: Perpetrator[];
  witnesses: Witness[];
  disclosures: Disclosure[];

  medical: {
    soughtCare: boolean;
    facility?: string;
    date?: string;
    forensicExamCompleted?: boolean; // SANE / rape kit
    /** Forensic kit details (asked only if an exam was completed). */
    toxicologyTest?: TriAnswer;
    /** Kit kept anonymously / without a police report (NJ "Five-Year Hold" kit). */
    fiveYearHoldKit?: TriAnswer;
    kitReportedToPolice?: TriAnswer;
    injuries?: string;
  };

  priorReports: Array<{
    id: string;
    agency: string;
    /** Absent on records sealed before this field existed. */
    agencyType?: ReportAgencyType;
    date?: string;
    reportNumber?: string;
    prosecutorFileNumber?: string;
    outcome?: string;
  }>;

  evidence: EvidenceItem[];

  /** Non-digital evidence she kept (clothing, bedding…), and her own note on where / how it is stored. */
  physicalEvidence?: { kinds: PhysicalEvidenceKind[]; description?: string };

  safety: {
    /**
     * Her answer to "Are you safe right now?" at the start of the intake, exactly as chosen.
     * undefined = skipped. (Replaces the earlier boolean `inImmediateDanger`.)
     */
    immediateSafety: 'safe' | 'not_safe' | 'unsure' | undefined;
    perpetratorHasAccess?: boolean; // knows where she lives/works
    wantsProtectiveOrder?: 'yes' | 'no' | 'unsure';
    notes?: string;
  };

  /** Losses — feeds the crime-victim-compensation draft. */
  financialImpact: {
    medicalCosts?: string;
    counselingCosts?: string;
    lostWages?: string;
    relocationCosts?: string;
    otherCosts?: string;
    hasInsurance?: 'yes' | 'no' | 'unsure';
  };

  /**
   * Details used ONLY by the crime-victim-compensation worksheet (NJ VCCO). Never printed in the
   * incident summary. Asked only if she wants help with compensation.
   */
  compensation?: {
    mailingAddress?: { street?: string; city?: string; state?: string; zip?: string };
    /** Is she applying for herself, or is someone else (e.g. a guardian) the claimant? */
    claimant?: 'self' | 'other';
    /** Claimant's name / relationship when claimant === 'other' (her words). */
    claimantDetails?: string;
    alternateContact?: { name?: string; relationship?: string; phone?: string; email?: string };
    insuranceCarrier?: string;
    employer?: string;
    workDatesMissed?: string;
    /** Her words: reasons for a late police report or late filing (VCCO §16 "good cause"). */
    goodCauseExplanation?: string;
  };

  /** What she wants. Nothing is sent anywhere unless she explicitly approves at that moment. */
  goals: {
    policeReport: 'yes' | 'no' | 'undecided';
    attorney: 'yes' | 'no' | 'undecided';
    compensation: 'yes' | 'no' | 'undecided';
    protectiveOrder: 'yes' | 'no' | 'undecided';
  };
}

// ───────────────────────── Crypto wire formats ─────────────────────────

/** AES-256-GCM ciphertext. All binary fields are base64. */
export interface Envelope {
  v: 1;
  alg: 'A256GCM';
  iv: string;
  ct: string;
}

/** A symmetric key wrapped either with the owner's master key (A256GCM) or a recipient's RSA public key. */
export interface WrappedKey {
  v: 1;
  alg: 'A256GCM-KW' | 'RSA-OAEP-256';
  /** present for A256GCM-KW */
  iv?: string;
  data: string;
}

// ───────────────────────── Domain objects returned by the API ─────────────────────────

export type Role = 'survivor' | 'attorney';

export interface PublicUser {
  id: string;
  username: string;
  role: Role;
  /** RSA-OAEP public key (JWK) — used by others to share keys with this user. */
  publicKey: JsonWebKey;
  /** Private key encrypted under the user's master key — only the user can open it. */
  wrappedPrivateKey: Envelope;
  createdAt: string;
}

export interface AttorneyProfile {
  userId: string;
  displayName: string;
  organization?: string;
  barNumber?: string;
  jurisdictions: string[]; // USPS state codes
  practiceAreas: string[];
  verified: boolean;
  acceptsProBono: boolean;
  publicKey: JsonWebKey;
}

export interface LedgerEntry {
  seq: number;
  id: string;
  /** what happened, e.g. 'record.sealed', 'blob.sealed', 'share.granted', 'share.revoked', 'escrow.sealed' */
  type: string;
  /** subject id (record id, blob id, share id...) */
  subjectId: string;
  /** SHA-256 hex of the ciphertext / payload being attested */
  contentHash: string;
  /** Server receipt time, ISO-8601 UTC */
  timestamp: string;
  prevHash: string;
  /** SHA-256(seq|type|subjectId|contentHash|timestamp|prevHash) */
  entryHash: string;
}

export interface VaultRecordMeta {
  id: string;
  ownerId: string;
  /** previous version this one supersedes (records are immutable / WORM) */
  supersedes?: string;
  createdAt: string;
  contentHash: string;
  ledgerEntryId: string;
}

export interface VaultRecord extends VaultRecordMeta {
  envelope: Envelope;
  /** record key wrapped with the owner's master key */
  ownerWrappedKey: WrappedKey;
}

export interface BlobMeta {
  id: string;
  ownerId: string;
  sizeBytes: number;
  contentHash: string; // SHA-256 of ciphertext
  createdAt: string;
  ledgerEntryId: string;
  ownerWrappedKey: WrappedKey;
}

export type ShareStatus = 'active' | 'revoked';

export interface Share {
  id: string;
  recordId: string;
  survivorId: string;
  attorneyId: string;
  status: ShareStatus;
  /** Exact consent text the survivor agreed to */
  consentStatement: string;
  scope: Array<'record' | 'evidence' | 'brief'>;
  createdAt: string;
  /** Access stops at this time (default 90 days); the survivor can renew. Stops future access only. */
  expiresAt: string;
  revokedAt?: string;
  ledgerEntryId: string;
}

export interface ShareBundle {
  share: Share;
  record: { id: string; envelope: Envelope; contentHash: string; createdAt: string; ledgerEntryId: string };
  /** record key wrapped to the attorney's RSA public key */
  recipientWrappedKey: WrappedKey;
  blobs: Array<{ blobId: string; recipientWrappedKey: WrappedKey; contentHash: string; sizeBytes: number }>;
  survivorAlias: string;
  /**
   * Blind-escrow summary for THIS survivor's own entries only — no labels, no hashes, nothing about any other
   * survivor. This is the only place match results are ever released: to the verified attorney the survivor
   * chose to share with (a human gatekeeper), never to the survivor's own client, so a perpetrator posing as a
   * survivor cannot submit his own identifiers to learn whether he has been named.
   */
  escrow: { sealedCount: number; matchedCount: number };
}

export type EscrowStatus = 'sealed' | 'matched';

export interface EscrowEntry {
  id: string;
  /** label the survivor sees, stored encrypted client-side — server only returns it back */
  labelEnvelope: Envelope;
  /**
   * Survivor-facing responses (POST/GET /api/escrow) ALWAYS report 'sealed', whatever the real state.
   * The true sealed/matched state is kept server-side and surfaced only as counts in ShareBundle.escrow
   * to a verified attorney with an active share. Showing 'matched' to survivors would let a perpetrator
   * register as a survivor, escrow his own identifiers, and learn he has been reported.
   */
  status: EscrowStatus;
  createdAt: string;
  /** Never sent to survivors (see `status`). Retained for type compatibility. */
  matchedAt?: string;
  ledgerEntryId: string;
}

export interface AuditEvent {
  id: string;
  userId: string;
  action: string;
  detail?: string;
  at: string;
}

// ───────────────────────── HTTP API contract ─────────────────────────
// Base path: /api   Auth: `Authorization: Bearer <token>`   Bodies: JSON unless noted.

export interface PreloginResponse { kdfSalt: string; kdfIterations: number }

export interface RegisterRequest {
  username: string;
  role: Role;
  /** base64 auth key derived client-side; server stores only a slow hash of it */
  authKey: string;
  kdfSalt: string;
  kdfIterations: number;
  publicKey: JsonWebKey;
  wrappedPrivateKey: Envelope;
  attorneyProfile?: Omit<AttorneyProfile, 'userId' | 'verified' | 'publicKey'>;
  /**
   * Required (must be `true`) when role is 'survivor': she confirms she is 18 or older. The server stores the
   * confirmation and its time. Matra is for adults only (self-attestation; it cannot verify age).
   */
  ageConfirmed18?: true;
}
export interface AuthResponse { token: string; user: PublicUser }
export interface LoginRequest { username: string; authKey: string }

export interface CreateRecordRequest { envelope: Envelope; ownerWrappedKey: WrappedKey; supersedes?: string }
export interface CreateRecordResponse { record: VaultRecordMeta; ledgerEntry: LedgerEntry }

/** POST /api/vault/blobs — body is raw application/octet-stream ciphertext (iv||ct);
 *  header `X-Owner-Wrapped-Key` = base64(JSON(WrappedKey)). */
export interface CreateBlobResponse { blob: BlobMeta; ledgerEntry: LedgerEntry }

export interface CreateShareRequest {
  recordId: string;
  attorneyId: string;
  recipientWrappedKey: WrappedKey;
  /** Fingerprint of the attorney key the survivor confirmed on screen; server rejects on mismatch. */
  attorneyKeyFingerprint: string;
  blobs: Array<{ blobId: string; recipientWrappedKey: WrappedKey }>;
  consentStatement: string;
  scope: Share['scope'];
  survivorAlias: string;
  /** 1-365, default 90 */
  expiresInDays?: number;
}

export interface CreateEscrowRequest {
  /** hex output of escrowIdentifierHash() — server HMACs again with a server pepper */
  identifierHash: string;
  labelEnvelope: Envelope;
}

export interface LedgerVerifyResponse { ok: boolean; length: number; headHash: string; brokenAtSeq?: number }

export interface ApiError { error: string; code?: string }

/*
 Endpoint summary (implemented by apps/server, consumed by apps/web/src/api):

 GET    /api/health                                   -> { ok: true }
 GET    /api/auth/prelogin?username=                  -> PreloginResponse  (deterministic fake salt for unknown users)
 POST   /api/auth/register      RegisterRequest       -> AuthResponse
 POST   /api/auth/login         LoginRequest          -> AuthResponse
 POST   /api/auth/logout                              -> { ok: true }
 GET    /api/me                                       -> { user: PublicUser, attorneyProfile?: AttorneyProfile }

 POST   /api/vault/records      CreateRecordRequest   -> CreateRecordResponse
 GET    /api/vault/records                            -> { records: VaultRecordMeta[] }
 GET    /api/vault/records/:id                        -> { record: VaultRecord }
 POST   /api/vault/blobs        (octet-stream)        -> CreateBlobResponse
 GET    /api/vault/blobs                              -> { blobs: BlobMeta[] }
 GET    /api/vault/blobs/:id                          -> octet-stream (owner, or attorney with active share covering it)

 GET    /api/ledger/entries/:id                       -> { entry: LedgerEntry }
 GET    /api/ledger/verify                            -> LedgerVerifyResponse
 GET    /api/ledger/head                              -> { seq: number, entryHash: string }

 GET    /api/attorneys?state=NJ                       -> { attorneys: AttorneyProfile[] }  (verified only)
 POST   /api/shares             CreateShareRequest    -> { share: Share, ledgerEntry: LedgerEntry }
 GET    /api/shares                                   -> { shares: Share[] }  (survivor: outgoing, attorney: incoming)
 GET    /api/shares/:id/bundle                        -> ShareBundle  (attorney only, active shares; includes escrow counts)
 POST   /api/shares/:id/renew  { expiresInDays? } -> { share: Share, ledgerEntry: LedgerEntry } (survivor only; not revoked)
 POST   /api/shares/:id/revoke                        -> { share: Share, ledgerEntry: LedgerEntry } (survivor only)

 POST   /api/escrow             CreateEscrowRequest   -> { entry: EscrowEntry }     (status always 'sealed')
 GET    /api/escrow                                   -> { entries: EscrowEntry[] } (status always 'sealed')

 GET    /api/audit                                    -> { events: AuditEvent[] }   (own events)
 POST   /api/account/delete                           -> { ok: true }  (crypto-shred: deletes keys + ciphertext; ledger hashes remain)
*/
