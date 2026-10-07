/// <reference lib="webworker" />
/**
 * Transcription worker: Whisper (ONNX, q8) running entirely on this device.
 *
 * Privacy invariants (enforced here AND by the production CSP `connect-src 'self'`):
 *  - audio arrives by postMessage and never leaves this worker except as text back to the page;
 *  - every model / runtime file is fetched from our own origin under /models/ (see scripts/fetch-models.mjs);
 *    remote model hosts and CDNs are disabled, so a misconfiguration fails closed instead of calling out.
 */
import { env, pipeline, Tensor, TextStreamer } from '@huggingface/transformers';
import manifest from './model-manifest.json';
import { isSilent, joinTranscripts, planChunks, resample, WHISPER_RATE } from './audio';
import type { Device, FromWorker, ToWorker } from './protocol';
import { CACHE_NAME, MODELS_BASE, ORT_BASE, runtimeCacheKey } from './config';


// ── fail-closed configuration ────────────────────────────────────────────────────────────────────────────────
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = MODELS_BASE;
env.remoteHost = '/models/__remote_disabled__/'; // belt and braces: even if re-enabled, never a third-party host
env.useBrowserCache = typeof caches !== 'undefined';
env.cacheKey = CACHE_NAME;
// transformers.js would otherwise turn the wasm glue into a blob: URL (needs script-src blob:) — we load it ourselves.
env.useWasmCache = false;
const onnx = env.backends.onnx as any;

const post = (m: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

type Asr = any;
let asr: Promise<{ pipe: Asr; device: Device }> | null = null;
/** Load once; a failed load is forgotten so the next attempt retries. */
function getAsr(prefer?: Device | 'auto') {
  if (!asr) {
    asr = load(prefer);
    asr.catch(() => {
      asr = null;
    });
  }
  return asr;
}

/** Fetch a same-origin file with byte progress, through the Cache API so the one-time download stays one-time. */
async function fetchCached(url: string, onBytes: (n: number) => void): Promise<{ buf: ArrayBuffer; fromCache: boolean }> {
  const cache = typeof caches !== 'undefined' ? await caches.open(CACHE_NAME).catch(() => null) : null;
  const key = runtimeCacheKey(url.slice(ORT_BASE.length));
  const hit = await cache?.match(key);
  if (hit) {
    const buf = await hit.arrayBuffer();
    onBytes(buf.byteLength);
    return { buf, fromCache: true };
  }
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok || !res.body) throw new Error(`could not load ${url} (${res.status})`);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onBytes(value.length);
  }
  const bytes = new Uint8Array(got);
  let o = 0;
  for (const p of parts) {
    bytes.set(p, o);
    o += p.length;
  }
  await cache?.put(key, new Response(bytes.slice(), { headers: { 'content-type': 'application/wasm' } })).catch(() => {});
  return { buf: bytes.buffer, fromCache: false };
}

async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as any).gpu;
    if (!gpu) return false;
    const adapter = await gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

