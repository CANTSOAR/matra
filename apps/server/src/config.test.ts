/**
 * Regression for the review's dict.mts: anyone holding BOTH OPRF key shares can recover a phone number from its stored
 * tag by brute force in milliseconds. So the two shares must never sit together on the database volume: production
 * refuses to start without explicitly provided keys (env, or files OUTSIDE the DB directory) and never generates them.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { toHex } from '@matra/crypto';
import { loadMatchingSettings, loadOprfKey } from './config.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'matra-cfg-'));

describe('OPRF key shares in production (M3)', () => {
  it('refuses to start without keys, and never auto-generates them', () => {
    const dir = tmp();
    const env = { NODE_ENV: 'production', MATRA_DB_PATH: path.join(dir, 'matra.db') };
    expect(() => loadOprfKey('a', env)).toThrow(/must be set in production/);
    expect(fs.readdirSync(dir)).toEqual([]);
    // MATRA_REQUIRE_OPRF_KEYS=0 cannot switch it off in production
    expect(() => loadOprfKey('b', { ...env, MATRA_REQUIRE_OPRF_KEYS: '0' })).toThrow(/must be set/);
  });

  it('refuses key files inside the database directory, and A and B in the same file', () => {
    const dbDir = tmp();
    const keysDir = tmp();
    const hex = toHex(crypto.getRandomValues(new Uint8Array(31))) + '01';
    fs.writeFileSync(path.join(dbDir, 'a.key'), hex);
    fs.writeFileSync(path.join(keysDir, 'a.key'), hex);
    const env = { NODE_ENV: 'production', MATRA_DB_PATH: path.join(dbDir, 'matra.db') };
    expect(() => loadOprfKey('a', { ...env, MATRA_OPRF_KEY_A_FILE: path.join(dbDir, 'a.key') })).toThrow(/outside the database directory/);
    expect(loadOprfKey('a', { ...env, MATRA_OPRF_KEY_A_FILE: path.join(keysDir, 'a.key') }).publicKey).toHaveLength(32);
    expect(() =>
      loadOprfKey('a', { ...env, MATRA_OPRF_KEY_A_FILE: path.join(keysDir, 'a.key'), MATRA_OPRF_KEY_B_FILE: path.join(keysDir, 'a.key') }),
    ).toThrow(/different files/);
  });

  it('accepts 64-hex keys and platform-generated secrets (Render generateValue)', () => {
    const env = { NODE_ENV: 'production', MATRA_DB_PATH: path.join(tmp(), 'm.db') };
    const a = loadOprfKey('a', { ...env, MATRA_OPRF_KEY_A: 'Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx5' });
    const b = loadOprfKey('b', { ...env, MATRA_OPRF_KEY_B: 'Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx5' });
    expect(toHex(a.publicKey)).not.toBe(toHex(b.publicKey)); // same secret string, holder-separated derivation
    expect(() => loadOprfKey('a', { ...env, MATRA_OPRF_KEY_A: 'short' })).toThrow();
  });

  it('release delay defaults to 72 h; rotation is opt-in', () => {
    expect(loadMatchingSettings({})).toEqual({ releaseDelayHours: 72, allowKeyRotation: false });
    expect(loadMatchingSettings({ MATRA_MATCH_RELEASE_DELAY_HOURS: '0', MATRA_OPRF_ROTATE: '1' })).toEqual({ releaseDelayHours: 0, allowKeyRotation: true });
    expect(() => loadMatchingSettings({ MATRA_MATCH_RELEASE_DELAY_HOURS: '-1' })).toThrow();
  });
});

describe('OPRF key parsing (random hex)', () => {
  it('accepts a random 64-hex value that is not a canonical scalar by deriving from it', async () => {
    const { loadOprfKey } = await import('./config');
    // 0xff… is far above the ristretto255 group order, like most `openssl rand -hex 32` output
    const env = { NODE_ENV: 'test', MATRA_OPRF_KEY_A: 'f'.repeat(64) } as NodeJS.ProcessEnv;
    const k1 = loadOprfKey('a', env);
    const k2 = loadOprfKey('a', env);
    expect(Buffer.from(k1.publicKey).toString('hex')).toBe(Buffer.from(k2.publicKey).toString('hex'));
  });
});
