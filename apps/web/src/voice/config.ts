/** Shared, dependency-free constants for the voice feature (safe to import on the main thread). */
import manifest from './model-manifest.json';

export const MODELS_BASE = '/models/';
export const ORT_BASE = '/models/ort/';
/** Neutral cache name (shared devices: no app name in browser storage). Revision-scoped so updates never mix files. */
export const CACHE_NAME = `speech-model-${manifest.revision.slice(0, 8)}`;
export const MODEL_ID = manifest.modelId;
export const MODEL_BYTES = manifest.files.reduce((n, f) => n + f.size, 0);
/** What the one-time setup downloads on a CPU-only device (the common case on phones). */
export const SETUP_BYTES = MODEL_BYTES + manifest.ort.wasm.size;
/** Cache key the worker stores a runtime file under. */
export const runtimeCacheKey = (file: string) => `${ORT_BASE}${file}?ort=${manifest.ort.version}`;
/** Model files whose presence in the cache means "already set up". */
export const MODEL_WEIGHT_PATHS = manifest.files.filter((f) => f.path.endsWith('.onnx')).map((f) => `${MODELS_BASE}${manifest.modelId}/${f.path}`);
export const RUNTIME_FILES = { wasm: manifest.ort.wasm.wasm, webgpu: manifest.ort.webgpu.wasm };

/** "about 94 MB" — rounded so it reads honestly, not precisely. */
export const formatMB = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;
