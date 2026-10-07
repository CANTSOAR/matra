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
 * Build-time pins for sealed matching (docs/SECURITY_WHITEPAPER.md §4a). Production builds set all three, so the app
 * server cannot substitute OPRF keys or counselors it controls:
 *   MATRA_OPRF_PUBKEY_A / MATRA_OPRF_PUBKEY_B   base64 public keys of the two OPRF key holders
 *   MATRA_COUNSELOR_ROSTER_PUBKEY              base64 Ed25519 key of the org that signs the counselor roster
 * Unset (development): nothing is pinned and the client logs a warning.
 */
const matchPins = {
  oprfA: process.env.MATRA_OPRF_PUBKEY_A || '',
  oprfB: process.env.MATRA_OPRF_PUBKEY_B || '',
  rosterKey: process.env.MATRA_COUNSELOR_ROSTER_PUBKEY || '',
};

export default defineConfig({
  plugins: [react()],
  define: { __MATRA_MATCH_PINS__: JSON.stringify(matchPins) },
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
} as any);
