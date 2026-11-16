/**
 * Integrity checks for model and runtime files, run in the browser before any byte is used (plan section 8.8, 8.12).
 *
 * What this stops: a corrupted cache entry, and a static host or CDN that serves a different file than the one we
 * pinned. What it does not stop: an operator who can change the app's JavaScript, because that operator can change
 * this checker too (threat model W4, W23). That assurance comes from the signed release manifest (a later phase) and
 * outside watchers.
 *
 * Rules, all enforced here and tested in verify.test.ts:
 *  - only our own origin: a request to any other origin is refused before it is made;
 *  - only pinned files: a path that is not in the manifest is refused (the loader answers 404), never fetched;
 *  - size is checked while streaming, so a host cannot make us buffer an unbounded body;
 *  - SHA-256 of the whole body is checked before the bytes are returned or cached.
 */
import { findPinned, MANIFEST, type Manifest, type Pinned } from './manifest';

export type IntegrityCode = 'foreign-origin' | 'unpinned' | 'missing' | 'bad-status' | 'size' | 'hash';

export class IntegrityError extends Error {
  readonly code: IntegrityCode;
  readonly url: string;
  constructor(code: IntegrityCode, url: string, detail = '') {
    super(`${code}: ${url}${detail ? ` (${detail})` : ''}`);
    this.name = 'IntegrityError';
    this.code = code;
    this.url = url;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface LoaderEnv {
  manifest: Manifest;
  /** The app's own origin, e.g. https://matra.example. Defaults to this page's or worker's origin. */
  origin: string;
  fetchImpl: FetchLike;
}

export function defaultOrigin(): string {
  return (globalThis as { location?: { origin?: string } }).location?.origin ?? 'http://localhost';
}

export function defaultEnv(over: Partial<LoaderEnv> = {}): LoaderEnv {
  return {
    manifest: over.manifest ?? MANIFEST,
    origin: over.origin ?? defaultOrigin(),
    fetchImpl: over.fetchImpl ?? ((input, init) => globalThis.fetch(input, init)),
  };
}

const HEX = /^[0-9a-f]{64}$/;

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto is not available, so downloaded files cannot be checked and will not be used');
  const digest = await subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The origin-relative path of a request, or throws if it is not on our origin. Query string and hash are dropped:
 * they never select a different file. A bare path is resolved against our origin.
 */
export function localPathOf(input: string, origin: string): string {
  let u: URL;
  try {
    u = new URL(input, origin);
  } catch {
    throw new IntegrityError('foreign-origin', input, 'not a valid URL');
  }
  if (u.origin !== new URL(origin).origin) throw new IntegrityError('foreign-origin', input, `${u.origin} is not ${origin}`);
  return u.pathname;
}

/** Throws unless these bytes are exactly the pinned file. */
export async function verifyBytes(pinned: Pinned, bytes: Uint8Array): Promise<void> {
  const { file, url } = pinned;
  if (bytes.byteLength !== file.size) throw new IntegrityError('size', url, `got ${bytes.byteLength} bytes, pinned ${file.size}`);
  if (!HEX.test(file.sha256)) throw new IntegrityError('hash', url, 'the manifest entry has no valid sha256');
  const got = await sha256Hex(bytes);
  if (got !== file.sha256) throw new IntegrityError('hash', url, 'sha256 does not match the pinned value');
}

/** Resolve a request to its pinned entry: our origin only, listed files only. */
export function resolvePinned(input: string, env: LoaderEnv): Pinned {
  const path = localPathOf(input, env.origin);
  const pinned = findPinned(path, env.manifest);
  if (!pinned) throw new IntegrityError('unpinned', input, 'not listed in the manifest');
  return pinned;
}

/**
 * Download one pinned file from our origin, checking size while it streams and the hash when it is complete.
 * Throws IntegrityError('missing') on 404 and ('size' | 'hash') on a mismatch; no unverified byte is ever returned.
 */
export async function fetchVerified(
  input: string,
  env: LoaderEnv,
  onBytes?: (n: number, total: number) => void,
): Promise<{ bytes: Uint8Array; pinned: Pinned }> {
  const pinned = resolvePinned(input, env);
  const res = await env.fetchImpl(pinned.url, { credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
  if (res.status === 404) throw new IntegrityError('missing', pinned.url);
  if (!res.ok) throw new IntegrityError('bad-status', pinned.url, `HTTP ${res.status}`);
  // A redirect to another origin is refused by redirect:'error'; a response that says it came from elsewhere is refused too.
  if (res.url) localPathOf(res.url, env.origin);
  const limit = pinned.file.size;
  const bytes = new Uint8Array(limit);
  let got = 0;
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (got + value.length > limit) {
        await reader.cancel().catch(() => {});
        throw new IntegrityError('size', pinned.url, `more than the pinned ${limit} bytes`);
      }
      bytes.set(value, got);
      got += value.length;
      onBytes?.(value.length, limit);
    }
  } else {
    const all = new Uint8Array(await res.arrayBuffer());
    if (all.length > limit) throw new IntegrityError('size', pinned.url, `more than the pinned ${limit} bytes`);
    bytes.set(all, 0);
    got = all.length;
    onBytes?.(got, limit);
  }
  if (got !== limit) throw new IntegrityError('size', pinned.url, `got ${got} bytes, pinned ${limit}`);
  await verifyBytes(pinned, bytes);
  return { bytes, pinned };
}

/**
 * A `fetch` for transformers.js (env.fetch). Pinned file: downloaded and verified, then returned as a plain 200.
 * Under /models/ but not pinned: answered 404 without touching the network (transformers.js asks for optional files
 * such as added_tokens.json and treats 404 as "not there"). A missing pinned file is a 404 too, which transformers.js
 * turns into a load error for required files. A mismatch throws, so the load fails. Any other origin throws.
 */
export function makeVerifiedFetch(
  env: LoaderEnv,
  onProgress?: (pinned: Pinned, loaded: number) => void,
): (input: string | URL, init?: unknown) => Promise<Response> {
  return async (input) => {
    const s = String(input);
    const path = localPathOf(s, env.origin); // throws foreign-origin before any request
    const known = findPinned(path, env.manifest);
    if (!known) return new Response(null, { status: 404, statusText: 'not pinned' });
    try {
      let loaded = 0;
      const { bytes, pinned } = await fetchVerified(s, env, (n) => {
        loaded += n;
        onProgress?.(known, loaded);
      });
      return new Response(bytes as unknown as BodyInit, {
        status: 200,
        headers: { 'content-type': 'application/octet-stream', 'content-length': String(pinned.file.size) },
      });
    } catch (e) {
      if (e instanceof IntegrityError && e.code === 'missing') return new Response(null, { status: 404, statusText: 'missing' });
      throw e;
    }
  };
}