async function load(prefer: Device | 'auto' = 'auto'): Promise<{ pipe: Asr; device: Device }> {
  const t0 = performance.now();
  // WebGPU is opt-in, not the default. Measured with this q8 model (headless Chromium, e2e/voice.spec.ts with
  // MATRA_VOICE_WEBGPU=1): ~24x slower than real time, versus ~0.4–1.2x on the CPU — most likely the int8 ops
  // falling back to the CPU with GPU<->CPU copies (headless may also use a software adapter). Making WebGPU the
  // default needs fp16/q4 weights (a second, larger download) and real-device numbers, so 'auto' = CPU (wasm).
  const gpu = prefer === 'webgpu' && (await hasWebGpu());
  const runtime = gpu ? manifest.ort.webgpu : manifest.ort.wasm;
  const modelBytes = manifest.files.reduce((n, f) => n + f.size, 0);
  const total = modelBytes + runtime.size;

  let wasmLoaded = 0;
  const fileLoaded: Record<string, number> = {};
  let fromCache = true;
  let lastPost = 0;
  const report = (force = false) => {
    const now = performance.now();
    if (!force && now - lastPost < 100) return;
    lastPost = now;
    const loaded = Math.min(total, wasmLoaded + Object.values(fileLoaded).reduce((a, b) => a + b, 0));
    post({ type: 'load-progress', loaded, total, fromCache });
  };

  // 1. ONNX Runtime wasm, from our origin only. The bundle's default would be cdn.jsdelivr.net.
  const { buf, fromCache: wasmCached } = await fetchCached(ORT_BASE + runtime.wasm, (n) => {
    wasmLoaded += n;
    report();
  });
  fromCache = fromCache && wasmCached;
  onnx.wasm.wasmBinary = buf;
  // CPU build: its matching JS glue from our origin. WebGPU build: the glue embedded in the bundle.
  onnx.wasm.wasmPaths = gpu ? { wasm: ORT_BASE + runtime.wasm } : { mjs: ORT_BASE + (runtime as typeof manifest.ort.wasm).mjs, wasm: ORT_BASE + runtime.wasm };
  onnx.wasm.proxy = false;
  // Threads need cross-origin isolation (SharedArrayBuffer, i.e. COOP + COEP headers). Without it: 1 thread, no warning.
  // (The WebGPU build's glue is bundled into this worker and cannot spawn its own thread workers, so it stays at 1.)
  onnx.wasm.numThreads = !gpu && (self as any).crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

  // 2. The model. transformers.js reports per-file progress; cache hits arrive fast and count as loaded.
  const progress_callback = (info: any) => {
    if (info.status === 'progress' && info.file) {
      fileLoaded[info.file] = info.loaded ?? 0;
      report();
    } else if (info.status === 'download') {
      fromCache = false;
    } else if (info.status === 'done' && info.file) {
      const f = manifest.files.find((x) => x.path === info.file);
      if (f) fileLoaded[info.file] = f.size;
      report();
    }
  };
  const make = (device: Device) =>
    pipeline('automatic-speech-recognition', manifest.modelId, {
      dtype: manifest.dtype as any,
      device,
      progress_callback,
    });

  let device: Device = gpu ? 'webgpu' : 'wasm';
  let pipe: Asr;
  try {
    pipe = await make(device);
    if (device === 'webgpu') await pipe(new Float32Array(WHISPER_RATE), { language: 'en', max_new_tokens: 2 }); // smoke test
  } catch (e) {
    if (device !== 'webgpu') throw e;
    // WebGPU listed but not usable (driver, missing ops, memory): the asyncify runtime also runs on the CPU.
    device = 'wasm';
    pipe = await make(device);
  }
  for (const f of manifest.files) fileLoaded[f.path] = f.size;
  report(true);
  post({ type: 'ready', device, loadMs: Math.round(performance.now() - t0) });
  return { pipe, device };
}

/** Run the encoder once for a chunk, so language detection and decoding can share it. Null if unavailable. */
async function encode(pipe: Asr, input_features: any): Promise<any | null> {
  try {
    const m = pipe.model;
    // Let generate() accept the precomputed encoder output instead of running the encoder a second time.
    if (Array.isArray(m.forward_params) && !m.forward_params.includes('encoder_outputs')) m.forward_params.push('encoder_outputs');
    const out = await m._prepare_encoder_decoder_kwargs_for_generation({
      inputs_tensor: input_features,
      model_inputs: { input_features },
      model_input_name: 'input_features',
      generation_config: m.generation_config,
    });
    return out?.encoder_outputs ?? null;
  } catch {
    return null;
  }
}

/** Whisper's own language guess: the most likely language token right after <|startoftranscript|>. */
async function detectLanguage(pipe: Asr, input_features: any, encoder_outputs: any | null): Promise<string | undefined> {
  try {
    const gc = pipe.model.generation_config;
    const langToId: Record<string, number> | undefined = gc?.lang_to_id;
    if (!langToId) return undefined;
    const out = await pipe.model({
      ...(encoder_outputs ? { encoder_outputs } : { input_features }),
      decoder_input_ids: new Tensor('int64', BigInt64Array.from([BigInt(gc.decoder_start_token_id)]), [1, 1]),
    });
    const logits = out.logits.data as Float32Array;
    const vocab = out.logits.dims.at(-1) as number;
    const base = logits.length - vocab;
    let best: string | undefined;
    let bestV = -Infinity;
    for (const [tok, id] of Object.entries(langToId)) {
      const v = logits[base + id];
      if (v > bestV) {
        bestV = v;
        best = tok;
      }
    }
    return best?.replace(/[<|>]/g, '');
  } catch {
    return undefined;
  }
}

