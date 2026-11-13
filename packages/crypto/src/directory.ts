/**
 * Attorney directory, signed offline by the organization (threat model W3). Same pattern as the counselor roster
 * (./matching.ts, review M4), with the SAME organization Ed25519 key (MATRA_COUNSELOR_ROSTER_PUBKEY, pinned in the web
 * build) under a different domain-separation prefix, so a roster signature can never be passed off as a directory
 * signature or the other way round.
 *
 *   signature = Ed25519(orgKey, "matra/attorney-directory/v1|" + payload)
 *   payload   = canonical JSON { v: 1, issuedAt, attorneys: [{ userId, displayName, organization?, fingerprint }] }
 *               sorted by userId; fingerprint = publicKeyFingerprint(attorney's RSA key)
 *
 * Signed when an attorney is verified (verify-attorney / sign-roster, apps/server/src/org-signing.ts). The survivor's
 * client checks the attorney the server lists against it before sharing: the app server alone cannot add an attorney,
 * rename one, or swap an attorney's key for its own (which would let it read what she shares).
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { AttorneyDirectoryPayload, SignedAttorneyDirectory } from '@matra/shared';
import { fromBase64, toBase64, toHex } from './index';

export const ATTORNEY_DIRECTORY_DOMAIN = 'matra/attorney-directory/v1';
const enc = new TextEncoder();

/** publicKeyFingerprint (./index.ts), synchronously: the first 128 bits of SHA-256("kty|n|e"), as 8 groups of 4 hex. */
export function publicKeyFingerprintSync(jwk: JsonWebKey): string {
  return toHex(sha256(enc.encode(`${jwk.kty}|${jwk.n}|${jwk.e}`))).slice(0, 32).toUpperCase().match(/.{4}/g)!.join('-');
}

export interface DirectoryAttorneyInput {
  userId: string;
  displayName: string;
  organization?: string | null;
  publicKey: JsonWebKey;
}

/** Canonical directory JSON: attorneys sorted by userId, fields in fixed order, each key reduced to its fingerprint. */
export function canonicalAttorneyDirectoryPayload(attorneys: DirectoryAttorneyInput[], issuedAt = new Date().toISOString()): string {
  const list = [...attorneys]
    .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0))
    .map((a) => {
      if (a.publicKey.kty !== 'RSA' || !a.publicKey.n || !a.publicKey.e) throw new Error('attorney key must be an RSA public key');
      return {
        userId: a.userId,
        displayName: a.displayName,
        ...(a.organization && { organization: a.organization }),
        status: 'verified' as const,
        fingerprint: publicKeyFingerprintSync(a.publicKey),
      };
    });
  const payload: AttorneyDirectoryPayload = { v: 1, issuedAt, attorneys: list };
  return JSON.stringify(payload);
}

/** Organization (offline, CLI): sign the verified attorneys with the org's Ed25519 secret key (32 bytes). */
export function signAttorneyDirectory(attorneys: DirectoryAttorneyInput[], orgSecretKey: Uint8Array, issuedAt?: string): SignedAttorneyDirectory {
  const payload = canonicalAttorneyDirectoryPayload(attorneys, issuedAt);
  return { payload, signature: toBase64(ed25519.sign(enc.encode(`${ATTORNEY_DIRECTORY_DOMAIN}|${payload}`), orgSecretKey)) };
}

/** Verify a signed directory against the pinned org public key. The payload, or null if anything is off. */
export function verifyAttorneyDirectory(signed: SignedAttorneyDirectory | undefined, orgPublicKey: Uint8Array): AttorneyDirectoryPayload | null {
  if (!signed || typeof signed.payload !== 'string' || typeof signed.signature !== 'string') return null;
  try {
    const sig = fromBase64(signed.signature);
    if (sig.length !== 64 || !ed25519.verify(sig, enc.encode(`${ATTORNEY_DIRECTORY_DOMAIN}|${signed.payload}`), orgPublicKey)) return null;
    const p = JSON.parse(signed.payload) as AttorneyDirectoryPayload;
    if (p.v !== 1 || !Array.isArray(p.attorneys)) return null;
    return p;
  } catch {
    return null;
  }
}

export type AttorneyKeyCheck =
  /** the org-signed directory lists this attorney, verified, with exactly this key */
  | { status: 'verified'; displayName: string; organization?: string; fingerprint: string }
  /** listed, but the server sent a different key: never share */
  | { status: 'key_mismatch'; displayName: string; fingerprint: string }
  /** not in the signed directory (not signed yet, or removed) */
  | { status: 'not_listed'; fingerprint: string }
  /** the directory is missing or its signature does not verify under the pinned key */
  | { status: 'unsigned'; fingerprint: string }
  /** this build pins no organization key (development): nothing to check against */
  | { status: 'unpinned'; fingerprint: string };

/**
 * Check the attorney (and key) the server offers against the org-signed directory. With a pinned key only 'verified'
 * may be shared with; without one (development builds) the result is 'unpinned' and the UI says so.
 */
export function checkAttorneyKey(
  directory: SignedAttorneyDirectory | undefined,
  attorney: { userId: string; publicKey: JsonWebKey },
  pinnedOrgKey?: string,
): AttorneyKeyCheck {
  const fingerprint = publicKeyFingerprintSync(attorney.publicKey);
  if (!pinnedOrgKey) return { status: 'unpinned', fingerprint };
  let key: Uint8Array;
  try {
    key = fromBase64(pinnedOrgKey);
  } catch {
    return { status: 'unsigned', fingerprint };
  }
  const d = verifyAttorneyDirectory(directory, key);
  if (!d) return { status: 'unsigned', fingerprint };
  const listed = d.attorneys.find((a) => a.userId === attorney.userId);
  if (!listed || listed.status !== 'verified') return { status: 'not_listed', fingerprint };
  if (listed.fingerprint !== fingerprint) return { status: 'key_mismatch', displayName: listed.displayName, fingerprint };
  return { status: 'verified', displayName: listed.displayName, ...(listed.organization && { organization: listed.organization }), fingerprint };
}
