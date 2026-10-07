/**
 * Typed client for the Matra HTTP API (contract: packages/shared/src/index.ts).
 *
 * - Every request carries `Authorization: Bearer <token>` when a token is available.
 * - Non-2xx responses are thrown as `ApiError` (with the server's `{ error, code }` when present).
 * - The server only ever sees ciphertext (`Envelope`, `WrappedKey`, encrypted blobs).
 */
import { sha256Hex, toBase64 } from '@matra/crypto';
import type {
  AddMatchSealsRequest,
  AttorneyProfile,
  AuditEvent,
  AuthResponse,
  BlobMeta,
  CreateBlobResponse,
  CounselorMatchGroup,
  CounselorNote,
  CounselorProfile,
  CreateMatchEntryRequest,
  CreateRecordRequest,
  CreateRecordResponse,
  CreateShareRequest,
  EscrowEntry,
  Envelope,
  LedgerEntry,
  LedgerVerifyResponse,
  LoginRequest,
  MatchingConfig,
  OprfEvaluateRequest,
  OprfEvaluateResponse,
  PreloginResponse,
  PublicUser,
  RegisterRequest,
  Share,
  ShareBundle,
  VaultRecord,
  VaultRecordMeta,
  WrappedKey,
} from '@matra/shared';

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Canonical content hash of a record envelope — must match what the server stores
 * as `contentHash` and attests in the ledger: SHA-256 hex of JSON.stringify({v,alg,iv,ct}).
 */
export async function envelopeHash(env: Envelope): Promise<string> {
  return sha256Hex(JSON.stringify({ v: env.v, alg: env.alg, iv: env.iv, ct: env.ct }));
}

