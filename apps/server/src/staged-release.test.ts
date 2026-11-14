/**
 * Staged release (docs/design/WEEKEND_MVP.md §3.6; threat model W1, W21). Stage 1: the assigned counselor opens the
 * summary (identifier, states, contact methods). Stage 1b: contact details only after she records a conflict check.
 * Stage 2: she may ask one survivor for her full report; only that survivor's own yes releases it, wrapped to the
 * counselor's key on the survivor's device. Nothing about a survivor who never says yes reaches anyone.
 */
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type express from 'express';
import {
  decryptBlob,
  decryptJSON,
  generateRosterKey,
  normalizeMatchIdentifier,
  publicKeyFingerprint,
  reconstructMatchGroup,
  refreshMatchEntries,
  signCounselorRoster,
  submitMatchEntry,
  unwrapKeyWithPrivate,
  wrapKeyForRecipient,
} from '@matra/crypto';
import type { CounselorMatchGroup, ReportReleaseBundle, SurvivorReportRequest } from '@matra/shared';
import { getDb } from './app.js';
import { createRecord, makeApp, matchTransport, registerUser, sealMatch, uploadBlob, type TestUser } from './test-helpers.js';

const groupsOf = async (app: express.Express, c: TestUser) => {
  const r = await request(app).get('/api/counselor/groups').set(c.auth);
  expect(r.status).toBe(200);
  return r.body.groups as CounselorMatchGroup[];
};
const check = (app: express.Express, c: TestUser, groupId: string, result: 'clear' | 'conflict') =>
  request(app).post(`/api/counselor/groups/${groupId}/conflict-check`).set(c.auth).send({ result, statementVersion: 1 });
const ask = (app: express.Express, c: TestUser, groupId: string, entryId: string) =>
  request(app).post(`/api/counselor/groups/${groupId}/report-requests`).set(c.auth).send({ entryId, expected: true });
const requestsOf = async (app: express.Express, s: TestUser) => {
  const r = await request(app).get('/api/report-requests').set(s.auth);
  expect(r.status).toBe(200);
  return r.body.requests as SurvivorReportRequest[];
};
const ledgerTypes = (app: express.Express) =>
  (getDb(app).prepare('SELECT type FROM ledger ORDER BY seq').all() as Array<{ type: string }>).map((r) => r.type);

/**
 * Two survivors name the same person; one NJ counselor is assigned; A has a sealed record with two evidence files.
 * With `twoCounselors`, a second NJ counselor is listed before anyone seals (so both hold seals) and `loc` is whichever
 * one the matcher assigned; `spare` is the other.
 */
async function matched(opts: { twoCounselors?: boolean } = {}) {
  const { app, db } = makeApp();
  const c1 = await registerUser(app, 'loc.one', 'counselor');
  const c2 = opts.twoCounselors ? await registerUser(app, 'loc.two', 'counselor') : undefined;
  const a = await registerUser(app, 'survivor.a');
  const b = await registerUser(app, 'survivor.b');
  const recA = await createRecord(app, a, { kind: 'final', record: { story: 'A’s own words' } });
  const recB = await createRecord(app, b, { kind: 'final', record: { story: 'B’s own words, never shared' } });
  const blobA = await uploadBlob(app, a, new TextEncoder().encode('A evidence'));
  const blobA2 = await uploadBlob(app, a, new TextEncoder().encode('A other evidence'));
  await sealMatch(app, a, 'email', 'person@example.com', undefined, 'Alex');
  await sealMatch(app, b, 'email', 'person@example.com', undefined, 'Blair');
  let loc = c1;
  let spare = c2;
  let [g] = await groupsOf(app, c1);
  if (!g && c2) {
    [g] = await groupsOf(app, c2);
    [loc, spare] = [c2, c1];
  }
  expect(g).toBeDefined();
  const entryOf = (u: TestUser) => (db.prepare('SELECT id FROM match_entries WHERE user_id = ?').get(u.user.id) as { id: string }).id;
  return { app, db, loc, spare, a, b, recA, recB, blobA, blobA2, g: g!, entryA: entryOf(a), entryB: entryOf(b) };
}

