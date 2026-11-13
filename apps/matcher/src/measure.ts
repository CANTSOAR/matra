/**
 * The matcher's measurement: what its attestation document says it is running (docs/design/WEEKEND_MVP.md §3.5).
 *
 *   measurement = SHA-256 over, in sorted path order, `path \0 sha256(content) \n` for every file in MEASURED
 *                 (paths relative to the repository root, with forward slashes; *.test.ts excluded)
 *
 * MEASURED is every source file the matcher process loads from this repository: the matcher itself, and the two
 * workspace packages it imports (packages/crypto opens the routing tags and verifies the roster; packages/shared holds
 * the types), with their package.json files, plus the root package-lock.json, which pins the version and integrity hash
 * of every third-party dependency (@noble/curves, express, better-sqlite3, tsx …). Changing one character in any of
 * those files changes the measurement; tests do not.
 *
 * NOT measured: node_modules itself (the lockfile pins what npm installs, but the installed files are not hashed), the
 * Node.js runtime and the OS image. A real enclave measures the whole image (below), which covers them.
 *
 * `npm run -w @matra/matcher measure` prints it for publication and pinning (MATRA_MATCHER_MEASUREMENT).
 *
 * SIMULATED: the running process hashes its own files, so a modified process could simply report the published value.
 * In a real enclave the measurement is taken by the platform before the code runs (AWS Nitro PCR0 over the enclave
 * image; GCP Confidential Space: the container image digest), from a reproducible build of these same files.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** apps/matcher */
export const MATCHER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** the repository root (apps/matcher/../..) */
export const REPO_ROOT = path.resolve(MATCHER_ROOT, '..', '..');

/** What the measurement covers, relative to the repository root: directories (recursively, minus tests) and files. */
export const MEASURED = {
  dirs: ['apps/matcher/src', 'packages/crypto/src', 'packages/shared/src'],
  files: ['apps/matcher/package.json', 'packages/crypto/package.json', 'packages/shared/package.json', 'package-lock.json'],
} as const;

function listFiles(dir: string, root: string): string[] {
  const out: string[] = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...listFiles(full, root));
    else if (d.isFile() && !d.name.endsWith('.test.ts')) out.push(path.relative(root, full).split(path.sep).join('/'));
  }
  return out;
}

/** The measurement of the matcher build in the repository rooted at `root` (default: this checkout). 64 hex chars. */
export function computeMeasurement(root: string = REPO_ROOT): string {
  const files = [...MEASURED.dirs.flatMap((d) => listFiles(path.join(root, d), root)), ...MEASURED.files].sort();
  const h = createHash('sha256');
  for (const rel of files) {
    const digest = createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex');
    h.update(`${rel}\0${digest}\n`);
  }
  return h.digest('hex');
}
