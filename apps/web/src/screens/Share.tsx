import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { publicKeyFingerprint, wrapKeyForRecipient } from '@matra/crypto';
import type { AttorneyProfile, Share as ShareT } from '@matra/shared';
import { ErrorNote, Loading, PageTitle, US_STATES, formatDate, useAsync } from '../components/common';
import { friendlyError, useRequiredSession } from '../lib/session';
import { blobKeyFor, finals, loadVault, type OpenedRecord } from '../lib/vault';

type Scope = ShareT['scope'][number];
const SCOPE_LABEL: Record<Scope, string> = {
  record: 'My written account',
  evidence: 'My evidence files',
  brief: 'The incident summary in my own words, prepared from my account',
};

export const SHARE_DISCLAIMER =
  'This does not report anything to police. You can revoke access at any time. Access also ends on its own on the expiry date, unless you renew it. Revoking or expiry stops future access, but cannot undo what was already viewed.';

export function buildConsentStatement(p: {
  alias: string;
  attorney: AttorneyProfile;
  fingerprint: string;
  scope: Scope[];
  sealedAt: string;
  at: string;
  expiresInDays: number;
}): string {
  const who = `${p.attorney.displayName}${p.attorney.organization ? ` of ${p.attorney.organization}` : ''}`;
  return [
    `I, "${p.alias}", choose to share my sealed Matra file (sealed ${p.sealedAt}) with ${who}, a verified attorney, so that they can advise me.`,
    `I am sharing: ${p.scope.map((s) => SCOPE_LABEL[s].replace(/^My /, 'my ').replace(/^The /, 'the ')).join('; ')}.`,
    `It will be encrypted on my device so that only the holder of the key with fingerprint ${p.fingerprint} can open it.`,
    `This access expires ${p.expiresInDays} days after the date below unless I renew it.`,
    SHARE_DISCLAIMER.replace(/\bYou\b/g, 'I').replace(/\byou\b/g, 'I'),
    `Agreed at ${p.at}.`,
  ].join('\n');
}

function useFingerprint(jwk?: JsonWebKey) {
  const [fp, setFp] = useState<string>('');
  useEffect(() => {
    let alive = true;
    if (jwk) void publicKeyFingerprint(jwk).then((f) => alive && setFp(f));
    return () => {
      alive = false;
    };
  }, [jwk]);
  return fp;
}

function initials(name: string): string {
  const words = name.replace(/^Demo\s*—\s*/, '').replace(/,.*$/, '').split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase() || '·';
}

function AttorneyCard({ a, onChoose }: { a: AttorneyProfile; onChoose(): void }) {
  const fp = useFingerprint(a.publicKey);
  return (
    <li className="card stack attorney-card">
      <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', gap: 16 }}>
        <span className="avatar" aria-hidden="true">
          {initials(a.displayName)}
        </span>
        <div style={{ minWidth: 0, flex: 1 }} className="stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>{a.displayName}</h3>
            <span className="badge ok">Verified attorney</span>
          </div>
          {a.organization && <p style={{ margin: 0 }}>{a.organization}</p>}
          <p className="small muted" style={{ margin: 0 }}>
            Licensed in {a.jurisdictions.join(', ') || '—'}
            {a.practiceAreas.length > 0 && <> · {a.practiceAreas.join(', ')}</>}
            {a.acceptsProBono && <> · Takes pro bono (free) cases</>}
          </p>
        </div>
      </div>
      <details className="disclosure small">
        <summary>Their key fingerprint</summary>
        <p className="fingerprint" style={{ margin: '8px 0 4px' }}>{fp || '…'}</p>
        <p className="small muted" style={{ margin: 0 }}>
          This short code stands for the attorney’s personal encryption key. Your file will be locked so only that key can
          open it. To be extra sure, ask the attorney (by phone or in person) to read their fingerprint to you — it should
          match exactly.
        </p>
      </details>
      <div>
        <button className="btn btn-primary" onClick={onChoose}>
          Review and decide
        </button>
      </div>
    </li>
  );
}

