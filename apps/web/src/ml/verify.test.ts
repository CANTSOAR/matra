import { describe, expect, it } from 'vitest';
import { MANIFEST, findPinned, listPinned, cacheNames } from './manifest';
import { IntegrityError, fetchVerified, localPathOf, makeVerifiedFetch, sha256Hex, verifyBytes } from './verify';
import { ORIGIN, enc, envFor, fakeFetch, makeManifest } from './testkit.test-util';

const RT = enc('pretend this is a wasm runtime');
const W = enc('pretend these are model weights, a few more bytes');
const TK = enc('{"tokenizer":"pretend"}');
const URL_W = '/models/acme/tiny/onnx/model.onnx';
const URL_TK = '/models/acme/tiny/tokenizer.json';
const URL_RT = '/models/ort/rt.wasm';

async function setup(served?: Record<string, Uint8Array | { status: number }>) {
  const manifest = await makeManifest({ runtime: RT, weights: W, tokenizer: TK });
  const fetchImpl = fakeFetch(served ?? { [URL_W]: W, [URL_TK]: TK, [URL_RT]: RT });
  return { manifest, fetchImpl, env: envFor(manifest, fetchImpl) };
}
const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(IntegrityError);
    return (e as IntegrityError).code;
  }
  return 'no error';
};

