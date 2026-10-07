import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// MATRA_VOICE_HARNESS=1 adds a standalone page for the on-device transcription E2E check (e2e/voice.spec.ts).
// It is never part of a normal build.
// MATRA_VOICE_HARNESS=only builds just that page (isolated test builds).
const voiceHarness = process.env.MATRA_VOICE_HARNESS === '1' || process.env.MATRA_VOICE_HARNESS === 'only';

export default defineConfig({
  plugins: [react()],
  // The transcription worker (src/voice/worker.ts) is an ES module worker: it code-splits and uses import.meta.
  worker: { format: 'es' },
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
