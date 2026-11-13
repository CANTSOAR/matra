/**
 * Legal Options Counselor portal (Callisto's "LOC" role, carried forward).
 *
 * The server releases ONLY matched groups (≥ 2 distinct survivors named the same unique identifier) that the matcher
 * assigned to THIS counselor (by state: licensed where it happened, else where a survivor lives; apps/matcher), and only
 * the seals addressed to her. The matcher's reason is shown in plain words (assignmentWords). Everything is opened here, on the counselor's device, with the counselor's
 * private key: the two shares are interpolated to recover the per-perpetrator key, which opens each survivor's
 * summary bundle (packages/crypto/src/matching.ts, reconstructMatchGroup). Outreach notes are encrypted under the
 * counselor's own master key before they are saved.
 *
 * Staged release (docs/design/WEEKEND_MVP.md §3.6; W1, W21), in the order the counselor meets it:
 *   1. What matched: the identifier, each person's states and HOW they'd like to be contacted (methods only).
 *   2. Conflict check: she records "no conflict" (or passes the group on) before any name, number or email is shown.
 *      The server withholds each person's contact ciphertext until then (a server gate, not a cryptographic one).
 *   3. Contact details, outreach notes, and "ask for their full report" once she has spoken with them.
 *   4. Reports a person chose to share with her alone (CounselorReport.tsx).
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  decryptJSON,
  encryptJSON,
  publicKeyFingerprint,
  reconstructMatchGroup,
  type ReconstructedBundle,
  type ReconstructResult,
} from '@matra/crypto';
import type { CounselorMatchGroup, CounselorNote, MatchContactDetails, MatchSummaryBundle, ReportRelease } from '@matra/shared';
import { ErrorNote, Loading, PageTitle, formatDate, useAsync } from '../components/common';
import { CONFLICT_CHECK_STATEMENT } from '../lib/disclosures';
import { friendlyError, useRequiredSession } from '../lib/session';
import { US_STATES } from '../intake/script';
export { CounselorGate, CounselorSignIn, RequireCounselor } from './guards';

const stateName = (code: string) => US_STATES.find((s) => s.value === code)?.label ?? code;

/**
 * The matcher's reason, in plain words: `incident_state:NJ`, `survivor_state:NY`, `fallback:no_state` (nobody in the
 * group gave a state), each possibly prefixed `reassigned:` (the counselor first assigned declined or left the roster).
 */
export function assignmentWords(reason: string): string {
  const reassigned = reason.startsWith('reassigned:');
  const [kind, code] = reason.replace(/^reassigned:/, '').split(':');
  const where =
    kind === 'incident_state'
      ? `this happened in ${stateName(code ?? '')}, where you’re licensed`
      : kind === 'survivor_state'
        ? `someone in this group lives in ${stateName(code ?? '')}, where you’re licensed (no counselor licensed where it happened was available)`
        : kind === 'fallback' && code === 'no_state'
          ? 'nobody in this group said where it happened or where they live, so it went to the counselor with the fewest open groups. Check that you can advise them before you reach out'
          : 'of how the matcher routed it';
  return `${reassigned ? 'Reassigned' : 'Assigned'} to you because ${where}.${reassigned ? ' The counselor it went to first could not take it.' : ''}`;
}

export function EthicsBanner() {
  return (
    <section className="card warn stack" aria-labelledby="ethics" data-testid="counselor-ethics">
      <h2 id="ethics">Before you reach out</h2>
      <ul className="small" style={{ margin: 0, paddingLeft: '1.2em' }}>
        <li>
          You are independent of schools, employers and the police. Nothing here is reported to anyone, and you never
          contact an institution on a survivor’s behalf without their clear, informed request.
        </li>
        <li>
          Contact each survivor <strong>separately</strong>, only in the way they asked. Never tell one survivor who the
          other is, or share anything they told you, unless <strong>both</strong> have said yes.
        </li>
        <li>
          A match is a lead, not evidence. Someone could create accounts to fake one, so check that it makes sense before
          you reach out, and never treat it as proof of what happened.
        </li>
        <li>
          Before you confirm anything to anyone, do plausibility checks: does each person’s account fit the identifier,
          the place and the time? Treat any warning on a group (decoy, new accounts, differing identifiers) as a reason
          to slow down, and report it to Matra.
        </li>
        <li>
          Be wary of a card whose own contact details are the very identifier that was named — it may be the named
          person, not a survivor.
        </li>
        <li>Your role is to explain their options — including doing nothing. They decide everything.</li>
      </ul>
    </section>
  );
}