/** A's client: wrap her record key (and chosen evidence keys) to the counselor's key, with her consent statement. */
async function consent(app: express.Express, s: TestUser, req: SurvivorReportRequest, recordId: string, recordKey: CryptoKey, blobs: Array<{ blobId: string; key: CryptoKey }> = []) {
  const fp = await publicKeyFingerprint(req.counselor.publicKey);
  return request(app)
    .post(`/api/report-requests/${req.id}/consent`)
    .set(s.auth)
    .send({
      recordId,
      recipientWrappedKey: await wrapKeyForRecipient(recordKey, req.counselor.publicKey),
      blobs: await Promise.all(blobs.map(async (b) => ({ blobId: b.blobId, recipientWrappedKey: await wrapKeyForRecipient(b.key, req.counselor.publicKey) }))),
      consentStatement: `I share my report with this counselor only (key ${fp}).`,
      counselorKeyFingerprint: fp,
    });
}

describe('stage 1: contact details only after the conflict check', () => {
  it('contactBundle is withheld until a clear check; then the details open on her device', async () => {
    const { app, loc, a, g } = await matched();
    expect(g.entries.every((e) => e.contactBundle === undefined)).toBe(true);
    expect(g.conflictCheck).toBeUndefined();
    expect(g.reportRequests).toEqual([]);
    const r0 = await reconstructMatchGroup(g.tag, g.entries, loc.privateKey, loc.user.id);
    expect(r0.ok && r0.bundles.map((x) => [x.summary.methods, x.summary.states, x.contact])).toEqual([
      [['text'], { incident: 'NJ' }, undefined],
      [['text'], { incident: 'NJ' }, undefined],
    ]);
    // nobody else can record her check: another counselor (not assigned) or a survivor
    const other = await registerUser(app, 'loc.two', 'counselor');
    getDb(app).prepare('UPDATE counselor_profiles SET jurisdictions = ? WHERE user_id = ?').run('["CA"]', other.user.id);
    expect((await check(app, other, g.id, 'clear')).status).toBe(404);
    expect((await check(app, a, g.id, 'clear')).status).toBe(403);
    expect((await request(app).post(`/api/counselor/groups/${g.id}/conflict-check`).set(loc.auth).send({ result: 'clear', statementVersion: 2 })).status).toBe(400);

    const before = ledgerTypes(app).length;
    expect((await check(app, loc, g.id, 'clear')).body).toEqual({ ok: true, result: 'clear' });
    expect((await check(app, loc, g.id, 'clear')).status).toBe(200); // idempotent: no second row
    expect(ledgerTypes(app).slice(before)).toEqual(['counselor.conflict_checked']);
    const [g1] = await groupsOf(app, loc);
    expect(g1!.conflictCheck?.result).toBe('clear');
    expect(g1!.entries.every((e) => e.contactBundle)).toBe(true);
    const r1 = await reconstructMatchGroup(g1!.tag, g1!.entries, loc.privateKey, loc.user.id);
    expect(r1.ok && r1.bundles.map((x) => [x.contact?.name, x.contact?.phone])).toEqual([
      ['Alex', '+12015550123'],
      ['Blair', '+12015550123'],
    ]);
  });

  it('conflict → the group is reassigned with her excluded; the next counselor starts at stage 1 again', async () => {
    const { app, loc, spare, g } = await matched({ twoCounselors: true });
    const loc2 = spare!;
    expect(await groupsOf(app, loc2)).toEqual([]);
    expect((await check(app, loc, g.id, 'conflict')).body).toEqual({ ok: true, result: 'conflict' });
    expect(await groupsOf(app, loc)).toEqual([]);
    const [g2] = await groupsOf(app, loc2);
    expect(g2!.id).toBe(g.id);
    expect(g2!.assignment?.reason).toMatch(/^reassigned:/);
    expect(g2!.entries.every((e) => e.contactBundle === undefined)).toBe(true);
    // and she can no longer act on it
    expect((await check(app, loc, g.id, 'clear')).status).toBe(404);
    expect(ledgerTypes(app).filter((t) => t === 'counselor.conflict_checked')).toHaveLength(1);
  });

  it('a conflict found after a clear check cancels her pending requests (the survivor no longer sees them)', async () => {
    const { app, loc, a, g, entryA } = await matched({ twoCounselors: true });
    await check(app, loc, g.id, 'clear');
    expect((await ask(app, loc, g.id, entryA)).status).toBe(201);
    expect(await requestsOf(app, a)).toHaveLength(1);
    expect((await check(app, loc, g.id, 'conflict')).status).toBe(200);
    expect(await requestsOf(app, a)).toEqual([]);
  });
});

