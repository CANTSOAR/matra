import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wipeAll } from '../lib/wipe';
import { setWorkerFactory } from './client';
import { FakeWorker } from './fakeWorker.test-util';
import { MicError, type Recording } from './recorder';
import { VoiceCapture, voiceDeps } from './VoiceCapture';

const original = { ...voiceDeps };

function fakeRecording() {
  const blob = new Blob([new Uint8Array(2048)], { type: 'audio/webm' });
  const rec = {
    mimeType: 'audio/webm',
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(async () => blob),
    cancel: vi.fn(),
    level: vi.fn(() => 0.4),
  } satisfies Recording;
  return { rec, blob };
}

function setup({ supported = true, setUp = false } = {}) {
  const onTranscript = vi.fn();
  const onCancel = vi.fn();
  const { rec, blob } = fakeRecording();
  voiceDeps.isSupported = () => supported;
  voiceDeps.isSetUp = async () => setUp;
  voiceDeps.startRecording = vi.fn(async () => rec);
  voiceDeps.decode = vi.fn(async () => ({ samples: new Float32Array(16000 * 3), sampleRate: 16000 }));
  const utils = render(<VoiceCapture onTranscript={onTranscript} onCancel={onCancel} />);
  return { ...utils, onTranscript, onCancel, rec, blob, user: userEvent.setup() };
}

beforeEach(() => {
  FakeWorker.reset();
  setWorkerFactory(() => new FakeWorker());
});
afterEach(() => {
  Object.assign(voiceDeps, original);
  setWorkerFactory();
});