describe('the real manifest', () => {
  const all = listPinned();
  it('pins every file by size and a 64-hex SHA-256, under /models/ on our own origin', () => {
    expect(all.length).toBeGreaterThan(5);
    for (const p of all) {
      expect(p.file.sha256, p.url).toMatch(/^[0-9a-f]{64}$/);
      expect(p.file.size, p.url).toBeGreaterThan(0);
      expect(p.url, p.url).toMatch(/^\/models\/[^:]+$/); // a path, never a URL with a host
      expect(p.url).not.toMatch(/\.\./);
    }
    expect(new Set(all.map((p) => p.url)).size).toBe(all.length);
  });
  it('lists the model, its tokenizer files and every wasm file the app loads', () => {
    const urls = all.map((p) => p.url);
    expect(urls.some((u) => u.endsWith('/tokenizer.json'))).toBe(true);
    expect(urls.some((u) => u.endsWith('.onnx'))).toBe(true);
    expect(urls.filter((u) => u.endsWith('.wasm')).length).toBeGreaterThanOrEqual(2);
    // the CPU glue is code the browser cannot check at run time, so it is built into the app instead of served from /models/
    expect(urls.some((u) => u.endsWith('.mjs'))).toBe(false);
    expect(MANIFEST.runtime.bundled.map((b) => b.role)).toEqual(['cpu-glue']);
    expect(MANIFEST.runtime.bundled[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('uses neutral cache names: no app name, revision-scoped', () => {
    for (const n of cacheNames()) expect(n).toMatch(/^(speech-model|ml-runtime|ml-model)-[0-9a-z-]+$/);
    expect(findPinned('/models/ort/not-listed.wasm')).toBeUndefined();
  });
});

describe('localPathOf', () => {
  it('accepts a bare path and an absolute URL on our origin, and drops the query', () => {
    expect(localPathOf('/models/x?ort=1', ORIGIN)).toBe('/models/x');
    expect(localPathOf(`${ORIGIN}/models/x#h`, ORIGIN)).toBe('/models/x');
  });
  it('refuses another origin, including look-alikes and protocol-relative URLs', () => {
    for (const u of ['https://huggingface.co/models/x', 'https://cdn.jsdelivr.net/npm/x', `${ORIGIN}.evil.test/models/x`, '//evil.test/models/x', 'http://matra.test/models/x'])
      expect(() => localPathOf(u, ORIGIN), u).toThrow(IntegrityError);
  });
});

describe('verifyBytes / fetchVerified', () => {
  it('returns the bytes of a good file', async () => {
    const { env } = await setup();
    const { bytes, pinned } = await fetchVerified(URL_W, env);
    expect(await sha256Hex(bytes)).toBe(pinned.file.sha256);
    expect(bytes.length).toBe(W.length);
  });

  it('refuses a tampered file of the same size (hash mismatch)', async () => {
    const bad = W.slice();
    bad[3] ^= 1;
    const { env } = await setup({ [URL_W]: bad });
    expect(await code(fetchVerified(URL_W, env))).toBe('hash');
  });

  it('refuses a file that is too short or too long (wrong size)', async () => {
    const short = await setup({ [URL_W]: W.slice(0, W.length - 1) });
    expect(await code(fetchVerified(URL_W, short.env))).toBe('size');
    const long = await setup({ [URL_W]: new Uint8Array([...W, 0]) });
    expect(await code(fetchVerified(URL_W, long.env))).toBe('size');
  });

  it('stops reading a body that is far larger than the pinned size', async () => {
    const { manifest } = await setup();
    let pulled = 0;
    const big = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled += 1024;
        c.enqueue(new Uint8Array(1024));
        if (pulled > 1_000_000) c.close();
      },
    });
    const env = envFor(manifest, async () => new Response(big, { status: 200 }));
    expect(await code(fetchVerified(URL_W, env))).toBe('size');
    expect(pulled).toBeLessThan(10_000);
  });

  it('reports a missing file (404) and a server error, and never returns bytes for them', async () => {
    const missing = await setup({});
    expect(await code(fetchVerified(URL_W, missing.env))).toBe('missing');
    const broken = await setup({ [URL_W]: { status: 500 } });
    expect(await code(fetchVerified(URL_W, broken.env))).toBe('bad-status');
  });

  it('never makes a request for another origin or an unpinned path', async () => {
    const { env, fetchImpl } = await setup();
    expect(await code(fetchVerified('https://huggingface.co/acme/tiny/resolve/main/onnx/model.onnx', env))).toBe('foreign-origin');
    expect(await code(fetchVerified('/models/acme/tiny/onnx/other.onnx', env))).toBe('unpinned');
    expect(await code(fetchVerified('/models/acme/tiny/../tiny/onnx/model.onnx/../../../../../etc/passwd', env))).toBe('unpinned');
    expect(fetchImpl.calls).toEqual([]);
  });

  it('refuses a response that says it came from another origin', async () => {
    const { manifest } = await setup();
    const env = envFor(manifest, async () => {
      const r = new Response(W as unknown as BodyInit, { status: 200 });
      Object.defineProperty(r, 'url', { value: 'https://evil.test/models/acme/tiny/onnx/model.onnx' });
      return r;
    });
    expect(await code(fetchVerified(URL_W, env))).toBe('foreign-origin');
  });

  it('verifyBytes refuses a manifest entry without a valid hash', async () => {
    const { manifest } = await setup();
    const p = listPinned(manifest)[1];
    await expect(verifyBytes({ ...p, file: { ...p.file, sha256: 'nope' } }, W)).rejects.toMatchObject({ code: 'hash' });
  });
});

describe('makeVerifiedFetch (what transformers.js is given)', () => {
  it('serves a pinned file as a 200 and reports progress', async () => {
    const { env } = await setup();
    const seen: number[] = [];
    const f = makeVerifiedFetch(env, (_p, loaded) => seen.push(loaded));
    const res = await f(URL_W);
    expect(res.status).toBe(200);
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(Array.from(W));
    expect(seen.at(-1)).toBe(W.length);
  });
  it('answers 404 for an unpinned file under /models/ without any request (optional files are simply absent)', async () => {
    const { env, fetchImpl } = await setup();
    const res = await makeVerifiedFetch(env)('/models/acme/tiny/added_tokens.json');
    expect(res.status).toBe(404);
    expect(fetchImpl.calls).toEqual([]);
  });
  it('answers 404 for a pinned file the server does not have, so a required file fails the load', async () => {
    const { env } = await setup({});
    expect((await makeVerifiedFetch(env)(URL_TK)).status).toBe(404);
  });
  it('throws on a tampered file and on any other origin', async () => {
    const bad = TK.slice();
    bad[0] ^= 1;
    const { env } = await setup({ [URL_TK]: bad });
    const f = makeVerifiedFetch(env);
    await expect(f(URL_TK)).rejects.toMatchObject({ code: 'hash' });
    await expect(f('https://huggingface.co/acme/tiny/resolve/main/tokenizer.json')).rejects.toMatchObject({ code: 'foreign-origin' });
  });
});
