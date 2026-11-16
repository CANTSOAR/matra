/**
 * On-device text reading (OCR) for an image, with tesseract.js (Apache-2.0), English only (PR 32, plan 8.5).
 *
 * What it does: turns the pixels of one image into the text printed on it. The text is returned EXACTLY as the engine read
 * it: no cleanup, no spelling correction, no reordering, no summary. It does not say what an image shows, and it does not
 * look at faces or objects (it has no such model).
 *
 * Where everything comes from (threat model W23): our own origin only; the CSP's `connect-src 'self'` would stop anything
 * else anyway. Three files, all pinned in src/ml/manifest.json:
 *   - the English language data: fetched from /models/ and checked in the browser (size and SHA-256) before use, through the
 *     same verified loader and cache as the speech model (src/ml/verify.ts, cache.ts), then handed to the engine as bytes,
 *     so the engine never makes a request of its own (and keeps no copy of its own in IndexedDB: cacheMethod 'none');
 *   - the tesseract.js worker script and its WebAssembly core: CODE the browser starts from a URL, so it cannot be checked
 *     by a fetch-then-run (the bytes that run would be a second fetch). Both are built INTO the app as content-hashed files
 *     (`?url` below), pinned at build time (vite.config.ts, scripts/fetch-models.mjs, scripts/audit-web-build.mjs).
 *
 * It talks to tesseract.js's worker script with the small message protocol that script implements (load, loadLanguage,
 * initialize, recognize) rather than through the library's `createWorker`: in tesseract.js 7.0.0 a language handed in as bytes
 * is loaded correctly but then used as the language NAME at initialisation, so `createWorker` cannot take our verified bytes.
 * The protocol is that of the pinned worker script (manifest.json, models[].bundled); a test with the real worker checks it.
 *
 * It runs only when she asks for it (the caller is a button), starts the engine on demand, and ends its worker when done.
 */
import { loadPinnedFile, VerifiedCache } from '../cache';
import { modelById, type ModelEntry } from '../manifest';
import { defaultEnv, IntegrityError, type LoaderEnv } from '../verify';
import { onWipe } from '../../lib/wipe';
// The engine's code, built into the app (see manifest.json, models[].bundled): never a /models/ file.
import ocrWorkerUrl from 'tesseract.js/dist/worker.min.js?url';
import ocrCoreUrl from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url';

export const OCR_MODEL_ID = 'tesseract/eng-best-int';
export const OCR_ENGINE_LABEL = 'tesseract.js 7.0.0, English';

export interface OcrResult {
  /** exactly what the engine read */
  text: string;
  engine: string;
}

export interface OcrProgress {
  /** plain words for a status line */
  status: string;
  /** 0 to 1, or undefined when not known */
  fraction?: number;
}

/** The part of a Web Worker this module uses (so tests can pass a fake). */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((e: { data: any }) => void) | null;
  onerror: ((e: { message?: string }) => void) | null;
}

export class OcrUnavailableError extends Error {
  readonly friendly = true;
  constructor(detail?: string) {
    super(
      'Reading text from images isn’t available in this copy of Matra' + (detail ? ` (${detail})` : '') + '. Your file is not affected.',
    );
    this.name = 'OcrUnavailableError';
  }
}

/** The code URLs must be this app's own build assets, never a file under /models/ and never another origin. */
export function assertOcrCodeUrls(urls: string[], origin = 'http://localhost'): void {
  for (const u of urls) {
    const url = new URL(u, origin);
    if (url.origin !== new URL(origin).origin || url.pathname.startsWith('/models/') || !/^\/(?:assets|@fs|node_modules)\//.test(url.pathname))
      throw new Error(`the OCR code must be a build asset of this app, not ${u}`);
  }
}

async function loadLanguageData(model: ModelEntry, env: LoaderEnv, onProgress?: (p: OcrProgress) => void): Promise<Uint8Array> {
  const file = model.files[0]!;
  onProgress?.({ status: 'Getting the reading data…', fraction: 0 });
  const { bytes } = await loadPinnedFile(model.base + file.path, new VerifiedCache(model.cacheName, env), env, (n) =>
    onProgress?.({ status: 'Getting the reading data…', fraction: Math.min(1, n / file.size) }),
  );
  return bytes;
}

/** WebP is decoded by the browser first (the engine's own image reader is not relied on for it); other types go as they are. */
async function forEngine(image: Blob): Promise<Blob> {
  if (image.type !== 'image/webp' || typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') return image;
  try {
    const bmp = await createImageBitmap(image);
    try {
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      c.getContext('2d')!.drawImage(bmp, 0, 0);
      return await c.convertToBlob({ type: 'image/png' });
    } finally {
      bmp.close?.();
    }
  } catch {
    return image;
  }
}

export interface ReadTextOptions {
  onProgress?: (p: OcrProgress) => void;
  /** tests: a stand-in for the worker, an environment and the manifest entry */
  spawnWorker?: (url: string) => WorkerLike;
  env?: LoaderEnv;
  model?: ModelEntry;
  codeUrls?: { worker: string; core: string };
}

/** tesseract.js's OEM.LSTM_ONLY */
const OEM_LSTM_ONLY = 1;

/** Jobs sent to the worker script, one at a time, each answered once; `abandon` settles and forgets all of them. */
function jobs(w: WorkerLike, onProgress?: (data: { status?: string; progress?: number }) => void) {
  const pending = new Map<string, { resolve(v: any): void; reject(e: Error): void }>();
  let n = 0;
  w.onmessage = ({ data }) => {
    const p = pending.get(data?.jobId);
    if (!p) return;
    if (data.status === 'progress') onProgress?.(data.data);
    else {
      pending.delete(data.jobId);
      if (data.status === 'resolve') p.resolve(data.data);
      else p.reject(new Error(String(data.data)));
    }
  };
  w.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e?.message || 'the reader stopped'));
    pending.clear();
  };
  const send = (action: string, payload: unknown): Promise<any> =>
    new Promise((resolve, reject) => {
      const jobId = `job-${n++}`;
      pending.set(jobId, { resolve, reject });
      w.postMessage({ workerId: 'matra-ocr', jobId, action, payload });
    });
  /** A wipe: settle every waiting job with `err`, forget them, and stop listening to the worker. */
  const abandon = (err: Error) => {
    const waiting = [...pending.values()];
    pending.clear();
    w.onmessage = null;
    w.onerror = null;
    for (const p of waiting) p.reject(err);
  };
  return { send, abandon };
}

