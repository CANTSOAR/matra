/**
 * Matra demo seed — idempotent. Creates FICTIONAL demo accounts through the real API
 * (client-side key derivation with @matra/crypto, exactly like the web app):
 *   - 3 verified attorneys (NJ / NY)
 *   - 1 verified Legal Options Counselor, counselor.demo (receives matched sealed-match groups only)
 *   - 1 survivor, jane.demo, with no records (the live demo creates them)
 *
 *   npm run seed -w @matra/server          (MATRA_DB_PATH overrides the DB location)
 */
import type { AddressInfo } from 'node:net';
import { DEFAULT_KDF_ITERATIONS, deriveKeys, generateIdentity, newKdfSalt } from '@matra/crypto';
import type { AuthResponse, RegisterRequest } from '@matra/shared';
import { createApp, getDb } from './app.js';
import { loadOprfKey, loadPepper, resolveDbPath } from './config.js';

const ATTORNEY_PASSPHRASE = 'demo-attorney-passphrase';
const SURVIVOR_PASSPHRASE = 'demo-survivor-passphrase';
const COUNSELOR_PASSPHRASE = 'demo-counselor-passphrase';
const COUNSELOR = {
  username: 'counselor.demo',
  profile: { displayName: 'Demo — Sam Lee, Legal Options Counselor', organization: 'Demo — Matra Legal Options Counseling', jurisdictions: ['NJ', 'NY'] },
};

type AttorneySeed = { username: string; profile: NonNullable<RegisterRequest['attorneyProfile']> };

const ATTORNEYS: AttorneySeed[] = [
  {
    username: 'attorney.nj1',
    profile: {
      displayName: 'Demo — Alex Rivera, Esq.',
      organization: "Demo — Garden State Victims' Rights Clinic",
      barNumber: 'DEMO-NJ-000001',
      jurisdictions: ['NJ'],
      practiceAreas: ['Sexual assault', 'Protective orders', 'Crime victim compensation', 'Victim rights advocacy'],
      acceptsProBono: true,
    },
  },
  {
    username: 'attorney.ny1',
    profile: {
      displayName: 'Demo — Priya Natarajan, Esq.',
      organization: "Demo — Empire State Survivors' Legal Collective",
      barNumber: 'DEMO-NY-000002',
      jurisdictions: ['NY'],
      practiceAreas: ['Sexual assault', 'Civil remedies', 'Image-based abuse', 'Orders of protection'],
      acceptsProBono: true,
    },
  },
  {
    username: 'attorney.nj2',
    profile: {
      displayName: 'Demo — Jordan Okafor, Esq.',
      organization: 'Demo — Hudson River Title IX & Survivor Advocacy Project',
      barNumber: 'DEMO-NJ-000003',
      jurisdictions: ['NJ', 'NY'],
      practiceAreas: ['Title IX', 'Campus sexual misconduct', 'Stalking', 'Dating violence'],
      acceptsProBono: true,
    },
  },
];

async function main() {
  const dbPath = resolveDbPath();
  const app = createApp({ dbPath, pepper: loadPepper(), matching: { keyA: loadOprfKey('a'), keyB: loadOprfKey('b') } });
  const db = getDb(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const exists = (username: string) => !!db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);

  async function register(
    username: string,
    passphrase: string,
    role: RegisterRequest['role'],
    attorneyProfile?: AttorneySeed['profile'],
    counselorProfile?: RegisterRequest['counselorProfile'],
  ) {
    const kdfSalt = newKdfSalt();
    const { authKey, masterKey } = await deriveKeys(passphrase, kdfSalt, DEFAULT_KDF_ITERATIONS);
    const { publicKey, wrappedPrivateKey } = await generateIdentity(masterKey);
    const body: RegisterRequest = {
      username,
      role,
      authKey,
      kdfSalt,
      kdfIterations: DEFAULT_KDF_ITERATIONS,
      publicKey,
      wrappedPrivateKey,
      ...(role === 'survivor' && { ageConfirmed18: true as const }),
      ...(attorneyProfile && { attorneyProfile }),
      ...(counselorProfile && { counselorProfile }),
    };
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`register ${username} failed: ${res.status} ${await res.text()}`);
    const { user, token } = (await res.json()) as AuthResponse;
    // Don't leave a dangling seed session around.
    await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    return user;
  }

  try {
    console.log(`[seed] database: ${dbPath}`);
    for (const a of ATTORNEYS) {
      if (exists(a.username)) {
        console.log(`[seed] skip   ${a.username} (exists)`);
      } else {
        await register(a.username, ATTORNEY_PASSPHRASE, 'attorney', a.profile);
        console.log(`[seed] create ${a.username}  — ${a.profile.displayName} / ${a.profile.organization}`);
      }
      db.prepare(
        `UPDATE attorney_profiles SET verified = 1 WHERE user_id = (SELECT id FROM users WHERE username = ?)`,
      ).run(a.username);
    }
    if (exists(COUNSELOR.username)) console.log(`[seed] skip   ${COUNSELOR.username} (exists)`);
    else {
      await register(COUNSELOR.username, COUNSELOR_PASSPHRASE, 'counselor', undefined, COUNSELOR.profile);
      console.log(`[seed] create ${COUNSELOR.username}  — ${COUNSELOR.profile.displayName} / ${COUNSELOR.profile.organization}`);
    }
    db.prepare(`UPDATE counselor_profiles SET verified = 1 WHERE user_id = (SELECT id FROM users WHERE username = ?)`).run(COUNSELOR.username);
    if (exists('jane.demo')) console.log('[seed] skip   jane.demo (exists)');
    else {
      await register('jane.demo', SURVIVOR_PASSPHRASE, 'survivor');
      console.log('[seed] create jane.demo (survivor, no records)');
    }

    console.log('\n[seed] Matra demo accounts (ALL FICTIONAL — for demonstration only):');
    for (const a of ATTORNEYS) console.log(`  attorney  ${a.username.padEnd(14)} passphrase: ${ATTORNEY_PASSPHRASE}  [${a.profile.jurisdictions.join(', ')}] verified`);
    console.log(`  counselor ${COUNSELOR.username.padEnd(14)} passphrase: ${COUNSELOR_PASSPHRASE}  [${COUNSELOR.profile.jurisdictions.join(', ')}] verified`);
    console.log(`  survivor  ${'jane.demo'.padEnd(14)} passphrase: ${SURVIVOR_PASSPHRASE}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  }
}

main().catch((err) => {
  console.error('[seed] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
