import { describe, expect, it } from 'vitest';
import { HELPER_CACHE_PATTERN, VerifiedCache, loadPinnedFile, removeHelperFiles } from './cache';
import { IntegrityError } from './verify';
import { ORIGIN, enc, envFor, fakeCacheStorage, fakeFetch, makeManifest } from './testkit.test-util';

const RT = enc('pretend this is a wasm runtime');
const W = enc('pretend these are model weights, a few more bytes');
const TK = enc('{"tokenizer":"pretend"}');
const URL_W = '/models/acme/tiny/onnx/model.onnx';
const URL_RT = '/models/ort/rt.wasm';

async function setup() {
  const manifest = await makeManifest({ runtime: RT, weights: W, tokenizer: TK });
  const fetchImpl = fakeFetch({ [URL_W]: W, '/models/acme/tiny/tokenizer.json': TK, [URL_RT]: RT });
  const env = envFor(manifest, fetchImpl);
  const { storage, stores } = fakeCacheStorage();
  const cache = new VerifiedCache('speech-model-abcdef01', env, storage);
  return { manifest, fetchImpl, env, storage, stores, cache };
}
const bytesOf = async (r: Response | undefined) => (r ? Array.from(new Uint8Array(await r.arrayBuffer())) : undefined);

describe('VerifiedCache', () => {
  it('stores a good file and returns it', async () => {
    const { cache } = await setup();
    await cache.put(URL_W, new Response(W as unknown as BodyInit));
    expect(await bytesOf(await cache.match(URL_W))).toEqual(Array.from(W));
    await cache.put(`${ORIGIN}${URL_W}`, new Response(W as unknown as BodyInit)); // an absolute URL on our origin is accepted too
    expect(await cache.match(`${ORIGIN}${URL_W}`)).toBeDefined();
  });

  it('refuses to store a tampered file, and stores nothing', async () => {
    const { cache, stores } = await setup();
    const bad = W.slice();
    bad[5] ^= 1;
    await expect(cache.put(URL_W, new Response(bad as unknown as BodyInit))).rejects.toMatchObject({ code: 'hash' });
    expect(stores.get('speech-model-abcdef01')?.size ?? 0).toBe(0);
  });

  it('refuses to store a wrong-size file', async () => {
    const { cache } = await setup();
    await expect(cache.put(URL_W, new Response(W.slice(0, 4) as unknown as BodyInit))).rejects.toMatchObject({ code: 'size' });
  });

  it('a corrupted cached file is rejected, removed, and counted', async () => {
    const { cache, stores } = await setup();
    await cache.put(URL_W, new Response(W as unknown as BodyInit));
    const store = stores.get('speech-model-abcdef01')!;
    const bad = store.get(URL_W)!.slice();
    bad[0] ^= 1; // flipped on disk
    store.set(URL_W, bad);
    expect(await cache.match(URL_W)).toBeUndefined();
    expect(store.has(URL_W)).toBe(false);
    expect(cache.stats.rejected).toBe(1);
  });

  it('a truncated cached file (wrong size) is rejected the same way', async () => {
    const { cache, stores } = await setup();
    await cache.put(URL_W, new Response(W as unknown as BodyInit));
    const store = stores.get('speech-model-abcdef01')!;
    store.set(URL_W, store.get(URL_W)!.slice(0, 10));
    expect(await cache.match(URL_W)).toBeUndefined();
    expect(cache.stats.rejected).toBe(1);
  });

  it('never matches or stores a key on another origin, an unpinned path, or a file that belongs to another cache', async () => {
    const { cache, stores } = await setup();
    expect(await cache.match('https://huggingface.co/acme/tiny/resolve/main/onnx/model.onnx')).toBeUndefined();
    expect(await cache.match('/models/acme/tiny/other.onnx')).toBeUndefined();
    expect(await cache.match(URL_RT)).toBeUndefined(); // runtime file: belongs to the runtime cache
    await expect(cache.put(URL_RT, new Response(RT as unknown as BodyInit))).rejects.toBeInstanceOf(IntegrityError);
    await expect(cache.put('https://evil.test/models/acme/tiny/onnx/model.onnx', new Response(W as unknown as BodyInit))).rejects.toBeInstanceOf(IntegrityError);
    expect(stores.size).toBe(0);
  });

  it('works as an empty cache when Cache Storage is missing or throws', async () => {
    const { env } = await setup();
    const none = new VerifiedCache('speech-model-abcdef01', env, undefined);
    expect(await none.match(URL_W)).toBeUndefined();
    await none.put(URL_W, new Response(W as unknown as BodyInit)); // verified, then nowhere to store: no error
    const throwing = new VerifiedCache('speech-model-abcdef01', env, {
      open: async () => {
        throw new Error('blocked');
      },
      delete: async () => false,
      keys: async () => [],
    });
    expect(await throwing.match(URL_W)).toBeUndefined();
  });
});

