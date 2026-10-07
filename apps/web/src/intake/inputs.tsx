import { useId, useState, type FormEvent, type ReactNode } from 'react';
import {
  asDate,
  asGroup,
  asList,
  asRecord,
  isBlank,
  newGroupItem,
  type AnswerValue,
  type DateAnswer,
  type GroupItem,
  type IntakeDraft,
} from './draft';
import {
  MATCHABLE_KEYS,
  UI,
  type ApproxDateStep,
  type ChoiceStep,
  type DateStep,
  type EscrowStep,
  type FieldDef,
  type FormStep,
  type GroupStep,
  type LongTextStep,
  type MultiStep,
  type SelectStep,
  type TextStep,
} from './script';

export interface InputProps<S> {
  step: S;
  initial: AnswerValue | undefined;
  /** Live, unsubmitted value — kept in the draft so nothing typed is lost. */
  onPending: (v: AnswerValue) => void;
  /** undefined = nothing entered (treated as skipped). */
  onSubmit: (v: AnswerValue | undefined) => void;
  onSkip: () => void;
}

function Actions({ onSkip, submitLabel = UI.continue, extra }: { onSkip: () => void; submitLabel?: string; extra?: ReactNode }) {
  return (
    <div className="intake-actions">
      <button type="submit" className="intake-btn intake-btn-primary">
        {submitLabel}
      </button>
      {extra}
      <button type="button" className="intake-btn intake-btn-quiet" onClick={onSkip}>
        {UI.skip}
      </button>
    </div>
  );
}

function submitOrSkip(v: AnswerValue | undefined, onSubmit: (v: AnswerValue | undefined) => void) {
  onSubmit(isBlank(v) ? undefined : v);
}

// ───────────── single-line text ─────────────

export function TextInput({ step, initial, onPending, onSubmit, onSkip }: InputProps<TextStep>) {
  const id = useId();
  const [value, setValue] = useState(typeof initial === 'string' ? initial : '');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    submitOrSkip(value, onSubmit);
  };
  return (
    <form className="intake-answer" onSubmit={submit}>
      <label className="intake-label" htmlFor={id}>
        {step.label}
      </label>
      {step.hint && (
        <p className="intake-hint" id={`${id}-hint`}>
          {step.hint}
        </p>
      )}
      <input
        id={id}
        className="intake-input"
        type={step.inputType ?? 'text'}
        autoComplete={step.autoComplete ?? 'off'}
        autoCorrect="off"
        autoCapitalize={step.inputType === 'email' ? 'none' : 'sentences'}
        spellCheck={false}
        aria-describedby={step.hint ? `${id}-hint` : undefined}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onPending(e.target.value);
        }}
      />
      <Actions onSkip={onSkip} />
    </form>
  );
}

// ───────────── long text (narrative) ─────────────

export function LongTextInput({ step, initial, onPending, onSubmit, onSkip }: InputProps<LongTextStep>) {
  const id = useId();
  const [value, setValue] = useState(typeof initial === 'string' ? initial : '');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    submitOrSkip(value, onSubmit);
  };
  return (
    <form className="intake-answer" onSubmit={submit}>
      <label className="intake-label" htmlFor={id}>
        {step.label}
      </label>
      {step.hint && (
        <p className="intake-hint" id={`${id}-hint`}>
          {step.hint}
        </p>
      )}
      <textarea
        id={id}
        className={`intake-textarea${step.large ? ' intake-textarea-large' : ''}`}
        rows={step.large ? 14 : 5}
        // Verbatim: no autocorrect, no spellcheck rewriting, no length limit.
        autoCorrect="off"
        autoCapitalize="sentences"
        spellCheck={false}
        aria-describedby={step.hint ? `${id}-hint` : undefined}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onPending(e.target.value);
        }}
      />
      <Actions onSkip={onSkip} submitLabel={UI.saveContinue} />
    </form>
  );
}

// ───────────── exact date ─────────────

