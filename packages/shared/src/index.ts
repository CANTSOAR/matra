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
    /**
     * Her story pieces, verbatim and in the order she added them (typed, or spoken and transcribed on her device
     * and reviewed by her before saving). When present, `freeRecall` equals their texts joined with a blank line.
     */
    entries?: Array<{ id: string; createdAt: string; text: string; source: 'typed' | 'voice' }>;
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

/**
 * 'counselor' = a Legal Options Counselor (Callisto's "LOC" role): an independent, verified professional who receives
 * ONLY matched sealed-match groups and reaches out to each matched survivor separately. Not police, not a school.
 */
export type Role = 'survivor' | 'attorney' | 'counselor';

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
  // NOTE: attorneys no longer receive sealed-match counts. Matches go only to a Legal Options Counselor
  // (role 'counselor'), who contacts each matched survivor separately — see CounselorMatchGroup.
}

export type EscrowStatus = 'sealed' | 'matched';

/** Survivor-facing view of one of HER OWN sealed-match entries (GET /api/escrow, GET/POST /api/matching/entries). */
export interface EscrowEntry {
  id: string;
  /** label the survivor sees (encrypted under her master key) — the server only returns it back */
  labelEnvelope: Envelope;
  /**
   * Survivor-facing responses ALWAYS report 'sealed', whatever the real state. Matched groups are released only to
   * verified Legal Options Counselors. Showing 'matched' to survivors would let a perpetrator register as a
   * survivor, submit his own identifiers, and learn he has been named.
   */
  status: EscrowStatus;
  createdAt: string;
  /** Never sent to survivors (see `status`). Retained for type compatibility. */
  matchedAt?: string;
  ledgerEntryId: string;
  /** OPRF key epoch this entry was sealed under. Her client re-seals entries from an older epoch on sign-in. */
  keyEpoch?: number;
  /** Counselors this entry holds a seal for (her own seals). Her client adds seals for newly listed counselors. */
  counselorIds?: string[];
}

// ───────────────────────── Sealed matching (Callisto-style) ─────────────────────────
// Protocol: packages/crypto/src/matching.ts. Wire encoding: group elements / scalars / proofs = base64,
// field elements (Shamir x / y over p = 2^256 + 297) = 66-char big-endian hex, tags = 64-char hex.

/** A Legal Options Counselor's public profile (verified by Matra like attorneys). */
export interface CounselorProfile {
  userId: string;
  displayName: string;
  organization?: string;
  jurisdictions: string[];
  verified: boolean;
  /** RSA-OAEP public key (JWK): sealed-match shares are encrypted to this key. */
  publicKey: JsonWebKey;
}

/** How a matched survivor would like a counselor to reach her. Encrypted inside her contact bundle. */
export interface MatchContactPreferences {
  /** What the counselor should call her. */
  name?: string;
  methods: Array<'call' | 'text' | 'email' | 'voicemail'>;
  phone?: string;
  email?: string;
  /** "only after 6pm", "don't leave a message", … (her words) */
  notes?: string;
  language?: string;
}

/**
 * v1 bundle (before staged release): everything, including her contact details, in one ciphertext. New entries use
 * MatchSummaryBundle + MatchContactDetails; a counselor's client still opens v1 bundles (legacy) and hides the details
 * until the conflict check, in the UI only.
 */
export interface MatchContactBundle {
  v: 1;
  /** which kind of identifier matched, and its canonical form (e.g. "instagram:bad_guy") */
  identifier: { kind: 'email' | 'phone' | 'social'; canonical: string };
  contact: MatchContactPreferences;
  /** the exact explanation she agreed to, and when */
  consent: { statement: string; at: string };
  /** USPS state of the incident or residence, if she gave one. Kept for bundles sealed before `states` existed. */
  state?: string;
  /** USPS states she gave: where it happened and where she lives (also sealed to the matcher for routing). */
  states?: MatchStates;
}

// ── staged release ──
/**
 * Stage 1 of a match (staged release, W21): what the assigned counselor can open as soon as a group is released to her.
 * The matched identifier, where it happened and where she lives, and HOW she would like to be contacted, but not her
 * name, number, email or notes: those are in MatchContactDetails, which the server withholds until the counselor has
 * recorded a conflict check. Encrypted under the entry key with AAD "bundle|" + tag, padded to 1 KiB (as v1 was).
 */
