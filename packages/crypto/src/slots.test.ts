import { describe, expect, it } from 'vitest';
import { SLOT_BUCKET_BYTES, SLOT_NAME_RE } from '@matra/shared';
import * as c from './index';

const ctBytes = (ct: string) => c.fromBase64(ct).length;

describe('draft slots: opaque names', () => {
  it('names are 64 hex, the same across sign-ins and key versions 1 and 2, and differ per label and per account', async () => {
    const salt = c.newKdfSalt();
    const v1 = await c.deriveKeys('slot names passphrase', salt, 1000);
    const again = await c.deriveKeys('slot names passphrase', salt, 1000);
    const draft = await c.slotName(v1.masterKey, 'draft');
    expect(draft).toMatch(SLOT_NAME_RE);
    expect(draft).not.toContain('draft');
    expect(await c.slotName(again.masterKey, 'draft')).toBe(draft);
    expect(await c.slotName(v1.masterKey, 'expenses')).not.toBe(draft);

    // moving to key version 2 wraps the same account secret, so her slots keep their names
    const pk = await c.derivePassphraseKeys('slot names passphrase', salt, 1000);
    const as = await c.legacyAccountSecret(pk.ikm);
    const wrapped = await c.wrapAccountSecret(as, pk.kek);
    const imported = await c.importAccountSecret(as);
    as.fill(0);
    expect(await c.slotName(imported.masterKey, 'draft')).toBe(draft);
    const v2 = await c.deriveKeys('slot names passphrase', salt, 1000, wrapped);
    expect(await c.slotName(v2.masterKey, 'draft')).toBe(draft);

    const other = await c.deriveKeys('slot names passphrase', c.newKdfSalt(), 1000);
    expect(await c.slotName(other.masterKey, 'draft')).not.toBe(draft);
  });

  it('refuses a master key that no unlock path made (never an unkeyed name)', async () => {
    const stray = await c.generateContentKey();
    await expect(c.slotName(stray, 'draft')).rejects.toThrow(/slot-name key/);
  });
});

describe('draft slots: padded envelopes', () => {
  it('ciphertext plus tag fills whole 16 KiB buckets, and the value opens unchanged', async () => {
    const { masterKey } = await c.deriveKeys('slot padding passphrase', c.newKdfSalt(), 1000);
    const small = { kind: 'draft', words: 'hi' };
    const s = await c.sealSlot(small, masterKey);
    expect(ctBytes(s.envelope.ct)).toBe(SLOT_BUCKET_BYTES);
    expect(await c.openSlot(s, masterKey)).toEqual(small);

    // a value that needs a little more than one bucket takes exactly two; one that needs exactly one stays at one
    const big = { kind: 'draft', words: 'x'.repeat(SLOT_BUCKET_BYTES) };
    const b = await c.sealSlot(big, masterKey);
    expect(ctBytes(b.envelope.ct)).toBe(2 * SLOT_BUCKET_BYTES);
    expect(await c.openSlot(b, masterKey)).toEqual(big);
    const exact = c.padSlotPlaintext({ w: 'y'.repeat(SLOT_BUCKET_BYTES - 16 - 8) }); // {"w":"…"} is 8 bytes + the text
    expect(exact.length).toBe(SLOT_BUCKET_BYTES - 16);

    // two drafts of different lengths in the same bucket look the same size
    const a1 = await c.sealSlot({ words: 'a' }, masterKey);
    const a2 = await c.sealSlot({ words: 'a'.repeat(9000) }, masterKey);
    expect(ctBytes(a1.envelope.ct)).toBe(ctBytes(a2.envelope.ct));
  });

  it('a fresh key per write, and another account cannot open it', async () => {
    const mine = await c.deriveKeys('slot owner passphrase', c.newKdfSalt(), 1000);
    const theirs = await c.deriveKeys('someone else entirely', c.newKdfSalt(), 1000);
    const one = await c.sealSlot({ v: 1 }, mine.masterKey);
    const two = await c.sealSlot({ v: 1 }, mine.masterKey);
    expect(one.wrappedKey.data).not.toBe(two.wrappedKey.data);
    await expect(c.openSlot(one, theirs.masterKey)).rejects.toThrow();
  });
});