const NOTE_STATUS: Record<string, string> = {
  not_contacted: 'Not contacted yet',
  reached_out: 'Reached out',
  spoke: 'Spoke with them',
  declined: 'They declined further contact',
  unreachable: 'Could not reach them',
};

interface NotePlain {
  status: keyof typeof NOTE_STATUS;
  text?: string;
}

export function CounselorPortal() {
  const { api, session } = useRequiredSession();
  const me = useAsync(() => api.me(), [api]);
  const fp = useAsync(() => publicKeyFingerprint(session.user.publicKey), [session.user.publicKey]);
  const groups = useAsync(() => api.counselorGroups().then((r) => r.groups), [api]);
  const releases = useAsync(() => api.counselorReleases().then((r) => r.releases), [api]);
  const profile = me.data?.counselorProfile;
  const [declined, setDeclined] = useState(false);
  const reload = () => {
    void groups.reload();
    void releases.reload();
  };

  return (
    <div className="stack-lg">
      <PageTitle
        eyebrow="Legal options counselor"
        lead={profile ? `${profile.displayName}${profile.organization ? ` · ${profile.organization}` : ''}` : undefined}
      >
        Matched sealed reports
      </PageTitle>
      <EthicsBanner />
      <div className="card sage small stack">
        <p style={{ margin: 0 }}>
          <strong>Your key fingerprint:</strong> <span className="fingerprint">{fp.data ?? '…'}</span>
        </p>
        <p style={{ margin: 0 }}>
          Matra only ever sends you groups where at least two different people independently named the same person. You
          never receive single, unmatched entries. Each group is opened on this device with your private key.
        </p>
        <p style={{ margin: 0 }}>
          A group opens in stages: first what matched and how each person would like to be contacted; their contact
          details after you record a conflict check; and a full report only if that person, alone, says yes.
        </p>
      </div>
      {groups.loading && <Loading />}
      {groups.error && <ErrorNote>{groups.error}</ErrorNote>}
      {groups.data && groups.data.length === 0 && <p className="muted">No matches right now.</p>}
      {declined && (
        <p className="card sage small" role="status" data-testid="counselor-declined">
          You declined a group. It will be offered to another counselor; you won’t be given it again.
        </p>
      )}
      {groups.data?.map((g, i) => (
        <MatchGroup
          key={g.id}
          group={g}
          index={i + 1}
          onChanged={reload}
          onDeclined={() => {
            setDeclined(true);
            reload();
          }}
        />
      ))}
      <SharedReports releases={releases.data} error={releases.error} />
    </div>
  );
}

