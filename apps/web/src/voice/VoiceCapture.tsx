import { useCallback, useEffect, useId, useReducer, useRef, useState } from 'react';
import { onWipe } from '../lib/wipe';
import { formatElapsed } from './audio';
import { formatMB, SETUP_BYTES } from './config';
import * as client from './client';
import { decodeRecording, isRecordingSupported, MicError, startRecording, type Recording } from './recorder';
import type { TranscriptResult, VoiceCaptureProps } from './types';
import './voice.css';

/** Seams for tests (and for a future native shell): swap the microphone / decoder / transcriber. */
export const voiceDeps = {
  isSupported: (): boolean => isVoiceSupported(),
  startRecording: (): Promise<Recording> => startRecording(),
  decode: (b: Blob) => decodeRecording(b),
  isSetUp: (): Promise<boolean> => client.isTranscriberSetUp(),
  load: client.loadTranscriber,
  transcribe: client.transcribe,
  terminate: client.terminateTranscriber,
};

/** Can this browser record and transcribe on-device? */
export function isVoiceSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window.isSecureContext ?? true) &&
    typeof Worker !== 'undefined' &&
    typeof WebAssembly !== 'undefined' &&
    isRecordingSupported()
  );
}

export type Phase =
  | { name: 'intro' }
  | { name: 'requesting' }
  | { name: 'denied'; noDevice: boolean }
  | { name: 'unsupported' }
  | { name: 'recording'; paused: boolean }
  | { name: 'downloading'; loaded: number; total: number }
  | { name: 'transcribing'; fraction: number; partial: string }
  | { name: 'review'; text: string; durationSec: number; language?: string; empty: boolean }
  | { name: 'error'; message: string };

type Action =
  | { type: 'set'; phase: Phase }
  | { type: 'review-edit'; text: string };

function reducer(state: Phase, a: Action): Phase {
  if (a.type === 'set') return a.phase;
  if (a.type === 'review-edit' && state.name === 'review') return { ...state, text: a.text };
  return state;
}

const DEFAULT_MAX = 30 * 60;

