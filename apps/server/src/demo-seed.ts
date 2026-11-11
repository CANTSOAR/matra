/**
 * The demo profile seed (docs/design/WEEKEND_MVP.md §4.2), run by `npm run demo:reset` (scripts/demo-reset.mjs) with the
 * whole demo stack's configuration: remote OPRF key holders, a separate matcher, the mock SMS provider, demo pins.
 * The holders and the matcher must be running. ALL DATA IS FICTIONAL; every display name starts with "Demo —".
 *
 * Everything goes through the real API and the real client crypto in Node, exactly as the web app does it: keys are
 * derived from each passphrase, records are encrypted before upload, phone numbers are verified with the mock
 * provider's code, sealed-match entries are blinded, evaluated by t of the m holders, and their routing states sealed to
 * the attested matcher. Only two things are set directly in the database, as an operator would: attorneys' and
 * counselors' "verified" flags. The counselor roster is signed with the demo organization key
 * (MATRA_COUNSELOR_ROSTER_SIGNING_KEY_FILE, given only to this script), as `sign-roster` does.
 *
 *   Attorneys   attorney.nj1 (NJ), attorney.ny1 (NY), attorney.nj2 (NJ, NY)
 *   Counselors  counselor.nj (licensed NJ), counselor.ny (licensed NY), counselor.pa (licensed PA)
 *   Survivors   jane.demo   empty: the live demo creates her story and her sealed match
 *               sam.demo    phone-verified; sealed story; sealed match on instagram @demo_handle_123, happened in NY,
 *                           lives in NJ, text only
 *               morgan.demo phone-verified; sealed story; sealed match on the same profile (typed as a URL), happened
 *                           in NY, lives in NY, email only. Sam + Morgan form a group, which the matcher gives to
 *                           counselor.ny (licensed where it happened); counselor.nj (licensed where Sam lives) and
 *                           counselor.pa get nothing.
 *               taylor.demo names the same profile in her sealed story but said NO to sealed matching: nothing about it
 *                           leaves her vault, and she is in no group.
 *               riley.demo  sealed story and three (fictional, text) evidence files already shared with attorney.nj1
 *                           (the attorney part of the demo, no waiting: the verification panel and /verify).
 *
 * Refuses to run unless MATRA_DEMO_MODE=1 and the database is under a `.demo` directory (it registers fixed accounts
 * with published passphrases). Not idempotent on its own: demo:reset deletes the demo databases first.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  DEFAULT_KDF_ITERATIONS,
  deriveKeys,
  encryptBlob,
  encryptJSON,
  generateContentKey,
  generateIdentity,
  newKdfSalt,
  normalizeMatchIdentifier,
  publicKeyFingerprint,
  rosterPublicKey,
  sha256Hex,
  signCounselorRoster,
  submitMatchEntry,
  toBase64,
  wrapKeyForRecipient,
  wrapKeyWithMaster,
  type MatchPins,
  type MatchTransport,
} from '@matra/crypto';
import type { AttorneyProfile, AuthResponse, EvidenceItem, EvidenceKind, IntakeRecord, MatchContactPreferences, MatchStates, RegisterRequest } from '@matra/shared';
import { createApp, flushPhoneTokens, getDb } from './app.js';
import {
  loadDemoMode,
  loadMatcherConfig,
  loadMatchingSettings,
  loadOprfLimits,
  loadOprfThreshold,
  loadPepper,
  loadPhoneVerification,
  resolveDbPath,
} from './config.js';

const DEMO_PASSPHRASES = {
  attorney: 'demo-attorney-passphrase',
  counselor: 'demo-counselor-passphrase',
  survivor: 'demo-survivor-passphrase',
} as const;

const ATTORNEYS: Array<{ username: string; profile: NonNullable<RegisterRequest['attorneyProfile']> }> = [
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

const ORG = 'Demo — Matra Legal Options Counseling';
const COUNSELORS: Array<{ username: string; profile: NonNullable<RegisterRequest['counselorProfile']> }> = [
  { username: 'counselor.nj', profile: { displayName: 'Demo — Sam Lee, Legal Options Counselor', organization: ORG, jurisdictions: ['NJ'] } },
  { username: 'counselor.ny', profile: { displayName: 'Demo — Robin Ortiz, Legal Options Counselor', organization: ORG, jurisdictions: ['NY'] } },
  { username: 'counselor.pa', profile: { displayName: 'Demo — Casey Brooks, Legal Options Counselor', organization: ORG, jurisdictions: ['PA'] } },
];

interface StorySeed {
  preferredName: string;
  narrative: string;
  incidentState: string;
  residenceState: string;
  perpetrator: { name: string; relationship: string; identifiers: IntakeRecord['perpetrators'][number]['identifiers']; escrowOptIn: boolean };
  contact?: { phone?: string; email?: string; safe: IntakeRecord['survivor']['safeContact'] };
}

const SAM: StorySeed = {
  preferredName: 'Sam',
  narrative:
    'It happened after a rooftop party in Brooklyn last spring. I had met him twice before through friends. He offered to walk me to the subway and I said no, I was fine. He followed me anyway and would not let me leave the stairwell.',
  incidentState: 'NY',
  residenceState: 'NJ',
  perpetrator: { name: 'D.', relationship: 'friend of a friend', identifiers: [{ kind: 'social_handle', platform: 'instagram', value: '@demo_handle_123' }], escrowOptIn: true },
  contact: { phone: '(555) 010-0201', safe: { phone: false, text: true, email: false, voicemail: false } },
};
const MORGAN: StorySeed = {
  preferredName: 'Morgan',
  narrative:
    'We were in the same study group on Tuesday nights. After the last session he drove me home and would not unlock the car. I remember his blue scarf and the song on the radio.',
  incidentState: 'NY',
  residenceState: 'NY',
  perpetrator: {
    name: 'Dan',
    relationship: 'classmate',
    identifiers: [{ kind: 'social_handle', platform: 'instagram', value: 'https://www.instagram.com/Demo_Handle_123/' }],
    escrowOptIn: true,
  },
  contact: { email: 'm.reyes@example.com', safe: { phone: false, text: false, email: true, voicemail: false } },
};
const TAYLOR: StorySeed = {
  preferredName: 'Taylor',
  narrative:
    'I worked with him at the record shop. I am writing this down so I have it, but I do not want anyone contacted about it right now.',
  incidentState: 'NJ',
  residenceState: 'NJ',
  perpetrator: { name: 'D.', relationship: 'coworker', identifiers: [{ kind: 'social_handle', platform: 'instagram', value: '@demo_handle_123' }], escrowOptIn: false },
};
const RILEY: StorySeed = {
  preferredName: 'Riley',
  narrative:
    'He was my landlord. After I complained about the heating he started letting himself into my apartment while I was home. The last time, he cornered me in the kitchen and grabbed me.',
  incidentState: 'NJ',
  residenceState: 'NJ',
  perpetrator: { name: 'Mr. P.', relationship: 'landlord', identifiers: [], escrowOptIn: false },
  contact: { phone: '(555) 010-0204', safe: { phone: true, text: true, email: false, voicemail: false } },
};

/** Riley's evidence (fictional): text files, so the attorney's verification panel and /verify have files to check. */
const RILEY_EVIDENCE: Array<{ fileName: string; kind: EvidenceKind; description: string; text: string }> = [
  {
    fileName: 'demo-texts-with-landlord.txt',
    kind: 'message_export',
    description: 'Texts he sent before letting himself in (fictional demo file)',
    text: 'DEMO — FICTIONAL\nMon 7:42 pm  Landlord: Coming by to look at the heater.\nMon 7:43 pm  Me: Please not tonight, I am home.\nMon 8:05 pm  Landlord: Already here.\n',
  },
  {
    fileName: 'demo-heating-complaint.txt',
    kind: 'document',
    description: 'The heating complaint I sent the week before (fictional demo file)',
    text: 'DEMO — FICTIONAL\nTo the building office: the heating in my unit has not worked for nine days. Please fix it.\n',
  },
  {
    fileName: 'demo-dates-he-came-in.txt',
    kind: 'document',
    description: 'My notes of the dates he came in without asking (fictional demo file)',
    text: 'DEMO — FICTIONAL\nOct 3, evening. Oct 9, morning. Oct 14, evening (kitchen).\n',
  },
];

