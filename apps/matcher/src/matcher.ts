/**
 * The matcher: decides which matched groups exist, when each is released, and which ONE counselor gets it
 * (docs/design/WEEKEND_MVP.md §3.5, docs/threat-model.md W15, W18). Public code; in production it is meant to run in a
 * confidential-computing enclave that attests to this code's measurement (simulated for now: attestation.ts).
 *
 * It holds only: entry ids, tags, pseudonymous survivor references, seal and account-creation times, and the two
 * states from each survivor's routing tag (opened here with the matcher key; the app server cannot open them). It never
 * sees identifiers, contact details, seals or user ids.
 *
 * ── Assignment (assignGroups, deterministic; run on every change and every read) ─────────────────────────────────
 *   1. An entry is eligible once it is releaseDelay old. A group exists when eligible entries with one tag come from
 *      ≥ 2 distinct survivor references.
 *   2. Sybil signals (accounts created within 24 h of each other; entries sealed < 7 days after their account) are
 *      recorded with the assignment for the counselor to weigh. They don't block release (a counselor judgment).
 *   3. Candidate states: the group's incident states by frequency (ties alphabetical), then its survivors' states the
 *      same way.
 *   4. For the first candidate state with at least one roster counselor licensed there (minus those excluded for this
 *      group), pick the one with the fewest open assignments; ties by lowest sha256(tag | counselorId).
 *   5. Reason `incident_state:NJ` / `survivor_state:NY`. Nobody licensed in any of the group's states → no counselor,
 *      `unassigned:no_licensed_counselor` (the group is not released); no states at all → `unassigned:no_state`.
 *   6. Sticky: an assignment stays while its counselor is on the roster, still licensed in one of the group's states,
 *      and has not declined. Otherwise it is reassigned with that counselor excluded and the reason prefixed
 *      `reassigned:`.
 *
 * Nothing this class returns from upsertEntry depends on whether the entry matched.
 */
import { createHash } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { fromBase64, normalizeLicensedStates, openRouting, toBase64, verifyCounselorRoster, type MatcherKeys } from '@matra/crypto';
import type { RoutingEnvelope, SignedCounselorRoster } from '@matra/shared';
import type { AssignmentRow, EntryRow, MatcherStore, RosterCounselor } from './store.js';

export const ASSIGNMENT_DOMAIN = 'matra/assignment/v1';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const HEX64 = /^[0-9a-f]{64}$/;

export interface MatcherEntryInput {
  entryId: string;
  /** 64 hex chars */
  tag: string;
  /** HMAC of the survivor's account id under the app server's pepper (64 hex chars) */
  survivorRef: string;
  createdAt: string;
  accountCreatedAt: string;
  /** her routing tag sealed to this matcher's key; null for an entry sealed before routing existed */
  routing: RoutingEnvelope | null;
}

export interface MatcherRosterInput {
  /** the organization-signed roster, if one exists */
  roster?: SignedCounselorRoster;
  /** counselors the app server currently treats as verified (a roster entry who is no longer verified is skipped) */
  verifiedIds: string[];
  /** UNPINNED development only: the app server's own list of counselors and the states they're licensed in */
  counselors?: RosterCounselor[];
}

export interface MatchSignals {
  accountsCreatedClose: boolean;
  newAccountEntries: number;
}

export interface MatcherAssignment {
  tag: string;
  counselorId: string;
  reason: string;
  assignedAt: string;
  signals: MatchSignals;
  /** base64 Ed25519 by the matcher's attested signKey over "matra/assignment/v1|tag|counselorId|assignedAt" */
  signature: string;
}

export class MatcherError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface MatcherOptions {
  store: MatcherStore;
  keys: MatcherKeys;
  /** entries count only once this old (MATRA_MATCH_RELEASE_DELAY_HOURS; the app server applies its own check too) */
  releaseDelayMs: number;
  /** pinned organization roster key (MATRA_COUNSELOR_ROSTER_PUBKEY): when set, only a validly signed roster is used */
  rosterKey?: Uint8Array;
  now?: () => number;
}

/** sha256(tag | counselorId) as hex: the deterministic tie-break between equally loaded counselors. */
const tieBreak = (tag: string, counselorId: string) => createHash('sha256').update(`${tag}|${counselorId}`).digest('hex');

/** States by how often they appear, ties alphabetical. */
function byFrequency(states: Array<string | null>): string[] {
  const n = new Map<string, number>();
  for (const s of states) if (s) n.set(s, (n.get(s) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([s]) => s);
}

const hourOf = (iso: string) => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) throw new MatcherError(400, 'invalid_request', 'invalid time');
  return new Date(Math.floor(t / HOUR) * HOUR).toISOString();
};

export class Matcher {
  private readonly store: MatcherStore;
  private readonly keys: MatcherKeys;
  private readonly releaseDelayMs: number;
  private readonly rosterKey?: Uint8Array;
  private readonly now: () => number;
  private warnedUnpinned = false;

  constructor(o: MatcherOptions) {
    this.store = o.store;
    this.keys = o.keys;
    this.releaseDelayMs = Math.max(0, o.releaseDelayMs);
    this.rosterKey = o.rosterKey;
    this.now = o.now ?? Date.now;
  }

