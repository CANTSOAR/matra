import { useEffect, useId, useRef, useState } from 'react';
import type { StoryEntry } from '../understand/types';
import { VoiceCapture, adapterStatus } from './adapters';
import { COPY } from './copy';
import { FilePicker } from './FilePicker';

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const MicIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="9" y="3" width="6" height="12" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
const ClipIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l8.2-8.2a3.4 3.4 0 0 1 4.8 4.8l-8.1 8.1a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export interface ComposerProps {
  value: string;
  onChange: (text: string) => void;
  onAdd: (text: string, source: StoryEntry['source']) => void;
  onAddFiles?: (files: File[]) => Promise<void>;
  /** First time: big and open. Later: a calmer "Add more" box with a way to close it. */
  first: boolean;
  onCancel?: () => void;
  fileStatus?: string;
  greeting?: string;
}

/** The open page: type, talk, or add files. Her words are added exactly as given. */
export function Composer({ value, onChange, onAdd, onAddFiles, first, onCancel, fileStatus, greeting }: ComposerProps) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [voice, setVoice] = useState<'off' | 'capture' | 'review'>('off');
  const [transcript, setTranscript] = useState('');
  useEffect(() => {
    if (!first) ref.current?.focus({ preventScroll: true });
  }, [first]);

  const add = () => {
    if (value.trim() === '') return;
    onAdd(value, 'typed');
  };

  return (
    <section className={`space-composer${first ? ' is-first' : ''}`} aria-labelledby={`${id}-title`}>
      {first ? (
        <>
          {greeting && <p className="space-eyebrow space-greeting">{greeting}</p>}
          <h2 id={`${id}-title`} className="space-display" tabIndex={-1}>
            {COPY.start.title}
          </h2>
          <p className="space-lead">{COPY.start.lead}</p>
        </>
      ) : (
        <h3 id={`${id}-title`} className="space-h3">
          {COPY.start.addMore}
        </h3>
      )}

      {voice === 'off' && (
        <div className="space-paper">
          <label className="space-visually-hidden" htmlFor={`${id}-text`}>
            {COPY.start.label}
          </label>
          <textarea
            ref={ref}
            id={`${id}-text`}
            className="space-paper-text"
            rows={first ? 8 : 5}
            placeholder={COPY.start.placeholder}
            // Verbatim: no autocorrect, no spellcheck rewriting, no length limit.
            autoCorrect="off"
            autoCapitalize="sentences"
            spellCheck={false}
            aria-describedby={`${id}-private`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          <div className="space-paper-bar">
            <div className="space-paper-tools">
              <button
                type="button"
                className="space-btn space-btn-tool"
                onClick={() => setVoice('capture')}
              >
                <MicIcon />
                {COPY.start.talk}
              </button>
              {onAddFiles && <FilePicker className="space-btn space-btn-tool" icon={<ClipIcon />} onFiles={onAddFiles} />}
            </div>
            <div className="space-paper-send">
              {onCancel && (
                <button type="button" className="space-btn space-btn-quiet" onClick={onCancel}>
                  {COPY.start.cancel}
                </button>
              )}
              <button type="button" className="space-btn space-btn-primary" disabled={value.trim() === ''} onClick={add}>
                {COPY.start.add}
              </button>
            </div>
          </div>
        </div>
      )}

      {voice === 'capture' && (
        <div className="space-paper space-voice">
          <VoiceCapture
            onTranscript={(r, audio) => {
              if (adapterStatus.voice) {
                // The voice module already let her read and fix the transcript.
                setVoice('off');
                if (r.text.trim()) onAdd(r.text, 'voice');
                if (r.keepAudio && onAddFiles) {
                  const ext = audio.type.includes('ogg') ? 'ogg' : audio.type.includes('mp4') ? 'm4a' : 'webm';
                  void onAddFiles([new File([audio], `voice-note.${ext}`, { type: audio.type || 'audio/webm' })]);
                }
                return;
              }
              setTranscript(r.text);
              setVoice('review');
            }}
            onCancel={() => setVoice('off')}
          />
        </div>
      )}

      {voice === 'review' && (
        <div className="space-paper space-voice-review">
          <h3 className="space-h3">{COPY.voice.reviewTitle}</h3>
          <p className="space-hint">{COPY.voice.reviewLead}</p>
          <label className="space-sublabel" htmlFor={`${id}-voice`}>
            {COPY.voice.reviewLabel}
          </label>
          <textarea
            id={`${id}-voice`}
            className="space-paper-text"
            rows={6}
            autoCorrect="off"
            spellCheck={false}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
          />
          <div className="space-actions">
            <button
              type="button"
              className="space-btn space-btn-primary"
              disabled={transcript.trim() === ''}
              onClick={() => {
                onAdd(transcript, 'voice');
                setTranscript('');
                setVoice('off');
              }}
            >
              {COPY.voice.add}
            </button>
            <button
              type="button"
              className="space-btn space-btn-quiet"
              onClick={() => {
                setTranscript('');
                setVoice('off');
              }}
            >
              {COPY.voice.discard}
            </button>
          </div>
        </div>
      )}

      <p className="space-private" id={`${id}-private`}>
        <LockIcon /> {COPY.start.private}
      </p>
      {fileStatus && (
        <p className="space-hint" role="status">
          {fileStatus}
        </p>
      )}
    </section>
  );
}

