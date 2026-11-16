/**
 * The pinned list of every file the browser loads to run a model (manifest.json), and lookups over it.
 *
 * Dependency-free on purpose: it is imported by the main thread, by workers and by tests. Nothing here touches the
 * network. A file is "pinned" when its path is listed in the manifest with a size and a SHA-256; anything else under
 * /models/ is refused by the loader (src/ml/verify.ts).
 */
import raw from './manifest.json';

export interface PinnedFile {
  path: string;
  size: number;
  sha256: string;
  /** a model with a `source`: the file's name inside the npm package, when it differs from the name it is served under */
  from?: string;
}
export interface RuntimeFile extends PinnedFile {
  role: 'cpu-wasm' | 'webgpu-wasm';
}
/** A code file of a model's runtime that is built into the app (content-hashed under /assets/), not fetched at run time. */
export interface ModelBundledFile extends PinnedFile {
  role: 'ocr-worker' | 'ocr-core';
  package: string;
  version: string;
  /** path inside the installed package */
  path: string;
}
export interface ModelEntry {
  id: string;
  task: string;
  /** Present when the files are copied from an installed npm package at build time instead of downloaded. */
  source?: { type: 'npm'; package: string; version: string; path: string };
  /** Code this model's runtime runs, built into the app and pinned at build time. */
  bundled?: ModelBundledFile[];
  revision: string;
  dtype: string;
  /** Origin-relative directory the model's files are served from, with a trailing slash. */
  base: string;
  /** Neutral, revision-scoped Cache Storage name (shared devices: no app name in browser storage). */
  cacheName: string;
  files: PinnedFile[];
}
/** A runtime file built into the app bundle rather than fetched at run time (checked at build time, not in the browser). */
export interface BundledFile extends PinnedFile {
  role: 'cpu-glue';
}
export interface Manifest {
  schema: 1;
  runtime: { package: string; version: string; base: string; cacheName: string; files: RuntimeFile[]; bundled: BundledFile[] };
  models: ModelEntry[];
}

export const MANIFEST = raw as unknown as Manifest;

/** Where every model and runtime file is served from: our own origin, under this path. */
export const MODELS_BASE = '/models/';

export interface Pinned {
  kind: 'runtime' | 'model';
  /** Origin-relative path, e.g. /models/ort/ort-wasm-simd-threaded.wasm */
  url: string;
  file: PinnedFile;
  /** The model it belongs to (undefined for runtime files). */
  model?: ModelEntry;
  /** The Cache Storage name this file lives in. */
  cacheName: string;
}

/** Every pinned file, with its origin-relative URL. */
export function listPinned(m: Manifest = MANIFEST): Pinned[] {
  const out: Pinned[] = [];
  for (const f of m.runtime.files) out.push({ kind: 'runtime', url: m.runtime.base + f.path, file: f, cacheName: m.runtime.cacheName });
  for (const model of m.models) for (const f of model.files) out.push({ kind: 'model', url: model.base + f.path, file: f, model, cacheName: model.cacheName });
  return out;
}

const byUrlCache = new WeakMap<Manifest, Map<string, Pinned>>();
function index(m: Manifest): Map<string, Pinned> {
  let idx = byUrlCache.get(m);
  if (!idx) {
    idx = new Map(listPinned(m).map((p) => [p.url, p]));
    byUrlCache.set(m, idx);
  }
  return idx;
}

/** The pinned file at this origin-relative path (query string and hash already removed), if any. */
export function findPinned(pathname: string, m: Manifest = MANIFEST): Pinned | undefined {
  return index(m).get(pathname);
}

/** Every Cache Storage name the manifest uses. */
export function cacheNames(m: Manifest = MANIFEST): string[] {
  return [m.runtime.cacheName, ...m.models.map((x) => x.cacheName)];
}

/** Total bytes of one model's files. */
export const modelBytes = (model: ModelEntry): number => model.files.reduce((n, f) => n + f.size, 0);

/** The model with this id, or throws (a typo must not silently load nothing). */
export function modelById(id: string, m: Manifest = MANIFEST): ModelEntry {
  const found = m.models.find((x) => x.id === id);
  if (!found) throw new Error(`model ${id} is not in the manifest`);
  return found;
}

/** The runtime file for a role, or throws. */
export function runtimeFile(role: RuntimeFile['role'], m: Manifest = MANIFEST): RuntimeFile {
  const f = m.runtime.files.find((x) => x.role === role);
  if (!f) throw new Error(`runtime file ${role} is not in the manifest`);
  return f;
}

/** The runtime file that is built into the app, for a role, or throws. */
export function bundledFile(role: BundledFile['role'], m: Manifest = MANIFEST): BundledFile {
  const f = m.runtime.bundled.find((x) => x.role === role);
  if (!f) throw new Error(`bundled runtime file ${role} is not in the manifest`);
  return f;
}

/** "about 94 MB": rounded so it reads honestly, not precisely. */
export const formatMB = (bytes: number): string => `${Math.round(bytes / 1e6)} MB`;
