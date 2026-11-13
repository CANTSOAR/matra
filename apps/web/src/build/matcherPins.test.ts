// @vitest-environment node
/**
 * A production web build must pin the matcher (vite.config.ts): an unpinned client would seal every survivor's states
 * to whatever key the app server's attestation proxy hands it.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VITE = path.resolve(WEB, '..', '..', 'node_modules', '.bin', 'vite');

/** `vite build` in apps/web with only `extra` of the matcher variables set; stops at config load or after. */
function build(extra: Record<string, string>) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && !/^MATRA_(ATTESTATION_PLATFORM_PUBKEY|MATCHER_MEASUREMENT|DEMO_MODE|VOICE_HARNESS)$/.test(k)) env[k] = v;
  // an output directory nothing else reads, in case the build gets past the config
  return spawnSync(VITE, ['build', '--outDir', path.join(WEB, 'node_modules', '.matcher-pin-test'), '--emptyOutDir', '--logLevel', 'error'], {
    cwd: WEB,
    env: { ...env, NODE_ENV: 'production', ...extra },
    encoding: 'utf8',
    timeout: 120_000,
  });
}

describe('production web build: matcher pins', () => {
  it('refuses to build without the attestation pins, unless MATRA_DEMO_MODE=1', async () => {
    const r = build({});
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/production build needs the matcher pins/);
  });

  it('the config check itself: demo builds, pinned builds, dev servers and the voice-only page pass', async () => {
    const { assertMatcherPinned } = await import('../../vite.config');
    const base = { command: 'build', mode: 'production', pinned: false, demo: false, harnessOnly: false };
    expect(() => assertMatcherPinned(base)).toThrow(/matcher pins/);
    expect(() => assertMatcherPinned({ ...base, demo: true })).not.toThrow();
    expect(() => assertMatcherPinned({ ...base, pinned: true })).not.toThrow();
    expect(() => assertMatcherPinned({ ...base, command: 'serve' })).not.toThrow();
    expect(() => assertMatcherPinned({ ...base, mode: 'development' })).not.toThrow();
    expect(() => assertMatcherPinned({ ...base, harnessOnly: true })).not.toThrow();
  });
});