export const LockIcon = () => (
  <svg className="space-lock" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
);

/** Her entries, like pages of a journal. Text is shown exactly as stored; only she can change it. */
export function Journal({
  entries,
  interviewWords,
  fileCount,
  onRemove,
  onEdit,
  hasSealed = false,
}: {
  entries: StoryEntry[];
  /** Her free-recall answer from the interview, if she used it. */
  interviewWords?: string;
  fileCount: number;
  onRemove: (id: string) => void;
  /** Save her changed words (verbatim). */
  onEdit?: (id: string, text: string) => void;
  /** She has a sealed version: say gently that it stays as it was. */
  hasSealed?: boolean;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const noteId = useId();
  useEffect(() => {
    if (editing) editRef.current?.focus({ preventScroll: true });
  }, [editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const focusEntryButton = (id: string) =>
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-entry-id="${id}"] .space-entry-edit`)?.focus());
  return (
    <ol className="space-journal">
      {interviewWords && (
        <li className="space-entry">
          <p className="space-entry-meta">{COPY.journal.fromInterview}</p>
          <p className="space-entry-text space-verbatim">{interviewWords}</p>
        </li>
      )}
      {entries.map((e) => (
        <li key={e.id} className={`space-entry${editing?.id === e.id ? ' is-editing' : ''}`} data-entry-id={e.id}>
          <p className="space-entry-meta">
            <span>{e.source === 'voice' ? COPY.journal.voice : COPY.journal.typed}</span>
            <span aria-hidden="true"> · </span>
            <time dateTime={e.createdAt}>{when(e.createdAt)}</time>
            {e.editedAt && (
              <>
                <span aria-hidden="true"> · </span>
                <time className="space-entry-edited" dateTime={e.editedAt}>
                  {COPY.journal.edited(when(e.editedAt))}
                </time>
              </>
            )}
          </p>
          {editing?.id === e.id ? (
            <form
              className="space-entry-editor"
              onSubmit={(ev) => {
                ev.preventDefault();
                if (editing.text.trim() === '') return;
                onEdit?.(e.id, editing.text);
                setEditing(null);
                focusEntryButton(e.id);
              }}
            >
              <label className="space-sublabel" htmlFor={`${noteId}-${e.id}`}>
                {COPY.journal.editLabel}
              </label>
              <textarea
                ref={editRef}
                id={`${noteId}-${e.id}`}
                className="space-paper-text space-entry-textarea"
                rows={Math.min(16, Math.max(4, Math.ceil(editing.text.length / 45) + editing.text.split("\n").length))}
                autoCorrect="off"
                spellCheck={false}
                aria-describedby={`${noteId}-note`}
                value={editing.text}
                onChange={(ev) => setEditing({ id: e.id, text: ev.target.value })}
              />
              <p className="space-hint" id={`${noteId}-note`}>
                {hasSealed ? COPY.journal.editSealedNote : COPY.journal.editNote}
              </p>
              <div className="space-actions">
                <button type="submit" className="space-btn space-btn-primary space-btn-small" disabled={editing.text.trim() === ''}>
                  {COPY.journal.editSave}
                </button>
                <button
                  type="button"
                  className="space-btn space-btn-quiet space-btn-small"
                  onClick={() => {
                    setEditing(null);
                    focusEntryButton(e.id);
                  }}
                >
                  {COPY.journal.editCancel}
                </button>
              </div>
            </form>
          ) : (
            <p className="space-entry-text space-verbatim">{e.text}</p>
          )}
          {editing?.id === e.id ? null : confirm === e.id ? (
            <div className="space-confirm" role="group" aria-label={COPY.journal.remove}>
              <p>{hasSealed ? COPY.journal.removeConfirmSealed : COPY.journal.removeConfirm}</p>
              <div className="space-actions">
                <button type="button" className="space-btn space-btn-secondary" onClick={() => setConfirm(null)}>
                  {COPY.journal.removeNo}
                </button>
                <button
                  type="button"
                  className="space-btn space-btn-quiet"
                  onClick={() => {
                    setConfirm(null);
                    onRemove(e.id);
                  }}
                >
                  {COPY.journal.removeYes}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-entry-actions">
              {onEdit && (
                <button
                  type="button"
                  className="space-btn space-btn-link space-entry-edit"
                  aria-label={`${COPY.journal.edit}: ${when(e.createdAt)}`}
                  onClick={() => {
                    setConfirm(null);
                    setEditing({ id: e.id, text: e.text });
                  }}
                >
                  {COPY.journal.edit}
                </button>
              )}
              <button
                type="button"
                className="space-btn space-btn-link space-entry-remove"
                aria-label={`${COPY.journal.remove}: ${when(e.createdAt)}`}
                onClick={() => setConfirm(e.id)}
              >
                {COPY.journal.remove}
              </button>
            </div>
          )}
        </li>
      ))}
      {fileCount > 0 && (
        <li className="space-entry space-entry-files">
          <ClipIcon /> {COPY.files.count(fileCount)}
        </li>
      )}
    </ol>
  );
}