/** Stage 2 results: reports individual survivors chose to share with this counselor. */
function SharedReports({ releases, error }: { releases?: ReportRelease[]; error?: string }) {
  const live = (releases ?? []).filter((r) => r.status === 'active' && Date.parse(r.expiresAt) > Date.now());
  const ended = (releases ?? []).filter((r) => !live.includes(r));
  if (!error && !releases?.length) return null;
  return (
    <section className="card stack" aria-labelledby="shared-reports" data-testid="counselor-releases">
      <h2 id="shared-reports">Reports shared with you</h2>
      {error && <ErrorNote>{error}</ErrorNote>}
      <p className="small muted" style={{ margin: 0 }}>
        Each was shared by one person, with you only. They see every time you open it, and can stop sharing at any time.
      </p>
      <ul className="list">
        {live.map((r) => (
          <li key={r.id} className="row" style={{ justifyContent: 'space-between' }}>
            <span className="small">
              Shared {formatDate(r.createdAt)} · access until {formatDate(r.expiresAt)}
              {r.firstOpenedAt ? '' : ' · not opened yet'}
            </span>
            <Link className="btn btn-small btn-primary" to={`/counselor/reports/${r.id}`}>
              Open report
            </Link>
          </li>
        ))}
        {ended.map((r) => (
          <li key={r.id} className="small muted">
            Shared {formatDate(r.createdAt)} ·{' '}
            {r.status !== 'revoked'
              ? `access ended ${formatDate(r.expiresAt)}`
              : r.revokeReason && r.revokeReason !== 'survivor'
                ? `access ended ${formatDate(r.revokedAt)}`
                : `they stopped sharing ${formatDate(r.revokedAt)}`}
          </li>
        ))}
      </ul>
    </section>
  );
}

