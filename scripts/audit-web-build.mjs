#!/usr/bin/env node
/**
 * Audit the built web app (apps/web/dist) for third-party requests (W11: no analytics, no CDNs, no external fonts).
 * Run by `npm run build` after Vite; also `npm run audit:web` on an existing build. Exit 1 on any finding.
 *
 *   1. index.html: every src / href is same-origin (relative or root-relative). No external script, style, font, icon.
 *   2. CSS: no url(...) or @import that leaves the origin.
 *   3. JS / CSS / HTML / JSON: every http(s) host named anywhere is on the allowlist below, each with the reason it
 *      appears; nothing on the tracker list appears at all. A new host fails the build until someone looks at it.
 *
 *   4. Sealed matching left out of a MATRA_MATCHING=off build (the pilot): no matching, escrow, counselor or report API
 *      route, no OPRF code, no matching or counselor screen route. The mode is read from the build itself
 *      (matra-build.json, written by apps/web/vite.config.ts), never from this shell's environment; a build without it
 *      fails. A build made with MATRA_MATCHING=on skips this check. (Tree-shaking can leave an empty chunk behind, named after a
 *      module it emptied; what counts is that none of these strings is in any shipped file.)
 *
 *  5. Model and runtime files (dist/models): every file is listed in apps/web/src/ml/manifest.json with the same size and
 *     SHA-256, and nothing else is there. A dist/models without models (MATRA_SKIP_MODELS=1) is fine; a wrong or unlisted
 *     file is not: the browser would refuse it at run time, and an unlisted one should not be served at all.
 *
 *  5b. The CPU ONNX Runtime JS glue (code the browser cannot check at run time) is built into the app as the pinned bytes.
 *  7. Licence texts and NOTICE ship in the build (licenses/), and NOTICE names the third-party software we distribute.
 *  5c. The OCR engine's code (tesseract.js worker script and WebAssembly core) is built into the app as the pinned bytes, and
 *     is not served from /models/ either (the language data is the only OCR file there).
 *  6b. "Dates found in your files" (src/evidence/datesFound.ts) left out of a MATRA_DATES_FOUND=off build, the default.
 *  6. The span-marker (src/ml/marker) left out of a MATRA_MARKER=off build, which is the default: none of its strings is in
 *     any shipped file. It has no survivor-facing screen in this build, so "on" only matters for the dev-only preview.
 *
 * Hosts in shipped code are not the same as requests: the CSP (apps/server/src/app.ts WEB_CSP) is what stops the
 * browser from contacting anything but this origin (connect-src/script-src/img-src… 'self'), and the e2e suite fails
 * on any request to another origin (e2e/helpers.ts). This audit catches a dependency or a change that would ADD one.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.resolve(process.argv[2] || path.join(ROOT, 'apps/web/dist'));

/** host → why it may appear in shipped code. None of these is fetched by the app. */
const ALLOWED_HOSTS = {
  'www.w3.org': 'XML/SVG namespace URIs (identifiers, never fetched)',
  'online.rainn.org': 'a link the survivor can choose to follow (RAINN online hotline)',
  'www.google.com': 'quick exit navigates the tab away to a neutral site (a navigation the survivor chose, not a request from the app)',
  'www.njoag.gov': 'links to the NJ VCCO application forms',
  'creativecommons.org': 'the CC BY 4.0 licence link in the passphrase word-list credit (NOTICE; a link she can choose to follow)',
  'huggingface.co': 'transformers.js default model host; disabled (env.allowRemoteModels = false, remoteHost overridden; CSP connect-src self)',
  'cdn.jsdelivr.net': 'ONNX Runtime default wasm path; overridden to /models/ort/ (apps/web/src/voice/worker.ts; CSP script-src self)',
  'opencollective.com': 'the funding link inside tesseract.js’s bundled package.json metadata (a string, never fetched)',
  'react.dev': 'React error-message text',
  'reactrouter.com': 'React Router warning text',
  'github.com': 'library comments / error-message text',
  'gist.github.com': 'library comment text',
  'web.dev': 'library comment text',
  'developer.mozilla.org': 'library comment text',
  'rolldown.rs': 'bundler runtime error text',
  localhost: 'dev-only fallbacks / URL parsing base',
};

