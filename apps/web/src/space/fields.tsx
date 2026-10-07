/**
 * Controlled editors for one interview question, used inside a topic page (several questions share
 * one Save). Values have exactly the shapes the interview uses (src/intake/draft.ts AnswerValue).
 */
import { useId, useState } from 'react';
import { Field, isMatchable, matchIssues } from '../intake/inputs';
import {
  asDate,
  asGroup,
  asList,
  asRecord,
  newGroupItem,
  type AnswerValue,
  type DateAnswer,
  type GroupItem,
  type IntakeDraft,
} from '../intake/draft';
import { SPACE_PROMPTS, UI, type FieldDef, type ScriptStep } from '../intake/script';
import { COPY } from './copy';
import { FilePicker } from './FilePicker';

export interface StepFieldProps {
  step: ScriptStep;
  value: AnswerValue | undefined;
  onChange: (v: AnswerValue) => void;
  /** Draft including unsaved answers on this page (for the sealed-match list of people). */
  draft: IntakeDraft;
  onAddFiles?: (files: File[]) => Promise<number>;
}

export function promptOf(step: ScriptStep): { q: string; hint?: string } {
  const p = SPACE_PROMPTS[step.id];
  if (p) return p;
  const label = 'label' in step ? step.label : step.say[step.say.length - 1];
  return { q: step.say[step.say.length - 1] ?? label };
}

