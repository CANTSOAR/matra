import { describe, expect, it } from 'vitest';
import * as c from './index';

describe('@shield/crypto', () => {
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

  it('normalizes escrow identifiers so equivalent inputs match', async () => {
    expect(await c.escrowIdentifierHash('email', ' John.Doe+x@GMAIL.com')).toBe(await c.escrowIdentifierHash('email', 'johndoe@gmail.com'));
    expect(await c.escrowIdentifierHash('phone', '(201) 555-0100')).toBe(await c.escrowIdentifierHash('phone', '+1 201 555 0100'));
    expect(await c.escrowIdentifierHash('social_handle', '@Bad_Guy', 'Instagram')).toBe(await c.escrowIdentifierHash('social_handle', 'bad_guy', 'instagram'));
    expect(await c.escrowIdentifierHash('social_handle', 'bad_guy', 'tiktok')).not.toBe(await c.escrowIdentifierHash('social_handle', 'bad_guy', 'instagram'));
  });
});