/**
 * Hosts allowed ONLY inside the licence texts under licenses/*.txt (links in the text of a licence or an attribution, never
 * fetched). They are deliberately not in ALLOWED_HOSTS: the same host in a script or stylesheet is still a finding.
 */
const LICENSE_TEXT_HOSTS = {
  'www.apache.org': 'the Apache-2.0 licence text (a link inside the text)',
  'www.eff.org': 'attribution links in NOTICE.txt (the EFF word list source)',
  'www.leptonica.org': 'the Leptonica project link in NOTICE.txt',
};

/** Analytics, tag managers, error trackers, session replay, ad and font CDNs: must never appear. */
const FORBIDDEN = [
  'google-analytics', 'googletagmanager', 'gtag(', 'doubleclick.net', 'fonts.googleapis', 'fonts.gstatic', 'segment.io',
  'segment.com', 'sentry.io', 'sentry-cdn', 'posthog', 'mixpanel', 'amplitude.com', 'hotjar', 'fullstory', 'logrocket',
  'plausible.io', 'cloudflareinsights', 'newrelic', 'nr-data.net', 'datadoghq', 'clarity.ms', 'facebook.net', 'intercom.io',
];

/**
 * Strings a build without sealed matching must not contain (case-insensitive): the API routes it would call, the OPRF
 * client, and the app's own matching and counselor screen routes. Plain words like "counselor" in survivor-facing copy
 * ("a school counselor") are fine; these are route and protocol strings.
 */
const MATCHING_ONLY = [
  '/api/matching', '/api/escrow', '/api/counselor', '/api/report-requests', '/api/report-releases', 'oprf',
  'vault/matching', 'vault/requests', 'counselor/matches', 'counselor/reports',
];
const problems = [];
if (!fs.existsSync(DIST)) {
  console.error(`[audit-web] ${DIST} does not exist; build the web app first.`);
  process.exit(1);
}

/** The MATRA_MATCHING this build was made with, from its own matra-build.json. */
let matchingMode;
try {
  matchingMode = JSON.parse(fs.readFileSync(path.join(DIST, 'matra-build.json'), 'utf8')).matching;
} catch {
  matchingMode = undefined;
}
if (matchingMode !== 'off' && matchingMode !== 'on') {
  console.error(`[audit-web] ${DIST}/matra-build.json is missing or doesn't say "off" or "on": rebuild with apps/web/vite.config.ts.`);
  process.exit(1);
}

/** The MATRA_MARKER this build was made with (matra-marker.json); a build without the file is treated as off. */
let markerMode = 'off';
try {
  markerMode = JSON.parse(fs.readFileSync(path.join(DIST, 'matra-marker.json'), 'utf8')).marker === 'on' ? 'on' : 'off';
} catch {
  /* keep off */
}
/** The MATRA_DATES_FOUND this build was made with (matra-dates.json); a build without the file is treated as off. */
let datesMode = 'off';
try {
  datesMode = JSON.parse(fs.readFileSync(path.join(DIST, 'matra-dates.json'), 'utf8')).datesFound === 'on' ? 'on' : 'off';
} catch {
  /* keep off */
}
/** Strings that exist only in "dates found in your files" (src/evidence/datesFound.ts, DatesFound.tsx). */
const DATES_ONLY = ['Dates found in your files', 'text-in-image', 'file-metadata'];
/** Strings that exist only in the marker's code (error-free minification keeps string literals). */
const MARKER_ONLY = ['understand-rules', 'not-exact-substring', 'sensitive-group', 'reported-speech'];

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const TEXT = /\.(html|js|mjs|cjs|css|json|webmanifest|svg|txt)$/i;
const files = walk(DIST).filter((f) => TEXT.test(f));

