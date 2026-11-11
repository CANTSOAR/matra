import fs from 'node:fs';
import path from 'node:path';
import { hkdfSync, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  MAX_OPRF_HOLDERS,
  fromBase64,
  generateOprfKey,
  groupKeyFromShares,
  oprfPublicKey,
  splitOprfKey,
  toBase64,
  toHex,
  type ShareKey,
} from '@matra/crypto';
import { holderTokenPublicKeyFromSeed, type RemoteHolderConfig } from './holders.js';
import { DEFAULT_HOLDER_DAILY_BUDGET } from './holder.js';
import { MockSmsVerifier, PHONE_SEND_LIMITS, TwilioVerifySmsVerifier, type PhoneSendLimits, type SmsVerifier } from './sms.js';

/** apps/server/data */
export const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

/** apps/web/dist — the production build of the web app (`npm run build`). */
export const WEB_DIST_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');

export function resolveDbPath(): string {
  return process.env.MATRA_DB_PATH || path.join(DATA_DIR, 'matra.db');
}

/**
 * Server pepper (HMAC key for fake prelogin salts of unknown usernames).
 * Production: set MATRA_PEPPER (≥ 32 chars, e.g. `openssl rand -hex 32`).
 * Dev: generated once and persisted to apps/server/data/pepper.key (mode 0600).
 */
export function loadPepper(): Buffer {
  const env = process.env.MATRA_PEPPER;
  if (env) {
    if (env.length < 32) throw new Error('MATRA_PEPPER must be at least 32 characters');
    return Buffer.from(env, 'utf8');
  }
  if (process.env.NODE_ENV === 'production') throw new Error('MATRA_PEPPER must be set in production');
  const file = path.join(DATA_DIR, 'pepper.key');
  if (fs.existsSync(file)) return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const pepper = randomBytes(32);
  fs.writeFileSync(file, pepper.toString('hex'), { mode: 0o600 });
  console.warn(`[matra] WARNING: MATRA_PEPPER not set — generated a dev pepper at ${file}. Set MATRA_PEPPER in production.`);
  return pepper;
}

export type Env = Record<string, string | undefined>;

const isInside = (dir: string, file: string) => {
  const rel = path.relative(dir, file);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};
const real = (p: string) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

const isProduction = (env: Env) => env.NODE_ENV === 'production';
const defaultDbPath = (env: Env) => path.resolve(env.MATRA_DB_PATH || path.join(DATA_DIR, 'matra.db'));
const hexToBytes = (h: string) => Uint8Array.from(h.toLowerCase().match(/../g)!.map((b) => parseInt(b, 16)));

/** Default secret parser: 64 hex chars, or any ≥ 32-char secret (e.g. a platform-generated value) HKDF-derived. */
function parseSecret(bytes: number, label: string) {
  return (raw: string): Uint8Array => {
    const v = raw.trim();
    if (new RegExp(`^[0-9a-fA-F]{${bytes * 2}}$`).test(v)) return hexToBytes(v);
    if (v.length >= 32) return new Uint8Array(hkdfSync('sha256', v, new Uint8Array(0), `matra/secret/${label}`, bytes));
    throw new Error(`${label} must be ${bytes * 2} hex characters or a secret of at least 32 characters`);
  };
}

/**
 * One server secret held OUTSIDE the database (docs/design/WEEKEND_MVP.md §1.3): `NAME` (the value) or `NAME_FILE` (a
 * path that must be outside the database directory, and in production outside apps/server/data too — a copy of the DB
 * volume must never also be a copy of its keys). Missing in production (or with `required`) is FATAL: never
 * auto-generated. In development it is generated once into `devFile` (mode 0600) with a warning, or read from there.
 * Returns the file's real path too, so callers can refuse two secrets that point at the same file.
 */
export function loadSecretBytes(
  name: string,
  opts: {
    env?: Env;
    bytes?: number;
    devFile: string;
    parse?: (raw: string) => Uint8Array;
    label: string;
    /** the database this secret must stay away from (default MATRA_DB_PATH) */
    dbPath?: string;
    required?: boolean;
    /** development only: how to make a fresh value (default: random bytes, hex-encoded on disk) */
    generate?: () => Uint8Array;
  },
): Uint8Array {
  return loadSecretWithSource(name, opts).value;
}

