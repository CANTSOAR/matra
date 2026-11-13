/**
 * Matra API server. Implements the contract in @matra/shared exactly.
 *
 * Zero-knowledge: the server only ever handles ciphertext (Envelope / blob bytes),
 * wrapped keys, public keys, and hashes. Request bodies are never logged.
 *
 * Error shape: ApiError `{ error: string, code?: string }`. Codes used:
 *   400 invalid_request | invalid_json | invalid_wrapped_key | scope_mismatch
 *   401 unauthorized | session_expired | invalid_credentials
 *   403 forbidden | forbidden_role | share_revoked | share_expired | attorney_not_verified | counselor_not_verified
 *       | age_not_confirmed | phone_not_verified | release_revoked | release_expired
 *   409 (staged release) conflict_check_required | request_open | already_shared | she_said_no | request_not_pending
 *       | counselor_key_mismatch | counselor_unavailable
 *   404 not_found | record_not_found | blob_not_found | attorney_not_found | share_not_found | entry_not_found
 *       | counselor_not_found | group_not_found | request_not_found | release_not_found
 *   403 … | counselor_not_listed (seal to a counselor missing from the signed roster)
 *   400 phone_invalid | phone_not_supported | code_invalid | code_expired
 *   401 … invalid_credentials also for a wrong recovery code and an unknown, used or expired reset token
 *   409 username_taken | already_revoked | already_sealed | phone_limit_reached
 *   413 payload_too_large   415 unsupported_media_type   500 internal
 *   429 rate_limited | rate_limited_daily | rate_limited_lifetime
 *   503 holder_unavailable (one OPRF key holder is down; any t of m are enough) | sms_unavailable | matcher_unavailable
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { z } from 'zod';
import {
  DEFAULT_KDF_ITERATIONS,
  generateOprfKey,
  groupKeyFromShares,
  fromBase64,
  isOprfElement,
  normalizeMatchIdentifier,
  splitOprfKey,
  toBase64,
  type ShareKey,
} from '@matra/crypto';
import type {
  AttorneyProfile,
  AttorneysResponse,
  AuditEvent,
  BlobMeta,
  CounselorMatchGroup,
  CounselorNote,
  CounselorProfile,
  CounselorReportRequest,
  CounselorRosterPayload,
  CounselorSeal,
  EscrowEntry,
  MatchingConfig,
  LedgerEntry,
  PublicUser,
  ReportRelease,
  ReportRevokeReason,
  ReportReleaseBundle,
  Role,
  Share,
  ShareBundle,
  SignedAttorneyDirectory,
  SignedCounselorRoster,
  SurvivorReportRelease,
  SurvivorReportRequest,
  VaultRecord,
  VaultRecordMeta,
  WrappedKey,
} from '@matra/shared';
import { openDb, type DB } from './db.js';
import {
  appendLedger,
  canonicalEnvelope,
  envelopeContentHash,
  getLedgerEntry,
  ledgerHead,
  ledgerProof,
  newId,
  sha256Hex,
  verifyLedger,
} from './ledger.js';
import {
  RateLimiter,
  createSession,
  deleteSession,
  purgeExpiredSessions,
  dummyVerify,
  fakeKdfSalt,
  hashAuthKey,
  requireAuth,
  requireRole,
  verifyAuthKey,
} from './auth.js';
import { ClientKeyer, errorMessageForLog, logRequests } from './privacy.js';
import * as S from './schemas.js';
import { AccountOprfBudget, DEFAULT_OPRF_LIMITS, SqliteQuotaStore, type OprfLimits } from './oprf.js';
import { InProcessHolderPool, RemoteHolderPool, type HolderPool, type RemoteHolderConfig } from './holders.js';
import { InProcessMatcher, MatcherGate, type MatcherClient, type MatcherPins, type MatcherRosterInput } from './matcher-client.js';
import { INSPECTOR_ROUTE, RequestRecorder, appProcess, fetchProcess, findInDb } from './inspector.js';
import { MockSmsVerifier, PHONE_SEND_LIMITS, SMS_CODE_TTL_MS, SmsError, phoneToken, type PhoneSendLimits, type SmsVerifier } from './sms.js';

export interface CreateAppOptions {
  /** SQLite path, or ':memory:' for tests. */
  dbPath: string;
  /** Server secret for HMACs (fake prelogin salts). */
  pepper: Buffer | string;
  /** Allowed CORS origins (the Vite dev server proxies /api, so CORS is rarely needed). */
  corsOrigins?: string[];
  /** DEV ONLY: newly registered attorneys are immediately verified. */
  autoVerifyAttorneys?: boolean;
  /** Log method, path, status, duration (never bodies or query strings). */
  logRequests?: boolean;
  /**
   * Production: serve the built web app (apps/web/dist) from this directory, same origin as the API, with a
   * strict Content-Security-Policy and an SPA fallback to index.html.
   */
  webDir?: string;
  /** Inject a "DEMO — do not enter real information" banner into the served app (env MATRA_DEMO_BANNER=1). */
  demoBanner?: boolean;
  /** Number of reverse-proxy hops to trust for the client IP (rate limiting). Render / Fly: 1. */
  trustProxy?: number;
  /**
   * Sealed matching. `oprf` is the threshold OPRF key set (config.ts loadOprfThreshold): t, and either all m shares
   * in-process or the remote holders' URLs + pinned share public keys + holder-token key. When omitted (tests), a fresh
   * ephemeral 2-of-3 ceremony runs — matching then only works for the lifetime of this process.
   * releaseDelayHours (default 72): a group is released only once ≥ 2 distinct survivors' entries are at least this old.
   * allowKeyRotation: accept keys that differ from the ones recorded in the DB (MATRA_OPRF_ROTATE=1) → new key epoch.
   */
  matching?: {
    oprf?: { t: number; shares?: ShareKey[]; remote?: RemoteHolderConfig };
    limits?: Partial<OprfLimits>;
    releaseDelayHours?: number;
    allowKeyRotation?: boolean;
    /**
     * Phone verify-then-forget before sealed matching (W13; src/sms.ts, config.ts loadPhoneVerification). Default:
     * required, the mock provider, an ephemeral hash key, 2 accounts per phone, demo code returned outside production,
     * NANP numbers only (country code 1), PHONE_SEND_LIMITS, and phone tokens flushed to the DB 10–60 min later.
     */
    requirePhoneVerification?: boolean;
    phone?: {
      verifier?: SmsVerifier;
      hashKey?: Uint8Array;
      maxAccountsPerPhone?: number;
      exposeDemoCode?: boolean;
      /** E.164 country calling codes a code may be sent to (MATRA_SMS_ALLOWED_COUNTRY_CODES). Default ['1']. */
      allowedCountryCodes?: string[];
      sendLimits?: Partial<PhoneSendLimits>;
      /** [min, max] ms before buffered phone-token counts are written to the DB (random in between). Default 10–60 min. */
      tokenFlushDelayMs?: [number, number];
    };
    /**
     * The matcher service (src/matcher-client.ts, apps/matcher): which groups are released, and to which ONE counselor.
     * Default (tests): an in-process matcher with an in-memory DB, fresh random keys, and no pins (simulated allowed).
     * config.ts loadMatcherConfig builds this from the environment.
     */
    matcher?: { client: MatcherClient; pins: MatcherPins };
  };
  /**
   * DEV / DEMO ONLY: the "what the server sees" inspector, GET /api/dev/inspector (src/inspector.ts). Unauthenticated;
   * keeps the last 200 request summaries in memory. index.ts sets it only when inspectorEnabled() (MATRA_INSPECTOR=1,
   * and not production unless MATRA_DEMO_MODE=1).
   */
  inspector?: boolean;
  /**
   * Fewest PBKDF2 rounds a client may register (or reset) a passphrase with. Default: DEFAULT_KDF_ITERATIONS (600,000)
   * in production; 1,000 elsewhere, so tests can register accounts quickly. Her client refuses fewer than
   * DEFAULT_KDF_ITERATIONS from prelogin anyway (apps/web/src/lib/session.tsx checkKdfIterations).
   */
  minKdfIterations?: number;
}

/**
 * CSP for the web app itself. Everything is same-origin: no inline scripts, no eval, no third-party anything.
 * img/media allow blob: for the in-memory previews of decrypted evidence; data: only for the inline favicon.
 * (React `style` props are applied through the CSSOM, which style-src does not restrict.)
 * On-device voice transcription: 'wasm-unsafe-eval' lets WebAssembly compile (it does NOT allow JS eval), and
 * worker-src 'self' allows the same-origin module worker that runs the model. Model + runtime files are served
 * from /models/ on this origin, so connect-src stays 'self' — audio and model requests can never leave it.
 */