describe('<VoiceCapture>', () => {
  it('invites her to talk, with the privacy promise and an honest one-time setup size', async () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Say it out loud' })).toBeInTheDocument();
    expect(screen.getByText(/the recording never leaves it/)).toBeInTheDocument();
    expect(await screen.findByText(/one-time setup of about \d+ MB/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument(); // aria-live region
  });

  it('does not mention the download once the model is on the device', async () => {
    setup({ setUp: true });
    await screen.findByText(/pause whenever you need to/);
    expect(screen.queryByText(/one-time setup/)).not.toBeInTheDocument();
  });

  it('unsupported browser: offers typing instead', async () => {
    const { onCancel, user } = setup({ supported: false });
    expect(screen.getByRole('heading', { name: /isn't available in this browser/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Type instead' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('microphone permission denied: kind message, how to enable it, try again or type', async () => {
    const { user, onCancel } = setup();
    voiceDeps.startRecording = vi.fn(async () => {
      throw new MicError('denied', 'NotAllowedError');
    });
    await user.click(screen.getByRole('button', { name: /Start talking/ }));
    expect(await screen.findByRole('heading', { name: "The microphone isn't available" })).toBeInTheDocument();
    expect(screen.getByText(/nothing was recorded/)).toBeInTheDocument();
    expect(screen.getByText(/Microphone/, { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Type instead' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Type instead' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('record → pause/resume → stop → first-time download progress → transcribing → review/edit → onTranscript', async () => {
    const { user, rec, blob, onTranscript } = setup();
    await user.click(screen.getByRole('button', { name: /Start talking/ }));
    expect(await screen.findByRole('heading', { name: /Listening/ })).toBeInTheDocument();
    expect(screen.getByText('0:00')).toBeInTheDocument();
    // the model starts loading in the background while she talks
    const w = FakeWorker.latest();
    expect(w.received[0]).toEqual({ type: 'load', prefer: 'auto' });

    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(rec.pause).toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Paused' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    expect(rec.resume).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: "I'm done" }));
    expect(rec.stop).toHaveBeenCalled();

    // first use: honest download progress
    act(() => w.emit({ type: 'load-progress', loaded: 47_000_000, total: 94_000_000, fromCache: false }));
    expect(await screen.findByRole('heading', { name: 'Getting ready' })).toBeInTheDocument();
    expect(screen.getByText(/One-time setup, about 94 MB/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'One-time setup' })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText(/47 MB of 94 MB/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Setting up, 50 percent.');

    act(() => w.emit({ type: 'ready', device: 'wasm', loadMs: 10 }));
    expect(await screen.findByRole('heading', { name: /Turning your words into text/ })).toBeInTheDocument();
    await waitFor(() => expect(w.lastTranscribe()).toBeDefined());
    const job = w.lastTranscribe()!;
    expect(job.audio.length).toBe(48000);
    act(() => w.emit({ type: 'progress', id: job.id, fraction: 0.6, partial: 'I was at a party' }));
    expect(screen.getByRole('progressbar', { name: /Turning your words/ })).toHaveAttribute('aria-valuenow', '60');
    act(() =>
      w.emit({ type: 'result', id: job.id, text: 'I was at a party on Saturday.', language: 'en', durationSec: 3, elapsedMs: 900 }),
    );

    expect(await screen.findByRole('heading', { name: 'Does this look right?' })).toBeInTheDocument();
    expect(screen.getByText('You can fix anything.')).toBeInTheDocument();
    const box = screen.getByRole('textbox', { name: 'Your words' });
    expect(box).toHaveValue('I was at a party on Saturday.');
    expect(box).toHaveFocus();
    await user.clear(box);
    await user.type(box, 'I was at a party on Friday.');
    const keep = screen.getByRole('checkbox', { name: /keep the original recording/ });
    expect(keep).not.toBeChecked(); // off unless she chooses it
    await user.click(keep);
    await user.click(screen.getByRole('button', { name: 'Use this' }));

    expect(onTranscript).toHaveBeenCalledTimes(1);
    const [result, audio] = onTranscript.mock.calls[0];
    expect(result).toEqual({ text: 'I was at a party on Friday.', language: 'en', durationSec: 3, keepAudio: true });
    expect(audio).toBe(blob);
  });

  it('a transcription failure keeps the recording and lets her type the words herself', async () => {
    const { user, onTranscript, blob } = setup({ setUp: true });
    await user.click(screen.getByRole('button', { name: /Start talking/ }));
    await user.click(await screen.findByRole('button', { name: "I'm done" }));
    const w = FakeWorker.latest();
    act(() => w.emit({ type: 'ready', device: 'wasm', loadMs: 1 }));
    await waitFor(() => expect(w.lastTranscribe()).toBeDefined());
    act(() => w.emit({ type: 'error', id: w.lastTranscribe()!.id, code: 'transcribe_failed', message: 'boom' }));
    expect(await screen.findByRole('heading', { name: /Something went wrong/ })).toBeInTheDocument();
    expect(screen.getByText(/Nothing has left your device/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Type it myself' }));
    await user.type(screen.getByRole('textbox', { name: 'Your words' }), 'He followed me home.');
    await user.click(screen.getByRole('button', { name: 'Use this' }));
    expect(onTranscript.mock.calls[0][0].text).toBe('He followed me home.');
    expect(onTranscript.mock.calls[0][1]).toBe(blob);
  });

  it('Quick Exit (matra:wipe) while recording stops the microphone and terminates the worker', async () => {
    const { user, rec, onTranscript } = setup();
    await user.click(screen.getByRole('button', { name: /Start talking/ }));
    await screen.findByRole('heading', { name: /Listening/ });
    const w = FakeWorker.latest();
    act(() => {
      window.dispatchEvent(new Event('matra:wipe'));
    });
    expect(rec.cancel).toHaveBeenCalled();
    expect(w.terminated).toBe(true);
    expect(screen.getByRole('heading', { name: 'Say it out loud' })).toBeInTheDocument();
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it('wipeAll() (the app’s Quick Exit / auto-lock) mid-transcription drops everything', async () => {
    const { user, onTranscript } = setup({ setUp: true });
    await user.click(screen.getByRole('button', { name: /Start talking/ }));
    await user.click(await screen.findByRole('button', { name: "I'm done" }));
    const w = FakeWorker.latest();
    act(() => w.emit({ type: 'ready', device: 'wasm', loadMs: 1 }));
    await waitFor(() => expect(w.lastTranscribe()).toBeDefined());
    act(() => wipeAll());
    expect(w.terminated).toBe(true);
    // a late result from the dead worker must not resurface her words
    act(() => w.emit({ type: 'result', id: w.lastTranscribe()!.id, text: 'secret', durationSec: 1, elapsedMs: 1 }));
    expect(screen.queryByDisplayValue('secret')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Say it out loud' })).toBeInTheDocument();
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it('unmounting stops the microphone and the worker', async () => {
    const { user, rec, unmount } = setup();
    await user.click(screen.getByRole('button', { name: /Start talking/ }));
    await screen.findByRole('heading', { name: /Listening/ });
    const w = FakeWorker.latest();
    unmount();
    expect(rec.cancel).toHaveBeenCalled();
    expect(w.terminated).toBe(true);
  });

  it('stops by itself at the length limit and says so', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setInterval', 'clearInterval', 'performance'] });
    try {
      const onTranscript = vi.fn();
      const { rec } = fakeRecording();
      voiceDeps.isSupported = () => true;
      voiceDeps.isSetUp = async () => true;
      voiceDeps.startRecording = vi.fn(async () => rec);
      voiceDeps.decode = vi.fn(async () => ({ samples: new Float32Array(160), sampleRate: 16000 }));
      render(<VoiceCapture onTranscript={onTranscript} onCancel={() => {}} maxSeconds={120} />);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.click(screen.getByRole('button', { name: /Start talking/ }));
      await screen.findByRole('heading', { name: /Listening/ });
      await act(async () => {
        vi.advanceTimersByTime(121_000);
      });
      expect(rec.stop).toHaveBeenCalled();
      expect(await screen.findByText(/longest single recording \(2 minutes\)/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
