/**
 * The on-device cache for model and runtime files: neutral names, a hash check on every read, and a way to remove it all.
 *
 * Plan section 8.8: caches live under Matra's origin, so a browser's site-data list shows the site and its size. We
 * keep names neutral and revision-scoped, never prefetch (the caller asks for a download), do not call
 * navigator.storage.persist() (it can prompt, and it marks the site), and let her remove everything with
 * removeHelperFiles(). A cached model reveals little by itself (it is the same public file for everyone), but its
 * presence and size say that this device ran a helper, so deleting it must be easy.
 */
import { cacheNames, findPinned, MANIFEST, type Manifest, type Pinned } from './manifest';
import { fetchVerified, IntegrityError, localPathOf, verifyBytes, type LoaderEnv } from './verify';

/** The part of CacheStorage this module uses (so tests can pass a fake). */
export type CacheStorageLike = Pick<CacheStorage, 'open' | 'delete' | 'keys'>;

function storageOrUndefined(): CacheStorageLike | undefined {
  return typeof caches === 'undefined' ? undefined : caches;
}

/** Names this feature has used for caches in any revision. */
export const HELPER_CACHE_PATTERN = /^(speech-model|ml-runtime|ml-model)-/;

export interface CacheStats {
  /** Entries found corrupted or tampered with on read and removed. */
  rejected: number;
}

/**
 * A cache that hands back only bytes it has just checked against the manifest. Same shape as transformers.js's
 * `env.customCache` (match / put / delete). Keys may be a bare path, an absolute URL on our origin, or the runtime key
 * with a query; the query is ignored. A key that is not on our origin or not pinned is never stored and never matches.
 */
export class VerifiedCache {
  readonly stats: CacheStats = { rejected: 0 };
  constructor(
    private readonly cacheName: string,
    private readonly env: LoaderEnv,
    private readonly storage: CacheStorageLike | undefined = storageOrUndefined(),
  ) {}

  private pinnedFor(key: string): Pinned | undefined {
    try {
      const p = findPinned(localPathOf(key, this.env.origin), this.env.manifest);
      return p && p.cacheName === this.cacheName ? p : undefined;
    } catch {
      return undefined;
    }
  }

  private async open(): Promise<Cache | null> {
    if (!this.storage) return null;
    try {
      return await this.storage.open(this.cacheName);
    } catch {
      return null; // private mode or blocked storage: behave as an empty cache
    }
  }

  /** The verified bytes for a key, or undefined (absent, or removed because it failed the check). */
  async matchBytes(key: string): Promise<Uint8Array | undefined> {
    const pinned = this.pinnedFor(key);
    if (!pinned) return undefined;
    const cache = await this.open();
    if (!cache) return undefined;
    let hit: Response | undefined;
    try {
      hit = await cache.match(key);
    } catch {
      return undefined;
    }
    if (!hit) return undefined;
    const bytes = new Uint8Array(await hit.arrayBuffer());
    try {
      await verifyBytes(pinned, bytes);
    } catch (e) {
      if (!(e instanceof IntegrityError)) throw e;
      this.stats.rejected++;
      await cache.delete(key).catch(() => {});
      return undefined; // the caller downloads it again, and that download is checked too
    }
    return bytes;
  }

  async match(key: string): Promise<Response | undefined> {
    const bytes = await this.matchBytes(key);
    if (!bytes) return undefined;
    return new Response(bytes as unknown as BodyInit, { headers: { 'content-length': String(bytes.byteLength) } });
  }

  /** Store a response, but only if its body is exactly the pinned file. Throws IntegrityError otherwise; nothing is stored. */
  async put(key: string, response: Response): Promise<void> {
    const pinned = this.pinnedFor(key);
    if (!pinned) throw new IntegrityError('unpinned', key, 'not stored: not a pinned file for this cache');
    const bytes = new Uint8Array(await response.arrayBuffer());
    await verifyBytes(pinned, bytes);
    const cache = await this.open();
    if (!cache) return;
    await cache.put(key, new Response(bytes as unknown as BodyInit, { headers: { 'content-type': response.headers.get('content-type') ?? 'application/octet-stream' } }));
  }

  async delete(key: string): Promise<boolean> {
    const cache = await this.open();
    return cache ? cache.delete(key).catch(() => false) : false;
  }
}

/**
 * Load one pinned file, from the cache if it is there and still checks out, otherwise from our origin. Either way
 * the bytes are verified before they are returned, and a downloaded file is stored only after it checks out.
 */
export async function loadPinnedFile(
  url: string,
  cache: VerifiedCache | null,
  env: LoaderEnv,
  onBytes?: (n: number) => void,
  cacheKey: string = url,
): Promise<{ bytes: Uint8Array; fromCache: boolean; pinned: Pinned }> {
  const cached = cache ? await cache.matchBytes(cacheKey) : undefined;
  if (cached) {
    onBytes?.(cached.byteLength);
    const p = findPinned(localPathOf(url, env.origin), env.manifest);
    if (!p) throw new IntegrityError('unpinned', url);
    return { bytes: cached, fromCache: true, pinned: p };
  }
  const { bytes, pinned } = await fetchVerified(url, env, (n) => onBytes?.(n));
  if (cache) {
    try {
      await cache.put(cacheKey, new Response(bytes as unknown as BodyInit));
    } catch (e) {
      if (e instanceof IntegrityError) throw e; // cannot happen after fetchVerified, but never swallow an integrity failure
      // storage full or blocked: carry on without a cache
    }
  }
  return { bytes, fromCache: false, pinned };
}

/**
 * "Remove helper files": delete every Cache Storage entry this feature owns, including caches left by older revisions.
 * Returns the names removed. Safe to call with no Cache API. Does not touch her vault or any other storage.
 */
export async function removeHelperFiles(storage: CacheStorageLike | undefined = storageOrUndefined(), m: Manifest = MANIFEST): Promise<string[]> {
  if (!storage) return [];
  const removed: string[] = [];
  let names: string[] = [];
  try {
    names = await storage.keys();
  } catch {
    names = [];
  }
  const owned = new Set(cacheNames(m));
  for (const name of new Set([...names.filter((n) => owned.has(n) || HELPER_CACHE_PATTERN.test(n)), ...owned])) {
    try {
      if (await storage.delete(name)) removed.push(name);
    } catch {
      /* ignore */
    }
  }
  return removed;
}
