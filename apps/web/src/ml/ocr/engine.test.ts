import { describe, expect, it, vi } from 'vitest';
import { MANIFEST, modelById, type Manifest, type ModelEntry } from '../manifest';
import { sha256Hex } from '../verify';
import { wipeAll } from '../../lib/wipe';
import { ORIGIN, enc, envFor, fakeFetch } from '../testkit.test-util';
import { OCR_MODEL_ID, OcrUnavailableError, assertOcrCodeUrls, readTextFromImage, type WorkerLike } from './engine';

const LANG = enc('pretend this is gzipped english data');
async function setup(served?: Record<string, Uint8Array | { status: number }>) {
  const model: ModelEntry = {
    id: OCR_MODEL_ID,
    task: 'ocr',
    revision: 'test',
    dtype: 'lstm-int8',
    base: '/models/tesseract/eng-best-int/',
    cacheName: 'ml-model-ocr-test',
    files: [{ path: 'eng.traineddata.bin', size: LANG.length, sha256: await sha256Hex(LANG) }],
  };
  const manifest: Manifest = { ...MANIFEST, models: [model] };
  const fetchImpl = fakeFetch(served ?? { '/models/tesseract/eng-best-int/eng.traineddata.bin': LANG });
  return { model, manifest, fetchImpl, env: envFor(manifest, fetchImpl) };
}

const CODE = { worker: '/assets/worker.min-abc123.js', core: '/assets/tesseract-core-simd-lstm.wasm-def456.js' };

/** A worker that speaks the tesseract.js worker script's protocol, answering every job, and records what it was sent. */
function fakeWorker(text: string, opts: { failAt?: string } = {}) {
  const sent: Array<{ action: string; payload: any }> = [];
  const terminate = vi.fn();
  const w: WorkerLike = {
    onmessage: null,
    onerror: null,
    terminate,
    postMessage(m: any) {
      sent.push({ action: m.action, payload: m.payload });
      queueMicrotask(() => {
        const reply = (status: string, data: unknown) => w.onmessage?.({ data: { jobId: m.jobId, workerId: m.workerId, action: m.action, status, data } });
        if (opts.failAt === m.action) return reply('reject', 'Error: boom');
        if (m.action === 'recognize') reply('progress', { status: 'recognizing text', progress: 0.5 });
        reply('resolve', m.action === 'recognize' ? { text } : { ok: true });
      });
    },
  };
  return { w, sent, terminate, spawn: vi.fn((_url: string) => w) };
}
const image = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });

