import { useState } from 'react';
import { asDate, asList, stepById, type DateAnswer } from '../intake/draft';
import type { StoryEntry, Suggestion } from '../understand/types';
import { COPY } from './copy';
import { groupSuggestions, snippetFor } from './suggestions';

function baseStepId(target: string): string | undefined {
  const parts = target.split('.');
  for (let i = parts.length; i > 0; i--) {
    const head = parts.slice(0, i).join('.').replace(/\[\d+\]$/, '');
    if (stepById(head)) return head;
  }
  return undefined;
}

/** How to let her change a value: plain text, a date in her words, or chips from the question. */
function editorKind(s: Suggestion): 'text' | 'date' | 'multi' | 'choice' {
  const step = stepById(baseStepId(s.target) ?? '');
  const sub = step && s.target.length > step.id.length;
  if (!sub && step?.kind === 'approxDate') return 'date';
  if (!sub && step?.kind === 'multi') return 'multi';
  if (!sub && step?.kind === 'choice') return 'choice';
  return 'text';
}

function initialText(v: unknown): string {
  const d = asDate(v as never);
  if (d) return d.mode === 'text' ? (d.text ?? '') : d.mode === 'date' ? (d.date ?? '') : '';
  if (typeof v === 'string') return v;
  return '';
}

function Editor({ s, onSave, onCancel }: { s: Suggestion; onSave: (v: unknown) => void; onCancel: () => void }) {
  const kind = editorKind(s);
  const step = stepById(baseStepId(s.target) ?? '');
  const options = step && 'options' in step ? step.options : [];
  const [text, setText] = useState(initialText(s.value));
  const [list, setList] = useState<string[]>(kind === 'multi' ? asList(s.value as never) : []);
  const [choice, setChoice] = useState(typeof s.value === 'string' ? s.value : '');
  const fid = `space-edit-${s.id}`;
  const save = () => {
    if (kind === 'date') {
      const iso = /^\d{4}-\d{2}-\d{2}$/.test(text.trim());
      const v: DateAnswer = iso ? { mode: 'date', date: text.trim(), approximate: false } : { mode: 'text', text };
      onSave(v);
    } else if (kind === 'multi') onSave(list);
    else if (kind === 'choice') onSave(choice);
    else onSave(text);
  };
  return (
    <form
      className="space-suggest-edit"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {kind === 'multi' || kind === 'choice' ? (
        <div className="space-chips" role="group" aria-label={COPY.picked.changeLabel}>
          {options.map((o) => {
            const on = kind === 'multi' ? list.includes(o.value) : choice === o.value;
            return (
              <button
                key={o.value}
                type="button"
                className="space-chip"
                aria-pressed={on}
                onClick={() =>
                  kind === 'multi'
                    ? setList(on ? list.filter((x) => x !== o.value) : [...list, o.value])
                    : setChoice(on ? '' : o.value)
                }
              >
                {o.label}
              </button>
            );
          })}
        </div>
      ) : (
        <>
          <label className="space-sublabel" htmlFor={fid}>
            {COPY.picked.changeLabel}
          </label>
          <input id={fid} className="space-input" autoFocus autoCorrect="off" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
        </>
      )}
      <div className="space-actions">
        <button type="submit" className="space-btn space-btn-primary space-btn-small">
          {COPY.picked.save}
        </button>
        <button type="button" className="space-btn space-btn-quiet space-btn-small" onClick={onCancel}>
          {COPY.picked.cancel}
        </button>
      </div>
    </form>
  );
}

function SuggestionCard({
  s,
  entries,
  onKeep,
  onEdit,
  onDismiss,
}: {
  s: Suggestion;
  entries: StoryEntry[];
  onKeep: () => void;
  onEdit: (v: unknown) => void;
  onDismiss: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const snippets = s.sources.map((sp) => snippetFor(entries, sp)).filter((x) => !!x);
  const labelId = `space-sg-${s.id}`;
  return (
    <li className="space-suggest" aria-labelledby={labelId} data-suggestion-id={s.id}>
      <p className="space-suggest-label" id={labelId}>
        {s.label}
      </p>
      {snippets.slice(0, 2).map((sn, i) => (
        <blockquote key={i} className="space-snippet">
          <span className="space-visually-hidden">{COPY.picked.from}: </span>
          {sn.clippedStart && '…'}
          {sn.before}
          <mark>{sn.match}</mark>
          {sn.after}
          {sn.clippedEnd && '…'}
        </blockquote>
      ))}
      {editing ? (
        <Editor
          s={s}
          onCancel={() => setEditing(false)}
          onSave={(v) => {
            setEditing(false);
            onEdit(v);
          }}
        />
      ) : (
        <div className="space-suggest-actions" role="group" aria-label={s.label}>
          <button type="button" className="space-btn space-btn-keep space-btn-small" onClick={onKeep}>
            {COPY.picked.keep}
          </button>
          <button type="button" className="space-btn space-btn-secondary space-btn-small" onClick={() => setEditing(true)}>
            {COPY.picked.change}
          </button>
          <button type="button" className="space-btn space-btn-quiet space-btn-small" onClick={onDismiss}>
            {COPY.picked.notRight}
          </button>
        </div>
      )}
    </li>
  );
}

export function PickedUp({
  suggestions,
  entries,
  keptCount,
  onKeep,
  onEdit,
  onDismiss,
}: {
  suggestions: Suggestion[];
  entries: StoryEntry[];
  keptCount: number;
  onKeep: (s: Suggestion) => void;
  onEdit: (s: Suggestion, v: unknown) => void;
  onDismiss: (s: Suggestion) => void;
}) {
  const [all, setAll] = useState(false);
  const LIMIT = 3;
  const shownList = all ? suggestions : suggestions.slice(0, LIMIT);
  const hidden = suggestions.length - shownList.length;
  const groups = groupSuggestions(shownList);
  if (!suggestions.length) return null;
  return (
    <section className="space-section space-picked" aria-labelledby="space-picked-title">
      <h2 id="space-picked-title" className="space-h2" tabIndex={-1}>
        {COPY.picked.title}
      </h2>
      <p className="space-lead">{COPY.picked.lead}</p>
      {groups.map(({ group, items }) => (
        <div key={group.id} className="space-suggest-group">
          <h3 className="space-eyebrow">{group.title}</h3>
          <ul className="space-suggest-list">
            {items.map((s) => (
              <SuggestionCard
                key={s.id}
                s={s}
                entries={entries}
                onKeep={() => onKeep(s)}
                onEdit={(v) => onEdit(s, v)}
                onDismiss={() => onDismiss(s)}
              />
            ))}
          </ul>
        </div>
      ))}
      {hidden > 0 && (
        <button type="button" className="space-btn space-btn-secondary space-btn-small space-show-more" onClick={() => setAll(true)}>
          {COPY.picked.showMore(hidden)}
        </button>
      )}
      {keptCount > 0 && <p className="space-hint">{COPY.picked.keptCount(keptCount)}</p>}
    </section>
  );
}
