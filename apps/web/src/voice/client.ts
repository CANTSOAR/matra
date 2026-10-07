/**
 * Main-thread side of the transcription worker: one shared worker per page, created lazily and
 * terminated on Quick Exit / lock (wipe) so no audio or model state lingers in memory.
 */
import { onWipe } from '../lib/wipe';
import { CACHE_NAME, MODEL_WEIGHT_PATHS, RUNTIME_FILES, runtimeCacheKey } from './config';
import type { Device, FromWorker, ToWorker } from './protocol';
import type { TranscriptResult } from './types';

export type WorkerLike = Pick<Worker, 'postMessage' | 'terminate'> & {
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
};

const defaultFactory = (): WorkerLike =>
  new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'transcriber' }) as unknown as WorkerLike;
let factory: () => WorkerLike = defaultFactory;

/** Tests swap in a fake worker. Pass nothing to restore the real one. */
export function setWorkerFactory(f?: () => WorkerLike): void {
  terminateTranscriber();
  factory = f ?? defaultFactory;
}

export class WipedError extends Error {
  constructor() {
    super('stopped');
    this.name = 'WipedError';
  }
}

export interface LoadProgress {
  loaded: number;
  total: number;
  fromCache: boolean;
}

type LoadListener = (p: LoadProgress) => void;
interface Pending {
  resolve: (r: TranscriptResult & { elapsedMs: number; stats?: Record<string, number | boolean> }) => void;
  reject: (e: Error) => void;
  onProgress?: (fraction: number, partial?: string) => void;
}

let worker: WorkerLike | null = null;
let ready: { promise: Promise<Device>; resolve: (d: Device) => void; reject: (e: Error) => void } | null = null;
let device: Device | null = null;
let lastLoad: LoadProgress | null = null;
const loadListeners = new Set<LoadListener>();
const pending = new Map<number, Pending>();
let nextId = 1;
let preferred: Device | 'auto' = 'auto';

/** Runtime preference for the next load ('auto' = CPU/wasm today; 'webgpu' is opt-in, see worker.ts). */
export function setPreferredDevice(d: Device | 'auto'): void {
  preferred = d;
}

function deferred() {
  let resolve!: (d: Device) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<Device>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => {}); // observed by callers; never an unhandled rejection
  return { promise, resolve, reject };
}

function onMessage(e: MessageEvent<FromWorker>) {
  const m = e.data;
  switch (m.type) {
    case 'load-progress':
      lastLoad = { loaded: m.loaded, total: m.total, fromCache: m.fromCache };
      for (const l of loadListeners) l(lastLoad);
      break;
    case 'ready':
      device = m.device;
      ready?.resolve(m.device);
      break;
    case 'progress':
      pending.get(m.id)?.onProgress?.(m.fraction, m.partial);
      break;
    case 'result': {
      const p = pending.get(m.id);
      pending.delete(m.id);
      p?.resolve({ text: m.text, language: m.language, durationSec: m.durationSec, elapsedMs: m.elapsedMs, stats: m.stats });
      break;
    }
    case 'error': {
      const err = Object.assign(new Error(m.message), { code: m.code });
      if (m.code === 'load_failed') {
        ready?.reject(err);
        ready = null;
      }
      if (m.id !== undefined) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        p?.reject(err);
      }
      break;
    }
  }
}

function ensureWorker(): WorkerLike {
  if (worker) return worker;
  worker = factory();
  worker.onmessage = onMessage;
  worker.onerror = (ev) => {
    const err = Object.assign(new Error(ev?.message || 'worker failed'), { code: 'load_failed' });
    ready?.reject(err);
    ready = null;
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

const send = (m: ToWorker, transfer: Transferable[] = []) => ensureWorker().postMessage(m, transfer);

/** Start loading the model (downloading it the first time). Resolves with the device it runs on. */
export function loadTranscriber(onProgress?: LoadListener): Promise<Device> {
  if (onProgress) {
    loadListeners.add(onProgress);
    if (lastLoad) onProgress(lastLoad);
  }
  if (!ready) {
    ready = deferred();
    if (device) ready.resolve(device);
    else send({ type: 'load', prefer: preferred });
  }
  const p = ready.promise;
  if (onProgress) p.finally(() => loadListeners.delete(onProgress)).catch(() => {});
  return p;
}

/** Contract export: warm the model up ahead of time. `pct` is 0..100. */
export async function preloadTranscriber(onProgress?: (pct: number) => void): Promise<void> {
  await loadTranscriber(onProgress && ((p) => onProgress(p.total ? Math.round((p.loaded / p.total) * 100) : 0)));
}

/** Transcribe mono PCM. The buffer is transferred to the worker (the caller's copy becomes empty). */
export function transcribe(
  audio: Float32Array,
  sampleRate: number,
  onProgress?: (fraction: number, partial?: string) => void,
): Promise<TranscriptResult & { elapsedMs: number; stats?: Record<string, number | boolean> }> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    send({ type: 'transcribe', id, audio, sampleRate }, [audio.buffer]);
  });
}

/** Stop everything: kill the worker (freeing model + audio memory) and fail anything in flight. */
export function terminateTranscriber(): void {
  const err = new WipedError();
  worker?.terminate();
  worker = null;
  ready?.reject(err);
  ready = null;
  device = null;
  lastLoad = null;
  for (const p of pending.values()) p.reject(err);
  pending.clear();
  loadListeners.clear();
}

export function transcriberDevice(): Device | null {
  return device;
}

/** Whether the one-time setup already happened on this device (model + runtime in the on-device cache). */
export async function isTranscriberSetUp(): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false;
    const cache = await caches.open(CACHE_NAME);
    for (const p of MODEL_WEIGHT_PATHS) if (!(await cache.match(p))) return false;
    return !!(await cache.match(runtimeCacheKey(RUNTIME_FILES.wasm))) || !!(await cache.match(runtimeCacheKey(RUNTIME_FILES.webgpu)));
  } catch {
    return false;
  }
}

// Quick Exit / lock: drop the worker with everything it holds.
onWipe(terminateTranscriber);
if (typeof window !== 'undefined') window.addEventListener('matra:wipe', terminateTranscriber);
