/** A scriptable stand-in for the transcription worker (tests only). */
import type { WorkerLike } from './client';
import type { FromWorker, ToWorker } from './protocol';

export class FakeWorker implements WorkerLike {
  static instances: FakeWorker[] = [];
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  received: ToWorker[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(m: ToWorker) {
    this.received.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  /** Simulate a message from the worker. */
  emit(m: FromWorker) {
    this.onmessage?.({ data: m } as MessageEvent<FromWorker>);
  }
  lastTranscribe() {
    return [...this.received].reverse().find((m) => m.type === 'transcribe') as Extract<ToWorker, { type: 'transcribe' }> | undefined;
  }
  static latest() {
    return FakeWorker.instances.at(-1)!;
  }
  static reset() {
    FakeWorker.instances = [];
  }
}