const MicIcon = () => (
  <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true" focusable="false">
    <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export function VoiceCapture({ onTranscript, onCancel, maxSeconds = DEFAULT_MAX }: VoiceCaptureProps) {
  const [phase, dispatch] = useReducer(reducer, undefined, (): Phase => (voiceDeps.isSupported() ? { name: 'intro' } : { name: 'unsupported' }));
  const set = useCallback((p: Phase) => dispatch({ type: 'set', phase: p }), []);
  const [setUp, setSetUp] = useState<boolean | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [keepAudio, setKeepAudio] = useState(false);
  const [notice, setNotice] = useState('');
  const [announce, setAnnounce] = useState('');

  const rec = useRef<Recording | null>(null);
  const blob = useRef<Blob | null>(null);
  const clock = useRef({ started: 0, pausedTotal: 0, pausedAt: 0 });
  const meter = useRef<HTMLDivElement | null>(null);
  const alive = useRef(true);
  const run = useRef(0); // bumps on every reset: late async results from an older run are ignored
  const ids = { title: useId(), status: useId(), text: useId(), keep: useId() };
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let off = false;
    voiceDeps
      .isSetUp()
      .then((v) => !off && setSetUp(v))
      .catch(() => !off && setSetUp(false));
    return () => {
      off = true;
    };
  }, []);

  /** Stop the mic, drop the recording and any transcript, and kill the worker. Quick Exit and unmount. */
  const hardStop = useCallback(() => {
    run.current++;
    rec.current?.cancel();
    rec.current = null;
    blob.current = null;
    voiceDeps.terminate();
  }, []);

  useEffect(() => {
    alive.current = true;
    const wipe = () => {
      hardStop();
      if (alive.current) {
        set({ name: 'intro' });
        setElapsed(0);
        setNotice('');
      }
    };
    const offWipe = onWipe(wipe);
    window.addEventListener('matra:wipe', wipe);
    return () => {
      alive.current = false;
      offWipe();
      window.removeEventListener('matra:wipe', wipe);
      hardStop();
    };
  }, [hardStop, set]);

  // Elapsed time + level meter while recording.
  const recording = phase.name === 'recording';
  const paused = recording && phase.paused;
  useEffect(() => {
    if (!recording) return;
    let raf = 0;
    const tick = () => {
      const c = clock.current;
      const now = performance.now();
      const pausedNow = c.pausedAt ? now - c.pausedAt : 0;
      const sec = (now - c.started - c.pausedTotal - pausedNow) / 1000;
      setElapsed(Math.floor(sec));
      if (sec >= maxSeconds) void finish(true);
    };
    const timer = window.setInterval(tick, 250);
    const draw = () => {
      const lvl = paused ? 0 : (rec.current?.level() ?? 0);
      if (meter.current) meter.current.style.setProperty('--vc-level', lvl.toFixed(3));
      raf = requestAnimationFrame(draw);
    };
    raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(draw) : 0;
    return () => {
      window.clearInterval(timer);
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, paused, maxSeconds]);

  // Move focus to the main control of each new step, so keyboard and screen-reader users are never lost.
  useEffect(() => {
    if (phase.name === 'review') textRef.current?.focus();
    else if (phase.name !== 'intro') primaryRef.current?.focus();
  }, [phase.name]);

  async function begin() {
    const myRun = ++run.current;
    setNotice('');
    set({ name: 'requesting' });
    try {
      const r = await voiceDeps.startRecording();
      if (myRun !== run.current || !alive.current) {
        r.cancel();
        return;
      }
      rec.current = r;
      clock.current = { started: performance.now(), pausedTotal: 0, pausedAt: 0 };
      setElapsed(0);
      set({ name: 'recording', paused: false });
      setAnnounce('Recording. Take your time.');
      // Start the (one-time) setup in the background while she talks.
      voiceDeps.load().catch(() => {});
    } catch (e) {
      if (myRun !== run.current) return;
      if (e instanceof MicError && e.kind === 'unsupported') set({ name: 'unsupported' });
      else if (e instanceof MicError && (e.kind === 'denied' || e.kind === 'no-device')) set({ name: 'denied', noDevice: e.kind === 'no-device' });
      else set({ name: 'denied', noDevice: false });
    }
  }

  function togglePause() {
    const r = rec.current;
    if (!r || phase.name !== 'recording') return;
    const c = clock.current;
    if (phase.paused) {
      c.pausedTotal += performance.now() - c.pausedAt;
      c.pausedAt = 0;
      r.resume();
      set({ name: 'recording', paused: false });
      setAnnounce('Recording again.');
    } else {
      c.pausedAt = performance.now();
      r.pause();
      set({ name: 'recording', paused: true });
      setAnnounce('Paused.');
    }
  }

  async function finish(hitLimit = false) {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    const myRun = run.current;
    if (hitLimit) setNotice(`That's the longest single recording (${Math.round(maxSeconds / 60)} minutes). You can add another one afterwards.`);
    set({ name: 'transcribing', fraction: 0, partial: '' });
    const b = await r.stop();
    if (myRun !== run.current) return;
    blob.current = b;
    await transcribeBlob(b, myRun);
  }

  async function transcribeBlob(b: Blob, myRun: number) {
    try {
      set({ name: 'transcribing', fraction: 0, partial: '' });
      // Model first (downloads only the first time), so progress is honest about which step we are on.
      let lastPct = -1;
      await voiceDeps.load((p) => {
        if (myRun !== run.current || p.fromCache || p.loaded >= p.total) return;
        set({ name: 'downloading', loaded: p.loaded, total: p.total });
        const pct = Math.floor((p.loaded / p.total) * 10) * 10;
        if (pct !== lastPct) {
          lastPct = pct;
          setAnnounce(`Setting up, ${pct} percent.`);
        }
      });
      if (myRun !== run.current) return;
      setSetUp(true);
      set({ name: 'transcribing', fraction: 0, partial: '' });
      setAnnounce('Turning your words into text.');
      const { samples, sampleRate } = await voiceDeps.decode(b);
      if (myRun !== run.current) return;
      let lastAnnounced = 0;
      const result = await voiceDeps.transcribe(samples, sampleRate, (fraction, partial) => {
        if (myRun !== run.current) return;
        set({ name: 'transcribing', fraction, partial: partial ?? '' });
        if (fraction - lastAnnounced >= 0.25) {
          lastAnnounced = fraction;
          setAnnounce(`${Math.round(fraction * 100)} percent done.`);
        }
      });
      if (myRun !== run.current) return;
      const text = result.text.trim();
      set({ name: 'review', text, durationSec: result.durationSec, language: result.language, empty: !text });
      setAnnounce(text ? 'Ready. Does this look right? You can fix anything.' : "We couldn't make out any words.");
    } catch (e) {
      if (myRun !== run.current || e instanceof client.WipedError) return;
      set({ name: 'error', message: (e as Error)?.message ?? String(e) });
      setAnnounce('Something went wrong turning this into text.');
    }
  }

  function startOver() {
    hardStop();
    setElapsed(0);
    setNotice('');
    setKeepAudio(false);
    set({ name: 'intro' });
  }

  function accept() {
    if (phase.name !== 'review' || !blob.current) return;
    const r: TranscriptResult = {
      text: phase.text.trim(),
      language: phase.language,
      durationSec: phase.durationSec,
      keepAudio,
    };
    const b = blob.current;
    blob.current = null;
    onTranscript(r, b);
  }

  function cancel() {
    hardStop();
    onCancel();
  }

  function typeInstead() {
    // From the error step she can still keep the recording and write the words herself.
    if (blob.current) set({ name: 'review', text: '', durationSec: 0, empty: true });
    else cancel();
  }

  const statusLabel = (() => {
    switch (phase.name) {
      case 'recording':
        return phase.paused ? 'Paused' : 'Listening';
      default:
        return '';
    }
  })();

  return (
    <section className="vc" aria-labelledby={ids.title} data-phase={phase.name}>
      <p className="visually-hidden vc-sr" role="status" aria-live="polite" id={ids.status}>
        {announce}
      </p>

      {phase.name === 'intro' && (
        <div className="vc-step vc-intro">
          <h2 className="vc-title" id={ids.title}>
            Say it out loud
          </h2>
          <p className="vc-lead">
            Talk it through — as much or as little as you like. It's turned into text right here on your device; the recording never
            leaves it.
          </p>
          <button type="button" className="vc-mic" onClick={begin} aria-describedby={ids.text}>
            <MicIcon />
            <span>Start talking</span>
          </button>
          <p className="vc-note" id={ids.text}>
            {setUp === false
              ? `The first time, this device needs a one-time setup of about ${formatMB(SETUP_BYTES)}. Wi-Fi is best. After that it's ready whenever you are.`
              : 'You can pause whenever you need to, and read it all before anything is saved.'}
          </p>
          <button type="button" className="btn btn-quiet vc-alt" onClick={cancel}>
            I'd rather type
          </button>
        </div>
      )}

      {phase.name === 'requesting' && (
        <div className="vc-step">
          <h2 className="vc-title" id={ids.title}>
            Asking for the microphone…
          </h2>
          <p className="vc-lead">Your browser may ask whether this page can use the microphone.</p>
        </div>
      )}

      {phase.name === 'denied' && (
        <div className="vc-step">
          <h2 className="vc-title" id={ids.title}>
            {phase.noDevice ? "We couldn't find a microphone" : "The microphone isn't available"}
          </h2>
          {phase.noDevice ? (
            <p className="vc-lead">That's okay. If you have a headset or another microphone, connect it and try again.</p>
          ) : (
            <p className="vc-lead">
              That's okay — nothing was recorded. If you'd like to talk instead of type, allow the microphone for this page: tap the lock
              or <span aria-hidden="true">ⓘ</span> icon next to the web address, set <strong>Microphone</strong> to <strong>Allow</strong>,
              then try again. On iPhone you can also check Settings › Safari › Microphone.
            </p>
          )}
          <p className="vc-note">You can type instead — it works just as well.</p>
          <div className="vc-actions">
            <button type="button" className="btn btn-primary" ref={primaryRef} onClick={cancel}>
              Type instead
            </button>
            <button type="button" className="btn" onClick={begin}>
              Try again
            </button>
          </div>
        </div>
      )}

      {phase.name === 'unsupported' && (
        <div className="vc-step">
          <h2 className="vc-title" id={ids.title}>
            Talking isn't available in this browser
          </h2>
          <p className="vc-lead">You can type instead — it works just as well. (Recent Chrome, Edge, Firefox and Safari support talking.)</p>
          <div className="vc-actions">
            <button type="button" className="btn btn-primary" ref={primaryRef} onClick={cancel}>
              Type instead
            </button>
          </div>
        </div>
      )}

      {phase.name === 'recording' && (
        <div className="vc-step vc-recording">
          <h2 className="vc-title" id={ids.title}>
            {statusLabel}
            {!phase.paused && <span aria-hidden="true">…</span>}
          </h2>
          <p className="vc-time" aria-label={`Elapsed ${formatElapsed(elapsed)}`}>
            <span className={`vc-dot${phase.paused ? ' is-paused' : ''}`} aria-hidden="true" />
            <span className="vc-time-num">{formatElapsed(elapsed)}</span>
          </p>
          <div className="vc-meter" ref={meter} aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
          <p className="vc-note">{phase.paused ? 'Take all the time you need.' : 'Take your time. You can pause whenever you need to.'}</p>
          <div className="vc-actions">
            <button type="button" className="btn btn-primary" ref={primaryRef} onClick={() => void finish()}>
              I'm done
            </button>
            <button type="button" className="btn" onClick={togglePause} aria-pressed={phase.paused}>
              {phase.paused ? 'Resume' : 'Pause'}
            </button>
            <button type="button" className="btn btn-quiet" onClick={startOver}>
              Start over
            </button>
          </div>
        </div>
      )}

      {phase.name === 'downloading' && (
        <div className="vc-step">
          <h2 className="vc-title" id={ids.title}>
            Getting ready
          </h2>
          <p className="vc-lead">One-time setup, about {formatMB(phase.total)}. This only happens once; your recording is waiting safely on this device.</p>
          <Progress value={phase.loaded / phase.total} label="One-time setup" detail={`${formatMB(phase.loaded)} of ${formatMB(phase.total)}`} />
          <div className="vc-actions">
            <button type="button" className="btn btn-quiet" ref={primaryRef} onClick={startOver}>
              Stop and discard
            </button>
          </div>
        </div>
      )}

      {phase.name === 'transcribing' && (
        <div className="vc-step">
          <h2 className="vc-title" id={ids.title}>
            Turning your words into text…
          </h2>
          <p className="vc-lead">This happens on your device and can take a little while for longer recordings.</p>
          <Progress value={phase.fraction} label="Turning your words into text" />
          {notice && <p className="vc-note">{notice}</p>}
          {phase.partial && (
            <p className="vc-partial" aria-hidden="true">
              {phase.partial}
            </p>
          )}
          <div className="vc-actions">
            <button type="button" className="btn btn-quiet" ref={primaryRef} onClick={startOver}>
              Stop and discard
            </button>
          </div>
        </div>
      )}

      {phase.name === 'review' && (
        <div className="vc-step vc-review">
          <h2 className="vc-title" id={ids.title}>
            {phase.empty ? "We couldn't make out any words" : 'Does this look right?'}
          </h2>
          <p className="vc-lead">{phase.empty ? 'You can type what you said here, or record again.' : 'You can fix anything.'}</p>
          {notice && <p className="vc-note">{notice}</p>}
          <label className="visually-hidden" htmlFor={ids.text}>
            Your words
          </label>
          <textarea
            id={ids.text}
            ref={textRef}
            className="vc-text"
            value={phase.text}
            rows={8}
            spellCheck
            onChange={(e) => dispatch({ type: 'review-edit', text: e.target.value })}
          />
          <div className="vc-keep">
            <input id={ids.keep} type="checkbox" checked={keepAudio} onChange={(e) => setKeepAudio(e.target.checked)} />
            <label htmlFor={ids.keep}>
              Also keep the original recording, encrypted in my vault
              <span className="vc-keep-hint">It can help later as evidence. Only you can open it.</span>
            </label>
          </div>
          <div className="vc-actions">
            <button type="button" className="btn btn-primary" onClick={accept} disabled={!phase.text.trim() && !keepAudio}>
              Use this
            </button>
            <button type="button" className="btn" onClick={startOver}>
              Record again
            </button>
            <button type="button" className="btn btn-quiet" onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase.name === 'error' && (
        <div className="vc-step">
          <h2 className="vc-title" id={ids.title}>
            Something went wrong turning this into text
          </h2>
          <p className="vc-lead">Nothing has left your device. You can try again, or write the words yourself — your recording is still here.</p>
          <div className="vc-actions">
            <button type="button" className="btn btn-primary" ref={primaryRef} onClick={() => blob.current && void transcribeBlob(blob.current, run.current)}>
              Try again
            </button>
            <button type="button" className="btn" onClick={typeInstead}>
              Type it myself
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Progress({ value, label, detail }: { value: number; label: string; detail?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className="vc-progress">
      <div className="vc-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="vc-progress-text">
        {pct}%{detail ? ` · ${detail}` : ''}
      </p>
    </div>
  );
}
