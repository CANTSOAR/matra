/** Shared, dependency-free constants for the voice feature (safe to import on the main thread). */
import { formatMB as fmt, MANIFEST, modelById, modelBytes, MODELS_BASE as BASE, runtimeFile } from '../ml/manifest';

export const MODELS_BASE = BASE;
export const ORT_BASE = MANIFEST.runtime.base;

/** The one speech model the manifest pins today. Its files, revision and cache name all come from the manifest. */
export const SPEECH = modelById('onnx-community/whisper-base');
/** Neutral cache name (shared devices: no app name in browser storage). Revision-scoped so updates never mix files. */
export const CACHE_NAME = SPEECH.cacheName;
/** Where the ONNX Runtime files are cached (shared by every model). */
export const RUNTIME_CACHE_NAME = MANIFEST.runtime.cacheName;
export const MODEL_ID = SPEECH.id;
export const MODEL_BYTES = modelBytes(SPEECH);
/** What the one-time setup downloads on a CPU-only device (the common case on phones). */
export const SETUP_BYTES = MODEL_BYTES + runtimeFile('cpu-wasm').size;
/** Cache key the worker stores a runtime file under. */
export const runtimeCacheKey = (file: string) => `${ORT_BASE}${file}?ort=${MANIFEST.runtime.version}`;
/** Model files whose presence in the cache means "already set up". */
export const MODEL_WEIGHT_PATHS = SPEECH.files.filter((f) => f.path.endsWith('.onnx')).map((f) => `${SPEECH.base}${f.path}`);
export const RUNTIME_FILES = { wasm: runtimeFile('cpu-wasm').path, webgpu: runtimeFile('webgpu-wasm').path };

/** "about 94 MB" — rounded so it reads honestly, not precisely. */
export const formatMB = fmt;
