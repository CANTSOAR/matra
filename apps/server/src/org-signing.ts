/**
 * The organization's offline signatures over who is verified (used by the sign-roster and verify-attorney CLIs and by
 * the demo seed). One org Ed25519 key, pinned in the web build as MATRA_COUNSELOR_ROSTER_PUBKEY, signs two lists under
 * different domain prefixes (packages/crypto):
 *   - the counselor roster (review M4): counselors' RSA keys and licensed states  → matching_meta 'counselor_roster'
 *   - the attorney directory (W3): attorneys' names and key fingerprints           → matching_meta 'attorney_directory'
 * The secret key is given only to the CLI invocation by the person who verifies people; it is never stored on the
 * server. Survivors' clients check both lists against the pinned key, so the app server alone cannot add a counselor
 * or attorney, rename one, or swap a key for its own.
 */
import { publicKeyFingerprintSync, signAttorneyDirectory, signCounselorRoster, type DirectoryAttorneyInput } from '@matra/crypto';
import type { SignedAttorneyDirectory, SignedCounselorRoster } from '@matra/shared';
import type { DB } from './db.js';

export interface OrgLists {
  roster: SignedCounselorRoster;
  directory: SignedAttorneyDirectory;
  counselors: Array<{ userId: string; displayName: string; organization: string | null; licensedStates: string[] }>;
  attorneys: Array<{ userId: string; displayName: string; organization: string | null; fingerprint: string }>;
}

/** Sign the currently verified counselors and attorneys (does not store anything). */
export function signOrgLists(db: DB, orgSecretKey: Uint8Array, issuedAt?: string): OrgLists {
  const counselorRows = db
    .prepare(
      `SELECT c.user_id, c.display_name, c.organization, c.jurisdictions, u.public_key FROM counselor_profiles c JOIN users u ON u.id = c.user_id
        WHERE c.verified = 1 ORDER BY c.display_name`,
    )
    .all() as Array<{ user_id: string; display_name: string; organization: string | null; jurisdictions: string; public_key: string }>;
  const attorneyRows = db
    .prepare(
      `SELECT a.user_id, a.display_name, a.organization, u.public_key FROM attorney_profiles a JOIN users u ON u.id = a.user_id
        WHERE a.verified = 1 AND u.role = 'attorney' ORDER BY a.display_name`,
    )
    .all() as Array<{ user_id: string; display_name: string; organization: string | null; public_key: string }>;
  // Roster v2: each counselor's licensed states (counselor_profiles.jurisdictions), which the matcher routes groups by.
  // Check them against her license before signing: the signature is what makes them authoritative.
  const roster = signCounselorRoster(
    counselorRows.map((r) => ({ userId: r.user_id, publicKey: JSON.parse(r.public_key) as JsonWebKey, licensedStates: JSON.parse(r.jurisdictions) as string[] })),
    orgSecretKey,
    issuedAt,
  );
  // The directory: the name and organization shown to survivors and the fingerprint of the key she will lock her file
  // to. Check the bar admission (W7) before signing: the signature is what makes "Verified by Matra" true.
  const attorneys: DirectoryAttorneyInput[] = attorneyRows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    organization: r.organization,
    publicKey: JSON.parse(r.public_key) as JsonWebKey,
  }));
  const directory = signAttorneyDirectory(attorneys, orgSecretKey, issuedAt);
  return {
    roster,
    directory,
    counselors: counselorRows.map((r) => ({ userId: r.user_id, displayName: r.display_name, organization: r.organization, licensedStates: JSON.parse(r.jurisdictions) })),
    attorneys: attorneys.map((a) => ({ userId: a.userId, displayName: a.displayName, organization: a.organization ?? null, fingerprint: publicKeyFingerprintSync(a.publicKey) })),
  };
}

/** Store both signed lists where /api/matching/config and /api/attorneys serve them. */
export function storeOrgLists(db: DB, lists: Pick<OrgLists, 'roster' | 'directory'>): void {
  const put = db.prepare(`INSERT INTO matching_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
  db.transaction(() => {
    put.run('counselor_roster', JSON.stringify(lists.roster));
    put.run('attorney_directory', JSON.stringify(lists.directory));
  })();
}

/** The org secret key from MATRA_COUNSELOR_ROSTER_SIGNING_KEY or _FILE (64 hex chars), or undefined if neither is set. */
export function orgSigningKeyFromEnv(env: NodeJS.ProcessEnv, readFile: (p: string) => string): Uint8Array | undefined {
  const hex = env.MATRA_COUNSELOR_ROSTER_SIGNING_KEY ?? (env.MATRA_COUNSELOR_ROSTER_SIGNING_KEY_FILE ? readFile(env.MATRA_COUNSELOR_ROSTER_SIGNING_KEY_FILE) : undefined);
  if (hex === undefined) return undefined;
  if (!/^[0-9a-fA-F]{64}$/.test(hex.trim())) throw new Error('MATRA_COUNSELOR_ROSTER_SIGNING_KEY must be 64 hex chars (generate one with sign-roster --generate).');
  return Uint8Array.from(hex.trim().toLowerCase().match(/../g)!.map((b) => parseInt(b, 16)));
}
