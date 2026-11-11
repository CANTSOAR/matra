/**
 * Shared by scripts/demo-reset.mjs and scripts/demo.mjs: where the demo stack keeps its files, its ports, the
 * environment of each process, and starting / stopping processes. See docs/DEMO_SCRIPT.md.
 *
 *   MATRA_DEMO_DIR           default .demo (must be a directory named ".demo"; e2e uses e2e/.demo)
 *   MATRA_DEMO_API_PORT      app server, default 4000
 *   MATRA_DEMO_WEB_PORT      web app (Vite), default 5173
 *   MATRA_DEMO_HOLDER_PORT   key holder i listens on this + i (default 4010: 4011, 4012, 4013)
 *   MATRA_DEMO_MATCHER_PORT  matcher, default 4020
 *
 * Layout: <dir>/db (app, holder and matcher databases), <dir>/keys (every secret, outside the database directory, mode
 * 0600, plus public.json with the pins). Everything in it is throwaway demo material for FICTIONAL data.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIR = path.resolve(ROOT, process.env.MATRA_DEMO_DIR || '.demo');
export const DB_DIR = path.join(DIR, 'db');
export const KEYS = path.join(DIR, 'keys');
export const PUBLIC = path.join(KEYS, 'public.json');
export const PORTS = {
  api: Number(process.env.MATRA_DEMO_API_PORT) || 4000,
  web: Number(process.env.MATRA_DEMO_WEB_PORT) || 5173,
  holder: Number(process.env.MATRA_DEMO_HOLDER_PORT) || 4010,
  matcher: Number(process.env.MATRA_DEMO_MATCHER_PORT) || 4020,
};
export const HOLDERS = [1, 2, 3];
export const THRESHOLD = 2;

const bin = (name) => path.join(ROOT, 'node_modules', '.bin', name);
export const TSX = bin('tsx');
export const VITE = bin('vite');

/** Refuse anything that is not a throwaway demo directory, or a production shell. */
export function assertSafe() {
  if (process.env.NODE_ENV === 'production') throw new Error('The demo scripts refuse to run with NODE_ENV=production.');
  if (path.basename(DIR) !== '.demo') throw new Error(`MATRA_DEMO_DIR must be a directory named ".demo" (got ${DIR}).`);
}

const key = (f) => path.join(KEYS, f);
const read = (f) => fs.readFileSync(key(f), 'utf8').trim();

/** The pins written by demo:reset. */
export function loadPublic() {
  return JSON.parse(fs.readFileSync(PUBLIC, 'utf8'));
}

// Every service runs as PRODUCTION with MATRA_DEMO_MODE=1, the one switch that lets production use the mock SMS provider
// and the simulated attestation (docs/design/WEEKEND_MVP.md §1.2), and MATRA_INSPECTOR=1 for the "Server view" page.
// Loopback only (HOST=127.0.0.1).
const base = () => ({ ...process.env, NODE_ENV: 'production', MATRA_DEMO_MODE: '1', MATRA_INSPECTOR: '1', HOST: '127.0.0.1', MATRA_MATCH_RELEASE_DELAY_HOURS: '0' });

export function holderEnv(pub, i) {
  return {
    ...base(),
    MATRA_HOLDER_INDEX: String(i),
    MATRA_OPRF_SHARE_FILE: key(`oprf-share-${i}.key`),
    MATRA_HOLDER_TOKEN_PUBKEY: pub.holderTokenPublicKey,
    MATRA_HOLDER_DB_PATH: path.join(DB_DIR, `holder-${i}.db`),
    PORT: String(PORTS.holder + i),
  };
}

export function matcherEnv(pub) {
  return {
    ...base(),
    MATRA_MATCHER_KEY_FILE: key('matcher.key'),
    MATRA_MATCHER_TOKEN_FILE: key('matcher-token.key'),
    MATRA_ATTESTATION_PLATFORM_KEY_FILE: key('attestation-platform.key'),
    MATRA_MATCHER_DB_PATH: path.join(DB_DIR, 'matcher.db'),
    MATRA_COUNSELOR_ROSTER_PUBKEY: pub.rosterPublicKey,
    PORT: String(PORTS.matcher),
  };
}

/** The pins a survivor's client is built with (and the seed checks with). */
export function pinEnv(pub) {
  return {
    MATRA_OPRF_THRESHOLD: String(pub.t),
    MATRA_OPRF_GROUP_PUBKEY: pub.groupPublicKey,
    MATRA_OPRF_SHARE_PUBKEYS: pub.holders.map((h) => h.publicKey).join(','),
    MATRA_COUNSELOR_ROSTER_PUBKEY: pub.rosterPublicKey,
    MATRA_ATTESTATION_PLATFORM_PUBKEY: pub.platformPublicKey,
    MATRA_MATCHER_MEASUREMENT: pub.measurement,
  };
}

