import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
