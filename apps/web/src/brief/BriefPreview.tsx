import { useMemo } from 'react';
import type { IntakeRecord } from '@matra/shared';
import type { BriefBlock, BriefOptions, BriefSection } from './types';
import { briefSections } from './sections';
import { NOT_PROVIDED } from './format';
import './brief.css';

export interface BriefPreviewProps {
  record: IntakeRecord;
  opts?: BriefOptions;
  /** Override the content (e.g. to preview the VCCO worksheet). */
  sections?: BriefSection[];
  title?: string;
}

/** On-screen version of the Police Evidentiary Brief. Same content as the PDF; text is shown exactly as entered. */
export function BriefPreview({ record, opts, sections, title }: BriefPreviewProps) {
  const secs = useMemo(() => sections ?? briefSections(record, opts ?? {}), [record, opts, sections]);
  let n = 0;
  return (
    <article className="brief-doc" aria-label={title ?? 'Victim Statement and Evidentiary Summary'}>
      <header className="brief-header">
        <div className="brief-kicker">{sections ? 'Prepared with Matra' : 'Prepared with Matra · At the direction of the survivor'}</div>
        <div className="brief-tag">{sections ? 'Draft' : 'Confidential'}</div>
        <h1 className="brief-title">{title ?? 'Victim Statement & Evidentiary Summary'}</h1>
        {!sections && <p className="brief-subtitle">Not a sworn statement unless signed by the survivor.</p>}
      </header>
      {secs.map((sec, i) => {
        const numbered = !sections && i > 0;
        if (numbered) n++;
        return (
          <section key={sec.id} className={`brief-section brief-section--${sec.id}`} aria-labelledby={`brief-h-${sec.id}`}>
            <h2 id={`brief-h-${sec.id}`} className="brief-section-title">
              {numbered && <span className="brief-section-num">{n}.</span>}
              {sec.title}
            </h2>
            {sec.blocks.map((b, j) => <Block key={j} block={b} />)}
          </section>
        );
      })}
    </article>
  );
}

function Block({ block: b }: { block: BriefBlock }) {
  switch (b.kind) {
    case 'rows':
      return (
        <dl className="brief-rows">
          {b.rows.map((r, i) => (
            <div key={i} className={`brief-row${r.needed ? ' brief-row--needed' : ''}`}>
              <dt className="brief-label">{r.label}</dt>
              <dd
                className={[
                  'brief-value',
                  r.value === NOT_PROVIDED ? 'brief-value--empty' : '',
                  r.verbatim ? 'brief-value--verbatim' : '',
                  r.mono ? 'brief-value--mono' : '',
                ].filter(Boolean).join(' ')}
              >
                {r.value}
              </dd>
            </div>
          ))}
        </dl>
      );
    case 'verbatim':
      return (
        <figure className="brief-verbatim">
          {b.label && <figcaption className="brief-verbatim-label">{b.label}</figcaption>}
          <blockquote className="brief-verbatim-text">{b.text}</blockquote>
        </figure>
      );
    case 'paragraph':
      return <p className="brief-paragraph">{b.text}</p>;
    case 'note':
      return <p className={`brief-note brief-note--${b.tone ?? 'info'}`}>{b.text}</p>;
    case 'subheading':
      return <h3 className="brief-subheading">{b.text}</h3>;
    case 'table':
      return (
        <div className="brief-table-wrap">
          <table className="brief-table">
            <thead>
              <tr>{b.columns.map((c, i) => <th key={i} scope="col">{c.header}</th>)}</tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => [
                <tr key={`r${i}`} className={r.detail ? 'brief-table-row--has-detail' : undefined}>
                  {r.cells.map((c, j) => <td key={j} className={c === NOT_PROVIDED ? 'brief-value--empty' : undefined}>{c}</td>)}
                </tr>,
                r.detail ? (
                  <tr key={`d${i}`} className="brief-table-detail">
                    <td colSpan={b.columns.length}>
                      <span className="brief-label">{r.detail.label}</span>{' '}
                      <code className={r.detail.mono ? 'brief-value--mono' : undefined}>{r.detail.value}</code>
                    </td>
                  </tr>
                ) : null,
              ])}
            </tbody>
          </table>
        </div>
      );
    case 'signature':
      return (
        <div className="brief-signatures">
          {b.lines.map((l, i) => (
            <div key={i} className={`brief-signature${l.wide ? ' brief-signature--wide' : ''}`}>
              <div className="brief-signature-line" />
              <div className="brief-signature-label">{l.label}</div>
            </div>
          ))}
        </div>
      );
    case 'checklist':
      return (
        <ul className="brief-checklist">
          {b.items.map((it, i) => (
            <li key={i} className={`brief-check brief-check--${it.status}`}>
              <span className="brief-check-tag">{{ ok: 'Met', needed: 'Needed', warning: 'Check', info: 'Note' }[it.status]}</span>
              <span>{it.text}</span>
            </li>
          ))}
        </ul>
      );
  }
}
