/**
 * Matra API server. Implements the contract in @shield/shared exactly.
 *
 * Zero-knowledge: the server only ever handles ciphertext (Envelope / blob bytes),
 * wrapped keys, public keys, and hashes. Request bodies are never logged.
 *
 * Error shape: ApiError `{ error: string, code?: string }`. Codes used:
 *   400 invalid_request | invalid_json | invalid_wrapped_key | scope_mismatch
 *   401 unauthorized | session_expired | invalid_credentials
 *   403 forbidden | forbidden_role | share_revoked | attorney_not_verified
 *   404 not_found | record_not_found | blob_not_found | attorney_not_found | share_not_found
 *   409 username_taken | already_revoked
 *   413 payload_too_large   415 unsupported_media_type   429 rate_limited   500 internal
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { createHmac } from 'node:crypto';
import type { z } from 'zod';
import type {
  AttorneyProfile,
  AuditEvent,
  BlobMeta,
  EscrowEntry,
  LedgerEntry,
  PublicUser,
  Role,
  Share,
  ShareBundle,
  VaultRecord,
  VaultRecordMeta,
  WrappedKey,
} from '@shield/shared';
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

export interface CreateAppOptions {
  /** SQLite path, or ':memory:' for tests. */
  dbPath: string;
  /** Server secret for HMACs (escrow, fake prelogin salts). */
  pepper: Buffer | string;
  /** Allowed CORS origins (the Vite dev server proxies /api, so CORS is rarely needed). */
  corsOrigins?: string[];
  /** DEV ONLY: newly registered attorneys are immediately verified. */
  autoVerifyAttorneys?: boolean;
  /** Log method, path, status, duration (never bodies or query strings). */
  logRequests?: boolean;
}

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
  ledger_entry_id: string;
}
interface EscrowRow {
  id: string;
  label_envelope: string;
  status: 'sealed' | 'matched';
  created_at: string;
  matched_at: string | null;
  ledger_entry_id: string;
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
  ...(s.revoked_at != null && { revokedAt: s.revoked_at }),
  ledgerEntryId: s.ledger_entry_id,
});

const toEscrow = (e: EscrowRow): EscrowEntry => ({
  id: e.id,
  labelEnvelope: JSON.parse(e.label_envelope),
  status: e.status,
  createdAt: e.created_at,
  ...(e.matched_at != null && { matchedAt: e.matched_at }),
  ledgerEntryId: e.ledger_entry_id,
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
        `INSERT INTO users (id, username, role, auth_hash, auth_salt, kdf_salt, kdf_iterations, public_key, wrapped_private_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    res.json({ user: toPublicUser(u), ...(p && { attorneyProfile: toProfile(p) }) });
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
      audit(me.id, 'record.created', `Encrypted record sealed (ledger #${ledgerEntry.seq})`);
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
                  WHERE sb.blob_id = ? AND s.attorney_id = ? AND s.status = 'active' LIMIT 1`,
              )
              .get(bid, me.id) as { id: string; survivor_id: string } | undefined)
          : undefined;
      if (!grant) throw new HttpError(403, 'forbidden', 'You do not have access to this file.');
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

    for (const b of body.blobs) {
      const meta = q.blobMetaById.get(b.blobId) as BlobRow | undefined;
      if (!meta) throw new HttpError(404, 'blob_not_found', 'One of the files was not found.');
      if (meta.owner_id !== me.id) throw new HttpError(403, 'forbidden', 'You can only share your own files.');
    }
    if (body.blobs.length > 0 && !body.scope.includes('evidence'))
      throw new HttpError(400, 'scope_mismatch', "Sharing files requires 'evidence' in the consent scope.");

    const id = newId();
    const blobIds = body.blobs.map((b) => b.blobId);
    const contentHash = sha256Hex(
      JSON.stringify({
        shareId: id,
        recordId: body.recordId,
        attorneyId: body.attorneyId,
        consentStatement: body.consentStatement,
        scope: body.scope,
        blobIds,
      }),
    );
    let ledgerEntry!: LedgerEntry;
    db.transaction(() => {
      ledgerEntry = appendLedger(db, 'share.granted', id, contentHash);
      db.prepare(
        `INSERT INTO shares (id, record_id, survivor_id, attorney_id, status, consent_statement, scope,
                             recipient_wrapped_key, survivor_alias, created_at, revoked_at, ledger_entry_id)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, NULL, ?)`,
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
    };
    const when = new Date().toISOString();
    audit(me.id, 'share.opened', `Opened shared case file (share ${s.id})`);
    audit(s.survivor_id, 'attorney.opened_share', `${attorneyLabel(me.id)} opened your shared case file at ${when}`);
    res.json(bundle);
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

  // ════════════ blind escrow ════════════
  /*
   * Stored value: HMAC-SHA256(pepper, identifierHash) — so a DB leak alone can't be dictionary-attacked.
   * A match occurs only when a *different* user holds the same peppered hash. When it does, every still-sealed
   * entry with that hash flips to 'matched'. Responses never include hashes, counts, or other users.
   */
  app.post('/api/escrow', auth, survivorOnly, (req, res) => {
    const me = req.user!;
    const body = parse(S.createEscrowRequest, req.body);
    const peppered = createHmac('sha256', pepper).update(body.identifierHash).digest('hex');
    const id = newId();
    db.transaction(() => {
      const ts = new Date().toISOString();
      const le = appendLedger(db, 'escrow.sealed', id, envelopeContentHash(body.labelEnvelope), ts);
      db.prepare(
        `INSERT INTO escrow_entries (id, user_id, peppered_hash, label_envelope, status, created_at, matched_at, ledger_entry_id)
         VALUES (?, ?, ?, ?, 'sealed', ?, NULL, ?)`,
      ).run(id, me.id, peppered, canonicalEnvelope(body.labelEnvelope), ts, le.id);
      audit(me.id, 'escrow.created', 'Sealed an identifier in the blind escrow');

      const otherUser = db
        .prepare('SELECT 1 FROM escrow_entries WHERE peppered_hash = ? AND user_id != ? LIMIT 1')
        .get(peppered, me.id);
      if (otherUser) {
        const toMatch = db
          .prepare(`SELECT id FROM escrow_entries WHERE peppered_hash = ? AND status = 'sealed' ORDER BY rowid`)
          .all(peppered) as Array<{ id: string }>;
        const upd = db.prepare(`UPDATE escrow_entries SET status = 'matched', matched_at = ? WHERE id = ?`);
        for (const e of toMatch) {
          upd.run(ts, e.id);
          appendLedger(db, 'escrow.matched', e.id, sha256Hex(JSON.stringify({ escrowEntryId: e.id, matchedAt: ts })), ts);
        }
      }
    })();
    const row = db.prepare('SELECT * FROM escrow_entries WHERE id = ?').get(id) as EscrowRow;
    res.status(201).json({ entry: toEscrow(row) });
  });

  app.get('/api/escrow', auth, (req, res) => {
    const rows = db
      .prepare('SELECT * FROM escrow_entries WHERE user_id = ? ORDER BY created_at DESC, rowid DESC')
      .all(req.user!.id) as EscrowRow[];
    res.json({ entries: rows.map(toEscrow) });
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
      db.prepare('DELETE FROM escrow_entries WHERE user_id = ?').run(me.id);
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

/** Access the underlying database of an app created by createApp (tests, seed, admin scripts). */
export function getDb(app: express.Express): DB {
  return app.locals.db as DB;
}