describe('stage 2: report requests and her decision', () => {
  it('a request needs a clear check, an entry of this group, and the "she expects this" confirmation', async () => {
    const { app, loc, a, g, entryA } = await matched();
    expect((await ask(app, loc, g.id, entryA)).body.code).toBe('conflict_check_required');
    await check(app, loc, g.id, 'clear');
    expect((await request(app).post(`/api/counselor/groups/${g.id}/report-requests`).set(loc.auth).send({ entryId: entryA })).status).toBe(400);
    expect((await ask(app, loc, g.id, 'f'.repeat(32))).body.code).toBe('entry_not_found');
    expect((await ask(app, a, g.id, entryA)).status).toBe(403);
    const first = await ask(app, loc, g.id, entryA);
    expect(first.status).toBe(201);
    expect(first.body.request).toMatchObject({ groupId: g.id, entryId: entryA, status: 'pending' });
    expect((await ask(app, loc, g.id, entryA)).body.code).toBe('request_open');
    // she can withdraw a pending request, and ask again
    expect((await request(app).post(`/api/counselor/report-requests/${first.body.request.id}/cancel`).set(loc.auth)).body.request.status).toBe('cancelled');
    expect(await requestsOf(app, a)).toEqual([]);
    expect((await ask(app, loc, g.id, entryA)).status).toBe(201);
  });

  it('each survivor sees only requests about her own entry, with who is asking; never anything about anyone else', async () => {
    const { app, loc, a, b, g, entryA, entryB } = await matched();
    await check(app, loc, g.id, 'clear');
    const ra = (await ask(app, loc, g.id, entryA)).body.request;
    expect(await requestsOf(app, b)).toEqual([]);
    const [mine] = await requestsOf(app, a);
    expect(mine).toMatchObject({ id: ra.id, entryId: entryA, status: 'pending', counselor: { userId: loc.user.id, displayName: 'Counselor loc.one', organization: 'Test LOC' } });
    expect(Object.keys(mine!).sort()).toEqual(['counselor', 'createdAt', 'entryId', 'id', 'status']);
    const text = JSON.stringify(mine);
    for (const leak of [g.id, g.tag, entryB, b.user.id, b.user.username]) expect(text).not.toContain(leak);
    // B cannot see, answer or learn anything about A's request (the same 404 as for no request at all)
    expect((await request(app).post(`/api/report-requests/${ra.id}/decline`).set(b.auth)).body.code).toBe('request_not_found');
    expect((await request(app).post(`/api/report-requests/${'0'.repeat(32)}/decline`).set(b.auth)).body.code).toBe('request_not_found');
    expect((await request(app).get('/api/report-requests').set(loc.auth)).status).toBe(403);
  });

  it('yes → her report is released, wrapped to the counselor key; it decrypts to her record and evidence she chose', async () => {
    const { app, loc, a, g, entryA, recA, blobA, blobA2 } = await matched();
    await check(app, loc, g.id, 'clear');
    await ask(app, loc, g.id, entryA);
    const [req] = await requestsOf(app, a);
    const before = ledgerTypes(app).length;
    const yes = await consent(app, a, req!, recA.res.body.record.id, recA.key, [{ blobId: blobA.res.body.blob.id, key: blobA.key }]);
    expect(yes.status).toBe(201);
    expect(yes.body.release).toMatchObject({ status: 'active', recordId: recA.res.body.record.id, entryId: entryA, blobIds: [blobA.res.body.blob.id] });
    expect(yes.body.release.survivorId).toBeUndefined();
    expect(yes.body.release.groupId).toBeUndefined(); // the same for everyone in the group: never shown to a survivor
    expect(ledgerTypes(app).slice(before)).toEqual(['report.released']);
    expect((await consent(app, a, req!, recA.res.body.record.id, recA.key)).body.code).toBe('request_not_pending');

    const [g1] = await groupsOf(app, loc);
    expect(g1!.reportRequests).toEqual([expect.objectContaining({ entryId: entryA, status: 'consented', release: expect.objectContaining({ status: 'active' }) })]);
    const { releases } = (await request(app).get('/api/counselor/releases').set(loc.auth)).body;
    expect(releases).toHaveLength(1);
    expect(releases[0].firstOpenedAt).toBeUndefined();
    const bundle = (await request(app).get(`/api/counselor/releases/${releases[0].id}/bundle`).set(loc.auth)).body as ReportReleaseBundle;
    const key = await unwrapKeyWithPrivate(bundle.recipientWrappedKey, loc.privateKey);
    expect(await decryptJSON(bundle.record.envelope, key)).toEqual({ kind: 'final', record: { story: 'A’s own words' } });
    // evidence she chose opens; evidence she did not choose is not reachable
    const ev = await request(app).get(`/api/counselor/releases/${releases[0].id}/blobs/${blobA.res.body.blob.id}`).set(loc.auth).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    const evKey = await unwrapKeyWithPrivate(bundle.blobs[0]!.recipientWrappedKey, loc.privateKey);
    expect(new TextDecoder().decode(await decryptBlob(new Uint8Array(ev.body as Buffer), evKey))).toBe('A evidence');
    expect((await request(app).get(`/api/counselor/releases/${releases[0].id}/blobs/${blobA2.res.body.blob.id}`).set(loc.auth)).status).toBe(404);
    expect((await request(app).get(`/api/vault/blobs/${blobA.res.body.blob.id}`).set(loc.auth)).status).toBe(403);
    // she sees the opening in her own trail; first_opened_at is set
    const events = (await request(app).get('/api/audit').set(a.auth)).body.events as Array<{ action: string; detail: string }>;
    expect(events.find((e) => e.action === 'counselor.opened_report')?.detail).toMatch(/Counselor loc\.one, Test LOC \(legal options counselor\) opened your report at/);
    expect((await request(app).get('/api/counselor/releases').set(loc.auth)).body.releases[0].firstOpenedAt).toBeDefined();
  });

  it('the consent is bound to the counselor key she confirmed, and to records and files she owns', async () => {
    const { app, loc, a, b, g, entryA, recA, recB } = await matched();
    await check(app, loc, g.id, 'clear');
    await ask(app, loc, g.id, entryA);
    const [req] = await requestsOf(app, a);
    const fp = await publicKeyFingerprint(req!.counselor.publicKey);
    const body = async (over: Record<string, unknown>) => ({
      recordId: recA.res.body.record.id,
      recipientWrappedKey: await wrapKeyForRecipient(recA.key, req!.counselor.publicKey),
      blobs: [],
      consentStatement: `I share with key ${fp}.`,
      counselorKeyFingerprint: fp,
      ...over,
    });
    const send = async (over: Record<string, unknown>) => request(app).post(`/api/report-requests/${req!.id}/consent`).set(a.auth).send(await body(over));
    const wrongFp = fp.replace(/^./, fp[0] === 'A' ? 'B' : 'A');
    expect((await send({ counselorKeyFingerprint: wrongFp, consentStatement: `key ${wrongFp} ok` })).body.code).toBe('counselor_key_mismatch');
    expect((await send({ consentStatement: 'I share my report, without naming any key.' })).body.code).toBe('consent_fingerprint_missing');
    expect((await send({ recordId: recB.res.body.record.id })).status).toBe(403);
    const bBlob = await uploadBlob(app, b);
    expect((await send({ blobs: [{ blobId: bBlob.res.body.blob.id, recipientWrappedKey: await wrapKeyForRecipient(bBlob.key, req!.counselor.publicKey) }] })).status).toBe(403);
    expect(getDb(app).prepare('SELECT COUNT(*) n FROM report_releases').get()).toEqual({ n: 0 });
  });

  it('no → no release; the counselor sees only the decision, and cannot ask again', async () => {
    const { app, loc, b, g, entryB } = await matched();
    await check(app, loc, g.id, 'clear');
    await ask(app, loc, g.id, entryB);
    const [req] = await requestsOf(app, b);
    const before = ledgerTypes(app).length;
    const no = await request(app).post(`/api/report-requests/${req!.id}/decline`).set(b.auth);
    expect(no.body.request.status).toBe('declined');
    expect(ledgerTypes(app).slice(before)).toEqual(['report.declined']);
    expect(getDb(app).prepare('SELECT COUNT(*) n FROM report_releases').get()).toEqual({ n: 0 });
    const [g1] = await groupsOf(app, loc);
    expect(g1!.reportRequests).toEqual([expect.objectContaining({ entryId: entryB, status: 'declined' })]);
    expect(g1!.reportRequests[0]!.release).toBeUndefined();
    expect((await ask(app, loc, g.id, entryB)).body.code).toBe('she_said_no');
  });

  it('a survivor who never says yes: no counselor route returns anything of hers beyond stage 1 (Q-052 intent)', async () => {
    const { app, loc, a, b, g, entryA, entryB, recA, recB } = await matched();
    await check(app, loc, g.id, 'clear');
    await ask(app, loc, g.id, entryA);
    await ask(app, loc, g.id, entryB); // asked, never answered
    const [reqA] = await requestsOf(app, a);
    await consent(app, a, reqA!, recA.res.body.record.id, recA.key);
    const releaseA = (await request(app).get('/api/counselor/releases').set(loc.auth)).body.releases[0].id as string;
    const recBId = recB.res.body.record.id as string;
    const blobsB = await uploadBlob(app, b);
    const secretsOfB = [recBId, recB.envelope.ct, b.user.id, b.user.username, blobsB.res.body.blob.id];
    // every route a counselor can call
    const responses = await Promise.all([
      request(app).get('/api/counselor/groups').set(loc.auth),
      request(app).get('/api/counselor/releases').set(loc.auth),
      request(app).get(`/api/counselor/releases/${releaseA}/bundle`).set(loc.auth),
      request(app).get(`/api/counselor/releases/${releaseA}/blobs/${blobsB.res.body.blob.id}`).set(loc.auth),
      request(app).get(`/api/vault/records/${recBId}`).set(loc.auth),
      request(app).get(`/api/vault/blobs/${blobsB.res.body.blob.id}`).set(loc.auth),
      request(app).get('/api/vault/records').set(loc.auth),
      request(app).get('/api/vault/blobs').set(loc.auth),
      request(app).get('/api/shares').set(loc.auth),
      request(app).get('/api/escrow').set(loc.auth),
      request(app).get('/api/report-requests').set(loc.auth),
      request(app).get('/api/audit').set(loc.auth),
      request(app).get('/api/me').set(loc.auth),
    ]);
    for (const r of responses) {
      const text = JSON.stringify(r.body) + (Buffer.isBuffer(r.body) ? '' : (r.text ?? ''));
      for (const leak of secretsOfB) expect(text).not.toContain(leak);
    }
    // B's entry is in the group (stage 1 summary + contact after the check), but no route offers her report
    const [g1] = await groupsOf(app, loc);
    expect(g1!.reportRequests.find((r) => r.entryId === entryB)).toMatchObject({ status: 'pending' });
    expect(g1!.reportRequests.find((r) => r.entryId === entryB)!.release).toBeUndefined();
    // and A, the other survivor, learns nothing about B either
    const aText = JSON.stringify([(await requestsOf(app, a)), (await request(app).get('/api/audit').set(a.auth)).body]);
    for (const leak of [...secretsOfB, entryB, g.id, g.tag]) expect(aText).not.toContain(leak);
  });
});