export interface MatchSummaryBundle {
  v: 2;
  identifier: { kind: 'email' | 'phone' | 'social'; canonical: string };
  states: MatchStates;
  methods: MatchContactPreferences['methods'];
  language?: string;
  consent: { statement: string; at: string };
}

/** Stage 1b: her contact details, under the SAME entry key with AAD "contact|" + tag (CreateMatchEntryRequest.contactBundle). */
export interface MatchContactDetails {
  v: 1;
  name?: string;
  phone?: string;
  email?: string;
  notes?: string;
}

/** The conflict-check statement versions the server accepts (text: apps/web/src/lib/disclosures.ts). */
export const CONFLICT_CHECK_STATEMENT_VERSION = 1 as const;
export type ConflictCheckResult = 'clear' | 'conflict';
/** POST /api/counselor/groups/:id/conflict-check */
export interface ConflictCheckRequest {
  result: ConflictCheckResult;
  statementVersion: typeof CONFLICT_CHECK_STATEMENT_VERSION;
}

export type ReportRequestStatus = 'pending' | 'consented' | 'declined' | 'cancelled';
export type ReportReleaseStatus = 'active' | 'revoked';

/**
 * Stage 2: the counselor asks ONE matched survivor for her full report. The survivor decides alone; the counselor
 * learns only the decision, never a reason. Nothing about one survivor is ever shown to another.
 */
export interface CounselorReportRequest {
  id: string;
  groupId: string;
  entryId: string;
  status: ReportRequestStatus;
  createdAt: string;
  decidedAt?: string;
  /** after a yes: the release she created, and whether it is still active */
  release?: { id: string; status: ReportReleaseStatus; expiresAt: string; firstOpenedAt?: string };
}

/** GET /api/report-requests: a request as the survivor sees it (only her own; nothing about anyone else). */
export interface SurvivorReportRequest {
  id: string;
  /** her own sealed-match entry the request is about (her client decrypts its label for context) */
  entryId: string;
  status: Exclude<ReportRequestStatus, 'cancelled'>;
  createdAt: string;
  decidedAt?: string;
  counselor: { userId: string; displayName: string; organization?: string; jurisdictions: string[]; publicKey: JsonWebKey };
  release?: ReportRelease;
}

/** POST /api/report-requests/:id/consent: her record key (and any evidence keys she chose) wrapped to the counselor. */
export interface ReportConsentRequest {
  recordId: string;
  recipientWrappedKey: WrappedKey;
  blobs: Array<{ blobId: string; recipientWrappedKey: WrappedKey }>;
  consentStatement: string;
  /** fingerprint of the counselor key she confirmed (or that the signed roster vouched for); the server rejects a mismatch */
  counselorKeyFingerprint: string;
  /** 1–365, default 90 */
  expiresInDays?: number;
}

/** One survivor's yes: her report, released to ONE counselor. No survivor id is ever sent to the counselor. */
export interface ReportRelease {
  id: string;
  requestId: string;
  groupId: string;
  entryId: string;
  recordId: string;
  counselorId: string;
  status: ReportReleaseStatus;
  consentStatement: string;
  blobIds: string[];
  createdAt: string;
  expiresAt: string;
  /** null until the counselor first opens it: revoking before then means she never sees it */
  firstOpenedAt?: string;
  revokedAt?: string;
  ledgerEntryId: string;
}

/** GET /api/counselor/releases/:id/bundle: like ShareBundle, without any alias. */
export interface ReportReleaseBundle {
  release: ReportRelease;
  record: { id: string; envelope: Envelope; contentHash: string; createdAt: string; ledgerEntryId: string };
  recipientWrappedKey: WrappedKey;
  blobs: Array<{ blobId: string; recipientWrappedKey: WrappedKey; contentHash: string; sizeBytes: number }>;
}

/** The two states routing uses (matcher-service): a counselor licensed in the incident state, else in hers. */
export interface MatchStates {
  incident?: string;
  survivor?: string;
}

/** Hybrid RSA-OAEP-256 + AES-256-GCM ciphertext addressed to one counselor. */
export interface CounselorSeal {
  counselorId: string;
  wrappedKey: WrappedKey;
  envelope: Envelope;
}

