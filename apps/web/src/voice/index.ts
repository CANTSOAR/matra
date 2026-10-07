/**
 * On-device voice: <VoiceCapture> records, transcribes with Whisper in a Web Worker, and lets her review the
 * text before anything is saved. Audio never leaves the device; model files come from our own origin.
 */
export { VoiceCapture, isVoiceSupported, voiceDeps } from './VoiceCapture';
export { preloadTranscriber, isTranscriberSetUp, terminateTranscriber } from './client';
export { SETUP_BYTES, formatMB } from './config';
export type { TranscriptResult, TranscriberStatus, VoiceCaptureProps } from './types';
