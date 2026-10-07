/**
 * @voice — REAL on-device transcription, end to end, under the production CSP.
 *
 * Chromium's fake microphone plays a WAV of spoken English (generated with macOS `say`), <VoiceCapture> records
 * it, Whisper transcribes it in a Web Worker, and we assert that (a) the words come out right and (b) the browser
 * made ZERO requests to any origin but ours — no model hub, no CDN.
 *
 *   npm run fetch-models
 *   MATRA_VOICE_HARNESS=1 npm run build
 *   npx playwright test -c playwright.prod.config.ts --grep @voice
 *
 * Skipped automatically when the model files or the harness page are absent (normal builds), or when no WAV can
 * be produced (non-macOS without MATRA_VOICE_WAV).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import manifest from '../apps/web/src/voice/model-manifest.json' with { type: 'json' };
import { expect, test } from './helpers';

const SENTENCE =
  'I was at a party on Saturday night with some friends. Around eleven, he offered to walk me home. I told him no, but he followed me anyway.';

const MODEL_DIR = path.resolve('apps/web/public/models', manifest.modelId);
const HARNESS = path.resolve(process.env.MATRA_WEB_DIR || 'apps/web/dist', 'src/voice/harness/index.html');
const haveModels = manifest.files.every((f) => fs.existsSync(path.join(MODEL_DIR, f.path)));
const haveHarness = fs.existsSync(HARNESS);

function makeWav(): string | null {
  if (process.env.MATRA_VOICE_WAV) return path.resolve(process.env.MATRA_VOICE_WAV);
  if (process.platform !== 'darwin') return null;
  const dir = path.resolve('test-results/voice-fixture');
  const wav = path.join(dir, 'clip.wav');
  if (fs.existsSync(wav)) return wav;
  fs.mkdirSync(dir, { recursive: true });
  const aiff = path.join(dir, 'clip.aiff');
  try {
    execFileSync('say', ['-o', aiff, SENTENCE]);
    execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', aiff, wav]);
    return wav;
  } catch {
    return null;
  }
}
const WAV = haveModels && haveHarness ? makeWav() : null;
/** Clip length from the WAV header (16-bit PCM). */
function wavSeconds(file: string): number {
  const b = fs.readFileSync(file);
  const rate = b.readUInt32LE(24);
  const channels = b.readUInt16LE(22);
  const data = b.indexOf('data');
  return b.readUInt32LE(data + 4) / (rate * channels * 2);
}

/** Word error rate (Levenshtein over normalised words). */
function wer(ref: string, hyp: string): number {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9' ]+/g, ' ')
      .replace(/\b11\b/g, 'eleven')
      .split(/\s+/)
      .filter(Boolean);
  const r = norm(ref);
  const h = norm(hyp);
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++)
    for (let j = 1; j <= h.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
  return d[r.length][h.length] / r.length;
}

/**
 * How the clip reaches the microphone:
 *  - 'device' (default): Chromium's fake capture device plays the WAV (--use-file-for-fake-audio-capture).
 *  - 'inject': getUserMedia returns a WebAudio stream of the WAV. Same MediaRecorder → decode → worker → Whisper
 *    path; use it where the fake capture device hangs (seen on macOS when the host process lacks microphone
 *    permission in System Settings › Privacy › Microphone).
 */
const MIC = process.env.MATRA_VOICE_MIC === 'inject' ? 'inject' : 'device';

