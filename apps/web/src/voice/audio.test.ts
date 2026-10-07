import { describe, expect, it } from 'vitest';
import {
  formatElapsed,
  isSilent,
  joinTranscripts,
  maxChunkCount,
  mixToMono,
  planChunks,
  resample,
  rms,
  WHISPER_RATE,
  WHISPER_WINDOW_SEC,
} from './audio';

const tone = (freq: number, rate: number, seconds: number, amp = 0.5) => {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate);
  return out;
};

/** Amplitude of `freq` in `x` (single-bin DFT), ignoring the edges. */
const amplitudeAt = (x: Float32Array, freq: number, rate: number) => {
  const a = Math.floor(x.length * 0.1);
  const b = Math.floor(x.length * 0.9);
  let re = 0;
  let im = 0;
  for (let i = a; i < b; i++) {
    re += x[i] * Math.cos((2 * Math.PI * freq * i) / rate);
    im -= x[i] * Math.sin((2 * Math.PI * freq * i) / rate);
  }
  return (2 * Math.hypot(re, im)) / (b - a);
};

describe('resample', () => {
  it('returns the input unchanged when the rates match', () => {
    const x = tone(440, 16000, 0.1);
    expect(resample(x, 16000, 16000)).toBe(x);
  });

  it('produces round(n · to/from) samples', () => {
    expect(resample(new Float32Array(48000), 48000, 16000).length).toBe(16000);
    expect(resample(new Float32Array(44100), 44100, 16000).length).toBe(16000);
    expect(resample(new Float32Array(1001), 44100, 16000).length).toBe(Math.round((1001 * 16000) / 44100));
    expect(resample(new Float32Array(8000), 8000, 16000).length).toBe(16000);
  });

  it('keeps DC exactly (gain 1), including at the edges', () => {
    const x = new Float32Array(4410).fill(0.25);
    const y = resample(x, 44100, 16000);
    for (const v of y) expect(v).toBeCloseTo(0.25, 5);
  });

  it('preserves an in-band tone (48k → 16k and 44.1k → 16k)', () => {
    for (const from of [48000, 44100]) {
      const y = resample(tone(1000, from, 0.5), from, WHISPER_RATE);
      expect(amplitudeAt(y, 1000, WHISPER_RATE)).toBeGreaterThan(0.48);
      expect(amplitudeAt(y, 1000, WHISPER_RATE)).toBeLessThan(0.52);
    }
  });

  it('matches the analytic signal sample by sample', () => {
    const y = resample(tone(440, 48000, 0.2), 48000, 16000);
    const expected = tone(440, 16000, 0.2);
    let maxErr = 0;
    for (let i = 200; i < y.length - 200; i++) maxErr = Math.max(maxErr, Math.abs(y[i] - expected[i]));
    expect(maxErr).toBeLessThan(0.01);
  });

  it('removes content above the new Nyquist instead of aliasing it', () => {
    // 12 kHz at 48 kHz would alias to 4 kHz at 16 kHz without a low-pass.
    const y = resample(tone(12000, 48000, 0.5), 48000, 16000);
    expect(amplitudeAt(y, 4000, 16000)).toBeLessThan(0.01);
    expect(rms(y, 400, y.length - 400)).toBeLessThan(0.01);
  });

  it('upsamples smoothly too', () => {
    const y = resample(tone(300, 8000, 0.5), 8000, 16000);
    expect(amplitudeAt(y, 300, 16000)).toBeGreaterThan(0.48);
  });

  it('rejects nonsense rates', () => {
    expect(() => resample(new Float32Array(10), 0, 16000)).toThrow(RangeError);
  });
});

describe('mixToMono', () => {
  it('averages channels and passes mono through', () => {
    const l = Float32Array.from([1, 0, 0.5]);
    const r = Float32Array.from([0, 1, 0.5]);
    expect(Array.from(mixToMono([l, r]))).toEqual([0.5, 0.5, 0.5]);
    expect(mixToMono([l])).toBe(l);
    expect(mixToMono([]).length).toBe(0);
  });
});

