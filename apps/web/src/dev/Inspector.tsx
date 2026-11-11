/**
 * Server view: "what the server sees" (development and demo builds only; docs/design/WEEKEND_MVP.md §4.3,
 * docs/demo/TECH_RUNTHROUGH.md). Open http://localhost:5173/inspector next to the app.
 *
 * One column per process: her device (what was typed, from mirror.ts over a same-browser BroadcastChannel), the app
 * server, each OPRF key holder, and the matcher, each from GET /api/dev/inspector every 2 seconds, newest first.
 * Ciphertext, hashes and keys are shown muted in monospace; anything a person could read is highlighted, so it is easy
 * to see that the only readable things about a survivor on any server are her alias, times and (at the matcher only)
 * two states. "Look for something she typed" searches the FULL values of every column in the app server's database.
 *
 * The server mounts the endpoint only with MATRA_INSPECTOR=1, never in production unless MATRA_DEMO_MODE=1; without
 * it this page says the Server view is off.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { InspectorProcess, InspectorRequest, InspectorSnapshot, InspectorTable, InspectorValue } from '@matra/shared';
import { INSPECTOR_CHANNEL, type DeviceEvent } from './mirror';
import './inspector.css';

const POLL_MS = 2000;
const ROWS_SHOWN = 4;

type Status = { kind: 'loading' } | { kind: 'off'; why: string } | { kind: 'on'; snap: InspectorSnapshot };

async function fetchSnapshot(find?: string): Promise<InspectorSnapshot | { off: string }> {
  const res = await fetch(`/api/dev/inspector${find ? `?find=${encodeURIComponent(find)}` : ''}`, { cache: 'no-store' });
  if (res.status === 404) return { off: 'The server does not offer it (start the stack with npm run demo, or set MATRA_INSPECTOR=1 in development).' };
  if (!res.ok) return { off: `The server answered ${res.status}.` };
  return (await res.json()) as InspectorSnapshot;
}

/** Ciphertext, hashes, ids and keys: shown muted. Everything else a person could read: highlighted. */
function isOpaque(s: string): boolean {
  return (
    s.startsWith('bytes ') ||
    s.startsWith('{"v":1,"alg"') ||
    s.startsWith('{"v":1,"epk"') ||
    s.startsWith('{"kty"') ||
    /^[0-9a-f]{16,}(…|$)/i.test(s) ||
    /^[A-Za-z0-9+/_-]{16,}={0,2}(…|$)/.test(s)
  );
}
const isPlain = (s: string) => /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(s) || /^-?\d+(\.\d+)?$/.test(s) || s.length <= 1;

function Value({ v }: { v: InspectorValue }) {
  if (v === null) return <span className="insp-null">null</span>;
  if (typeof v === 'number' || typeof v === 'boolean') return <span className="insp-plain">{String(v)}</span>;
  if (typeof v === 'string') {
    if (v.startsWith('[redacted: ')) return <span className="insp-redacted">{v}</span>;
    if (isOpaque(v)) return <code className="insp-opaque">{v}</code>;
    if (isPlain(v)) return <span className="insp-plain">{v}</span>;
    return <mark className="insp-readable">{v}</mark>;
  }
  if (Array.isArray(v))
    return (
      <span className="insp-list">
        [
        {v.map((x, i) => (
          <span key={i}>
            {i > 0 && ', '}
            <Value v={x} />
          </span>
        ))}
        ]
      </span>
    );
  return <Fields obj={v} />;
}