export function DateInput({ step, initial, onPending, onSubmit, onSkip }: InputProps<DateStep>) {
  const id = useId();
  const [value, setValue] = useState(typeof initial === 'string' ? initial : '');
  return (
    <form
      className="intake-answer"
      onSubmit={(e) => {
        e.preventDefault();
        submitOrSkip(value, onSubmit);
      }}
    >
      <label className="intake-label" htmlFor={id}>
        {step.label}
      </label>
      {step.hint && (
        <p className="intake-hint" id={`${id}-hint`}>
          {step.hint}
        </p>
      )}
      <input
        id={id}
        type="date"
        className="intake-input intake-input-date"
        aria-describedby={step.hint ? `${id}-hint` : undefined}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onPending(e.target.value);
        }}
      />
      <Actions onSkip={onSkip} />
    </form>
  );
}

// ───────────── approximate date ─────────────

export function ApproxDateInput({ step, initial, onPending, onSubmit, onSkip }: InputProps<ApproxDateStep>) {
  const id = useId();
  const init = asDate(initial);
  const [ans, setAns] = useState<DateAnswer>(init ?? { mode: 'date' });
  const update = (next: DateAnswer) => {
    setAns(next);
    onPending(next);
  };
  const modes: Array<[DateAnswer['mode'], string]> = [
    ['date', UI.date.knowDate],
    ['text', UI.date.describe],
  ];
  return (
    <form
      className="intake-answer"
      onSubmit={(e) => {
        e.preventDefault();
        submitOrSkip(ans, onSubmit);
      }}
    >
      <fieldset className="intake-fieldset">
        <legend className="intake-label">{step.label}</legend>
        <div className="intake-segmented" role="group" aria-label={step.label}>
          {modes.map(([m, label]) => (
            <button
              key={m}
              type="button"
              className="intake-chip"
              aria-pressed={ans.mode === m}
              onClick={() => update({ ...ans, mode: m })}
            >
              {label}
            </button>
          ))}
        </div>
        {ans.mode === 'date' && (
          <div className="intake-field">
            <label className="intake-sublabel" htmlFor={`${id}-date`}>
              {UI.date.dateLabel}
            </label>
            <input
              id={`${id}-date`}
              type="date"
              className="intake-input intake-input-date"
              value={ans.date ?? ''}
              onChange={(e) => update({ ...ans, date: e.target.value })}
            />
            <label className="intake-check">
              <input
                type="checkbox"
                checked={!!ans.approximate}
                onChange={(e) => update({ ...ans, approximate: e.target.checked })}
              />
              <span>{UI.date.approximate}</span>
            </label>
          </div>
        )}
        {ans.mode === 'text' && (
          <div className="intake-field">
            <label className="intake-sublabel" htmlFor={`${id}-text`}>
              {UI.date.describeLabel}
            </label>
            <p className="intake-hint" id={`${id}-texthint`}>
              {UI.date.describeHint}
            </p>
            <input
              id={`${id}-text`}
              className="intake-input"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby={`${id}-texthint`}
              value={ans.text ?? ''}
              onChange={(e) => update({ ...ans, text: e.target.value })}
            />
          </div>
        )}
      </fieldset>
      <Actions
        onSkip={onSkip}
        extra={
          <button type="button" className="intake-btn intake-btn-secondary" onClick={() => onSubmit({ mode: 'unsure' })}>
            {UI.date.notSure}
          </button>
        }
      />
    </form>
  );
}

// ───────────── single choice (yes / no / not sure) ─────────────