export const WEB_CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  // Report only paths + messages: never echo input values.
  const msg = r.error.issues.map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`).join('; ');
  throw new HttpError(400, 'invalid_request', msg.slice(0, 500));
}

// ───────────── row types & mappers ─────────────

interface UserRow {
  id: string;
  username: string;
  role: Role;
  auth_hash: Buffer;
  auth_salt: Buffer;
  kdf_salt: string;
  kdf_iterations: number;
  public_key: string;
  wrapped_private_key: string;
  created_at: string;
  key_version: 1 | 2;
  wrapped_account_key: string | null;
  recovery_auth_hash: Buffer | null;
  recovery_auth_salt: Buffer | null;
  recovery_wrapped_key: string | null;
}
interface ProfileRow {
  user_id: string;
  display_name: string;
  organization: string | null;
  bar_number: string | null;
  jurisdictions: string;
  practice_areas: string;
  verified: number;
  accepts_pro_bono: number;
  public_key: string;
}
interface RecordRow {
  id: string;
  owner_id: string;
  supersedes: string | null;
  envelope: string;
  owner_wrapped_key: string;
  content_hash: string;
  created_at: string;
  ledger_entry_id: string;
}
interface BlobRow {
  id: string;
  owner_id: string;
  size_bytes: number;
  content_hash: string;
  owner_wrapped_key: string;
  created_at: string;
  ledger_entry_id: string;
}
interface ShareRow {
  id: string;
  record_id: string;
  survivor_id: string;
  attorney_id: string;
  status: 'active' | 'revoked';
  consent_statement: string;
  scope: string;
  recipient_wrapped_key: string;
  survivor_alias: string;
  created_at: string;
  revoked_at: string | null;
  expires_at: string;
  ledger_entry_id: string;
  /** only on her own share list: whether the attorney is verified right now (attorney_profiles.verified) */
  attorney_verified?: number | null;
}
interface MatchEntryRow {
  id: string;
  user_id: string;
  tag: string;
  bundle: string;
  label_envelope: string;
  created_at: string;
  ledger_entry_id: string;
  key_epoch: number;
  routing_envelope: string | null;
  matcher_synced: number;
  contact_bundle: string | null;
  /** JSON array, from a subquery (survivor list only) */
  counselor_ids?: string;
}
interface CounselorProfileRow {
  user_id: string;
  display_name: string;
  organization: string | null;
  jurisdictions: string;
  verified: number;
  public_key: string;
}
interface ReportRequestRow {
  id: string;
  group_id: string;
  entry_id: string;
  counselor_id: string;
  status: 'pending' | 'consented' | 'declined' | 'cancelled';
  created_at: string;
  decided_at: string | null;
  ledger_entry_id: string;
}
interface ReportReleaseRow {
  id: string;
  request_id: string;
  survivor_id: string;
  counselor_id: string;
  record_id: string;
  recipient_wrapped_key: string;
  consent_statement: string;
  status: 'active' | 'revoked';
  created_at: string;
  expires_at: string;
  first_opened_at: string | null;
  revoked_at: string | null;
  revoke_reason: ReportRevokeReason | null;
  ledger_entry_id: string;
  /** from the request (joined) */
  group_id: string;
  entry_id: string;
  /** JSON array of blob ids (subquery) */
  blob_ids: string;
}
interface AuditRow {
  id: string;
  user_id: string;
  action: string;
  detail: string | null;
  at: string;
}

const toPublicUser = (u: UserRow): PublicUser => ({
  id: u.id,
  username: u.username,
  role: u.role,
  publicKey: JSON.parse(u.public_key),
  wrappedPrivateKey: JSON.parse(u.wrapped_private_key),
  createdAt: u.created_at,
  keyVersion: u.key_version,
  ...(u.wrapped_account_key != null && { wrappedAccountKey: JSON.parse(u.wrapped_account_key) }),
  hasRecoveryCode: u.recovery_auth_hash != null,
});

const toProfile = (p: ProfileRow): AttorneyProfile => ({
  userId: p.user_id,
  displayName: p.display_name,
  ...(p.organization != null && { organization: p.organization }),
  ...(p.bar_number != null && { barNumber: p.bar_number }),
  jurisdictions: JSON.parse(p.jurisdictions),
  practiceAreas: JSON.parse(p.practice_areas),
  verified: p.verified === 1,
  acceptsProBono: p.accepts_pro_bono === 1,
  publicKey: JSON.parse(p.public_key),
});

const toRecordMeta = (r: RecordRow): VaultRecordMeta => ({
  id: r.id,
  ownerId: r.owner_id,
  ...(r.supersedes != null && { supersedes: r.supersedes }),
  createdAt: r.created_at,
  contentHash: r.content_hash,
  ledgerEntryId: r.ledger_entry_id,
});

const toBlobMeta = (b: BlobRow): BlobMeta => ({
  id: b.id,
  ownerId: b.owner_id,
  sizeBytes: b.size_bytes,
  contentHash: b.content_hash,
  createdAt: b.created_at,
  ledgerEntryId: b.ledger_entry_id,
  ownerWrappedKey: JSON.parse(b.owner_wrapped_key),
});

const toShare = (s: ShareRow): Share => ({
  id: s.id,
  recordId: s.record_id,
  survivorId: s.survivor_id,
  attorneyId: s.attorney_id,
  status: s.status,
  consentStatement: s.consent_statement,
  scope: JSON.parse(s.scope),
  createdAt: s.created_at,
  expiresAt: s.expires_at,
  ...(s.revoked_at != null && { revokedAt: s.revoked_at }),
  ledgerEntryId: s.ledger_entry_id,
  ...(s.attorney_verified != null && { attorneyVerified: s.attorney_verified === 1 }),
});

const DEFAULT_SHARE_DAYS = 90;
const addDays = (from: number, days: number) => new Date(from + days * 86_400_000).toISOString();
/** A share grants access only while active AND unexpired. Revocation and expiry stop future access only. */
const isShareLive = (s: ShareRow) => s.status === 'active' && Date.parse(s.expires_at) > Date.now();

/** The fingerprint shown for a person's RSA key (same formula as publicKeyFingerprint in @matra/crypto). */
const keyFingerprint = (publicKeyJson: string) => {
  const pk = JSON.parse(publicKeyJson) as { kty?: string; n?: string; e?: string };
  return sha256Hex(`${pk.kty}|${pk.n}|${pk.e}`).slice(0, 32).toUpperCase().match(/.{4}/g)!.join('-');
};

/** A report release, as either party sees it. No survivor id: the counselor never learns account ids. */
const toRelease = (r: ReportReleaseRow): ReportRelease => ({
  id: r.id,
  requestId: r.request_id,
  groupId: r.group_id,
  entryId: r.entry_id,
  recordId: r.record_id,
  counselorId: r.counselor_id,
  status: r.status,
  consentStatement: r.consent_statement,
  blobIds: r.blob_ids ? (JSON.parse(r.blob_ids) as string[]) : [],
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  ...(r.first_opened_at != null && { firstOpenedAt: r.first_opened_at }),
  ...(r.revoked_at != null && { revokedAt: r.revoked_at }),
  ...(r.revoke_reason != null && { revokeReason: r.revoke_reason }),
  ledgerEntryId: r.ledger_entry_id,
});
/** The same release as the survivor sees it: without the group id, which every survivor in the group shares (W21). */
const toSurvivorRelease = (r: ReportReleaseRow): SurvivorReportRelease => {
  const { groupId: _groupId, ...rest } = toRelease(r);
  return rest;
};
const isReleaseLive = (r: ReportReleaseRow) => r.status === 'active' && Date.parse(r.expires_at) > Date.now();

/**
 * Survivor-facing view of a sealed-match entry. ALWAYS reports 'sealed' and never includes matchedAt or the tag:
 * if survivors could see match results, a perpetrator could register as a "survivor", submit his own
 * identifiers, and learn that he has been named. Matched groups are released only to verified counselors.
 */
const toSurvivorEscrow = (e: MatchEntryRow): EscrowEntry => ({
  id: e.id,
  labelEnvelope: JSON.parse(e.label_envelope),
  status: 'sealed',
  createdAt: e.created_at,
  ledgerEntryId: e.ledger_entry_id,
  keyEpoch: e.key_epoch,
  counselorIds: e.counselor_ids ? (JSON.parse(e.counselor_ids) as string[]).sort() : [],
});

const toCounselorProfile = (p: CounselorProfileRow): CounselorProfile => ({
  userId: p.user_id,
  displayName: p.display_name,
  ...(p.organization != null && { organization: p.organization }),
  jurisdictions: JSON.parse(p.jurisdictions),
  verified: p.verified === 1,
  publicKey: JSON.parse(p.public_key),
});

const toAudit = (a: AuditRow): AuditEvent => ({
  id: a.id,
  userId: a.user_id,
  action: a.action,
  ...(a.detail != null && { detail: a.detail }),
  at: a.at,
});

// ───────────── app ─────────────

/** How often createApp drops expired sessions, SMS challenges and in-memory limiter entries (W11). */
export const HOUSEKEEPING_INTERVAL_MS = 10 * 60_000;
/** A recovery reset (alias + code accepted) must be finished within this time, once. */
export const RESET_TOKEN_TTL_MS = 10 * 60_000;
/** At most this many 'recovery.failed' rows per account per UTC day, so wrong codes can't flood her activity list. */
export const RECOVERY_FAILED_AUDIT_CAP = 10;
/** Same for 'auth.login_failed': wrong passphrases from anyone who knows her alias can't flood her activity list. */
export const LOGIN_FAILED_AUDIT_CAP = 10;
/** Newest activity rows GET /api/audit returns. Security events (SECURITY_AUDIT_SQL) come back on top, however old. */
export const AUDIT_LIST_LIMIT = 1000;
/**
 * Activity she must always be able to see, even under a flood of other rows: anything about her recovery code, and a
 * passphrase reset with it (W20). Each is capped or rate-limited where it is written.
 */
const SECURITY_AUDIT_SQL = `(action LIKE 'recovery.%' OR action = 'auth.recovered')`;

export function createApp(opts: CreateAppOptions): express.Express {
  const db: DB = openDb(opts.dbPath);
  const pepper = typeof opts.pepper === 'string' ? Buffer.from(opts.pepper, 'utf8') : opts.pepper;
  if (pepper.length < 16) throw new Error('pepper must be at least 16 bytes');

  const app = express();
  app.locals.db = db;
  app.disable('x-powered-by');
  app.set('etag', false);
  if (opts.trustProxy) app.set('trust proxy', opts.trustProxy);

  // Security headers (set manually; no helmet dependency).
  app.use((_req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    });
    next();
  });

  // Route pattern, status and duration only: never the URL (ids, usernames), bodies, IPs or user agents (privacy.ts).
  if (opts.logRequests) app.use(logRequests('[matra]'));

  app.use(
    cors({
      origin: opts.corsOrigins ?? ['http://localhost:5173', 'http://127.0.0.1:5173'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Owner-Wrapped-Key'],
      exposedHeaders: ['X-Content-Hash', 'X-Blob-Id'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '5mb' }));
  // Dev/demo inspector only: a ring buffer of request summaries (src/inspector.ts). Never on in production.
  const recorder = opts.inspector ? new RequestRecorder() : undefined;
  if (recorder) app.use(recorder.middleware());

  const auth = requireAuth(db);
  const survivorOnly = requireRole('survivor');
  const attorneyOnly = requireRole('attorney');
  const counselorOnly = requireRole('counselor');

  // ── sealed matching: t-of-m threshold OPRF key holders (in-process, or remote processes behind this server) ──
  const limits: OprfLimits = { ...DEFAULT_OPRF_LIMITS, ...opts.matching?.limits };
  const oprfOpt = opts.matching?.oprf ?? { t: 2, shares: splitOprfKey(generateOprfKey().secretKey, 2, 3) };
  let holders: HolderPool;
  if (oprfOpt.remote) holders = new RemoteHolderPool(oprfOpt.t, oprfOpt.remote, pepper);
  else if (oprfOpt.shares) holders = new InProcessHolderPool(oprfOpt.t, oprfOpt.shares, db, limits);
  else throw new Error('matching.oprf needs either shares (in-process) or remote holders');
  // Refuses an inconsistent or degenerate key set (shares from different ceremonies, duplicates, identity keys).
  const groupPublicKey = toBase64(groupKeyFromShares(holders.publicKeys().map((h) => ({ index: h.index, publicKey: fromBase64(h.publicKey) })), holders.t));
  const releaseDelayMs = Math.max(0, opts.matching?.releaseDelayHours ?? 72) * 3_600_000;
  const matcher: MatcherClient =
    opts.matching?.matcher?.client ??
    new InProcessMatcher({ key: new Uint8Array(randomBytes(32)), platformSecretKey: new Uint8Array(randomBytes(32)), releaseDelayMs });
  const matcherGate = new MatcherGate(matcher, opts.matching?.matcher?.pins ?? { allowSimulated: true });

  // ── key pinning in the DB (review M5): t, the group key and the share public keys are recorded on first start; a
  // silent key change would make every existing entry unmatchable (and could be used to partition survivors), so it is
  // refused unless the operator explicitly rotates. A rotation starts a new key epoch; survivors' clients re-seal on
  // their next sign-in. A database still carrying the additive keys (oprf_pk_a/b) counts as a key change.
  const metaGet = db.prepare('SELECT value FROM matching_meta WHERE key = ?');
  const metaSet = db.prepare('INSERT INTO matching_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');
  const meta = (k: string) => (metaGet.get(k) as { value: string } | undefined)?.value;
  const sharePks = JSON.stringify(holders.publicKeys());
  db.transaction(() => {
    const recorded = { t: meta('oprf_t'), pk: meta('oprf_group_pk'), shares: meta('oprf_share_pks') };
    const legacy = meta('oprf_pk_a') !== undefined || meta('oprf_pk_b') !== undefined;
    const record = () => {
      metaSet.run('oprf_t', String(holders.t));
      metaSet.run('oprf_group_pk', groupPublicKey);
      metaSet.run('oprf_share_pks', sharePks);
      db.prepare(`DELETE FROM matching_meta WHERE key IN ('oprf_pk_a', 'oprf_pk_b')`).run();
    };
    if (!legacy && recorded.t === undefined && recorded.pk === undefined && recorded.shares === undefined) {
      record();
      metaSet.run('key_epoch', String(Number(meta('key_epoch') ?? 0) + 1));
    } else if (legacy || recorded.t !== String(holders.t) || recorded.pk !== groupPublicKey || recorded.shares !== sharePks) {
      if (!opts.matching?.allowKeyRotation)
        throw new Error(
          'OPRF key holder public keys differ from the ones recorded in this database. Refusing to start: a silent key ' +
            'change breaks every sealed entry. To rotate deliberately, restart once with MATRA_OPRF_ROTATE=1.',
        );
      const epoch = Number(meta('key_epoch') ?? 1) + 1;
      record();
      metaSet.run('key_epoch', String(epoch));
      db.prepare('DELETE FROM oprf_quota').run(); // new keys: re-sealing must not be blocked by old quotas
      console.warn(`[matra] OPRF keys rotated: key epoch is now ${epoch}. Survivors' clients re-seal on next sign-in.`);
    }
  })();
  const keyEpoch = Number(meta('key_epoch'));
  // One unit per account per distinct blinded element, whichever holders it goes to (src/oprf.ts AccountOprfBudget).
  const accountBudget = new AccountOprfBudget(new SqliteQuotaStore(db), limits);

  // Per-client limits key on a daily-salted HMAC of the IP, in memory only; never the raw IP (privacy.ts, W11).
  const clients = new ClientKeyer();
  const loginLimiterKey = clients.limiter(10, 60_000);
  const loginLimiterIp = clients.limiter(60, 60_000);
  const rateLimit = (req: Request, kind: string, username: unknown) => {
    const ip = clients.key(req);
    const u = typeof username === 'string' ? username.trim().toLowerCase().slice(0, 64) : '';
    if (!loginLimiterIp.hit(`${kind}|${ip}`) || !loginLimiterKey.hit(`${kind}|${ip}|${u}`))
      throw new HttpError(429, 'rate_limited', 'Too many attempts. Please wait a minute and try again.');
  };

  // ── prepared statements ──
  const q = {
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    profileByUser: db.prepare(
      'SELECT p.*, u.public_key FROM attorney_profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?',
    ),
    verifiedProfiles: db.prepare(
      `SELECT p.*, u.public_key FROM attorney_profiles p JOIN users u ON u.id = p.user_id
        WHERE p.verified = 1 ORDER BY p.display_name`,
    ),
    recoveryFailedSince: db.prepare(
      `SELECT COUNT(*) AS n FROM audit_events WHERE user_id = ? AND action = 'recovery.failed' AND at >= ?`,
    ),
    loginFailedSince: db.prepare(
      `SELECT COUNT(*) AS n FROM audit_events WHERE user_id = ? AND action = 'auth.login_failed' AND at >= ?`,
    ),
    insertAudit: db.prepare('INSERT INTO audit_events (id, user_id, action, detail, at) VALUES (?, ?, ?, ?, ?)'),
    recordById: db.prepare('SELECT * FROM records WHERE id = ?'),
    blobMetaById: db.prepare(
      'SELECT id, owner_id, size_bytes, content_hash, owner_wrapped_key, created_at, ledger_entry_id FROM blobs WHERE id = ?',
    ),
    shareById: db.prepare('SELECT * FROM shares WHERE id = ?'),
    counselorProfileByUser: db.prepare(
      'SELECT c.*, u.public_key FROM counselor_profiles c JOIN users u ON u.id = c.user_id WHERE c.user_id = ?',
    ),
    verifiedCounselors: db.prepare(
      `SELECT c.*, u.public_key FROM counselor_profiles c JOIN users u ON u.id = c.user_id
        WHERE c.verified = 1 ORDER BY c.display_name`,
    ),
    matchEntryById: db.prepare(
      `SELECT e.*, (SELECT json_group_array(counselor_id) FROM match_seals s WHERE s.entry_id = e.id) AS counselor_ids
         FROM match_entries e WHERE e.id = ?`,
    ),
  };

  const audit = (userId: string, action: string, detail?: string) =>
    q.insertAudit.run(newId(), userId, action, detail ?? null, new Date().toISOString());

  const attorneyLabel = (attorneyId: string): string => {
    const p = q.profileByUser.get(attorneyId) as ProfileRow | undefined;
    const u = q.userById.get(attorneyId) as UserRow | undefined;
    return p ? `${p.display_name}${p.organization ? `, ${p.organization}` : ''} (${u?.username ?? 'attorney'})` : 'An attorney';
  };

  /**
   * Attorney routes that read shared files need a verified attorney, like verifiedCounselor for counselors. Unverifying
   * an attorney (verify-attorney --revoke) pauses access to every share at once without revoking her consent: the
   * survivor decides whether to revoke or keep it (attorney-verification.ts tells her).
   */
  const assertVerifiedAttorney = (userId: string) => {
    const p = q.profileByUser.get(userId) as ProfileRow | undefined;
    if (!p || p.verified !== 1)
      throw new HttpError(403, 'attorney_not_verified', 'Your attorney account is not verified right now, so files shared with you are paused.');
  };
  const verifiedAttorney = (req: Request, _res: Response, next: NextFunction) => {
    assertVerifiedAttorney(req.user!.id);
    next();
  };

  // ════════════ health ════════════
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // ════════════ auth ════════════
  app.get('/api/auth/prelogin', (req, res) => {
    const { username } = parse(S.preloginQuery, req.query);
    const u = q.userByName.get(username) as UserRow | undefined;
    if (u) return res.json({ kdfSalt: u.kdf_salt, kdfIterations: u.kdf_iterations });
    res.json(fakeKdfSalt(pepper, username));
  });

  const minKdfIterations = opts.minKdfIterations ?? (process.env.NODE_ENV === 'production' ? DEFAULT_KDF_ITERATIONS : 1_000);
  const assertKdfIterations = (n: number) => {
    if (n < minKdfIterations)
      throw new HttpError(400, 'invalid_request', `kdfIterations: must be at least ${minKdfIterations}`);
  };

  app.post('/api/auth/register', async (req, res) => {
    rateLimit(req, 'register', req.body?.username);
    const body = parse(S.registerRequest, req.body);
    assertKdfIterations(body.kdfIterations);
    if (q.userByName.get(body.username))
      throw new HttpError(409, 'username_taken', 'That username is not available.');
    const { hash, salt } = await hashAuthKey(body.authKey);
    const id = newId();
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO users (id, username, role, auth_hash, auth_salt, kdf_salt, kdf_iterations, public_key, wrapped_private_key, created_at,
                            age_confirmed_18, age_confirmed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        body.username,
        body.role,
        hash,
        salt,
        body.kdfSalt,
        body.kdfIterations,
        JSON.stringify(body.publicKey),
        canonicalEnvelope(body.wrappedPrivateKey),
        now,
        body.ageConfirmed18 === true ? 1 : 0,
        body.ageConfirmed18 === true ? now : null,
      );
      if (body.role === 'attorney' && body.attorneyProfile) {
        const p = body.attorneyProfile;
        db.prepare(
          `INSERT INTO attorney_profiles (user_id, display_name, organization, bar_number, jurisdictions, practice_areas, verified, accepts_pro_bono)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          p.displayName,
          p.organization || null,
          p.barNumber || null,
          JSON.stringify([...new Set(p.jurisdictions)]),
          JSON.stringify(p.practiceAreas),
          opts.autoVerifyAttorneys ? 1 : 0,
          p.acceptsProBono ? 1 : 0,
        );
      }
      if (body.role === 'counselor' && body.counselorProfile) {
        // Counselors are never auto-verified: Matra contracts and vets them (npm run verify-attorney -- <user>).
        const p = body.counselorProfile;
        db.prepare(
          `INSERT INTO counselor_profiles (user_id, display_name, organization, jurisdictions, verified) VALUES (?, ?, ?, ?, 0)`,
        ).run(id, p.displayName, p.organization || null, JSON.stringify([...new Set(p.jurisdictions)]));
      }
      audit(id, 'account.created', `Account created (${body.role})`);
    })();
    const token = createSession(db, id);
    audit(id, 'auth.login', 'Signed in');
    res.status(201).json({ token, user: toPublicUser(q.userById.get(id) as UserRow) });
  });

  app.post('/api/auth/login', async (req, res) => {
    rateLimit(req, 'login', req.body?.username);
    const body = parse(S.loginRequest, req.body);
    const u = q.userByName.get(body.username) as UserRow | undefined;
    if (!u) {
      await dummyVerify(body.authKey);
      throw new HttpError(401, 'invalid_credentials', 'Username or passphrase is incorrect.');
    }
    if (!(await verifyAuthKey(body.authKey, u.auth_salt, u.auth_hash))) {
      // capped per UTC day, like recovery.failed, so wrong passphrases can't push everything else off her list
      const today = new Date().toISOString().slice(0, 10);
      const { n } = q.loginFailedSince.get(u.id, today) as { n: number };
      if (n < LOGIN_FAILED_AUDIT_CAP) audit(u.id, 'auth.login_failed', 'A sign-in attempt with an incorrect passphrase');
      throw new HttpError(401, 'invalid_credentials', 'Username or passphrase is incorrect.');
    }
    const token = createSession(db, u.id);
    audit(u.id, 'auth.login', 'Signed in');
    res.json({ token, user: toPublicUser(u) });
  });

  app.post('/api/auth/logout', auth, (req, res) => {
    deleteSession(db, req.sessionToken!);
    audit(req.user!.id, 'auth.logout', 'Signed out');
    res.json({ ok: true });
  });

  app.get('/api/me', auth, (req, res) => {
    const u = q.userById.get(req.user!.id) as UserRow;
    const p = q.profileByUser.get(u.id) as ProfileRow | undefined;
    const c = q.counselorProfileByUser.get(u.id) as CounselorProfileRow | undefined;
    res.json({ user: toPublicUser(u), ...(p && { attorneyProfile: toProfile(p) }), ...(c && { counselorProfile: toCounselorProfile(c) }) });
  });

  // ════════════ recovery code (W20) ════════════
  // The code never reaches the server: it sees recoveryAuthKey (stored as scrypt, like the passphrase auth key) and the
  // account secret wrapped under a key only the code gives. So the server can check a code; it cannot reset anyone.
  // Survivor accounts only: for a counselor or attorney, a single code + alias would open the private key that reads
  // sealed-match releases or shared records, a takeover path their threat model (roster, n-of-m) does not cover.
  // Rate limits are per client and per client+alias, deliberately not per alias alone: a global per-alias limit would
  // let anyone lock her out of her own recovery by spending it from many clients (128-bit codes need no guess limit).

  /** Pending resets, in memory only: sha256(token) → whose, until when, and which code started it. Single use. */
  const resetTokens = new Map<string, { userId: string; expiresAt: number; recoveryHash: Buffer }>();
  const sweepResetTokens = (now = Date.now()) => {
    for (const [k, t] of resetTokens) if (t.expiresAt <= now) resetTokens.delete(k);
  };
  const recoveryLimiter = clients.limiter(10, 15 * 60_000); // per client: a wrong code is a typo, not a hobby
  app.locals.resetTokens = resetTokens;

  /**
   * Re-authenticate with the passphrase auth key before changing what can open her account (a recovery code) or
   * deleting it. A session alone is not enough: a session can be left open on a shared device.
   */
  const reauth = async (u: UserRow, authKey: string, purpose: 'recovery' | 'delete' = 'recovery') => {
    if (!(await verifyAuthKey(authKey, u.auth_salt, u.auth_hash))) {
      if (purpose === 'delete') audit(u.id, 'auth.delete_reauth_failed', 'An attempt to delete the account with an incorrect passphrase');
      else audit(u.id, 'auth.reauth_failed', 'A recovery-code change with an incorrect passphrase');
      throw new HttpError(401, 'invalid_credentials', 'That passphrase is incorrect.');
    }
  };

  app.post('/api/account/recovery', auth, async (req, res) => {
    rateLimit(req, 'recovery-setup', req.user!.username);
    if (req.user!.role !== 'survivor') throw new HttpError(403, 'forbidden_role', 'Recovery codes are for survivor accounts only.');
    const body = parse(S.setUpRecoveryRequest, req.body);
    const u = q.userById.get(req.user!.id) as UserRow;
    await reauth(u, body.authKey);
    if (u.key_version === 1 && !body.wrappedAccountKey)
      throw new HttpError(400, 'invalid_request', 'wrappedAccountKey: required to move this account to key version 2');
    if (u.key_version === 2 && body.wrappedAccountKey)
      throw new HttpError(400, 'invalid_request', 'wrappedAccountKey: this account already has one');
    const { hash, salt } = await hashAuthKey(body.recoveryAuthKey);
    const replacing = u.recovery_auth_hash != null;
    db.transaction(() => {
      db.prepare(
        `UPDATE users SET key_version = 2, wrapped_account_key = COALESCE(?, wrapped_account_key),
                          recovery_auth_hash = ?, recovery_auth_salt = ?, recovery_wrapped_key = ? WHERE id = ?`,
      ).run(body.wrappedAccountKey ? canonicalEnvelope(body.wrappedAccountKey) : null, hash, salt, canonicalEnvelope(body.recoveryWrappedKey), u.id);
      // a reset started with the old code must not finish with it
      for (const [k, t] of resetTokens) if (t.userId === u.id) resetTokens.delete(k);
      audit(u.id, replacing ? 'recovery.replaced' : 'recovery.set_up', replacing ? 'Made a new recovery code (the old one stopped working)' : 'Set up a recovery code');
    })();
    res.json({ user: toPublicUser(q.userById.get(u.id) as UserRow) });
  });

  app.delete('/api/account/recovery', auth, async (req, res) => {
    rateLimit(req, 'recovery-setup', req.user!.username);
    const body = parse(S.turnOffRecoveryRequest, req.body);
    const u = q.userById.get(req.user!.id) as UserRow;
    await reauth(u, body.authKey);
    db.transaction(() => {
      db.prepare('UPDATE users SET recovery_auth_hash = NULL, recovery_auth_salt = NULL, recovery_wrapped_key = NULL WHERE id = ?').run(u.id);
      for (const [k, t] of resetTokens) if (t.userId === u.id) resetTokens.delete(k);
      audit(u.id, 'recovery.turned_off', 'Turned off the recovery code');
    })();
    res.json({ user: toPublicUser(q.userById.get(u.id) as UserRow) });
  });

  app.post('/api/auth/recover/start', async (req, res) => {
    rateLimit(req, 'recover', req.body?.username);
    if (!recoveryLimiter.hit(`recover|${clients.key(req)}`))
      throw new HttpError(429, 'rate_limited', 'Too many attempts. Please wait a few minutes and try again.');
    const body = parse(S.recoverStartRequest, req.body);
    const u = q.userByName.get(body.username) as UserRow | undefined;
    // Unknown alias, no code set up, or a wrong code: the same answer after the same scrypt work (no alias probing).
    const fail = () => new HttpError(401, 'invalid_credentials', 'That alias and recovery code don’t match.');
    if (!u || u.role !== 'survivor' || !u.recovery_auth_hash || !u.recovery_auth_salt || !u.recovery_wrapped_key) {
      await dummyVerify(body.recoveryAuthKey);
      throw fail();
    }
    if (!(await verifyAuthKey(body.recoveryAuthKey, u.recovery_auth_salt, u.recovery_auth_hash))) {
      const today = new Date().toISOString().slice(0, 10);
      const { n } = q.recoveryFailedSince.get(u.id, today) as { n: number };
      if (n < RECOVERY_FAILED_AUDIT_CAP) audit(u.id, 'recovery.failed', 'Someone tried to use a recovery code that didn’t match');
      throw fail();
    }
    // Her secret leaves wrapped under the code's key whether or not a reset follows, so say so in her activity now.
    audit(u.id, 'recovery.used', 'Your recovery code was used to start a passphrase reset');
    sweepResetTokens();
    const resetToken = randomBytes(32).toString('base64url');
    resetTokens.set(sha256Hex(resetToken), { userId: u.id, expiresAt: Date.now() + RESET_TOKEN_TTL_MS, recoveryHash: u.recovery_auth_hash });
    res.json({ resetToken, recoveryWrappedKey: JSON.parse(u.recovery_wrapped_key) });
  });

  app.post('/api/auth/recover/finish', async (req, res) => {
    rateLimit(req, 'recover-finish', '');
    const body = parse(S.recoverFinishRequest, req.body);
    assertKdfIterations(body.kdfIterations);
    const key = sha256Hex(body.resetToken);
    const pending = resetTokens.get(key);
    resetTokens.delete(key); // single use, whatever happens next
    const expired = () => new HttpError(401, 'invalid_credentials', 'This reset has expired. Please enter your recovery code again.');
    const u = pending && (q.userById.get(pending.userId) as UserRow | undefined);
    if (!pending || pending.expiresAt <= Date.now() || !u || !u.recovery_auth_hash || !u.recovery_auth_hash.equals(pending.recoveryHash))
      throw expired();
    const pass = await hashAuthKey(body.authKey);
    const now = new Date().toISOString();
    db.transaction(() => {
      // The used code is burned and no new one is stored here: her client shows her a new code and saves it through
      // POST /api/account/recovery only after she confirms she wrote it down (so no code exists that nobody holds).
      // Conditional on the code that started this reset: if she replaced or turned it off during the scrypt above,
      // nothing changes.
      const changed = db.prepare(
        `UPDATE users SET auth_hash = ?, auth_salt = ?, kdf_salt = ?, kdf_iterations = ?, key_version = 2, wrapped_account_key = ?,
                          recovery_auth_hash = NULL, recovery_auth_salt = NULL, recovery_wrapped_key = NULL
          WHERE id = ? AND recovery_auth_hash = ?`,
      ).run(pass.hash, pass.salt, body.kdfSalt, body.kdfIterations, canonicalEnvelope(body.wrappedAccountKey), u.id, pending.recoveryHash);
      if (changed.changes !== 1) throw expired();
      // whoever was signed in with the old passphrase is signed out
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
      for (const [k, t] of resetTokens) if (t.userId === u.id) resetTokens.delete(k);
      audit(u.id, 'auth.recovered', 'Your passphrase was reset with your recovery code');
      appendLedger(db, 'account.recovered', u.id, sha256Hex(JSON.stringify({ userId: u.id, at: now })), now);
    })();
    const token = createSession(db, u.id);
    audit(u.id, 'auth.login', 'Signed in');
    res.json({ token, user: toPublicUser(q.userById.get(u.id) as UserRow) });
  });

  // ════════════ vault: records ════════════
  app.post('/api/vault/records', auth, (req, res) => {
    const me = req.user!;
    const body = parse(S.createRecordRequest, req.body);
    if (body.supersedes) {
      const prev = q.recordById.get(body.supersedes) as RecordRow | undefined;
      if (!prev) throw new HttpError(404, 'record_not_found', 'The record being superseded does not exist.');
      if (prev.owner_id !== me.id) throw new HttpError(403, 'forbidden', 'You can only supersede your own records.');
    }
    const id = newId();
    const envelopeJson = canonicalEnvelope(body.envelope);
    const contentHash = envelopeContentHash(body.envelope);
    let ledgerEntry!: LedgerEntry;
    db.transaction(() => {
      ledgerEntry = appendLedger(db, 'record.sealed', id, contentHash);
      db.prepare(
        `INSERT INTO records (id, owner_id, supersedes, envelope, owner_wrapped_key, content_hash, created_at, ledger_entry_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        me.id,
        body.supersedes ?? null,
        envelopeJson,
        JSON.stringify(body.ownerWrappedKey),
        contentHash,
        ledgerEntry.timestamp,
        ledgerEntry.id,
      );
      audit(me.id, 'record.created', `Encrypted record saved (ledger #${ledgerEntry.seq})`);
    })();
    res.status(201).json({ record: toRecordMeta(q.recordById.get(id) as RecordRow), ledgerEntry });
  });

  app.get('/api/vault/records', auth, (req, res) => {
    const rows = db
      .prepare('SELECT * FROM records WHERE owner_id = ? ORDER BY created_at ASC, rowid ASC')
      .all(req.user!.id) as RecordRow[];
    res.json({ records: rows.map(toRecordMeta) });
  });

  app.get('/api/vault/records/:id', auth, (req, res) => {
    const rid = parse(S.id, req.params.id);
    const r = q.recordById.get(rid) as RecordRow | undefined;
    if (!r) throw new HttpError(404, 'record_not_found', 'Record not found.');
    if (r.owner_id !== req.user!.id) throw new HttpError(403, 'forbidden', 'You do not have access to this record.');
    const record: VaultRecord = {
      ...toRecordMeta(r),
      envelope: JSON.parse(r.envelope),
      ownerWrappedKey: JSON.parse(r.owner_wrapped_key),
    };
    res.json({ record });
  });

  // ════════════ vault: blobs ════════════
  app.post(
    '/api/vault/blobs',
    auth, // authenticate before buffering up to 50 MB
    express.raw({ type: 'application/octet-stream', limit: '50mb' }),
    (req, res) => {
      const me = req.user!;
      if (!Buffer.isBuffer(req.body))
        throw new HttpError(415, 'unsupported_media_type', 'Body must be application/octet-stream ciphertext.');
      const data = req.body as Buffer;
      if (data.length < 28) throw new HttpError(400, 'invalid_request', 'Ciphertext too short (expected iv || ct).');
      let wrapped: WrappedKey;
      try {
        const hdr = req.get('x-owner-wrapped-key');
        if (!hdr || hdr.length > 4096) throw new Error();
        wrapped = parse(S.ownerWrappedKey, JSON.parse(Buffer.from(hdr, 'base64').toString('utf8')));
      } catch {
        throw new HttpError(400, 'invalid_wrapped_key', 'Header X-Owner-Wrapped-Key must be base64(JSON(WrappedKey)) with alg A256GCM-KW.');
      }
      const id = newId();
      const contentHash = sha256Hex(data);
      let ledgerEntry!: LedgerEntry;
      db.transaction(() => {
        ledgerEntry = appendLedger(db, 'blob.sealed', id, contentHash);
        db.prepare(
          `INSERT INTO blobs (id, owner_id, data, size_bytes, content_hash, owner_wrapped_key, created_at, ledger_entry_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, me.id, data, data.length, contentHash, JSON.stringify(wrapped), ledgerEntry.timestamp, ledgerEntry.id);
        audit(me.id, 'blob.uploaded', `Encrypted evidence file sealed (ledger #${ledgerEntry.seq})`);
      })();
      res.status(201).json({ blob: toBlobMeta(q.blobMetaById.get(id) as BlobRow), ledgerEntry });
    },
  );

  app.get('/api/vault/blobs', auth, (req, res) => {
    const rows = db
      .prepare(
        `SELECT id, owner_id, size_bytes, content_hash, owner_wrapped_key, created_at, ledger_entry_id
           FROM blobs WHERE owner_id = ? ORDER BY created_at ASC, rowid ASC`,
      )
      .all(req.user!.id) as BlobRow[];
    res.json({ blobs: rows.map(toBlobMeta) });
  });

  app.get('/api/vault/blobs/:id', auth, (req, res) => {
    const me = req.user!;
    const bid = parse(S.id, req.params.id);
    const meta = q.blobMetaById.get(bid) as BlobRow | undefined;
    if (!meta) throw new HttpError(404, 'blob_not_found', 'File not found.');
    if (meta.owner_id !== me.id) {
      if (me.role === 'attorney') assertVerifiedAttorney(me.id);
      const grant =
        me.role === 'attorney'
          ? (db
              .prepare(
                `SELECT s.id, s.survivor_id FROM share_blobs sb JOIN shares s ON s.id = sb.share_id
                  WHERE sb.blob_id = ? AND s.attorney_id = ? AND s.status = 'active' AND s.expires_at > ? LIMIT 1`,
              )
              .get(bid, me.id, new Date().toISOString()) as { id: string; survivor_id: string } | undefined)
          : undefined;
      if (!grant) {
        const wasShared =
          me.role === 'attorney'
            ? (db
            .prepare(`SELECT s.status FROM share_blobs sb JOIN shares s ON s.id = sb.share_id WHERE sb.blob_id = ? AND s.attorney_id = ? ORDER BY (s.status = 'active') DESC LIMIT 1`)
            .get(bid, me.id) as { status: string } | undefined)
            : undefined;
        if (wasShared?.status === 'active') throw new HttpError(403, 'share_expired', 'This share has expired. Ask the survivor to renew it.');
        if (wasShared) throw new HttpError(403, 'share_revoked', 'The survivor has revoked access to this file.');
        throw new HttpError(403, 'forbidden', 'You do not have access to this file.');
      }
      const when = new Date().toISOString();
      audit(me.id, 'share.blob_downloaded', `Downloaded encrypted evidence file ${bid} (share ${grant.id})`);
      audit(grant.survivor_id, 'attorney.downloaded_evidence', `${attorneyLabel(me.id)} downloaded one of your shared evidence files at ${when}`);
    }
    const row = db.prepare('SELECT data FROM blobs WHERE id = ?').get(bid) as { data: Buffer };
    res.set({
      'Content-Type': 'application/octet-stream',
      'X-Content-Hash': meta.content_hash,
      'X-Blob-Id': meta.id,
    });
    res.send(row.data);
  });

  // ════════════ ledger (public: contains only ids, hashes, timestamps) ════════════
  app.get('/api/ledger/entries/:id', (req, res) => {
    const entry = getLedgerEntry(db, parse(S.id, req.params.id));
    if (!entry) throw new HttpError(404, 'not_found', 'Ledger entry not found.');
    res.json({ entry });
  });

  app.get('/api/ledger/verify', (_req, res) => {
    res.json(verifyLedger(db));
  });

  app.get('/api/ledger/head', (_req, res) => {
    res.json(ledgerHead(db));
  });

  // The in-browser checker (/verify) and the attorney portal: sealed-content entries by the EXACT hashes the requester
  // already holds (a file, or the hashes printed in a summary PDF), plus bare chain links to the head (ledger.ts
  // ledgerProof). No prefixes, ids or ranges, so it cannot list the ledger. Public, like the rest of the ledger, so a
  // court clerk can check a PDF without an account; rate-limited per client (daily-salted HMAC of the IP, in memory
  // only: privacy.ts) and globally. Nothing about the request is stored.
  const proofLimiter = clients.limiter(30, 60_000);
  const proofGlobal = new RateLimiter(600, 60_000);
  app.post('/api/ledger/proof', (req, res) => {
    if (!proofLimiter.hit(clients.key(req)) || !proofGlobal.hit('all'))
      throw new HttpError(429, 'rate_limited', 'Too many checks. Please wait a minute and try again.');
    const body = parse(S.ledgerProofRequest, req.body);
    res.json(ledgerProof(db, body.contentHashes));
  });

  // ════════════ attorneys ════════════
  app.get('/api/attorneys', auth, (req, res) => {
    const { state } = parse(S.attorneysQuery, req.query);
    let list = (q.verifiedProfiles.all() as ProfileRow[]).map(toProfile);
    if (state) list = list.filter((a) => a.jurisdictions.includes(state));
    // The org-signed directory (sign-roster / verify-attorney). The server cannot change it without breaking the
    // signature; her client checks each attorney's key against it before sharing (W3).
    const directory = meta('attorney_directory');
    res.json({ attorneys: list, ...(directory && { directory: JSON.parse(directory) as SignedAttorneyDirectory }) } satisfies AttorneysResponse);
  });

  // ════════════ shares ════════════
  app.post('/api/shares', auth, survivorOnly, (req, res) => {
    const me = req.user!;
    const body = parse(S.createShareRequest, req.body);

    const record = q.recordById.get(body.recordId) as RecordRow | undefined;
    if (!record) throw new HttpError(404, 'record_not_found', 'Record not found.');
    if (record.owner_id !== me.id) throw new HttpError(403, 'forbidden', 'You can only share your own records.');

    const attorney = q.userById.get(body.attorneyId) as UserRow | undefined;
    const profile = attorney && (q.profileByUser.get(attorney.id) as ProfileRow | undefined);
    if (!attorney || attorney.role !== 'attorney' || !profile)
      throw new HttpError(404, 'attorney_not_found', 'Attorney not found.');
    if (profile.verified !== 1)
      throw new HttpError(403, 'attorney_not_verified', 'This attorney has not been verified yet.');

    // Bind the share to the key the survivor confirmed: a swapped key changes the fingerprint (W3).
    const pk = JSON.parse(attorney.public_key) as { kty?: string; n?: string; e?: string };
    const actualFp = sha256Hex(`${pk.kty}|${pk.n}|${pk.e}`).slice(0, 32).toUpperCase().match(/.{4}/g)!.join('-');
    if (body.attorneyKeyFingerprint !== actualFp)
      throw new HttpError(409, 'attorney_key_mismatch', "The attorney's key does not match the fingerprint you confirmed. Nothing was shared.");
    if (!body.consentStatement.includes(actualFp))
      throw new HttpError(400, 'consent_fingerprint_missing', 'The consent statement must name the confirmed key fingerprint.');

    for (const b of body.blobs) {
      const meta = q.blobMetaById.get(b.blobId) as BlobRow | undefined;
      if (!meta) throw new HttpError(404, 'blob_not_found', 'One of the files was not found.');
      if (meta.owner_id !== me.id) throw new HttpError(403, 'forbidden', 'You can only share your own files.');
    }
    if (body.blobs.length > 0 && !body.scope.includes('evidence'))
      throw new HttpError(400, 'scope_mismatch', "Sharing files requires 'evidence' in the consent scope.");

    const id = newId();
    const expiresAt = addDays(Date.now(), body.expiresInDays ?? DEFAULT_SHARE_DAYS);
    const blobIds = body.blobs.map((b) => b.blobId);
    const contentHash = sha256Hex(
      JSON.stringify({
        shareId: id,
        recordId: body.recordId,
        attorneyId: body.attorneyId,
        attorneyKeyFingerprint: actualFp,
        consentStatement: body.consentStatement,
        scope: body.scope,
        blobIds,
        expiresAt,
      }),
    );
    let ledgerEntry!: LedgerEntry;
    db.transaction(() => {
      ledgerEntry = appendLedger(db, 'share.granted', id, contentHash);
      db.prepare(
        `INSERT INTO shares (id, record_id, survivor_id, attorney_id, status, consent_statement, scope,
                             recipient_wrapped_key, survivor_alias, created_at, revoked_at, expires_at, ledger_entry_id)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, NULL, ?, ?)`,
      ).run(
        id,
        body.recordId,
        me.id,
        body.attorneyId,
        body.consentStatement,
        JSON.stringify(body.scope),
        JSON.stringify(body.recipientWrappedKey),
        body.survivorAlias,
        ledgerEntry.timestamp,
        expiresAt,
        ledgerEntry.id,
      );
      const ins = db.prepare('INSERT INTO share_blobs (share_id, blob_id, recipient_wrapped_key) VALUES (?, ?, ?)');
      for (const b of body.blobs) ins.run(id, b.blobId, JSON.stringify(b.recipientWrappedKey));
      audit(me.id, 'share.created', `You shared your case file with ${attorneyLabel(body.attorneyId)}`);
      audit(body.attorneyId, 'share.received', `A survivor ("${body.survivorAlias}") shared a case file with you`);
    })();
    res.status(201).json({ share: toShare(q.shareById.get(id) as ShareRow), ledgerEntry });
  });

  app.get('/api/shares', auth, (req, res) => {
    const me = req.user!;
    if (me.role === 'attorney') {
      assertVerifiedAttorney(me.id);
      const rows = db.prepare('SELECT * FROM shares WHERE attorney_id = ? ORDER BY created_at DESC, rowid DESC').all(me.id) as ShareRow[];
      return res.json({ shares: rows.map(toShare) });
    }
    // Her own list also says whether each attorney is verified right now: an unverified attorney's access is paused.
    const rows = db
      .prepare(
        `SELECT s.*, p.verified AS attorney_verified FROM shares s LEFT JOIN attorney_profiles p ON p.user_id = s.attorney_id
          WHERE s.survivor_id = ? ORDER BY s.created_at DESC, s.rowid DESC`,
      )
      .all(me.id) as ShareRow[];
    res.json({ shares: rows.map(toShare) });
  });

  app.get('/api/shares/:id/bundle', auth, attorneyOnly, verifiedAttorney, (req, res) => {
    const me = req.user!;
    const s = q.shareById.get(parse(S.id, req.params.id)) as ShareRow | undefined;
    if (!s) throw new HttpError(404, 'share_not_found', 'Share not found.');
    if (s.attorney_id !== me.id) throw new HttpError(403, 'forbidden', 'This share was not granted to you.');
    if (s.status !== 'active') throw new HttpError(403, 'share_revoked', 'The survivor has revoked access to this file.');
    if (!isShareLive(s)) throw new HttpError(403, 'share_expired', 'This share has expired. Ask the survivor to renew it.');
    const r = q.recordById.get(s.record_id) as RecordRow;
    const blobs = db
      .prepare(
        `SELECT sb.blob_id, sb.recipient_wrapped_key, b.content_hash, b.size_bytes
           FROM share_blobs sb JOIN blobs b ON b.id = sb.blob_id
          WHERE sb.share_id = ? ORDER BY sb.rowid ASC`,
      )
      .all(s.id) as Array<{ blob_id: string; recipient_wrapped_key: string; content_hash: string; size_bytes: number }>;
    const bundle: ShareBundle = {
      share: toShare(s),
      record: {
        id: r.id,
        envelope: JSON.parse(r.envelope),
        contentHash: r.content_hash,
        createdAt: r.created_at,
        ledgerEntryId: r.ledger_entry_id,
      },
      recipientWrappedKey: JSON.parse(s.recipient_wrapped_key),
      blobs: blobs.map((b) => ({
        blobId: b.blob_id,
        recipientWrappedKey: JSON.parse(b.recipient_wrapped_key),
        contentHash: b.content_hash,
        sizeBytes: b.size_bytes,
      })),
      survivorAlias: s.survivor_alias,
      // No sealed-match information here: attorneys never see match status or counts. Matches go only to a
      // verified Legal Options Counselor (see /api/counselor/groups).
    };
    const when = new Date().toISOString();
    audit(me.id, 'share.opened', `Opened shared case file (share ${s.id})`);
    audit(s.survivor_id, 'attorney.opened_share', `${attorneyLabel(me.id)} opened your shared case file at ${when}`);
    res.json(bundle);
  });

  app.post('/api/shares/:id/renew', auth, survivorOnly, (req, res) => {
    const me = req.user!;
    const s = q.shareById.get(parse(S.id, req.params.id)) as ShareRow | undefined;
    if (!s) throw new HttpError(404, 'share_not_found', 'Share not found.');
    if (s.survivor_id !== me.id) throw new HttpError(403, 'forbidden', 'You can only renew your own shares.');
    if (s.status === 'revoked') throw new HttpError(409, 'already_revoked', 'A revoked share cannot be renewed. Create a new share.');
    const { expiresInDays } = parse(S.renewShareRequest, req.body ?? {});
    const expiresAt = addDays(Date.now(), expiresInDays ?? DEFAULT_SHARE_DAYS);
    let ledgerEntry!: LedgerEntry;
    db.transaction(() => {
      ledgerEntry = appendLedger(db, 'share.renewed', s.id, sha256Hex(JSON.stringify({ shareId: s.id, expiresAt })));
      db.prepare('UPDATE shares SET expires_at = ? WHERE id = ?').run(expiresAt, s.id);
      audit(me.id, 'share.renewed', `You renewed access for ${attorneyLabel(s.attorney_id)} until ${expiresAt.slice(0, 10)}`);
      audit(s.attorney_id, 'share.renewed_by_survivor', `A survivor ("${s.survivor_alias}") renewed your access to a case file`);
    })();
    res.json({ share: toShare(q.shareById.get(s.id) as ShareRow), ledgerEntry });
  });

  app.post('/api/shares/:id/revoke', auth, survivorOnly, (req, res) => {
    const me = req.user!;
    const s = q.shareById.get(parse(S.id, req.params.id)) as ShareRow | undefined;
    if (!s) throw new HttpError(404, 'share_not_found', 'Share not found.');
    if (s.survivor_id !== me.id) throw new HttpError(403, 'forbidden', 'You can only revoke your own shares.');
    if (s.status === 'revoked') throw new HttpError(409, 'already_revoked', 'This share is already revoked.');
    let ledgerEntry!: LedgerEntry;
    db.transaction(() => {
      const revokedAt = new Date().toISOString();
      ledgerEntry = appendLedger(
        db,
        'share.revoked',
        s.id,
        sha256Hex(JSON.stringify({ shareId: s.id, status: 'revoked', revokedAt })),
        revokedAt,
      );
      db.prepare(`UPDATE shares SET status = 'revoked', revoked_at = ? WHERE id = ?`).run(revokedAt, s.id);
      audit(me.id, 'share.revoked', `You revoked access for ${attorneyLabel(s.attorney_id)}`);
      audit(s.attorney_id, 'share.revoked_by_survivor', `A survivor ("${s.survivor_alias}") revoked your access to a case file`);
    })();
    res.json({ share: toShare(q.shareById.get(s.id) as ShareRow), ledgerEntry });
  });

  // ════════════ sealed matching (Callisto-style) ════════════
  /*
   * Protocol: packages/crypto/src/matching.ts. The server stores, per survivor and per perpetrator identifier:
   *   tag π (pseudorandom, from a split-key VOPRF), the encrypted contact bundle, her own encrypted label, and one
   *   seal per counselor holding {π, x, y, ce}. It never sees identifiers, their hashes, or anything it can open.
   *
   * Threshold 2: a tag is MATCHED when entries from 2 distinct survivor accounts exist (one entry per account per
   * tag: UNIQUE(user_id, tag), so a survivor cannot match herself). Only matched groups are ever released, and only
   * to verified counselors, each receiving only the seals addressed to them. Unmatched entries are never served to
   * anyone but their owner, and only after the release delay. This MITIGATES (does not close) the "counselor + OPRF
   * guessing" gap (research A7): a counselor never holds a single-survivor seal to test guesses against and cannot call
   * the OPRF, but a counselor colluding with a Sybil survivor account can still seal a guess and wait for a group.
   * Residual risk: Sybil + counselor collusion — needs account-level Sybil resistance before real use.
   *
   * Anti-self-check: survivors ALWAYS see 'sealed' (no matchedAt, no tag), her audit trail never mentions a match or
   * a counselor viewing it, and no ledger entry is written at match time — each submission appends exactly one
   * 'escrow.sealed' entry, whose content hash is over the (random) bundle ciphertext, not the tag.
   */
  const ageRow = db.prepare('SELECT age_confirmed_18 FROM users WHERE id = ?');
  const verifiedAdultSurvivor = (req: Request, _res: Response, next: NextFunction) => {
    if (req.user?.role !== 'survivor') throw new HttpError(403, 'forbidden_role', 'Only survivor accounts can do this');
    const r = ageRow.get(req.user.id) as { age_confirmed_18: number } | undefined;
    if (r?.age_confirmed_18 !== 1)
      throw new HttpError(403, 'age_not_confirmed', 'Sealed matching is only for accounts that have confirmed they are 18 or older.');
    next();
  };

  /**
   * The org-signed counselor roster (npm run -w @matra/server sign-roster), if one has been stored. The server does not
   * hold the org key and cannot change the roster without invalidating its signature; clients built with the pinned
   * roster key seal only to counselors listed in it. When present, it is also authoritative here: only verified
   * counselors who are ALSO listed are offered, accepted as seal recipients, and keep their seals.
   */
  const signedRoster = (): SignedCounselorRoster | undefined => {
    const v = meta('counselor_roster');
    return v ? (JSON.parse(v) as SignedCounselorRoster) : undefined;
  };
  const rosterIds = (): Set<string> | null => {
    const r = signedRoster();
    if (!r) return null;
    try {
      return new Set((JSON.parse(r.payload) as CounselorRosterPayload).counselors.map((c) => c.userId));
    } catch {
      return new Set();
    }
  };
  const sealableCounselors = (): CounselorProfileRow[] => {
    const ids = rosterIds();
    return (q.verifiedCounselors.all() as CounselorProfileRow[]).filter((c) => !ids || ids.has(c.user_id));
  };
  /** Seals addressed to counselors who are no longer verified (or no longer on the signed roster) are deleted (M6). */
  const pruneSeals = () => {
    const keep = sealableCounselors().map((c) => c.user_id);
    db.prepare(`DELETE FROM match_seals WHERE counselor_id NOT IN (SELECT value FROM json_each(?))`).run(JSON.stringify(keep));
  };
  /** Groups (and all their counselor notes) with no entries left are deleted; notes about deleted entries too (L3). */
  const pruneGroups = () => {
    db.prepare(
      `DELETE FROM counselor_notes WHERE group_id IN (SELECT g.id FROM match_groups g WHERE NOT EXISTS (SELECT 1 FROM match_entries e WHERE e.tag = g.tag))
          OR (entry_id IS NOT NULL AND entry_id NOT IN (SELECT id FROM match_entries))`,
    ).run();
    db.prepare(
      'DELETE FROM conflict_checks WHERE group_id IN (SELECT g.id FROM match_groups g WHERE NOT EXISTS (SELECT 1 FROM match_entries e WHERE e.tag = g.tag))',
    ).run();
    db.prepare('DELETE FROM match_groups WHERE NOT EXISTS (SELECT 1 FROM match_entries e WHERE e.tag = match_groups.tag)').run();
  };
  pruneSeals();
  pruneGroups();

  // ── matcher service (src/matcher-client.ts; W15, W18). Every sealed entry is forwarded to the matcher with: its tag, a
  // pseudonymous survivor reference (HMAC of the tag and the account id under the pepper: the matcher counts distinct
  // survivors per tag without user ids, and cannot link one survivor's entries across tags), its time, the HOUR her account was created (Sybil signals), and her routing tag, which only the
  // matcher can open. Forwarding happens after the response, on one serialized sync loop (also at startup, every
  // minute, and before counselors read their groups); entries stay matcher_synced = 0 until the matcher has them, and
  // withdrawals wait in matcher_pending_deletes. Nothing is forwarded while the matcher's attestation fails.
  const survivorRef = (tag: string, userId: string) => createHmac('sha256', pepper).update(`matcher-ref|${tag}|${userId}`).digest('hex');
  const toHour = (iso: string) => new Date(Math.floor(Date.parse(iso) / 3_600_000) * 3_600_000).toISOString();
  const unsyncedEntries = db.prepare(
    `SELECT e.id, e.user_id, e.tag, e.created_at, e.routing_envelope, u.created_at AS account_created_at
       FROM match_entries e JOIN users u ON u.id = e.user_id WHERE e.matcher_synced = 0 ORDER BY e.created_at ASC, e.rowid ASC`,
  );
  const markSynced = db.prepare('UPDATE match_entries SET matcher_synced = 1 WHERE id = ?');
  const queueMatcherDelete = db.prepare('INSERT OR IGNORE INTO matcher_pending_deletes (entry_id) VALUES (?)');
  const pendingDeletes = db.prepare('SELECT entry_id FROM matcher_pending_deletes');
  const donePendingDelete = db.prepare('DELETE FROM matcher_pending_deletes WHERE entry_id = ?');
  /** What the matcher needs to know about counselors: the signed roster (if any), who is verified, and (unpinned dev) states. */
  const matcherRoster = (): MatcherRosterInput => {
    const list = sealableCounselors();
    const roster = signedRoster();
    return {
      ...(roster && { roster }),
      verifiedIds: list.map((c) => c.user_id),
      counselors: list.map((c) => ({ userId: c.user_id, licensedStates: JSON.parse(c.jurisdictions) as string[] })),
    };
  };
  let lastRosterSent = '';
  const syncOnce = async () => {
    if (!(await matcherGate.ok())) return;
    const step = async (what: string, fn: () => Promise<void>) => {
      try {
        await fn();
        return true;
      } catch (e) {
        console.warn(`[matra] matcher sync (${what}) failed: ${(e as Error).message}`);
        return false;
      }
    };
    const roster = matcherRoster();
    const rosterKey = JSON.stringify(roster);
    if (rosterKey !== lastRosterSent && (await step('roster', () => matcher.putRoster(roster)))) lastRosterSent = rosterKey;
    for (const { entry_id } of pendingDeletes.all() as Array<{ entry_id: string }>) {
      if (!(await step('withdrawal', () => matcher.removeEntry(entry_id)))) return;
      donePendingDelete.run(entry_id);
    }
    type Unsynced = { id: string; user_id: string; tag: string; created_at: string; routing_envelope: string | null; account_created_at: string };
    for (const e of unsyncedEntries.all() as Unsynced[]) {
      const sent = await step('entry', () =>
        matcher.upsertEntry({
          entryId: e.id,
          tag: e.tag,
          survivorRef: survivorRef(e.tag, e.user_id),
          createdAt: e.created_at,
          accountCreatedAt: toHour(e.account_created_at),
          routing: e.routing_envelope ? JSON.parse(e.routing_envelope) : null,
        }),
      );
      if (!sent) return;
      markSynced.run(e.id);
    }
  };
  let syncChain: Promise<void> = Promise.resolve();
  /** Run one sync after any in flight (serialized; never throws). */
  const syncMatcher = (): Promise<void> => (syncChain = syncChain.then(syncOnce, syncOnce).catch(() => undefined));
  // The matcher may have lost state (an in-memory matcher, a restore): resend every entry once at startup (idempotent).
  db.prepare('UPDATE match_entries SET matcher_synced = 0').run();
  setImmediate(() => void syncMatcher());
  setInterval(() => void syncMatcher(), 60_000).unref();
  app.locals.syncMatcher = syncMatcher;
  app.locals.matcherGateReset = () => matcherGate.reset();

  // ── phone verify-then-forget (W13, W19; src/sms.ts). Pending challenges live only in this Map, for 10 minutes: the
  // raw number is in memory just long enough for the provider's check call, and never written anywhere.
  const requirePhone = opts.matching?.requirePhoneVerification ?? true;
  const phoneOpt = opts.matching?.phone ?? {};
  const sms: SmsVerifier = phoneOpt.verifier ?? new MockSmsVerifier();
  const phoneHashKey = phoneOpt.hashKey ?? new Uint8Array(randomBytes(32));
  const maxAccountsPerPhone = phoneOpt.maxAccountsPerPhone ?? 2;
  const exposeDemoCode = phoneOpt.exposeDemoCode ?? (sms.name === 'mock' && process.env.NODE_ENV !== 'production');
  const allowedCountryCodes = phoneOpt.allowedCountryCodes ?? ['1'];
  const sendLimits: PhoneSendLimits = { ...PHONE_SEND_LIMITS, ...phoneOpt.sendLimits };
  const MAX_CODE_ATTEMPTS = 5;
  const challenges = new Map<string, { userId: string; phoneE164: string; providerRef: string; expiresAt: number; attempts: number }>();
  const sweepChallenges = () => {
    const now = Date.now();
    for (const [k, c] of challenges) if (c.expiresAt <= now) challenges.delete(k);
  };
  // Every send costs money (Verify + a Lookup query), so sends are capped per account, per (account, phone), per client
  // IP and globally (SMS pumping / toll fraud). In memory only; keys are never the raw number or the raw IP: the IP is
  // HMACed under a daily salt that is never written anywhere (privacy.ts ClientKeyer). The per-phone limit is per ACCOUNT on purpose:
  // a cross-account per-phone limit would tell an attacker that someone else asked for codes for that number, and let
  // anyone who knows her number lock her out. Twilio's own per-number limits still apply (→ 429, see sms.ts).
  const smsStartPerAccount = new RateLimiter(sendLimits.perAccountPerDay, 24 * 3_600_000);
  const smsStartPerAccountPhone = new RateLimiter(sendLimits.perAccountPhonePerHour, 3_600_000);
  const smsStartPerIp = clients.limiter(sendLimits.perIpPerHour, 3_600_000);
  const smsGlobalHour = new RateLimiter(sendLimits.globalPerHour, 3_600_000);
  const smsGlobalDay = new RateLimiter(sendLimits.globalPerDay, 24 * 3_600_000);
  // Housekeeping (W11): drop what has expired even when no request arrives, so an idle server keeps no abandoned session
  // row (its created_at is a sign-in time), no expired challenge (a raw number) and no expired limiter key (the
  // (account, phone token) pair is the very link W19 keeps off disk). Unref'd; errors (a closed test DB) are ignored.
  const memoryLimiters = [smsStartPerAccount, smsStartPerAccountPhone, smsGlobalHour, smsGlobalDay];
  const housekeeping = () => {
    try {
      purgeExpiredSessions(db);
    } catch {
      /* DB closed */
    }
    sweepChallenges();
    sweepResetTokens();
    for (const l of memoryLimiters) l.sweep();
  };
  housekeeping();
  setInterval(housekeeping, HOUSEKEEPING_INTERVAL_MS).unref();
  app.locals.housekeeping = housekeeping;
  const matchingVerifiedRow = db.prepare('SELECT matching_verified FROM users WHERE id = ?');
  const isPhoneVerified = (userId: string) => (matchingVerifiedRow.get(userId) as { matching_verified: number } | undefined)?.matching_verified === 1;
  /** Adult survivor AND (phone verified, or verification turned off in development). Replaces verifiedAdultSurvivor on
   *  the routes that create sealed entries. Listing, config and withdrawal stay open so the UI can explain. */
  const requireMatchingEligible = (req: Request, res: Response, next: NextFunction) =>
    verifiedAdultSurvivor(req, res, () => {
      if (requirePhone && !isPhoneVerified(req.user!.id))
        throw new HttpError(403, 'phone_not_verified', 'Please confirm a phone number before using a sealed match.');
      next();
    });

  app.get('/api/matching/verification', auth, survivorOnly, (req, res) => {
    res.json({ required: requirePhone, verified: isPhoneVerified(req.user!.id) });
  });

  app.post('/api/matching/verification/start', auth, verifiedAdultSurvivor, async (req, res) => {
    const me = req.user!;
    const { phone } = parse(S.phoneVerificationStart, req.body);
    const n = normalizeMatchIdentifier('phone', phone);
    if (!n.ok || n.kind !== 'phone')
      throw new HttpError(400, 'phone_invalid', 'We couldn’t read that as a phone number. Please check it, including the area code.');
    const e164 = n.canonical.slice('phone:'.length);
    // E.164 country calling codes are prefix-free, so a prefix test is exact. Checked before any limit or provider call.
    if (!allowedCountryCodes.some((cc) => e164.startsWith(`+${cc}`)))
      throw new HttpError(400, 'phone_not_supported', 'We can’t send codes to numbers in this country yet. Please use a US or Canadian mobile number.');
    if (
      !smsStartPerAccount.hit(me.id) ||
      !smsStartPerAccountPhone.hit(`${me.id}|${phoneToken(phoneHashKey, e164)}`) ||
      !smsStartPerIp.hit(clients.key(req))
    )
      throw new HttpError(429, 'rate_limited', 'We’ve sent several codes already. Please wait a while and try again.');
    // Global caps last, so only sends that passed every other check count against them.
    if (!smsGlobalHour.hit('all') || !smsGlobalDay.hit('all'))
      throw new HttpError(503, 'sms_unavailable', 'Phone confirmation is busy right now. Please try again later.');
    sweepChallenges();
    let started: Awaited<ReturnType<SmsVerifier['start']>>;
    try {
      started = await sms.start(e164);
    } catch (e) {
      if (e instanceof SmsError)
        throw new HttpError(e.code === 'phone_not_supported' ? 400 : e.code === 'rate_limited' ? 429 : 503, e.code, e.message);
      throw e;
    }
    const challengeId = newId();
    const expiresAt = Date.now() + SMS_CODE_TTL_MS;
    challenges.set(challengeId, { userId: me.id, phoneE164: e164, providerRef: started.providerRef, expiresAt, attempts: 0 });
    res.json({ challengeId, expiresAt: new Date(expiresAt).toISOString(), ...(exposeDemoCode && started.demoCode && { demoCode: started.demoCode }) });
  });

  // Phone tokens are NOT written in the same transaction as her account flag (W19). One commit touching both would put
  // the token's page and her users page side by side in the WAL, which a copy of the volume could line up. Instead the
  // count is buffered here (in memory, like the challenge) and flushed in its own transaction at a random 10–60 min
  // later, with other verifications' tokens, followed by a TRUNCATE checkpoint. The account limit counts the buffer too.
  // Lost on a crash (a phone could then enable one account more than the limit); flushed on shutdown (index.ts).
  const phoneTokenGet = db.prepare('SELECT accounts FROM phone_tokens WHERE token_hash = ?');
  const phoneTokenAdd = db.prepare(
    'INSERT INTO phone_tokens (token_hash, accounts) VALUES (?, ?) ON CONFLICT (token_hash) DO UPDATE SET accounts = accounts + excluded.accounts',
  );
  const pendingTokens = new Map<string, number>();
  const [flushMin, flushMax] = phoneOpt.tokenFlushDelayMs ?? [10 * 60_000, 60 * 60_000];
  let flushTimer: NodeJS.Timeout | undefined;
  const checkpoint = () => {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // best effort: a busy checkpoint just leaves the frames for the next one
    }
  };
  const flushPhoneTokens = () => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = undefined;
    if (!pendingTokens.size) return;
    // sorted, so the order of rows in the commit says nothing about the order of verifications
    const batch = [...pendingTokens].sort(([a], [b]) => (a < b ? -1 : 1));
    db.transaction(() => {
      for (const [token, n] of batch) phoneTokenAdd.run(token, n);
    })();
    pendingTokens.clear();
    checkpoint();
  };
  const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(flushPhoneTokens, flushMin + randomInt(0, Math.max(1, flushMax - flushMin + 1)));
    flushTimer.unref();
  };
  app.locals.flushPhoneTokens = flushPhoneTokens;

  app.post('/api/matching/verification/check', auth, verifiedAdultSurvivor, async (req, res) => {
    const me = req.user!;
    const body = parse(S.phoneVerificationCheck, req.body);
    const c = challenges.get(body.challengeId);
    const expired = () => new HttpError(400, 'code_expired', 'This code has expired. Please ask for a new one.');
    if (!c || c.userId !== me.id) throw expired();
    if (c.expiresAt <= Date.now()) {
      challenges.delete(body.challengeId);
      throw expired();
    }
    // Charge the attempt BEFORE the provider call, so concurrent checks beyond the cap never reach it.
    if (c.attempts >= MAX_CODE_ATTEMPTS) {
      challenges.delete(body.challengeId);
      throw new HttpError(400, 'code_expired', 'That code didn’t match, too many times. Please ask for a new one.');
    }
    c.attempts++;
    let result: Awaited<ReturnType<SmsVerifier['check']>>;
    try {
      result = await sms.check(c.providerRef, c.phoneE164, body.code);
    } catch (e) {
      if (e instanceof SmsError) throw new HttpError(503, 'sms_unavailable', e.message);
      throw e;
    }
    if (result === 'expired') {
      challenges.delete(body.challengeId);
      throw expired();
    }
    if (result === 'wrong_code') {
      if (c.attempts >= MAX_CODE_ATTEMPTS) {
        challenges.delete(body.challengeId);
        throw new HttpError(400, 'code_expired', 'That code didn’t match, too many times. Please ask for a new one.');
      }
      throw new HttpError(400, 'code_invalid', 'That code didn’t match. Please check it and try again.');
    }
    // Approved: forget the number now, whatever happens next. The limit is checked only after she has proved control
    // of the phone, so it can't be used to test whether someone else's number has been used to verify.
    challenges.delete(body.challengeId);
    if (isPhoneVerified(me.id)) return res.json({ verified: true }); // already verified: don't use up a slot on this phone
    const token = phoneToken(phoneHashKey, c.phoneE164);
    const used = ((phoneTokenGet.get(token) as { accounts: number } | undefined)?.accounts ?? 0) + (pendingTokens.get(token) ?? 0);
    if (used >= maxAccountsPerPhone)
      throw new HttpError(
        409,
        'phone_limit_reached',
        'This phone number has already been used to turn on sealed matching for as many accounts as we allow. Please try a different number.',
      );
    pendingTokens.set(token, (pendingTokens.get(token) ?? 0) + 1);
    scheduleFlush();
    // Only the flag, in its own commit, then checkpointed out of the WAL. No audit event: a timestamped row for her
    // account would line up with the SMS provider's (number, time) record (W19). The page shows her the flag instead.
    db.prepare('UPDATE users SET matching_verified = 1 WHERE id = ?').run(me.id);
    checkpoint();
    res.json({ verified: true });
  });

  // The matcher's attestation, proxied so the browser keeps connect-src 'self'. Public (it says nothing about anyone);
  // rate-limited per client (keyed by a daily-salted HMAC of the IP, in memory only). Her client verifies it before sealing.
  const attestationLimiter = clients.limiter(60, 60_000);
  app.get('/api/matching/attestation', async (req, res) => {
    const { nonce } = parse(S.attestationQuery, req.query);
    if (!attestationLimiter.hit(clients.key(req))) throw new HttpError(429, 'rate_limited', 'Too many requests. Please wait a minute and try again.');
    let doc;
    try {
      doc = await matcher.attestation(nonce);
    } catch {
      throw new HttpError(503, 'matcher_unavailable', 'Sealed matching isn’t available right now.');
    }
    res.json(doc);
  });

  app.get('/api/matching/config', auth, verifiedAdultSurvivor, (_req, res) => {
    pruneSeals();
    const roster = signedRoster();
    const config: MatchingConfig = {
      threshold: 2,
      oprf: { suite: 'ristretto255-SHA512', mode: 'voprf', t: holders.t, m: holders.m, groupPublicKey, holders: holders.publicKeys() },
      counselors: sealableCounselors().map(toCounselorProfile),
      limits: { perDay: limits.perDay, lifetime: limits.lifetime },
      keyEpoch,
      ...(roster && { roster }),
    };
    res.json(config);
  });

  // One evaluation endpoint per key holder i (in-process, or proxied to holder i's own process). The browser only
  // talks to this origin; this server sees blinded elements and evaluations, never identifiers or OPRF outputs.
  const holderIndex = (req: Request) => {
    const i = Number(req.params.index);
    if (!Number.isInteger(i) || i < 1 || i > holders.m) throw new HttpError(404, 'not_found', 'No such key holder.');
    return i;
  };
  app.get('/api/matching/oprf/:index/key', (req, res) => {
    const i = holderIndex(req);
    res.json(holders.publicKeys()[i - 1]);
  });
  // Quota: the ACCOUNT is charged once per distinct blinded element (first call, any holder) before anything is relayed,
  // so sending each guess to a different t-subset of holders does not multiply her budget; each holder also counts its
  // own calls (a backstop, and the only count a remote holder can keep).
  const rateLimited = (code: 'rate_limited_daily' | 'rate_limited_lifetime') =>
    new HttpError(
      429,
      code,
      code === 'rate_limited_daily'
        ? 'You’ve sealed as many identifiers as we allow in one day. You can add more tomorrow.'
        : 'This account has reached the limit for sealed identifiers.',
    );
  app.post('/api/matching/oprf/:index', auth, requireMatchingEligible, async (req, res) => {
    const i = holderIndex(req);
    const { blinded } = parse(S.oprfEvaluateRequest, req.body);
    if (!isOprfElement(fromBase64(blinded))) throw new HttpError(400, 'invalid_request', 'blinded is not a valid group element'); // not counted
    const charged = accountBudget.charge(req.user!.id, blinded);
    if (!charged.ok) throw rateLimited(charged.code);
    const r = await holders.evaluate(i, req.user!.id, blinded);
    if (!r.ok) {
      if (r.code === 'invalid_element') throw new HttpError(400, 'invalid_request', 'blinded is not a valid group element');
      if (r.code === 'holder_unavailable') throw new HttpError(503, 'holder_unavailable', 'This key holder is not available right now.');
      throw rateLimited(r.code);
    }
    res.json(r.response);
  });

  const ownEntries = db.prepare(
    `SELECT e.*, (SELECT json_group_array(counselor_id) FROM match_seals s WHERE s.entry_id = e.id) AS counselor_ids
       FROM match_entries e WHERE e.user_id = ? ORDER BY e.created_at DESC, e.rowid DESC`,
  );
  const ownEntryCount = db.prepare('SELECT COUNT(*) AS n FROM match_entries WHERE user_id = ? AND id IS NOT ?');
  const ownEntryForTag = db.prepare('SELECT 1 FROM match_entries WHERE user_id = ? AND tag = ? AND id IS NOT ?');
  const checkSealRecipients = (seals: Array<{ counselorId: string }>) => {
    const ids = rosterIds();
    for (const seal of seals) {
      const c = q.counselorProfileByUser.get(seal.counselorId) as CounselorProfileRow | undefined;
      if (!c) throw new HttpError(404, 'counselor_not_found', 'Counselor not found.');
      if (c.verified !== 1) throw new HttpError(403, 'counselor_not_verified', 'This counselor has not been verified.');
      if (ids && !ids.has(c.user_id)) throw new HttpError(403, 'counselor_not_listed', 'This counselor is not on the signed counselor list.');
    }
  };
  // ── ending a report release on her behalf (staged release, below). Each one is a report.revoked ledger row, like her
  // own revoke, plus a calm line in her trail so she knows; she has nothing to do. Expired releases are left as they are.
  type LiveReleaseRef = { id: string; survivor_id: string; counselor_id: string };
  const liveReleasesForEntry = db.prepare(
    `SELECT rel.id, rel.survivor_id, rel.counselor_id FROM report_releases rel JOIN report_requests r ON r.id = rel.request_id
      WHERE r.entry_id = ? AND rel.status = 'active' AND rel.expires_at > ?`,
  );
  const liveReleasesInGroup = db.prepare(
    `SELECT rel.id, rel.survivor_id, rel.counselor_id FROM report_releases rel JOIN report_requests r ON r.id = rel.request_id
      WHERE r.group_id = ? AND rel.counselor_id = ? AND rel.status = 'active' AND rel.expires_at > ?`,
  );
  const revokeHash = (releaseId: string, reason: ReportRevokeReason, revokedAt: string) =>
    sha256Hex(JSON.stringify({ releaseId, status: 'revoked', reason, revokedAt }));
  const ENDED_FOR_HER: Record<Exclude<ReportRevokeReason, 'survivor'>, string> = {
    conflict: 'they can’t take on this matter, so Matra ended their access. You don’t need to do anything.',
    resealed: 'your sealed match moved to new matching keys, so Matra ended this access. You don’t need to do anything.',
    withdrawn: 'you withdrew the sealed identifier it was about.',
  };
  const endRelease = (rel: LiveReleaseRef, reason: Exclude<ReportRevokeReason, 'survivor'>, revokedAt: string) => {
    appendLedger(db, 'report.revoked', rel.id, revokeHash(rel.id, reason, revokedAt), revokedAt);
    db.prepare(`UPDATE report_releases SET status = 'revoked', revoked_at = ?, revoke_reason = ? WHERE id = ?`).run(revokedAt, reason, rel.id);
    audit(rel.survivor_id, 'report.revoked', `Your report is no longer shared with ${counselorLabel(rel.counselor_id)}: ${ENDED_FOR_HER[reason]}`);
    audit(rel.counselor_id, 'counselor.release_revoked', 'Your access to a report a survivor shared with you has ended');
  };
  /** The entry row and its seals only (a re-seal keeps its request history; see below). */
  const dropEntry = (entryId: string) => {
    db.prepare('DELETE FROM match_seals WHERE entry_id = ?').run(entryId);
    db.prepare('DELETE FROM match_entries WHERE id = ?').run(entryId);
    queueMatcherDelete.run(entryId);
  };
  /** Withdrawal: her report requests and releases about this entry go with it (the counselor sees them vanish). */
  const deleteEntry = (entryId: string) => {
    // a live release ends first, with its own report.revoked ledger row (the ledger keeps only hashes)
    const ts = new Date().toISOString();
    for (const rel of liveReleasesForEntry.all(entryId, ts) as LiveReleaseRef[]) endRelease(rel, 'withdrawn', ts);
    db.prepare(
      'DELETE FROM report_release_blobs WHERE release_id IN (SELECT id FROM report_releases WHERE request_id IN (SELECT id FROM report_requests WHERE entry_id = ?))',
    ).run(entryId);
    db.prepare('DELETE FROM report_releases WHERE request_id IN (SELECT id FROM report_requests WHERE entry_id = ?)').run(entryId);
    db.prepare('DELETE FROM report_requests WHERE entry_id = ?').run(entryId);
    dropEntry(entryId);
  };
  /**
   * A re-seal (key epoch bump) replaces her entry with a new id. Her request history moves to the new entry, so a no
   * stays a no and a yes is not silently lost. Same tag (same OPRF key): same group, same counselor, so releases and
   * notes carry on. New tag (rotated OPRF key): a new group, possibly another counselor, so Matra ends her live
   * releases (ledgered, with a line in her trail) and cancels pending requests; she can be asked again in the new group
   * only if she never said no.
   */
  const reSealEntry = (old: MatchEntryRow, newEntryId: string, newTag: string, ts: string) => {
    if (old.tag !== newTag) {
      for (const rel of liveReleasesForEntry.all(old.id, ts) as LiveReleaseRef[]) endRelease(rel, 'resealed', ts);
      db.prepare(`UPDATE report_requests SET status = 'cancelled', decided_at = ? WHERE entry_id = ? AND status = 'pending'`).run(ts, old.id);
    } else {
      db.prepare('UPDATE counselor_notes SET entry_id = ? WHERE entry_id = ?').run(newEntryId, old.id);
    }
    db.prepare('UPDATE report_requests SET entry_id = ? WHERE entry_id = ?').run(newEntryId, old.id);
    dropEntry(old.id);
  };
  const markMatched = db.prepare(
    `INSERT OR IGNORE INTO match_groups (id, tag, matched_at)
     SELECT ?, ?, ? WHERE (SELECT COUNT(DISTINCT user_id) FROM match_entries WHERE tag = ?) >= 2`,
  );

  app.post('/api/matching/entries', auth, requireMatchingEligible, (req, res) => {
    const me = req.user!;
    const body = parse(S.createMatchEntryRequest, req.body);
    checkSealRecipients(body.seals);
    const replaces = body.replacesEntryId ?? null;
    const old = replaces ? (q.matchEntryById.get(replaces) as MatchEntryRow | undefined) : undefined;
    if (replaces && (!old || old.user_id !== me.id)) throw new HttpError(404, 'entry_not_found', 'Entry not found.');
    // Only reveals HER OWN earlier submission for the same person.
    if (ownEntryForTag.get(me.id, body.tag, replaces)) throw new HttpError(409, 'already_sealed', 'You have already sealed this.');
    if ((ownEntryCount.get(me.id, replaces) as { n: number }).n >= limits.lifetime)
      throw new HttpError(429, 'rate_limited_lifetime', 'This account has reached the limit for sealed identifiers.');
    const id = newId();
    db.transaction(() => {
      const ts = new Date().toISOString();
      // a re-seal (after a key rotation) replaces her older entry atomically
      if (old) reSealEntry(old, id, body.tag, ts);
      const le = appendLedger(db, 'escrow.sealed', id, envelopeContentHash(body.bundle), ts);
      db.prepare(
        `INSERT INTO match_entries (id, user_id, tag, bundle, label_envelope, created_at, ledger_entry_id, key_epoch, routing_envelope, contact_bundle)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        me.id,
        body.tag,
        canonicalEnvelope(body.bundle),
        canonicalEnvelope(body.labelEnvelope),
        ts,
        le.id,
        keyEpoch,
        JSON.stringify(body.routing),
        canonicalEnvelope(body.contactBundle),
      );
      const ins = db.prepare('INSERT INTO match_seals (entry_id, counselor_id, seal) VALUES (?, ?, ?)');
      for (const seal of body.seals) ins.run(id, seal.counselorId, JSON.stringify(seal satisfies CounselorSeal));
      audit(me.id, 'escrow.created', replaces ? 'Re-sealed an identifier under the current matching keys' : 'Sealed an identifier for sealed matching');
      // Always executed, so a match takes the same code path as a miss (no branch/timing oracle in the handler).
      markMatched.run(newId(), body.tag, ts, body.tag);
      if (replaces) pruneGroups();
    })();
    // Forwarded to the matcher after the response, the same way for a match or a miss.
    void syncMatcher();
    res.status(201).json({ entry: toSurvivorEscrow(q.matchEntryById.get(id) as MatchEntryRow) });
  });

  const listOwn = (req: Request, res: Response) => {
    res.json({ entries: (ownEntries.all(req.user!.id) as MatchEntryRow[]).map(toSurvivorEscrow) });
  };
  app.get('/api/escrow', auth, listOwn); // kept for the Home screen / data export
  app.get('/api/matching/entries', auth, listOwn);

  /**
   * Add seals to one of HER entries for counselors who joined the (signed) roster after she sealed (M6). Owner only.
   * Existing seals are kept as they are. The response is the same whatever the entry's match state.
   */
  app.post('/api/matching/entries/:id/seals', auth, verifiedAdultSurvivor, (req, res) => {
    const me = req.user!;
    const e = q.matchEntryById.get(parse(S.id, req.params.id)) as MatchEntryRow | undefined;
    if (!e || e.user_id !== me.id) throw new HttpError(404, 'entry_not_found', 'Entry not found.');
    const body = parse(S.addMatchSealsRequest, req.body);
    checkSealRecipients(body.seals);
    const have = (db.prepare('SELECT COUNT(*) AS n FROM match_seals WHERE entry_id = ?').get(e.id) as { n: number }).n;
    if (have + body.seals.length > S.MAX_SEALS_PER_ENTRY) throw new HttpError(400, 'invalid_request', 'Too many counselors for one entry.');
    db.transaction(() => {
      const ins = db.prepare('INSERT OR IGNORE INTO match_seals (entry_id, counselor_id, seal) VALUES (?, ?, ?)');
      for (const seal of body.seals) ins.run(e.id, seal.counselorId, JSON.stringify(seal satisfies CounselorSeal));
    })();
    res.json({ entry: toSurvivorEscrow(q.matchEntryById.get(e.id) as MatchEntryRow) });
  });

  /** Withdraw: deletes her entry and its seals. If that leaves fewer than 2 survivors, the group is no longer released. */
  app.delete('/api/matching/entries/:id', auth, survivorOnly, (req, res) => {
    const me = req.user!;
    const e = q.matchEntryById.get(parse(S.id, req.params.id)) as MatchEntryRow | undefined;
    if (!e || e.user_id !== me.id) throw new HttpError(404, 'entry_not_found', 'Entry not found.');
    db.transaction(() => {
      deleteEntry(e.id);
      pruneGroups();
      audit(me.id, 'escrow.withdrawn', 'You withdrew a sealed identifier. It was deleted.');
    })();
    void syncMatcher();
    res.json({ ok: true });
  });

  // ════════════ Legal Options Counselor ════════════
  const verifiedCounselor = (req: Request, _res: Response, next: NextFunction) => {
    const c = q.counselorProfileByUser.get(req.user!.id) as CounselorProfileRow | undefined;
    if (!c || c.verified !== 1)
      throw new HttpError(403, 'counselor_not_verified', 'Your counselor account has not been verified yet.');
    next();
  };
  /*
   * Release delay (review M2): an entry counts toward (and is shown in) a group only once it is releaseDelayMs old, so
   * a counselor (or anyone colluding with one) who seals a GUESS from a Sybil survivor account cannot learn within
   * minutes whether that guess matches someone. It slows guessing; it does not stop a patient Sybil — see
   * docs/threat-model.md.
   */
  const releaseCutoff = () => new Date(Date.now() - releaseDelayMs).toISOString();
  const releasedGroups = db.prepare(
    `SELECT g.id, g.tag, g.matched_at FROM match_groups g
      WHERE (SELECT COUNT(DISTINCT e.user_id) FROM match_entries e WHERE e.tag = g.tag AND e.created_at <= ?) >= 2
      ORDER BY g.matched_at ASC, g.rowid ASC`,
  );
  const groupById = db.prepare('SELECT id, tag, matched_at FROM match_groups WHERE id = ?');
  // UNIQUE(user_id, tag) ⇒ every entry of a group comes from a different survivor. user_id is never returned.
  const groupEntriesFor = db.prepare(
    `SELECT e.id, e.created_at, e.bundle, e.contact_bundle, s.seal FROM match_entries e
       JOIN match_seals s ON s.entry_id = e.id AND s.counselor_id = ?
      WHERE e.tag = ? AND e.created_at <= ? ORDER BY e.created_at ASC, e.rowid ASC`,
  );
  const notesFor = db.prepare('SELECT * FROM counselor_notes WHERE group_id = ? AND counselor_id = ? ORDER BY created_at ASC, rowid ASC');
  type AssignmentRow = { tag: string; counselor_id: string; reason: string; assigned_at: string; signals: string; signature: string | null };
  const assignmentFor = db.prepare('SELECT * FROM match_assignments WHERE tag = ? AND counselor_id = ?');
  /**
   * Refresh the cached assignments from the matcher. If it can't be reached (or doesn't attest), the cache stays as it
   * was: groups already released stay visible to their counselor, and NEW groups wait (fail closed).
   */
  const refreshAssignments = async () => {
    await syncMatcher();
    if (!(await matcherGate.ok())) return;
    let list;
    try {
      list = await matcher.assignments();
    } catch (e) {
      console.warn(`[matra] matcher assignments unavailable (${(e as Error).message}); using the cached ones.`);
      return;
    }
    db.transaction(() => {
      db.prepare('DELETE FROM match_assignments').run();
      const ins = db.prepare('INSERT INTO match_assignments (tag, counselor_id, reason, assigned_at, signals, signature) VALUES (?, ?, ?, ?, ?, ?)');
      for (const a of list) ins.run(a.tag, a.counselorId, a.reason, a.assignedAt, JSON.stringify(a.signals), a.signature || null);
    })();
  };

  type GroupRow = { id: string; tag: string; matched_at: string };
  // ── staged release (W1, W21). Stage 1: the summary bundles (identifier, states, contact methods). Stage 1b: once SHE
  // has recorded a clear conflict check for the group, each entry's contact ciphertext too. That gate is this server's
  // (it withholds the ciphertext); a counselor colluding with the operator could skip it (W21). Stage 2: report
  // requests, and only a survivor's own yes releases her report (below).
  const conflictFor = db.prepare('SELECT result, created_at FROM conflict_checks WHERE group_id = ? AND counselor_id = ?');
  const requestsForGroup = db.prepare(
    `SELECT r.*, rel.id AS release_id, rel.status AS release_status, rel.expires_at AS release_expires_at, rel.first_opened_at AS release_first_opened_at
       FROM report_requests r LEFT JOIN report_releases rel ON rel.request_id = r.id
      WHERE r.group_id = ? AND r.counselor_id = ? ORDER BY r.created_at ASC, r.rowid ASC`,
  );
  type RequestJoinRow = ReportRequestRow & {
    release_id: string | null;
    release_status: 'active' | 'revoked' | null;
    release_expires_at: string | null;
    release_first_opened_at: string | null;
  };
  const toCounselorRequest = (r: RequestJoinRow): CounselorReportRequest => ({
    id: r.id,
    groupId: r.group_id,
    entryId: r.entry_id,
    status: r.status,
    createdAt: r.created_at,
    ...(r.decided_at != null && { decidedAt: r.decided_at }),
    ...(r.release_id != null && {
      release: {
        id: r.release_id,
        status: r.release_status!,
        expiresAt: r.release_expires_at!,
        ...(r.release_first_opened_at != null && { firstOpenedAt: r.release_first_opened_at }),
      },
    }),
  });
  /** The group as released to `counselorId`: only if the matcher assigned it to her, and only entries past the delay. */
  const groupFor = (g: GroupRow, counselorId: string): CounselorMatchGroup | null => {
    const assigned = assignmentFor.get(g.tag, counselorId) as AssignmentRow | undefined;
    if (!assigned) return null;
    const check = conflictFor.get(g.id, counselorId) as { result: 'clear' | 'conflict'; created_at: string } | undefined;
    if (check?.result === 'conflict') return null;
    const clear = check?.result === 'clear';
    const rows = groupEntriesFor.all(counselorId, g.tag, releaseCutoff()) as Array<{
      id: string;
      created_at: string;
      bundle: string;
      contact_bundle: string | null;
      seal: string;
    }>;
    const entries = rows.map((e) => ({
      entryId: e.id,
      createdAt: e.created_at,
      bundle: JSON.parse(e.bundle),
      seal: JSON.parse(e.seal) as CounselorSeal,
      ...(clear && e.contact_bundle && { contactBundle: JSON.parse(e.contact_bundle) }),
    }));
    // A counselor needs two seals addressed to them to reconstruct; anything less is never released.
    if (entries.length < 2) return null;
    // Sybil signals (M2), computed by the matcher: accounts created within 24 h of each other, and entries sealed < 7
    // days after their account was created.
    const signals = JSON.parse(assigned.signals) as CounselorMatchGroup['signals'];
    const notes = (notesFor.all(g.id, counselorId) as Array<{ id: string; group_id: string; entry_id: string | null; envelope: string; created_at: string }>).map(
      (n): CounselorNote => ({
        id: n.id,
        groupId: n.group_id,
        ...(n.entry_id != null && { entryId: n.entry_id }),
        envelope: JSON.parse(n.envelope),
        createdAt: n.created_at,
      }),
    );
    const shown = new Set(entries.map((e) => e.entryId));
    const reportRequests = (requestsForGroup.all(g.id, counselorId) as RequestJoinRow[]).filter((r) => shown.has(r.entry_id)).map(toCounselorRequest);
    return {
      id: g.id,
      tag: g.tag,
      matchedAt: g.matched_at,
      entries,
      notes,
      signals,
      assignment: { reason: assigned.reason, assignedAt: assigned.assigned_at },
      ...(clear && { conflictCheck: { result: 'clear' as const, at: check.created_at } }),
      reportRequests,
    };
  };

  app.get('/api/counselor/groups', auth, counselorOnly, verifiedCounselor, async (req, res) => {
    const me = req.user!;
    pruneSeals();
    await refreshAssignments();
    const groups = (releasedGroups.all(releaseCutoff()) as GroupRow[]).map((g) => groupFor(g, me.id)).filter((g): g is CounselorMatchGroup => !!g);
    // Logged to the counselor's own trail only. Never to a survivor's: that would tell her (or a perpetrator posing
    // as a survivor) that a match exists.
    audit(me.id, 'counselor.viewed_matches', `Opened the matched groups list (${groups.length})`);
    res.json({ groups });
  });

  app.post('/api/counselor/groups/:id/notes', auth, counselorOnly, verifiedCounselor, (req, res) => {
    const me = req.user!;
    const g = groupById.get(parse(S.id, req.params.id)) as GroupRow | undefined;
    const released = g && groupFor(g, me.id);
    if (!g || !released) throw new HttpError(404, 'group_not_found', 'Group not found.');
    const body = parse(S.counselorNoteRequest, req.body);
    if (body.entryId && !released.entries.some((e) => e.entryId === body.entryId))
      throw new HttpError(404, 'entry_not_found', 'Entry not found in this group.');
    const note: CounselorNote = {
      id: newId(),
      groupId: g.id,
      ...(body.entryId && { entryId: body.entryId }),
      envelope: body.envelope,
      createdAt: new Date().toISOString(),
    };
    db.prepare('INSERT INTO counselor_notes (id, group_id, counselor_id, entry_id, envelope, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      note.id,
      g.id,
      me.id,
      body.entryId ?? null,
      canonicalEnvelope(body.envelope),
      note.createdAt,
    );
    audit(me.id, 'counselor.note_added', 'Added an encrypted outreach note');
    res.status(201).json({ note });
  });

  // ── conflict check (Stage 1 → 1b). Before she sees anyone's contact details, the assigned counselor checks the
  // identifier and states against her own conflicts records (outside Matra) and records the result here:
  //   'clear'    → the contact ciphertexts are included in her group from now on;
  //   'conflict' → the matcher reassigns the group with her excluded (for as long as the tag has entries), her pending
  //                report requests in it are cancelled, any report a survivor already released to her is revoked
  //                (ledgered; a line in that survivor's trail), and it never comes back to her.
  // Each result is a ledger row (hash of group, counselor, result and statement version) and a line in her own trail.
  // Never in a survivor's trail: that would tell her (or a perpetrator posing as a survivor) that a match exists.
  const recordConflictCheck = (g: GroupRow, counselorId: string, result: 'clear' | 'conflict', statementVersion: number) => {
    db.transaction(() => {
      const ts = new Date().toISOString();
      const le = appendLedger(db, 'counselor.conflict_checked', g.id, sha256Hex(`${g.id}|${counselorId}|${result}|${statementVersion}`), ts);
      db.prepare(
        `INSERT INTO conflict_checks (group_id, counselor_id, result, statement_version, created_at, ledger_entry_id) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (group_id, counselor_id) DO UPDATE SET result = excluded.result, statement_version = excluded.statement_version,
           created_at = excluded.created_at, ledger_entry_id = excluded.ledger_entry_id`,
      ).run(g.id, counselorId, result, statementVersion, ts, le.id);
      if (result === 'conflict') {
        db.prepare(`UPDATE report_requests SET status = 'cancelled', decided_at = ? WHERE group_id = ? AND counselor_id = ? AND status = 'pending'`).run(
          ts,
          g.id,
          counselorId,
        );
        // a conflict found after a survivor said yes: Matra ends that access for her, and tells her
        for (const rel of liveReleasesInGroup.all(g.id, counselorId, ts) as LiveReleaseRef[]) endRelease(rel, 'conflict', ts);
        audit(counselorId, 'counselor.declined_group', 'Declined a matched group (conflict of interest); the matcher passes it to another counselor');
      } else {
        audit(counselorId, 'counselor.conflict_checked', 'Recorded a conflict check for a matched group: no conflict');
      }
    })();
  };
  const declineGroup = async (g: GroupRow, counselorId: string) => {
    if (!(await matcherGate.ok())) throw new HttpError(503, 'matcher_unavailable', 'Declining isn’t available right now. Please try again later.');
    try {
      await matcher.decline(g.tag, counselorId);
    } catch (e) {
      if ((e as { status?: number }).status === 404) throw new HttpError(404, 'group_not_found', 'Group not found.');
      console.warn(`[matra] matcher decline failed: ${(e as Error).message}`);
      throw new HttpError(503, 'matcher_unavailable', 'Declining isn’t available right now. Please try again later.');
    }
    // never shown to her again, even if the refresh below can't reach the matcher
    db.prepare('DELETE FROM match_assignments WHERE tag = ? AND counselor_id = ?').run(g.tag, counselorId);
    recordConflictCheck(g, counselorId, 'conflict', 1);
    await refreshAssignments();
  };
  const releasedGroupOr404 = (req: Request): GroupRow => {
    const g = groupById.get(parse(S.id, req.params.id)) as GroupRow | undefined;
    if (!g || !groupFor(g, req.user!.id)) throw new HttpError(404, 'group_not_found', 'Group not found.');
    return g;
  };

  app.post('/api/counselor/groups/:id/conflict-check', auth, counselorOnly, verifiedCounselor, async (req, res) => {
    const me = req.user!;
    const g = releasedGroupOr404(req);
    const body = parse(S.conflictCheckRequest, req.body);
    if (body.result === 'conflict') await declineGroup(g, me.id);
    else if ((conflictFor.get(g.id, me.id) as { result: string } | undefined)?.result !== 'clear')
      recordConflictCheck(g, me.id, 'clear', body.statementVersion);
    res.json({ ok: true, result: body.result });
  });

  // The older "decline" action is a conflict check with result 'conflict' (same matcher call, ledger row and trail).
  app.post('/api/counselor/groups/:id/decline', auth, counselorOnly, verifiedCounselor, async (req, res) => {
    await declineGroup(releasedGroupOr404(req), req.user!.id);
    res.json({ ok: true });
  });

  // ── report requests (Stage 2). After a clear check, the counselor may ask ONE survivor in the group for her full
  // report, and only after confirming she has already spoken with her and she expects it (so a request is never her
  // first sign of a match: W1). One open request per (entry, counselor). After her no (a decline, or a release SHE
  // revoked) nobody can ask that entry again through Matra, whichever counselor holds the group later: a no is a no.
  // Her history follows the entry through re-seals (reSealEntry). Releases Matra ended for her are not a no.
  const requestById = db.prepare('SELECT * FROM report_requests WHERE id = ?');
  const requestsForEntry = db.prepare(
    `SELECT r.*, rel.status AS release_status, rel.expires_at AS release_expires_at, rel.revoke_reason AS release_revoke_reason
       FROM report_requests r LEFT JOIN report_releases rel ON rel.request_id = r.id WHERE r.entry_id = ?`,
  );
  const requestJoinById = db.prepare(
    `SELECT r.*, rel.id AS release_id, rel.status AS release_status, rel.expires_at AS release_expires_at, rel.first_opened_at AS release_first_opened_at
       FROM report_requests r LEFT JOIN report_releases rel ON rel.request_id = r.id WHERE r.id = ?`,
  );

  app.post('/api/counselor/groups/:id/report-requests', auth, counselorOnly, verifiedCounselor, (req, res) => {
    const me = req.user!;
    const g = groupById.get(parse(S.id, req.params.id)) as GroupRow | undefined;
    const released = g && groupFor(g, me.id);
    if (!g || !released) throw new HttpError(404, 'group_not_found', 'Group not found.');
    const body = parse(S.reportRequestCreate, req.body);
    if (!released.conflictCheck) throw new HttpError(409, 'conflict_check_required', 'Record your conflict check for this group first.');
    if (!released.entries.some((e) => e.entryId === body.entryId)) throw new HttpError(404, 'entry_not_found', 'Entry not found in this group.');
    const history = requestsForEntry.all(body.entryId) as Array<
      ReportRequestRow & { release_status: string | null; release_expires_at: string | null; release_revoke_reason: string | null }
    >;
    if (history.some((r) => r.status === 'declined' || (r.release_status === 'revoked' && r.release_revoke_reason === 'survivor')))
      throw new HttpError(409, 'she_said_no', 'She decided not to share her report. Matra will not ask her again.');
    const earlier = history.filter((r) => r.counselor_id === me.id);
    if (earlier.some((r) => r.status === 'pending')) throw new HttpError(409, 'request_open', 'You have already asked her. She hasn’t decided yet.');
    if (earlier.some((r) => r.release_status === 'active' && Date.parse(r.release_expires_at!) > Date.now()))
      throw new HttpError(409, 'already_shared', 'She has already shared her report with you.');
    const id = newId();
    db.transaction(() => {
      const ts = new Date().toISOString();
      const le = appendLedger(db, 'report.requested', id, sha256Hex(JSON.stringify({ requestId: id, groupId: g.id, entryId: body.entryId, counselorId: me.id })), ts);
      db.prepare(
        `INSERT INTO report_requests (id, group_id, entry_id, counselor_id, status, created_at, decided_at, ledger_entry_id)
         VALUES (?, ?, ?, ?, 'pending', ?, NULL, ?)`,
      ).run(id, g.id, body.entryId, me.id, ts, le.id);
      audit(me.id, 'counselor.requested_report', 'Asked a survivor you have spoken with for her full report');
    })();
    res.status(201).json({ request: toCounselorRequest(requestJoinById.get(id) as RequestJoinRow) });
  });

  app.post('/api/counselor/report-requests/:id/cancel', auth, counselorOnly, verifiedCounselor, (req, res) => {
    const me = req.user!;
    const r = requestById.get(parse(S.id, req.params.id)) as ReportRequestRow | undefined;
    if (!r || r.counselor_id !== me.id) throw new HttpError(404, 'request_not_found', 'Request not found.');
    if (r.status !== 'pending') throw new HttpError(409, 'request_not_pending', 'This request has already been decided.');
    db.prepare(`UPDATE report_requests SET status = 'cancelled', decided_at = ? WHERE id = ?`).run(new Date().toISOString(), r.id);
    audit(me.id, 'counselor.cancelled_request', 'Withdrew a request for a survivor’s report');
    res.json({ request: toCounselorRequest(requestJoinById.get(r.id) as RequestJoinRow) });
  });

  // ── releases: what a survivor's yes created. The counselor reads them; the survivor revokes them.
  const releaseSelect = `SELECT rel.*, r.group_id, r.entry_id,
      (SELECT json_group_array(blob_id) FROM (SELECT blob_id FROM report_release_blobs b WHERE b.release_id = rel.id ORDER BY b.rowid)) AS blob_ids
    FROM report_releases rel JOIN report_requests r ON r.id = rel.request_id`;
  const releaseById = db.prepare(`${releaseSelect} WHERE rel.id = ?`);
  const releaseByRequest = db.prepare(`${releaseSelect} WHERE rel.request_id = ?`);
  const releasesForCounselor = db.prepare(`${releaseSelect} WHERE rel.counselor_id = ? ORDER BY rel.created_at DESC, rel.rowid DESC`);
  const counselorLabel = (counselorId: string): string => {
    const c = q.counselorProfileByUser.get(counselorId) as CounselorProfileRow | undefined;
    return c ? `${c.display_name}${c.organization ? `, ${c.organization}` : ''}` : 'The legal options counselor';
  };
  /**
   * The counselor's own active release, or 403/404 (revoked, expired, someone else's). She must also still hold the
   * group (assigned by the matcher, so not passed on after a conflict) and still be on the signed roster: the same
   * conditions her request needed when the survivor said yes.
   */
  const liveReleaseFor = (req: Request): ReportReleaseRow => {
    const r = releaseById.get(parse(S.id, req.params.id)) as ReportReleaseRow | undefined;
    if (!r || r.counselor_id !== req.user!.id) throw new HttpError(404, 'release_not_found', 'Report not found.');
    if (r.status !== 'active') throw new HttpError(403, 'release_revoked', 'She has stopped sharing her report with you.');
    if (!isReleaseLive(r)) throw new HttpError(403, 'release_expired', 'Access to this report has ended.');
    const g = groupById.get(r.group_id) as GroupRow | undefined;
    const ids = rosterIds();
    if (!g || !assignmentFor.get(g.tag, r.counselor_id) || (ids && !ids.has(r.counselor_id)))
      throw new HttpError(403, 'release_revoked', 'This report is no longer available to you.');
    return r;
  };

  app.get('/api/counselor/releases', auth, counselorOnly, verifiedCounselor, (req, res) => {
    res.json({ releases: (releasesForCounselor.all(req.user!.id) as ReportReleaseRow[]).map(toRelease) });
  });

  app.get('/api/counselor/releases/:id/bundle', auth, counselorOnly, verifiedCounselor, (req, res) => {
    const me = req.user!;
    const r = liveReleaseFor(req);
    const rec = q.recordById.get(r.record_id) as RecordRow;
    const blobs = db
      .prepare(
        `SELECT rb.blob_id, rb.recipient_wrapped_key, b.content_hash, b.size_bytes
           FROM report_release_blobs rb JOIN blobs b ON b.id = rb.blob_id
          WHERE rb.release_id = ? ORDER BY rb.rowid ASC`,
      )
      .all(r.id) as Array<{ blob_id: string; recipient_wrapped_key: string; content_hash: string; size_bytes: number }>;
    const when = new Date().toISOString();
    if (!r.first_opened_at) db.prepare('UPDATE report_releases SET first_opened_at = ? WHERE id = ? AND first_opened_at IS NULL').run(when, r.id);
    const bundle: ReportReleaseBundle = {
      release: toRelease(releaseById.get(r.id) as ReportReleaseRow),
      record: { id: rec.id, envelope: JSON.parse(rec.envelope), contentHash: rec.content_hash, createdAt: rec.created_at, ledgerEntryId: rec.ledger_entry_id },
      recipientWrappedKey: JSON.parse(r.recipient_wrapped_key),
      blobs: blobs.map((b) => ({ blobId: b.blob_id, recipientWrappedKey: JSON.parse(b.recipient_wrapped_key), contentHash: b.content_hash, sizeBytes: b.size_bytes })),
    };
    audit(me.id, 'counselor.opened_report', 'Opened a report a survivor shared with you');
    audit(r.survivor_id, 'counselor.opened_report', `${counselorLabel(me.id)} (legal options counselor) opened your report at ${when}`);
    res.json(bundle);
  });

  app.get('/api/counselor/releases/:id/blobs/:blobId', auth, counselorOnly, verifiedCounselor, (req, res) => {
    const me = req.user!;
    const r = liveReleaseFor(req);
    const blobId = parse(S.id, req.params.blobId);
    const covered = db.prepare('SELECT 1 FROM report_release_blobs WHERE release_id = ? AND blob_id = ?').get(r.id, blobId);
    if (!covered) throw new HttpError(404, 'blob_not_found', 'File not found.');
    const b = db.prepare('SELECT data, content_hash FROM blobs WHERE id = ?').get(blobId) as { data: Buffer; content_hash: string } | undefined;
    if (!b) throw new HttpError(404, 'blob_not_found', 'File not found.');
    audit(me.id, 'counselor.downloaded_evidence', 'Downloaded an evidence file a survivor shared with you');
    audit(r.survivor_id, 'counselor.downloaded_evidence', `${counselorLabel(me.id)} (legal options counselor) downloaded one of your evidence files`);
    res.set('Content-Type', 'application/octet-stream');
    res.set('X-Content-Hash', b.content_hash);
    res.set('X-Blob-Id', blobId);
    res.send(b.data);
  });

  // ── the survivor's side. She sees only requests about HER OWN entries (joined through match_entries.user_id): never
  // the group, its size, the identifier, or anything about anyone else. Cancelled requests are not shown.
  const requestsForSurvivor = db.prepare(
    `SELECT r.* FROM report_requests r JOIN match_entries e ON e.id = r.entry_id
      WHERE e.user_id = ? AND r.status != 'cancelled' ORDER BY r.created_at DESC, r.rowid DESC`,
  );
  const entryOwner = db.prepare('SELECT user_id FROM match_entries WHERE id = ?');
  const toSurvivorRequest = (r: ReportRequestRow): SurvivorReportRequest => {
    const c = q.counselorProfileByUser.get(r.counselor_id) as CounselorProfileRow | undefined;
    const rel = releaseByRequest.get(r.id) as ReportReleaseRow | undefined;
    return {
      id: r.id,
      entryId: r.entry_id,
      status: r.status as SurvivorReportRequest['status'],
      createdAt: r.created_at,
      ...(r.decided_at != null && { decidedAt: r.decided_at }),
      counselor: {
        userId: r.counselor_id,
        displayName: c?.display_name ?? 'A legal options counselor',
        ...(c?.organization != null && { organization: c.organization }),
        jurisdictions: c ? (JSON.parse(c.jurisdictions) as string[]) : [],
        publicKey: c ? JSON.parse(c.public_key) : {},
      },
      ...(rel && { release: toSurvivorRelease(rel) }),
    };
  };
  /** Her own request (via her entry), or 404 — the same answer for someone else's request as for none. */
  const ownRequest = (req: Request): ReportRequestRow => {
    const r = requestById.get(parse(S.id, req.params.id)) as ReportRequestRow | undefined;
    const owner = r && (entryOwner.get(r.entry_id) as { user_id: string } | undefined);
    if (!r || owner?.user_id !== req.user!.id || r.status === 'cancelled') throw new HttpError(404, 'request_not_found', 'Request not found.');
    return r;
  };

  app.get('/api/report-requests', auth, survivorOnly, (req, res) => {
    res.json({ requests: (requestsForSurvivor.all(req.user!.id) as ReportRequestRow[]).map(toSurvivorRequest) });
  });

  app.post('/api/report-requests/:id/consent', auth, survivorOnly, (req, res) => {
    const me = req.user!;
    const r = ownRequest(req);
    if (r.status !== 'pending') throw new HttpError(409, 'request_not_pending', 'You have already answered this request.');
    const body = parse(S.reportConsentRequest, req.body);
    const counselor = q.counselorProfileByUser.get(r.counselor_id) as CounselorProfileRow | undefined;
    if (!counselor || counselor.verified !== 1) throw new HttpError(409, 'counselor_unavailable', 'This counselor is no longer available. Nothing was shared.');
    // The counselor must still hold this group (not reassigned after a conflict, not removed from the roster).
    const g = groupById.get(r.group_id) as GroupRow | undefined;
    if (!g || !assignmentFor.get(g.tag, r.counselor_id))
      throw new HttpError(409, 'counselor_unavailable', 'This counselor is no longer available. Nothing was shared.');
    const ids = rosterIds();
    if (ids && !ids.has(r.counselor_id)) throw new HttpError(409, 'counselor_unavailable', 'This counselor is no longer available. Nothing was shared.');
    const record = q.recordById.get(body.recordId) as RecordRow | undefined;
    if (!record) throw new HttpError(404, 'record_not_found', 'Record not found.');
    if (record.owner_id !== me.id) throw new HttpError(403, 'forbidden', 'You can only share your own records.');
    for (const b of body.blobs) {
      const meta = q.blobMetaById.get(b.blobId) as BlobRow | undefined;
      if (!meta) throw new HttpError(404, 'blob_not_found', 'One of the files was not found.');
      if (meta.owner_id !== me.id) throw new HttpError(403, 'forbidden', 'You can only share your own files.');
    }
    // Bind the release to the key she confirmed (or the signed roster vouched for): a swapped key changes it (W3).
    const fp = keyFingerprint(counselor.public_key);
    if (body.counselorKeyFingerprint !== fp)
      throw new HttpError(409, 'counselor_key_mismatch', "The counselor's key does not match the one you confirmed. Nothing was shared.");
    if (!body.consentStatement.includes(fp))
      throw new HttpError(400, 'consent_fingerprint_missing', 'The consent statement must name the confirmed key fingerprint.');
    const id = newId();
    const expiresAt = addDays(Date.now(), body.expiresInDays ?? DEFAULT_SHARE_DAYS);
    const blobIds = body.blobs.map((b) => b.blobId);
    const contentHash = sha256Hex(
      JSON.stringify({
        releaseId: id,
        requestId: r.id,
        recordId: body.recordId,
        counselorId: r.counselor_id,
        counselorKeyFingerprint: fp,
        consentStatement: body.consentStatement,
        blobIds,
        expiresAt,
      }),
    );
    let ledgerEntry!: LedgerEntry;
    db.transaction(() => {
      ledgerEntry = appendLedger(db, 'report.released', id, contentHash);
      db.prepare(
        `INSERT INTO report_releases (id, request_id, survivor_id, counselor_id, record_id, recipient_wrapped_key, consent_statement, status,
                                      created_at, expires_at, first_opened_at, revoked_at, ledger_entry_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL, NULL, ?)`,
      ).run(id, r.id, me.id, r.counselor_id, body.recordId, JSON.stringify(body.recipientWrappedKey), body.consentStatement, ledgerEntry.timestamp, expiresAt, ledgerEntry.id);
      const ins = db.prepare('INSERT INTO report_release_blobs (release_id, blob_id, recipient_wrapped_key) VALUES (?, ?, ?)');
      for (const b of body.blobs) ins.run(id, b.blobId, JSON.stringify(b.recipientWrappedKey));
      db.prepare(`UPDATE report_requests SET status = 'consented', decided_at = ? WHERE id = ?`).run(ledgerEntry.timestamp, r.id);
      audit(me.id, 'report.released', `You shared your report with ${counselorLabel(r.counselor_id)} (legal options counselor)`);
      audit(r.counselor_id, 'counselor.report_received', 'A survivor shared her report with you');
    })();
    res.status(201).json({ release: toSurvivorRelease(releaseById.get(id) as ReportReleaseRow), ledgerEntry });
  });

  app.post('/api/report-requests/:id/decline', auth, survivorOnly, (req, res) => {
    const me = req.user!;
    const r = ownRequest(req);
    if (r.status !== 'pending') throw new HttpError(409, 'request_not_pending', 'You have already answered this request.');
    db.transaction(() => {
      const decidedAt = new Date().toISOString();
      appendLedger(db, 'report.declined', r.id, sha256Hex(JSON.stringify({ requestId: r.id, decision: 'declined', decidedAt })), decidedAt);
      db.prepare(`UPDATE report_requests SET status = 'declined', decided_at = ? WHERE id = ?`).run(decidedAt, r.id);
      audit(me.id, 'report.declined', 'You decided not to share your report');
      audit(r.counselor_id, 'counselor.request_declined', 'A survivor decided not to share her report');
    })();
    res.json({ request: toSurvivorRequest(requestById.get(r.id) as ReportRequestRow) });
  });

  app.post('/api/report-releases/:id/revoke', auth, survivorOnly, (req, res) => {
    const me = req.user!;
    const r = releaseById.get(parse(S.id, req.params.id)) as ReportReleaseRow | undefined;
    if (!r || r.survivor_id !== me.id) throw new HttpError(404, 'release_not_found', 'Not found.');
    if (r.status === 'revoked') throw new HttpError(409, 'already_revoked', 'You have already stopped sharing this.');
    let ledgerEntry!: LedgerEntry;
    db.transaction(() => {
      const revokedAt = new Date().toISOString();
      ledgerEntry = appendLedger(db, 'report.revoked', r.id, revokeHash(r.id, 'survivor', revokedAt), revokedAt);
      db.prepare(`UPDATE report_releases SET status = 'revoked', revoked_at = ?, revoke_reason = 'survivor' WHERE id = ?`).run(revokedAt, r.id);
      audit(me.id, 'report.revoked', `You stopped sharing your report with ${counselorLabel(r.counselor_id)}`);
      audit(r.counselor_id, 'counselor.release_revoked', 'A survivor stopped sharing her report with you');
    })();
    res.json({ release: toSurvivorRelease(releaseById.get(r.id) as ReportReleaseRow), ledgerEntry });
  });

  // ════════════ audit ════════════
  // The newest AUDIT_LIST_LIMIT rows, plus every security event (recovery code, reset) even if it is older than those,
  // so no flood of other rows can hide that her recovery code was used. Newest first.
  const auditList = db.prepare(
    `SELECT * FROM audit_events
      WHERE user_id = ?
        AND (rowid IN (SELECT rowid FROM audit_events WHERE user_id = ? ORDER BY at DESC, rowid DESC LIMIT ${AUDIT_LIST_LIMIT})
             OR ${SECURITY_AUDIT_SQL})
      ORDER BY at DESC, rowid DESC`,
  );
  app.get('/api/audit', auth, (req, res) => {
    const rows = auditList.all(req.user!.id, req.user!.id) as AuditRow[];
    res.json({ events: rows.map(toAudit) });
  });

  // ════════════ account deletion ════════════
  // Deletes her rows (ciphertext, wrapped keys, shares, matches, activity) from the live database. secure_delete is ON,
  // so freed pages are overwritten, and a TRUNCATE checkpoint afterwards empties the WAL. It is not a crypto-shred:
  // her keys are wrapped under her passphrase, so a backup or copy of the database made earlier stays decryptable by
  // anyone who has that copy and her passphrase (docs/SECURITY_WHITEPAPER.md §2).
  app.post('/api/account/delete', auth, async (req, res) => {
    const me = req.user!;
    rateLimit(req, 'account-delete', me.username);
    const body = parse(S.deleteAccountRequest, req.body ?? {});
    await reauth(q.userById.get(me.id) as UserRow, body.authKey, 'delete');
    db.transaction(() => {
      const recordIds = (db.prepare('SELECT id FROM records WHERE owner_id = ?').all(me.id) as Array<{ id: string }>)
        .map((r) => r.id)
        .sort();
      const blobIds = (db.prepare('SELECT id FROM blobs WHERE owner_id = ?').all(me.id) as Array<{ id: string }>)
        .map((r) => r.id)
        .sort();

      // Authorize record deletion for this owner only, for the lifetime of this transaction.
      db.prepare('INSERT INTO shred_authorizations (owner_id) VALUES (?)').run(me.id);
      db.prepare(
        `DELETE FROM share_blobs WHERE share_id IN (SELECT id FROM shares WHERE survivor_id = ? OR attorney_id = ?)`,
      ).run(me.id, me.id);
      db.prepare('DELETE FROM shares WHERE survivor_id = ? OR attorney_id = ?').run(me.id, me.id);
      // staged release: her releases and the requests about her entries; or, for a counselor, everything she held
      db.prepare(
        'DELETE FROM report_release_blobs WHERE release_id IN (SELECT id FROM report_releases WHERE survivor_id = ? OR counselor_id = ?)',
      ).run(me.id, me.id);
      db.prepare('DELETE FROM report_releases WHERE survivor_id = ? OR counselor_id = ?').run(me.id, me.id);
      db.prepare('DELETE FROM report_requests WHERE counselor_id = ? OR entry_id IN (SELECT id FROM match_entries WHERE user_id = ?)').run(me.id, me.id);
      db.prepare('DELETE FROM conflict_checks WHERE counselor_id = ?').run(me.id);
      db.prepare('DELETE FROM blobs WHERE owner_id = ?').run(me.id);
      db.prepare('DELETE FROM records WHERE owner_id = ?').run(me.id);
      // sealed matching: her entries (and their seals), and — if a counselor — her seals, notes and profile
      db.prepare('DELETE FROM match_seals WHERE entry_id IN (SELECT id FROM match_entries WHERE user_id = ?)').run(me.id);
      db.prepare('INSERT OR IGNORE INTO matcher_pending_deletes (entry_id) SELECT id FROM match_entries WHERE user_id = ?').run(me.id);
      db.prepare('DELETE FROM match_entries WHERE user_id = ?').run(me.id);
      db.prepare('DELETE FROM match_seals WHERE counselor_id = ?').run(me.id);
      db.prepare('DELETE FROM counselor_notes WHERE counselor_id = ?').run(me.id);
      db.prepare('DELETE FROM counselor_profiles WHERE user_id = ?').run(me.id);
      // account-level and in-process holders' quotas; remote holders only know a pseudonym (HMAC of the id) that nothing can link back
      db.prepare('DELETE FROM oprf_quota WHERE user_id = ?').run(me.id);
      accountBudget.forget(me.id);
      for (const [k, c] of challenges) if (c.userId === me.id) challenges.delete(k);
      for (const [k, t] of resetTokens) if (t.userId === me.id) resetTokens.delete(k);
      // phone_tokens has no account id, so its count is NOT decremented (W19, docs/PRIVACY_DATA_INVENTORY.md)
      pruneGroups();
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(me.id);
      db.prepare('DELETE FROM audit_events WHERE user_id = ?').run(me.id);
      db.prepare('DELETE FROM attorney_profiles WHERE user_id = ?').run(me.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(me.id);
      db.prepare('DELETE FROM shred_authorizations WHERE owner_id = ?').run(me.id);

      appendLedger(db, 'account.shredded', me.id, sha256Hex(JSON.stringify({ userId: me.id, recordIds, blobIds })));
    })();
    // Move the deleted pages out of the WAL file now rather than at some later automatic checkpoint (same as phone tokens).
    checkpoint();
    void syncMatcher(); // her entries leave the matcher; a counselor's departure changes its roster
    res.json({ ok: true });
  });

  // ════════════ fallthrough & errors ════════════
  // ════════════ dev / demo: what the server sees (src/inspector.ts) ════════════
  if (recorder) {
    const remoteHolders = oprfOpt.remote?.urls ?? [];
    app.get(INSPECTOR_ROUTE, async (req, res) => {
      const find = typeof req.query.find === 'string' ? req.query.find.trim().slice(0, 200) : '';
      const limiters: Array<[string, RateLimiter]> = [
        ...clients.allLimiters().map((l, i) => [`per-client #${i + 1}`, l] as [string, RateLimiter]),
        ['sms per account', smsStartPerAccount],
        ['sms per account+phone token', smsStartPerAccountPhone],
        ['sms global hour', smsGlobalHour],
        ['sms global day', smsGlobalDay],
      ];
      const app_ = appProcess({ db, recorder, limiters, pendingPhoneChallenges: challenges.size, holdersInProcess: !oprfOpt.remote });
      const holderStates = await Promise.all(
        remoteHolders.map((url, i) =>
          fetchProcess(`${url.replace(/\/+$/, '')}/debug/state`, { name: `Key holder ${i + 1}`, role: 'holder', note: `Separate process at ${url}.` }),
        ),
      );
      let matcherState;
      try {
        matcherState = matcher.debugState
          ? await matcher.debugState()
          : { name: 'Matcher', role: 'matcher' as const, note: 'This matcher client has no debug view.', tables: [] };
      } catch (e) {
        matcherState = { name: 'Matcher', role: 'matcher' as const, note: 'Separate matcher service.', error: `not reachable (${(e as Error).message})`, tables: [] };
      }
      res.json({
        at: new Date().toISOString(),
        demoMode: process.env.MATRA_DEMO_MODE === '1',
        processes: [app_, ...holderStates, matcherState],
        ...(find && { found: findInDb(db, find) }),
      });
    });
  }

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found', code: 'not_found' });
  });

  if (opts.webDir) mountWebApp(app, opts.webDir, !!opts.demoBanner);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    const e = err as { type?: string; status?: number; message?: string };
    if (e?.type === 'entity.parse.failed')
      return res.status(400).json({ error: 'Malformed JSON body', code: 'invalid_json' });
    if (e?.type === 'entity.too.large')
      return res.status(413).json({ error: 'Payload too large', code: 'payload_too_large' });
    if (typeof e?.status === 'number' && e.status >= 400 && e.status < 500)
      return res.status(e.status).json({ error: 'Bad request', code: 'invalid_request' });
    // Log the error message only — never request data (or an arbitrary thrown object, which could carry it).
    console.error('[matra] internal error:', errorMessageForLog(e));
    res.status(500).json({ error: 'Internal server error', code: 'internal' });
  });

  return app;
}

