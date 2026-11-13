/**
 * The app server's side of the matcher service (apps/matcher; docs/design/WEEKEND_MVP.md §3.5, threat model W18).
 *
 * The app server forwards each sealed entry's tag, a pseudonymous survivor reference, its times and her sealed routing
 * tag to the matcher, and asks it which groups are released to which ONE counselor. Two transports:
 *   InProcessMatcher  the matcher code inside this process, with its own (in-memory or file) database: development,
 *                     tests, a single-host demo. The app server then holds the matcher key: NO separation.
 *   HttpMatcher       a separate matcher process (MATRA_MATCHER_URL), bearer token MATRA_MATCHER_TOKEN.
 *
 * Before forwarding anything, the app server verifies the matcher's attestation (MatcherGate) against its own pins
 * (MATRA_ATTESTATION_PLATFORM_PUBKEY, MATRA_MATCHER_MEASUREMENT), at first use and every 10 minutes; on failure it
 * stops forwarding (entries stay matcher_synced = 0) and logs why. Survivors' clients check the same attestation
 * themselves before sealing routing data (packages/crypto verifiedMatcher).
 */
import {
  AttestationError,
  matcherKeysFromSeed,
  newAttestationNonce,
  verifyAttestation,
} from '@matra/crypto';
import type { AttestationDocument, InspectorProcess } from '@matra/shared';
import {
  SimulatedAttester,
  computeMeasurement,
  createMatcher,
  matcherDebugState,
  type AttestationProvider,
  type Matcher,
  type MatcherAssignment,
  type MatcherEntryInput,
  type MatcherRosterInput,
} from '@matra/matcher';

export type { MatcherAssignment, MatcherEntryInput, MatcherRosterInput };

export interface MatcherClient {
  readonly kind: 'in-process' | 'http';
  attestation(nonce: string): Promise<AttestationDocument>;
  upsertEntry(e: MatcherEntryInput): Promise<void>;
  removeEntry(entryId: string): Promise<void>;
  putRoster(r: MatcherRosterInput): Promise<void>;
  assignments(): Promise<MatcherAssignment[]>;
  /** the assigned counselor declines the group (conflict check, staged-release): reassigned with her excluded */
  decline(tag: string, counselorId: string): Promise<void>;
  /** dev/demo inspector only (apps/matcher src/debug.ts): what the matcher holds */
  debugState?(): Promise<InspectorProcess>;
}

export class InProcessMatcher implements MatcherClient {
  readonly kind = 'in-process' as const;
  readonly matcher: Matcher;
  private readonly store: ReturnType<typeof createMatcher>['store'];
  readonly attester: AttestationProvider;
  constructor(o: {
    /** the matcher's own DB (default ':memory:': the app server re-sends every entry at startup) */
    dbPath?: string;
    /** 32-byte MATRA_MATCHER_KEY */
    key: Uint8Array;
    /** 32-byte simulated platform key (MATRA_ATTESTATION_PLATFORM_KEY) */
    platformSecretKey: Uint8Array;
    releaseDelayMs: number;
    rosterKey?: Uint8Array;
    /** default: the measurement of apps/matcher as it is on disk */
    measurement?: string;
  }) {
    const keys = matcherKeysFromSeed(o.key);
    const created = createMatcher({ dbPath: o.dbPath ?? ':memory:', keys, releaseDelayMs: o.releaseDelayMs, rosterKey: o.rosterKey });
    this.matcher = created.matcher;
    this.store = created.store;
    this.attester = new SimulatedAttester({ platformSecretKey: o.platformSecretKey, measurement: o.measurement ?? computeMeasurement(), keys });
  }
  attestation(nonce: string) {
    return this.attester.attest(nonce);
  }
  async upsertEntry(e: MatcherEntryInput) {
    await this.matcher.upsertEntry(e);
  }
  async removeEntry(entryId: string) {
    this.matcher.removeEntry(entryId);
  }
  async putRoster(r: MatcherRosterInput) {
    this.matcher.putRoster(r);
  }
  async assignments() {
    return this.matcher.assignments();
  }
  async decline(tag: string, counselorId: string) {
    this.matcher.decline(tag, counselorId);
  }
  async debugState() {
    const s = await matcherDebugState(this.store, this.attester);
    return { ...s, name: 'Matcher (in-process)', note: `Runs INSIDE the app server (development): no separation. ${s.note}` };
  }
}