  /**
   * Add (or replace) an entry. Its routing tag is opened here; one that does not open (another key, another entry's
   * tag, tampered) is kept as "no states", never an error, so the answer is the same whatever happens.
   */
  async upsertEntry(e: MatcherEntryInput): Promise<{ ok: true }> {
    if (typeof e?.entryId !== 'string' || !e.entryId || e.entryId.length > 64) throw new MatcherError(400, 'invalid_request', 'entryId');
    if (!HEX64.test(e.tag) || !HEX64.test(e.survivorRef)) throw new MatcherError(400, 'invalid_request', 'tag / survivorRef must be 64 hex chars');
    const createdAt = new Date(Date.parse(e.createdAt));
    if (!Number.isFinite(createdAt.getTime())) throw new MatcherError(400, 'invalid_request', 'createdAt');
    let incident: string | null = null;
    let survivor: string | null = null;
    if (e.routing) {
      try {
        const r = await openRouting(e.routing, this.keys.encPrivateJwk, e.tag);
        incident = r.incidentState ?? null;
        survivor = r.survivorState ?? null;
      } catch {
        /* unreadable routing data: routes as "no state" */
      }
    }
    this.store.transaction(() => {
      this.store.upsertEntry({
        entry_id: e.entryId,
        tag: e.tag,
        survivor_ref: e.survivorRef,
        created_at: createdAt.toISOString(),
        account_created_hour: hourOf(e.accountCreatedAt),
        incident_state: incident,
        survivor_state: survivor,
      });
      this.assignGroups();
    });
    return { ok: true };
  }

  removeEntry(entryId: string): { ok: true } {
    this.store.transaction(() => {
      this.store.deleteEntry(entryId);
      this.assignGroups();
    });
    return { ok: true };
  }

  /**
   * Replace the roster. With a pinned roster key the signed roster is required and authoritative (licensed states come
   * from it); a missing or badly signed one is refused and the previous roster stays. Unpinned (development): the app
   * server's list is used as given, with a warning.
   */
  putRoster(input: MatcherRosterInput): { ok: true; counselors: number } {
    const verified = new Set(Array.isArray(input?.verifiedIds) ? input.verifiedIds.map(String) : []);
    let list: RosterCounselor[];
    if (this.rosterKey) {
      const p = verifyCounselorRoster(input.roster, this.rosterKey);
      if (!p) throw new MatcherError(400, 'roster_invalid', 'the counselor roster is missing or not signed by the pinned organization key');
      list = p.counselors.filter((c) => verified.has(c.userId)).map((c) => ({ userId: c.userId, licensedStates: normalizeLicensedStates(c.licensedStates) }));
    } else {
      if (!this.warnedUnpinned) console.warn('[matcher] WARNING: no pinned counselor-roster key; using the app server’s counselor list (development only).');
      this.warnedUnpinned = true;
      list = (Array.isArray(input?.counselors) ? input.counselors : [])
        .filter((c) => typeof c?.userId === 'string' && verified.has(c.userId))
        .map((c) => ({ userId: c.userId, licensedStates: normalizeLicensedStates(c.licensedStates) }));
    }
    list.sort((a, b) => (a.userId < b.userId ? -1 : 1));
    this.store.transaction(() => {
      this.store.putRoster(input.roster, list);
      this.assignGroups();
    });
    return { ok: true, counselors: list.length };
  }

  /** Current assignments (released groups only: those with a counselor). */
  assignments(): MatcherAssignment[] {
    return this.store.transaction(() => {
      this.assignGroups();
      return this.store
        .assignments()
        .filter((a) => a.counselor_id)
        .map((a) => ({
          tag: a.tag,
          counselorId: a.counselor_id!,
          reason: a.reason,
          assignedAt: a.assigned_at,
          signals: JSON.parse(a.signals) as MatchSignals,
          signature: a.signature ?? '',
        }));
    });
  }

  /** Groups with no licensed counselor right now (ops sees the count only). */
  unassignedCount(): number {
    return this.store.assignments().filter((a) => !a.counselor_id).length;
  }

  /** The assigned counselor declines (conflict of interest): reassign the group with her excluded. */
  decline(tag: string, counselorId: string): { ok: true } {
    this.store.transaction(() => {
      this.assignGroups();
      const a = this.store.assignment(tag);
      if (!a || a.counselor_id !== counselorId) throw new MatcherError(404, 'assignment_not_found', 'No such assignment for this counselor.');
      const excluded = new Set(JSON.parse(a.excluded) as string[]);
      excluded.add(counselorId);
      this.store.putAssignment({ ...a, counselor_id: null, excluded: JSON.stringify([...excluded].sort()) });
      this.assignGroups();
    });
    return { ok: true };
  }

  /** Signature over one assignment with the matcher's attested signKey (verifiable by the counselor's client). */
  signAssignment(tag: string, counselorId: string, assignedAt: string): string {
    return toBase64(ed25519.sign(new TextEncoder().encode(`${ASSIGNMENT_DOMAIN}|${tag}|${counselorId}|${assignedAt}`), this.keys.signSecretKey));
  }