const rel = (f) => path.relative(DIST, f);
const external = (u) => /^([a-z][a-z0-9+.-]*:)?\/\//i.test(u.trim()) && !/^(data|blob):/i.test(u.trim());

// 1. index.html
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
for (const m of html.matchAll(/\s(?:src|href|content)\s*=\s*["']([^"']*)["']/gi))
  if (external(m[1]) && !/^http:\/\/www\.w3\.org\//.test(m[1])) problems.push(`index.html: external reference ${m[1]}`);

const hosts = new Map();
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const lower = text.toLowerCase();
  // 2. CSS
  if (/\.css$/i.test(f)) {
    for (const m of text.matchAll(/url\(\s*["']?([^"')]+)/gi)) if (external(m[1])) problems.push(`${rel(f)}: CSS url(${m[1]})`);
    for (const m of text.matchAll(/@import\s+(?:url\()?\s*["']?([^"');]+)/gi)) if (external(m[1])) problems.push(`${rel(f)}: CSS @import ${m[1]}`);
  }
  // 3. hosts + trackers
  for (const bad of FORBIDDEN) if (lower.includes(bad)) problems.push(`${rel(f)}: mentions ${bad}`);
  // 4. sealed matching left out
  if (matchingMode === 'off')
    for (const m of MATCHING_ONLY) if (lower.includes(m)) problems.push(`${rel(f)}: contains "${m}", but this is a MATRA_MATCHING=off build`);
  // 6. marker left out
  if (markerMode === 'off')
    for (const m of MARKER_ONLY) if (text.includes(m)) problems.push(`${rel(f)}: contains "${m}", but this is a MATRA_MARKER=off build`);
  // 6b. dates found in your files left out
  if (datesMode === 'off')
    for (const m of DATES_ONLY) if (text.includes(m)) problems.push(`${rel(f)}: contains "${m}", but this is a MATRA_DATES_FOUND=off build`);
  for (const m of text.matchAll(/\b(?:https?|wss?):\/\/([a-z0-9.-]+)/gi)) {
    const h = m[1].toLowerCase().replace(/\.$/, '');
    if (/^licenses\/[^/]+\.txt$/.test(rel(f)) && h in LICENSE_TEXT_HOSTS) continue;
    if (!hosts.has(h)) hosts.set(h, new Set());
    hosts.get(h).add(rel(f));
  }
}
for (const [h, where] of hosts)
  if (!(h in ALLOWED_HOSTS)) problems.push(`unexpected host ${h} in ${[...where].slice(0, 3).join(', ')}${where.size > 3 ? ' …' : ''}`);

// 5b. the CPU ONNX Runtime glue is built into the app (the browser cannot check code it import()s by URL): the build
// must contain exactly the pinned bytes, as a file under assets/, and no copy of it under /models/ (never served from there)
{
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/web/src/ml/manifest.json'), 'utf8'));
  const all = walk(DIST);
  // enforced for any build that ships the transcription worker (assets/worker-*.js); a page-only dist has nothing to check
  const hasWorker = all.some((f) => /^assets\/worker-[^/]*\.js$/.test(rel(f)));
  for (const pin of manifest.runtime.bundled) {
    const hit = !hasWorker || all.find((f) => rel(f).startsWith('assets/') && fs.statSync(f).size === pin.size && createHash('sha256').update(fs.readFileSync(f)).digest('hex') === pin.sha256);
    if (!hit) problems.push(`assets/: no file equal to the pinned ${pin.path} (size ${pin.size}, sha256 ${pin.sha256.slice(0, 12)}...) is built into the app`);
    if (all.some((f) => rel(f).startsWith(`models/ort/${pin.path}`))) problems.push(`models/ort/${pin.path}: the glue must be built into the app, not served from /models/`);
  }
}

// 7. licence texts and the attribution notice ship with every build of the full app (Apache-2.0 section 4, MIT, CC BY 4.0)
{
  const all = walk(DIST);
  const fullApp = all.some((f) => /^assets\/index-[^/]*\.js$/.test(rel(f)));
  if (fullApp)
    for (const need of ['licenses/NOTICE.txt', 'licenses/Apache-2.0.txt', 'licenses/MIT-onnxruntime-web.txt', 'licenses/BSD-2-Clause-Leptonica.txt'])
      if (!all.some((f) => rel(f) === need)) problems.push(`${need}: missing from the build (third-party licence texts must ship with the app)`);
  const notice = all.find((f) => rel(f) === 'licenses/NOTICE.txt');
  if (fullApp && notice) {
    const text = fs.readFileSync(notice, 'utf8');
    for (const name of ['EFF Short Wordlist', 'onnxruntime-web', 'Transformers.js', 'whisper-base', 'tesseract.js 7.0.0', 'tesseract.js-core 7.0.0', 'tessdata_best', 'Leptonica'])
      if (!text.includes(name)) problems.push(`licenses/NOTICE.txt does not mention ${name}`);
  }
}

// 5c. the OCR code is built into the app as the pinned bytes (assets/), for any build of the full app
{
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/web/src/ml/manifest.json'), 'utf8'));
  const all = walk(DIST);
  const fullApp = all.some((f) => /^assets\/index-[^/]*\.js$/.test(rel(f)));
  for (const model of manifest.models)
    for (const pin of model.bundled ?? []) {
      const hit = !fullApp || all.find((f) => rel(f).startsWith('assets/') && fs.statSync(f).size === pin.size && createHash('sha256').update(fs.readFileSync(f)).digest('hex') === pin.sha256);
      if (!hit) problems.push(`assets/: no file equal to the pinned ${pin.package}/${pin.path} (size ${pin.size}, sha256 ${pin.sha256.slice(0, 12)}...) is built into the app`);
    }
}

// 5. models: exactly the pinned files, byte for byte
{
  const MODELS_DIR = path.join(DIST, 'models');
  if (fs.existsSync(MODELS_DIR)) {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/web/src/ml/manifest.json'), 'utf8'));
    const pinned = new Map([
      ...manifest.runtime.files.map((f) => [path.join(MODELS_DIR, 'ort', f.path), f]),
      ...manifest.models.flatMap((m) => m.files.map((f) => [path.join(MODELS_DIR, m.id, f.path), f])),
    ]);
    for (const f of walk(MODELS_DIR)) {
      const want = pinned.get(f);
      if (!want) {
        problems.push(`models/${path.relative(MODELS_DIR, f)}: not listed in src/ml/manifest.json`);
        continue;
      }
      const bytes = fs.readFileSync(f);
      if (bytes.length !== want.size || createHash('sha256').update(bytes).digest('hex') !== want.sha256)
        problems.push(`models/${path.relative(MODELS_DIR, f)}: size or sha256 differs from src/ml/manifest.json`);
    }
  }
}

if (problems.length) {
  console.error(`[audit-web] ${problems.length} problem(s) in ${DIST}:`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('[audit-web] Every host the shipped app names must be on the allowlist in scripts/audit-web-build.mjs, with a reason.');
  if (matchingMode === 'off')
    console.error('[audit-web] A MATRA_MATCHING=off build must not ship sealed-matching code: put it behind __MATRA_MATCHING__ (apps/web/src/build-flags.d.ts).');
  process.exit(1);
}
console.log(
  `[audit-web] ok: ${files.length} files, no third-party requests or trackers` +
    `${matchingMode === 'off' ? ', no sealed-matching code (MATRA_MATCHING=off)' : ' (MATRA_MATCHING=on: matching check skipped)'}` +
    `${markerMode === 'off' ? ', no span-marker code (MATRA_MARKER=off)' : ' (MATRA_MARKER=on: marker check skipped)'}` +
    `${datesMode === 'off' ? ', no dates-found code (MATRA_DATES_FOUND=off)' : ' (MATRA_DATES_FOUND=on: check skipped)'}; ` +
    `hosts named: ${[...hosts.keys()].sort().join(', ') || 'none'}`,
);
