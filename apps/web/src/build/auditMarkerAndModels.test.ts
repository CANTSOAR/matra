// @vitest-environment node
/**
 * Two more checks of scripts/audit-web-build.mjs:
 *   - the span-marker (src/ml/marker) is left out of a MATRA_MARKER=off build, which is the default: a real `vite build`,
 *     audited, with the marker's strings absent from every shipped file; and the check does fail when one is put back;
 *   - dist/models holds exactly the files pinned in src/ml/manifest.json, byte for byte.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import manifest from '../ml/manifest.json';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = path.resolve(WEB, '..', '..');
const VITE = path.resolve(ROOT, 'node_modules', '.bin', 'vite');
const AUDIT = path.resolve(ROOT, 'scripts', 'audit-web-build.mjs');

function cleanEnv(extra: Record<string, string>) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && !/^MATRA_(MATCHING|MARKER|DATES_FOUND|DEMO_MODE|VOICE_HARNESS|ATTESTATION_PLATFORM_PUBKEY|MATCHER_MEASUREMENT|COUNSELOR_ROSTER_PUBKEY|OPRF_\w+)$/.test(k)) env[k] = v;
  return { ...env, ...extra };
}
const audit = (dist: string) => spawnSync(process.execPath, [AUDIT, dist], { env: cleanEnv({}), encoding: 'utf8' });
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

describe('build audit: the span-marker is left out of a default build', () => {
  it('a production build says marker=off, ships none of the marker strings, passes the audit, and fails it if one is added', () => {
    const out = path.join(WEB, 'node_modules', '.audit-marker-off');
    const r = spawnSync(VITE, ['build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], {
      cwd: WEB,
      env: cleanEnv({ NODE_ENV: 'production', MATRA_MATCHING: 'off', MATRA_COUNSELOR_ROSTER_PUBKEY: Buffer.alloc(32, 7).toString('base64') }),
      encoding: 'utf8',
      timeout: 180_000,
    });
    if (r.status !== 0) throw new Error(`vite build failed: ${r.stderr}${r.stdout}`);
    expect(JSON.parse(fs.readFileSync(path.join(out, 'matra-marker.json'), 'utf8'))).toEqual({ marker: 'off' });
    expect(JSON.parse(fs.readFileSync(path.join(out, 'matra-build.json'), 'utf8'))).toEqual({ matching: 'off' });
    for (const f of walk(out).filter((x) => /\.(js|mjs|html|css|json)$/.test(x)))
      for (const s of ['understand-rules', 'not-exact-substring', 'sensitive-group', 'reported-speech']) expect(fs.readFileSync(f, 'utf8'), `${f} ${s}`).not.toContain(s);
    const ok = audit(out);
    expect(ok.stderr).toBe('');
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/no span-marker code \(MATRA_MARKER=off\)/);

    // The CPU ONNX Runtime glue is code the browser cannot check at run time, so it is built into the app as the pinned
    // bytes, and the worker points ORT at that hashed asset, never at a /models/ file a host could swap.
    const pin = manifest.runtime.bundled[0];
    const glue = walk(out).filter((f) => path.relative(out, f).startsWith('assets/') && createHash('sha256').update(fs.readFileSync(f)).digest('hex') === pin.sha256);
    expect(glue).toHaveLength(1);
    const glueName = path.basename(glue[0]);
    const worker = walk(out).filter((f) => /assets\/worker-.*\.js$/.test(f));
    expect(worker.length).toBeGreaterThan(0);
    for (const w of worker) {
      const code = fs.readFileSync(w, 'utf8');
      expect(code).toContain(`/assets/${glueName}`);
      expect(code).not.toContain('/models/ort/ort-wasm-simd-threaded.mjs');
    }
    // licence texts and the attribution notice ship with the app, and the audit fails without them
    for (const f of ['NOTICE.txt', 'Apache-2.0.txt', 'MIT-onnxruntime-web.txt', 'BSD-2-Clause-Leptonica.txt']) expect(fs.existsSync(path.join(out, 'licenses', f)), f).toBe(true);
    const notice = fs.readFileSync(path.join(out, 'licenses/NOTICE.txt'), 'utf8');
    for (const name of ['EFF Short Wordlist', 'onnxruntime-web', 'Transformers.js', 'onnx-community/whisper-base', 'tesseract.js 7.0.0', 'tesseract.js-core 7.0.0', 'tessdata_best, English', 'Leptonica']) expect(notice).toContain(name);
    expect(notice).toBe(fs.readFileSync(path.join(ROOT, 'NOTICE'), 'utf8'));
    fs.rmSync(path.join(out, 'licenses/Apache-2.0.txt'));
    expect(audit(out).stderr).toMatch(/licenses\/Apache-2\.0\.txt: missing from the build/);
    fs.copyFileSync(path.join(WEB, 'public/licenses/Apache-2.0.txt'), path.join(out, 'licenses/Apache-2.0.txt'));
    expect(audit(out).status).toBe(0);
    // The OCR engine's code (tesseract.js worker script and wasm core) is built in as the pinned bytes too, and is never in
    // /models/ (only the language data is). A tampered built-in copy fails the audit.
    const ocr = manifest.models.find((m) => m.id === 'tesseract/eng-best-int')!;
    for (const b of ocr.bundled!) {
      const hit = walk(out).filter((f) => path.relative(out, f).startsWith('assets/') && createHash('sha256').update(fs.readFileSync(f)).digest('hex') === b.sha256);
      expect(hit, b.path).toHaveLength(1);
      const orig = fs.readFileSync(hit[0]!);
      fs.appendFileSync(hit[0]!, '\n// swapped');
      expect(audit(out).stderr, b.path).toMatch(new RegExp(`no file equal to the pinned ${b.package.replace('.', '\\.')}/`));
      fs.writeFileSync(hit[0]!, orig);
    }
    expect(audit(out).status).toBe(0);
    // none of the dates-found strings is in a default build
    expect(ok.stdout).toMatch(/no dates-found code \(MATRA_DATES_FOUND=off\)/);
    for (const f of walk(out).filter((x) => /\.(js|mjs|html|css|json)$/.test(x)))
      for (const sx of ['Dates found in your files', 'text-in-image', 'file-metadata']) expect(fs.readFileSync(f, 'utf8'), `${f} ${sx}`).not.toContain(sx);
    expect(JSON.parse(fs.readFileSync(path.join(out, 'matra-dates.json'), 'utf8'))).toEqual({ datesFound: 'off' });

    // a swapped /models/ glue is a build failure, and so is a tampered built-in copy
    fs.mkdirSync(path.join(out, 'models/ort'), { recursive: true });
    fs.writeFileSync(path.join(out, 'models/ort/ort-wasm-simd-threaded.mjs'), 'swapped');
    expect(audit(out).stderr).toMatch(/must be built into the app, not served from \/models\//);
    fs.rmSync(path.join(out, 'models'), { recursive: true });
    const original = fs.readFileSync(glue[0]);
    fs.appendFileSync(glue[0], '\n// swapped');
    expect(audit(out).stderr).toMatch(/no file equal to the pinned ort-wasm-simd-threaded\.mjs/);
    fs.writeFileSync(glue[0], original);
    expect(audit(out).status).toBe(0);

    const js = walk(out).find((f) => f.endsWith('.js'))!;
    fs.appendFileSync(js, '\n;var x="understand-rules";\n');
    const bad = audit(out);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/but this is a MATRA_MARKER=off build/);
    fs.rmSync(out, { recursive: true, force: true });
  }, 300_000);
});

describe('build audit: licence-text hosts are allowed only inside licenses/*.txt', () => {
  function dist(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'matra-hosts-'));
    fs.writeFileSync(path.join(d, 'index.html'), '<!doctype html><html><head></head></html>');
    fs.writeFileSync(path.join(d, 'matra-build.json'), '{"matching":"off"}');
    fs.mkdirSync(path.join(d, 'licenses'));
    fs.mkdirSync(path.join(d, 'assets'));
    return d;
  }
  it('passes in licenses/*.txt, fails in a script, a stylesheet or a json file, and the two hosts are not in the global allowlist', () => {
    const d = dist();
    try {
      for (const host of ['www.apache.org', 'www.eff.org']) {
        fs.writeFileSync(path.join(d, 'licenses', 'X.txt'), `see http://${host}/licenses/ for the terms`);
        expect(audit(d).status, `${host} in licenses/X.txt`).toBe(0);
        fs.rmSync(path.join(d, 'licenses', 'X.txt'));
        for (const [name, body] of [
          ['assets/app.js', `fetch("https://${host}/x")`],
          ['assets/app.css', `@import url("https://${host}/x.css");`],
          ['assets/data.json', `{"u":"https://${host}/x"}`],
          ['licenses/not-a-licence.js', `var u="https://${host}/x"`],
          ['index.txt', `https://${host}/x`],
        ] as const) {
          fs.writeFileSync(path.join(d, name), body);
          const r = audit(d);
          expect(r.status, `${host} in ${name}`).toBe(1);
          expect(r.stderr, `${host} in ${name}`).toMatch(new RegExp(`unexpected host ${host.replace(/\./g, '\\.')}`));
          fs.rmSync(path.join(d, name));
        }
      }
      expect(fs.readFileSync(AUDIT, 'utf8').match(/const ALLOWED_HOSTS = \{[\s\S]*?\n\};/)![0]).not.toMatch(/www\.apache\.org|www\.eff\.org/);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });
});

describe('build audit: "dates found in your files" is only in a build that asks for it', () => {
  it('MATRA_DATES_FOUND=on puts it in the build, and the audit then skips its absence check', () => {
    const out = path.join(WEB, 'node_modules', '.audit-dates-on');
    const r = spawnSync(VITE, ['build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], {
      cwd: WEB,
      env: cleanEnv({ NODE_ENV: 'production', MATRA_MATCHING: 'off', MATRA_DATES_FOUND: 'on', MATRA_COUNSELOR_ROSTER_PUBKEY: Buffer.alloc(32, 7).toString('base64') }),
      encoding: 'utf8',
      timeout: 180_000,
    });
    if (r.status !== 0) throw new Error(`vite build failed: ${r.stderr}${r.stdout}`);
    expect(JSON.parse(fs.readFileSync(path.join(out, 'matra-dates.json'), 'utf8'))).toEqual({ datesFound: 'on' });
    const all = walk(out).filter((x) => /\.js$/.test(x)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    expect(all).toContain('Dates found in your files');
    const a = audit(out);
    expect(a.status).toBe(0);
    expect(a.stdout).toMatch(/MATRA_DATES_FOUND=on: check skipped/);
    fs.rmSync(out, { recursive: true, force: true });
  }, 300_000);
  it('a bad value stops the build', () => {
    const r = spawnSync(VITE, ['build', '--outDir', path.join(WEB, 'node_modules', '.audit-dates-bad'), '--logLevel', 'error'], { cwd: WEB, env: cleanEnv({ NODE_ENV: 'production', MATRA_DATES_FOUND: 'maybe' }), encoding: 'utf8', timeout: 60_000 });
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/MATRA_DATES_FOUND must be "off" or "on"/);
  }, 120_000);
});

describe('build audit: dist/models is exactly the pinned files', () => {
  const m = manifest.models[0];
  const f0 = m.files[0];
  function dist(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'matra-models-'));
    fs.writeFileSync(path.join(d, 'index.html'), '<!doctype html><html><head></head></html>');
    fs.writeFileSync(path.join(d, 'matra-build.json'), '{"matching":"off"}');
    return d;
  }
  it('passes with no models (MATRA_SKIP_MODELS) and fails on an unlisted file or a file that differs from its pin', () => {
    const d = dist();
    try {
      expect(audit(d).status).toBe(0);
      fs.mkdirSync(path.join(d, 'models'));
      fs.writeFileSync(path.join(d, 'models', 'extra.bin'), 'x');
      let r = audit(d);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/models\/extra\.bin: not listed in src\/ml\/manifest\.json/);
      fs.rmSync(path.join(d, 'models', 'extra.bin'));
      fs.mkdirSync(path.join(d, 'models', m.id), { recursive: true });
      fs.writeFileSync(path.join(d, 'models', m.id, f0.path), 'not the pinned bytes');
      r = audit(d);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/size or sha256 differs/);
      // a file with the right size but other bytes also differs
      fs.writeFileSync(path.join(d, 'models', m.id, f0.path), Buffer.alloc(f0.size, 1));
      expect(createHash('sha256').update(Buffer.alloc(f0.size, 1)).digest('hex')).not.toBe(f0.sha256);
      expect(audit(d).stderr).toMatch(/size or sha256 differs/);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });
});