export function appEnv(pub) {
  return {
    ...base(),
    ...pinEnv(pub),
    MATRA_DB_PATH: path.join(DB_DIR, 'matra.db'),
    MATRA_PEPPER: read('pepper.key'),
    MATRA_OPRF_THRESHOLD: String(pub.t),
    MATRA_OPRF_HOLDERS: String(pub.m),
    MATRA_OPRF_HOLDER_URLS: HOLDERS.map((i) => `http://127.0.0.1:${PORTS.holder + i}`).join(','),
    MATRA_HOLDER_TOKEN_KEY_FILE: key('holder-token.key'),
    MATRA_MATCHER_URL: `http://127.0.0.1:${PORTS.matcher}`,
    MATRA_MATCHER_TOKEN_FILE: key('matcher-token.key'),
    MATRA_SMS_PROVIDER: 'mock',
    MATRA_PHONE_HASH_KEY_FILE: key('phone-hash.key'),
    MATRA_SERVE_WEB: '0', // the web app is served by Vite (scripts/demo.mjs), which proxies /api here
    MATRA_DEMO_BANNER: '1',
    PORT: String(PORTS.api),
  };
}

export function webEnv(pub) {
  const { NODE_ENV: _drop, ...env } = process.env;
  return {
    ...env,
    ...pinEnv(pub),
    MATRA_DEMO_MODE: '1', // a demo build: accepts the SIMULATED attestation (and still checks the pinned measurement)
    VITE_MATRA_DEMO_BANNER: '1',
    MATRA_WEB_PORT: String(PORTS.web),
    MATRA_API_URL: `http://127.0.0.1:${PORTS.api}`,
    MATRA_WEB_NO_HMR: '1',
  };
}

const children = new Set();
let stopping = false;

/** Start a process; its output is prefixed with `name`. */
export function start(name, cmd, args, env, cwd = ROOT) {
  const child = spawn(cmd, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) if (l.trim()) out.write(`${name.padEnd(10)} ${l}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code, sig) => {
    children.delete(child);
    if (!stopping) console.error(`${name.padEnd(10)} exited (${sig ?? code})`);
  });
  return child;
}

/** Stop every process started here. */
export async function stopAll() {
  stopping = true;
  const waits = [...children].map((c) => new Promise((r) => (c.exitCode !== null ? r() : (c.once('exit', r), c.kill('SIGTERM')))));
  await Promise.race([Promise.all(waits), new Promise((r) => setTimeout(r, 4000))]);
  for (const c of children) c.kill('SIGKILL');
  stopping = false;
}

export async function waitFor(url, what, ms = 90_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${what} did not come up at ${url}`);
}

/** Run a command to completion; returns stdout. */
export function run(cmd, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`${path.basename(cmd)} ${args.join(' ')} exited ${code}`))));
  });
}

/**
 * Generate every demo secret into `dir` (shared by demo:reset and stack:init) and return the public pins: a 2-of-3 OPRF
 * dealer ceremony (one share file per key holder) and the holder-token key; the server pepper; the phone-token HMAC key;
 * the matcher key and its app-server token; the SIMULATED attestation "platform" key; the demo organization's
 * counselor-roster signing key; and the measurement of the matcher code as it is now.
 */
export async function generateKeys(dir, env) {
  const ceremony = JSON.parse(
    await run(TSX, ['apps/server/src/oprf-ceremony.ts', '--threshold', String(THRESHOLD), '--holders', String(HOLDERS.length), '--out', dir, '--force', '--token-key'], env),
  );
  const secret = (f) => fs.writeFileSync(path.join(dir, f), randomBytes(32).toString('hex'), { mode: 0o600 });
  for (const f of ['pepper.key', 'phone-hash.key', 'matcher.key', 'matcher-token.key', 'attestation-platform.key']) secret(f);
  // The demo organization's roster key (sign-roster --generate): the secret is given only to the seed, which signs the roster.
  const roster = await run(TSX, ['apps/server/src/sign-roster.ts', '--generate'], env);
  const rosterSecret = /secret[^:]*:\s*([0-9a-f]{64})/.exec(roster)?.[1];
  const rosterPublicKey = /public[^:]*:\s*(\S+)/.exec(roster)?.[1];
  if (!rosterSecret || !rosterPublicKey) throw new Error('could not read the generated roster key');
  fs.writeFileSync(path.join(dir, 'roster-signing.key'), rosterSecret, { mode: 0o600 });
  const platformPublicKey = (
    await run(TSX, ['apps/matcher/src/measure-cli.ts', '--platform-pubkey'], { ...env, MATRA_ATTESTATION_PLATFORM_KEY_FILE: path.join(dir, 'attestation-platform.key') })
  ).trim();
  const measurement = (await run(TSX, ['apps/matcher/src/measure-cli.ts'], env)).trim();
  return { ...ceremony, rosterPublicKey, platformPublicKey, measurement, createdAt: new Date().toISOString() };
}

/** Start the three key holders and the matcher, and wait until they answer. */
export async function startBackends(pub) {
  for (const i of HOLDERS) start(`holder ${i}`, TSX, ['apps/server/src/holder-server.ts'], holderEnv(pub, i));
  start('matcher', TSX, ['apps/matcher/src/server.ts'], matcherEnv(pub));
  await Promise.all([
    ...HOLDERS.map((i) => waitFor(`http://127.0.0.1:${PORTS.holder + i}/health`, `key holder ${i}`)),
    waitFor(`http://127.0.0.1:${PORTS.matcher}/v1/health`, 'the matcher'),
  ]);
}
