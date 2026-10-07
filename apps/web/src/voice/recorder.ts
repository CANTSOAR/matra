/**
 * Microphone capture: MediaRecorder for the (compressed) original recording she may keep as evidence,
 * plus an AnalyserNode for a gentle level meter. Decoding afterwards yields 16 kHz mono PCM for Whisper.
 * Nothing here touches the network.
 */
import { mixToMono, WHISPER_RATE } from './audio';

export type MicErrorKind = 'denied' | 'no-device' | 'unsupported' | 'other';

export class MicError extends Error {
  constructor(
    public kind: MicErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'MicError';
  }
}

export interface Recording {
  readonly mimeType: string;
  pause(): void;
  resume(): void;
  /** Stop and return the recording. Releases the microphone. */
  stop(): Promise<Blob>;
  /** Stop and throw everything away. Releases the microphone. Safe to call more than once. */
  cancel(): void;
  /** Current input level, 0..1 (perceptual, not linear). */
  level(): number;
}

const AudioCtx = (): typeof AudioContext | undefined =>
  typeof window === 'undefined' ? undefined : window.AudioContext ?? (window as any).webkitAudioContext;

export function isRecordingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window.MediaRecorder !== 'undefined' &&
    !!AudioCtx()
  );
}

function pickMimeType(): string | undefined {
  const MR = window.MediaRecorder;
  const candidates = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];
  return candidates.find((t) => MR.isTypeSupported?.(t));
}

export async function startRecording(): Promise<Recording> {
  if (!isRecordingSupported()) throw new MicError('unsupported', 'recording not supported');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (e: any) {
    const name = e?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') throw new MicError('denied', name);
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') throw new MicError('no-device', name);
    throw new MicError('other', String(e?.message ?? e));
  }

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 32_000 } : undefined);
  const parts: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size) parts.push(e.data);
  };
  // Timeslice: data arrives every second, so a 20+ minute recording never sits in one giant buffer.
  recorder.start(1000);

  // Level meter. Failure here must never block recording.
  let ctx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let buf: Float32Array<ArrayBuffer> | null = null;
  try {
    const Ctx = AudioCtx()!;
    ctx = new Ctx();
    const src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    buf = new Float32Array(analyser.fftSize);
    src.connect(analyser);
  } catch {
    analyser = null;
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    for (const t of stream.getTracks()) t.stop();
    ctx?.close().catch(() => {});
    ctx = null;
    analyser = null;
  };

  return {
    mimeType: recorder.mimeType || mimeType || 'audio/webm',
    pause() {
      if (recorder.state === 'recording') recorder.pause();
      ctx?.suspend().catch(() => {});
    },
    resume() {
      if (recorder.state === 'paused') recorder.resume();
      ctx?.resume().catch(() => {});
    },
    stop() {
      return new Promise<Blob>((resolve) => {
        const finish = () => {
          release();
          resolve(new Blob(parts, { type: recorder.mimeType || mimeType || 'audio/webm' }));
        };
        if (recorder.state === 'inactive') return finish();
        recorder.onstop = finish;
        recorder.stop();
      });
    },
    cancel() {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        /* ignore */
      }
      parts.length = 0;
      release();
    },
    level() {
      if (!analyser || !buf) return 0;
      analyser.getFloatTimeDomainData(buf);
      let acc = 0;
      for (let i = 0; i < buf.length; i++) acc += buf[i] * buf[i];
      const r = Math.sqrt(acc / buf.length);
      // ~ -60 dBFS → 0, ~ -10 dBFS → 1
      const db = 20 * Math.log10(r + 1e-9);
      return Math.max(0, Math.min(1, (db + 60) / 50));
    },
  };
}

/**
 * Decode a recording to mono PCM. Asking the browser for a 16 kHz context makes it resample natively;
 * if it gives us another rate, the worker resamples. Returns the rate the samples are at.
 */
export async function decodeRecording(blob: Blob): Promise<{ samples: Float32Array; sampleRate: number }> {
  const Ctx = AudioCtx();
  if (!Ctx) throw new Error('no AudioContext');
  const data = await blob.arrayBuffer();
  let ctx: AudioContext;
  try {
    ctx = new Ctx({ sampleRate: WHISPER_RATE });
  } catch {
    ctx = new Ctx();
  }
  try {
    const decoded = await new Promise<AudioBuffer>((resolve, reject) => {
      // Callback form too: older Safari has no promise-returning decodeAudioData.
      const p = ctx.decodeAudioData(data, resolve, reject);
      p?.then?.(resolve, reject);
    });
    const channels: Float32Array[] = [];
    for (let c = 0; c < decoded.numberOfChannels; c++) channels.push(decoded.getChannelData(c));
    const mono = mixToMono(channels);
    // Copy so the buffer is ours to transfer to the worker.
    return { samples: channels.length === 1 ? mono.slice() : mono, sampleRate: decoded.sampleRate };
  } finally {
    ctx.close().catch(() => {});
  }
}
