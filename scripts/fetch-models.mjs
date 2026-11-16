#!/usr/bin/env node
/**
 * Fetch every on-device model in apps/web/src/ml/manifest.json (today: the Whisper speech model) and copy the ONNX
 * Runtime wasm files into apps/web/public/models/, so Vite serves them from OUR origin. At runtime the app never talks to
 * huggingface.co or a CDN: a request there would tell a third party that someone is using Matra.
 *
 *   npm run fetch-models              download what is missing, verify everything (sha256 + size)
 *   node scripts/fetch-models.mjs --check   verify only; exit 1 if anything is missing or wrong
 *   MATRA_SKIP_MODELS=1 npm run build       build without voice (the app falls back to typing)
 *
 * Idempotent: files already present with the right hash are left alone. Downloads go to a .part file
 * and are only moved into place after the hash matches. Pinned revisions, sizes and hashes: apps/web/src/ml/manifest.json (the browser checks them again before use).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/web/src/ml/manifest.json'), 'utf8'));
const OUT = path.join(ROOT, 'apps/web/public/models');
const ORT_DIR = path.join(OUT, 'ort');
const HOST = process.env.MATRA_MODEL_HOST || 'https://huggingface.co';
const CHECK_ONLY = process.argv.includes('--check');

const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;

if (process.env.MATRA_SKIP_MODELS === '1') {
  console.warn('[fetch-models] MATRA_SKIP_MODELS=1: skipping. Voice transcription will be unavailable in this build.');
  process.exit(0);
}

async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function isGood(file, size, sha256) {
  try {
    if (fs.statSync(file).size !== size) return false;
  } catch {
    return false;
  }
  return !sha256 || (await sha256File(file)) === sha256;
}

async function download(url, dest, size, sha256) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  const out = fs.createWriteStream(part);
  const hash = createHash('sha256');
  let got = 0;
  let lastPrint = 0;
  const tty = process.stdout.isTTY;
  for await (const chunk of res.body) {
    hash.update(chunk);
    got += chunk.length;
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    const now = Date.now();
    if (!lastPrint) lastPrint = now;
    else if (now - lastPrint > (tty ? 200 : 3000)) {
      lastPrint = now;
      const line = `  ${path.basename(dest)}: ${mb(got)} / ${mb(size)} (${Math.floor((got / size) * 100)}%)`;
      if (tty) process.stdout.write(`\r${line}   `);
      else console.log(line);
    }
  }
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  if (tty) process.stdout.write('\n');
  const digest = hash.digest('hex');
  if (got !== size || digest !== sha256) {
    fs.rmSync(part, { force: true });
    throw new Error(`verification failed for ${url}: got ${got} bytes sha256 ${digest}, expected ${size} bytes sha256 ${sha256}`);
  }
  fs.renameSync(part, dest);
}

async function main() {
  const problems = [];

  for (const model of MANIFEST.models) {
    const modelDir = path.join(OUT, model.id);
    console.log(`[fetch-models] ${model.id}@${model.revision.slice(0, 10)} (${model.dtype}) -> ${path.relative(ROOT, OUT)}/`);
    for (const f of model.files) {
      const dest = path.join(modelDir, f.path);
      if (await isGood(dest, f.size, f.sha256)) {
        console.log(`  ok        ${f.path} (${mb(f.size)})`);
        continue;
      }
      if (CHECK_ONLY) {
        problems.push(f.path);
        console.log(`  MISSING   ${f.path}`);
        continue;
      }
      console.log(`  download  ${f.path} (${mb(f.size)})`);
      const url = `${HOST}/${model.id}/resolve/${model.revision}/${f.path}`;
      let lastErr;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await download(url, dest, f.size, f.sha256);
          lastErr = undefined;
          break;
        } catch (e) {
          lastErr = e;
          console.warn(`  retry ${attempt}/3: ${e.message}`);
        }
      }
      if (lastErr) throw lastErr;
    }
  }

  // ONNX Runtime wasm: copy from the installed onnxruntime-web, which is exactly what the app bundle was built with.
  // The copy must match the pinned size and hash in the manifest: if onnxruntime-web is upgraded, the manifest is updated
  // in the same change (a mismatch fails the build rather than shipping a runtime nobody pinned).
  let ortPkgDir = path.dirname(createRequire(path.join(ROOT, 'apps/web/package.json')).resolve('onnxruntime-web'));
  while (!fs.existsSync(path.join(ortPkgDir, 'package.json'))) ortPkgDir = path.dirname(ortPkgDir);
  const ortVersion = JSON.parse(fs.readFileSync(path.join(ortPkgDir, 'package.json'), 'utf8')).version;
  if (ortVersion !== MANIFEST.runtime.version) {
    console.error(`  installed onnxruntime-web ${ortVersion} is not the pinned ${MANIFEST.runtime.version}; update src/ml/manifest.json (sizes and sha256) with it`);
    process.exit(1);
  }
  const ortFiles = MANIFEST.runtime.files.map((f) => f.path);
  // The CPU glue is built into the app, not served from /models/. Its installed copy must still be the pinned one.
  for (const f of MANIFEST.runtime.bundled) {
    if (!(await isGood(path.join(ortPkgDir, 'dist', f.path), f.size, f.sha256))) {
      console.error(`  installed ${f.path} (built into the app) does not match the pinned size/sha256 in src/ml/manifest.json`);
      process.exit(1);
    }
    console.log(`  ok        ${f.path} (${mb(f.size)}, built into the app)`);
  }
  for (const f of MANIFEST.runtime.files) {
    const name = f.path;
    const src = path.join(ortPkgDir, 'dist', name);
    const dest = path.join(ORT_DIR, name);
    if (!(await isGood(src, f.size, f.sha256))) {
      console.error(`  installed ${name} does not match the pinned size/sha256 in src/ml/manifest.json`);
      process.exit(1);
    }
    if (await isGood(dest, f.size, f.sha256)) {
      console.log(`  ok        ort/${name} (${mb(f.size)})`);
      continue;
    }
    if (CHECK_ONLY) {
      problems.push(`ort/${name}`);
      console.log(`  MISSING   ort/${name}`);
      continue;
    }
    fs.mkdirSync(ORT_DIR, { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`  copied    ort/${name} (${mb(f.size)})`);
  }
  // Files nobody pinned (stale ORT files from earlier versions, stray downloads) are never served by accident:
  // removed on a normal run, reported by --check.
  const pinned = new Set([
    ...ortFiles.map((n) => path.join(ORT_DIR, n)),
    ...MANIFEST.models.flatMap((m) => m.files.map((f) => path.join(OUT, m.id, f.path))),
  ]);
  const walk = (dir) => {
    for (const ent of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (!pinned.has(p)) {
        if (CHECK_ONLY) {
          problems.push(path.relative(OUT, p));
          console.log(`  UNPINNED  ${path.relative(OUT, p)}`);
        } else fs.rmSync(p, { force: true });
      }
    }
  };
  walk(OUT);

  if (problems.length) {
    console.error(`[fetch-models] ${problems.length} file(s) missing, invalid or not pinned. Run: npm run fetch-models`);
    process.exit(1);
  }
  const bytes = MANIFEST.models.flatMap((m) => m.files).reduce((n, f) => n + f.size, 0);
  const runtime = (role) => MANIFEST.runtime.files.find((f) => f.role === role).size;
  console.log(`[fetch-models] ready: models ${mb(bytes)}, runtime ${mb(runtime('cpu-wasm'))} (cpu) / ${mb(runtime('webgpu-wasm'))} (webgpu)`);
}

main().catch((e) => {
  console.error(`[fetch-models] failed: ${e.message}`);
  console.error('  To build without voice transcription, set MATRA_SKIP_MODELS=1.');
  process.exit(1);
});