function intakeRecord(s: StorySeed, evidence: EvidenceItem[] = []): IntakeRecord {
  return {
    schemaVersion: 1,
    completedAt: new Date().toISOString(),
    survivor: {
      preferredName: s.preferredName,
      ...(s.contact?.phone && { phone: s.contact.phone }),
      ...(s.contact?.email && { email: s.contact.email }),
      safeContact: s.contact?.safe ?? { phone: false, text: false, email: false, voicemail: false },
      residenceState: s.residenceState,
    },
    incident: { dateIsApproximate: true, jurisdiction: { state: s.incidentState }, incidentTypes: ['sexual_assault'], isOngoing: false },
    narrative: {
      entries: [{ id: 'e1', createdAt: new Date().toISOString(), text: s.narrative, source: 'typed' }],
      freeRecall: s.narrative,
      sensory: {},
    },
    perpetrators: [{ id: 'p1', knownToSurvivor: true, ...s.perpetrator }],
    witnesses: [],
    disclosures: [],
    medical: { soughtCare: false },
    priorReports: [],
    evidence,
    safety: { immediateSafety: 'safe' },
    financialImpact: {},
    goals: { policeReport: 'undecided', attorney: 'yes', compensation: 'undecided', protectiveOrder: 'undecided' },
  };
}

