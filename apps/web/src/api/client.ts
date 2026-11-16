/**
 * Typed client for the Matra HTTP API (contract: packages/shared/src/index.ts).
 *
 * - Every request carries `Authorization: Bearer <token>` when a token is available.
 * - Non-2xx responses are thrown as `ApiError` (with the server's `{ error, code }` when present).
 * - The server only ever sees ciphertext (`Envelope`, `WrappedKey`, encrypted blobs).
 */
import { sha256Hex, toBase64 } from '@matra/crypto';
import type {
  AttorneyProfile,
  AttorneysResponse,
  AuditEvent,
  AuthResponse,
  BlobMeta,
  CreateBlobResponse,
  CounselorProfile,
  CreateRecordRequest,
  CreateRecordResponse,
  CreateShareRequest,
  GetSlotResponse,
  PutSlotRequest,
  PutSlotResponse,
  Envelope,
  LedgerEntry,
  LedgerProofRequest,
  LedgerProofResponse,
  LedgerVerifyResponse,
  LoginRequest,
  PreloginResponse,
  PublicUser,
  RecoverFinishRequest,
  RecoverStartRequest,
  RecoverStartResponse,
  RegisterRequest,
  SetUpRecoveryRequest,
  ChangePassphraseRequest,
  ChangePassphraseResponse,
  RevokeOtherSessionsRequest,
  SessionInfo,
  TurnOffRecoveryRequest,
  DeleteAccountRequest,
  Share,
  ShareBundle,
  RenewShareRequest,
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
  /**
   * Called when the server says the session a request was sent with no longer exists (401 unauthorized or
   * session_expired): it was signed out elsewhere (a passphrase change, "sign out everywhere else") or ran out.
   * Gets the token that request carried. Not called for a wrong passphrase (invalid_credentials).
   */
  onSessionEnded?: (token: string) => void;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly getToken: () => string | null | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly onSessionEnded?: (token: string) => void;

  constructor(opts: ApiClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? '';
    this.getToken = opts.getToken ?? (() => null);
    this.onSessionEnded = opts.onSessionEnded;
    // bind so `this` isn't lost when the global fetch is stored on an object
    this.fetchImpl = opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...(extra ?? {}) };
    const t = this.getToken();
    if (t) h['Authorization'] = `Bearer ${t}`;
    return h;
  }

  /** @internal shared with MatchingApiClient (api/matching.ts) */
  protected async raw(method: string, path: string, init: { body?: BodyInit; headers?: Record<string, string> } = {}) {
    let res: Response;
    const token = this.getToken();
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
      if (res.status === 401 && token && (code === 'unauthorized' || code === 'session_expired')) this.onSessionEnded?.(token);
      throw new ApiError(res.status, message, code);
    }
    return res;
  }

  /** @internal shared with MatchingApiClient (api/matching.ts) */
  protected async json<T>(method: string, path: string, body?: unknown): Promise<T> {
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

  // ── recovery code ──
  setUpRecovery(req: SetUpRecoveryRequest) {
    return this.json<{ user: PublicUser }>('POST', '/api/account/recovery', req);
  }
  turnOffRecovery(req: TurnOffRecoveryRequest) {
    return this.json<{ user: PublicUser }>('DELETE', '/api/account/recovery', req);
  }
  recoverStart(req: RecoverStartRequest) {
    return this.json<RecoverStartResponse>('POST', '/api/auth/recover/start', req);
  }
  recoverFinish(req: RecoverFinishRequest) {
    return this.json<AuthResponse>('POST', '/api/auth/recover/finish', req);
  }

  // ── passphrase change and signed-in sessions ──
  changePassphrase(req: ChangePassphraseRequest) {
    return this.json<ChangePassphraseResponse>('POST', '/api/account/passphrase', req);
  }
  listSessions() {
    return this.json<{ sessions: SessionInfo[] }>('GET', '/api/auth/sessions');
  }
  revokeOtherSessions(req: RevokeOtherSessionsRequest) {
    return this.json<{ endedSessions: number }>('POST', '/api/auth/sessions/revoke-others', req);
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
  /** Draft slots (lib/draftSlot.ts): `name` is her opaque slot name (packages/crypto slotName). */
  getSlot(name: string) {
    return this.json<GetSlotResponse>('GET', `/api/vault/slots/${encodeURIComponent(name)}`);
  }
  putSlot(name: string, req: PutSlotRequest) {
    return this.json<PutSlotResponse>('PUT', `/api/vault/slots/${encodeURIComponent(name)}`, req);
  }
  deleteSlot(name: string, expectedVersion?: string | null) {
    return this.json<{ ok: true }>('DELETE', `/api/vault/slots/${encodeURIComponent(name)}`, expectedVersion === undefined ? {} : { expectedVersion });
  }
  /** `commitment`: the SALTED commitment to her original file's hash (evidence/commitment.ts), never a plain hash. */
  async uploadBlob(ciphertext: Uint8Array, ownerWrappedKey: WrappedKey, commitment?: string): Promise<CreateBlobResponse> {
    const res = await this.raw('POST', '/api/vault/blobs', {
      body: ciphertext as unknown as BodyInit,
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Owner-Wrapped-Key': toBase64(new TextEncoder().encode(JSON.stringify(ownerWrappedKey))),
        ...(commitment && { 'X-Evidence-Commitment': commitment }),
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
  /** Public: sealed-content ledger entries for exactly these hashes, plus chain links to the head (the checker). */
  ledgerProof(contentHashes: string[]) {
    return this.json<LedgerProofResponse>('POST', '/api/ledger/proof', { contentHashes } satisfies LedgerProofRequest);
  }

  // ── attorneys & shares ──
  listAttorneys(state?: string) {
    const q = state ? `?state=${encodeURIComponent(state)}` : '';
    return this.json<AttorneysResponse>('GET', `/api/attorneys${q}`);
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
  /** With a fresh wrap (`recipientWrappedKey`, `blobs`) only when the share's keys were deleted (`share.keyDeleted`). */
  renewShare(id: string, req: RenewShareRequest = {}) {
    return this.json<{ share: Share; ledgerEntry: LedgerEntry }>('POST', `/api/shares/${encodeURIComponent(id)}/renew`, req);
  }
  revokeShare(id: string) {
    return this.json<{ share: Share; ledgerEntry: LedgerEntry }>('POST', `/api/shares/${encodeURIComponent(id)}/revoke`);
  }

  // ── audit / account ──
  listAudit() {
    return this.json<{ events: AuditEvent[] }>('GET', '/api/audit');
  }
  deleteAccount(req: DeleteAccountRequest) {
    return this.json<{ ok: true }>('POST', '/api/account/delete', req);
  }
}
