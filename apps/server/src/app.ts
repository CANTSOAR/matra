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
 *       | age_not_confirmed
 *   404 not_found | record_not_found | blob_not_found | attorney_not_found | share_not_found | entry_not_found
 *       | counselor_not_found | group_not_found
 *   403 … | counselor_not_listed (seal to a counselor missing from the signed roster)
 *   409 username_taken | already_revoked | already_sealed
 *   413 payload_too_large   415 unsupported_media_type   500 internal
 *   429 rate_limited | rate_limited_daily | rate_limited_lifetime
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import type { z } from 'zod';
import { generateOprfKey, type OprfKeyPair } from '@matra/crypto';
import type {
  AttorneyProfile,
  AuditEvent,
  BlobMeta,
  CounselorMatchGroup,
  CounselorNote,
  CounselorProfile,
  CounselorRosterPayload,
  CounselorSeal,
  EscrowEntry,
  MatchingConfig,
  LedgerEntry,
  PublicUser,
  Role,
  Share,
  ShareBundle,
  SignedCounselorRoster,
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
  newId,
  sha256Hex,
  verifyLedger,
} from './ledger.js';
import {
  RateLimiter,
  createSession,
  deleteSession,
  dummyVerify,
  fakeKdfSalt,
  hashAuthKey,
  requireAuth,
  requireRole,
  verifyAuthKey,
} from './auth.js';
import * as S from './schemas.js';
import { DEFAULT_OPRF_LIMITS, OprfKeyHolder, type HolderId, type OprfLimits } from './oprf.js';

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
   * Sealed matching. keyA / keyB are the two independent OPRF key shares (config.ts loadOprfKey). When omitted (tests),
   * fresh ephemeral keys are generated — matching then only works for the lifetime of this process.
   * releaseDelayHours (default 72): a group is released only once ≥ 2 distinct survivors' entries are at least this old.
   * allowKeyRotation: accept keys that differ from the ones recorded in the DB (MATRA_OPRF_ROTATE=1) → new key epoch.
   */
  matching?: {
    keyA?: OprfKeyPair;
    keyB?: OprfKeyPair;
    limits?: Partial<OprfLimits>;
    releaseDelayHours?: number;
    allowKeyRotation?: boolean;
  };
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
});

