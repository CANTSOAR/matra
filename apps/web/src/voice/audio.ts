/**
 * Pure audio helpers for on-device transcription: mixdown, resampling to Whisper's 16 kHz, and
 * splitting long recordings into ≤30 s windows (Whisper's input size) at quiet moments.
 * No DOM, no I/O — used by both the main thread and the worker, and unit-tested directly.
 */

export const WHISPER_RATE = 16_000;
/** Whisper sees at most 30 s of audio per pass. */
export const WHISPER_WINDOW_SEC = 30;

/** Average all channels into one. Returns the input itself when it is already mono. */
export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const n = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(n);
  const k = 1 / channels.length;
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] * k;
  return out;
}

// Windowed-sinc kernel, tabulated once per (zero-crossings, resolution). Blackman window.
const ZERO_CROSSINGS = 8;
const TABLE_RES = 256; // samples of the kernel per unit of input time
let kernelTable: Float32Array | null = null;
function kernel(): Float32Array {
  if (kernelTable) return kernelTable;
  const len = ZERO_CROSSINGS * TABLE_RES + 2;
  const t = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const x = i / TABLE_RES; // 0..ZERO_CROSSINGS
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const w = x >= ZERO_CROSSINGS ? 0 : 0.42 + 0.5 * Math.cos((Math.PI * x) / ZERO_CROSSINGS) + 0.08 * Math.cos((2 * Math.PI * x) / ZERO_CROSSINGS);
    t[i] = sinc * w;
  }
  return (kernelTable = t);
}

/**
 * Band-limited resampling (windowed sinc). When downsampling, the kernel is stretched so it also acts as
 * the anti-aliasing low-pass at the new Nyquist frequency. Output length = round(n · to / from).
 */
export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (!(fromRate > 0) || !(toRate > 0)) throw new RangeError('sample rates must be positive');
  if (fromRate === toRate) return input;
  const outLen = Math.round((input.length * toRate) / fromRate);
  const out = new Float32Array(outLen);
  const step = fromRate / toRate; // input samples per output sample
  const cutoff = Math.min(1, toRate / fromRate); // relative to the input Nyquist
  const half = ZERO_CROSSINGS / cutoff; // kernel half-width in input samples
  const tab = kernel();
  const scale = cutoff * TABLE_RES;
  const n = input.length;
  for (let i = 0; i < outLen; i++) {
    const x = i * step;
    const lo = Math.max(0, Math.ceil(x - half));
    const hi = Math.min(n - 1, Math.floor(x + half));
    let acc = 0;
    let norm = 0;
    for (let j = lo; j <= hi; j++) {
      const p = Math.abs(x - j) * scale;
      const k = p | 0;
      const f = p - k;
      const w = tab[k] + (tab[k + 1] - tab[k]) * f;
      acc += input[j] * w;
      norm += w;
    }
    // Normalising by the kernel sum keeps DC gain at exactly 1 (also near the edges).
    out[i] = norm > 0 ? acc / norm : 0;
  }
  return out;
}

/** Root-mean-square level of samples[start, end). */
export function rms(samples: Float32Array, start = 0, end = samples.length): number {
  const s = Math.max(0, start);
  const e = Math.min(samples.length, end);
  if (e <= s) return 0;
  let acc = 0;
  for (let i = s; i < e; i++) acc += samples[i] * samples[i];
  return Math.sqrt(acc / (e - s));
}

export interface Chunk {
  /** Sample offsets, [start, end). */
  start: number;
  end: number;
}

export interface ChunkOptions {
  /** Longest chunk, seconds (Whisper's window is 30 s). */
  maxSec?: number;
  /** How far back from the window end to look for a pause to cut at, seconds. */
  searchSec?: number;
  /** Energy frame, seconds. */
  frameSec?: number;
  /** Length of the quiet stretch we look for (a pause between phrases), seconds. */
  pauseSec?: number;
}

export const CHUNK_DEFAULTS = { maxSec: WHISPER_WINDOW_SEC, searchSec: 8, frameSec: 0.05, pauseSec: 0.3 };

/**
 * Split a recording into consecutive, non-overlapping chunks of at most `maxSec`, covering every sample.
 * Each cut goes in the middle of the quietest `pauseSec` stretch within the last `searchSec` of the window —
 * normally a pause between phrases — so words are not cut in half (Whisper drops half-words at chunk edges).
 */
export function planChunks(samples: Float32Array, sampleRate: number, opts: ChunkOptions = {}): Chunk[] {
  const o = { ...CHUNK_DEFAULTS, ...opts };
  const maxLen = Math.floor(o.maxSec * sampleRate);
  const frame = Math.max(1, Math.floor(o.frameSec * sampleRate));
  const searchFrames = Math.max(1, Math.floor((o.searchSec * sampleRate) / frame));
  const pauseFrames = Math.max(1, Math.round(o.pauseSec / o.frameSec));
  const n = samples.length;
  const chunks: Chunk[] = [];
  let start = 0;
  while (start < n) {
    if (n - start <= maxLen) {
      chunks.push({ start, end: n });
      break;
    }
    const windowEnd = start + maxLen;
    // Frame energies over the search region [windowEnd - search, windowEnd), never before `start`.
    const regionStart = Math.max(start, windowEnd - searchFrames * frame);
    const count = Math.max(1, Math.floor((windowEnd - regionStart) / frame));
    const energy = new Float64Array(count);
    for (let f = 0; f < count; f++) {
      const a = regionStart + f * frame;
      const e = rms(samples, a, a + frame);
      energy[f] = e * e;
    }
    // Quietest run of `pauseFrames` frames (sliding sum); ties prefer the later cut (bigger chunks).
    const w = Math.min(pauseFrames, count);
    let sum = 0;
    for (let f = 0; f < w; f++) sum += energy[f];
    let best = sum;
    let bestAt = 0;
    for (let f = w; f < count; f++) {
      sum += energy[f] - energy[f - w];
      if (sum <= best + 1e-12) {
        best = sum;
        bestAt = f - w + 1;
      }
    }
    const cut = Math.max(start + 1, Math.min(windowEnd, regionStart + bestAt * frame + Math.floor((w * frame) / 2)));
    chunks.push({ start, end: cut });
    start = cut;
  }
  return chunks;
}

/** Number of chunks a recording of `seconds` will need at most (each cut is ≥ maxSec − searchSec long). */
export function maxChunkCount(seconds: number, opts: ChunkOptions = {}): number {
  const o = { ...CHUNK_DEFAULTS, ...opts };
  const max = o.maxSec;
  const min = max - o.searchSec;
  if (seconds <= max) return seconds > 0 ? 1 : 0;
  return Math.ceil((seconds - max) / min) + 1;
}

/**
 * True when a chunk has no frame loud enough to be speech. Whisper tends to invent words ("Thank you.") for
 * silence, so silent chunks are skipped rather than transcribed.
 */
export function isSilent(samples: Float32Array, sampleRate: number, threshold = 0.004, frameSec = 0.05): boolean {
  const frame = Math.max(1, Math.floor(frameSec * sampleRate));
  for (let i = 0; i < samples.length; i += frame) if (rms(samples, i, i + frame) >= threshold) return false;
  return true;
}

/** "4:07", "1:02:09". */
export function formatElapsed(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Join chunk transcripts, tidying whitespace between them. */
export function joinTranscripts(parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