function Chips({
  options,
  selected,
  onToggle,
  labelledBy,
}: {
  options: ReadonlyArray<{ value: string; label: string }>;
  selected: (v: string) => boolean;
  onToggle: (v: string) => void;
  labelledBy: string;
}) {
  return (
    <div className="space-chips" role="group" aria-labelledby={labelledBy}>
      {options.map((o) => (
        <button key={o.value} type="button" className="space-chip" aria-pressed={selected(o.value)} onClick={() => onToggle(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function StepField({ step, value, onChange, draft, onAddFiles }: StepFieldProps) {
  const id = useId();
  const { q, hint } = promptOf(step);
  const qId = `${id}-q`;
  const hintId = hint ? `${id}-hint` : undefined;
  const head = (asLabel: boolean) => (
    <>
      {asLabel ? (
        <label className="space-q" id={qId} htmlFor={`${id}-in`}>
          {q}
        </label>
      ) : (
        <p className="space-q" id={qId}>
          {q}
        </p>
      )}
      {hint && (
        <p className="space-hint" id={hintId}>
          {hint}
        </p>
      )}
    </>
  );
  const str = typeof value === 'string' ? value : '';

  switch (step.kind) {
    case 'text':
    case 'date':
      return (
        <div className="space-field" data-step={step.id}>
          {head(true)}
          <input
            id={`${id}-in`}
            className="space-input"
            type={step.kind === 'date' ? 'date' : (step.inputType ?? 'text')}
            autoComplete={step.kind === 'text' ? (step.autoComplete ?? 'off') : 'off'}
            autoCorrect="off"
            spellCheck={false}
            aria-describedby={hintId}
            value={str}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
    case 'longtext':
      return (
        <div className="space-field" data-step={step.id}>
          {head(true)}
          <textarea
            id={`${id}-in`}
            className="space-textarea"
            rows={4}
            autoCorrect="off"
            spellCheck={false}
            aria-describedby={hintId}
            value={str}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
    case 'select':
      return (
        <div className="space-field" data-step={step.id}>
          {head(true)}
          <select id={`${id}-in`} className="space-input" aria-describedby={hintId} value={str} onChange={(e) => onChange(e.target.value)}>
            <option value="">{step.placeholder}</option>
            {step.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      );
    case 'choice':
      return (
        <div className="space-field" data-step={step.id}>
          {head(false)}
          <Chips
            options={step.options}
            labelledBy={qId}
            selected={(v) => str === v}
            onToggle={(v) => onChange(str === v ? '' : v)}
          />
        </div>
      );
    case 'multi': {
      const list = asList(value);
      return (
        <div className="space-field" data-step={step.id}>
          {head(false)}
          <Chips
            options={step.options}
            labelledBy={qId}
            selected={(v) => list.includes(v)}
            onToggle={(v) => onChange(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])}
          />
        </div>
      );
    }
    case 'approxDate':
      return <ApproxDate stepId={step.id} q={q} hint={hint} value={asDate(value)} onChange={onChange} />;
    case 'form': {
      const r = asRecord(value);
      return (
        <fieldset className="space-field space-fieldset" data-step={step.id}>
          <legend className="space-q">{q}</legend>
          {hint && <p className="space-hint">{hint}</p>}
          {step.fields.map((f) => (
            <Field key={f.key} def={f} idPrefix={id} value={r[f.key] ?? ''} onChange={(v) => onChange({ ...r, [f.key]: v })} />
          ))}
        </fieldset>
      );
    }
    case 'group': {
      const items: GroupItem[] = asGroup(value);
      const shown: GroupItem[] = items.length ? items : [newGroupItemStable(id)];
      const update = (next: typeof items) => onChange(next);
      return (
        <div className="space-field" data-step={step.id} role="group" aria-labelledby={qId}>
          {head(false)}
          {shown.map((item, i) => (
            <fieldset key={item.id} className="space-fieldset space-card-inset">
              <legend className="space-sublegend">
                {step.itemLabel} {i + 1}
              </legend>
              <GroupItemFields
                fields={step.fields}
                values={item.values}
                idPrefix={`${id}-${i}`}
                onField={(key, v) => {
                  const base = items.length ? items : shown;
                  update(base.map((x) => (x.id === item.id ? { ...x, values: { ...x.values, [key]: v } } : x)));
                }}
              />
              {shown.length > 1 && (
                <button type="button" className="space-btn space-btn-quiet" onClick={() => update(shown.filter((x) => x.id !== item.id))}>
                  {UI.remove} {step.itemLabel.toLowerCase()} {i + 1}
                </button>
              )}
            </fieldset>
          ))}
          <button type="button" className="space-btn space-btn-secondary" onClick={() => update([...shown, newGroupItem()])}>
            + {step.addLabel}
          </button>
        </div>
      );
    }
    case 'escrow': {
      const people = asGroup(draft.answers['person.list']);
      const choices = asRecord(value);
      const opts: Array<[string, string]> = [
        ['yes', UI.escrow.yes],
        ['no', UI.escrow.no],
        ['unsure', UI.escrow.unsure],
      ];
      return (
        <div className="space-field" data-step={step.id}>
          {head(false)}
          <details className="space-details" open>
            <summary>{COPY.panel.escrowMore}</summary>
            {step.say.slice(1).map((l) => (
              <p key={l}>{l}</p>
            ))}
          </details>
          {people.length === 0 && <p className="space-hint">{COPY.panel.noPeople}</p>}
          {people.map((p, i) => {
            const name = p.values.name?.trim() || `Person ${i + 1}`;
            const lid = `${id}-p${i}`;
            if (!isMatchable(p)) {
              const issues = matchIssues(p);
              return (
                <div key={p.id} className="space-escrow-row">
                  <p className="space-sublegend">{name}</p>
                  {issues.length ? (
                    issues.map((m) => (
                      <p key={m} className="space-hint" data-testid="match-issue">
                        {m}
                      </p>
                    ))
                  ) : (
                    <p className="space-hint">{UI.escrow.notMatchable}</p>
                  )}
                </div>
              );
            }
            return (
              <div key={p.id} className="space-escrow-row">
                <p className="space-sublegend" id={lid}>
                  {name}
                </p>
                <Chips
                  options={opts.map(([v, label]) => ({ value: v, label }))}
                  labelledBy={lid}
                  selected={(v) => choices[p.id] === v}
                  onToggle={(v) => onChange({ ...choices, [p.id]: choices[p.id] === v ? '' : v })}
                />
              </div>
            );
          })}
        </div>
      );
    }
    case 'evidence':
      return <EvidenceField stepId={step.id} q={q} hint={hint} value={value} onChange={onChange} onAddFiles={onAddFiles} />;
    default:
      return null;
  }
}

/** Fields that help recognize someone online (and can be used for a sealed match). */
const ONLINE_KEYS = ['email', 'phone', 'handle', 'platform', 'otherId'];
const MATCHABLE_KEYS = ['email', 'phone', 'handle'];

function wideScreen(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 720px)').matches;
}

type GroupFieldDef = FieldDef;

/**
 * One person / item in a group: the first few fields, then "More details, only if you know them"
 * behind a disclosure (collapsed on phones unless something is filled in). Online identifiers sit
 * together under their own small heading; what a sealed match is shows only once she fills one in.
 */
function GroupItemFields({
  fields,
  values,
  idPrefix,
  onField,
}: {
  fields: GroupFieldDef[];
  values: Record<string, string>;
  idPrefix: string;
  onField: (key: string, v: string) => void;
}) {
  const many = fields.length > 5;
  const first = many ? fields.slice(0, 3) : fields;
  const rest = many ? fields.slice(3) : [];
  const filled = (k: string) => (values[k] ?? '').trim() !== '';
  const [open, setOpen] = useState(() => wideScreen() || rest.some((f) => filled(f.key)));
  const field = (f: GroupFieldDef) => (
    <Field key={f.key} def={f} idPrefix={idPrefix} value={values[f.key] ?? ''} onChange={(v) => onField(f.key, v)} />
  );
  const online = rest.filter((f) => ONLINE_KEYS.includes(f.key));
  // Keep the script's order: plain fields before the first online one, the online group, then the rest.
  const cut = online.length ? rest.indexOf(online[0]) : rest.length;
  const before = rest.filter((f, i) => i < cut && !ONLINE_KEYS.includes(f.key));
  const after = rest.filter((f, i) => i >= cut && !ONLINE_KEYS.includes(f.key));
  const panelId = `${idPrefix}-more`;
  const headId = `${idPrefix}-online`;
  return (
    <>
      {first.map(field)}
      {rest.length > 0 && (
        <div className={`space-more${open ? ' is-open' : ''}`}>
          <button type="button" className="space-more-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
            <svg className="space-more-chevron" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M5.5 3.5l5 4.5-5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {COPY.panel.moreDetails}
          </button>
          <div id={panelId} className="space-more-body" hidden={!open}>
            {before.map(field)}
            {online.length > 0 && (
              <div className="space-online" role="group" aria-labelledby={headId}>
                <p className="space-online-title" id={headId}>
                  {COPY.panel.online}
                </p>
                {online.map(field)}
                {MATCHABLE_KEYS.some(filled) && (
                  <p className="space-hint space-online-why" role="note">
                    {COPY.panel.onlineWhy}
                  </p>
                )}
              </div>
            )}
            {after.map(field)}
          </div>
        </div>
      )}
    </>
  );
}

// A stable placeholder item so typing in an empty group doesn't remount the fields.
const placeholderIds = new Map<string, ReturnType<typeof newGroupItem>>();
function newGroupItemStable(key: string) {
  let it = placeholderIds.get(key);
  if (!it) {
    it = newGroupItem();
    placeholderIds.set(key, it);
  }
  return { ...it, values: {} as Record<string, string> };
}

function ApproxDate({
  stepId,
  q,
  hint,
  value,
  onChange,
}: {
  stepId: string;
  q: string;
  hint?: string;
  value: DateAnswer | undefined;
  onChange: (v: AnswerValue) => void;
}) {
  const id = useId();
  const ans: DateAnswer = value ?? { mode: 'date' };
  const modes: Array<[DateAnswer['mode'], string]> = [
    ['date', COPY.panel.pickDate],
    ['text', COPY.panel.describe],
    ['unsure', COPY.panel.notSure],
  ];
  return (
    <fieldset className="space-field space-fieldset" data-step={stepId}>
      <legend className="space-q">{q}</legend>
      {hint && <p className="space-hint">{hint}</p>}
      <div className="space-chips">
        {modes.map(([m, label]) => (
          <button key={m} type="button" className="space-chip" aria-pressed={ans.mode === m} onClick={() => onChange({ ...ans, mode: m })}>
            {label}
          </button>
        ))}
      </div>
      {ans.mode === 'date' && (
        <div className="space-subfield">
          <label className="space-sublabel" htmlFor={`${id}-d`}>
            {UI.date.dateLabel}
          </label>
          <input
            id={`${id}-d`}
            type="date"
            className="space-input space-input-date"
            value={ans.date ?? ''}
            onChange={(e) => onChange({ ...ans, date: e.target.value })}
          />
          <label className="space-check">
            <input type="checkbox" checked={!!ans.approximate} onChange={(e) => onChange({ ...ans, approximate: e.target.checked })} />
            <span>{UI.date.approximate}</span>
          </label>
        </div>
      )}
      {ans.mode === 'text' && (
        <div className="space-subfield">
          <label className="space-sublabel" htmlFor={`${id}-t`}>
            {UI.date.describeLabel}
          </label>
          <p className="space-hint">{UI.date.describeHint}</p>
          <input
            id={`${id}-t`}
            className="space-input"
            autoCorrect="off"
            spellCheck={false}
            value={ans.text ?? ''}
            onChange={(e) => onChange({ ...ans, text: e.target.value })}
          />
        </div>
      )}
      {ans.mode === 'unsure' && <p className="space-hint">{UI.date.notSureSaved}</p>}
    </fieldset>
  );
}

function EvidenceField({
  stepId,
  q,
  hint,
  value,
  onChange,
  onAddFiles,
}: {
  stepId: string;
  q: string;
  hint?: string;
  value: AnswerValue | undefined;
  onChange: (v: AnswerValue) => void;
  onAddFiles?: (files: File[]) => Promise<number>;
}) {
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(0);
  if (!onAddFiles) return null;
  return (
    <div className="space-field" data-step={stepId}>
      <p className="space-q">{q}</p>
      {hint && <p className="space-hint">{hint}</p>}
      <FilePicker
        onFiles={async (files) => {
          setBusy(true);
          try {
            const n = await onAddFiles(files);
            setAdded((a) => a + n);
            if (n > 0) onChange('requested');
          } finally {
            setBusy(false);
          }
        }}
      />
      <p className="space-hint" role="status">
        {busy ? COPY.files.working : added > 0 ? COPY.panel.filesAdded(added) : value === 'requested' ? UI.evidence.requested : ''}
      </p>
    </div>
  );
}
