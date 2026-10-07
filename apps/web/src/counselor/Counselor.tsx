/**
 * Legal Options Counselor portal (Callisto's "LOC" role, carried forward).
 *
 * The server releases ONLY matched groups (≥ 2 distinct survivors named the same unique identifier), and only the
 * seals addressed to this counselor. Everything is opened here, on the counselor's device, with the counselor's
 * private key: the two shares are interpolated to recover the per-perpetrator key, which opens each survivor's
 * contact bundle (packages/crypto/src/matching.ts, reconstructMatchGroup). Outreach notes are encrypted under the
 * counselor's own master key before they are saved.
 */
import { useState } from 'react';
import { decryptJSON, encryptJSON, publicKeyFingerprint, reconstructMatchGroup, type ReconstructResult } from '@matra/crypto';
import type { CounselorMatchGroup, CounselorNote, MatchContactBundle } from '@matra/shared';
import { ErrorNote, Loading, PageTitle, formatDate, useAsync } from '../components/common';
import { friendlyError, useRequiredSession } from '../lib/session';
export { CounselorGate, CounselorSignIn, RequireCounselor } from './guards';

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
  const profile = me.data?.counselorProfile;

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
      </div>
      {groups.loading && <Loading />}
      {groups.error && <ErrorNote>{groups.error}</ErrorNote>}
      {groups.data && groups.data.length === 0 && <p className="muted">No matches right now.</p>}
      {groups.data?.map((g, i) => <MatchGroup key={g.id} group={g} index={i + 1} onNote={() => void groups.reload()} />)}
    </div>
  );
}

function MatchGroup({ group, index, onNote }: { group: CounselorMatchGroup; index: number; onNote(): void }) {
  const { session } = useRequiredSession();
  const [state, setState] = useState<{ busy?: boolean; result?: ReconstructResult; error?: string }>({});
  async function open() {
    setState({ busy: true });
    try {
      setState({ result: await reconstructMatchGroup(group.tag, group.entries, session.privateKey, session.user.id) });
    } catch (e) {
      setState({ error: friendlyError(e) });
    }
  }
  const r = state.result;
  const first = r?.ok ? r.bundles[0]?.bundle.identifier : undefined;
  const alerts = r ? r.alerts.map((a) => ALERT_WORDS[a]) : [];
  const sig = group.signals;
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
          <button className="btn btn-primary btn-small" onClick={() => void open()} disabled={state.busy}>
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
          {r.canonicals.length === 1 && first && (
            <p className="small">
              Identifier named: <span className="mono">{first.canonical}</span>
            </p>
          )}
          {r.failed.length > 0 && (
            <ErrorNote>
              {r.failed.length === 1 ? 'One entry' : `${r.failed.length} entries`} in this group did not verify and {r.failed.length === 1 ? 'is' : 'are'} not
              shown. It may be malformed or fake.
            </ErrorNote>
          )}
          <p className="small muted">
            Each card is a different person. Reach out to each one separately; don’t mention the other.
          </p>
          {r.bundles.map((b, i) => (
            <SurvivorCard
              key={b.entryId}
              n={i + 1}
              onLine={b.onLine}
              groupId={group.id}
              entryId={b.entryId}
              bundle={b.bundle}
              notes={group.notes.filter((x) => x.entryId === b.entryId)}
              onNote={onNote}
            />
          ))}
        </>
      )}
    </section>
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

const contactMatchesIdentifier = (b: MatchContactBundle) => {
  const c = b.identifier.canonical.toLowerCase();
  const digits = (v?: string) => (v ?? '').replace(/\D/g, '');
  if (c.startsWith('email:') && b.contact.email) return c === `email:${b.contact.email.trim().toLowerCase()}`;
  if (c.startsWith('phone:') && b.contact.phone) {
    const d = digits(b.contact.phone);
    return d.length >= 7 && c.replace(/\D/g, '').endsWith(d.length === 10 ? d : d.slice(-10));
  }
  return false;
};

function SurvivorCard(props: { n: number; onLine: boolean; groupId: string; entryId: string; bundle: MatchContactBundle; notes: CounselorNote[]; onNote(): void }) {
  const { api, session } = useRequiredSession();
  const { bundle: b } = props;
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
      await api.addCounselorNote(props.groupId, { entryId: props.entryId, envelope });
      setText('');
      props.onNote();
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
      {!props.onLine && (
        <p className="card warn small" style={{ margin: 0 }}>
          This report doesn’t line up with the others in this group. Treat it with extra care.
        </p>
      )}
      {contactMatchesIdentifier(b) && (
        <p className="card warn small" style={{ margin: 0 }} data-testid="counselor-contact-is-identifier">
          The contact details on this card are the identifier that was named. This may be the named person, not a survivor.
        </p>
      )}
      <dl className="case-meta">
        {b.contact.name && (
          <div>
            <dt>Name to use</dt>
            <dd>{b.contact.name}</dd>
          </div>
        )}
        <div>
          <dt>How to reach them</dt>
          <dd>{b.contact.methods.map((m) => METHOD_WORDS[m] ?? m).join(' · ')}</dd>
        </div>
        {b.contact.phone && (
          <div>
            <dt>Phone</dt>
            <dd>{b.contact.phone}</dd>
          </div>
        )}
        {b.contact.email && (
          <div>
            <dt>Email</dt>
            <dd>{b.contact.email}</dd>
          </div>
        )}
        {b.contact.language && (
          <div>
            <dt>Language</dt>
            <dd>{b.contact.language}</dd>
          </div>
        )}
        {b.state && (
          <div>
            <dt>State</dt>
            <dd>{b.state}</dd>
          </div>
        )}
      </dl>
      {b.contact.notes && <p className="small"><strong>Their note:</strong> {b.contact.notes}</p>}
      <details className="small">
        <summary>What they agreed to ({formatDate(b.consent.at)})</summary>
        <div className="consent-text">{b.consent.statement}</div>
      </details>
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
    </article>
  );
}
