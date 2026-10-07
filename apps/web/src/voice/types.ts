/**
 * On-device voice transcription (Whisper in a Web Worker). Audio never leaves her device;
 * model files are served from our own origin, never a third-party CDN.
 */
export type TranscriberStatus = 'idle' | 'downloading' | 'ready' | 'transcribing' | 'error' | 'unsupported';

export interface TranscriptResult {
  text: string;
  /** Rough language guess, if the model reports one. */
  language?: string;
  durationSec: number;
}

/**
 * React component contract (exported from src/voice/index.ts):
 *   <VoiceCapture
 *     onTranscript={(r: TranscriptResult, audio: Blob) => void}  // she reviews/edits r.text before it becomes a StoryEntry
 *     onCancel={() => void}
 *   />
 * Also export: isVoiceSupported(): boolean, preloadTranscriber(onProgress?: (pct: number) => void): Promise<void>
 */
export {};
