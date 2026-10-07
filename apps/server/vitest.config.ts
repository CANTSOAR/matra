import { defineConfig } from 'vitest/config';

// RSA-3072 key generation (one per test user) is slow-ish, hence the generous timeout.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], testTimeout: 60_000, environment: 'node' },
});
