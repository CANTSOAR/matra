/**
 * Legal Options Counselor portal (Callisto's "LOC" role, carried forward).
 *
 * The server releases ONLY matched groups (≥ 2 distinct survivors named the same unique identifier), and only the
 * seals addressed to this counselor. Everything is opened here, on the counselor's device, with the counselor's
 * private key: the two shares are interpolated to recover the per-perpetrator key, which opens each survivor's
 * contact bundle (packages/crypto/src/matching.ts, reconstructMatchGroup). Outreach notes are encrypted under the
 * counselor's own master key before they are saved.
 */
import { useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { decryptJSON, encryptJSON, publicKeyFingerprint, reconstructMatchGroup, type ReconstructResult } from '@matra/crypto';
import type { CounselorMatchGroup, CounselorNote, MatchContactBundle } from '@matra/shared';
import { SignInForm } from '../components/AuthForms';
import { ErrorNote, Loading, PageTitle, formatDate, useAsync } from '../components/common';
import { friendlyError, useRequiredSession, useSession } from '../lib/session';

/** A counselor session only ever sees the counselor portal (pathless guard around the app's routes). */
export function CounselorGate({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const { pathname } = useLocation();
  if (session?.user.role === 'counselor' && !pathname.startsWith('/counselor')) return <Navigate to="/counselor/matches" replace />;
  return <>{children}</>;
}

export function RequireCounselor({ children }: { children: ReactNode }) {
  const { session } = useSession();
  if (!session) return <Navigate to="/counselor" replace />;
  if (session.user.role !== 'counselor') return <Navigate to={session.user.role === 'attorney' ? '/attorney/cases' : '/vault'} replace />;
  return <>{children}</>;
}

export function CounselorSignIn() {
  return (
    <div className="stack-lg">
      <PageTitle eyebrow="Legal options counselors" lead="For counselors Matra has verified and contracted.">
        Counselor sign in
      </PageTitle>
      <SignInForm role="attorney" />
    </div>
  );
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
  return (
    <section className="card stack" aria-labelledby={`g-${group.id}`} data-testid="counselor-group">
      <div className="section-title">
        <h2 id={`g-${group.id}`}>Match {index}</h2>
        <span className="badge care">{group.entries.length} people</span>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Matched {formatDate(group.matchedAt)}
        {first && <> · on {first.kind === 'social' ? 'a social media profile' : first.kind === 'phone' ? 'a phone number' : 'an email address'}</>}
      </p>
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
      {r?.ok && (
        <>
          {first && <p className="small">Identifier both named: <span className="mono">{first.canonical}</span></p>}
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

function SurvivorCard(props: { n: number; groupId: string; entryId: string; bundle: MatchContactBundle; notes: CounselorNote[]; onNote(): void }) {
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