describe('planChunks', () => {
  const rate = 1000; // small rate keeps the arrays light; the maths is rate-independent
  /** "Speech" (noise) with short pauses every `every` seconds. */
  const speechWithPauses = (seconds: number, every: number, pause = 0.5) => {
    const x = new Float32Array(seconds * rate);
    let seed = 1;
    for (let i = 0; i < x.length; i++) {
      seed = (seed * 16807) % 2147483647;
      const t = i / rate;
      x[i] = t % every < pause ? 0 : ((seed / 2147483647) * 2 - 1) * 0.3;
    }
    return x;
  };
  const check = (chunks: { start: number; end: number }[], n: number, maxSec = WHISPER_WINDOW_SEC) => {
    expect(chunks[0].start).toBe(0);
    expect(chunks.at(-1)!.end).toBe(n);
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].end).toBeGreaterThan(chunks[i].start);
      expect(chunks[i].end - chunks[i].start).toBeLessThanOrEqual(maxSec * rate);
      if (i) expect(chunks[i].start).toBe(chunks[i - 1].end); // contiguous: no gaps, no overlap
    }
  };

  it('keeps a short recording in one piece', () => {
    expect(planChunks(new Float32Array(12 * rate), rate)).toEqual([{ start: 0, end: 12 * rate }]);
    expect(planChunks(new Float32Array(30 * rate), rate)).toEqual([{ start: 0, end: 30 * rate }]);
    expect(planChunks(new Float32Array(0), rate)).toEqual([]);
  });

  it('cuts inside a pause, not in the middle of speech', () => {
    const x = speechWithPauses(65, 7); // pauses at 0, 7, 14, 21, 28, 35, …
    const chunks = planChunks(x, rate);
    check(chunks, x.length);
    for (const c of chunks.slice(0, -1)) {
      const t = c.end / rate;
      expect(t % 7).toBeLessThan(0.5); // inside a pause
      expect(Math.abs(x[c.end])).toBe(0);
    }
  });

  it('still makes ≤30 s chunks when there is no pause at all', () => {
    const x = speechWithPauses(95, 1000);
    const chunks = planChunks(x, rate);
    check(chunks, x.length);
    expect(chunks.length).toBeGreaterThanOrEqual(4);
  });

  it('handles a 20-minute recording: every sample covered, within the predicted chunk count', () => {
    const seconds = 20 * 60;
    const x = speechWithPauses(seconds, 11, 0.4);
    const chunks = planChunks(x, rate);
    check(chunks, x.length);
    expect(chunks.length).toBeGreaterThanOrEqual(Math.ceil(seconds / WHISPER_WINDOW_SEC));
    expect(chunks.length).toBeLessThanOrEqual(maxChunkCount(seconds));
    // and each non-final chunk is long enough to be useful (≥ maxSec − searchSec)
    for (const c of chunks.slice(0, -1)) expect(c.end - c.start).toBeGreaterThanOrEqual(22 * rate);
  });

  it('maxChunkCount', () => {
    expect(maxChunkCount(0)).toBe(0);
    expect(maxChunkCount(10)).toBe(1);
    expect(maxChunkCount(30)).toBe(1);
    expect(maxChunkCount(31)).toBe(2);
    expect(maxChunkCount(20 * 60)).toBe(Math.ceil((1200 - 30) / 22) + 1);
  });
});

describe('helpers', () => {
  it('isSilent: digital silence and faint hiss are silent; speech-level audio is not', () => {
    expect(isSilent(new Float32Array(16000), 16000)).toBe(true);
    expect(isSilent(tone(200, 16000, 1, 0.002), 16000)).toBe(true);
    const x = new Float32Array(16000);
    x.set(tone(200, 16000, 0.2, 0.1), 8000);
    expect(isSilent(x, 16000)).toBe(false);
  });

  it('formatElapsed', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(7.9)).toBe('0:07');
    expect(formatElapsed(247)).toBe('4:07');
    expect(formatElapsed(3729)).toBe('1:02:09');
  });

  it('joinTranscripts tidies whitespace and drops empty chunks', () => {
    expect(joinTranscripts([' Hello there. ', '', '  I was  at home. '])).toBe('Hello there. I was at home.');
  });
});