export interface OprfEvaluateRequest { blinded: string }
/** RFC 9497 VOPRF (ristretto255-SHA512) evaluation with its DLEQ proof against the key holder's public key. */
export interface OprfEvaluateResponse { evaluated: string; proof: string }

// ── threshold OPRF ──
/** One OPRF key holder: its index i (1..m) and base64 share public key pk_i = k_i·G (ristretto255). */
export interface OprfHolderInfo { index: number; publicKey: string }
/**
 * The OPRF key k is Shamir-shared among m independent key holders; any t of them evaluate (packages/crypto
 * threshold.ts). groupPublicKey = k·G, consistent with the holders' share keys (the client checks).
 */
export interface ThresholdOprfConfig {
  suite: 'ristretto255-SHA512';
  mode: 'voprf';
  t: number;
  m: number;
  groupPublicKey: string;
  holders: OprfHolderInfo[];
}

export interface MatchingConfig {
  /** The MATCH threshold: 2 distinct survivors naming the same person. Not the OPRF key threshold (oprf.t). */
  threshold: 2;
  /** The threshold OPRF key set. */
  oprf: ThresholdOprfConfig;
  /** Verified counselors; a sealed entry carries one CounselorSeal per counselor. */
  counselors: CounselorProfile[];
  limits: { perDay: number; lifetime: number };
  /** Current OPRF key epoch (increments on an explicit key rotation, MATRA_OPRF_ROTATE=1). */
  keyEpoch: number;
  /**
   * The counselor roster signed offline by the organization's Ed25519 key (npm run -w @matra/server sign-roster).
   * Clients built with a pinned roster key (MATRA_COUNSELOR_ROSTER_PUBKEY) seal ONLY to counselors listed here.
   */
  roster?: SignedCounselorRoster;
}

/** `payload` is canonical JSON of CounselorRosterPayload; `signature` is base64 Ed25519 over "matra/counselor-roster/v1|" + payload. */
export interface SignedCounselorRoster {
  payload: string;
  signature: string;
}

/**
 * v2 adds each counselor's licensed states (USPS codes), which the matcher uses to assign a group to ONE counselor.
 * A v1 roster still verifies, but lists nobody as licensed anywhere, so the matcher assigns nothing (re-sign it).
 */
export interface CounselorRosterPayload {
  v: 1 | 2;
  issuedAt: string;
  counselors: Array<{ userId: string; publicKey: { kty: 'RSA'; n: string; e: string }; licensedStates?: string[] }>;
}

// ── matcher service ──
/**
 * Routing data for one entry, sealed by her client to the matcher's attested key (packages/crypto attestation.ts).
 * The app server stores and forwards it but cannot open it. States are USPS codes.
 */
export interface MatchRoutingTag {
  v: 1;
  tag: string;
  incidentState?: string;
  survivorState?: string;
}
/** ECIES (ephemeral ECDH P-256 + HKDF-SHA256 + AES-256-GCM, AAD = "routing|" + tag) ciphertext of a MatchRoutingTag. */
export interface RoutingEnvelope {
  v: 1;
  /** ephemeral P-256 public key (JWK: kty, crv, x, y) */
  epk: JsonWebKey;
  iv: string;
  ct: string;
}
/**
 * What the matcher's platform says about it. `payload` is canonical JSON of AttestationPayload; `signature` is base64
 * Ed25519 by the PLATFORM key over "matra/attestation/v1|" + payload. platform 'simulated' is a local stand-in signed
 * by a dev key: it is NOT hardware attestation (docs/threat-model.md W18).
 */
export interface AttestationDocument {
  payload: string;
  signature: string;
}
export interface AttestationPayload {
  v: 1;
  platform: 'simulated' | 'nitro' | 'confidential-space';
  /** hex SHA-256 of the matcher build (apps/matcher `npm run measure`) */
  measurement: string;
  /** the matcher's static P-256 key that routing tags are sealed to (JWK: kty, crv, x, y) */
  encKey: JsonWebKey;
  /** base64 Ed25519 public key the matcher signs with (reserved: signed assignments) */
  signKey: string;
  /** 64 hex chars, chosen by the verifier */
  nonce: string;
  issuedAt: string;
}
/**
 * Why a group went to its counselor, from the matcher: `incident_state:NJ`, `survivor_state:NY`, either prefixed
 * `reassigned:` after a decline or a roster change.
 */
