import { describe, expect, it } from 'vitest';
import * as c from './index';

describe('@matra/crypto', () => {
  it('derives deterministic auth key, round-trips records, and shares to a recipient', async () => {
    const salt = c.newKdfSalt();
    const a = await c.deriveKeys('correct horse battery', salt, 1000);
    const b = await c.deriveKeys('correct horse battery', salt, 1000);
    expect(a.authKey).toBe(b.authKey);
    expect((await c.deriveKeys('wrong', salt, 1000)).authKey).not.toBe(a.authKey);

    const recordKey = await c.generateContentKey();
    const env = await c.encryptJSON({ hello: 'jane' }, recordKey);
    const wrapped = await c.wrapKeyWithMaster(recordKey, a.masterKey);
    const k2 = await c.unwrapKeyWithMaster(wrapped, b.masterKey);
    expect(await c.decryptJSON(env, k2)).toEqual({ hello: 'jane' });

    const atty = await c.deriveKeys('attorney pass', c.newKdfSalt(), 1000);
    const id = await c.generateIdentity(atty.masterKey);
    const priv = await c.unwrapPrivateKey(id.wrappedPrivateKey, atty.masterKey);
    const forAtty = await c.wrapKeyForRecipient(recordKey, id.publicKey);
    const k3 = await c.unwrapKeyWithPrivate(forAtty, priv);
    expect(await c.decryptJSON(env, k3)).toEqual({ hello: 'jane' });
    expect(await c.publicKeyFingerprint(id.publicKey)).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){7}$/);

    const blob = await c.encryptBlob(new Uint8Array([1, 2, 3]), recordKey);
    expect(Array.from(await c.decryptBlob(blob, k3))).toEqual([1, 2, 3]);
  });

  it('a new passphrase re-wraps the same account secret: records, private key, slot names and a recovery wrap all still open', async () => {
    // a version-1 account: AS is derived from the old passphrase
    const salt = c.newKdfSalt();
    const old = await c.derivePassphraseKeys('old passphrase words here', salt, 1000);
    const v1 = await c.unlockAccount(old);
    const id = await c.generateIdentity(v1.masterKey);
    const recordKey = await c.generateContentKey();
    const env = await c.encryptJSON({ story: 'hers' }, recordKey);
    const wrapped = await c.wrapKeyWithMaster(recordKey, v1.masterKey);
    const slot = await c.slotName(v1.masterKey, 'draft');
    const as = await c.legacyAccountSecret(old.ikm);
    const { bytes } = c.generateRecoveryCode();
    const rk = await c.deriveRecoveryKeys(bytes);
    const recoveryWrap = await c.wrapAccountSecret(as, rk.kek);

    const next = await c.passphraseMaterialFor(as, 'brand new passphrase words', 1000);
    as.fill(0);
    expect(next.kdfSalt).not.toBe(salt);
    expect(next.authKey).not.toBe(old.authKey);
    // sign in with the new passphrase (version 2)
    const fresh = await c.derivePassphraseKeys('brand new passphrase words', next.kdfSalt, next.kdfIterations);
    expect(fresh.authKey).toBe(next.authKey);
    const v2 = await c.unlockAccount(fresh, next.wrappedAccountKey);
    expect(await c.decryptJSON(env, await c.unwrapKeyWithMaster(wrapped, v2.masterKey))).toEqual({ story: 'hers' });
    expect((await c.unwrapPrivateKey(id.wrappedPrivateKey, v2.masterKey)).type).toBe('private');
    expect(await c.slotName(v2.masterKey, 'draft')).toBe(slot);
    // the old passphrase no longer opens the new wrap
    await expect(c.unlockAccount(old, next.wrappedAccountKey)).rejects.toThrow();
    // the recovery code's wrap (untouched) still gives the same AS
    const viaCode = await c.importAccountSecret(await c.unwrapAccountSecret(recoveryWrap, rk.kek));
    expect(await c.decryptJSON(env, await c.unwrapKeyWithMaster(wrapped, viaCode.masterKey))).toEqual({ story: 'hers' });
    expect(await c.slotName(viaCode.masterKey, 'draft')).toBe(slot);
  });
});