function demoPins(env: NodeJS.ProcessEnv): MatchPins {
  const shares = (env.MATRA_OPRF_SHARE_PUBKEYS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    ...(env.MATRA_OPRF_GROUP_PUBKEY && shares.length && { oprf: { t: Number(env.MATRA_OPRF_THRESHOLD || 2), groupPublicKey: env.MATRA_OPRF_GROUP_PUBKEY, holders: shares } }),
    ...(env.MATRA_COUNSELOR_ROSTER_PUBKEY && { rosterKey: env.MATRA_COUNSELOR_ROSTER_PUBKEY }),
    ...(env.MATRA_ATTESTATION_PLATFORM_PUBKEY &&
      env.MATRA_MATCHER_MEASUREMENT && { attestation: { platformKey: env.MATRA_ATTESTATION_PLATFORM_PUBKEY, measurement: env.MATRA_MATCHER_MEASUREMENT } }),
    allowSimulatedAttestation: true, // a demo build accepts the SIMULATED platform (and still checks the measurement)
  };
}

async function main() {
  const dbPath = path.resolve(resolveDbPath());
  if (!loadDemoMode()) throw new Error('demo-seed runs only with MATRA_DEMO_MODE=1 (fictional data, published passphrases).');
  if (!dbPath.split(path.sep).includes('.demo')) throw new Error(`demo-seed refuses a database outside a .demo directory: ${dbPath}`);
  const signingKeyFile = process.env.MATRA_COUNSELOR_ROSTER_SIGNING_KEY_FILE;
  if (!signingKeyFile) throw new Error('MATRA_COUNSELOR_ROSTER_SIGNING_KEY_FILE (the demo organization key) must be given to demo-seed.');

  // The same configuration as index.ts (remote holders, the separate matcher, the mock SMS provider in demo mode).
  const matchingSettings = loadMatchingSettings();
  const phone = loadPhoneVerification();
  const matcher = loadMatcherConfig(process.env, { releaseDelayHours: matchingSettings.releaseDelayHours });
  const app = createApp({
    dbPath,
    pepper: loadPepper(),
    matching: {
      oprf: loadOprfThreshold(),
      limits: loadOprfLimits(),
      ...matchingSettings,
      matcher: { client: matcher.client, pins: matcher.pins },
      requirePhoneVerification: phone.required,
      phone: { verifier: phone.verifier, hashKey: phone.hashKey, maxAccountsPerPhone: phone.maxAccountsPerPhone, exposeDemoCode: phone.exposeDemoCode, allowedCountryCodes: phone.allowedCountryCodes, sendLimits: phone.sendLimits },
    },
  });
  const db = getDb(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const pins = demoPins(process.env);

  const call = async <T>(token: string | null, method: string, url: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...(token && { Authorization: `Bearer ${token}` }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const json = (await res.json().catch(() => ({}))) as T & { code?: string };
    if (!res.ok) throw Object.assign(new Error(`${method} ${url} → ${res.status} ${json.code ?? ''}`), { status: res.status, code: json.code });
    return json;
  };

  const tokens: string[] = [];
  async function register(username: string, role: RegisterRequest['role'], extra: Partial<RegisterRequest> = {}) {
    const passphrase = DEMO_PASSPHRASES[role];
    const kdfSalt = newKdfSalt();
    const { authKey, masterKey } = await deriveKeys(passphrase, kdfSalt, DEFAULT_KDF_ITERATIONS);
    const { publicKey, wrappedPrivateKey } = await generateIdentity(masterKey);
    const { user, token } = await call<AuthResponse>(null, 'POST', '/api/auth/register', {
      username,
      role,
      authKey,
      kdfSalt,
      kdfIterations: DEFAULT_KDF_ITERATIONS,
      publicKey,
      wrappedPrivateKey,
      ...(role === 'survivor' && { ageConfirmed18: true }),
      ...extra,
    } satisfies RegisterRequest);
    console.log(`[demo-seed] create ${role.padEnd(9)} ${username}`);
    tokens.push(token);
    return { user, token, masterKey };
  }
  type Survivor = Awaited<ReturnType<typeof register>>;

  /** Encrypt and upload one evidence file, as the web app's Evidence screen does (each file has its own key). */
  async function uploadEvidence(u: Survivor, f: (typeof RILEY_EVIDENCE)[number]) {
    const bytes = new TextEncoder().encode(f.text);
    const key = await generateContentKey();
    const res = await fetch(`${base}/api/vault/blobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        Authorization: `Bearer ${u.token}`,
        'X-Owner-Wrapped-Key': Buffer.from(JSON.stringify(await wrapKeyWithMaster(key, u.masterKey))).toString('base64'),
      },
      body: Buffer.from(await encryptBlob(bytes, key)),
    });
    if (!res.ok) throw new Error(`POST /api/vault/blobs → ${res.status}`);
    const { blob } = (await res.json()) as { blob: { id: string } };
    const item: EvidenceItem = {
      id: blob.id,
      kind: f.kind,
      fileName: f.fileName,
      mimeType: 'text/plain',
      sizeBytes: bytes.length,
      sha256: await sha256Hex(bytes),
      blobId: blob.id,
      description: f.description,
      metadataStripped: true,
    };
    return { item, key };
  }

  /** Encrypt and upload a sealed ('final') story, as the web app's review screen does. */
  async function sealStory(u: Survivor, s: StorySeed, escrowedHashes: string[] = [], evidence: EvidenceItem[] = []) {
    const key = await generateContentKey();
    const payload = { kind: 'final', record: intakeRecord(s, evidence), escrowedHashes, savedAt: new Date().toISOString() };
    const res = await call<{ record: { id: string; createdAt: string } }>(u.token, 'POST', '/api/vault/records', {
      envelope: await encryptJSON(payload, key),
      ownerWrappedKey: await wrapKeyWithMaster(key, u.masterKey),
    });
    return { id: res.record.id, createdAt: res.record.createdAt, key };
  }

  /** Phone verify-then-forget with the mock provider's on-screen code (W13). */
  async function verifyPhone(u: Survivor, number: string) {
    const start = await call<{ challengeId: string; demoCode?: string }>(u.token, 'POST', '/api/matching/verification/start', { phone: number });
    if (!start.demoCode) throw new Error('the SMS provider did not return a demo code (is MATRA_SMS_PROVIDER=mock and MATRA_DEMO_MODE=1?)');
    await call(u.token, 'POST', '/api/matching/verification/check', { challengeId: start.challengeId, code: start.demoCode });
  }

  const transport = (u: Survivor): MatchTransport => ({
    config: () => call(u.token, 'GET', '/api/matching/config'),
    evaluate: (i, req) => call(u.token, 'POST', `/api/matching/oprf/${i}`, req),
    createEntry: (req) => call(u.token, 'POST', '/api/matching/entries', req),
    attestation: (nonce) => call(null, 'GET', `/api/matching/attestation?nonce=${nonce}`),
    listEntries: () => call(u.token, 'GET', '/api/matching/entries'),
    addSeals: (id, req) => call(u.token, 'POST', `/api/matching/entries/${id}/seals`, req),
  });

  /** Seal her opted-in identifier for matching, with routing states sealed to the matcher (vault.ts lodgeEscrow). */
  async function sealMatch(u: Survivor, s: StorySeed, contact: MatchContactPreferences, states: MatchStates) {
    const raw = s.perpetrator.identifiers[0]!;
    const id = normalizeMatchIdentifier(raw.kind, raw.value, raw.platform);
    if (!id.ok) throw new Error(`not matchable: ${raw.value}`);
    await submitMatchEntry(transport(u), {
      masterKey: u.masterKey,
      identifier: id,
      contact,
      consentStatement:
        'If someone else names the same person, only a Legal Options Counselor sees the match, and may reach out to me once, privately, the way I chose. (Demo seed.)',
      label: `${s.perpetrator.name} · social media handle (${id.platform})`,
      states,
      pins,
    });
    return sha256Hex(`matra/match/v1/local|${id.canonical}`);
  }

  try {
    console.log(`[demo-seed] database: ${dbPath}  (ALL FICTIONAL)`);
    for (const a of ATTORNEYS) {
      const { user } = await register(a.username, 'attorney', { attorneyProfile: a.profile });
      db.prepare('UPDATE attorney_profiles SET verified = 1 WHERE user_id = ?').run(user.id);
    }
    for (const c of COUNSELORS) {
      const { user } = await register(c.username, 'counselor', { counselorProfile: c.profile });
      db.prepare('UPDATE counselor_profiles SET verified = 1 WHERE user_id = ?').run(user.id);
    }

    // The organization signs the roster (sign-roster.ts): who the counselors are, their keys and licensed states.
    const orgKey = Uint8Array.from(fs.readFileSync(signingKeyFile, 'utf8').trim().match(/../g)!.map((b) => parseInt(b, 16)));
    if (process.env.MATRA_COUNSELOR_ROSTER_PUBKEY && toBase64(rosterPublicKey(orgKey)) !== process.env.MATRA_COUNSELOR_ROSTER_PUBKEY)
      throw new Error('the demo organization key does not match MATRA_COUNSELOR_ROSTER_PUBKEY');
    const counselorRows = db
      .prepare('SELECT c.user_id, c.jurisdictions, u.public_key FROM counselor_profiles c JOIN users u ON u.id = c.user_id WHERE c.verified = 1')
      .all() as Array<{ user_id: string; jurisdictions: string; public_key: string }>;
    const roster = signCounselorRoster(
      counselorRows.map((r) => ({ userId: r.user_id, publicKey: JSON.parse(r.public_key) as JsonWebKey, licensedStates: JSON.parse(r.jurisdictions) as string[] })),
      orgKey,
    );
    orgKey.fill(0);
    db.prepare(`INSERT INTO matching_meta (key, value) VALUES ('counselor_roster', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`).run(
      JSON.stringify(roster),
    );
    console.log(`[demo-seed] signed the counselor roster (${counselorRows.length} counselors) with the demo organization key`);

    await register('jane.demo', 'survivor');

    const sam = await register('sam.demo', 'survivor');
    await verifyPhone(sam, '(201) 555-0111');
    const samHash = await sealMatch(sam, SAM, { name: 'Sam', methods: ['text'], phone: SAM.contact!.phone }, { incident: 'NY', survivor: 'NJ' });
    await sealStory(sam, SAM, [samHash]);

    const morgan = await register('morgan.demo', 'survivor');
    await verifyPhone(morgan, '(212) 555-0112');
    const morganHash = await sealMatch(morgan, MORGAN, { name: 'Morgan', methods: ['email'], email: MORGAN.contact!.email }, { incident: 'NY', survivor: 'NY' });
    await sealStory(morgan, MORGAN, [morganHash]);

    const taylor = await register('taylor.demo', 'survivor');
    await sealStory(taylor, TAYLOR); // she said no to sealed matching: nothing is sealed, no phone asked

    const riley = await register('riley.demo', 'survivor');
    const rileyFiles = [];
    for (const f of RILEY_EVIDENCE) rileyFiles.push(await uploadEvidence(riley, f));
    const rileyRecord = await sealStory(riley, RILEY, [], rileyFiles.map((f) => f.item));
    const { attorneys } = await call<{ attorneys: AttorneyProfile[] }>(riley.token, 'GET', '/api/attorneys');
    const alex = attorneys.find((a) => a.displayName === ATTORNEYS[0]!.profile.displayName)!;
    const fp = await publicKeyFingerprint(alex.publicKey);
    await call(riley.token, 'POST', '/api/shares', {
      recordId: rileyRecord.id,
      attorneyId: alex.userId,
      recipientWrappedKey: await wrapKeyForRecipient(rileyRecord.key, alex.publicKey),
      attorneyKeyFingerprint: fp,
      blobs: await Promise.all(rileyFiles.map(async (f) => ({ blobId: f.item.blobId!, recipientWrappedKey: await wrapKeyForRecipient(f.key, alex.publicKey) }))),
      consentStatement: [
        `I, "riley.demo", choose to share my sealed Matra file (sealed ${rileyRecord.createdAt}) with ${alex.displayName} of ${alex.organization}, a verified attorney, so that they can advise me.`,
        'I am sharing: my written account; my evidence files; the incident summary in my own words, prepared from my account.',
        `It will be encrypted on my device so that only the holder of the key with fingerprint ${fp} can open it.`,
        'Access ends after 90 days unless I renew it. (Demo seed.)',
        `Agreed at ${new Date().toISOString()}.`,
      ].join('\n'),
      scope: ['record', 'evidence', 'brief'],
      survivorAlias: 'riley.demo',
      expiresInDays: 90,
    });
    console.log(`[demo-seed] riley.demo shared her sealed story and ${rileyFiles.length} evidence files with attorney.nj1`);

    // Forward everything to the matcher now (normally right after each response), and write the buffered phone-token
    // counts (normally 10–60 minutes later, so their time does not point to an account: W19).
    await (app.locals.syncMatcher as () => Promise<void>)();
    flushPhoneTokens(app);
    const unsynced = (db.prepare('SELECT COUNT(*) AS n FROM match_entries WHERE matcher_synced = 0').get() as { n: number }).n;
    if (unsynced) throw new Error(`${unsynced} sealed entries did not reach the matcher (is it running, and does its attestation verify?)`);

    for (const t of tokens) await call(t, 'POST', '/api/auth/logout'); // no seed session left behind
    console.log('\n[demo-seed] Matra demo accounts (ALL FICTIONAL — for demonstration only):');
    for (const a of ATTORNEYS) console.log(`  attorney  ${a.username.padEnd(13)} ${DEMO_PASSPHRASES.attorney}  [${a.profile.jurisdictions.join(', ')}]`);
    for (const c of COUNSELORS) console.log(`  counselor ${c.username.padEnd(13)} ${DEMO_PASSPHRASES.counselor}  [licensed: ${c.profile.jurisdictions.join(', ')}]`);
    for (const s of ['jane.demo', 'sam.demo', 'morgan.demo', 'taylor.demo', 'riley.demo']) console.log(`  survivor  ${s.padEnd(13)} ${DEMO_PASSPHRASES.survivor}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  }
}

main().then(
  () => process.exit(0), // the matcher sync interval and phone-token timers would otherwise keep the process up
  (err) => {
    console.error('[demo-seed] failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
