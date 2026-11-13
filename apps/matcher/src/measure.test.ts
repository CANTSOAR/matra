import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeMeasurement, MEASURED, REPO_ROOT } from './measure.js';

/** A throwaway repository with every measured path present. */
function fakeRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matcher-measure-'));
  for (const d of MEASURED.dirs) fs.mkdirSync(path.join(root, d), { recursive: true });
  for (const f of MEASURED.files) fs.writeFileSync(path.join(root, f), `{"name":"${f}"}`);
  fs.mkdirSync(path.join(root, 'apps/matcher/src/sub'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps/matcher/src/matcher.ts'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(root, 'apps/matcher/src/sub/b.ts'), 'export const y = 2;\n');
  fs.writeFileSync(path.join(root, 'packages/crypto/src/attestation.ts'), 'export const open = () => 1;\n');
  fs.writeFileSync(path.join(root, 'packages/shared/src/types.ts'), 'export type T = 1;\n');
  return root;
}

describe('matcher measurement', () => {
  it('changes when a matcher source file changes, not when a test file does', () => {
    const root = fakeRepo();
    try {
      const m0 = computeMeasurement(root);
      expect(m0).toMatch(/^[0-9a-f]{64}$/);
      expect(computeMeasurement(root)).toBe(m0);
      fs.writeFileSync(path.join(root, 'apps/matcher/src/matcher.test.ts'), 'it("x", () => {});\n');
      fs.writeFileSync(path.join(root, 'packages/crypto/src/attestation.test.ts'), 'it("x", () => {});\n');
      expect(computeMeasurement(root)).toBe(m0);
      fs.writeFileSync(path.join(root, 'apps/matcher/src/matcher.ts'), 'export const x = 2;\n');
      const m1 = computeMeasurement(root);
      expect(m1).not.toBe(m0);
      fs.writeFileSync(path.join(root, 'apps/matcher/package.json'), '{"name":"m2"}');
      expect(computeMeasurement(root)).not.toBe(m1);
      // a renamed file changes it too
      fs.renameSync(path.join(root, 'apps/matcher/src/sub/b.ts'), path.join(root, 'apps/matcher/src/sub/c.ts'));
      expect(computeMeasurement(root)).not.toBe(m1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('covers the code the matcher imports: packages/crypto (routing tags, roster), packages/shared and the lockfile', () => {
    const root = fakeRepo();
    try {
      let prev = computeMeasurement(root);
      const changes: Array<[string, string]> = [
        // e.g. an openRouting that also logs the decrypted states
        ['packages/crypto/src/attestation.ts', 'export const open = () => { console.log("states"); return 1; };\n'],
        ['packages/crypto/src/new-file.ts', 'export {};\n'],
        ['packages/shared/src/types.ts', 'export type T = 2;\n'],
        ['packages/crypto/package.json', '{"name":"c2"}'],
        ['package-lock.json', '{"lockfileVersion":3,"tampered":true}'],
      ];
      for (const [rel, content] of changes) {
        fs.writeFileSync(path.join(root, rel), content);
        const next = computeMeasurement(root);
        expect(next, rel).not.toBe(prev);
        prev = next;
      }
      // files outside the measured set (another app, docs) do not change it
      fs.mkdirSync(path.join(root, 'apps/server/src'), { recursive: true });
      fs.writeFileSync(path.join(root, 'apps/server/src/app.ts'), 'export {};\n');
      expect(computeMeasurement(root)).toBe(prev);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('this checkout measures to a stable value', () => {
    expect(computeMeasurement(REPO_ROOT)).toBe(computeMeasurement());
  });
});