export class HttpMatcher implements MatcherClient {
  readonly kind = 'http' as const;
  constructor(private readonly o: { url: string; token: string; timeoutMs?: number }) {}
  private async call<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    const res = await fetch(`${this.o.url.replace(/\/+$/, '')}${path}`, {
      method,
      headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...(auth && { Authorization: `Bearer ${this.o.token}` }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(this.o.timeoutMs ?? 5000),
    });
    if (!res.ok) throw Object.assign(new Error(`matcher ${method} ${path.split('?')[0]!.replace(/\/[0-9a-f]{32,64}(?=\/|$)/g, '/:id')} → ${res.status}`), { status: res.status });
    return (await res.json()) as T;
  }
  attestation(nonce: string) {
    return this.call<AttestationDocument>('GET', `/v1/attestation?nonce=${encodeURIComponent(nonce)}`, undefined, false);
  }
  async upsertEntry(e: MatcherEntryInput) {
    await this.call('POST', '/v1/entries', e);
  }
  async removeEntry(entryId: string) {
    await this.call('DELETE', `/v1/entries/${encodeURIComponent(entryId)}`);
  }
  async putRoster(r: MatcherRosterInput) {
    await this.call('PUT', '/v1/roster', r);
  }
  async assignments() {
    return (await this.call<{ assignments: MatcherAssignment[] }>('GET', '/v1/assignments')).assignments;
  }
  async decline(tag: string, counselorId: string) {
    await this.call('POST', `/v1/assignments/${encodeURIComponent(tag)}/decline`, { counselorId });
  }
  debugState() {
    return this.call<InspectorProcess>('GET', '/v1/debug/state');
  }
}

export interface MatcherPins {
  /** base64 Ed25519 platform key (MATRA_ATTESTATION_PLATFORM_PUBKEY) */
  platformKey?: string;
  /** hex measurement of the published matcher build (MATRA_MATCHER_MEASUREMENT) */
  measurement?: string;
  /** accept platform 'simulated' (development, or MATRA_DEMO_MODE=1) */
  allowSimulated: boolean;
}

const RECHECK_MS = 10 * 60_000;
const RETRY_MS = 60_000;

/**
 * The app server's attestation check: verified at first use, re-verified every 10 minutes (a failure is retried after
 * a minute). `ok()` is false while the matcher's attestation does not verify; nothing is forwarded then.
 */
export class MatcherGate {
  private checkedAt = -Infinity;
  private good = false;
  private lastProblem = '';
  private warnedUnpinned = false;
  constructor(
    private readonly client: MatcherClient,
    private readonly pins: MatcherPins,
    private readonly now: () => number = Date.now,
  ) {}

  async ok(): Promise<boolean> {
    const t = this.now();
    if (t - this.checkedAt < (this.good ? RECHECK_MS : RETRY_MS)) return this.good;
    this.checkedAt = t;
    if (!this.pins.platformKey && !this.pins.measurement && !this.warnedUnpinned) {
      console.warn('[matra] WARNING: no pinned matcher attestation (MATRA_ATTESTATION_PLATFORM_PUBKEY / MATRA_MATCHER_MEASUREMENT); trusting the matcher as it is (development only).');
      this.warnedUnpinned = true;
    }
    try {
      const nonce = newAttestationNonce();
      verifyAttestation(await this.client.attestation(nonce), {
        nonce,
        platformKey: this.pins.platformKey,
        expectedMeasurement: this.pins.measurement,
        allowSimulated: this.pins.allowSimulated,
      });
      if (!this.good && this.lastProblem) console.log('[matra] matcher attestation verifies again; forwarding entries.');
      this.good = true;
      this.lastProblem = '';
    } catch (e) {
      const problem = e instanceof AttestationError ? `${e.code}: ${e.message}` : `unreachable: ${(e as Error).message}`;
      if (problem !== this.lastProblem) console.warn(`[matra] matcher attestation failed (${problem}); not forwarding sealed entries to it.`);
      this.lastProblem = problem;
      this.good = false;
    }
    return this.good;
  }

  /** Forget the last result (tests; an operator re-pin). */
  reset(): void {
    this.checkedAt = -Infinity;
  }
}