function loadSecretWithSource(
  name: string,
  opts: Parameters<typeof loadSecretBytes>[1],
): { value: Uint8Array; file?: string } {
  const env = opts.env ?? process.env;
  const bytes = opts.bytes ?? 32;
  const parse = opts.parse ?? parseSecret(bytes, name);
  const production = isProduction(env);
  const value = env[name];
  if (value) return { value: parse(value) };
  const file = env[`${name}_FILE`];
  if (file) {
    const keyPath = real(file);
    const dbDir = real(path.dirname(path.resolve(opts.dbPath ?? defaultDbPath(env))));
    if (isInside(dbDir, keyPath) || (production && isInside(real(DATA_DIR), keyPath)))
      throw new Error(`${name}_FILE must be outside the database directory (${dbDir}): a copy of the DB volume must never include ${opts.label}`);
    return { value: parse(fs.readFileSync(keyPath, 'utf8')), file: keyPath };
  }
  if (production || opts.required)
    throw new Error(
      `${name} (or ${name}_FILE, outside the database directory) must be set${production ? ' in production' : ''}. ` +
        `${opts.label} is never generated automatically in production (see docs/DEPLOY.md).`,
    );
  if (fs.existsSync(opts.devFile)) return { value: parse(fs.readFileSync(opts.devFile, 'utf8')), file: real(opts.devFile) };
  fs.mkdirSync(path.dirname(opts.devFile), { recursive: true });
  const fresh = opts.generate ? opts.generate() : randomBytes(bytes);
  fs.writeFileSync(opts.devFile, toHex(fresh), { mode: 0o600 });
  console.warn(`[matra] WARNING: ${name} not set — generated a DEV ${opts.label} at ${opts.devFile}. Production refuses to start without it.`);
  return { value: parse(toHex(fresh)), file: real(opts.devFile) };
}

/** A Shamir share of the OPRF key: exactly 64 hex chars, a canonical non-zero little-endian ristretto255 scalar. */
export function parseOprfShare(raw: string, label = 'OPRF share'): ShareKey['secretKey'] {
  const v = raw.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(v)) throw new Error(`${label} must be 64 hex characters (a ristretto255 scalar from oprf-ceremony)`);
  const sk = hexToBytes(v);
  oprfPublicKey(sk); // throws if not a canonical non-zero scalar
  return sk;
}

const LEGACY_OPRF_VARS = ['MATRA_OPRF_KEY_A', 'MATRA_OPRF_KEY_B', 'MATRA_OPRF_KEY_A_FILE', 'MATRA_OPRF_KEY_B_FILE'];

export interface OprfThresholdSettings {
  t: number;
  m: number;
  mode: 'in-process' | 'remote';
  /** in-process: all m shares (index 1..m) */
  shares?: ShareKey[];
  /** remote: holder URLs, pinned share public keys, and the holder-token signing key */
  remote?: RemoteHolderConfig;
}

/**
 * Dealer key ceremony (src/oprf-ceremony.ts, and the development auto-setup): fresh key k, split t-of-m, one hex file
 * per share in `dir` (mode 0600). Returns the public part for pinning. k exists only inside this call.
 */
export function writeOprfCeremony(dir: string, t: number, m: number): { t: number; m: number; groupPublicKey: string; holders: Array<{ index: number; publicKey: string }> } {
  const k = generateOprfKey();
  const shares = splitOprfKey(k.secretKey, t, m);
  const groupPublicKey = toBase64(k.publicKey);
  k.secretKey.fill(0);
  fs.mkdirSync(dir, { recursive: true });
  for (const s of shares) {
    const f = path.join(dir, `oprf-share-${s.index}.key`);
    fs.writeFileSync(f, toHex(s.secretKey), { mode: 0o600 });
    fs.chmodSync(f, 0o600);
  }
  const holders = shares.map((s) => ({ index: s.index, publicKey: toBase64(s.publicKey) }));
  for (const s of shares) s.secretKey.fill(0);
  return { t, m, groupPublicKey, holders };
}

