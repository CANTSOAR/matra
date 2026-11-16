/** Test helpers for src/ml: a tiny manifest over real (small) bytes, a fake Cache Storage, and a fake origin. */
import type { Manifest } from './manifest';
import { sha256Hex, type FetchLike, type LoaderEnv } from './verify';

export const ORIGIN = 'https://matra.test';

export const enc = (s: string) => new TextEncoder().encode(s);

export interface Served {
  [path: string]: Uint8Array | { status: number } | undefined;
}

/** A manifest with one runtime file and one two-file model, pinned to the given bytes. */
export async function makeManifest(files: { runtime: Uint8Array; weights: Uint8Array; tokenizer: Uint8Array }): Promise<Manifest> {
  return {
    schema: 1,
    runtime: {
      package: 'onnxruntime-web',
      version: 'test',
      base: '/models/ort/',
      cacheName: 'ml-runtime-test',
      bundled: [],
      files: [{ role: 'cpu-wasm', path: 'rt.wasm', size: files.runtime.length, sha256: await sha256Hex(files.runtime) }],
    },
    models: [
      {
        id: 'acme/tiny',
        task: 'test',
        revision: 'abcdef0123456789',
        dtype: 'q8',
        base: '/models/acme/tiny/',
        cacheName: 'speech-model-abcdef01',
        files: [
          { path: 'onnx/model.onnx', size: files.weights.length, sha256: await sha256Hex(files.weights) },
          { path: 'tokenizer.json', size: files.tokenizer.length, sha256: await sha256Hex(files.tokenizer) },
        ],
      },
    ],
  };
}

/** A fetch that serves `served` by pathname, records every URL it is asked for, and answers 404 for anything else. */
export function fakeFetch(served: Served): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (input: string) => {
    calls.push(String(input));
    const path = new URL(String(input), ORIGIN).pathname;
    const v = served[path];
    if (!v) return new Response(null, { status: 404 });
    if (!ArrayBuffer.isView(v)) return new Response(null, { status: (v as { status: number }).status });
    return new Response(v as unknown as BodyInit, { status: 200 });
  }) as FetchLike & { calls: string[] };
  fn.calls = calls;
  return fn;
}

export function envFor(manifest: Manifest, fetchImpl: FetchLike): LoaderEnv {
  return { manifest, origin: ORIGIN, fetchImpl };
}

/** In-memory CacheStorage (open / delete / keys) whose caches support match / put / delete by key string. */
export function fakeCacheStorage() {
  const stores = new Map<string, Map<string, Uint8Array>>();
  const make = (name: string) => {
    const m = stores.get(name) ?? new Map<string, Uint8Array>();
    stores.set(name, m);
    return {
      async match(key: string) {
        const v = m.get(String(key));
        return v ? new Response(v.slice() as unknown as BodyInit) : undefined;
      },
      async put(key: string, res: Response) {
        m.set(String(key), new Uint8Array(await res.arrayBuffer()));
      },
      async delete(key: string) {
        return m.delete(String(key));
      },
    } as unknown as Cache;
  };
  const storage = {
    open: async (name: string) => make(name),
    delete: async (name: string) => stores.delete(name),
    keys: async () => [...stores.keys()],
  } as unknown as CacheStorage;
  return { storage, stores };
}
