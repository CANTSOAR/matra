/**
 * Admin CLI: mark an attorney or a Legal Options Counselor as verified (or unverified).
 * Verified attorneys appear in GET /api/attorneys; verified counselors receive matched sealed-match groups.
 *   npm run -w @matra/server verify-attorney -- <username> [--revoke]
 * With the organization's signing key for this invocation (MATRA_COUNSELOR_ROSTER_SIGNING_KEY or _FILE, as for
 * sign-roster), it also re-signs the counselor roster and the attorney directory, so survivors' apps (which check the
 * attorney's key against the signed directory: W3) show the change at once. Without the key it says to run
 * sign-roster: until then a newly verified attorney shows as "can't confirm" in pinned builds, and a revoked one is
 * still in the signed directory but no longer listed or shareable (the server checks the flag). Honors MATRA_DB_PATH.
 */
import fs from 'node:fs';
import { rosterPublicKey, toBase64 } from '@matra/crypto';
import { openDb } from './db.js';
import { resolveDbPath } from './config.js';
import { orgSigningKeyFromEnv, signOrgLists, storeOrgLists } from './org-signing.js';

const args = process.argv.slice(2);
const username = args.find((a) => !a.startsWith('--'))?.trim().toLowerCase();
const revoke = args.includes('--revoke');
if (!username) {
  console.error('Usage: npm run -w @matra/server verify-attorney -- <username> [--revoke]');
  process.exit(1);
}
let orgKey: Uint8Array | undefined;
try {
  orgKey = orgSigningKeyFromEnv(process.env, (p) => fs.readFileSync(p, 'utf8'));
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
if (orgKey && process.env.MATRA_COUNSELOR_ROSTER_PUBKEY && toBase64(rosterPublicKey(orgKey)) !== process.env.MATRA_COUNSELOR_ROSTER_PUBKEY) {
  console.error('This signing key is not the one pinned as MATRA_COUNSELOR_ROSTER_PUBKEY. Refusing.');
  process.exit(1);
}
const db = openDb(resolveDbPath());
const v = revoke ? 0 : 1;
const a = db
  .prepare(`UPDATE attorney_profiles SET verified = ? WHERE user_id = (SELECT id FROM users WHERE username = ? AND role = 'attorney')`)
  .run(v, username);
const c = db
  .prepare(`UPDATE counselor_profiles SET verified = ? WHERE user_id = (SELECT id FROM users WHERE username = ? AND role = 'counselor')`)
  .run(v, username);
if (a.changes + c.changes === 0) {
  db.close();
  console.error(`No attorney or counselor account named "${username}".`);
  process.exit(1);
}
console.log(`${a.changes ? 'Attorney' : 'Counselor'} "${username}" is now ${revoke ? 'UNVERIFIED' : 'VERIFIED'}.`);
if (orgKey) {
  const lists = signOrgLists(db, orgKey);
  orgKey.fill(0);
  storeOrgLists(db, lists);
  console.log(`Re-signed the counselor roster (${lists.counselors.length}) and attorney directory (${lists.attorneys.length}).`);
} else {
  console.log('Now re-sign the lists with the organization key: npm run -w @matra/server sign-roster');
}
db.close();
