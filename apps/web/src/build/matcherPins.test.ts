// @vitest-environment node
/**
 * A production web build must pin the matcher, the organization key and the OPRF key set (vite.config.ts
 * assertProductionPins): an unpinned client would seal every survivor's states to whatever key the app server's
 * attestation proxy hands it (W18), trust the server's attorney keys when she shares (W3), and accept whatever OPRF
 * key set the server sends (W2, W14). Demo builds (MATRA_DEMO_MODE=1) are exempt.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AttorneyKeyCheck } from '@matra/crypto';
import { attorneyShareable } from '../matchPins';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VITE = path.resolve(WEB, '..', '..', 'node_modules', '.bin', 'vite');

/** `vite build` in apps/web with only `extra` of the pin variables set; stops at config load or after. */
function build(extra: Record<string, string>) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (
      v !== undefined &&
      !/^MATRA_(ATTESTATION_PLATFORM_PUBKEY|MATCHER_MEASUREMENT|DEMO_MODE|VOICE_HARNESS|COUNSELOR_ROSTER_PUBKEY|OPRF_THRESHOLD|OPRF_GROUP_PUBKEY|OPRF_SHARE_PUBKEYS)$/.test(k)
    )
      env[k] = v;
  // an output directory nothing else reads, in case the build gets past the config
  return spawnSync(VITE, ['build', '--outDir', path.join(WEB, 'node_modules', '.matcher-pin-test'), '--emptyOutDir', '--logLevel', 'error'], {
    cwd: WEB,
    env: { ...env, NODE_ENV: 'production', ...extra },
    encoding: 'utf8',
    timeout: 120_000,
  });
}

describe('production web build: pins', () => {
  it('refuses to build without the attestation pins, unless MATRA_DEMO_MODE=1', async () => {
    const r = build({});
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/production build needs the matcher pins/);
  });

  it('refuses to build with the matcher pinned but no roster key or OPRF pins', async () => {
    const r = build({ MATRA_ATTESTATION_PLATFORM_PUBKEY: 'cGxhdGZvcm0ta2V5', MATRA_MATCHER_MEASUREMENT: 'a'.repeat(64) });
    expect(r.status).not.toBe(0);
    const out = r.stderr + r.stdout;
    expect(out).toMatch(/production build needs the organization key MATRA_COUNSELOR_ROSTER_PUBKEY/);
    expect(out).toMatch(/the OPRF pins MATRA_OPRF_THRESHOLD, MATRA_OPRF_GROUP_PUBKEY and MATRA_OPRF_SHARE_PUBKEYS/);
    expect(out).not.toMatch(/matcher pins/);
  });

  it('keeps OPRF pins all-or-nothing', async () => {
    const r = build({ MATRA_DEMO_MODE: '1', MATRA_OPRF_GROUP_PUBKEY: 'Z3JvdXA=' });
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/OPRF pins are all-or-nothing/);
  });

  it('the config check itself: demo builds, fully pinned builds, dev servers and the voice-only page pass', async () => {
    const { assertProductionPins } = await import('../../vite.config');
    const base = {
      command: 'build',
      mode: 'production',
      demo: false,
      harnessOnly: false,
      matcherPinned: false,
      rosterPinned: false,
      oprfPinned: false,
      matching: true,
    };
    const pinned = { ...base, matcherPinned: true, rosterPinned: true, oprfPinned: true };
    expect(() => assertProductionPins(base)).toThrow(/matcher pins/);
    expect(() => assertProductionPins(pinned)).not.toThrow();
    expect(() => assertProductionPins({ ...pinned, matcherPinned: false })).toThrow(/matcher pins/);
    expect(() => assertProductionPins({ ...pinned, rosterPinned: false })).toThrow(/MATRA_COUNSELOR_ROSTER_PUBKEY/);
    expect(() => assertProductionPins({ ...pinned, oprfPinned: false })).toThrow(/OPRF pins/);
    // OPRF pins are required only when the build includes sealed matching
    expect(() => assertProductionPins({ ...pinned, oprfPinned: false, matching: false })).not.toThrow();
    expect(() => assertProductionPins({ ...base, demo: true })).not.toThrow();
    expect(() => assertProductionPins({ ...base, command: 'serve' })).not.toThrow();
    expect(() => assertProductionPins({ ...base, mode: 'development' })).not.toThrow();
    expect(() => assertProductionPins({ ...base, harnessOnly: true })).not.toThrow();
  });
});

describe('sharing with an attorney key nobody can check (W3)', () => {
  const check = (status: AttorneyKeyCheck['status']) => ({ status, fingerprint: 'AAAA' }) as AttorneyKeyCheck;
  it('a production build that is not a demo never shares with an unpinned key', () => {
    expect(attorneyShareable(check('unpinned'), false)).toBe(false);
    expect(attorneyShareable(check('verified'), false)).toBe(true);
  });
  it('development and demo builds still can, and nothing else is ever shareable', () => {
    expect(attorneyShareable(check('unpinned'), true)).toBe(true);
    for (const s of ['unsigned', 'not_listed', 'key_mismatch'] as const) expect(attorneyShareable(check(s), true)).toBe(false);
  });
  it('the test run itself is not a production build', () => {
    expect(attorneyShareable(check('unpinned'))).toBe(true);
  });
});
