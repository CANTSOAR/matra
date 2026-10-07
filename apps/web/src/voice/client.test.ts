import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wipeAll } from '../lib/wipe';
import { isTranscriberSetUp, loadTranscriber, preloadTranscriber, setWorkerFactory, terminateTranscriber, transcribe, WipedError } from './client';
import { MODEL_WEIGHT_PATHS, RUNTIME_FILES, runtimeCacheKey } from './config';
import { FakeWorker } from './fakeWorker.test-util';

beforeEach(() => {
  FakeWorker.reset();
  setWorkerFactory(() => new FakeWorker());
});
afterEach(() => setWorkerFactory());

describe('transcriber client', () => {
  it('loads once, reports byte progress, resolves with the device', async () => {
    const seen: number[] = [];
    const p = preloadTranscriber((pct) => seen.push(pct));
    const again = loadTranscriber();
    const w = FakeWorker.latest();
    expect(FakeWorker.instances).toHaveLength(1);
    expect(w.received).toEqual([{ type: 'load', prefer: 'auto' }]);
    w.emit({ type: 'load-progress', loaded: 25, total: 100, fromCache: false });
    w.emit({ type: 'load-progress', loaded: 100, total: 100, fromCache: false });
    w.emit({ type: 'ready', device: 'wasm', loadMs: 5 });
    await p;
    await expect(again).resolves.toBe('wasm');
    expect(seen).toEqual([25, 100]);
    // already loaded: no second load message
    await expect(loadTranscriber()).resolves.toBe('wasm');
    expect(w.received.filter((m) => m.type === 'load')).toHaveLength(1);
  });

  it('transfers the audio buffer and relays progress + result', async () => {
    const audio = new Float32Array(16000);
    const progress: number[] = [];
    const p = transcribe(audio, 16000, (f) => progress.push(f));
    const w = FakeWorker.latest();
    const msg = w.lastTranscribe()!;
    expect(msg.sampleRate).toBe(16000);
    expect(msg.audio).toBe(audio);
    w.emit({ type: 'progress', id: msg.id, fraction: 0.5, partial: 'hello' });
    w.emit({ type: 'result', id: msg.id, text: 'hello there', language: 'en', durationSec: 1, elapsedMs: 10 });
    await expect(p).resolves.toMatchObject({ text: 'hello there', language: 'en', durationSec: 1 });
    expect(progress).toEqual([0.5]);
  });

  it('a failed load rejects, and the next load retries', async () => {
    const p = loadTranscriber();
    FakeWorker.latest().emit({ type: 'error', code: 'load_failed', message: 'model missing' });
    await expect(p).rejects.toThrow('model missing');
    const retry = loadTranscriber();
    expect(FakeWorker.latest().received.filter((m) => m.type === 'load')).toHaveLength(2);
    FakeWorker.latest().emit({ type: 'ready', device: 'wasm', loadMs: 1 });
    await expect(retry).resolves.toBe('wasm');
  });

  it('terminate kills the worker and fails anything in flight', async () => {
    const load = loadTranscriber();
    const job = transcribe(new Float32Array(10), 16000);
    const w = FakeWorker.latest();
    terminateTranscriber();
    expect(w.terminated).toBe(true);
    await expect(load).rejects.toBeInstanceOf(WipedError);
    await expect(job).rejects.toBeInstanceOf(WipedError);
    // next use starts a fresh worker
    void loadTranscriber();
    expect(FakeWorker.instances).toHaveLength(2);
  });

  it('Quick Exit (wipeAll) and the matra:wipe event both terminate the worker', () => {
    void loadTranscriber();
    const w1 = FakeWorker.latest();
    wipeAll();
    expect(w1.terminated).toBe(true);

    void loadTranscriber();
    const w2 = FakeWorker.latest();
    expect(w2).not.toBe(w1);
    window.dispatchEvent(new Event('matra:wipe'));
    expect(w2.terminated).toBe(true);
  });

  it('isTranscriberSetUp is false without the Cache API, true when model + runtime are cached', async () => {
    expect(await isTranscriberSetUp()).toBe(false);
    const store = new Set<string>();
    vi.stubGlobal('caches', {
      open: async () => ({ match: async (k: string) => (store.has(k) ? new Response('x') : undefined) }),
    });
    expect(await isTranscriberSetUp()).toBe(false);
    for (const p of MODEL_WEIGHT_PATHS) store.add(p);
    expect(await isTranscriberSetUp()).toBe(false);
    store.add(runtimeCacheKey(RUNTIME_FILES.wasm));
    expect(await isTranscriberSetUp()).toBe(true);
    vi.unstubAllGlobals();
  });
});
