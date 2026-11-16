import { describe, expect, it } from 'vitest';
import type { IntakeRecord } from '@matra/shared';
import type { MatchingApiClient } from '../api/matching';
import { draftToRecord, emptyDraft } from '../intake';
import { MatchingError, PHONE_VERIFICATION_NEEDED, hasUnsealedMatches, lodgeEscrow } from './matching';

// Moved from lib/vault.test.ts with the code (lib/matching.ts). These run whatever the build's MATRA_MATCHING is: the
// module itself is only reachable from a build with sealed matching.
describe('lodgeEscrow: phone verify-then-forget gate (W13)', () => {
  // A record that opted one person's email into a sealed match, with a safe way to reach her.
  const record = {
    ...draftToRecord(emptyDraft(new Date('2026-01-01T00:00:00Z'))),
    perpetrators: [{ name: 'R.', escrowOptIn: true, identifiers: [{ kind: 'email', value: 'someone@example.com' }] }],
  } as unknown as IntakeRecord;
  const contact = { method: 'text', detail: '(201) 555-0100' };
  const api = (status: { required: boolean; verified: boolean }) => {
    const calls: string[] = [];
    const fake = {
      phoneVerificationStatus: async () => (calls.push('status'), status),
      matchingConfig: async () => {
        calls.push('config');
        throw new Error('stop here');
      },
    } as unknown as MatchingApiClient;
    return { fake, calls };
  };

  it('asks for a phone confirmation before contacting any key holder, and seals nothing', async () => {
    const { fake, calls } = api({ required: true, verified: false });
    const err = await lodgeEscrow(fake, {} as CryptoKey, record, [], { contact }).catch((e) => e);
    expect(err).toBeInstanceOf(MatchingError);
    expect(err.code).toBe('phone_verification_required');
    expect(err.message).toBe(PHONE_VERIFICATION_NEEDED);
    expect(calls).toEqual(['status']);
  });

  it('goes on to seal once verified (or when the server does not require it)', async () => {
    for (const st of [{ required: true, verified: true }, { required: false, verified: false }]) {
      const { fake, calls } = api(st);
      await expect(lodgeEscrow(fake, {} as CryptoKey, record, [], { contact })).rejects.toThrow('stop here');
      expect(calls).toEqual(['status', 'config']);
    }
  });

  it('knows when her sealed record still has something to seal', async () => {
    expect(await hasUnsealedMatches(record)).toBe(true);
    expect(await hasUnsealedMatches(undefined)).toBe(false);
    const { fake } = api({ required: false, verified: false });
    expect(await lodgeEscrow(fake, {} as CryptoKey, { ...record, perpetrators: [] }, ['x'])).toEqual(['x']);
  });
});
