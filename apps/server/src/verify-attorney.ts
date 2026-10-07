/**
 * Admin CLI: mark an attorney or a Legal Options Counselor as verified (or unverified).
 * Verified attorneys appear in GET /api/attorneys; verified counselors receive matched sealed-match groups.
 *   npm run -w @matra/server verify-attorney -- <username> [--revoke]
 * Honors MATRA_DB_PATH.
 */
import { openDb } from './db.js';
import { resolveDbPath } from './config.js';

const args = process.argv.slice(2);
const username = args.find((a) => !a.startsWith('--'))?.trim().toLowerCase();
const revoke = args.includes('--revoke');
if (!username) {
  console.error('Usage: npm run -w @matra/server verify-attorney -- <username> [--revoke]');
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
db.close();
if (a.changes + c.changes === 0) {
  console.error(`No attorney or counselor account named "${username}".`);
  process.exit(1);
}
console.log(`${a.changes ? 'Attorney' : 'Counselor'} "${username}" is now ${revoke ? 'UNVERIFIED' : 'VERIFIED'}.`);
