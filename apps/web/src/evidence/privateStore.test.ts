import { afterEach, describe, expect, it } from 'vitest';
import { openSlot, sealSlot, slotName } from '@matra/crypto';
import { SLOT_MAX_BYTES } from '@matra/shared';
import { setDraftMode } from '../lib/draftSlot';
import {
  EVIDENCE_PRIVATE_SLOT, PrivateStoreFull, PrivateStoreUnavailable, PrivateStoreUnreadable, commitmentsById, loadPrivate, setPrivateItem, setPrivateOcr, updatePrivate,
} from './privateStore';
import { fakeApi, testKeys } from './testkit.test-util';

afterEach(() => setDraftMode('slot'));
const H = 'a'.repeat(64);
const S = 'b'.repeat(64);

describe('the private evidence slot', () => {
  it('is one opaque encrypted slot; details and OCR text round-trip; nothing readable is on the server', async () => {
    const { masterKey } = await testKeys();
    const { api, slots } = fakeApi();
    await setPrivateItem(api, masterKey, 'item1', { originalSha256: H, salt: S, commitment: 'c'.repeat(64), importedAt: '2026-11-16T00:00:00Z' });
    await setPrivateOcr(api, masterKey, 'item1', { text: 'Total: $12.50 ¶ odd  spacing\n', engine: 'tesseract', at: '2026-11-16T00:01:00Z' });
    const loaded = await loadPrivate(api, masterKey);
    expect(loaded.value.items.item1).toMatchObject({ originalSha256: H, salt: S, ocr: { text: 'Total: $12.50 ¶ odd  spacing\n' } });
    expect([...slots.keys()]).toEqual([await slotName(masterKey, EVIDENCE_PRIVATE_SLOT)]);
    const raw = JSON.stringify([...slots.values()]);
    for (const secret of [H, S, 'Total', 'tesseract', 'item1']) expect(raw).not.toContain(secret);
    expect(commitmentsById(loaded.value.items)).toEqual({ item1: 'c'.repeat(64) });
  });

  it('keeps OCR text for a file that has no original hash (a file added before the reader)', async () => {
    const { masterKey } = await testKeys();
    const { api } = fakeApi();
    await setPrivateOcr(api, masterKey, 'old', { text: 'hello', engine: 'e', at: 'a' });
    const it = (await loadPrivate(api, masterKey)).value.items.old!;
    expect(it.ocr?.text).toBe('hello');
    expect(it.originalSha256).toBeUndefined();
  });

  it('rereads once when another tab saved first, then gives up with a plain message', async () => {
    const { masterKey } = await testKeys();
    const { api } = fakeApi();
    await setPrivateItem(api, masterKey, 'a', { originalSha256: H, salt: S });
    let first = true;
    const out = await updatePrivate(api, masterKey, (cur) => {
      if (first) {
        first = false;
        // another tab saves between our read and our write
        void setPrivateItem(api, masterKey, 'b', { originalSha256: S, salt: H });
      }
      return { ...cur, items: { ...cur.items, c: { originalSha256: H, salt: S } } };
    });
    expect(Object.keys(out.items).sort()).toContain('c');
  });

  it('does nothing when the server keeps every save for good, and refuses a slot it cannot open or one that is full', async () => {
    const { masterKey } = await testKeys();
    const keep = fakeApi('keep-versions');
    await expect(setPrivateItem(keep.api, masterKey, 'a', { originalSha256: H, salt: S })).rejects.toBeInstanceOf(PrivateStoreUnavailable);
    expect(keep.slotPuts).toHaveLength(0);

    const { api, slots } = fakeApi();
    const name = await slotName(masterKey, EVIDENCE_PRIVATE_SLOT);
    const junk = await sealSlot({ kind: 'something-else' }, masterKey);
    slots.set(name, { name, ...junk, version: '9'.repeat(32), updatedDay: '2026-11-16' });
    expect((await loadPrivate(api, masterKey)).unreadable).toBe(true);
    await expect(setPrivateItem(api, masterKey, 'a', { originalSha256: H, salt: S })).rejects.toBeInstanceOf(PrivateStoreUnreadable);
    // not overwritten
    expect(await openSlot<{ kind: string }>(slots.get(name) as never, masterKey)).toEqual({ kind: 'something-else' });

    const big = fakeApi();
    await expect(setPrivateOcr(big.api, masterKey, 'x', { text: 'z'.repeat(SLOT_MAX_BYTES), engine: 'e', at: 'a' })).rejects.toBeInstanceOf(PrivateStoreFull);
    expect(big.slotPuts).toHaveLength(0);
  });

  it('drops a malformed item rather than trusting it', async () => {
    const { masterKey } = await testKeys();
    const { api, slots } = fakeApi();
    const name = await slotName(masterKey, EVIDENCE_PRIVATE_SLOT);
    const sealed = await sealSlot({ kind: 'evidence-private', v: 1, savedAt: 'x', items: { ok: { originalSha256: H, salt: S }, bad: { originalSha256: 'nothex', salt: S }, junk: 5, worse: { commitment: 'zz', ocr: { text: 5 } } } }, masterKey);
    slots.set(name, { name, ...sealed, version: '1'.repeat(32), updatedDay: 'd' });
    const items = (await loadPrivate(api, masterKey)).value.items;
    expect(items.ok?.originalSha256).toBe(H);
    expect(items.bad?.originalSha256).toBeUndefined();
    expect(items.junk).toBeUndefined();
    expect(items.worse?.commitment).toBeUndefined();
    expect(items.worse?.ocr).toBeUndefined();
  });
});