describe('loadPinnedFile', () => {
  it('downloads once, stores after verifying, then serves from the cache without a request', async () => {
    const { env, cache, fetchImpl } = await setup();
    const first = await loadPinnedFile(URL_W, cache, env);
    expect(first.fromCache).toBe(false);
    const second = await loadPinnedFile(URL_W, cache, env);
    expect(second.fromCache).toBe(true);
    expect(fetchImpl.calls.length).toBe(1);
  });

  it('a corrupted cached file is rejected and downloaded again (and the new copy is checked too)', async () => {
    const { env, cache, fetchImpl, stores } = await setup();
    await loadPinnedFile(URL_W, cache, env);
    const store = stores.get('speech-model-abcdef01')!;
    const bad = store.get(URL_W)!.slice();
    bad[1] ^= 1;
    store.set(URL_W, bad);
    const again = await loadPinnedFile(URL_W, cache, env);
    expect(again.fromCache).toBe(false);
    expect(Array.from(again.bytes)).toEqual(Array.from(W));
    expect(fetchImpl.calls.length).toBe(2);
    expect(Array.from(store.get(URL_W)!)).toEqual(Array.from(W)); // repaired
  });

  it('a tampered download is refused and not cached; a missing file is refused; the app can carry on without it', async () => {
    const { manifest, storage, stores } = await setup();
    const bad = W.slice();
    bad[2] ^= 1;
    const tampered = envFor(manifest, fakeFetch({ [URL_W]: bad }));
    const cache = new VerifiedCache('speech-model-abcdef01', tampered, storage);
    await expect(loadPinnedFile(URL_W, cache, tampered)).rejects.toMatchObject({ code: 'hash' });
    expect(stores.get('speech-model-abcdef01')?.size ?? 0).toBe(0);
    const absent = envFor(manifest, fakeFetch({}));
    await expect(loadPinnedFile(URL_W, new VerifiedCache('speech-model-abcdef01', absent, storage), absent)).rejects.toMatchObject({ code: 'missing' });
  });

  it('the runtime key may carry a query; the same file is found', async () => {
    const { manifest, env, storage } = await setup();
    const rtCache = new VerifiedCache(manifest.runtime.cacheName, env, storage);
    const key = `${URL_RT}?ort=test`;
    const a = await loadPinnedFile(URL_RT, rtCache, env, undefined, key);
    const b = await loadPinnedFile(URL_RT, rtCache, env, undefined, key);
    expect([a.fromCache, b.fromCache]).toEqual([false, true]);
  });
});

describe('removeHelperFiles', () => {
  it('deletes every helper cache, including ones from older revisions, and nothing else', async () => {
    const { manifest, storage, stores } = await setup();
    for (const n of ['speech-model-abcdef01', 'speech-model-00000000', manifest.runtime.cacheName, 'ml-runtime-old', 'unrelated-cache']) await storage.open(n);
    const removed = await removeHelperFiles(storage, manifest);
    expect(removed.sort()).toEqual(['ml-runtime-old', 'ml-runtime-test', 'speech-model-00000000', 'speech-model-abcdef01']);
    expect([...stores.keys()]).toEqual(['unrelated-cache']);
  });
  it('is a no-op without Cache Storage', async () => {
    expect(await removeHelperFiles(undefined)).toEqual([]);
  });
  it('the name pattern matches only helper cache names', () => {
    expect(HELPER_CACHE_PATTERN.test('speech-model-1846881b')).toBe(true);
    expect(HELPER_CACHE_PATTERN.test('workbox-precache')).toBe(false);
  });
});