/**
 * Threshold OPRF key holders for sealed matching (W2, W14; src/oprf.ts, src/holders.ts).
 *
 *   MATRA_OPRF_THRESHOLD (t, default 2), MATRA_OPRF_HOLDERS (m, default 3); 2 ≤ t ≤ m ≤ 16.
 *   In-process (every share in this process — dev, tests, single-host demo; NO separation against the operator):
 *     MATRA_OPRF_SHARE_<i> or MATRA_OPRF_SHARE_<i>_FILE for every i in 1..m (64-hex scalars from `oprf-ceremony`).
 *     Files must be different files, outside the database directory.
 *   Remote (each holder its own process / institution, src/holder-server.ts):
 *     MATRA_OPRF_HOLDER_URLS = m comma-separated base URLs, MATRA_OPRF_SHARE_PUBKEYS = m comma-separated base64 share
 *     public keys (pinned; index order), MATRA_HOLDER_TOKEN_KEY / _FILE = the Ed25519 seed that signs holder tokens.
 *
 * Production: every share (or the remote config) must be given; nothing is ever generated. Development with nothing
 * set: a dealer ceremony runs once into apps/server/data/oprf-share-<i>.key, with a warning.
 * The additive keys MATRA_OPRF_KEY_A / _B were replaced: setting them is a fatal error that points to the ceremony.
 */