// Top level: launch options apply per file.
test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: [
      ...(WAV && MIC === 'device'
        ? ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}%noloop`]
        : []),
      // MATRA_VOICE_WEBGPU=1: give headless Chromium a WebGPU adapter, exercising the WebGPU path (and its CPU fallback).
      ...(process.env.MATRA_VOICE_WEBGPU === '1' ? ['--enable-unsafe-webgpu'] : []),
    ],
  },
});

test.describe('@voice on-device transcription (production build)', () => {
  test.skip(!haveModels, 'models absent — run `npm run fetch-models`');
  test.skip(!haveHarness, 'voice harness not built — run `MATRA_VOICE_HARNESS=1 npm run build`');
  test.skip(!WAV, 'no speech clip — needs macOS `say`, or set MATRA_VOICE_WAV');

  test('records, transcribes on-device, and never contacts another origin', async ({ page, context, baseURL }) => {
    test.setTimeout(600_000);
    const origin = new URL(baseURL!).origin;
    const foreign: string[] = [];
    const requests: string[] = [];
    const track = (url: string) => {
      if (url.startsWith('data:') || url.startsWith('blob:')) return;
      requests.push(url);
      if (new URL(url).origin !== origin) foreign.push(url);
    };
    context.on('request', (r) => track(r.url()));
    page.on('request', (r) => track(r.url()));
    page.on('worker', (w) => track(w.url()));
    // Fail closed: anything not ours is aborted (and recorded above), so a leak can't even succeed.
    await context.route(
      (url) => url.origin !== origin,
      (route) => route.abort(),
    );

    if (MIC === 'inject') {
      await page.addInitScript((b64: string) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        navigator.mediaDevices.getUserMedia = async () => {
          const ctx = new AudioContext();
          const buf = await ctx.decodeAudioData(bytes.buffer.slice(0));
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.loop = false; // play once, then silence
          const dest = ctx.createMediaStreamDestination();
          src.connect(dest);
          src.start();
          return dest.stream;
        };
      }, fs.readFileSync(WAV!).toString('base64'));
    }

    // Experiment: MATRA_VOICE_COEP=1 adds Cross-Origin-Embedder-Policy so the page is cross-origin isolated and
    // ONNX Runtime can use wasm threads. (The server does not send COEP today.)
    if (process.env.MATRA_VOICE_COEP === '1') {
      await page.route(
        (url) => url.origin === origin,
        async (route) => {
          const r = await route.fetch();
          await route.fulfill({ response: r, headers: { ...r.headers(), 'cross-origin-embedder-policy': 'require-corp' } });
        },
      );
    }

    const res = await page.goto(`/src/voice/harness/index.html${process.env.MATRA_VOICE_WEBGPU === '1' ? '?device=webgpu' : ''}`);
    const csp = res!.headers()['content-security-policy'];
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(res!.headers()['permissions-policy']).toContain('microphone=(self)');

    await expect(page.getByText("the recording never leaves it", { exact: false })).toBeVisible();
    await expect(page.getByText(/one-time setup of about \d+ MB/)).toBeVisible();

    await page.getByRole('button', { name: /Start talking/ }).click();
    await expect(page.getByRole('button', { name: "I'm done" })).toBeVisible();
    await expect(page.getByText(/^0:0\d$/)).toBeVisible();
    // Let the clip play once, plus a little silence.
    await page.waitForTimeout(wavSeconds(WAV!) * 1000 + 1200);
    const tStop = Date.now();
    await page.getByRole('button', { name: "I'm done" }).click();

    // First use: the honest one-time setup screen (unless it finished while she was talking).
    const textbox = page.getByRole('textbox', { name: 'Your words' });
    await expect(textbox).toBeVisible({ timeout: 480_000 });
    const tReview = Date.now();
    const transcript = await textbox.inputValue();
    const timings = await page.evaluate(() => (window as any).__voiceTimings);
    const score = wer(SENTENCE, transcript);
    console.log(`[voice] transcript: ${JSON.stringify(transcript)}`);
    console.log(`[voice] WER ${(score * 100).toFixed(1)}% · stop→review ${tReview - tStop} ms · ${JSON.stringify(timings)}`);
    await expect(page.getByRole('heading', { name: 'Does this look right?' })).toBeVisible();
    expect(score).toBeLessThan(0.25);

    // She fixes something, chooses to keep the recording, and accepts.
    await textbox.fill(transcript + ' I remember his blue jacket.');
    await page.getByRole('checkbox', { name: /keep the original recording/ }).check();
    await page.getByRole('button', { name: 'Use this' }).click();
    const result = await page.evaluate(() => (window as any).__voiceResult);
    expect(result.text).toContain('I remember his blue jacket.');
    expect(result.keepAudio).toBe(true);
    expect(result.audioBytes).toBeGreaterThan(1000);
    expect(result.durationSec).toBeGreaterThan(5);

    // Second time: model comes from the on-device cache — no setup screen, still nothing foreign.
    await page.reload();
    await expect(page.getByText(/one-time setup/)).toHaveCount(0);
    await page.getByRole('button', { name: /Start talking/ }).click();
    await page.waitForTimeout(4000);
    const t2 = Date.now();
    await page.getByRole('button', { name: "I'm done" }).click();
    await expect(page.getByRole('textbox', { name: 'Your words' })).toBeVisible({ timeout: 240_000 });
    const timings2 = await page.evaluate(() => (window as any).__voiceTimings);
    console.log(`[voice] cached run: stop→review ${Date.now() - t2} ms · ${JSON.stringify(timings2)}`);

    console.log(`[voice] ${requests.length} requests, all same-origin: ${foreign.length === 0}`);
    expect(foreign, 'requests to other origins').toEqual([]);
    expect(requests.some((u) => u.includes('/models/ort/'))).toBe(true);
    expect(requests.some((u) => u.includes(`/models/${manifest.modelId}/onnx/`))).toBe(true);
  });
});