describe('revocation, withdrawal and deletion', () => {
  async function released() {
    const m = await matched();
    await check(m.app, m.loc, m.g.id, 'clear');
    await ask(m.app, m.loc, m.g.id, m.entryA);
    const [req] = await requestsOf(m.app, m.a);
    const yes = await consent(m.app, m.a, req!, m.recA.res.body.record.id, m.recA.key, [{ blobId: m.blobA.res.body.blob.id, key: m.blobA.key }]);
    return { ...m, release: yes.body.release as { id: string } };
  }

  it('revoked before she opens it: the counselor never sees it, and first_opened_at stays empty', async () => {
    const { app, db, loc, a, b, release } = await released();
    expect((await request(app).post(`/api/report-releases/${release.id}/revoke`).set(b.auth)).body.code).toBe('release_not_found');
    const before = ledgerTypes(app).length;
    const r = await request(app).post(`/api/report-releases/${release.id}/revoke`).set(a.auth);
    expect(r.body.release.status).toBe('revoked');
    expect(ledgerTypes(app).slice(before)).toEqual(['report.revoked']);
    expect((await request(app).post(`/api/report-releases/${release.id}/revoke`).set(a.auth)).body.code).toBe('already_revoked');
    expect((await request(app).get(`/api/counselor/releases/${release.id}/bundle`).set(loc.auth)).body.code).toBe('release_revoked');
    expect((await request(app).get(`/api/counselor/releases/${release.id}/blobs/${'0'.repeat(32)}`).set(loc.auth)).body.code).toBe('release_revoked');
    expect(db.prepare('SELECT first_opened_at FROM report_releases WHERE id = ?').get(release.id)).toEqual({ first_opened_at: null });
  });

  it('revoked after she opened it: future access stops', async () => {
    const { app, loc, a, release } = await released();
    expect((await request(app).get(`/api/counselor/releases/${release.id}/bundle`).set(loc.auth)).status).toBe(200);
    await request(app).post(`/api/report-releases/${release.id}/revoke`).set(a.auth);
    expect((await request(app).get(`/api/counselor/releases/${release.id}/bundle`).set(loc.auth)).status).toBe(403);
    // her request list shows the release as revoked; the counselor cannot ask again
    expect((await requestsOf(app, a))[0]!.release?.status).toBe('revoked');
  });

  it('an expired release is refused', async () => {
    const { app, db, loc, release } = await released();
    db.prepare('UPDATE report_releases SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), release.id);
    expect((await request(app).get(`/api/counselor/releases/${release.id}/bundle`).set(loc.auth)).body.code).toBe('release_expired');
  });

  it('withdrawing her entry deletes its requests and releases; the counselor sees them vanish', async () => {
    const { app, db, loc, a, entryA, release } = await released();
    const before = ledgerTypes(app).length;
    expect((await request(app).delete(`/api/matching/entries/${entryA}`).set(a.auth)).status).toBe(200);
    // the live release ended with its own ledger row (only hashes stay), and her trail says so
    expect(ledgerTypes(app).slice(before)).toEqual(['report.revoked']);
    const trail = (await request(app).get('/api/audit').set(a.auth)).body.events as Array<{ detail: string }>;
    expect(trail.some((e) => /no longer shared with .*you withdrew the sealed identifier/.test(e.detail))).toBe(true);
    for (const t of ['report_requests', 'report_releases', 'report_release_blobs']) expect(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get()).toEqual({ n: 0 });
    expect((await request(app).get(`/api/counselor/releases/${release.id}/bundle`).set(loc.auth)).status).toBe(404);
    expect(await requestsOf(app, a)).toEqual([]);
  });

  it('deleting her account, or the counselor’s, removes every staged-release row about them', async () => {
    const { app, db, loc, a, release } = await released();
    expect((await request(app).post('/api/account/delete').set(a.auth).send({ authKey: a.authKey })).status).toBe(200);
    for (const t of ['report_requests', 'report_releases', 'report_release_blobs']) expect(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get()).toEqual({ n: 0 });
    expect((await request(app).get(`/api/counselor/releases/${release.id}/bundle`).set(loc.auth)).status).toBe(404);
    expect((await request(app).post('/api/account/delete').set(loc.auth).send({ authKey: loc.authKey })).status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) n FROM conflict_checks').get()).toEqual({ n: 0 });
  });
});

describe('ledger', () => {
  it('nothing is written at match time; every check, request, consent, decline and revoke has its own row', async () => {
    const { app, db } = makeApp();
    const loc = await registerUser(app, 'loc.one', 'counselor');
    const a = await registerUser(app, 'survivor.a');
    const b = await registerUser(app, 'survivor.b');
    const recA = await createRecord(app, a, { kind: 'final' });
    await sealMatch(app, a, 'email', 'person@example.com');
    const before = ledgerTypes(app).length;
    await sealMatch(app, b, 'email', 'person@example.com'); // the match
    const [g] = await groupsOf(app, loc);
    expect(ledgerTypes(app).slice(before)).toEqual(['escrow.sealed']);
    const entryOf = (u: TestUser) => (db.prepare('SELECT id FROM match_entries WHERE user_id = ?').get(u.user.id) as { id: string }).id;
    await check(app, loc, g!.id, 'clear');
    await ask(app, loc, g!.id, entryOf(a));
    await ask(app, loc, g!.id, entryOf(b));
    const [ra] = await requestsOf(app, a);
    const [rb] = await requestsOf(app, b);
    const rel = (await consent(app, a, ra!, recA.res.body.record.id, recA.key)).body.release;
    await request(app).post(`/api/report-requests/${rb!.id}/decline`).set(b.auth);
    await request(app).post(`/api/report-releases/${rel.id}/revoke`).set(a.auth);
    expect(ledgerTypes(app).slice(before + 1)).toEqual([
      'counselor.conflict_checked',
      'report.requested',
      'report.requested',
      'report.released',
      'report.declined',
      'report.revoked',
    ]);
    expect((await request(app).get('/api/ledger/verify')).body.ok).toBe(true);
  });
});

describe('a release outlives a re-seal, ends when the counselor can no longer hold it, and a no stays a no', () => {
  /** A said yes (release live), B said no. */
  async function decided(opts: { twoCounselors?: boolean } = {}) {
    const m = await matched(opts);
    await check(m.app, m.loc, m.g.id, 'clear');
    await ask(m.app, m.loc, m.g.id, m.entryA);
    await ask(m.app, m.loc, m.g.id, m.entryB);
    const [ra] = await requestsOf(m.app, m.a);
    const [rb] = await requestsOf(m.app, m.b);
    const release = (await consent(m.app, m.a, ra!, m.recA.res.body.record.id, m.recA.key)).body.release as { id: string };
    expect((await request(m.app).post(`/api/report-requests/${rb!.id}/decline`).set(m.b.auth)).status).toBe(200);
    return { ...m, release };
  }
  const bundleOf = (app: express.Express, c: TestUser, id: string) => request(app).get(`/api/counselor/releases/${id}/bundle`).set(c.auth);

  it('re-seal under a new key epoch, same tag: her yes and her no both carry over, with no revoke row', async () => {
    const { app, db, loc, a, b, g, release } = await decided();
    db.prepare('UPDATE match_entries SET key_epoch = 0').run(); // as after an epoch bump without an OPRF key change
    const before = ledgerTypes(app).length;
    for (const u of [a, b]) expect((await refreshMatchEntries(matchTransport(app, u), { masterKey: u.masterKey })).resealed).toBe(1);
    expect(ledgerTypes(app).slice(before)).toEqual(['escrow.sealed', 'escrow.sealed']);
    const newA = (db.prepare('SELECT id FROM match_entries WHERE user_id = ?').get(a.user.id) as { id: string }).id;
    const newB = (db.prepare('SELECT id FROM match_entries WHERE user_id = ?').get(b.user.id) as { id: string }).id;
    // same group; the release is still live and readable
    const [g1] = await groupsOf(app, loc);
    expect(g1!.id).toBe(g.id);
    expect((await bundleOf(app, loc, release.id)).status).toBe(200);
    expect((await requestsOf(app, a))[0]).toMatchObject({ entryId: newA, status: 'consented', release: { status: 'active' } });
    expect((await requestsOf(app, b))[0]).toMatchObject({ entryId: newB, status: 'declined' });
    // and the counselor still cannot ask B again, nor ask A for what she already has
    expect((await ask(app, loc, g.id, newB)).body.code).toBe('she_said_no');
    expect((await ask(app, loc, g.id, newA)).body.code).toBe('already_shared');
  });

  it('re-seal into a new tag (rotated OPRF key): Matra ends her release, ledgered and in her trail; it is not a no', async () => {
    const { app, db, loc, a, release, entryA } = await decided();
    const n = normalizeMatchIdentifier('email', 'someone.else@example.com');
    if (!n.ok) throw new Error('unreachable');
    const before = ledgerTypes(app).length;
    await submitMatchEntry(matchTransport(app, a), {
      masterKey: a.masterKey,
      identifier: n,
      contact: { name: 'Alex', methods: ['text'], phone: '+12015550123' },
      consentStatement: 'If someone else names the same person, a counselor may contact me.',
      label: 'email',
      states: { incident: 'NJ' },
      replacesEntryId: entryA,
    });
    expect(ledgerTypes(app).slice(before)).toEqual(['report.revoked', 'escrow.sealed']);
    expect((await bundleOf(app, loc, release.id)).body.code).toBe('release_revoked');
    const [mine] = await requestsOf(app, a);
    expect(mine!.release).toMatchObject({ status: 'revoked', revokeReason: 'resealed' });
    const trail = (await request(app).get('/api/audit').set(a.auth)).body.events as Array<{ detail: string }>;
    expect(trail.some((e) => /no longer shared with Counselor loc\.one, Test LOC: your sealed match moved to new matching keys/.test(e.detail))).toBe(true);
    expect(db.prepare('SELECT revoke_reason FROM report_releases WHERE id = ?').get(release.id)).toEqual({ revoke_reason: 'resealed' });
  });

  it('a conflict found after her yes revokes the release and tells her; the next counselor may ask her, but not B', async () => {
    const { app, loc, spare, a, b, g, release, entryA, entryB } = await decided({ twoCounselors: true });
    expect((await bundleOf(app, loc, release.id)).status).toBe(200);
    const before = ledgerTypes(app).length;
    expect((await check(app, loc, g.id, 'conflict')).status).toBe(200);
    expect(ledgerTypes(app).slice(before)).toEqual(['counselor.conflict_checked', 'report.revoked']);
    expect((await bundleOf(app, loc, release.id)).body.code).toBe('release_revoked');
    expect((await request(app).get(`/api/counselor/releases/${release.id}/blobs/${'0'.repeat(32)}`).set(loc.auth)).body.code).toBe('release_revoked');
    const [mine] = await requestsOf(app, a);
    expect(mine!.release).toMatchObject({ status: 'revoked', revokeReason: 'conflict' });
    const trail = (await request(app).get('/api/audit').set(a.auth)).body.events as Array<{ detail: string }>;
    expect(trail.some((e) => e.detail.startsWith(`Your report is no longer shared with Counselor ${loc.user.username}, Test LOC: they can’t take on this matter`))).toBe(true);
    // B's trail says nothing (no release of hers was touched)
    expect(JSON.stringify((await request(app).get('/api/audit').set(b.auth)).body)).not.toMatch(/no longer shared/);
    // the next counselor: Matra ending A's access was not A's no; B's no binds every counselor
    expect((await check(app, spare!, g.id, 'clear')).status).toBe(200);
    expect((await ask(app, spare!, g.id, entryA)).status).toBe(201);
    expect((await ask(app, spare!, g.id, entryB)).body.code).toBe('she_said_no');
  });

  it('a release she revoked is a no for every counselor, not just the one she revoked', async () => {
    const { app, loc, spare, a, g, release, entryA } = await decided({ twoCounselors: true });
    await request(app).post(`/api/report-releases/${release.id}/revoke`).set(a.auth);
    await check(app, loc, g.id, 'conflict');
    await check(app, spare!, g.id, 'clear');
    expect((await ask(app, spare!, g.id, entryA)).body.code).toBe('she_said_no');
  });

  it('read access needs the group still assigned to her and her name still on the signed roster', async () => {
    const { app, db, loc, spare, release } = await decided({ twoCounselors: true });
    expect((await bundleOf(app, loc, release.id)).status).toBe(200);
    // off the signed roster (only the other counselor listed)
    const org = generateRosterKey();
    const roster = signCounselorRoster([{ userId: spare!.user.id, publicKey: spare!.user.publicKey }], org.secretKey);
    db.prepare(`INSERT INTO matching_meta (key, value) VALUES ('counselor_roster', ?)`).run(JSON.stringify(roster));
    expect((await bundleOf(app, loc, release.id)).body.code).toBe('release_revoked');
    db.prepare(`DELETE FROM matching_meta WHERE key = 'counselor_roster'`).run();
    expect((await bundleOf(app, loc, release.id)).status).toBe(200);
    // no longer assigned the group
    db.prepare('DELETE FROM match_assignments WHERE counselor_id = ?').run(loc.user.id);
    expect((await bundleOf(app, loc, release.id)).body.code).toBe('release_revoked');
  });
});

describe('another counselor cannot reach a counselor’s requests, releases or groups', () => {
  it('404 on every route for a verified counselor who is not assigned; the request stays pending', async () => {
    const { app, loc, spare, a, g, entryA, entryB, recA, blobA } = await matched({ twoCounselors: true });
    await check(app, loc, g.id, 'clear');
    const pendingB = (await ask(app, loc, g.id, entryB)).body.request as { id: string };
    await ask(app, loc, g.id, entryA);
    const ra = (await requestsOf(app, a))[0]!;
    const release = (await consent(app, a, ra, recA.res.body.record.id, recA.key, [{ blobId: blobA.res.body.blob.id, key: blobA.key }])).body.release as { id: string };
    const other = spare!;
    expect((await request(app).get(`/api/counselor/releases/${release.id}/bundle`).set(other.auth)).body.code).toBe('release_not_found');
    expect((await request(app).get(`/api/counselor/releases/${release.id}/blobs/${blobA.res.body.blob.id}`).set(other.auth)).body.code).toBe('release_not_found');
    expect((await request(app).get('/api/counselor/releases').set(other.auth)).body.releases).toEqual([]);
    expect((await request(app).post(`/api/counselor/report-requests/${pendingB.id}/cancel`).set(other.auth)).body.code).toBe('request_not_found');
    expect((await ask(app, other, g.id, entryB)).body.code).toBe('group_not_found');
    expect((await check(app, other, g.id, 'clear')).body.code).toBe('group_not_found');
    const [g1] = await groupsOf(app, loc);
    expect(g1!.reportRequests.find((r) => r.id === pendingB.id)).toMatchObject({ status: 'pending' });
  });
});
