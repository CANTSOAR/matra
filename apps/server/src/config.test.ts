/**
 * Regression for the review's dict.mts: anyone holding t OPRF key shares can recover a phone number from its stored
 * tag by brute force in milliseconds. So the shares must never sit on the database volume: production refuses to start
 * without explicitly provided shares (env, or files OUTSIDE the DB directory) and never generates them.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { groupKeyFromShares, toBase64, toHex } from '@matra/crypto';
import { loadHolderSettings, loadMatchingSettings, loadOprfThreshold, loadSecretBytes, writeOprfCeremony } from './config.js';
import { holderTokenPublicKeyFromSeed } from './holders.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'matra-cfg-'));

/** A ceremony into a fresh directory; env vars pointing at its files. */
function ceremony(t = 2, m = 3) {
  const keysDir = tmp();
  const pub = writeOprfCeremony(keysDir, t, m);
  const files = Object.fromEntries(Array.from({ length: m }, (_, i) => [`MATRA_OPRF_SHARE_${i + 1}_FILE`, path.join(keysDir, `oprf-share-${i + 1}.key`)]));
  return { keysDir, pub, files };
}

describe('threshold OPRF shares in production (M3, W14)', () => {
  it('refuses to start without every share, and never auto-generates them', () => {
    const dir = tmp();
    const env = { NODE_ENV: 'production', MATRA_DB_PATH: path.join(dir, 'matra.db') };
    expect(() => loadOprfThreshold(env)).toThrow(/MATRA_OPRF_SHARE_1 .*must be set in production/);
    expect(fs.readdirSync(dir)).toEqual([]);
    const { files } = ceremony();
    expect(() => loadOprfThreshold({ ...env, MATRA_OPRF_SHARE_1_FILE: files.MATRA_OPRF_SHARE_1_FILE, MATRA_OPRF_SHARE_2_FILE: files.MATRA_OPRF_SHARE_2_FILE })).toThrow(
      /MATRA_OPRF_SHARE_3 .*must be set/,
    );
    // MATRA_REQUIRE_OPRF_KEYS makes it fatal outside production too
    expect(() => loadOprfThreshold({ MATRA_DB_PATH: env.MATRA_DB_PATH, MATRA_REQUIRE_OPRF_KEYS: '1' })).toThrow(/must be set/);
  });

  it('loads a ceremony’s shares from files outside the DB directory; the group key matches the ceremony output', () => {
    const { pub, files } = ceremony(3, 5);
    const env = { NODE_ENV: 'production', MATRA_DB_PATH: path.join(tmp(), 'm.db'), MATRA_OPRF_THRESHOLD: '3', MATRA_OPRF_HOLDERS: '5', ...files };
    const o = loadOprfThreshold(env);
    expect(o).toMatchObject({ t: 3, m: 5, mode: 'in-process' });
    expect(o.shares!.map((s) => toBase64(s.publicKey))).toEqual(pub.holders.map((h) => h.publicKey));
    expect(toBase64(groupKeyFromShares(o.shares!, 3))).toBe(pub.groupPublicKey);
    // the share values themselves work as env values too (64 hex)
    const hexEnv = { NODE_ENV: 'production', MATRA_DB_PATH: env.MATRA_DB_PATH, MATRA_OPRF_THRESHOLD: '3', MATRA_OPRF_HOLDERS: '5' } as Record<string, string>;
    for (let i = 1; i <= 5; i++) hexEnv[`MATRA_OPRF_SHARE_${i}`] = fs.readFileSync(files[`MATRA_OPRF_SHARE_${i}_FILE`]!, 'utf8');
    expect(loadOprfThreshold(hexEnv).shares!.map((s) => toHex(s.secretKey))).toEqual(o.shares!.map((s) => toHex(s.secretKey)));
  });

  it('refuses share files inside the DB directory, two shares in one file, shares of different ceremonies, and non-scalars', () => {
    const dbDir = tmp();
    const { files, keysDir } = ceremony();
    const env = { NODE_ENV: 'production', MATRA_DB_PATH: path.join(dbDir, 'matra.db') };
    fs.copyFileSync(files.MATRA_OPRF_SHARE_1_FILE!, path.join(dbDir, 's1.key'));
    expect(() => loadOprfThreshold({ ...env, ...files, MATRA_OPRF_SHARE_1_FILE: path.join(dbDir, 's1.key') })).toThrow(/outside the database directory/);
    expect(() => loadOprfThreshold({ ...env, ...files, MATRA_OPRF_SHARE_2_FILE: files.MATRA_OPRF_SHARE_1_FILE })).toThrow(/different files|same public key/);
    const other = ceremony();
    expect(() => loadOprfThreshold({ ...env, ...files, MATRA_OPRF_SHARE_3_FILE: other.files.MATRA_OPRF_SHARE_3_FILE })).toThrow(/same oprf-ceremony/);
    fs.writeFileSync(path.join(keysDir, 'bad.key'), 'f'.repeat(64)); // ≥ ℓ: not a canonical scalar
    expect(() => loadOprfThreshold({ ...env, ...files, MATRA_OPRF_SHARE_1_FILE: path.join(keysDir, 'bad.key') })).toThrow();
    expect(() => loadOprfThreshold({ ...env, ...files, MATRA_OPRF_SHARE_1: 'a-platform-generated-secret-is-not-a-share-0123' })).toThrow(/64 hex/);
  });

  it('the additive MATRA_OPRF_KEY_A / _B are a fatal error pointing to the ceremony; t and m are validated', () => {
    for (const k of ['MATRA_OPRF_KEY_A', 'MATRA_OPRF_KEY_B_FILE'])
      expect(() => loadOprfThreshold({ [k]: 'x'.repeat(40) })).toThrow(/no longer used.*oprf-ceremony/);
    expect(() => loadOprfThreshold({ MATRA_OPRF_THRESHOLD: '1' })).toThrow(/2 ≤ t ≤ m/);
    expect(() => loadOprfThreshold({ MATRA_OPRF_THRESHOLD: '4', MATRA_OPRF_HOLDERS: '3' })).toThrow(/2 ≤ t ≤ m/);
    expect(() => loadOprfThreshold({ MATRA_OPRF_HOLDERS: '17' })).toThrow(/2 ≤ t ≤ m/);
  });

  it('remote mode: URLs + pinned share public keys (consistent) + the holder-token key', () => {
    const { pub } = ceremony();
    const tokenKey = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const env = {
      NODE_ENV: 'production',
      MATRA_DB_PATH: path.join(tmp(), 'm.db'),
      MATRA_OPRF_HOLDER_URLS: 'https://h1.example.org, https://h2.example.org,https://h3.example.org',
      MATRA_OPRF_SHARE_PUBKEYS: pub.holders.map((h) => h.publicKey).join(','),
      MATRA_HOLDER_TOKEN_KEY: tokenKey,
    };
    const o = loadOprfThreshold(env);
    expect(o).toMatchObject({ t: 2, m: 3, mode: 'remote' });
    expect(o.remote!.urls).toEqual(['https://h1.example.org', 'https://h2.example.org', 'https://h3.example.org']);
    expect(toHex(o.remote!.tokenKey)).toBe(tokenKey);
    expect(() => loadOprfThreshold({ ...env, MATRA_HOLDER_TOKEN_KEY: undefined })).toThrow(/MATRA_HOLDER_TOKEN_KEY .*must be set in production/);
    expect(() => loadOprfThreshold({ ...env, MATRA_OPRF_HOLDER_URLS: 'https://h1.example.org' })).toThrow(/3 holder URLs/);
    const other = ceremony();
    const swapped = [pub.holders[0]!.publicKey, pub.holders[1]!.publicKey, other.pub.holders[2]!.publicKey].join(',');
    expect(() => loadOprfThreshold({ ...env, MATRA_OPRF_SHARE_PUBKEYS: swapped })).toThrow(/inconsistent/);
  });

  it('a standalone holder needs its share and the pinned token public key in production', () => {
    const { files } = ceremony();
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const env = {
      NODE_ENV: 'production',
      MATRA_HOLDER_INDEX: '2',
      MATRA_HOLDER_DB_PATH: path.join(tmp(), 'holder.db'),
      MATRA_OPRF_SHARE_FILE: files.MATRA_OPRF_SHARE_2_FILE,
      MATRA_HOLDER_TOKEN_PUBKEY: toBase64(holderTokenPublicKeyFromSeed(seed)),
    };
    const h = loadHolderSettings(env);
    expect(h.index).toBe(2);
    expect(toHex(h.tokenPublicKey)).toBe(toHex(holderTokenPublicKeyFromSeed(seed)));
    expect(() => loadHolderSettings({ ...env, MATRA_HOLDER_TOKEN_PUBKEY: undefined })).toThrow(/MATRA_HOLDER_TOKEN_PUBKEY must be set/);
    expect(() => loadHolderSettings({ ...env, MATRA_OPRF_SHARE_FILE: undefined })).toThrow(/MATRA_OPRF_SHARE .*must be set/);
    expect(() => loadHolderSettings({ ...env, MATRA_HOLDER_INDEX: '0' })).toThrow(/MATRA_HOLDER_INDEX/);
    expect(() => loadHolderSettings({ ...env, MATRA_HOLDER_DB_PATH: path.join(path.dirname(files.MATRA_OPRF_SHARE_2_FILE!), 'h.db') })).toThrow(
      /outside the database directory/,
    );
  });

  it('release delay defaults to 72 h; rotation is opt-in in production (and automatic outside it)', () => {
    expect(loadMatchingSettings({ NODE_ENV: 'production' })).toEqual({ releaseDelayHours: 72, allowKeyRotation: false });
    expect(loadMatchingSettings({ NODE_ENV: 'production', MATRA_MATCH_RELEASE_DELAY_HOURS: '0', MATRA_OPRF_ROTATE: '1' })).toEqual({
      releaseDelayHours: 0,
      allowKeyRotation: true,
    });
    expect(loadMatchingSettings({}).allowKeyRotation).toBe(true);
    expect(() => loadMatchingSettings({ MATRA_MATCH_RELEASE_DELAY_HOURS: '-1' })).toThrow();
  });
});