async function transcribe(msg: Extract<ToWorker, { type: 'transcribe' }>) {
  const t0 = performance.now();
  let pipe: Asr;
  try {
    ({ pipe } = await getAsr());
  } catch (err: any) {
    post({ type: 'error', id: msg.id, code: 'load_failed', message: String(err?.message ?? err) });
    return;
  }
  const audio = msg.sampleRate === WHISPER_RATE ? msg.audio : resample(msg.audio, msg.sampleRate, WHISPER_RATE);
  const durationSec = audio.length / WHISPER_RATE;
  const chunks = planChunks(audio, WHISPER_RATE).filter((c) => !isSilent(audio.subarray(c.start, c.end), WHISPER_RATE));
  const totalSamples = chunks.reduce((n, c) => n + (c.end - c.start), 0) || 1;
  let doneSamples = 0;
  const texts: string[] = [];

  let language = msg.language;
  const stats = { chunks: chunks.length, featuresMs: 0, encodeMs: 0, languageMs: 0, decodeMs: 0, tokens: 0, reusedEncoder: true };
  post({ type: 'progress', id: msg.id, fraction: 0.02 });

  for (const c of chunks) {
    const sub = audio.subarray(c.start, c.end);
    const len = c.end - c.start;
    // Rough within-chunk progress from tokens streamed (speech runs ~3 tokens/s).
    let tokens = 0;
    let partial = '';
    const expected = Math.max(8, (len / WHISPER_RATE) * 3);
    const streamer = new TextStreamer(pipe.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (t: string) => {
        tokens++;
        partial += t;
        const within = Math.min(0.95, tokens / expected);
        post({
          type: 'progress',
          id: msg.id,
          fraction: Math.min(0.99, 0.02 + (0.97 * (doneSamples + within * len)) / totalSamples),
          partial: joinTranscripts([...texts, partial]),
        });
      },
    } as any);
    let t = performance.now();
    const lap = (k: 'featuresMs' | 'encodeMs' | 'languageMs' | 'decodeMs') => {
      const now = performance.now();
      stats[k] += Math.round(now - t);
      t = now;
    };
    const { input_features } = await pipe.processor(sub);
    lap('featuresMs');
    const encoder_outputs = await encode(pipe, input_features);
    if (!encoder_outputs) stats.reusedEncoder = false;
    lap('encodeMs');
    // Language: detected once, from the first chunk with speech (Whisper otherwise assumes English).
    if (!language) {
      language = (await detectLanguage(pipe, input_features, encoder_outputs)) ?? 'en';
      lap('languageMs');
    }
    const ids = await pipe.model.generate({
      inputs: input_features,
      ...(encoder_outputs ? { encoder_outputs } : {}),
      language,
      task: 'transcribe',
      streamer,
    });
    const row = Array.isArray(ids) ? ids[0] : (ids.sequences ?? ids)[0];
    texts.push(pipe.tokenizer.decode(row.tolist ? row.tolist() : row, { skip_special_tokens: true }) || '');
    lap('decodeMs');
    stats.tokens += tokens;
    doneSamples += len;
    post({ type: 'progress', id: msg.id, fraction: 0.02 + (0.97 * doneSamples) / totalSamples, partial: joinTranscripts(texts) });
  }

  post({
    type: 'result',
    id: msg.id,
    text: joinTranscripts(texts),
    language,
    durationSec,
    elapsedMs: Math.round(performance.now() - t0),
    stats,
  });
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === 'load') {
    getAsr(msg.prefer).catch((err) => {
      post({ type: 'error', code: 'load_failed', message: String(err?.message ?? err) });
    });
  } else if (msg.type === 'transcribe') {
    transcribe(msg).catch((err) => {
      post({ type: 'error', id: msg.id, code: 'transcribe_failed', message: String(err?.message ?? err) });
    });
  }
};