export interface ApiClientOptions {
  baseUrl?: string;
  getToken?: () => string | null | undefined;
  fetchImpl?: typeof fetch;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly getToken: () => string | null | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ApiClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? '';
    this.getToken = opts.getToken ?? (() => null);
    // bind so `this` isn't lost when the global fetch is stored on an object
    this.fetchImpl = opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...(extra ?? {}) };
    const t = this.getToken();
    if (t) h['Authorization'] = `Bearer ${t}`;
    return h;
  }

  private async raw(method: string, path: string, init: { body?: BodyInit; headers?: Record<string, string> } = {}) {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: this.headers(init.headers),
        body: init.body,
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch {
      throw new ApiError(0, 'We could not reach the server. Check your connection and try again.', 'network');
    }
    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      let code: string | undefined;
      try {
        const body = (await res.json()) as { error?: string; code?: string };
        if (body?.error) message = body.error;
        code = body?.code;
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(res.status, message, code);
    }
    return res;
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.raw(method, path, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    });
    return (await res.json()) as T;
  }

  // ── health / auth ──
  health() {
    return this.json<{ ok: true }>('GET', '/api/health');
  }
  prelogin(username: string) {
    return this.json<PreloginResponse>('GET', `/api/auth/prelogin?username=${encodeURIComponent(username)}`);
  }
  register(req: RegisterRequest) {
    return this.json<AuthResponse>('POST', '/api/auth/register', req);
  }
  login(req: LoginRequest) {
    return this.json<AuthResponse>('POST', '/api/auth/login', req);
  }
  logout() {
    return this.json<{ ok: true }>('POST', '/api/auth/logout');
  }
  me() {
    return this.json<{ user: PublicUser; attorneyProfile?: AttorneyProfile; counselorProfile?: CounselorProfile }>('GET', '/api/me');
  }

  // ── vault ──
  createRecord(req: CreateRecordRequest) {
    return this.json<CreateRecordResponse>('POST', '/api/vault/records', req);
  }
  listRecords() {
    return this.json<{ records: VaultRecordMeta[] }>('GET', '/api/vault/records');
  }
  getRecord(id: string) {
    return this.json<{ record: VaultRecord }>('GET', `/api/vault/records/${encodeURIComponent(id)}`);
  }
  async uploadBlob(ciphertext: Uint8Array, ownerWrappedKey: WrappedKey): Promise<CreateBlobResponse> {
    const res = await this.raw('POST', '/api/vault/blobs', {
      body: ciphertext as unknown as BodyInit,
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Owner-Wrapped-Key': toBase64(new TextEncoder().encode(JSON.stringify(ownerWrappedKey))),
      },
    });
    return (await res.json()) as CreateBlobResponse;
  }
  listBlobs() {
    return this.json<{ blobs: BlobMeta[] }>('GET', '/api/vault/blobs');
  }
  async downloadBlob(id: string): Promise<Uint8Array> {
    const res = await this.raw('GET', `/api/vault/blobs/${encodeURIComponent(id)}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  // ── ledger ──
  getLedgerEntry(id: string) {
    return this.json<{ entry: LedgerEntry }>('GET', `/api/ledger/entries/${encodeURIComponent(id)}`);
  }
  verifyLedger() {
    return this.json<LedgerVerifyResponse>('GET', '/api/ledger/verify');
  }
  ledgerHead() {
    return this.json<{ seq: number; entryHash: string }>('GET', '/api/ledger/head');
  }

  // ── attorneys & shares ──
  listAttorneys(state?: string) {
    const q = state ? `?state=${encodeURIComponent(state)}` : '';
    return this.json<{ attorneys: AttorneyProfile[] }>('GET', `/api/attorneys${q}`);
  }
  createShare(req: CreateShareRequest) {
    return this.json<{ share: Share; ledgerEntry: LedgerEntry }>('POST', '/api/shares', req);
  }
  listShares() {
    return this.json<{ shares: Share[] }>('GET', '/api/shares');
  }
  getShareBundle(id: string) {
    return this.json<ShareBundle>('GET', `/api/shares/${encodeURIComponent(id)}/bundle`);
  }
  renewShare(id: string, expiresInDays?: number) {
    return this.json<{ share: Share; ledgerEntry: LedgerEntry }>('POST', `/api/shares/${encodeURIComponent(id)}/renew`, { expiresInDays });
  }
  revokeShare(id: string) {
    return this.json<{ share: Share; ledgerEntry: LedgerEntry }>('POST', `/api/shares/${encodeURIComponent(id)}/revoke`);
  }

  // ── escrow ──
  listEscrow() {
    return this.json<{ entries: EscrowEntry[] }>('GET', '/api/escrow');
  }

  // ── sealed matching (survivor) ──
  matchingConfig() {
    return this.json<MatchingConfig>('GET', '/api/matching/config');
  }
  /** One of the two independent OPRF key holders ('a' / 'b'). */
  oprfEvaluate(holder: 'a' | 'b', req: OprfEvaluateRequest) {
    return this.json<OprfEvaluateResponse>('POST', `/api/matching/oprf-${holder}`, req);
  }
  createMatchEntry(req: CreateMatchEntryRequest) {
    return this.json<{ entry: EscrowEntry }>('POST', '/api/matching/entries', req);
  }
  /** Add seals for counselors who joined the roster after she sealed (owner only). */
  addMatchSeals(id: string, req: AddMatchSealsRequest) {
    return this.json<{ entry: EscrowEntry }>('POST', `/api/matching/entries/${encodeURIComponent(id)}/seals`, req);
  }
  listMatchEntries() {
    return this.json<{ entries: EscrowEntry[] }>('GET', '/api/matching/entries');
  }
  withdrawMatchEntry(id: string) {
    return this.json<{ ok: true }>('DELETE', `/api/matching/entries/${encodeURIComponent(id)}`);
  }

  // ── Legal Options Counselor ──
  counselorGroups() {
    return this.json<{ groups: CounselorMatchGroup[] }>('GET', '/api/counselor/groups');
  }
  addCounselorNote(groupId: string, req: { entryId?: string; envelope: Envelope }) {
    return this.json<{ note: CounselorNote }>('POST', `/api/counselor/groups/${encodeURIComponent(groupId)}/notes`, req);
  }

  // ── audit / account ──
  listAudit() {
    return this.json<{ events: AuditEvent[] }>('GET', '/api/audit');
  }
  deleteAccount() {
    return this.json<{ ok: true }>('POST', '/api/account/delete');
  }
}