function MatchGroup({ group, index, onChanged, onDeclined }: { group: CounselorMatchGroup; index: number; onChanged(): void; onDeclined(): void }) {
  const { session } = useRequiredSession();
  const [wantOpen, setWantOpen] = useState(false);
  const [state, setState] = useState<{ busy?: boolean; result?: ReconstructResult; error?: string }>({});
  // (Re)open on this device whenever the server's view of the group changes: after the conflict check the same group
  // comes back with each person's contact ciphertext.
  useEffect(() => {
    if (!wantOpen) return;
    let alive = true;
    setState((s) => ({ ...s, busy: true, error: undefined }));
    reconstructMatchGroup(group.tag, group.entries, session.privateKey, session.user.id).then(
      (result) => alive && setState({ result }),
      (e: unknown) => alive && setState({ error: friendlyError(e) }),
    );
    return () => {
      alive = false;
    };
  }, [wantOpen, group, session.privateKey, session.user.id]);
  const r = state.result;
  const clear = group.conflictCheck?.result === 'clear';
  const first = r?.ok ? r.bundles[0]?.summary.identifier : undefined;
  const alerts = r ? r.alerts.map((a) => ALERT_WORDS[a]) : [];
  const sig = group.signals;
  const states = r?.ok ? [...new Set(r.bundles.flatMap((b) => [b.summary.states.incident, b.summary.states.survivor]).filter((s): s is string => !!s))] : [];
  return (
    <section className="card stack" aria-labelledby={`g-${group.id}`} data-testid="counselor-group">
      <div className="section-title">
        <h2 id={`g-${group.id}`}>Match {index}</h2>
        {/* Only verified, distinct survivors are counted (L2) — never the raw number of entries the server sent. */}
        <span className="badge care">{r?.ok ? `${r.people} ${r.people === 1 ? 'person' : 'people'}` : 'Sealed group'}</span>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Matched {formatDate(group.matchedAt)}
        {first && <> · on {first.kind === 'social' ? 'a social media profile' : first.kind === 'phone' ? 'a phone number' : 'an email address'}</>}
      </p>
      {group.assignment && (
        <p className="small" style={{ margin: 0 }} data-testid="counselor-assignment">
          {assignmentWords(group.assignment.reason)} The matcher assigned this group to you.
        </p>
      )}
      {sig && (sig.accountsCreatedClose || sig.newAccountEntries > 0) && (
        <div className="card warn small" data-testid="counselor-sybil-signals">
          <strong>Check carefully:</strong>{' '}
          {sig.accountsCreatedClose && 'some of these reports come from accounts created within a day of each other. '}
          {sig.newAccountEntries > 0 &&
            `${sig.newAccountEntries === 1 ? 'One report was' : `${sig.newAccountEntries} reports were`} sealed less than a week after the account was created. `}
          New or near-simultaneous accounts can be a sign that someone created accounts to fake a match.
        </div>
      )}
      {!r && (
        <div>
          <button className="btn btn-primary btn-small" onClick={() => setWantOpen(true)} disabled={state.busy}>
            {state.busy ? 'Opening with your private key…' : 'Open with my private key'}
          </button>
        </div>
      )}
      {state.error && <ErrorNote>{state.error}</ErrorNote>}
      {r && !r.ok && (
        <ErrorNote>
          This group could not be opened: at least one entry did not verify. It may be malformed or tampered with. Do not
          contact anyone based on it; report it to Matra.
        </ErrorNote>
      )}
      {alerts.length > 0 && (
        <div className="card warn stack" role="alert" data-testid="counselor-group-alert">
          <strong>Possible decoy or tampering — do not contact anyone until you have checked this group.</strong>
          <ul className="small" style={{ margin: 0, paddingLeft: '1.2em' }}>
            {alerts.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      {r?.ok && (
        <>
          <h3 style={{ margin: 0 }}>What matched</h3>
          {r.canonicals.length === 1 && first && (
            <p className="small" style={{ margin: 0 }}>
              Identifier named: <span className="mono">{first.canonical}</span>
            </p>
          )}
          {r.failed.length > 0 && (
            <ErrorNote>
              {r.failed.length === 1 ? 'One entry' : `${r.failed.length} entries`} in this group did not verify and {r.failed.length === 1 ? 'is' : 'are'} not
              shown. It may be malformed or fake.
            </ErrorNote>
          )}
          {clear ? (
            <div className="small stack" data-testid="counselor-conflict-done">
              <p style={{ margin: 0 }}>
                Conflict check recorded {formatDate(group.conflictCheck!.at)}: no conflict. Contact details are shown below.
              </p>
              <DeclineGroup groupId={group.id} onDeclined={onDeclined} />
            </div>
          ) : (
            <ConflictCheck groupId={group.id} canonicals={r.canonicals} states={states} onClear={onChanged} onDeclined={onDeclined} />
          )}
          <p className="small muted" style={{ margin: 0 }}>
            Each card is a different person. Reach out to each one separately; don’t mention the other.
          </p>
          {r.bundles.map((b, i) => (
            <SurvivorCard
              key={b.entryId}
              n={i + 1}
              group={group}
              opened={b}
              clear={clear}
              notes={group.notes.filter((x) => x.entryId === b.entryId)}
              onChanged={onChanged}
            />
          ))}
        </>
      )}
    </section>
  );
}

/**
 * Stage 1 → 1b. She checks the identifier(s) and states against her own conflicts records, outside Matra, and records
 * the result. Contact details come only after "no conflict" (the server withholds them until then: W21).
 */
function ConflictCheck(props: { groupId: string; canonicals: string[]; states: string[]; onClear(): void; onDeclined(): void }) {
  const { api } = useRequiredSession();
  const [st, setSt] = useState<{ busy?: boolean; error?: string; confirmConflict?: boolean }>({});
  async function record(result: 'clear' | 'conflict') {
    setSt((s) => ({ ...s, busy: true, error: undefined }));
    try {
      await api.counselorConflictCheck(props.groupId, { result, statementVersion: CONFLICT_CHECK_STATEMENT.version });
      if (result === 'clear') props.onClear();
      else props.onDeclined();
    } catch (e) {
      setSt((s) => ({ ...s, busy: false, error: friendlyError(e) }));
    }
  }
  return (
    <div className="card warm stack" data-testid="counselor-conflict-check">
      <h3 style={{ margin: 0 }}>Conflict check</h3>
      <p className="small" style={{ margin: 0 }}>
        Identifier{props.canonicals.length === 1 ? '' : 's'} to check:{' '}
        {props.canonicals.map((c) => (
          <span key={c} className="mono">
            {c}{' '}
          </span>
        ))}
        {props.states.length > 0 && <> · States: {props.states.map(stateName).join(', ')}</>}
      </p>
      <ul className="small" style={{ margin: 0, paddingLeft: '1.2em' }}>
        {CONFLICT_CHECK_STATEMENT.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {st.error && <ErrorNote>{st.error}</ErrorNote>}
      {!st.confirmConflict ? (
        <div className="row">
          <button className="btn btn-primary btn-small" onClick={() => void record('clear')} disabled={st.busy}>
            I have no conflict
          </button>
          <button className="btn btn-small" onClick={() => setSt({ confirmConflict: true })} disabled={st.busy}>
            I have a conflict
          </button>
        </div>
      ) : (
        <div className="card warn stack">
          <p style={{ margin: 0 }}>Pass this group to another counselor? You won’t be given it again.</p>
          <div className="row">
            <button className="btn btn-primary btn-small" onClick={() => void record('conflict')} disabled={st.busy}>
              {st.busy ? 'Passing it on…' : 'Yes, pass it on'}
            </button>
            <button className="btn btn-quiet btn-small" onClick={() => setSt({})} disabled={st.busy}>
              Go back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A conflict found after the check (before or after contacting anyone): the group is passed on, as with "I have a conflict". */
function DeclineGroup({ groupId, onDeclined }: { groupId: string; onDeclined(): void }) {
  const { api } = useRequiredSession();
  const [decline, setDecline] = useState<{ asking?: boolean; busy?: boolean; error?: string }>({});
  async function confirmDecline() {
    setDecline({ asking: true, busy: true });
    try {
      await api.counselorConflictCheck(groupId, { result: 'conflict', statementVersion: CONFLICT_CHECK_STATEMENT.version });
      onDeclined();
    } catch (e) {
      setDecline({ asking: true, error: friendlyError(e) });
    }
  }
  return (
    <div className="small stack" data-testid="counselor-decline">
      {!decline.asking ? (
        <div>
          <button className="btn btn-quiet btn-small" onClick={() => setDecline({ asking: true })}>
            I can’t take this group (conflict of interest)
          </button>
        </div>
      ) : (
        <div className="card warn stack">
          <p style={{ margin: 0 }}>
            Decline this group? It will be passed to another counselor, and you won’t be given it again. Requests you sent
            that haven’t been answered are withdrawn.
          </p>
          {decline.error && <ErrorNote>{decline.error}</ErrorNote>}
          <div className="row">
            <button className="btn btn-primary btn-small" onClick={() => void confirmDecline()} disabled={decline.busy}>
              {decline.busy ? 'Declining…' : 'Yes, decline this group'}
            </button>
            <button className="btn btn-quiet btn-small" onClick={() => setDecline({})} disabled={decline.busy}>
              Keep it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const METHOD_WORDS: Record<string, string> = { call: 'Phone call', text: 'Text message', email: 'Email', voicemail: 'Voicemail is OK' };

/** What each reconstruction alert means, in the counselor's words. */
const ALERT_WORDS: Record<ReconstructResult['alerts'][number], string> = {
  multiple_lines: 'More than one consistent set of reports exists under this identifier. Someone may have created accounts to plant a decoy.',
  foreign_line: 'Some entries were built to look like a match but don’t belong to it (a likely decoy). They are not shown.',
  off_line_share: 'At least one report opened but doesn’t line up with the others. It is marked below.',
  duplicate_share: 'The same report appeared more than once. It is shown and counted once.',
  identifier_mismatch: 'The reports name different identifiers (shown on each card). Check that they really refer to the same person.',
};

const contactMatchesIdentifier = (identifier: MatchSummaryBundle['identifier'], contact: MatchContactDetails) => {
  const c = identifier.canonical.toLowerCase();
  const digits = (v?: string) => (v ?? '').replace(/\D/g, '');
  if (c.startsWith('email:') && contact.email) return c === `email:${contact.email.trim().toLowerCase()}`;
  if (c.startsWith('phone:') && contact.phone) {
    const d = digits(contact.phone);
    return d.length >= 7 && c.replace(/\D/g, '').endsWith(d.length === 10 ? d : d.slice(-10));
  }
  return false;
};

function SurvivorCard(props: {
  n: number;
  group: CounselorMatchGroup;
  opened: ReconstructedBundle;
  clear: boolean;
  notes: CounselorNote[];
  onChanged(): void;
}) {
  const { api, session } = useRequiredSession();
  const { summary: b, entryId } = props.opened;
  // A legacy (v1) bundle carries her details inside; they are hidden until the check like v2 ones (UI-only for legacy).
  const contact = props.clear ? props.opened.contact : undefined;
  const notes = useAsync(
    () => Promise.all(props.notes.map(async (n) => ({ n, plain: await decryptJSON<NotePlain>(n.envelope, session.masterKey).catch(() => null) }))),
    [props.notes, session.masterKey],
  );
  const [status, setStatus] = useState<NotePlain['status']>('reached_out');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const envelope = await encryptJSON({ status, ...(text.trim() && { text: text.trim() }) } satisfies NotePlain, session.masterKey);
      await api.addCounselorNote(props.group.id, { entryId, envelope });
      setText('');
      props.onChanged();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="card stack" data-testid="counselor-survivor" aria-label={`Person ${props.n}`}>
      <h3 style={{ margin: 0 }}>Person {props.n}</h3>
      <p className="small" style={{ margin: 0 }}>
        Named: <span className="mono" data-testid="counselor-canonical">{b.identifier.canonical}</span>
      </p>
      {!props.opened.onLine && (
        <p className="card warn small" style={{ margin: 0 }}>
          This report doesn’t line up with the others in this group. Treat it with extra care.
        </p>
      )}
      {contact && contactMatchesIdentifier(b.identifier, contact) && (
        <p className="card warn small" style={{ margin: 0 }} data-testid="counselor-contact-is-identifier">
          The contact details on this card are the identifier that was named. This may be the named person, not a survivor.
        </p>
      )}
      <dl className="case-meta">
        {b.states.incident && (
          <div>
            <dt>Where it happened</dt>
            <dd>{stateName(b.states.incident)}</dd>
          </div>
        )}
        {b.states.survivor && (
          <div>
            <dt>Where they live</dt>
            <dd>{stateName(b.states.survivor)}</dd>
          </div>
        )}
        <div>
          <dt>How to reach them</dt>
          <dd>{b.methods.map((m) => METHOD_WORDS[m] ?? m).join(' · ') || 'Not given'}</dd>
        </div>
        {b.language && (
          <div>
            <dt>Language</dt>
            <dd>{b.language}</dd>
          </div>
        )}
        {contact?.name && (
          <div>
            <dt>Name to use</dt>
            <dd>{contact.name}</dd>
          </div>
        )}
        {contact?.phone && (
          <div>
            <dt>Phone</dt>
            <dd>{contact.phone}</dd>
          </div>
        )}
        {contact?.email && (
          <div>
            <dt>Email</dt>
            <dd>{contact.email}</dd>
          </div>
        )}
      </dl>
      {!props.clear && (
        <p className="small muted" style={{ margin: 0 }} data-testid="counselor-contact-hidden">
          Contact details are shown after your conflict check.
        </p>
      )}
      {props.clear && props.opened.contactError && (
        <ErrorNote>This person’s contact details did not open. They may have been tampered with; report it to Matra.</ErrorNote>
      )}
      {contact?.notes && <p className="small"><strong>Their note:</strong> {contact.notes}</p>}
      <details className="small">
        <summary>What they agreed to ({formatDate(b.consent.at)})</summary>
        <div className="consent-text">{b.consent.statement}</div>
      </details>
      {props.clear && (
        <>
          <ReportRequestBlock group={props.group} entryId={entryId} onChanged={props.onChanged} />
          <div className="stack">
            <h4 style={{ margin: 0 }}>Outreach notes <span className="small muted">(encrypted, only you can read them)</span></h4>
            {notes.data?.length === 0 && <p className="small muted" style={{ margin: 0 }}>No notes yet.</p>}
            <ul className="list small">
              {notes.data?.map(({ n, plain }) => (
                <li key={n.id}>
                  {formatDate(n.createdAt)} · <strong>{plain ? NOTE_STATUS[plain.status] ?? plain.status : 'Could not decrypt'}</strong>
                  {plain?.text && <> — {plain.text}</>}
                </li>
              ))}
            </ul>
            <div className="row">
              <label className="field">
                <span>Status</span>
                <select value={status} onChange={(e) => setStatus(e.target.value as NotePlain['status'])}>
                  {Object.entries(NOTE_STATUS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field" style={{ flex: 1, minWidth: 0 }}>
                <span>Note</span>
                <input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
              </label>
            </div>
            <div>
              <button className="btn btn-small" onClick={() => void save()} disabled={busy}>
                {busy ? 'Saving…' : 'Save note'}
              </button>
            </div>
            {error && <ErrorNote>{error}</ErrorNote>}
          </div>
        </>
      )}
    </article>
  );
}

/**
 * Stage 2, per person: ask for their full report, only once you have spoken with them and they expect it (so a request
 * is never their first sign of a match: W1). They decide alone; you learn only the decision. A no is final in Matra.
 */
function ReportRequestBlock({ group, entryId, onChanged }: { group: CounselorMatchGroup; entryId: string; onChanged(): void }) {
  const { api } = useRequiredSession();
  const [expected, setExpected] = useState(false);
  const [st, setSt] = useState<{ busy?: boolean; error?: string }>({});
  const mine = group.reportRequests.filter((r) => r.entryId === entryId);
  const current = [...mine].reverse().find((r) => r.status !== 'cancelled');
  async function run(fn: () => Promise<unknown>) {
    setSt({ busy: true });
    try {
      await fn();
      setExpected(false);
      setSt({});
      onChanged();
    } catch (e) {
      setSt({ error: friendlyError(e) });
    }
  }
  const rel = current?.release;
  const relLive = rel && rel.status === 'active' && Date.parse(rel.expiresAt) > Date.now();
  return (
    <div className="card soft stack small" data-testid="counselor-report-request">
      <h4 style={{ margin: 0 }}>Their full report</h4>
      {st.error && <ErrorNote>{st.error}</ErrorNote>}
      {current?.status === 'pending' && (
        <>
          <p style={{ margin: 0 }}>
            You asked on {formatDate(current.createdAt)}. They haven’t decided. Matra doesn’t remind them; they decide in
            their own time, and can say no.
          </p>
          <div>
            <button className="btn btn-quiet btn-small" disabled={st.busy} onClick={() => void run(() => api.cancelReportRequest(current.id))}>
              Withdraw this request
            </button>
          </div>
        </>
      )}
      {current?.status === 'declined' && <p style={{ margin: 0 }}>They decided not to share their report. Matra will not ask them again.</p>}
      {current?.status === 'consented' && rel && relLive && (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span>They shared their report with you, until {formatDate(rel.expiresAt)}.</span>
          <Link className="btn btn-primary btn-small" to={`/counselor/reports/${rel.id}`}>
            Open their report
          </Link>
        </div>
      )}
      {current?.status === 'consented' && rel && !relLive && (
        <p style={{ margin: 0 }}>{rel.status === 'revoked' ? 'They stopped sharing their report with you.' : 'Access to their report has ended.'}</p>
      )}
      {!current && (
        <>
          <p style={{ margin: 0 }}>
            If this person wants you to see their written account, you can ask them here. They see the request in their
            own space and decide alone; it is never shared with anyone else in this group.
          </p>
          <label className="check">
            <input type="checkbox" checked={expected} onChange={(e) => setExpected(e.target.checked)} />
            <span>I’ve spoken with this person and they expect this request.</span>
          </label>
          <div>
            <button
              className="btn btn-small"
              disabled={!expected || st.busy}
              onClick={() => void run(() => api.requestSurvivorReport(group.id, entryId))}
            >
              Ask for their full report
            </button>
          </div>
        </>
      )}
    </div>
  );
}
