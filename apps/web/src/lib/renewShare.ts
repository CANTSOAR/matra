/**
 * Renewing a share (Home). While the attorney's copies of the keys are still stored, renewing only moves the end date.
 * Once they were deleted (she revoked, or access ended more than 30 days ago; apps/server/src/recipient-keys.ts), her
 * device wraps the same sealed version and exactly the same files again, to the key she confirmed when she shared:
 * the key must be the one named in her consent statement and, in a build that pins the organization's key, the one the
 * signed directory lists. Otherwise nothing is renewed, and she can share again instead.
 */
import { checkAttorneyKey, wrapKeyForRecipient } from '@matra/crypto';
import type { Share } from '@matra/shared';
import type { ApiClient } from '../api/client';
import { MATCH_PINS, attorneyShareable } from '../matchPins';
import { blobKeyFor, type OpenedRecord } from './vault';

export class RenewError extends Error {
  readonly friendly = true;
  constructor(message: string) {
    super(message);
    this.name = 'RenewError';
  }
}

const KEY_CHANGED =
  'This attorney’s key isn’t the one you confirmed when you shared, so nothing was renewed. You can share your sealed account with them again instead.';

export async function renewShare(api: ApiClient, masterKey: CryptoKey, share: Share, record: OpenedRecord | undefined, expiresInDays: number): Promise<void> {
  if (!share.keyDeleted) {
    await api.renewShare(share.id, { expiresInDays });
    return;
  }
  if (!record || record.meta.id !== share.recordId)
    throw new RenewError('The version this share is of isn’t open on this page, so nothing was renewed. You could try again from Home in a moment, or share again instead.');
  const { attorneys, directory } = await api.listAttorneys();
  const attorney = attorneys.find((a) => a.userId === share.attorneyId);
  if (!attorney)
    throw new RenewError('This attorney isn’t listed as verified right now, so access can’t be renewed. Nothing was changed.');
  const check = checkAttorneyKey(directory, attorney, MATCH_PINS.rosterKey);
  if (!attorneyShareable(check) || !share.consentStatement.includes(check.fingerprint)) throw new RenewError(KEY_CHANGED);
  const blobIds = share.blobIds ?? [];
  const metas = blobIds.length ? new Map((await api.listBlobs()).blobs.map((b) => [b.id, b])) : new Map();
  const blobs = [];
  for (const id of blobIds) {
    const meta = metas.get(id);
    if (!meta) throw new RenewError('One of the files this share covered couldn’t be found, so nothing was renewed. You can share again instead.');
    blobs.push({ blobId: id, recipientWrappedKey: await wrapKeyForRecipient(await blobKeyFor(meta, masterKey), attorney.publicKey) });
  }
  await api.renewShare(share.id, {
    expiresInDays,
    recipientWrappedKey: await wrapKeyForRecipient(record.key, attorney.publicKey),
    blobs,
  });
}
