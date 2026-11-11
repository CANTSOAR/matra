import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeMeasurement, MATCHER_ROOT } from './measure.js';

describe('matcher measurement', () => {
  it('changes when a source file changes, not when a test file does', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matcher-measure-'));
    try {
      fs.mkdirSync(path.join(root, 'src', 'sub'), { recursive: true });
      fs.writeFileSync(path.join(root, 'package.json'), '{"name":"m"}');
      fs.writeFileSync(path.join(root, 'src', 'matcher.ts'), 'export const x = 1;\n');
      fs.writeFileSync(path.join(root, 'src', 'sub', 'b.ts'), 'export const y = 2;\n');
      const m0 = computeMeasurement(root);
      expect(m0).toMatch(/^[0-9a-f]{64}$/);
      expect(computeMeasurement(root)).toBe(m0);
      fs.writeFileSync(path.join(root, 'src', 'matcher.test.ts'), 'it("x", () => {});\n');
      expect(computeMeasurement(root)).toBe(m0);
      fs.writeFileSync(path.join(root, 'src', 'matcher.ts'), 'export const x = 2;\n');
      const m1 = computeMeasurement(root);
      expect(m1).not.toBe(m0);
      fs.writeFileSync(path.join(root, 'package.json'), '{"name":"m2"}');
      expect(computeMeasurement(root)).not.toBe(m1);
      // a renamed file changes it too
      fs.renameSync(path.join(root, 'src', 'sub', 'b.ts'), path.join(root, 'src', 'sub', 'c.ts'));
      expect(computeMeasurement(root)).not.toBe(m1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('this package measures to a stable value', () => {
    expect(computeMeasurement(MATCHER_ROOT)).toBe(computeMeasurement());
  });
});
