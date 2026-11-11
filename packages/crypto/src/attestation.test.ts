import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import type { AttestationPayload } from '@matra/shared';
import * as c from './index';

const platform = ed25519.keygen();
const platformKey = c.toBase64(platform.publicKey);
const matcher = c.matcherKeysFromSeed(new Uint8Array(32).fill(7));
const MEASUREMENT = 'ab'.repeat(32);
const TAG = 'cd'.repeat(32);

const payload = (over: Partial<AttestationPayload> = {}): AttestationPayload => ({
  v: 1,
  platform: 'simulated',
  measurement: MEASUREMENT,
  encKey: matcher.encPublicJwk,
  signKey: matcher.signPublicKey,
  nonce: '00'.repeat(32),
  issuedAt: new Date().toISOString(),
  ...over,
});

describe('matcher attestation documents (simulated platform)', () => {
  const nonce = c.newAttestationNonce();
  const doc = c.signAttestation(payload({ nonce }), platform.secretKey);
  const opts = { platformKey, expectedMeasurement: MEASUREMENT, nonce, allowSimulated: true };

  it('round trip: returns the matcher keys and the measurement', () => {
    const v = c.verifyAttestation(doc, opts);
    expect(v.encKey).toEqual(matcher.encPublicJwk);
    expect(v.signKey).toBe(matcher.signPublicKey);
    expect(v.measurement).toBe(MEASUREMENT);
    expect(v.platform).toBe('simulated');
    expect(c.platformPublicKey(platform.secretKey)).toBe(platformKey);
  });

  it('wrong platform key, altered payload or signature → bad_signature', () => {
    const other = c.toBase64(ed25519.keygen().publicKey);
    expect(() => c.verifyAttestation(doc, { ...opts, platformKey: other })).toThrow(expect.objectContaining({ code: 'bad_signature' }));
    const altered = { ...doc, payload: doc.payload.replace(MEASUREMENT, 'ef'.repeat(32)) };
    expect(() => c.verifyAttestation(altered, opts)).toThrow(expect.objectContaining({ code: 'bad_signature' }));
    const sig = c.fromBase64(doc.signature);
    sig[0]! ^= 1;
    expect(() => c.verifyAttestation({ ...doc, signature: c.toBase64(sig) }, opts)).toThrow(expect.objectContaining({ code: 'bad_signature' }));
    expect(() => c.verifyAttestation(undefined, opts)).toThrow(expect.objectContaining({ code: 'malformed' }));
  });

  it('a document for another nonce (a replay), or a malformed nonce → wrong_nonce', () => {
    expect(() => c.verifyAttestation(doc, { ...opts, nonce: c.newAttestationNonce() })).toThrow(expect.objectContaining({ code: 'wrong_nonce' }));
    expect(() => c.verifyAttestation(doc, { ...opts, nonce: '' })).toThrow(expect.objectContaining({ code: 'wrong_nonce' }));
  });

  it('older than maxAgeMs, or issued in the future → stale', () => {
    const old = c.signAttestation(payload({ nonce, issuedAt: new Date(Date.now() - 6 * 60_000).toISOString() }), platform.secretKey);
    expect(() => c.verifyAttestation(old, opts)).toThrow(expect.objectContaining({ code: 'stale' }));
    expect(c.verifyAttestation(old, { ...opts, maxAgeMs: 10 * 60_000 }).measurement).toBe(MEASUREMENT);
    const future = c.signAttestation(payload({ nonce, issuedAt: new Date(Date.now() + 10 * 60_000).toISOString() }), platform.secretKey);
    expect(() => c.verifyAttestation(future, opts)).toThrow(expect.objectContaining({ code: 'stale' }));
  });

  it('a measurement other than the pinned one → measurement_mismatch (a changed matcher build)', () => {
    expect(() => c.verifyAttestation(doc, { ...opts, expectedMeasurement: 'ef'.repeat(32) })).toThrow(
      expect.objectContaining({ code: 'measurement_mismatch' }),
    );
  });

  it('simulated is refused unless allowed; real platforms have no verifier yet', () => {
    expect(() => c.verifyAttestation(doc, { ...opts, allowSimulated: false })).toThrow(expect.objectContaining({ code: 'simulated_not_allowed' }));
    const nitro = c.signAttestation(payload({ nonce, platform: 'nitro' }), platform.secretKey);
    expect(() => c.verifyAttestation(nitro, opts)).toThrow(expect.objectContaining({ code: 'unsupported_platform' }));
  });

  it('a non-canonical payload (extra fields, other key order) is refused even when signed', () => {
    const p = payload({ nonce });
    const raw = JSON.stringify({ ...p, extra: 1 });
    const signed = { payload: raw, signature: c.toBase64(ed25519.sign(new TextEncoder().encode(`matra/attestation/v1|${raw}`), platform.secretKey)) };
    expect(() => c.verifyAttestation(signed, opts)).toThrow(expect.objectContaining({ code: 'malformed' }));
  });

  it('unpinned (development): no signature or measurement check, but nonce and freshness still apply', () => {
    const forged = { ...doc, signature: c.toBase64(new Uint8Array(64)) };
    expect(c.verifyAttestation(forged, { nonce, allowSimulated: true }).measurement).toBe(MEASUREMENT);
    expect(() => c.verifyAttestation(forged, { nonce: c.newAttestationNonce(), allowSimulated: true })).toThrow(expect.objectContaining({ code: 'wrong_nonce' }));
  });
});