export interface MatchAssignmentInfo {
  reason: string;
  assignedAt: string;
}

// ── phone verification ──
/**
 * GET /api/matching/verification. A survivor confirms a phone number by SMS before she can lodge a sealed-matching
 * entry (W13). The server then keeps only a keyed hash of the number, not linked to her account, and this flag.
 */
export interface PhoneVerificationStatus {
  /** false only when the server runs with verification turned off (development) */
  required: boolean;
  verified: boolean;
}
export interface PhoneVerificationStartRequest { phone: string }
export interface PhoneVerificationStartResponse {
  challengeId: string;
  expiresAt: string;
  /** Development / demo only (mock SMS provider): the code, so it can be shown on screen. Never from a real provider. */
  demoCode?: string;
}
export interface PhoneVerificationCheckRequest { challengeId: string; code: string }

/** POST /api/matching/entries/:id/seals — add seals for counselors that joined the roster after she sealed. */
export interface AddMatchSealsRequest {
  seals: CounselorSeal[];
}

export interface CreateMatchEntryRequest {
  /** 64 hex chars: HKDF(OPRF output, "tag"). Pseudorandom per perpetrator identifier. */
  tag: string;
  /** MatchSummaryBundle encrypted under a fresh entry key ke (AAD = "bundle|" + tag) */
  bundle: Envelope;
  /** MatchContactDetails under the same ke (AAD = "contact|" + tag); withheld from the counselor until her conflict check */
  contactBundle: Envelope;
  /** her own label (encrypted under her master key) */
  labelEnvelope: Envelope;
  /** one per verified counselor: {tag, x, y, ce} sealed to that counselor */
  seals: CounselorSeal[];
  /** Re-seal after a key rotation: her older entry with this id is deleted in the same transaction. */
  replacesEntryId?: string;
  /** Her routing tag (incident and home state) sealed to the matcher's attested key. Only the matcher can open it. */
  routing: RoutingEnvelope;
}

/** A matched group as released to ONE counselor: only seals addressed to that counselor, never user ids. */
export interface CounselorMatchGroup {
  id: string;
  /** the shared tag π (pseudorandom; bound into every seal's AAD so seals can't be moved between groups) */
  tag: string;
  matchedAt: string;
  /** `contactBundle` is present only once this counselor has recorded a clear conflict check for the group. */
  entries: Array<{ entryId: string; createdAt: string; bundle: Envelope; seal: CounselorSeal; contactBundle?: Envelope }>;
  notes: CounselorNote[];
  /** her conflict check for this group, if recorded (a 'conflict' group is never returned: it is passed on) */
  conflictCheck?: { result: 'clear'; at: string };
  /** her report requests in this group (Stage 2), one entry each at most open */
  reportRequests: CounselorReportRequest[];
  /**
   * Sybil warning signs, computed server-side without revealing accounts: some entries come from accounts created
   * within 24 hours of each other, and how many entries were sealed less than 7 days after their account was created.
   */
  signals: { accountsCreatedClose: boolean; newAccountEntries: number };
  /** Why the matcher assigned this group to this counselor (matcher-service). */
  assignment?: MatchAssignmentInfo;
}

