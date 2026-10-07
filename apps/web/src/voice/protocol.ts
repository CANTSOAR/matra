/** Messages between the main thread (client.ts) and the transcription worker (worker.ts). */

export type Device = 'webgpu' | 'wasm';

export type ToWorker =
  | { type: 'load'; prefer?: Device | 'auto' }
  /** `audio` is mono PCM at `sampleRate` (resampled to 16 kHz in the worker if needed). Transferred, not copied. */
  | { type: 'transcribe'; id: number; audio: Float32Array; sampleRate: number; language?: string };

export type FromWorker =
  /** Model/runtime download (first use) or load from the on-device cache. Bytes across all files. */
  | { type: 'load-progress'; loaded: number; total: number; fromCache: boolean }
  | { type: 'ready'; device: Device; loadMs: number }
  /** Transcription progress, 0..1. `partial` is the text so far (may be shown to her as it forms). */
  | { type: 'progress'; id: number; fraction: number; partial?: string }
  | { type: 'result'; id: number; text: string; language?: string; durationSec: number; elapsedMs: number; stats?: Record<string, number | boolean> }
  | { type: 'error'; id?: number; code: 'load_failed' | 'transcribe_failed'; message: string };
