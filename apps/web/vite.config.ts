import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import manifest from './src/voice/model-manifest.json' with { type: 'json' };

// MATRA_VOICE_HARNESS=1 adds a standalone page for the on-device transcription E2E check (e2e/voice.spec.ts).
// It is never part of a normal build.
// MATRA_VOICE_HARNESS=only builds just that page (isolated test builds).
const voiceHarness = process.env.MATRA_VOICE_HARNESS === '1' || process.env.MATRA_VOICE_HARNESS === 'only';

/**
 * onnxruntime-web references its WebGPU (asyncify) runtime as `new URL('ort-wasm-simd-threaded.asyncify.wasm',
 * import.meta.url)`, so Vite would copy a second, 27 MB copy of it into dist/assets. Matra never loads that copy: the
 * worker fetches the runtime itself from /models/ort/ (scripts/fetch-models.mjs, sha256-pinned, cached once) and hands
 * it to ONNX Runtime as wasmBinary + wasmPaths (src/voice/worker.ts). Point the reference at that same file instead,
 * so the fallback (if ever taken) still loads from our origin and the build ships one copy, not two.
 */
function ortRuntimeFromModels(): Plugin {
  const file = manifest.ort.webgpu.wasm;
  const ref = new RegExp(String.raw`new URL\(\s*["']` + file.replace(/\./g, '\\.') + String.raw`["']\s*,\s*import\.meta\.url\s*\)`, 'g');
  return {
    name: 'matra:ort-runtime-from-models',
    enforce: 'pre',
    transform(code, id) {
      if (!/onnxruntime-web[\\/]dist[\\/]/.test(id) || !code.includes(file)) return null;
      const out = code.replace(ref, `new URL(${JSON.stringify('/models/ort/' + file)}, self.location.href)`);
      return out === code ? null : { code: out, map: null };
    },
  };
}

/**
 * Build-time pins for sealed matching (docs/SECURITY_WHITEPAPER.md §4a). Production builds set them all, so the app
 * server cannot substitute OPRF keys or counselors it controls (values from `npm run -w @matra/server oprf-ceremony`):
 *   MATRA_OPRF_THRESHOLD          t (default 2 when the keys below are set)
 *   MATRA_OPRF_GROUP_PUBKEY       base64 group public key k·G of the threshold OPRF
 *   MATRA_OPRF_SHARE_PUBKEYS      base64 share public keys of holders 1..m, comma-separated, in index order
 *   MATRA_COUNSELOR_ROSTER_PUBKEY base64 Ed25519 key of the org that signs the counselor roster and the attorney
 *                                 directory (W3)
 * Unset (development): nothing is pinned and the client logs a warning. A production build that is not a demo
 * (MATRA_DEMO_MODE=1) fails without them: see assertProductionPins below.
 */
if (process.env.MATRA_OPRF_PUBKEY_A || process.env.MATRA_OPRF_PUBKEY_B)
  throw new Error('MATRA_OPRF_PUBKEY_A/B were replaced by MATRA_OPRF_GROUP_PUBKEY + MATRA_OPRF_SHARE_PUBKEYS (threshold OPRF; see docs/DEPLOY.md).');
const matchPins = {
  oprfT: Number(process.env.MATRA_OPRF_THRESHOLD || 2),
  oprfGroup: process.env.MATRA_OPRF_GROUP_PUBKEY || '',
  oprfShares: (process.env.MATRA_OPRF_SHARE_PUBKEYS || '').split(',').map((s) => s.trim()).filter(Boolean),
  rosterKey: process.env.MATRA_COUNSELOR_ROSTER_PUBKEY || '',
};
// The OPRF pin is all-or-nothing: a build with only some of these set (one missing or misspelled) would otherwise ship
// with NO OPRF pin and trust whatever key set the server sends. And a set that is not one consistent t-of-m key
// (wrong t, a share from another ceremony, a wrong group key) fails here rather than in every survivor's sealing.
{
  const oprfVars = ['MATRA_OPRF_THRESHOLD', 'MATRA_OPRF_GROUP_PUBKEY', 'MATRA_OPRF_SHARE_PUBKEYS'] as const;
  const set = oprfVars.filter((v) => (process.env[v] ?? '').trim() !== '');
  if (set.length && set.length !== oprfVars.length)
    throw new Error(`OPRF pins are all-or-nothing: ${set.join(', ')} set but ${oprfVars.filter((v) => !set.includes(v)).join(', ')} missing (see docs/DEPLOY.md).`);
  if (set.length) {
    // threshold.ts itself (the @matra/crypto barrel's extensionless imports do not load in a Node-run config), and only
    // when pins are set, so dev builds do not pull it in
    const { checkThresholdKeys } = await import('../../packages/crypto/src/threshold.ts');
    const fromBase64 = (b: string) => new Uint8Array(Buffer.from(b, 'base64'));
    if (!Number.isInteger(matchPins.oprfT)) throw new Error('MATRA_OPRF_THRESHOLD must be an integer');
    try {
      checkThresholdKeys({
        t: matchPins.oprfT,
        groupPublicKey: fromBase64(matchPins.oprfGroup),
        holders: matchPins.oprfShares.map((pk, i) => ({ index: i + 1, publicKey: fromBase64(pk) })),
      });
    } catch (e) {
      throw new Error(`OPRF pins are inconsistent (MATRA_OPRF_THRESHOLD / _GROUP_PUBKEY / _SHARE_PUBKEYS): ${(e as Error).message}`);
    }
  }
}

