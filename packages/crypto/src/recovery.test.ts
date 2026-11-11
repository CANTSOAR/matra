import { describe, expect, it } from 'vitest';
import * as c from './index';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const subtle = globalThis.crypto.subtle;

async function hmacHex(key: CryptoKey, msg: string) {
  return c.toHex(await subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
}

describe('account secret (key version 2)', () => {
  it('deriveKey of the v1 keys equals deriveBits of the same HKDF outputs (switching to v2 re-encrypts nothing)', async () => {
    const salt = c.newKdfSalt();
    const v1 = await c.deriveKeys('correct horse battery', salt, 1000);
    const pk = await c.derivePassphraseKeys('correct horse battery', salt, 1000);
    expect(pk.authKey).toBe(v1.authKey);
    const as = await c.legacyAccountSecret(pk.ikm);
    expect(as.length).toBe(64);
    const v2 = await c.importAccountSecret(as);

    // a record written under v1's master key opens under the imported AS, and vice versa
    const recordKey = await c.generateContentKey();
    const env = await c.encryptJSON({ story: 'mine' }, recordKey);
    const wrapped = await c.wrapKeyWithMaster(recordKey, v1.masterKey);
    expect(await c.decryptJSON(env, await c.unwrapKeyWithMaster(wrapped, v2.masterKey))).toEqual({ story: 'mine' });
    const back = await c.wrapKeyWithMaster(recordKey, v2.masterKey);
    expect(await c.decryptJSON(env, await c.unwrapKeyWithMaster(back, v1.masterKey))).toEqual({ story: 'mine' });
    // same sealed-match HMAC key, and matchKeyFor finds it
    expect(await hmacHex(v2.matchKey, 'x')).toBe(await hmacHex(v1.matchKey, 'x'));
    expect(c.matchKeyFor(v2.masterKey)).toBe(v2.matchKey);
  });

  it('v2: the master key unwrapped with the passphrase KEK decrypts records written under v1; a wrong passphrase fails', async () => {
    const salt = c.newKdfSalt();
    const v1 = await c.deriveKeys('my old passphrase', salt, 1000);
    const id = await c.generateIdentity(v1.masterKey);
    const pk = await c.derivePassphraseKeys('my old passphrase', salt, 1000);
    const as = await c.legacyAccountSecret(pk.ikm);
    const wrappedAccountKey = await c.wrapAccountSecret(as, pk.kek);
    as.fill(0);

    const v2 = await c.deriveKeys('my old passphrase', salt, 1000, wrappedAccountKey);
    await expect(c.unwrapPrivateKey(id.wrappedPrivateKey, v2.masterKey)).resolves.toBeDefined();
    await expect(c.deriveKeys('not my passphrase', salt, 1000, wrappedAccountKey)).rejects.toThrow();

    // a new passphrase only re-wraps AS
    const salt2 = c.newKdfSalt();
    const pk2 = await c.derivePassphraseKeys('a brand new passphrase', salt2, 1000);
    const as2 = await c.unwrapAccountSecret(wrappedAccountKey, pk.kek);
    const rewrapped = await c.wrapAccountSecret(as2, pk2.kek);
    const v2b = await c.deriveKeys('a brand new passphrase', salt2, 1000, rewrapped);
    await expect(c.unwrapPrivateKey(id.wrappedPrivateKey, v2b.masterKey)).resolves.toBeDefined();
  });

  it('a changed wrapped key or a wrong-length secret is refused', async () => {
    const pk = await c.derivePassphraseKeys('p', c.newKdfSalt(), 1000);
    const env = await c.wrapAccountSecret(new Uint8Array(64).fill(3), pk.kek);
    const ct = c.fromBase64(env.ct);
    ct[0]! ^= 1;
    await expect(c.unwrapAccountSecret({ ...env, ct: c.toBase64(ct) }, pk.kek)).rejects.toThrow();
    await expect(c.wrapAccountSecret(new Uint8Array(32), pk.kek)).rejects.toThrow(/64 bytes/);
    const short = await c.encryptBytes(new Uint8Array(32), pk.kek);
    await expect(c.unwrapAccountSecret(short, pk.kek)).rejects.toThrow(/Not an account secret/);
  });
});

describe('recovery code', () => {
  it('is 128 random bits, 28 Crockford characters in 7 groups of 4, no repeats across 1,000', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const { bytes, code } = c.generateRecoveryCode();
      expect(bytes.length).toBe(16);
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){6}$/);
      expect(Array.from(c.parseRecoveryCode(code))).toEqual(Array.from(bytes));
      seen.add(code);
    }
    expect(seen.size).toBe(1000);
  });

  it('round-trips the all-zero and all-ones codes', () => {
    for (const fill of [0, 0xff]) {
      const bytes = new Uint8Array(16).fill(fill);
      expect(Array.from(c.parseRecoveryCode(c.formatRecoveryCode(bytes)))).toEqual(Array.from(bytes));
    }
  });

  it('catches every single-character typo (all positions × all other symbols) in a sample of codes', () => {
    for (let k = 0; k < 20; k++) {
      const plain = c.generateRecoveryCode().code.replace(/-/g, '');
      for (let i = 0; i < plain.length; i++) {
        for (const ch of ALPHABET) {
          if (ch === plain[i]) continue;
          const typo = plain.slice(0, i) + ch + plain.slice(i + 1);
          expect(() => c.parseRecoveryCode(typo), `${typo}`).toThrow(c.RecoveryCodeError);
        }
      }
    }
  });

  it('parsing ignores case, spaces and hyphens, and reads O as 0 and I/L as 1', () => {
    const bytes = new Uint8Array(16).fill(0);
    bytes[15] = 1; // ends in …0001-style characters, so the aliases matter
    const code = c.formatRecoveryCode(bytes);
    const want = Array.from(bytes);
    expect(Array.from(c.parseRecoveryCode(code.toLowerCase()))).toEqual(want);
    expect(Array.from(c.parseRecoveryCode(code.replace(/-/g, ' ')))).toEqual(want);
    expect(Array.from(c.parseRecoveryCode(code.replace(/-/g, '').replace(/0/g, 'O')))).toEqual(want);
    const withOne = c.generateRecoveryCode().code;
    if (withOne.includes('1')) {
      expect(Array.from(c.parseRecoveryCode(withOne.replace(/1/g, 'l')))).toEqual(Array.from(c.parseRecoveryCode(withOne)));
      expect(Array.from(c.parseRecoveryCode(withOne.replace(/1/g, 'I')))).toEqual(Array.from(c.parseRecoveryCode(withOne)));
    }
  });

  it('wrong length and foreign characters are refused with a reason', () => {
    const code = c.generateRecoveryCode().code;
    expect(() => c.parseRecoveryCode(code.slice(0, -1))).toThrow(expect.objectContaining({ reason: 'length' }));
    expect(() => c.parseRecoveryCode(code + 'A')).toThrow(expect.objectContaining({ reason: 'length' }));
    expect(() => c.parseRecoveryCode('U' + code.slice(1))).toThrow(expect.objectContaining({ reason: 'character' }));
  });

  it('confirm step: the last 4 characters', () => {
    const code = 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345';
    expect(c.recoveryCodeTail(code)).toBe('2345');
    expect(c.recoveryTailMatches('2345', code)).toBe(true);
    expect(c.recoveryTailMatches(' 23-45 ', code)).toBe(true);
    expect(c.recoveryTailMatches('2346', code)).toBe(false);
    expect(c.recoveryTailMatches('345', code)).toBe(false);
  });

  it('derives a stable auth key and a KEK that unwraps AS; a different code cannot', async () => {
    const { bytes } = c.generateRecoveryCode();
    const a = await c.deriveRecoveryKeys(bytes);
    const b = await c.deriveRecoveryKeys(bytes.slice());
    expect(a.authKey).toBe(b.authKey);
    expect(c.fromBase64(a.authKey).length).toBe(32);

    const as = c.randomBytes(64);
    const wrapped = await c.wrapAccountSecret(as, a.kek);
    expect(Array.from(await c.unwrapAccountSecret(wrapped, b.kek))).toEqual(Array.from(as));

    const other = await c.deriveRecoveryKeys(c.generateRecoveryCode().bytes);
    expect(other.authKey).not.toBe(a.authKey);
    await expect(c.unwrapAccountSecret(wrapped, other.kek)).rejects.toThrow();

    // recovery keys are independent of the passphrase keys even for the same input bytes
    const pk = await c.derivePassphraseKeys('x', c.newKdfSalt(), 1000);
    await expect(c.unwrapAccountSecret(wrapped, pk.kek)).rejects.toThrow();
  });
});
