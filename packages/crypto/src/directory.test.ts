import { describe, expect, it } from 'vitest';
import * as c from './index';

async function keys(n: number) {
  const mk = (await c.deriveKeys('p', c.newKdfSalt(), 1000)).masterKey;
  return Promise.all(Array.from({ length: n }, () => c.generateIdentity(mk).then((k) => k.publicKey)));
}

describe('attorney directory (W3)', () => {
  it('the synchronous fingerprint is publicKeyFingerprint', async () => {
    const [k] = await keys(1);
    expect(c.publicKeyFingerprintSync(k!)).toBe(await c.publicKeyFingerprint(k!));
  });

  it('a listed attorney with the listed key is verified, with the signed name', async () => {
    const org = c.generateRosterKey();
    const pin = c.toBase64(org.publicKey);
    const [k1, k2] = await keys(2);
    const dir = c.signAttorneyDirectory(
      [
        { userId: 'a2', displayName: 'Jordan Okafor, Esq.', publicKey: k2! },
        { userId: 'a1', displayName: 'Alex Rivera, Esq.', organization: 'Clinic', publicKey: k1! },
      ],
      org.secretKey,
    );
    expect(c.verifyAttorneyDirectory(dir, org.publicKey)!.attorneys.map((a) => a.userId)).toEqual(['a1', 'a2']); // canonical order
    expect(c.checkAttorneyKey(dir, { userId: 'a1', publicKey: k1! }, pin)).toEqual({
      status: 'verified',
      displayName: 'Alex Rivera, Esq.',
      organization: 'Clinic',
      fingerprint: await c.publicKeyFingerprint(k1!),
    });
  });

  it('a swapped key, an unlisted attorney, a forged or unsigned entry, another key, and a roster signature are all refused', async () => {
    const org = c.generateRosterKey();
    const pin = c.toBase64(org.publicKey);
    const [k1, k2, evil] = await keys(3);
    const dir = c.signAttorneyDirectory([{ userId: 'a1', displayName: 'Alex', publicKey: k1! }], org.secretKey);

    // the server swaps the key for one it holds
    expect(c.checkAttorneyKey(dir, { userId: 'a1', publicKey: evil! }, pin).status).toBe('key_mismatch');
    // an attorney the organization never signed
    expect(c.checkAttorneyKey(dir, { userId: 'a2', publicKey: k2! }, pin).status).toBe('not_listed');
    // the server edits the signed list: add its own key under a1 / add an unsigned entry
    const p = JSON.parse(dir.payload) as { attorneys: Array<Record<string, string>> };
    const swapped = { ...dir, payload: JSON.stringify({ ...p, attorneys: [{ ...p.attorneys[0], fingerprint: c.publicKeyFingerprintSync(evil!) }] }) };
    expect(c.checkAttorneyKey(swapped, { userId: 'a1', publicKey: evil! }, pin).status).toBe('unsigned');
    const added = { ...dir, payload: JSON.stringify({ ...p, attorneys: [...p.attorneys, { userId: 'a2', displayName: 'X', status: 'verified', fingerprint: c.publicKeyFingerprintSync(k2!) }] }) };
    expect(c.checkAttorneyKey(added, { userId: 'a2', publicKey: k2! }, pin).status).toBe('unsigned');
    // no directory, a garbage signature, or signed by some other key
    expect(c.checkAttorneyKey(undefined, { userId: 'a1', publicKey: k1! }, pin).status).toBe('unsigned');
    expect(c.checkAttorneyKey({ ...dir, signature: 'AAAA' }, { userId: 'a1', publicKey: k1! }, pin).status).toBe('unsigned');
    expect(c.checkAttorneyKey(dir, { userId: 'a1', publicKey: k1! }, c.toBase64(c.generateRosterKey().publicKey)).status).toBe('unsigned');
    // domain separation: the org's counselor-roster signature over the same bytes is not a directory signature
    const roster = c.signCounselorRoster([{ userId: 'a1', publicKey: k1! }], org.secretKey);
    expect(c.verifyAttorneyDirectory({ payload: roster.payload, signature: roster.signature }, org.publicKey)).toBeNull();
    // a development build with no pinned key: nothing to check against, and it says so
    expect(c.checkAttorneyKey(dir, { userId: 'a1', publicKey: evil! }).status).toBe('unpinned');
  });
});
