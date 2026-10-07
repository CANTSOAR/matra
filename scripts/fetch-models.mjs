#!/usr/bin/env node
/**
 * Fetch the on-device speech model (Whisper, ONNX) and the ONNX Runtime wasm files into
 * apps/web/public/models/, so Vite serves them from OUR origin. At runtime the app never talks to
 * huggingface.co or a CDN: a request there would tell a third party that someone is using Matra.
 *
 *   npm run fetch-models              download what is missing, verify everything (sha256 + size)
 *   node scripts/fetch-models.mjs --check   verify only; exit 1 if anything is missing or wrong
 *   MATRA_SKIP_MODELS=1 npm run build       build without voice (the app falls back to typing)
 *
 * Idempotent: files already present with the right hash are left alone. Downloads go to a .part file
 * and are only moved into place after the hash matches. Pinned revision: see apps/web/src/voice/model-manifest.json.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/web/src/voice/model-manifest.json'), 'utf8'));
const OUT = path.join(ROOT, 'apps/web/public/models');
const MODEL_DIR = path.join(OUT, MANIFEST.modelId);
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
  console.log(`[fetch-models] ${MANIFEST.modelId}@${MANIFEST.revision.slice(0, 10)} (${MANIFEST.dtype}) -> ${path.relative(ROOT, OUT)}/`);
  const problems = [];

  for (const f of MANIFEST.files) {
    const dest = path.join(MODEL_DIR, f.path);
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
    const url = `${HOST}/${MANIFEST.modelId}/resolve/${MANIFEST.revision}/${f.path}`;
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

  // ONNX Runtime wasm: copy from the installed onnxruntime-web, which is exactly what the app bundle was built with.
  let ortPkgDir = path.dirname(createRequire(path.join(ROOT, 'apps/web/package.json')).resolve('onnxruntime-web'));
  while (!fs.existsSync(path.join(ortPkgDir, 'package.json'))) ortPkgDir = path.dirname(ortPkgDir);
  const ortVersion = JSON.parse(fs.readFileSync(path.join(ortPkgDir, 'package.json'), 'utf8')).version;
  if (ortVersion !== MANIFEST.ort.version) {
    console.warn(`  note: installed onnxruntime-web ${ortVersion} differs from manifest ${MANIFEST.ort.version}; update the sizes in model-manifest.json`);
  }
  const ortFiles = [MANIFEST.ort.wasm.mjs, MANIFEST.ort.wasm.wasm, MANIFEST.ort.webgpu.wasm];
  for (const name of ortFiles) {
    const src = path.join(ortPkgDir, 'dist', name);
    const dest = path.join(ORT_DIR, name);
    const size = fs.statSync(src).size;
    if (await isGood(dest, size, await sha256File(src))) {
      console.log(`  ok        ort/${name} (${mb(size)})`);
      continue;
    }
    if (CHECK_ONLY) {
      problems.push(`ort/${name}`);
      console.log(`  MISSING   ort/${name}`);
      continue;
    }
    fs.mkdirSync(ORT_DIR, { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`  copied    ort/${name} (${mb(size)})`);
  }
  // Remove stale ORT files from earlier versions so they are never served by accident.
  for (const name of fs.existsSync(ORT_DIR) ? fs.readdirSync(ORT_DIR) : []) {
    if (!ortFiles.includes(name)) fs.rmSync(path.join(ORT_DIR, name), { force: true });
  }

  if (problems.length) {
    console.error(`[fetch-models] ${problems.length} file(s) missing or invalid. Run: npm run fetch-models`);
    process.exit(1);
  }
  const modelBytes = MANIFEST.files.reduce((n, f) => n + f.size, 0);
  console.log(`[fetch-models] ready: model ${mb(modelBytes)}, runtime ${mb(MANIFEST.ort.wasm.size)} (cpu) / ${mb(MANIFEST.ort.webgpu.size)} (webgpu)`);
}

main().catch((e) => {
  console.error(`[fetch-models] failed: ${e.message}`);
  console.error('  To build without voice transcription, set MATRA_SKIP_MODELS=1.');
  process.exit(1);
});
