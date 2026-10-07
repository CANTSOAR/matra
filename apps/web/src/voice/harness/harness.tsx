/**
 * Standalone page for the on-device transcription E2E check (built only with MATRA_VOICE_HARNESS=1).
 * Renders <VoiceCapture> under the production CSP and exposes the accepted result for the test to read.
 */
import { createRoot } from 'react-dom/client';
import '../../styles/global.css';
import { VoiceCapture, voiceDeps } from '../index';
import { setPreferredDevice, transcriberDevice } from '../client';

if (new URLSearchParams(location.search).get('device') === 'webgpu') setPreferredDevice('webgpu');

declare global {
  interface Window {
    __voiceResult?: { text: string; language?: string; durationSec: number; keepAudio?: boolean; audioBytes: number; audioType: string; device: string | null };
    __voiceCancelled?: boolean;
  }
}

// Timings for the E2E report: model load (first use vs cached) and transcription speed.
const timings: Record<string, unknown> = {};
(window as any).__voiceTimings = timings;
const { load, transcribe } = voiceDeps;
voiceDeps.load = (onProgress) => {
  const t0 = performance.now();
  const p = load(onProgress);
  p.then((device) => {
    timings.device = device;
    timings.loadAwaitMs ??= Math.round(performance.now() - t0);
  }).catch(() => {});
  return p;
};
voiceDeps.transcribe = async (audio, rate, onProgress) => {
  const audioSec = audio.length / rate;
  const r = await transcribe(audio, rate, onProgress);
  Object.assign(timings, { audioSec, transcribeMs: r.elapsedMs, realtimeFactor: +(r.elapsedMs / 1000 / audioSec).toFixed(2), language: r.language, ...r.stats });
  return r;
};

createRoot(document.getElementById('root')!).render(
  <main style={{ padding: '2rem 1rem' }}>
    <VoiceCapture
      onTranscript={(r, audio) => {
        window.__voiceResult = { ...r, audioBytes: audio.size, audioType: audio.type, device: transcriberDevice() };
      }}
      onCancel={() => {
        window.__voiceCancelled = true;
      }}
    />
  </main>,
);