describe('routing seal (ECIES to the matcher key)', () => {
  it('round trip; states are normalized and the plaintext length does not depend on them', async () => {
    const env = await c.sealRouting({ v: 1, tag: TAG, incidentState: 'ny', survivorState: 'NJ' }, matcher.encPublicJwk);
    expect(await c.openRouting(env, matcher.encPrivateJwk, TAG)).toEqual({ v: 1, tag: TAG, incidentState: 'NY', survivorState: 'NJ' });
    const none = await c.sealRouting({ v: 1, tag: TAG }, matcher.encPublicJwk);
    expect(await c.openRouting(none, matcher.encPrivateJwk, TAG)).toEqual({ v: 1, tag: TAG });
    expect(c.fromBase64(none.ct).length).toBe(c.fromBase64(env.ct).length);
    // not a state code → dropped, never sealed
    const junk = await c.sealRouting({ v: 1, tag: TAG, incidentState: 'New York' }, matcher.encPublicJwk);
    expect(await c.openRouting(junk, matcher.encPrivateJwk, TAG)).toEqual({ v: 1, tag: TAG });
  });

  it('moved to another entry (other tag) → fails: the AAD binds the tag', async () => {
    const env = await c.sealRouting({ v: 1, tag: TAG, incidentState: 'NY' }, matcher.encPublicJwk);
    await expect(c.openRouting(env, matcher.encPrivateJwk, 'ef'.repeat(32))).rejects.toThrow();
  });

  it('another recipient key, or a tampered ciphertext / ephemeral key → fails', async () => {
    const env = await c.sealRouting({ v: 1, tag: TAG, incidentState: 'NY' }, matcher.encPublicJwk);
    const other = c.matcherKeysFromSeed(new Uint8Array(32).fill(8));
    await expect(c.openRouting(env, other.encPrivateJwk, TAG)).rejects.toThrow();
    const ct = c.fromBase64(env.ct);
    ct[3]! ^= 1;
    await expect(c.openRouting({ ...env, ct: c.toBase64(ct) }, matcher.encPrivateJwk, TAG)).rejects.toThrow();
    await expect(c.openRouting({ ...env, epk: other.encPublicJwk }, matcher.encPrivateJwk, TAG)).rejects.toThrow();
  });

  it('refuses a recipient that is not a valid P-256 point', async () => {
    await expect(c.sealRouting({ v: 1, tag: TAG }, { ...matcher.encPublicJwk, y: matcher.encPublicJwk.x })).rejects.toThrow();
    await expect(c.sealRouting({ v: 1, tag: 'nothex' }, matcher.encPublicJwk)).rejects.toThrow(/64 hex/);
  });

  it('matcher keys are deterministic from the seed and differ per seed', () => {
    expect(c.matcherKeysFromSeed(new Uint8Array(32).fill(7))).toEqual(matcher);
    expect(c.matcherKeysFromSeed(new Uint8Array(32).fill(8)).encPublicJwk).not.toEqual(matcher.encPublicJwk);
    expect(() => c.matcherKeysFromSeed(new Uint8Array(16))).toThrow();
  });
});

describe('counselor roster v2 (licensed states)', () => {
  it('signs licensed states (normalized); v1 rosters verify with no licensed states', () => {
    const org = c.generateRosterKey();
    const pk = { kty: 'RSA', n: 'nnn', e: 'AQAB' } as JsonWebKey;
    const r = c.signCounselorRoster([{ userId: 'c1', publicKey: pk, licensedStates: ['ny', 'NJ', 'nj', 'Jersey'] }], org.secretKey);
    const v = c.verifyCounselorRoster(r, org.publicKey)!;
    expect(v.v).toBe(2);
    expect(v.counselors[0]!.licensedStates).toEqual(['NJ', 'NY']);
    const v1payload = JSON.stringify({ v: 1, issuedAt: 'x', counselors: [{ userId: 'c1', publicKey: { kty: 'RSA', n: 'nnn', e: 'AQAB' }, licensedStates: ['NJ'] }] });
    const v1 = { payload: v1payload, signature: c.toBase64(ed25519.sign(new TextEncoder().encode(`${c.ROSTER_DOMAIN}|${v1payload}`), org.secretKey)) };
    expect(c.verifyCounselorRoster(v1, org.publicKey)!.counselors[0]!.licensedStates).toEqual([]);
  });
});