const DEFAULT_SHARE_DAYS = 90;
const addDays = (from: number, days: number) => new Date(from + days * 86_400_000).toISOString();
/** A share grants access only while active AND unexpired. Revocation and expiry stop future access only. */
const isShareLive = (s: ShareRow) => s.status === 'active' && Date.parse(s.expires_at) > Date.now();

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

  if (opts.logRequests) {
    app.use((req, res, next) => {
      const t0 = Date.now();
      // Path only — never the query string (prelogin carries usernames) and never bodies.
      res.on('finish', () => console.log(`${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${Date.now() - t0}ms`));
      next();
    });
  }

  app.use(
    cors({
      origin: opts.corsOrigins ?? ['http://localhost:5173', 'http://127.0.0.1:5173'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Owner-Wrapped-Key'],
      exposedHeaders: ['X-Content-Hash', 'X-Blob-Id'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '5mb' }));

  const auth = requireAuth(db);
  const survivorOnly = requireRole('survivor');
  const attorneyOnly = requireRole('attorney');
  const counselorOnly = requireRole('counselor');

  // ── sealed matching: two independent OPRF key holders ──
  const limits: OprfLimits = { ...DEFAULT_OPRF_LIMITS, ...opts.matching?.limits };
  const holders: Record<HolderId, OprfKeyHolder> = {
    a: new OprfKeyHolder('a', opts.matching?.keyA ?? generateOprfKey(), db, limits),
    b: new OprfKeyHolder('b', opts.matching?.keyB ?? generateOprfKey(), db, limits),
  };
  if (holders.a.publicKey === holders.b.publicKey) throw new Error('OPRF key shares A and B must differ');
  const releaseDelayMs = Math.max(0, opts.matching?.releaseDelayHours ?? 72) * 3_600_000;

  // ── key pinning in the DB (review M5): the holder public keys are recorded on first start; a silent key change would
  // make every existing entry unmatchable (and could be used to partition survivors), so it is refused unless the
  // operator explicitly rotates. A rotation starts a new key epoch; survivors' clients re-seal on their next sign-in.
  const metaGet = db.prepare('SELECT value FROM matching_meta WHERE key = ?');
  const metaSet = db.prepare('INSERT INTO matching_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');
  const meta = (k: string) => (metaGet.get(k) as { value: string } | undefined)?.value;
  db.transaction(() => {
    const [pkA, pkB] = [meta('oprf_pk_a'), meta('oprf_pk_b')];
    if (pkA === undefined && pkB === undefined) {
      metaSet.run('oprf_pk_a', holders.a.publicKey);
      metaSet.run('oprf_pk_b', holders.b.publicKey);
      metaSet.run('key_epoch', String(Number(meta('key_epoch') ?? 0) + 1));
    } else if (pkA !== holders.a.publicKey || pkB !== holders.b.publicKey) {
      if (!opts.matching?.allowKeyRotation)
        throw new Error(
          'OPRF key holder public keys differ from the ones recorded in this database. Refusing to start: a silent key ' +
            'change breaks every sealed entry. To rotate deliberately, restart once with MATRA_OPRF_ROTATE=1.',
        );
      const epoch = Number(meta('key_epoch') ?? 1) + 1;
      metaSet.run('oprf_pk_a', holders.a.publicKey);
      metaSet.run('oprf_pk_b', holders.b.publicKey);
      metaSet.run('key_epoch', String(epoch));
      db.prepare('DELETE FROM oprf_quota').run(); // new keys: re-sealing must not be blocked by old quotas
      console.warn(`[matra] OPRF keys rotated: key epoch is now ${epoch}. Survivors' clients re-seal on next sign-in.`);
    }
  })();
  const keyEpoch = Number(meta('key_epoch'));

  const loginLimiterKey = new RateLimiter(10, 60_000);
  const loginLimiterIp = new RateLimiter(60, 60_000);
  const rateLimit = (req: Request, kind: string, username: unknown) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
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

  app.post('/api/auth/register', async (req, res) => {
    rateLimit(req, 'register', req.body?.username);
    const body = parse(S.registerRequest, req.body);
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
      audit(u.id, 'auth.login_failed', 'A sign-in attempt with an incorrect passphrase');
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

  // ════════════ attorneys ════════════
  app.get('/api/attorneys', auth, (req, res) => {
    const { state } = parse(S.attorneysQuery, req.query);
    let list = (q.verifiedProfiles.all() as ProfileRow[]).map(toProfile);
    if (state) list = list.filter((a) => a.jurisdictions.includes(state));
    res.json({ attorneys: list });
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
    const col = me.role === 'attorney' ? 'attorney_id' : 'survivor_id';
    const rows = db.prepare(`SELECT * FROM shares WHERE ${col} = ? ORDER BY created_at DESC, rowid DESC`).all(me.id) as ShareRow[];
    res.json({ shares: rows.map(toShare) });
  });

  app.get('/api/shares/:id/bundle', auth, attorneyOnly, (req, res) => {
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
    db.prepare('DELETE FROM match_groups WHERE NOT EXISTS (SELECT 1 FROM match_entries e WHERE e.tag = match_groups.tag)').run();
  };
  pruneSeals();
  pruneGroups();

  app.get('/api/matching/config', auth, verifiedAdultSurvivor, (_req, res) => {
    pruneSeals();
    const roster = signedRoster();
    const config: MatchingConfig = {
      threshold: 2,
      suite: 'ristretto255-SHA512',
      mode: 'voprf',
      keyHolders: { a: { publicKey: holders.a.publicKey }, b: { publicKey: holders.b.publicKey } },
      counselors: sealableCounselors().map(toCounselorProfile),
      limits: { perDay: limits.perDay, lifetime: limits.lifetime },
      keyEpoch,
      ...(roster && { roster }),
    };
    res.json(config);
  });

  // Two independent evaluation endpoints, one per key share. In production each can live in its own process/host.
  for (const h of ['a', 'b'] as const) {
    app.get(`/api/matching/oprf-${h}/key`, (_req, res) => {
      res.json({ publicKey: holders[h].publicKey });
    });
    app.post(`/api/matching/oprf-${h}`, auth, verifiedAdultSurvivor, (req, res) => {
      const { blinded } = parse(S.oprfEvaluateRequest, req.body);
      const r = holders[h].evaluate(req.user!.id, blinded);
      if (!r.ok) {
        if (r.code === 'invalid_element') throw new HttpError(400, 'invalid_request', 'blinded is not a valid group element');
        throw new HttpError(
          429,
          r.code,
          r.code === 'rate_limited_daily'
            ? 'You’ve sealed as many identifiers as we allow in one day. You can add more tomorrow.'
            : 'This account has reached the limit for sealed identifiers.',
        );
      }
      res.json(r.response);
    });
  }

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
  const deleteEntry = (entryId: string) => {
    db.prepare('DELETE FROM match_seals WHERE entry_id = ?').run(entryId);
    db.prepare('DELETE FROM match_entries WHERE id = ?').run(entryId);
  };
  const markMatched = db.prepare(
    `INSERT OR IGNORE INTO match_groups (id, tag, matched_at)
     SELECT ?, ?, ? WHERE (SELECT COUNT(DISTINCT user_id) FROM match_entries WHERE tag = ?) >= 2`,
  );

  app.post('/api/matching/entries', auth, verifiedAdultSurvivor, (req, res) => {
    const me = req.user!;
    const body = parse(S.createMatchEntryRequest, req.body);
    checkSealRecipients(body.seals);
    const replaces = body.replacesEntryId ?? null;
    if (replaces) {
      const old = q.matchEntryById.get(replaces) as MatchEntryRow | undefined;
      if (!old || old.user_id !== me.id) throw new HttpError(404, 'entry_not_found', 'Entry not found.');
    }
    // Only reveals HER OWN earlier submission for the same person.
    if (ownEntryForTag.get(me.id, body.tag, replaces)) throw new HttpError(409, 'already_sealed', 'You have already sealed this.');
    if ((ownEntryCount.get(me.id, replaces) as { n: number }).n >= limits.lifetime)
      throw new HttpError(429, 'rate_limited_lifetime', 'This account has reached the limit for sealed identifiers.');
    const id = newId();
    db.transaction(() => {
      const ts = new Date().toISOString();
      // a re-seal (after a key rotation) replaces her older entry atomically
      if (replaces) deleteEntry(replaces);
      const le = appendLedger(db, 'escrow.sealed', id, envelopeContentHash(body.bundle), ts);
      db.prepare(
        `INSERT INTO match_entries (id, user_id, tag, bundle, label_envelope, created_at, ledger_entry_id, key_epoch)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, me.id, body.tag, canonicalEnvelope(body.bundle), canonicalEnvelope(body.labelEnvelope), ts, le.id, keyEpoch);
      const ins = db.prepare('INSERT INTO match_seals (entry_id, counselor_id, seal) VALUES (?, ?, ?)');
      for (const seal of body.seals) ins.run(id, seal.counselorId, JSON.stringify(seal satisfies CounselorSeal));
      audit(me.id, 'escrow.created', replaces ? 'Re-sealed an identifier under the current matching keys' : 'Sealed an identifier for sealed matching');
      // Always executed, so a match takes the same code path as a miss (no branch/timing oracle in the handler).
      markMatched.run(newId(), body.tag, ts, body.tag);
      if (replaces) pruneGroups();
    })();
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
  // UNIQUE(user_id, tag) ⇒ every entry of a group comes from a different survivor. user_id is never returned; the
  // account creation time is used only for the Sybil signals below and never leaves the server.
  const groupEntriesFor = db.prepare(
    `SELECT e.id, e.created_at, e.bundle, s.seal, u.created_at AS account_created_at FROM match_entries e
       JOIN match_seals s ON s.entry_id = e.id AND s.counselor_id = ?
       JOIN users u ON u.id = e.user_id
      WHERE e.tag = ? AND e.created_at <= ? ORDER BY e.created_at ASC, e.rowid ASC`,
  );
  const notesFor = db.prepare('SELECT * FROM counselor_notes WHERE group_id = ? AND counselor_id = ? ORDER BY created_at ASC, rowid ASC');

  type GroupRow = { id: string; tag: string; matched_at: string };
  const groupFor = (g: GroupRow, counselorId: string): CounselorMatchGroup | null => {
    const rows = groupEntriesFor.all(counselorId, g.tag, releaseCutoff()) as Array<{
      id: string;
      created_at: string;
      bundle: string;
      seal: string;
      account_created_at: string;
    }>;
    const entries = rows.map((e) => ({ entryId: e.id, createdAt: e.created_at, bundle: JSON.parse(e.bundle), seal: JSON.parse(e.seal) as CounselorSeal }));
    // A counselor needs two seals addressed to them to reconstruct; anything less is never released.
    if (entries.length < 2) return null;
    // Sybil signals (M2): accounts created within 24 h of each other, and entries sealed < 7 days after account creation.
    const created = rows.map((r) => Date.parse(r.account_created_at)).sort((a, b) => a - b);
    const signals = {
      accountsCreatedClose: created.some((t, i) => i > 0 && t - created[i - 1]! < 86_400_000),
      newAccountEntries: rows.filter((r) => Date.parse(r.created_at) - Date.parse(r.account_created_at) < 7 * 86_400_000).length,
    };
    const notes = (notesFor.all(g.id, counselorId) as Array<{ id: string; group_id: string; entry_id: string | null; envelope: string; created_at: string }>).map(
      (n): CounselorNote => ({
        id: n.id,
        groupId: n.group_id,
        ...(n.entry_id != null && { entryId: n.entry_id }),
        envelope: JSON.parse(n.envelope),
        createdAt: n.created_at,
      }),
    );
    return { id: g.id, tag: g.tag, matchedAt: g.matched_at, entries, notes, signals };
  };

  app.get('/api/counselor/groups', auth, counselorOnly, verifiedCounselor, (req, res) => {
    const me = req.user!;
    pruneSeals();
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

  // ════════════ audit ════════════
  app.get('/api/audit', auth, (req, res) => {
    const rows = db
      .prepare('SELECT * FROM audit_events WHERE user_id = ? ORDER BY at DESC, rowid DESC LIMIT 1000')
      .all(req.user!.id) as AuditRow[];
    res.json({ events: rows.map(toAudit) });
  });

  // ════════════ account crypto-shred ════════════
  app.post('/api/account/delete', auth, (req, res) => {
    const me = req.user!;
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
      db.prepare('DELETE FROM blobs WHERE owner_id = ?').run(me.id);
      db.prepare('DELETE FROM records WHERE owner_id = ?').run(me.id);
      // sealed matching: her entries (and their seals), and — if a counselor — her seals, notes and profile
      db.prepare('DELETE FROM match_seals WHERE entry_id IN (SELECT id FROM match_entries WHERE user_id = ?)').run(me.id);
      db.prepare('DELETE FROM match_entries WHERE user_id = ?').run(me.id);
      db.prepare('DELETE FROM match_seals WHERE counselor_id = ?').run(me.id);
      db.prepare('DELETE FROM counselor_notes WHERE counselor_id = ?').run(me.id);
      db.prepare('DELETE FROM counselor_profiles WHERE user_id = ?').run(me.id);
      db.prepare('DELETE FROM oprf_quota WHERE user_id = ?').run(me.id);
      pruneGroups();
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(me.id);
      db.prepare('DELETE FROM audit_events WHERE user_id = ?').run(me.id);
      db.prepare('DELETE FROM attorney_profiles WHERE user_id = ?').run(me.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(me.id);
      db.prepare('DELETE FROM shred_authorizations WHERE owner_id = ?').run(me.id);

      appendLedger(db, 'account.shredded', me.id, sha256Hex(JSON.stringify({ userId: me.id, recordIds, blobIds })));
    })();
    res.json({ ok: true });
  });

  // ════════════ fallthrough & errors ════════════
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
    // Log the error message only — never request data.
    console.error('[matra] internal error:', e?.message ?? err);
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
export function getDb(app: express.Express): DB {
  return app.locals.db as DB;
}
