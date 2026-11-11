/**
 * Staged release, Stage 2, her side (docs/design/WEEKEND_MVP.md §3.6; Q-052 intent). The legal options counselor who
 * contacted her has asked to see her full report. She decides alone, in her own time:
 *   - who is asking (name, organization, licensed attorney, key fingerprint);
 *   - exactly what would be shared: her latest sealed account, and evidence only if she ticks it (unticked by default);
 *   - the consent statement, word for word (lib/disclosures.ts), stored with her yes and hashed into the ledger;
 *   - two equally weighted buttons, "Yes, share my report" and "No, don’t share" (leaving the page is "not now"), and after a yes, "Stop sharing".
 * On a yes her record key (and the evidence keys she chose) are wrapped to the counselor's RSA key ON THIS DEVICE, as
 * for an attorney share. The counselor's key is checked against the organization-signed roster when this build pins
 * the roster key; otherwise she compares the fingerprint with what the counselor tells her, as in the attorney flow.
 * Nothing here shows anything about anyone else who named the same person.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fromBase64, publicKeyFingerprint, verifyCounselorRoster, wrapKeyForRecipient } from '@matra/crypto';
import type { ReportRevokeReason, SurvivorReportRequest, WrappedKey } from '@matra/shared';
import { ErrorNote, Loading, PageTitle, formatDate, useAsync } from '../components/common';
import { REPORT_REQUEST_LINES, buildReportConsentStatement } from '../lib/disclosures';
import { friendlyError, useRequiredSession } from '../lib/session';
import { blobKeyFor, escrowLabel, finals, loadVault } from '../lib/vault';
import { MATCH_PINS } from '../matchPins';

const DAYS = 90;

/** Why Matra (not she) ended a counselor's access: calm, and nothing for her to do. */
const ENDED_NOTE: Record<Exclude<ReportRevokeReason, 'survivor'>, string> = {
  conflict: 'They can’t take on this matter. You don’t need to do anything.',
  resealed: 'Your sealed match moved to new matching keys. You don’t need to do anything.',
  withdrawn: 'You withdrew the sealed identifier it was about.',
};

/** Is this counselor (this exact key) on the organization-signed roster? `null` when the build pins no roster key. */
async function rosterVouches(api: ReturnType<typeof useRequiredSession>['api'], req: SurvivorReportRequest): Promise<boolean | null> {
  if (!MATCH_PINS.rosterKey) return null;
  const config = await api.matchingConfig();
  const roster = verifyCounselorRoster(config.roster, fromBase64(MATCH_PINS.rosterKey));
  const listed = roster?.counselors.find((c) => c.userId === req.counselor.userId);
  const pk = req.counselor.publicKey as { n?: string; e?: string };
  return !!listed && listed.publicKey.n === pk.n && listed.publicKey.e === pk.e;
}

