/**
 * Admin CLI: mark an attorney as verified (or unverified) so they appear in GET /api/attorneys.
 *   npm run -w @shield/server verify-attorney -- <username> [--revoke]
 * Honors MATRA_DB_PATH.
 */
import { openDb } from './db.js';
import { resolveDbPath } from './config.js';

const args = process.argv.slice(2);
const username = args.find((a) => !a.startsWith('--'))?.trim().toLowerCase();
const revoke = args.includes('--revoke');
if (!username) {
  console.error('Usage: npm run -w @shield/server verify-attorney -- <username> [--revoke]');
  process.exit(1);
}
const db = openDb(resolveDbPath());
const r = db
  .prepare(
    `UPDATE attorney_profiles SET verified = ?
      WHERE user_id = (SELECT id FROM users WHERE username = ? AND role = 'attorney')`,
  )
  .run(revoke ? 0 : 1, username);
db.close();
if (r.changes === 0) {
  console.error(`No attorney account named "${username}".`);
  process.exit(1);
}
console.log(`Attorney "${username}" is now ${revoke ? 'UNVERIFIED' : 'VERIFIED'}.`);
