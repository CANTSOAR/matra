/**
 * The sealed-matching part of the API client: phone verification, OPRF evaluation, sealed entries, the counselor
 * portal and staged report release (contract: packages/shared/src/index.ts).
 *
 * Kept apart from ApiClient on purpose. Only builds with MATRA_MATCHING=on use it (lib/session.tsx makes a
 * MatchingApiClient only when `__MATRA_MATCHING__` is true), so a matching-off build carries none of these routes
 * (scripts/audit-web-build.mjs checks that).
 */
import type {
  AddMatchSealsRequest,
  AttestationDocument,
  ConflictCheckRequest,
  CounselorMatchGroup,
  CounselorNote,
  CounselorReportRequest,
  CreateMatchEntryRequest,
  Envelope,
  EscrowEntry,
  LedgerEntry,
  MatchingConfig,
  OprfEvaluateRequest,
  OprfEvaluateResponse,
  PhoneVerificationStartResponse,
  PhoneVerificationStatus,
  ReportConsentRequest,
  ReportRelease,
  ReportReleaseBundle,
  SurvivorReportRelease,
  SurvivorReportRequest,
} from '@matra/shared';
import { ApiClient } from './client';

export class MatchingApiClient extends ApiClient {
  // ── escrow ──
  listEscrow() {
    return this.json<{ entries: EscrowEntry[] }>('GET', '/api/escrow');
  }

  // ── sealed matching (survivor) ──
  /** Phone verify-then-forget before sealed matching (counselor/PhoneVerify.tsx). */
  phoneVerificationStatus() {
    return this.json<PhoneVerificationStatus>('GET', '/api/matching/verification');
  }
  startPhoneVerification(phone: string) {
    return this.json<PhoneVerificationStartResponse>('POST', '/api/matching/verification/start', { phone });
  }
  checkPhoneVerification(challengeId: string, code: string) {
    return this.json<{ verified: true }>('POST', '/api/matching/verification/check', { challengeId, code });
  }
  matchingConfig() {
    return this.json<MatchingConfig>('GET', '/api/matching/config');
  }
  /** The matcher's attestation document for this nonce (proxied by the app server; verified by the caller). */
  matcherAttestation(nonce: string) {
    return this.json<AttestationDocument>('GET', `/api/matching/attestation?nonce=${encodeURIComponent(nonce)}`);
  }
  /** OPRF key holder `index` (1..m) of the threshold OPRF; the app server relays to it. */
  oprfEvaluate(index: number, req: OprfEvaluateRequest) {
    return this.json<OprfEvaluateResponse>('POST', `/api/matching/oprf/${index}`, req);
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
  /** decline an assigned group (conflict of interest): the matcher passes it to another counselor */
  declineCounselorGroup(groupId: string) {
    return this.json<{ ok: true }>('POST', `/api/counselor/groups/${encodeURIComponent(groupId)}/decline`);
  }
  /** Staged release: her conflict check for a group ('clear' releases contact details to her; 'conflict' passes it on). */
  counselorConflictCheck(groupId: string, req: ConflictCheckRequest) {
    return this.json<{ ok: true; result: ConflictCheckRequest['result'] }>('POST', `/api/counselor/groups/${encodeURIComponent(groupId)}/conflict-check`, req);
  }
  /** Stage 2: ask one survivor (whom she has already spoken with) for her full report. */
  requestSurvivorReport(groupId: string, entryId: string) {
    return this.json<{ request: CounselorReportRequest }>('POST', `/api/counselor/groups/${encodeURIComponent(groupId)}/report-requests`, {
      entryId,
      expected: true,
    });
  }
  cancelReportRequest(id: string) {
    return this.json<{ request: CounselorReportRequest }>('POST', `/api/counselor/report-requests/${encodeURIComponent(id)}/cancel`);
  }
  counselorReleases() {
    return this.json<{ releases: ReportRelease[] }>('GET', '/api/counselor/releases');
  }
  counselorReleaseBundle(id: string) {
    return this.json<ReportReleaseBundle>('GET', `/api/counselor/releases/${encodeURIComponent(id)}/bundle`);
  }
  async counselorReleaseBlob(id: string, blobId: string): Promise<Uint8Array> {
    const res = await this.raw('GET', `/api/counselor/releases/${encodeURIComponent(id)}/blobs/${encodeURIComponent(blobId)}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  // ── report requests (survivor side of staged release) ──
  reportRequests() {
    return this.json<{ requests: SurvivorReportRequest[] }>('GET', '/api/report-requests');
  }
  consentReportRequest(id: string, req: ReportConsentRequest) {
    return this.json<{ release: SurvivorReportRelease; ledgerEntry: LedgerEntry }>('POST', `/api/report-requests/${encodeURIComponent(id)}/consent`, req);
  }
  declineReportRequest(id: string) {
    return this.json<{ request: SurvivorReportRequest }>('POST', `/api/report-requests/${encodeURIComponent(id)}/decline`);
  }
  revokeReportRelease(id: string) {
    return this.json<{ release: SurvivorReportRelease; ledgerEntry: LedgerEntry }>('POST', `/api/report-releases/${encodeURIComponent(id)}/revoke`);
  }
}

/** The session's client, as the matching client. Throws in a build without sealed matching (it is never made there). */
export function matchingApi(api: ApiClient): MatchingApiClient {
  if (!(api instanceof MatchingApiClient)) throw new Error('Sealed matching is not part of this build.');
  return api;
}