  /** The assignment algorithm (file comment). Call inside a store transaction. */
  private assignGroups(): void {
    const now = this.now();
    const cutoff = new Date(now - this.releaseDelayMs).toISOString();
    const byTag = new Map<string, EntryRow[]>();
    for (const e of this.store.eligibleEntries(cutoff)) byTag.set(e.tag, [...(byTag.get(e.tag) ?? []), e]);
    const groups = [...byTag.entries()].filter(([, es]) => new Set(es.map((e) => e.survivor_ref)).size >= 2);
    const live = new Set(groups.map(([tag]) => tag));
    const existing = new Map(this.store.assignments().map((a) => [a.tag, a]));
    // groups that dissolved (a withdrawal, a deleted account) lose their assignment
    for (const tag of existing.keys())
      if (!live.has(tag)) {
        this.store.deleteAssignment(tag);
        existing.delete(tag);
      }
    const roster = new Map(this.store.roster().map((c) => [c.userId, c.licensedStates]));
    const plans = groups.map(([tag, entries]) => {
      const candidates: Array<{ kind: 'incident' | 'survivor'; state: string }> = [
        ...byFrequency(entries.map((e) => e.incident_state)).map((state) => ({ kind: 'incident' as const, state })),
        ...byFrequency(entries.map((e) => e.survivor_state)).map((state) => ({ kind: 'survivor' as const, state })),
      ];
      const prev = existing.get(tag);
      // Sticky while her counselor is still on the roster, still licensed in one of the group's states, and has not
      // declined it.
      const keep =
        !!prev?.counselor_id &&
        !(JSON.parse(prev.excluded) as string[]).includes(prev.counselor_id) &&
        candidates.some((c) => roster.get(prev.counselor_id!)?.includes(c.state));
      return { tag, entries, candidates, prev, keep };
    });
    const load = new Map<string, number>();
    for (const p of plans) if (p.keep) load.set(p.prev!.counselor_id!, (load.get(p.prev!.counselor_id!) ?? 0) + 1);
    // oldest group first, so load balancing is deterministic
    plans.sort((a, b) =>
      a.entries[0]!.created_at < b.entries[0]!.created_at ? -1 : a.entries[0]!.created_at > b.entries[0]!.created_at ? 1 : a.tag < b.tag ? -1 : 1,
    );
    for (const { tag, entries, candidates, prev, keep } of plans) {
      const signals = JSON.stringify(this.signals(entries));
      if (keep) {
        if (prev!.signals !== signals) this.store.putAssignment({ ...prev!, signals });
        continue;
      }
      const excluded = new Set(prev ? (JSON.parse(prev.excluded) as string[]) : []);
      if (prev?.counselor_id) excluded.add(prev.counselor_id); // left the roster, or no longer licensed there
      const wasAssigned = excluded.size > 0;
      let pick: { counselorId: string; reason: string } | null = null;
      for (const c of candidates) {
        const licensed = [...roster.entries()].filter(([id, states]) => !excluded.has(id) && states.includes(c.state)).map(([id]) => id);
        if (!licensed.length) continue;
        licensed.sort((x, y) => (load.get(x) ?? 0) - (load.get(y) ?? 0) || (tieBreak(tag, x) < tieBreak(tag, y) ? -1 : 1));
        pick = { counselorId: licensed[0]!, reason: `${wasAssigned ? 'reassigned:' : ''}${c.kind}_state:${c.state}` };
        break;
      }
      const assignedAt = new Date(now).toISOString();
      if (pick) load.set(pick.counselorId, (load.get(pick.counselorId) ?? 0) + 1);
      this.store.putAssignment({
        tag,
        counselor_id: pick?.counselorId ?? null,
        reason: pick?.reason ?? (candidates.length ? 'unassigned:no_licensed_counselor' : 'unassigned:no_state'),
        assigned_at: assignedAt,
        excluded: JSON.stringify([...excluded].sort()),
        signals,
        signature: pick ? this.signAssignment(tag, pick.counselorId, assignedAt) : null,
      });
    }
  }

  private signals(entries: EntryRow[]): MatchSignals {
    const created = entries.map((e) => Date.parse(e.account_created_hour)).sort((a, b) => a - b);
    return {
      accountsCreatedClose: created.some((t, i) => i > 0 && t - created[i - 1]! < DAY),
      newAccountEntries: entries.filter((e) => Date.parse(e.created_at) - Date.parse(e.account_created_hour) < 7 * DAY).length,
    };
  }
}

/** Verify a signed assignment (the counselor's client, once it has verified the matcher's attestation). */
export function verifyAssignmentSignature(a: Pick<MatcherAssignment, 'tag' | 'counselorId' | 'assignedAt' | 'signature'>, signKey: string): boolean {
  try {
    return ed25519.verify(fromBase64(a.signature), new TextEncoder().encode(`${ASSIGNMENT_DOMAIN}|${a.tag}|${a.counselorId}|${a.assignedAt}`), fromBase64(signKey));
  } catch {
    return false;
  }
}