function Fields({ obj }: { obj: Record<string, InspectorValue> }) {
  return (
    <dl className="insp-fields">
      {Object.entries(obj).map(([k, x]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>
            <Value v={x} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Table({ t }: { t: InspectorTable }) {
  const [all, setAll] = useState(false);
  const rows = all ? t.rows : t.rows.slice(0, ROWS_SHOWN);
  return (
    <section className="insp-table" data-table={t.name}>
      <h4>
        {t.name} <span className="insp-count">{t.total}</span>
      </h4>
      <p className="insp-caption">{t.caption}</p>
      {rows.map((r, i) => (
        <div key={i} className="insp-row">
          <Fields obj={r} />
        </div>
      ))}
      {t.rows.length > ROWS_SHOWN && (
        <button type="button" className="insp-more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${t.rows.length} latest rows`}
        </button>
      )}
    </section>
  );
}

function Requests({ list }: { list: InspectorRequest[] }) {
  if (!list.length) return null;
  return (
    <section className="insp-table" data-table="requests">
      <h4>
        requests received <span className="insp-count">{list.length}</span>
      </h4>
      <p className="insp-caption">
        The last requests, newest first: the route pattern and the body as it arrived (cut to 48 characters). No headers, no
        IP address. Kept in memory only while the Server view is on.
      </p>
      {list.slice(0, 12).map((r, i) => (
        <div key={i} className="insp-row" data-testid="insp-request">
          <div className="insp-req">
            <code>
              {r.method} {r.route}
            </code>{' '}
            <span className={r.status < 400 ? 'insp-ok' : 'insp-bad'}>{r.status}</span> <span className="insp-time">{r.at.slice(11, 19)}</span>
          </div>
          {r.body !== undefined && (typeof r.body === 'object' && r.body && !Array.isArray(r.body) ? <Fields obj={r.body} /> : <Value v={r.body} />)}
        </div>
      ))}
    </section>
  );
}

function ProcessColumn({ p }: { p: InspectorProcess }) {
  return (
    <section className="insp-col card" data-testid="insp-process" data-role={p.role} aria-label={p.name}>
      <h3>{p.name}</h3>
      <p className="insp-note">{p.note}</p>
      {p.error && <p className="insp-error">{p.error}</p>}
      {p.requests && <Requests list={p.requests} />}
      {p.tables.map((t) => (
        <Table key={t.name} t={t} />
      ))}
    </section>
  );
}

function DeviceColumn({ events }: { events: DeviceEvent[] }) {
  return (
    <section className="insp-col insp-device card" data-testid="insp-device" aria-label="On her device">
      <h3>On her device</h3>
      <p className="insp-note">
        What was typed in the app in this browser, at the moment it was encrypted, blinded or hashed, and what left the
        device instead. Sent from the app tab to this tab only; never to a server.
      </p>
      {!events.length && <p className="insp-caption">Nothing yet. Use the app in another tab of this browser.</p>}
      {events.map((e, i) => (
        <div key={i} className="insp-row" data-testid="insp-device-event">
          <div className="insp-req">
            <strong>{e.what}</strong> <span className="insp-time">{e.at.slice(11, 19)}</span>
          </div>
          <p className="insp-typed">
            <mark className="insp-readable">{e.typed || '(empty)'}</mark>
          </p>
          <p className="insp-caption">→ {e.sent}</p>
        </div>
      ))}
    </section>
  );
}

export function Inspector() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [events, setEvents] = useState<DeviceEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [query, setQuery] = useState('');
  const [find, setFind] = useState('');
  const findRef = useRef('');
  findRef.current = find;

  useEffect(() => {
    document.title = 'Matra — Server view (demo)';
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(INSPECTOR_CHANNEL);
    ch.onmessage = (m: MessageEvent<DeviceEvent>) => setEvents((list) => [m.data, ...list].slice(0, 50));
    return () => ch.close();
  }, []);

  useEffect(() => {
    if (paused) return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetchSnapshot(findRef.current);
        if (!alive) return;
        setStatus('off' in r ? { kind: 'off', why: r.off } : { kind: 'on', snap: r });
      } catch (e) {
        if (alive) setStatus({ kind: 'off', why: `The server is not reachable (${(e as Error).message}).` });
      }
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [paused, find]);

  const onFind = (e: FormEvent) => {
    e.preventDefault();
    setFind(query.trim());
  };

  const snap = status.kind === 'on' ? status.snap : undefined;
  // the key holders' and matcher's descriptions are searched as shown (they hold no free text)
  const shownElsewhere =
    snap && find ? snap.processes.filter((p) => p.role !== 'app' && JSON.stringify(p).toLowerCase().includes(find.toLowerCase())).map((p) => p.name) : [];

  return (
    <div className="insp-root">
      <header className="insp-head">
        <div>
          <p className="insp-eyebrow">Matra · development / demo only · fictional data</p>
          <h1>Server view</h1>
          <p className="insp-lead">
            Everything each server holds about the people using this demo, refreshed every 2 seconds. <mark className="insp-readable">Highlighted</mark>{' '}
            = a person could read it. <code className="insp-opaque">muted</code> = ciphertext, a hash, a key or an id.
          </p>
        </div>
        <div className="insp-controls">
          <form onSubmit={onFind} className="insp-find" role="search">
            <label htmlFor="insp-find">Look for something she typed</label>
            <div>
              <input id="insp-find" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. a word from her story" />
              <button type="submit" className="btn btn-primary btn-small">
                Look
              </button>
            </div>
          </form>
          <button type="button" className="btn btn-quiet btn-small" onClick={() => setPaused(!paused)}>
            {paused ? 'Resume' : 'Pause'}
          </button>
        </div>
      </header>

      {find && snap?.found && (
        <p className={`insp-found ${snap.found.length || shownElsewhere.length ? 'insp-found-yes' : 'insp-found-no'}`} data-testid="insp-found" role="status">
          {snap.found.length || shownElsewhere.length
            ? `“${find}” is held at: ${[...snap.found.map((f) => `app server ${f.table}.${f.column} (${f.rows} row${f.rows > 1 ? 's' : ''})`), ...shownElsewhere].join('; ')}.`
            : `“${find}” is not in any column of any table in the app server’s database, and not in what the key holders or the matcher hold.`}
        </p>
      )}

      {status.kind === 'loading' && <p>Loading…</p>}
      {status.kind === 'off' && (
        <p className="insp-error" data-testid="insp-off">
          Server view is off. {status.why}
        </p>
      )}
      {snap && (
        <div className="insp-grid">
          <DeviceColumn events={events} />
          {snap.processes.map((p) => (
            <ProcessColumn key={p.name} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}
