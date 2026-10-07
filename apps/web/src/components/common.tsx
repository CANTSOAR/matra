import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { friendlyError } from '../lib/session';

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ loading: boolean; data?: T; error?: string }>({ loading: true });
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const reload = useCallback(async () => {
    const my = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    try {
      const data = await run();
      if (my === seq.current) setState({ loading: false, data });
    } catch (e) {
      if (my === seq.current) setState({ loading: false, error: friendlyError(e) });
    }
  }, [run]);
  useEffect(() => {
    void reload();
    return () => {
      seq.current++;
    };
  }, [reload]);
  return { ...state, reload };
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="row muted" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" /> {label}
    </p>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p className="error note-error" role="alert">
      {children}
    </p>
  );
}

export function VerifyBadge({ verified }: { verified: boolean | undefined }) {
  if (verified === undefined) return <span className="badge neutral">Not checked</span>;
  return verified ? (
    <span className="badge ok" title="We checked the sealed file’s fingerprint again, and it matches the tamper-evident record. Nothing has changed.">
      Verified ✓
    </span>
  ) : (
    <span className="badge warn" title="The fingerprint we checked doesn’t match the tamper-evident record. Please contact support.">
      Could not verify
    </span>
  );
}

export function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function PageTitle({
  children,
  lead,
  eyebrow,
  testId,
}: {
  children: ReactNode;
  lead?: ReactNode;
  /** small label above the heading, e.g. the section name */
  eyebrow?: ReactNode;
  testId?: string;
}) {
  return (
    <header className="page-title">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1 tabIndex={-1} data-autofocus data-testid={testId}>
        {children}
      </h1>
      {lead && <p className="lead">{lead}</p>}
    </header>
  );
}

export const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS',
  'MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
];
