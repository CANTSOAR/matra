import request from 'supertest';
import type express from 'express';
import {
  deriveKeys,
  normalizeMatchIdentifier,
  submitMatchEntry,
  type MatchPins,
  type MatchTransport,
  encryptBlob,
  encryptJSON,
  generateContentKey,
  generateIdentity,
  newKdfSalt,
  wrapKeyWithMaster,
} from '@matra/crypto';
import type { AttorneyProfile, AuthResponse, Envelope, IdentifierKind, RegisterRequest, Role } from '@matra/shared';
import { createApp, getDb, type CreateAppOptions } from './app.js';

export const TEST_ITERATIONS = 1000;
export const TEST_PEPPER = 'test-pepper-0123456789abcdef-0123456789';

export function makeApp(extra: { autoVerifyAttorneys?: boolean; matching?: CreateAppOptions['matching']; dbPath?: string } = {}) {
  // Tests release matched groups immediately unless they set a delay (production default: 72 h).
  const app = createApp({ dbPath: ':memory:', pepper: TEST_PEPPER, ...extra, matching: { releaseDelayHours: 0, ...extra.matching } });
  return { app, db: getDb(app) };
}

export interface TestUser {
  token: string;
  user: AuthResponse['user'];
  masterKey: CryptoKey;
  privateKey: CryptoKey;
  authKey: string;
  passphrase: string;
  auth: { Authorization: string };
}

export const defaultProfile: Omit<AttorneyProfile, 'userId' | 'verified' | 'publicKey'> = {
  displayName: 'Test Counsel',
  organization: 'Test Clinic',
  jurisdictions: ['NJ'],
  practiceAreas: ['Sexual assault'],
  acceptsProBono: true,
};

export async function registerUser(
  app: express.Express,
  username: string,
  role: Role = 'survivor',
  opts: { verify?: boolean; profile?: RegisterRequest['attorneyProfile']; ageConfirmed18?: boolean | null } = {},
): Promise<TestUser> {
  const passphrase = `pass-${username}`;
  const kdfSalt = newKdfSalt();
  const { authKey, masterKey } = await deriveKeys(passphrase, kdfSalt, TEST_ITERATIONS);
  const id = await generateIdentity(masterKey);
  const body: RegisterRequest = {
    username,
    role,
    authKey,
    kdfSalt,
    kdfIterations: TEST_ITERATIONS,
    publicKey: id.publicKey,
    wrappedPrivateKey: id.wrappedPrivateKey,
    ...(role === 'survivor' && opts.ageConfirmed18 !== null && { ageConfirmed18: (opts.ageConfirmed18 ?? true) as true }),
    ...(role === 'attorney' && { attorneyProfile: opts.profile ?? defaultProfile }),
    ...(role === 'counselor' && { counselorProfile: { displayName: `Counselor ${username}`, organization: 'Test LOC', jurisdictions: ['NJ'] } }),
  };
  const res = await request(app).post('/api/auth/register').send(body);
  if (res.status !== 201) throw new Error(`register failed ${res.status} ${JSON.stringify(res.body)}`);
  if (role === 'attorney' && opts.verify !== false)
    getDb(app).prepare('UPDATE attorney_profiles SET verified = 1 WHERE user_id = ?').run(res.body.user.id);
  if (role === 'counselor' && opts.verify !== false)
    getDb(app).prepare('UPDATE counselor_profiles SET verified = 1 WHERE user_id = ?').run(res.body.user.id);
  return {
    token: res.body.token,
    user: res.body.user,
    masterKey,
    privateKey: id.privateKey,
    authKey,
    passphrase,
    auth: { Authorization: `Bearer ${res.body.token}` },
  };
}

export async function createRecord(app: express.Express, u: TestUser, data: unknown = { hello: 'world' }, supersedes?: string) {
  const key = await generateContentKey();
  const envelope: Envelope = await encryptJSON(data, key);
  const ownerWrappedKey = await wrapKeyWithMaster(key, u.masterKey);
  const res = await request(app)
    .post('/api/vault/records')
    .set(u.auth)
    .send({ envelope, ownerWrappedKey, ...(supersedes && { supersedes }) });
  return { res, key, envelope };
}

export async function uploadBlob(app: express.Express, u: TestUser, bytes = new TextEncoder().encode('evidence bytes')) {
  const key = await generateContentKey();
  const ct = await encryptBlob(bytes, key);
  const wrapped = await wrapKeyWithMaster(key, u.masterKey);
  const res = await request(app)
    .post('/api/vault/blobs')
    .set(u.auth)
    .set('Content-Type', 'application/octet-stream')
    .set('X-Owner-Wrapped-Key', Buffer.from(JSON.stringify(wrapped)).toString('base64'))
    .send(Buffer.from(ct));
  return { res, key, ct };
}

/** The survivor client's network calls, over supertest (same code path as the web app's ApiClient). */
export function matchTransport(app: express.Express, u: TestUser): MatchTransport {
  const ok = <T>(r: request.Response): T => {
    if (r.status >= 300) throw Object.assign(new Error(`${r.status} ${r.body?.code}`), { status: r.status, code: r.body?.code });
    return r.body as T;
  };
  return {
    config: async () => ok(await request(app).get('/api/matching/config').set(u.auth)),
    evaluate: async (h, req) => ok(await request(app).post(`/api/matching/oprf-${h}`).set(u.auth).send(req)),
    createEntry: async (req) => ok(await request(app).post('/api/matching/entries').set(u.auth).send(req)),
    listEntries: async () => ok(await request(app).get('/api/matching/entries').set(u.auth)),
    addSeals: async (id, req) => ok(await request(app).post(`/api/matching/entries/${id}/seals`).set(u.auth).send(req)),
  };
}

/** Survivor names `value` (kind/platform) for sealed matching, with a contact bundle. */
export async function sealMatch(
  app: express.Express,
  u: TestUser,
  kind: IdentifierKind,
  value: string,
  platform?: string,
  contactName = u.user.username,
  pins?: MatchPins,
) {
  const n = normalizeMatchIdentifier(kind, value, platform);
  if (!n.ok) throw new Error(`not matchable: ${n.reason}`);
  return submitMatchEntry(matchTransport(app, u), {
    masterKey: u.masterKey,
    identifier: n,
    contact: { name: contactName, methods: ['text'], phone: '+12015550123' },
    consentStatement: 'If someone else names the same person, a counselor may contact me.',
    label: `${kind}`,
    ...(pins && { pins }),
  });
}