/** Read the text printed in one image. The words are the engine's, untouched. */
export async function readTextFromImage(image: Blob, opts: ReadTextOptions = {}): Promise<OcrResult> {
  const env = opts.env ?? defaultEnv();
  const model = opts.model ?? modelById(OCR_MODEL_ID, env.manifest);
  const code = opts.codeUrls ?? { worker: ocrWorkerUrl, core: ocrCoreUrl };
  assertOcrCodeUrls([code.worker, code.core], env.origin);
  let data: Uint8Array | null;
  try {
    data = await loadLanguageData(model, env, opts.onProgress);
  } catch (e) {
    if (e instanceof IntegrityError)
      throw new OcrUnavailableError(e.code === 'missing' ? 'the reading data is not part of this copy' : 'the reading data did not pass its safety check, so it was not used');
    throw new OcrUnavailableError('the reading data could not be loaded');
  }
  opts.onProgress?.({ status: 'Starting the reader…' });
  let worker: WorkerLike | undefined;
  let abandonJobs: ((e: Error) => void) | undefined;
  // Lock, idle lock, sign-out and Quick exit stop a read in progress: the worker is ended, every waiting job is rejected
  // (a terminated worker never answers, so nothing else would settle them), its handlers are dropped and the language data
  // is let go. Nothing is returned or saved.
  let stopped = false;
  const stopOnWipe = onWipe(() => {
    stopped = true;
    data = null;
    try {
      worker?.terminate();
    } catch {
      /* already gone */
    }
    abandonJobs?.(new OcrUnavailableError('it was stopped when the screen was locked'));
  });
  try {
    // a classic worker started from our own build file (the CSP has no blob: worker source)
    worker = opts.spawnWorker ? opts.spawnWorker(code.worker) : (new Worker(code.worker) as unknown as WorkerLike);
    const { send: rawSend, abandon } = jobs(worker, (m) => {
      if (m.status === 'recognizing text') opts.onProgress?.({ status: 'Reading the text…', fraction: m.progress });
    });
    abandonJobs = abandon;
    const send = async (action: string, payload: unknown) => {
      if (stopped) throw new OcrUnavailableError('it was stopped when the screen was locked');
      return rawSend(action, payload);
    };
    // the engine's code: exactly the file we built in (a path ending .js is used as it is: no CDN default, no second choice)
    await send('load', { options: { lstmOnly: true, corePath: new URL(code.core, env.origin).href, logging: false } });
    // the language data goes in as the bytes we checked; the engine makes no request and keeps no copy of its own
    await send('loadLanguage', { langs: [{ code: 'eng', data: data! }], options: { cacheMethod: 'none', gzip: true, lstmOnly: true } });
    await send('initialize', { langs: 'eng', oem: OEM_LSTM_ONLY, config: {} });
    opts.onProgress?.({ status: 'Reading the text…', fraction: 0 });
    const result = await send('recognize', { image: new Uint8Array(await (await forEngine(image)).arrayBuffer()), options: {}, output: { text: true } });
    if (stopped) throw new OcrUnavailableError('it was stopped when the screen was locked');
    if (typeof result?.text !== 'string') throw new Error('the reader gave no text');
    return { text: result.text, engine: OCR_ENGINE_LABEL };
  } catch (e) {
    if (e instanceof Error && 'friendly' in e) throw e;
    throw new OcrUnavailableError((e as Error)?.message);
  } finally {
    stopOnWipe();
    data = null;
    abandonJobs = undefined;
    try {
      worker?.terminate();
    } catch {
      /* already gone */
    }
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
    }
  }
}
