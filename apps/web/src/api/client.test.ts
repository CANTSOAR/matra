import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, envelopeHash } from './client';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('ApiClient', () => {
  it('attaches the bearer token', async () => {
    const fetchImpl = vi.fn(async () => ok({ records: [] }));
    const api = new ApiClient({ getToken: () => 'secret-token', fetchImpl: fetchImpl as unknown as typeof fetch });
    await api.listRecords();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/vault/records');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer secret-token');
    expect(init.credentials).toBe('omit');
  });

  it('omits Authorization without a token and sends JSON bodies', async () => {
    const fetchImpl = vi.fn(async () => ok({ token: 't', user: {} }));
    const api = new ApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await api.login({ username: 'a', authKey: 'k' });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const h = init.headers as Record<string, string>;
    expect(h['Authorization']).toBeUndefined();
    expect(h['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({ username: 'a', authKey: 'k' });
  });

  it('throws ApiError with the server message and code', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: 'nope', code: 'forbidden' }), { status: 403 }));
    const api = new ApiClient({ getToken: () => 't', fetchImpl: fetchImpl as unknown as typeof fetch });
    const err = await api.getRecord('x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, message: 'nope', code: 'forbidden' });
  });

  it('throws ApiError on non-JSON errors and network failures', async () => {
    const bad = new ApiClient({ fetchImpl: (async () => new Response('oops', { status: 500 })) as unknown as typeof fetch });
    await expect(bad.health()).rejects.toMatchObject({ status: 500 });
    const down = new ApiClient({ fetchImpl: (async () => { throw new TypeError('fail'); }) as unknown as typeof fetch });
    await expect(down.health()).rejects.toMatchObject({ status: 0, code: 'network' });
  });

  it('uploads blobs as octet-stream with base64(JSON) wrapped key header', async () => {
    const fetchImpl = vi.fn(async () => ok({ blob: {}, ledgerEntry: {} }));
    const api = new ApiClient({ getToken: () => 't', fetchImpl: fetchImpl as unknown as typeof fetch });
    const wk = { v: 1 as const, alg: 'A256GCM-KW' as const, iv: 'aXY=', data: 'ZGF0YQ==' };
    await api.uploadBlob(new Uint8Array([1, 2, 3]), wk);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const h = init.headers as Record<string, string>;
    expect(h['Content-Type']).toBe('application/octet-stream');
    expect(JSON.parse(atob(h['X-Owner-Wrapped-Key']))).toEqual(wk);
  });
});

describe('envelopeHash', () => {
  it('matches a known vector (SHA-256 of JSON.stringify({v,alg,iv,ct}))', async () => {
    // printf '%s' '{"v":1,"alg":"A256GCM","iv":"AAAAAAAAAAAAAAAA","ct":"aGVsbG8="}' | shasum -a 256
    const h = await envelopeHash({ ct: 'aGVsbG8=', iv: 'AAAAAAAAAAAAAAAA', alg: 'A256GCM', v: 1 });
    expect(h).toBe('d8833282bca3cb5ca281f37cc62c2e12f4a67493a11afa9af7e4f61048bce613');
  });
});