export function loadOprfThreshold(env: Env = process.env): OprfThresholdSettings {
  const legacy = LEGACY_OPRF_VARS.filter((v) => env[v]);
  if (legacy.length)
    throw new Error(
      `${legacy.join(', ')} ${legacy.length > 1 ? 'are' : 'is'} no longer used: the additive 2-of-2 OPRF keys were replaced by ` +
        't-of-m threshold shares. Run `npm run -w @matra/server oprf-ceremony` and set MATRA_OPRF_SHARE_<i> (see docs/DEPLOY.md).',
    );
  const int = (v: string | undefined, d: number, name: string) => {
    if (v === undefined || v === '') return d;
    const n = Number(v);
    if (!Number.isInteger(n)) throw new Error(`${name} must be an integer`);
    return n;
  };
  const t = int(env.MATRA_OPRF_THRESHOLD, 2, 'MATRA_OPRF_THRESHOLD');
  const m = int(env.MATRA_OPRF_HOLDERS, 3, 'MATRA_OPRF_HOLDERS');
  if (t < 2 || m < t || m > MAX_OPRF_HOLDERS) throw new Error(`OPRF threshold must satisfy 2 ≤ t ≤ m ≤ ${MAX_OPRF_HOLDERS} (MATRA_OPRF_THRESHOLD=${t}, MATRA_OPRF_HOLDERS=${m})`);
  const production = isProduction(env);
  const required = production || env.MATRA_REQUIRE_OPRF_KEYS === '1';
  const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  if (env.MATRA_OPRF_HOLDER_URLS) {
    const urls = list(env.MATRA_OPRF_HOLDER_URLS);
    const publicKeys = list(env.MATRA_OPRF_SHARE_PUBKEYS);
    if (urls.length !== m) throw new Error(`MATRA_OPRF_HOLDER_URLS must list ${m} holder URLs (MATRA_OPRF_HOLDERS), got ${urls.length}`);
    if (publicKeys.length !== m) throw new Error(`MATRA_OPRF_SHARE_PUBKEYS must list ${m} base64 share public keys, in index order`);
    for (const u of urls) if (!/^https?:\/\//.test(u)) throw new Error(`MATRA_OPRF_HOLDER_URLS: not an http(s) URL: ${u}`);
    // Holder tokens are bearer credentials (bound to one blinded element, 60 s): on plain http an on-path attacker could
    // capture one and spend a survivor's quota. Production only allows http:// to a loopback address.
    if (production && urls.some((u) => u.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(u)))
      throw new Error('MATRA_OPRF_HOLDER_URLS: plain http:// to a non-loopback host is refused in production. Use https between institutions.');
    groupKeyFromShares(publicKeys.map((pk, i) => ({ index: i + 1, publicKey: fromBase64(pk) })), t); // throws if inconsistent
    const tokenKey = loadSecretBytes('MATRA_HOLDER_TOKEN_KEY', { env, devFile: path.join(DATA_DIR, 'holder-token.key'), label: 'the holder-token signing key', required });
    return { t, m, mode: 'remote', remote: { urls, publicKeys, tokenKey } };
  }

  const anySet = Array.from({ length: m }, (_, i) => i + 1).some((i) => env[`MATRA_OPRF_SHARE_${i}`] || env[`MATRA_OPRF_SHARE_${i}_FILE`]);
  const devFile = (i: number) => path.join(DATA_DIR, `oprf-share-${i}.key`);
  const load = (): ShareKey[] => {
    const files = new Map<string, number>();
    return Array.from({ length: m }, (_, k) => {
      const i = k + 1;
      const { value, file } = loadSecretWithSource(`MATRA_OPRF_SHARE_${i}`, {
        env,
        devFile: devFile(i),
        label: `OPRF key share ${i}`,
        parse: (raw) => parseOprfShare(raw, `MATRA_OPRF_SHARE_${i}`),
        required: required || anySet,
        generate: () => {
          throw new Error(`OPRF key share ${i} is missing`);
        },
      });
      if (file) {
        if (files.has(file)) throw new Error(`MATRA_OPRF_SHARE_${files.get(file)}_FILE and MATRA_OPRF_SHARE_${i}_FILE must be different files`);
        files.set(file, i);
      }
      return { index: i, secretKey: value, publicKey: oprfPublicKey(value) };
    });
  };
  const consistent = (shares: ShareKey[]) => {
    groupKeyFromShares(shares, t);
    return shares;
  };
  if (anySet || required) {
    try {
      return { t, m, mode: 'in-process', shares: consistent(load()) };
    } catch (e) {
      if (/inconsistent|same public key/.test((e as Error).message))
        throw new Error(`MATRA_OPRF_SHARE_1..${m} are not shares of one key for t=${t} (were they dealt by the same oprf-ceremony?): ${(e as Error).message}`);
      throw e;
    }
  }
  // Development, nothing configured: reuse the dev ceremony if it is complete and fits t, else deal a fresh one.
  if (Array.from({ length: m }, (_, i) => devFile(i + 1)).every((f) => fs.existsSync(f))) {
    try {
      return { t, m, mode: 'in-process', shares: consistent(load()) };
    } catch {
      /* incomplete or from another t/m: deal again below */
    }
  }
  writeOprfCeremony(DATA_DIR, t, m);
  console.warn(
    `[matra] WARNING: MATRA_OPRF_SHARE_1..${m} not set — dealt DEV ${t}-of-${m} OPRF key shares into ${DATA_DIR}. Production refuses to start without them.`,
  );
  return { t, m, mode: 'in-process', shares: consistent(load()) };
}

function holderDailyBudget(env: Env): number {
  const v = env.MATRA_HOLDER_DAILY_BUDGET;
  if (v === undefined || v === '') return DEFAULT_HOLDER_DAILY_BUDGET;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error('MATRA_HOLDER_DAILY_BUDGET must be a positive integer');
  return n;
}

/**
 * Settings for one standalone OPRF key holder process (src/holder-server.ts):
 *   MATRA_HOLDER_INDEX (i), MATRA_OPRF_SHARE / MATRA_OPRF_SHARE_FILE (its one share; dev: apps/server/data/oprf-share-<i>.key),
 *   MATRA_HOLDER_TOKEN_PUBKEY (base64 Ed25519 key of the app server's token key; dev: derived from the dev token key),
 *   MATRA_HOLDER_DB_PATH (its own quota DB; default apps/server/data/holder-<i>.db), PORT, MATRA_OPRF_PER_DAY / _LIFETIME,
 *   MATRA_HOLDER_DAILY_BUDGET (global evaluations per UTC day across all subjects; default 1000, src/holder.ts).
 */
export function loadHolderSettings(env: Env = process.env) {
  const index = Number(env.MATRA_HOLDER_INDEX);
  if (!Number.isInteger(index) || index < 1 || index > MAX_OPRF_HOLDERS) throw new Error(`MATRA_HOLDER_INDEX must be an integer in 1..${MAX_OPRF_HOLDERS}`);
  const dbPath = env.MATRA_HOLDER_DB_PATH || path.join(DATA_DIR, `holder-${index}.db`);
  const secretKey = loadSecretBytes('MATRA_OPRF_SHARE', {
    env,
    devFile: path.join(DATA_DIR, `oprf-share-${index}.key`),
    label: `OPRF key share ${index}`,
    parse: (raw) => parseOprfShare(raw, 'MATRA_OPRF_SHARE'),
    dbPath,
    generate: () => {
      throw new Error(`MATRA_OPRF_SHARE is not set and there is no dev share ${index} (start the app server once, or run oprf-ceremony)`);
    },
  });
  let tokenPublicKey: Uint8Array;
  if (env.MATRA_HOLDER_TOKEN_PUBKEY) tokenPublicKey = fromBase64(env.MATRA_HOLDER_TOKEN_PUBKEY.trim());
  else if (isProduction(env)) throw new Error('MATRA_HOLDER_TOKEN_PUBKEY must be set in production (base64 public key of the app server’s holder-token key)');
  else
    tokenPublicKey = holderTokenPublicKeyFromSeed(
      loadSecretBytes('MATRA_HOLDER_TOKEN_KEY', { env, devFile: path.join(DATA_DIR, 'holder-token.key'), label: 'the holder-token signing key' }),
    );
  if (tokenPublicKey.length !== 32) throw new Error('MATRA_HOLDER_TOKEN_PUBKEY must be a base64 32-byte Ed25519 public key');
  return {
    index,
    share: { secretKey, publicKey: oprfPublicKey(secretKey) },
    tokenPublicKey,
    dbPath,
    port: Number(env.PORT) || 4310 + index,
    limits: loadOprfLimits(env),
    dailyBudget: holderDailyBudget(env),
  };
}

/**
 * Sealed-matching release / rotation settings.
 *   MATRA_MATCH_RELEASE_DELAY_HOURS (default 72): a group is released to counselors only once the entries that make
 *     it a match are at least this old (Sybil + counselor guessing mitigation, review M2). 0 disables (tests, e2e).
 *   MATRA_OPRF_ROTATE=1: accept OPRF key holder keys that differ from the ones recorded in the DB (a deliberate
 *     rotation): the key epoch is incremented, and survivors' clients re-seal their entries on next sign-in. Outside
 *     production a key change is always treated as a rotation (with a warning), so a dev DB survives new dev keys.
 */
export function loadMatchingSettings(env: Env = process.env): { releaseDelayHours: number; allowKeyRotation: boolean } {
  const raw = env.MATRA_MATCH_RELEASE_DELAY_HOURS;
  const n = raw === undefined || raw === '' ? 72 : Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error('MATRA_MATCH_RELEASE_DELAY_HOURS must be a number ≥ 0');
  return { releaseDelayHours: n, allowKeyRotation: env.MATRA_OPRF_ROTATE === '1' || !isProduction(env) };
}

/** Sealed-matching OPRF rate limits per survivor account and key holder (MATRA_OPRF_PER_DAY, MATRA_OPRF_LIFETIME). */
export function loadOprfLimits(env: Env = process.env): { perDay: number; lifetime: number } {
  const n = (v: string | undefined, d: number) => (v && Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return { perDay: n(env.MATRA_OPRF_PER_DAY, 10), lifetime: n(env.MATRA_OPRF_LIFETIME, 50) };
}

// ───────────── demo mode and mock providers (docs/design/WEEKEND_MVP.md §1.2) ─────────────

/** MATRA_DEMO_MODE=1: a fictional-data demo. Allows mock/simulated providers in production and forces the DEMO banner. */
export function loadDemoMode(env: Env = process.env): boolean {
  return env.MATRA_DEMO_MODE === '1';
}

/**
 * Throws in production unless demo mode is on: a mock or simulated provider must never quietly stand in for a real one
 * where real people's data is. Logs one warning in development.
 */
export function assertMockAllowed(what: string, env: Env = process.env): void {
  if (isProduction(env) && !loadDemoMode(env))
    throw new Error(
      `${what} is a mock/simulated provider and cannot run in production. Configure a real provider, or set MATRA_DEMO_MODE=1 for a fictional-data demo.`,
    );
  if (!isProduction(env)) console.warn(`[matra] WARNING: ${what} is a mock/simulated provider (development only).`);
}

/**
 * SMS phone verification provider for sealed matching (src/sms.ts):
 *   MATRA_SMS_PROVIDER=mock (default outside production) | twilio (default in production).
 *   twilio: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID; MATRA_SMS_REJECT_VOIP=0 turns the VoIP
 *   check off (default on). mock: refused in production unless MATRA_DEMO_MODE=1; prints codes to the console (the dev
 *   outbox) only outside production.
 */
export function loadSmsVerifier(env: Env = process.env): SmsVerifier {
  const provider = env.MATRA_SMS_PROVIDER || (isProduction(env) ? 'twilio' : 'mock');
  if (provider === 'mock') {
    assertMockAllowed('SMS verification (mock)', env);
    return new MockSmsVerifier({ log: !isProduction(env) });
  }
  if (provider === 'twilio') {
    const missing = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VERIFY_SERVICE_SID'].filter((v) => !env[v]);
    if (missing.length) throw new Error(`MATRA_SMS_PROVIDER=twilio needs ${missing.join(', ')} (see docs/DEPLOY.md)`);
    return new TwilioVerifySmsVerifier({
      accountSid: env.TWILIO_ACCOUNT_SID!,
      authToken: env.TWILIO_AUTH_TOKEN!,
      verifyServiceSid: env.TWILIO_VERIFY_SERVICE_SID!,
      rejectVoip: env.MATRA_SMS_REJECT_VOIP !== '0',
    });
  }
  throw new Error(`MATRA_SMS_PROVIDER must be "mock" or "twilio", got "${provider}"`);
}

export interface PhoneVerificationSettings {
  required: boolean;
  verifier: SmsVerifier;
  hashKey: Uint8Array;
  maxAccountsPerPhone: number;
  /** return the mock's code to the browser (development, or MATRA_DEMO_MODE=1) */
  exposeDemoCode: boolean;
  /** E.164 country calling codes codes may be sent to */
  allowedCountryCodes: string[];
  sendLimits: PhoneSendLimits;
}

/**
 * Phone verify-then-forget before sealed matching (W13, W19):
 *   MATRA_REQUIRE_PHONE_VERIFICATION=0 turns the gate off (development only; refused in production).
 *   MATRA_PHONE_HASH_KEY / _FILE: the HMAC key for phone tokens, outside the database directory (production: required).
 *   MATRA_SMS_MAX_ACCOUNTS_PER_PHONE (default 2): how many accounts one phone can enable.
 *   MATRA_SMS_ALLOWED_COUNTRY_CODES (default "1", NANP): comma-separated E.164 country calling codes codes may be sent to.
 *   MATRA_SMS_MAX_PER_IP_PER_HOUR (10), MATRA_SMS_MAX_PER_HOUR (200), MATRA_SMS_MAX_PER_DAY (1000): send caps against
 *   SMS pumping (sms.ts PHONE_SEND_LIMITS); the global caps answer 503 sms_unavailable.
 */
export function loadPhoneVerification(env: Env = process.env): PhoneVerificationSettings {
  const production = isProduction(env);
  const required = env.MATRA_REQUIRE_PHONE_VERIFICATION !== '0';
  if (!required && production) throw new Error('MATRA_REQUIRE_PHONE_VERIFICATION=0 is refused in production: sealed matching needs its Sybil friction (W13).');
  if (!required) console.warn('[matra] WARNING: MATRA_REQUIRE_PHONE_VERIFICATION=0 — sealed matching without phone verification (development only).');
  const raw = env.MATRA_SMS_MAX_ACCOUNTS_PER_PHONE;
  const max = raw === undefined || raw === '' ? 2 : Number(raw);
  if (!Number.isInteger(max) || max < 1) throw new Error('MATRA_SMS_MAX_ACCOUNTS_PER_PHONE must be a positive integer');
  const posInt = (name: string, dflt: number) => {
    const v = env[name];
    if (v === undefined || v === '') return dflt;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer`);
    return n;
  };
  const sendLimits: PhoneSendLimits = {
    ...PHONE_SEND_LIMITS,
    perIpPerHour: posInt('MATRA_SMS_MAX_PER_IP_PER_HOUR', PHONE_SEND_LIMITS.perIpPerHour),
    globalPerHour: posInt('MATRA_SMS_MAX_PER_HOUR', PHONE_SEND_LIMITS.globalPerHour),
    globalPerDay: posInt('MATRA_SMS_MAX_PER_DAY', PHONE_SEND_LIMITS.globalPerDay),
  };
  const allowedCountryCodes = (env.MATRA_SMS_ALLOWED_COUNTRY_CODES || '1').split(',').map((c) => c.trim().replace(/^\+/, ''));
  if (allowedCountryCodes.some((c) => !/^[1-9]\d{0,2}$/.test(c)))
    throw new Error('MATRA_SMS_ALLOWED_COUNTRY_CODES must be comma-separated E.164 country calling codes, e.g. "1" or "1,44"');
  const verifier = loadSmsVerifier(env);
  const hashKey = loadSecretBytes('MATRA_PHONE_HASH_KEY', { env, devFile: path.join(DATA_DIR, 'phone-hash.key'), label: 'the phone-token HMAC key' });
  return {
    required,
    verifier,
    hashKey,
    maxAccountsPerPhone: max,
    exposeDemoCode: verifier.name === 'mock' && (!production || loadDemoMode(env)),
    allowedCountryCodes,
    sendLimits,
  };
}