export function ChoiceInput({ step, initial, onSubmit, onSkip }: InputProps<ChoiceStep>) {
  const labelId = useId();
  return (
    <div className="intake-answer">
      <p className="intake-label intake-visually-hidden" id={labelId}>
        {step.label}
      </p>
      <div className="intake-choices" role="group" aria-labelledby={labelId}>
        {step.options.map((o) => (
          <button
            key={o.value}
            type="button"
            className="intake-btn intake-btn-choice"
            aria-pressed={initial === o.value}
            onClick={() => onSubmit(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="intake-actions">
        <button type="button" className="intake-btn intake-btn-quiet" onClick={onSkip}>
          {UI.skip}
        </button>
      </div>
    </div>
  );
}

// ───────────── multi-select chips ─────────────

export function MultiInput({ step, initial, onPending, onSubmit, onSkip }: InputProps<MultiStep>) {
  const labelId = useId();
  const [selected, setSelected] = useState<string[]>(asList(initial));
  const toggle = (v: string) => {
    const next = selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v];
    setSelected(next);
    onPending(next);
  };
  return (
    <form
      className="intake-answer"
      onSubmit={(e) => {
        e.preventDefault();
        submitOrSkip(selected, onSubmit);
      }}
    >
      <p className="intake-label" id={labelId}>
        {step.label}
      </p>
      {step.hint && <p className="intake-hint">{step.hint}</p>}
      <div className="intake-chips" role="group" aria-labelledby={labelId}>
        {step.options.map((o) => (
          <button
            key={o.value}
            type="button"
            className="intake-chip"
            aria-pressed={selected.includes(o.value)}
            onClick={() => toggle(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      <Actions onSkip={onSkip} />
    </form>
  );
}

// ───────────── dropdown ─────────────

export function SelectInput({ step, initial, onPending, onSubmit, onSkip }: InputProps<SelectStep>) {
  const id = useId();
  const [value, setValue] = useState(typeof initial === 'string' ? initial : '');
  return (
    <form
      className="intake-answer"
      onSubmit={(e) => {
        e.preventDefault();
        submitOrSkip(value, onSubmit);
      }}
    >
      <label className="intake-label" htmlFor={id}>
        {step.label}
      </label>
      <select
        id={id}
        className="intake-input"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onPending(e.target.value);
        }}
      >
        <option value="">{step.placeholder}</option>
        {step.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Actions onSkip={onSkip} />
    </form>
  );
}

// ───────────── generic field (used by form + group) ─────────────

export function Field({ def, value, onChange, idPrefix }: { def: FieldDef; value: string; onChange: (v: string) => void; idPrefix: string }) {
  const id = `${idPrefix}-${def.key}`;
  const hintId = def.hint ? `${id}-hint` : undefined;
  if (def.type === 'choice') {
    return (
      <fieldset className="intake-field intake-fieldset">
        <legend className="intake-sublabel">{def.label}</legend>
        <div className="intake-chips">
          {(def.options ?? []).map((o) => (
            <button
              key={o.value}
              type="button"
              className="intake-chip"
              aria-pressed={value === o.value}
              onClick={() => onChange(value === o.value ? '' : o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </fieldset>
    );
  }
  return (
    <div className="intake-field">
      <label className="intake-sublabel" htmlFor={id}>
        {def.label}
      </label>
      {def.hint && (
        <p className="intake-hint" id={hintId}>
          {def.hint}
        </p>
      )}
      {def.type === 'longtext' ? (
        <textarea
          id={id}
          className="intake-textarea"
          rows={3}
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={hintId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : def.type === 'select' ? (
        <select id={id} className="intake-input" aria-describedby={hintId} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {(def.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          className="intake-input"
          type={def.type}
          autoComplete={def.autoComplete ?? 'off'}
          autoCorrect="off"
          autoCapitalize={def.type === 'email' ? 'none' : 'sentences'}
          spellCheck={false}
          aria-describedby={hintId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

// ───────────── small form (several optional fields) ─────────────

export function FormInput({ step, initial, onPending, onSubmit, onSkip }: InputProps<FormStep>) {
  const id = useId();
  const [values, setValues] = useState<Record<string, string>>(asRecord(initial));
  return (
    <form
      className="intake-answer"
      onSubmit={(e) => {
        e.preventDefault();
        submitOrSkip(values, onSubmit);
      }}
    >
      <fieldset className="intake-fieldset">
        <legend className="intake-label">{step.label}</legend>
        {step.fields.map((f) => (
          <Field
            key={f.key}
            def={f}
            idPrefix={id}
            value={values[f.key] ?? ''}
            onChange={(v) => {
              const next = { ...values, [f.key]: v };
              setValues(next);
              onPending(next);
            }}
          />
        ))}
      </fieldset>
      <Actions onSkip={onSkip} submitLabel={UI.saveContinue} />
    </form>
  );
}

// ───────────── repeatable group (people, reports) ─────────────

export function GroupInput({ step, initial, onPending, onSubmit, onSkip }: InputProps<GroupStep>) {
  const id = useId();
  const [items, setItems] = useState<GroupItem[]>(() => {
    const g = asGroup(initial);
    return g.length ? g : [newGroupItem()];
  });
  const update = (next: GroupItem[]) => {
    setItems(next);
    onPending(next);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const filled = items.filter((it) => !isBlank(it.values));
    onSubmit(filled.length ? filled : undefined);
  };
  return (
    <form className="intake-answer" onSubmit={submit} aria-label={step.label}>
      {items.map((item, i) => (
        <fieldset key={item.id} className="intake-fieldset intake-card">
          <legend className="intake-label">
            {step.itemLabel} {i + 1}
          </legend>
          {step.fields.map((f) => (
            <Field
              key={f.key}
              def={f}
              idPrefix={`${id}-${i}`}
              value={item.values[f.key] ?? ''}
              onChange={(v) => update(items.map((x) => (x.id === item.id ? { ...x, values: { ...x.values, [f.key]: v } } : x)))}
            />
          ))}
          {items.length > 1 && (
            <button
              type="button"
              className="intake-btn intake-btn-quiet"
              onClick={() => update(items.filter((x) => x.id !== item.id))}
            >
              {UI.remove} {step.itemLabel.toLowerCase()} {i + 1}
            </button>
          )}
        </fieldset>
      ))}
      <button type="button" className="intake-btn intake-btn-secondary" onClick={() => update([...items, newGroupItem()])}>
        + {step.addLabel}
      </button>
      <Actions onSkip={onSkip} submitLabel={UI.saveContinue} />
    </form>
  );
}

// ───────────── sealed escrow opt-in, per person ─────────────

/** A person can be matched only by a unique identifier — never by name alone. */
export function isMatchable(p: GroupItem): boolean {
  return MATCHABLE_KEYS.some((k) => (p.values[k] ?? '').trim() !== '');
}

export function EscrowInput({ step, initial, onPending, onSubmit, onSkip, draft }: InputProps<EscrowStep> & { draft: IntakeDraft }) {
  const people = asGroup(draft.answers['person.list']);
  const [choices, setChoices] = useState<Record<string, string>>(asRecord(initial));
  const set = (pid: string, v: string) => {
    const next = { ...choices, [pid]: v };
    setChoices(next);
    onPending(next);
  };
  const opts: Array<[string, string]> = [
    ['yes', UI.escrow.yes],
    ['no', UI.escrow.no],
    ['unsure', UI.escrow.unsure],
  ];
  return (
    <form
      className="intake-answer"
      onSubmit={(e) => {
        e.preventDefault();
        submitOrSkip(choices, onSubmit);
      }}
      aria-label={step.label}
    >
      {people.map((p, i) => {
        const name = p.values.name?.trim() || `Person ${i + 1}`;
        if (!isMatchable(p)) {
          return (
            <div key={p.id} className="intake-fieldset intake-card">
              <p className="intake-label">{name}</p>
              <p className="intake-hint">{UI.escrow.notMatchable}</p>
            </div>
          );
        }
        return (
          <fieldset key={p.id} className="intake-fieldset intake-card">
            <legend className="intake-label">{name}</legend>
            <div className="intake-chips">
              {opts.map(([v, label]) => (
                <button key={v} type="button" className="intake-chip" aria-pressed={choices[p.id] === v} onClick={() => set(p.id, v)}>
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
        );
      })}
      <Actions onSkip={onSkip} />
    </form>
  );
}