/**
 * Serve the built SPA. Hashed files under /assets are immutable; index.html is never cached. Any other GET without a
 * file extension falls back to index.html (the app uses an in-memory router, so this is only for reloads / deep links).
 */
function mountWebApp(app: express.Express, webDir: string, demoBanner: boolean) {
  const root = path.resolve(webDir);
  const indexFile = path.join(root, 'index.html');
  if (!fs.existsSync(indexFile)) throw new Error(`webDir has no index.html: ${root} (run \`npm run build\` first)`);
  let indexHtml = fs.readFileSync(indexFile, 'utf8');
  // A meta tag rather than inline script: the CSP forbids inline scripts. The app reads it at startup.
  if (demoBanner) indexHtml = indexHtml.replace(/<head>/i, '<head>\n    <meta name="matra-demo-banner" content="1" />');

  const webHeaders = (res: Response) => {
    res.set('Content-Security-Policy', WEB_CSP);
    res.set('Cross-Origin-Opener-Policy', 'same-origin');
    // COOP + COEP make the page cross-origin isolated, which lets on-device transcription use multiple threads
    // (~3× faster). Safe because every resource the app loads is same-origin.
    res.set('Cross-Origin-Embedder-Policy', 'require-corp');
    // microphone=(self): on-device voice capture (src/voice). Never granted to any other origin.
    res.set('Permissions-Policy', 'camera=(), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()');
  };
  const sendIndex = (_req: Request, res: Response) => {
    webHeaders(res);
    res.set('Cache-Control', 'no-store');
    res.type('html').send(indexHtml);
  };
  app.get(['/', '/index.html'], sendIndex);
  app.use(
    express.static(root, {
      index: false,
      etag: false,
      lastModified: false,
      dotfiles: 'ignore',
      fallthrough: true,
      setHeaders: (res, file) => {
        webHeaders(res);
        const rel = path.relative(root, file).split(path.sep).join('/');
        res.set('Cache-Control', rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-store');
      },
    }),
  );
  app.use((req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || path.extname(req.path)) return next();
    sendIndex(req, res);
  });
}

/** Access the underlying database of an app created by createApp (tests, seed, admin scripts). */
/** Writes buffered phone-token counts now (shutdown, tests). Normally they are flushed at a random later time (W19). */
export function flushPhoneTokens(app: express.Express): void {
  (app.locals.flushPhoneTokens as (() => void) | undefined)?.();
}

export function getDb(app: express.Express): DB {
  return app.locals.db as DB;
}
