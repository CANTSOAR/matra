/**
 * The matcher's measurement: what its attestation document says it is running (docs/design/WEEKEND_MVP.md §3.5).
 *
 *   measurement = SHA-256 over, in sorted path order, `path \0 sha256(content) \n` for every file under
 *                 apps/matcher/src (except *.test.ts) and apps/matcher/package.json (paths relative to apps/matcher,
 *                 with forward slashes)
 *
 * `npm run -w @matra/matcher measure` prints it for publication and pinning (MATRA_MATCHER_MEASUREMENT). Changing one
 * character of the matcher's code changes it; tests do not.
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

function listFiles(dir: string, root: string): string[] {
  const out: string[] = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...listFiles(full, root));
    else if (d.isFile() && !d.name.endsWith('.test.ts')) out.push(path.relative(root, full).split(path.sep).join('/'));
  }
  return out;
}

/** The measurement of the matcher build rooted at `root` (default: this package). 64 hex chars. */
export function computeMeasurement(root: string = MATCHER_ROOT): string {
  const files = [...listFiles(path.join(root, 'src'), root), 'package.json'].sort();
  const h = createHash('sha256');
  for (const rel of files) {
    const digest = createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex');
    h.update(`${rel}\0${digest}\n`);
  }
  return h.digest('hex');
}