describe('on-device text reading', () => {
  it('returns the engine’s text exactly: no cleanup, correction, trimming or summary', async () => {
    const odd = '  Thsi  is  a recipt \n\n  Total:  $ 12 .50\t\n  Pay by 03/04/2O26 \n';
    const { env, model } = await setup();
    const f = fakeWorker(odd);
    const res = await readTextFromImage(image, { env, model, spawnWorker: f.spawn, codeUrls: CODE });
    expect(res.text).toBe(odd);
    expect(res.engine).toMatch(/tesseract/i);
  });

  it('starts the worker from our own build file and gives it the verified language data as bytes, the core as a file, no CDN, no IndexedDB copy', async () => {
    const { env, model, fetchImpl } = await setup();
    const f = fakeWorker('x');
    const progress: string[] = [];
    await readTextFromImage(image, { env, model, spawnWorker: f.spawn, codeUrls: CODE, onProgress: (p) => progress.push(p.status) });
    expect(f.spawn).toHaveBeenCalledWith(CODE.worker);
    expect(f.sent.map((m) => m.action)).toEqual(['load', 'loadLanguage', 'initialize', 'recognize']);
    const [load, lang, init, rec] = f.sent.map((m) => m.payload);
    expect(load.options).toMatchObject({ lstmOnly: true, logging: false });
    expect(String(load.options.corePath)).toBe(`${ORIGIN}${CODE.core}`);
    expect(String(load.options.corePath).endsWith('js')).toBe(true); // a file, so the engine never picks a default (a CDN)
    expect(lang.langs).toHaveLength(1);
    expect(lang.langs[0].code).toBe('eng');
    expect(Array.from(lang.langs[0].data)).toEqual(Array.from(LANG));
    expect(lang.options).toMatchObject({ cacheMethod: 'none', gzip: true });
    expect(init).toMatchObject({ langs: 'eng', oem: 1 }); // the NAME, not the bytes
    expect(Array.from(rec.image)).toEqual([1, 2, 3]);
    expect(rec.output).toEqual({ text: true });
    // the only request made was for the pinned language file, on our own origin
    expect(fetchImpl.calls).toEqual(['/models/tesseract/eng-best-int/eng.traineddata.bin']);
    expect(f.terminate).toHaveBeenCalledTimes(1);
    expect(progress).toContain('Reading the text…');
  });

  it('refuses language data that is not the pinned file: nothing is read and no engine is started', async () => {
    const tampered = new Uint8Array(LANG);
    tampered[0] ^= 1;
    const { env, model } = await setup({ '/models/tesseract/eng-best-int/eng.traineddata.bin': tampered });
    const f = fakeWorker('x');
    await expect(readTextFromImage(image, { env, model, spawnWorker: f.spawn, codeUrls: CODE })).rejects.toMatchObject({ name: 'OcrUnavailableError', message: expect.stringMatching(/did not pass its safety check/) });
    expect(f.spawn).not.toHaveBeenCalled();
    // a short file too
    const short = await setup({ '/models/tesseract/eng-best-int/eng.traineddata.bin': LANG.slice(0, 5) });
    await expect(readTextFromImage(image, { env: short.env, model: short.model, spawnWorker: fakeWorker('x').spawn, codeUrls: CODE })).rejects.toBeInstanceOf(OcrUnavailableError);
    // and a missing one
    const gone = await setup({});
    await expect(readTextFromImage(image, { env: gone.env, model: gone.model, spawnWorker: fakeWorker('x').spawn, codeUrls: CODE })).rejects.toMatchObject({ message: expect.stringMatching(/not part of this copy/) });
  });

  it('refuses code that is not a build asset of this app: a /models/ file, another origin, a CDN', () => {
    expect(() => assertOcrCodeUrls([CODE.worker, CODE.core], ORIGIN)).not.toThrow();
    for (const bad of ['/models/tesseract/worker.min.js', 'https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/worker.min.js', '//evil.test/assets/x.js', `${ORIGIN}.evil.test/assets/x.js`, '/x.js'])
      expect(() => assertOcrCodeUrls([bad], ORIGIN), bad).toThrow(/build asset/);
  });

  it('reports an engine that will not start as unavailable, with the worker ended; her file is untouched', async () => {
    const { env, model } = await setup();
    for (const failAt of ['load', 'loadLanguage', 'initialize', 'recognize']) {
      const f = fakeWorker('x', { failAt });
      const err = await readTextFromImage(image, { env, model, spawnWorker: f.spawn, codeUrls: CODE }).catch((e) => e);
      expect(err, failAt).toBeInstanceOf(OcrUnavailableError);
      expect(String(err.message)).toMatch(/Your file is not affected/);
      expect(f.terminate, failAt).toHaveBeenCalled();
    }
    // a worker that dies
    const dead = fakeWorker('x');
    dead.w.postMessage = () => queueMicrotask(() => dead.w.onerror?.({ message: 'script error' }));
    await expect(readTextFromImage(image, { env, model, spawnWorker: () => dead.w, codeUrls: CODE })).rejects.toBeInstanceOf(OcrUnavailableError);
  });

  it('lock, sign-out and Quick exit stop a read in progress: the worker ends and no text comes back', async () => {
    const { env, model } = await setup();
    const f = fakeWorker('secret words');
    const original = f.w.postMessage.bind(f.w);
    f.w.postMessage = (m: any) => {
      if (m.action === 'initialize') wipeAll(); // she locks while the reader is starting
      original(m);
    };
    const err = await readTextFromImage(image, { env, model, spawnWorker: () => f.w, codeUrls: CODE }).catch((e) => e);
    expect(err).toBeInstanceOf(OcrUnavailableError);
    expect(String(err.message)).toMatch(/stopped/);
    expect(f.terminate).toHaveBeenCalled();
    expect(f.sent.map((m) => m.action)).not.toContain('recognize');
  });

  it('a wipe mid-job rejects the pending job, detaches the worker and keeps nothing (the worker is gone and never answers)', async () => {
    const { env, model } = await setup();
    // like a real terminated worker: once ended, it never replies again
    let ended = false;
    let handler: WorkerLike['onmessage'] = null;
    const w: WorkerLike = {
      onmessage: null,
      onerror: null,
      terminate: vi.fn(() => {
        ended = true;
      }),
      postMessage(m: any) {
        handler = w.onmessage; // the handler a late message would have reached
        if (m.action === 'recognize') return wipeAll(); // she locks while the text is being read; no reply will come
        queueMicrotask(() => {
          if (!ended) w.onmessage?.({ data: { jobId: m.jobId, workerId: m.workerId, action: m.action, status: 'resolve', data: { ok: true } } });
        });
      },
    };
    const outcome = await Promise.race([
      readTextFromImage(image, { env, model, spawnWorker: () => w, codeUrls: CODE }).then(
        (r) => ({ resolved: r }),
        (e) => ({ rejected: e }),
      ),
      new Promise((r) => setTimeout(() => r({ hung: true }), 1500)),
    ]);
    expect(outcome).toHaveProperty('rejected');
    expect((outcome as { rejected: Error }).rejected).toBeInstanceOf(OcrUnavailableError);
    expect(w.terminate).toHaveBeenCalled();
    // nothing is retained: the worker no longer points back at this module, and a late answer is ignored
    expect(w.onmessage).toBeNull();
    expect(w.onerror).toBeNull();
    expect(() => handler?.({ data: { jobId: 'job-4', status: 'resolve', data: { text: 'late secret words' } } })).not.toThrow();
  });

  it('a wipe also rejects every other job still waiting, and the engine ignores messages sent after it', async () => {
    const { env, model } = await setup();
    const f = fakeWorker('should never be read');
    const seen: string[] = [];
    const orig = f.w.postMessage.bind(f.w);
    f.w.postMessage = (m: any) => {
      seen.push(m.action);
      if (m.action === 'load') {
        // two jobs outstanding at once, then the wipe
        f.w.onmessage?.({ data: { jobId: 'job-99', status: 'progress', data: {} } });
        wipeAll();
        return; // never answered
      }
      orig(m);
    };
    const err = await readTextFromImage(image, { env, model, spawnWorker: () => f.w, codeUrls: CODE }).catch((e) => e);
    expect(err).toBeInstanceOf(OcrUnavailableError);
    expect(seen).toEqual(['load']); // nothing sent after the wipe
    expect(f.w.onmessage).toBeNull();
  });

  it('the real manifest pins the OCR data and both code files, with a licence-checked npm source', () => {
    const m = modelById(OCR_MODEL_ID);
    expect(m.task).toBe('ocr');
    expect(m.files).toHaveLength(1);
    expect(m.files[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(m.bundled!.map((b) => b.role).sort()).toEqual(['ocr-core', 'ocr-worker']);
    for (const b of m.bundled!) expect(b.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(m.base).toMatch(/^\/models\//);
    // total size stays small (the plan's budget for OCR is about 20 MB)
    const total = m.files.reduce((n, f) => n + f.size, 0) + m.bundled!.reduce((n, b) => n + b.size, 0);
    expect(total).toBeLessThan(20_000_000);
  });
});