describe('loadSecretBytes (secrets held outside the database)', () => {
  it('accepts 64 hex or a ≥ 32-char secret (derived), refuses short values, generates only in development', () => {
    const dir = tmp();
    const devFile = path.join(dir, 'dev.key');
    const opts = { devFile, label: 'test secret' };
    expect(toHex(loadSecretBytes('X', { ...opts, env: { X: 'ab'.repeat(32) } }))).toBe('ab'.repeat(32));
    const d1 = loadSecretBytes('X', { ...opts, env: { X: 'Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx5' } });
    expect(d1).toHaveLength(32);
    expect(toHex(loadSecretBytes('Y', { ...opts, env: { Y: 'Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx5' } }))).not.toBe(toHex(d1)); // name-separated
    expect(() => loadSecretBytes('X', { ...opts, env: { X: 'short' } })).toThrow(/at least 32/);
    expect(() => loadSecretBytes('X', { ...opts, env: { NODE_ENV: 'production' } })).toThrow(/must be set in production/);
    expect(fs.existsSync(devFile)).toBe(false);
    const g = loadSecretBytes('X', { ...opts, env: {} });
    expect(fs.statSync(devFile).mode & 0o777).toBe(0o600);
    expect(toHex(loadSecretBytes('X', { ...opts, env: {} }))).toBe(toHex(g));
  });
});
