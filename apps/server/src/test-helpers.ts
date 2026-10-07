import request from 'supertest';
import type express from 'express';
import {
  deriveKeys,
  encryptBlob,
  encryptJSON,
  generateContentKey,
  generateIdentity,
  newKdfSalt,
  wrapKeyWithMaster,
} from '@matra/crypto';
import type { AttorneyProfile, AuthResponse, Envelope, RegisterRequest, Role } from '@matra/shared';
import { createApp, getDb } from './app.js';

export const TEST_ITERATIONS = 1000;
export const TEST_PEPPER = 'test-pepper-0123456789abcdef-0123456789';

export function makeApp(extra: { autoVerifyAttorneys?: boolean } = {}) {
  const app = createApp({ dbPath: ':memory:', pepper: TEST_PEPPER, ...extra });
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
  opts: { verify?: boolean; profile?: RegisterRequest['attorneyProfile']; adultAffirmation?: boolean | null } = {},
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
    ...(role === 'survivor' && opts.adultAffirmation !== null && { adultAffirmation: opts.adultAffirmation ?? true }),
    ...(role === 'attorney' && { attorneyProfile: opts.profile ?? defaultProfile }),
  };
  const res = await request(app).post('/api/auth/register').send(body);
  if (res.status !== 201) throw new Error(`register failed ${res.status} ${JSON.stringify(res.body)}`);
  if (role === 'attorney' && opts.verify !== false)
    getDb(app).prepare('UPDATE attorney_profiles SET verified = 1 WHERE user_id = ?').run(res.body.user.id);
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