export function Share() {
  const { api, session } = useRequiredSession();
  const vault = useAsync(() => loadVault(api, session.masterKey), [api, session.masterKey]);
  const current = finals(vault.data ?? []).find((r) => !r.supersededBy);
  const defaultState = current?.payload.record?.survivor.residenceState || current?.payload.record?.incident.jurisdiction.state || '';
  const [stateFilter, setStateFilter] = useState<string | null>(null);
  const effectiveState = stateFilter ?? defaultState;
  const attorneys = useAsync(() => api.listAttorneys(effectiveState || undefined).then((r) => r.attorneys.filter((a) => a.verified)), [api, effectiveState]);
  const [chosen, setChosen] = useState<AttorneyProfile | null>(null);
  const [done, setDone] = useState<{ attorney: AttorneyProfile; at: string } | null>(null);

  if (done) {
    return (
      <div className="stack-lg">
        <PageTitle eyebrow="Done">Shared with {done.attorney.displayName}</PageTitle>
        <div className="card sage stack" role="status">
          <p>
            Your file was locked on this device for {done.attorney.displayName} only, at {formatDate(done.at)}. Every time
            they open it, you’ll see it in your activity on Home.
          </p>
          <p style={{ margin: 0 }}>{SHARE_DISCLAIMER}</p>
        </div>
        <div className="row">
          <Link className="btn btn-primary" to="/vault">
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  if (chosen && current) {
    return <Consent record={current} attorney={chosen} onCancel={() => setChosen(null)} onDone={(at) => setDone({ attorney: chosen, at })} />;
  }

  return (
    <div className="stack-lg">
      <PageTitle
        eyebrow="Sharing"
        testId="share-title"
        lead="If you’d like legal help, you can share your sealed story with a verified volunteer or legal-aid attorney, at no cost to you. Nothing is shared until you say yes on the next screen."
      >
        Legal help, on your terms
      </PageTitle>
      {vault.loading && <Loading label="Opening your space…" />}
      {vault.error && <ErrorNote>{vault.error}</ErrorNote>}
      {!vault.loading && !current && !vault.error && (
        <div className="card stack">
          <p>Once your story is sealed, you’ll be able to share it here — only if you want to.</p>
          <div>
            <Link className="btn btn-primary" to="/vault/story">
              Go to my story
            </Link>
          </div>
        </div>
      )}
      {current && (
        <>
          <div className="card soft stack">
            <label className="field">
              <span>Show attorneys licensed in</span>
              <select value={effectiveState} onChange={(e) => setStateFilter(e.target.value)}>
                <option value="">All states</option>
                {US_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {attorneys.loading && <Loading />}
          {attorneys.error && <ErrorNote>{attorneys.error}</ErrorNote>}
          {attorneys.data && attorneys.data.length === 0 && (
            <p className="muted">
              No verified attorneys are listed for this state yet. Try “All states”, or call 1-800-656-4673 and an advocate
              can help you find one.
            </p>
          )}
          <ul className="list cards">
            {attorneys.data?.map((a) => <AttorneyCard key={a.userId} a={a} onChoose={() => setChosen(a)} />)}
          </ul>
        </>
      )}
    </div>
  );
}

function Consent({
  record,
  attorney,
  onCancel,
  onDone,
}: {
  record: OpenedRecord;
  attorney: AttorneyProfile;
  onCancel(): void;
  onDone(at: string): void;
}) {
  const { api, session } = useRequiredSession();
  const fp = useFingerprint(attorney.publicKey);
  const evidence = (record.payload.record?.evidence ?? []).filter((e) => e.blobId);
  const [scope, setScope] = useState<Record<Scope, boolean>>({ record: true, evidence: evidence.length > 0, brief: true });
  const [agreed, setAgreed] = useState(false);
  const [fpConfirmed, setFpConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [at] = useState(() => new Date().toISOString());

  const scopeList = (Object.keys(scope) as Scope[]).filter((s) => scope[s]);
  const statement = fp
    ? buildConsentStatement({
        alias: session.user.username,
        attorney,
        fingerprint: fp,
        scope: scopeList,
        sealedAt: record.ledgerEntry?.timestamp ?? record.meta.createdAt,
        at,
        expiresInDays,
      })
    : '';

  async function share() {
    if (!agreed || !fpConfirmed || !fp || !statement) return;
    setBusy(true);
    setError(null);
    try {
      const recipientWrappedKey = await wrapKeyForRecipient(record.key, attorney.publicKey);
      const blobs: { blobId: string; recipientWrappedKey: Awaited<ReturnType<typeof wrapKeyForRecipient>> }[] = [];
      if (scope.evidence && evidence.length) {
        const { blobs: metas } = await api.listBlobs();
        const byId = new Map(metas.map((m) => [m.id, m]));
        for (const e of evidence) {
          const meta = byId.get(e.blobId!);
          if (!meta) continue;
          const key = await blobKeyFor(meta, session.masterKey);
          blobs.push({ blobId: meta.id, recipientWrappedKey: await wrapKeyForRecipient(key, attorney.publicKey) });
        }
      }
      await api.createShare({
        recordId: record.meta.id,
        attorneyId: attorney.userId,
        recipientWrappedKey,
        attorneyKeyFingerprint: fp,
        blobs,
        consentStatement: statement,
        scope: scopeList,
        survivorAlias: session.user.username,
        expiresInDays,
      });
      onDone(new Date().toISOString());
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-lg">
      <PageTitle eyebrow="Sharing" lead="Take your time. Nothing happens until you press the button at the bottom.">
        Share with {attorney.displayName}?
      </PageTitle>
      <div className="card warn stack">
        <p style={{ margin: 0 }}>
          <strong>{SHARE_DISCLAIMER}</strong>
        </p>
      </div>
      <section className="card stack" aria-labelledby="fp-h">
        <h2 id="fp-h">Check the attorney’s key</h2>
        <p>
          Your file will be locked so only the key with this fingerprint can open it. Ask {attorney.displayName} (by phone
          or in person, not through this app) to read their fingerprint to you.
        </p>
        <p className="fingerprint fingerprint-big card warm">{fp || '…'}</p>
        <label className="check">
          <input type="checkbox" checked={fpConfirmed} disabled={!fp} onChange={(e) => setFpConfirmed(e.target.checked)} />
          <span>This matches what the attorney told me.</span>
        </label>
      </section>
      <fieldset className="card stack">
        <legend>
          <h2 style={{ margin: 0 }}>What would you like to share?</h2>
        </legend>
        <label className="check">
          <input type="checkbox" checked disabled />
          <span>
            {SCOPE_LABEL.record} <span className="small muted">(needed for any sharing)</span>
          </span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={scope.evidence}
            disabled={!evidence.length}
            onChange={(e) => setScope({ ...scope, evidence: e.target.checked })}
          />
          <span>
            {SCOPE_LABEL.evidence} <span className="small muted">({evidence.length} file{evidence.length === 1 ? '' : 's'})</span>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={scope.brief} onChange={(e) => setScope({ ...scope, brief: e.target.checked })} />
          <span>{SCOPE_LABEL.brief}</span>
        </label>
      </fieldset>
      <label className="card field">
        <span>How long should they have access?</span>
        <select value={expiresInDays} onChange={(e) => setExpiresInDays(Number(e.target.value))}>
          <option value={30}>30 days</option>
          <option value={90}>90 days (default)</option>
          <option value={180}>180 days</option>
          <option value={365}>1 year</option>
        </select>
        <span className="hint">You can renew or take back access at any time. When access ends, it stops future access only.</span>
      </label>
      <section className="card stack" aria-labelledby="consent-h">
        <h2 id="consent-h">Your consent, word for word</h2>
        <p className="small muted">This exact text is saved with the share, so there’s a clear record of what you agreed to.</p>
        {statement ? <div className="consent-text">{statement}</div> : <Loading label="Preparing…" />}
        <label className="check">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>I agree to the statement above.</span>
        </label>
        {busy && <Loading label="Locking your file for this attorney, on your device…" />}
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="row">
          <button className="btn btn-primary" onClick={() => void share()} disabled={!agreed || !fpConfirmed || !statement || busy}>
            Yes, share with {attorney.displayName}
          </button>
          <button className="btn" onClick={onCancel} disabled={busy}>
            Not now
          </button>
        </div>
      </section>
    </div>
  );
}
