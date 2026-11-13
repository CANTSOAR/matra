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
 * Hosts in shipped code are not the same as requests: the CSP (apps/server/src/app.ts WEB_CSP) is what stops the
 * browser from contacting anything but this origin (connect-src/script-src/img-src… 'self'), and the e2e suite fails
 * on any request to another origin (e2e/helpers.ts). This audit catches a dependency or a change that would ADD one.
 */
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
  'huggingface.co': 'transformers.js default model host; disabled (env.allowRemoteModels = false, remoteHost overridden; CSP connect-src self)',
  'cdn.jsdelivr.net': 'ONNX Runtime default wasm path; overridden to /models/ort/ (apps/web/src/voice/worker.ts; CSP script-src self)',
  'react.dev': 'React error-message text',
  'reactrouter.com': 'React Router warning text',
  'github.com': 'library comments / error-message text',
  'gist.github.com': 'library comment text',
  'web.dev': 'library comment text',
  'developer.mozilla.org': 'library comment text',
  'rolldown.rs': 'bundler runtime error text',
  localhost: 'dev-only fallbacks / URL parsing base',
};

/** Analytics, tag managers, error trackers, session replay, ad and font CDNs: must never appear. */
const FORBIDDEN = [
  'google-analytics', 'googletagmanager', 'gtag(', 'doubleclick.net', 'fonts.googleapis', 'fonts.gstatic', 'segment.io',
  'segment.com', 'sentry.io', 'sentry-cdn', 'posthog', 'mixpanel', 'amplitude.com', 'hotjar', 'fullstory', 'logrocket',
  'plausible.io', 'cloudflareinsights', 'newrelic', 'nr-data.net', 'datadoghq', 'clarity.ms', 'facebook.net', 'intercom.io',
];

const problems = [];
if (!fs.existsSync(DIST)) {
  console.error(`[audit-web] ${DIST} does not exist; build the web app first.`);
  process.exit(1);
}

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
  for (const m of text.matchAll(/\b(?:https?|wss?):\/\/([a-z0-9.-]+)/gi)) {
    const h = m[1].toLowerCase().replace(/\.$/, '');
    if (!hosts.has(h)) hosts.set(h, new Set());
    hosts.get(h).add(rel(f));
  }
}
for (const [h, where] of hosts)
  if (!(h in ALLOWED_HOSTS)) problems.push(`unexpected host ${h} in ${[...where].slice(0, 3).join(', ')}${where.size > 3 ? ' …' : ''}`);

if (problems.length) {
  console.error(`[audit-web] ${problems.length} problem(s) in ${DIST}:`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('[audit-web] Every host the shipped app names must be on the allowlist in scripts/audit-web-build.mjs, with a reason.');
  process.exit(1);
}
console.log(`[audit-web] ok: ${files.length} files, no third-party requests or trackers; hosts named: ${[...hosts.keys()].sort().join(', ') || 'none'}`);