/**
 * The matcher this build trusts (matcher-service; docs/threat-model.md W18). Both or neither:
 *   MATRA_ATTESTATION_PLATFORM_PUBKEY  base64 Ed25519 key of the attestation platform
 *   MATRA_MATCHER_MEASUREMENT          hex measurement of the published matcher build (npm run -w @matra/matcher measure)
 * Pinned builds refuse a matcher that is not that build, and refuse a SIMULATED attestation unless MATRA_DEMO_MODE=1 at
 * build time (__MATRA_DEMO__, a fictional-data demo build). Unset (development): any attestation, with a warning.
 * A production `vite build` without them fails unless MATRA_DEMO_MODE=1: the attestation reaches the client through
 * the app server's proxy, so an unpinned client would seal every survivor's states to whatever key the app server
 * hands it (matchPins.ts applies the same rule at run time).
 */
const attestationPins = {
  platformKey: (process.env.MATRA_ATTESTATION_PLATFORM_PUBKEY || '').trim(),
  measurement: (process.env.MATRA_MATCHER_MEASUREMENT || '').trim().toLowerCase(),
};
if (!!attestationPins.platformKey !== !!attestationPins.measurement)
  throw new Error('Matcher pins are all-or-nothing: set both MATRA_ATTESTATION_PLATFORM_PUBKEY and MATRA_MATCHER_MEASUREMENT, or neither (see docs/DEPLOY.md).');
if (attestationPins.measurement && !/^[0-9a-f]{64}$/.test(attestationPins.measurement))
  throw new Error('MATRA_MATCHER_MEASUREMENT must be 64 hex characters (npm run -w @matra/matcher measure)');
const demoBuild = process.env.MATRA_DEMO_MODE === '1';

/**
 * Sealed matching is part of every build of the web app today (there is no build flag that leaves it out). If one is
 * ever added, pass `matching: false` for such a build and the OPRF pins stop being required.
 */
const MATCHING_IN_BUILD = true;

/**
 * Throws for a production build of the app (not the voice-only test page) that is missing a pin, unless it is a
 * fictional-data demo build (MATRA_DEMO_MODE=1). Development servers, `vite build --mode development` and the e2e
 * builds (which set MATRA_DEMO_MODE=1) are not affected.
 *   - matcher pins: an unpinned client would seal every survivor's states to whatever key the app server hands it (W18)
 *   - roster / directory key: an unpinned client trusts the app server's attorney keys, so the operator could swap in
 *     its own key and receive shared records (W3); the share screen also refuses unpinned keys in such a build
 *   - OPRF pins (when the build includes sealed matching): an unpinned client accepts whatever key set the server sends,
 *     so the operator could evaluate identifiers under keys it holds (W2, W14). Part-set pins already fail above.
 */
export function assertProductionPins(o: {
  command: string;
  mode: string;
  demo: boolean;
  harnessOnly: boolean;
  matcherPinned: boolean;
  rosterPinned: boolean;
  oprfPinned: boolean;
  matching: boolean;
}) {
  if (o.command !== 'build' || o.mode !== 'production' || o.harnessOnly || o.demo) return;
  const missing = [
    ...(o.matcherPinned ? [] : ['the matcher pins MATRA_ATTESTATION_PLATFORM_PUBKEY and MATRA_MATCHER_MEASUREMENT']),
    ...(o.rosterPinned ? [] : ['the organization key MATRA_COUNSELOR_ROSTER_PUBKEY (counselor roster and attorney directory)']),
    ...(o.matching && !o.oprfPinned ? ['the OPRF pins MATRA_OPRF_THRESHOLD, MATRA_OPRF_GROUP_PUBKEY and MATRA_OPRF_SHARE_PUBKEYS'] : []),
  ];
  if (missing.length)
    throw new Error(
      `A production build needs ${missing.join('; ')} (see docs/DEPLOY.md). ` +
        'Set MATRA_DEMO_MODE=1 only for a fictional-data demo build.',
    );
}

const config = {
  plugins: [react()],
  define: {
    __MATRA_MATCH_PINS__: JSON.stringify(matchPins),
    __MATRA_ATTESTATION__: JSON.stringify(attestationPins),
    __MATRA_DEMO__: JSON.stringify(demoBuild),
  },
  // The transcription worker (src/voice/worker.ts) is an ES module worker: it code-splits and uses import.meta.
  worker: { format: 'es', plugins: () => [ortRuntimeFromModels()] },
  build: voiceHarness
    ? {
        rollupOptions: {
          input: {
            ...(process.env.MATRA_VOICE_HARNESS !== 'only' && { main: fileURLToPath(new URL('./index.html', import.meta.url)) }),
            voiceHarness: fileURLToPath(new URL('./src/voice/harness/index.html', import.meta.url)),
          },
        },
      }
    : undefined,
  // MATRA_WEB_PORT / MATRA_API_URL let the E2E suite run an isolated stack; defaults are the normal dev setup.
  server: {
    port: Number(process.env.MATRA_WEB_PORT) || 5173,
    strictPort: !!process.env.MATRA_WEB_PORT,
    proxy: { '/api': process.env.MATRA_API_URL || 'http://localhost:4000' },
    // E2E runs must not be disturbed by edits made while they run
    ...(process.env.MATRA_WEB_NO_HMR && { hmr: false, watch: null }),
  },
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'], testTimeout: 30_000 },
} as any;

export default defineConfig(({ command, mode }) => {
  assertProductionPins({
    command,
    mode,
    demo: demoBuild,
    harnessOnly: process.env.MATRA_VOICE_HARNESS === 'only',
    matcherPinned: !!attestationPins.measurement,
    rosterPinned: !!matchPins.rosterKey,
    // all-or-nothing is enforced above, so the group key stands for the whole set
    oprfPinned: !!matchPins.oprfGroup && matchPins.oprfShares.length > 0,
    matching: MATCHING_IN_BUILD,
  });
  return config;
});