/** Outreach note, encrypted client-side under the counselor's own master key. */
export interface CounselorNote {
  id: string;
  groupId: string;
  entryId?: string;
  envelope: Envelope;
  createdAt: string;
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
  /** Required when role is 'counselor'. Counselors start unverified; Matra verifies them like attorneys. */
  counselorProfile?: Omit<CounselorProfile, 'userId' | 'verified' | 'publicKey'>;
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

export interface LedgerVerifyResponse { ok: boolean; length: number; headHash: string; brokenAtSeq?: number }

export interface ApiError { error: string; code?: string }

/*
 Endpoint summary (implemented by apps/server, consumed by apps/web/src/api):

 GET    /api/health                                   -> { ok: true }
 GET    /api/auth/prelogin?username=                  -> PreloginResponse  (deterministic fake salt for unknown users)
 POST   /api/auth/register      RegisterRequest       -> AuthResponse
 POST   /api/auth/login         LoginRequest          -> AuthResponse
 POST   /api/auth/logout                              -> { ok: true }
 GET    /api/me                                       -> { user: PublicUser, attorneyProfile?: AttorneyProfile, counselorProfile?: CounselorProfile }

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
 GET    /api/shares/:id/bundle                        -> ShareBundle  (attorney only, active shares)
 POST   /api/shares/:id/renew  { expiresInDays? } -> { share: Share, ledgerEntry: LedgerEntry } (survivor only; not revoked)
 POST   /api/shares/:id/revoke                        -> { share: Share, ledgerEntry: LedgerEntry } (survivor only)

 GET    /api/escrow                                   -> { entries: EscrowEntry[] } (own sealed-match entries; status always 'sealed')

 GET    /api/matching/config                          -> MatchingConfig   (survivor)
 GET    /api/matching/oprf/:index/key                 -> OprfHolderInfo   (key holder i's share public key)
 POST   /api/matching/oprf/:index OprfEvaluateRequest -> OprfEvaluateResponse (verified-adult survivor; account quota charged once per distinct blinded element, plus a per-holder quota;
                                                         503 holder_unavailable when holder i is down;
                                                         403 phone_not_verified until she has confirmed a phone)
 GET    /api/matching/attestation?nonce=<64 hex>      -> AttestationDocument (public; proxied from the matcher service; her
                                                         client verifies it before sealing routing data to its key)
 GET    /api/matching/verification                    -> PhoneVerificationStatus (survivor)
 POST   /api/matching/verification/start PhoneVerificationStartRequest -> PhoneVerificationStartResponse (adult survivor;
                                                         400 phone_invalid | phone_not_supported · 429 rate_limited · 503 sms_unavailable)
 POST   /api/matching/verification/check PhoneVerificationCheckRequest -> { verified: true }
                                                         (400 code_invalid | code_expired · 409 phone_limit_reached)
 POST   /api/matching/entries   CreateMatchEntryRequest -> { entry: EscrowEntry } (status always 'sealed'; 403 phone_not_verified)
 POST   /api/matching/entries/:id/seals AddMatchSealsRequest -> { entry: EscrowEntry } (owner only; adds seals for new counselors)
 GET    /api/matching/entries                         -> { entries: EscrowEntry[] }
 DELETE /api/matching/entries/:id                     -> { ok: true }  (withdraw: deletes her entry)

 GET    /api/counselor/groups                         -> { groups: CounselorMatchGroup[] }  (verified counselor; only the groups the
                                                         matcher assigned to HER, each with its assignment reason)
 POST   /api/counselor/groups/:id/notes { entryId?, envelope } -> { note: CounselorNote }
 POST   /api/counselor/groups/:id/conflict-check ConflictCheckRequest -> { ok: true, result } ('conflict' passes the group on)
 POST   /api/counselor/groups/:id/decline                              -> { ok: true }  (same as a 'conflict' check)
 POST   /api/counselor/groups/:id/report-requests { entryId, expected: true } -> { request: CounselorReportRequest }
                                                         (after 'clear'; 409 request_open | already_shared)
 POST   /api/counselor/report-requests/:id/cancel            -> { request: CounselorReportRequest } (pending only)
 GET    /api/counselor/releases                              -> { releases: ReportRelease[] }
 GET    /api/counselor/releases/:id/bundle                   -> ReportReleaseBundle (403 release_revoked | release_expired)
 GET    /api/counselor/releases/:id/blobs/:blobId            -> octet-stream (same checks)

 GET    /api/report-requests                                 -> { requests: SurvivorReportRequest[] } (survivor: her own)
 POST   /api/report-requests/:id/consent ReportConsentRequest -> { release: ReportRelease, ledgerEntry: LedgerEntry }
 POST   /api/report-requests/:id/decline                     -> { request: SurvivorReportRequest }
 POST   /api/report-releases/:id/revoke                      -> { release: ReportRelease, ledgerEntry: LedgerEntry }

 GET    /api/audit                                    -> { events: AuditEvent[] }   (own events)
 POST   /api/account/delete                           -> { ok: true }  (crypto-shred: deletes keys + ciphertext; ledger hashes remain)
*/