export function ReportRequest() {
  const { id = '' } = useParams();
  const { api, session } = useRequiredSession();
  const data = useAsync(async () => {
    const [{ requests }, records, { entries }] = await Promise.all([api.reportRequests(), loadVault(api, session.masterKey), api.listEscrow()]);
    const req = requests.find((r) => r.id === id);
    if (!req) return null;
    const entry = entries.find((e) => e.id === req.entryId);
    const [fingerprint, vouched, label] = await Promise.all([
      publicKeyFingerprint(req.counselor.publicKey),
      rosterVouches(api, req),
      entry ? escrowLabel(entry.labelEnvelope, session.masterKey) : Promise.resolve(undefined),
    ]);
    const current = finals(records).find((r) => !r.supersededBy);
    return { req, fingerprint, vouched, label, current };
  }, [api, id, session.masterKey]);
  const [withEvidence, setWithEvidence] = useState(false);
  const [fpConfirmed, setFpConfirmed] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [st, setSt] = useState<{ busy?: string; error?: string; done?: 'yes' | 'no' | 'stopped' }>({});
  const [at] = useState(() => new Date().toISOString());

  const d = data.data;
  const req = d?.req;
  const evidence = (d?.current?.payload.record?.evidence ?? []).filter((e) => e.blobId);
  const statement =
    d && req && d.current
      ? buildReportConsentStatement({
          counselor: req.counselor,
          fingerprint: d.fingerprint,
          withEvidence: withEvidence ? evidence.length : 0,
          sealedAt: d.current.ledgerEntry?.timestamp ?? d.current.meta.createdAt,
          expiresInDays: DAYS,
          at,
        })
      : '';
  const keyOk = d?.vouched === true || (d?.vouched === null && fpConfirmed);

  async function act(kind: 'yes' | 'no' | 'stopped', fn: () => Promise<unknown>, busy: string) {
    setSt({ busy });
    try {
      await fn();
      setSt({ done: kind });
      setConfirmStop(false);
      void data.reload();
    } catch (e) {
      setSt({ error: friendlyError(e) });
    }
  }

  async function share() {
    if (!d || !req || !d.current || !keyOk || !agreed) return;
    const record = d.current;
    const blobs: Array<{ blobId: string; recipientWrappedKey: WrappedKey }> = [];
    if (withEvidence && evidence.length) {
      const { blobs: metas } = await api.listBlobs();
      const byId = new Map(metas.map((m) => [m.id, m]));
      for (const e of evidence) {
        const meta = byId.get(e.blobId!);
        if (!meta) continue;
        blobs.push({ blobId: meta.id, recipientWrappedKey: await wrapKeyForRecipient(await blobKeyFor(meta, session.masterKey), req.counselor.publicKey) });
      }
    }
    await api.consentReportRequest(req.id, {
      recordId: record.meta.id,
      recipientWrappedKey: await wrapKeyForRecipient(record.key, req.counselor.publicKey),
      blobs,
      consentStatement: statement,
      counselorKeyFingerprint: d.fingerprint,
      expiresInDays: DAYS,
    });
  }

  const who = req ? `${req.counselor.displayName}${req.counselor.organization ? `, ${req.counselor.organization}` : ''}` : '';
  const rel = req?.release;
  const relLive = rel && rel.status === 'active' && Date.parse(rel.expiresAt) > Date.now();

  return (
    <div className="stack-lg">
      <p>
        <Link className="back-link" to="/vault">← Home</Link>
      </p>
      {data.loading && <Loading label="Opening…" />}
      {data.error && <ErrorNote>{data.error}</ErrorNote>}
      {!data.loading && !data.error && !req && (
        <div className="card stack">
          <p style={{ margin: 0 }}>This request is no longer here. Nothing was shared.</p>
        </div>
      )}
      {d && req && (
        <>
          <PageTitle eyebrow="A request" lead="Take your time. Nothing is shared unless you say yes." testId="report-request-title">
            A legal options counselor has asked to see your report
          </PageTitle>
          <section className="card stack" aria-labelledby="rq-who">
            <h2 id="rq-who">Who is asking</h2>
            <p style={{ margin: 0 }}>
              <strong>{who}</strong>
              <br />
              <span className="small muted">
                Legal options counselor (a licensed attorney)
                {req.counselor.jurisdictions.length > 0 && <> · licensed in {req.counselor.jurisdictions.join(', ')}</>}
              </span>
            </p>
            {d.label && (
              <p className="small" style={{ margin: 0 }}>
                About the sealed match you set up for: <strong>{d.label}</strong>
              </p>
            )}
            <p className="small muted" style={{ margin: 0 }}>Asked {formatDate(req.createdAt)}.</p>
          </section>

          {req.status === 'declined' && (
            <div className="card sage stack" role="status" data-testid="report-request-declined">
              <p style={{ margin: 0 }}>You decided not to share your report. Nothing was shared, and you won’t be asked again through Matra about this sealed match.</p>
            </div>
          )}
          {req.status === 'consented' && rel && (
            <div className="card sage stack" role="status" data-testid="report-request-shared">
              {relLive ? (
                <>
                  <p style={{ margin: 0 }}>
                    You shared your report with {req.counselor.displayName} on {formatDate(rel.createdAt)}.{' '}
                    {rel.firstOpenedAt ? `They opened it on ${formatDate(rel.firstOpenedAt)}.` : 'They haven’t opened it yet.'} Access ends{' '}
                    {formatDate(rel.expiresAt)}.
                  </p>
                  <p className="small" style={{ margin: 0 }}>
                    {rel.firstOpenedAt
                      ? 'You can stop sharing at any time. That ends future access; it can’t take back what they already read.'
                      : 'If you stop sharing now, before they open it, they will never see it.'}
                  </p>
                  {!confirmStop ? (
                    <div>
                      <button className="btn" onClick={() => setConfirmStop(true)}>
                        Stop sharing
                      </button>
                    </div>
                  ) : (
                    <div className="row">
                      <button className="btn btn-primary" disabled={!!st.busy} onClick={() => void act('stopped', () => api.revokeReportRelease(rel.id), 'Stopping…')}>
                        {st.busy ?? 'Yes, stop sharing'}
                      </button>
                      <button className="btn" disabled={!!st.busy} onClick={() => setConfirmStop(false)}>
                        Keep sharing
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <p style={{ margin: 0 }}>
                  {rel.status !== 'revoked'
                    ? 'Access to your report has ended.'
                    : rel.revokeReason && rel.revokeReason !== 'survivor'
                      ? `Matra ended this counselor’s access on ${formatDate(rel.revokedAt)}. ${ENDED_NOTE[rel.revokeReason]}`
                      : `You stopped sharing on ${formatDate(rel.revokedAt)}.`}
                </p>
              )}
            </div>
          )}

          {req.status === 'pending' && (
            <>
              <section className="card soft stack" aria-labelledby="rq-know">
                <h2 id="rq-know">Good to know</h2>
                <ul className="small" style={{ margin: 0, paddingLeft: '1.2em' }} data-testid="report-request-lines">
                  {REPORT_REQUEST_LINES.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </section>
              {!d.current ? (
                <div className="card stack">
                  <p style={{ margin: 0 }}>
                    You don’t have a sealed account to share right now. You can say no, or come back later. There is no
                    deadline.
                  </p>
                </div>
              ) : (
                <>
                  <fieldset className="card stack">
                    <legend>
                      <h2 style={{ margin: 0 }}>What would be shared</h2>
                    </legend>
                    <label className="check">
                      <input type="checkbox" checked disabled />
                      <span>
                        My sealed account (sealed {formatDate(d.current.ledgerEntry?.timestamp ?? d.current.meta.createdAt)})
                      </span>
                    </label>
                    <label className="check">
                      <input type="checkbox" checked={withEvidence} disabled={!evidence.length} onChange={(e) => setWithEvidence(e.target.checked)} />
                      <span>
                        My evidence files too <span className="small muted">({evidence.length} file{evidence.length === 1 ? '' : 's'}, optional)</span>
                      </span>
                    </label>
                  </fieldset>
                  <section className="card stack" aria-labelledby="rq-key">
                    <h2 id="rq-key">Their key</h2>
                    <p className="fingerprint fingerprint-big card warm">{d.fingerprint}</p>
                    {d.vouched === true && (
                      <p className="small" style={{ margin: 0 }}>
                        This key is on the counselor list signed by Matra’s organization, so it has been checked for you.
                      </p>
                    )}
                    {d.vouched === false && (
                      <ErrorNote>
                        This key isn’t on the counselor list signed by Matra’s organization. Please don’t share. You can say no, or
                        ask the counselor about it.
                      </ErrorNote>
                    )}
                    {d.vouched === null && (
                      <>
                        <p className="small" style={{ margin: 0 }}>
                          Your report would be locked so only this key can open it. If you like, ask {req.counselor.displayName} (by
                          phone, not through this app) to read their fingerprint to you.
                        </p>
                        <label className="check">
                          <input type="checkbox" checked={fpConfirmed} onChange={(e) => setFpConfirmed(e.target.checked)} />
                          <span>This matches what the counselor told me.</span>
                        </label>
                      </>
                    )}
                  </section>
                  <section className="card stack" aria-labelledby="rq-consent">
                    <h2 id="rq-consent">Your consent, word for word</h2>
                    <p className="small muted" style={{ margin: 0 }}>If you say yes, this exact text is saved, so there’s a clear record of what you agreed to.</p>
                    <div className="consent-text">{statement}</div>
                    <label className="check">
                      <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                      <span>I agree to the statement above.</span>
                    </label>
                  </section>
                </>
              )}
              {st.error && <ErrorNote>{st.error}</ErrorNote>}
              {st.busy && <Loading label={st.busy} />}
              <div className="row">
                {d.current && (
                  <button
                    className="btn btn-primary"
                    disabled={!keyOk || !agreed || !!st.busy}
                    onClick={() => void act('yes', share, 'Locking your report for this counselor, on your device…')}
                  >
                    Yes, share my report
                  </button>
                )}
                <button className="btn btn-primary" disabled={!!st.busy} onClick={() => void act('no', () => api.declineReportRequest(req.id), 'Saving your answer…')}>
                  No, don’t share
                </button>
              </div>
              <p className="small muted" style={{ margin: 0 }}>
                You can also just leave this page. The request stays here until you decide.
              </p>
            </>
          )}
          {st.done === 'stopped' && <p className="small" role="status">You stopped sharing.</p>}
        </>
      )}
    </div>
  );
}
