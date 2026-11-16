/**
 * The pieces of the Evidence screen that read and organise her files, all on her device: images blurred until she taps,
 * reading the text in an image on request, drawing boxes for a redacted copy, searching her files, and the exhibit list.
 * Nothing here interprets a file: no captions, objects, faces or "this looks like" (the one label, "screenshot", comes from
 * the file's name and size, and says so).
 *
 * Words on screen are survivor-facing and are listed for advocate review in the P6 log.
 */
import { useId, useMemo, useRef, useState, type PointerEvent } from 'react';
import { ErrorNote, Loading, formatDate } from '../components/common';
import { friendlyError, useRequiredSession } from '../lib/session';
import { formatBytes } from '../lib/vault';
import { OCR_ENGINE_LABEL, readTextFromImage, type OcrProgress } from '../ml/ocr/engine';
import { exhibitListCsv, redactedCopyDescription, redactedCopyLabel, type Exhibit } from './exhibits';
import { redactImage, type Box } from './redact';
import { EvidenceIndex, type SearchHit } from './search';
import { setPrivateOcr, type PrivateItem } from './privateStore';

/** Images the text reader can use (the browser decodes them; HEIC is not read). */
export const readableType = (mime: string): boolean => /^image\/(png|jpeg|webp|gif|bmp)$/i.test(mime);

// ───────────────────────── blurred until she taps ─────────────────────────

/** A picture that stays blurred until she chooses to show it, and can be blurred again. */
export function BlurredImage({ src, alt, className = 'thumb' }: { src: string; alt: string; className?: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="blur-wrap">
      <img className={`${className}${shown ? '' : ' blurred'}`} src={src} alt={shown ? alt : `${alt} (hidden until you tap)`} />
      <button type="button" className="btn btn-small blur-toggle" aria-pressed={shown} onClick={() => setShown((s) => !s)}>
        {shown ? 'Hide picture' : 'Show picture'}
      </button>
    </div>
  );
}

// ───────────────────────── read the text in an image ─────────────────────────

export function OcrControl({
  itemId,
  getImage,
  saved,
  onSaved,
}: {
  itemId: string;
  getImage: () => Promise<Blob>;
  saved?: PrivateItem['ocr'];
  onSaved: () => void;
}) {
  const { api, session } = useRequiredSession();
  const [busy, setBusy] = useState<OcrProgress | null>(null);
  const [text, setText] = useState<string | undefined>(saved?.text);
  const [error, setError] = useState<string | null>(null);
  const [notSaved, setNotSaved] = useState<string | null>(null);

  async function run() {
    setError(null);
    setNotSaved(null);
    setBusy({ status: 'Getting ready…' });
    try {
      const res = await readTextFromImage(await getImage(), { onProgress: setBusy });
      setText(res.text);
      try {
        await setPrivateOcr(api, session.masterKey, itemId, { text: res.text, engine: res.engine, at: new Date().toISOString() });
        onSaved();
      } catch (e) {
        setNotSaved(`The text is shown here but wasn’t saved: ${friendlyError(e)}`);
      }
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack" data-testid="ocr-control">
      {busy ? (
        <Loading label={`${busy.status}${busy.fraction !== undefined ? ` ${Math.round(busy.fraction * 100)}%` : ''}`} />
      ) : (
        <div className="row">
          <button type="button" className="btn btn-small" onClick={() => void run()}>
            {text !== undefined ? 'Read the text again' : 'Read the text in this image'}
          </button>
        </div>
      )}
      {text === undefined && !busy && (
        <p className="small muted">
          This runs on your device and only when you tap. It copies the printed words exactly as they appear, mistakes included. It doesn’t tell you
          what the picture shows.
        </p>
      )}
      {text !== undefined && (
        <div className="stack" data-testid="ocr-text-block">
          <p className="small muted">
            The words as read from the image ({saved?.engine ?? OCR_ENGINE_LABEL}). Not corrected or summarised.
            {!notSaved && ' Saved, locked, in your space.'}
          </p>
          <pre className="ocr-text" data-testid="ocr-text" tabIndex={0}>{text || '(No printed text was found.)'}</pre>
        </div>
      )}
      {notSaved && <p className="small" role="status">{notSaved}</p>}
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}

// ───────────────────────── redacted copy ─────────────────────────

interface FracBox {
  /** fractions of the picture, 0 to 1 */
  x: number;
  y: number;
  w: number;
  h: number;
}
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const pct = (f: number) => Math.round(f * 100);

export function RedactControl({
  exhibit,
  getImage,
  onMakeCopy,
}: {
  exhibit: Pick<Exhibit, 'number' | 'fileName'>;
  getImage: () => Promise<Blob>;
  /** adds the new file as its own exhibit; the original is not touched */
  onMakeCopy: (file: File, extra: { description: string }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [src, setSrc] = useState<{ url: string; blob: Blob } | null>(null);
  const [boxes, setBoxes] = useState<FracBox[]>([]);
  const [draft, setDraft] = useState<FracBox | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const imgRef = useRef<HTMLDivElement>(null);
  const uid = useId();

  async function openTool() {
    setError(null);
    try {
      const blob = await getImage();
      setSrc({ blob, url: URL.createObjectURL(blob) });
      setBoxes([]);
      setOpen(true);
    } catch (e) {
      setError(friendlyError(e));
    }
  }
  function close() {
    if (src) URL.revokeObjectURL(src.url);
    setSrc(null);
    setOpen(false);
    setBoxes([]);
    setDraft(null);
  }
  const at = (e: PointerEvent) => {
    const r = imgRef.current!.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  };
  function down(e: PointerEvent) {
    start.current = at(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (!start.current) return;
    const p = at(e);
    const s = start.current;
    setDraft({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
  }
  function up() {
    if (draft && draft.w > 0.005 && draft.h > 0.005) setBoxes((b) => [...b, draft]);
    start.current = null;
    setDraft(null);
  }
  const setBox = (i: number, patch: Partial<FracBox>) =>
    setBoxes((all) =>
      all.map((b, j) => {
        if (j !== i) return b;
        const n = { ...b, ...patch };
        return { x: clamp01(n.x), y: clamp01(n.y), w: Math.min(clamp01(n.w), 1 - clamp01(n.x)), h: Math.min(clamp01(n.h), 1 - clamp01(n.y)) };
      }),
    );

  async function save() {
    if (!src) return;
    setBusy(true);
    setError(null);
    try {
      // image pixels, from fractions of the picture
      const bmp = await createImageBitmap(src.blob);
      const px: Box[] = boxes.map((b) => ({ x: b.x * bmp.width, y: b.y * bmp.height, w: b.w * bmp.width, h: b.h * bmp.height }));
      bmp.close?.();
      const png = await redactImage(src.blob, px);
      const base = exhibit.fileName.replace(/\.[^./\\]+$/, '');
      const file = new File([png], `${redactedCopyLabel(exhibit.number)} - ${base}.png`, { type: 'image/png' });
      await onMakeCopy(file, { description: redactedCopyDescription(exhibit.number) });
      close();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <div className="stack">
        <div className="row">
          <button type="button" className="btn btn-small" onClick={() => void openTool()}>
            Make a redacted copy
          </button>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    );

  return (
    <div className="stack redact-tool" data-testid="redact-tool">
      <p className="small">
        Draw a box over anything you want covered. The copy is saved as a new file called “{redactedCopyLabel(exhibit.number)}”. Your original stays exactly as it
        is, in your space. Matra doesn’t suggest what to cover.
      </p>
      <div
        ref={imgRef}
        className="redact-canvas"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        data-testid="redact-canvas"
      >
        <img src={src!.url} alt={`${exhibit.fileName}, where you draw boxes`} draggable={false} />
        {[...boxes, ...(draft ? [draft] : [])].map((b, i) => (
          <div key={i} className="redact-box" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }} />
        ))}
      </div>
      <div className="row">
        <button type="button" className="btn btn-small" onClick={() => setBoxes((b) => [...b, { x: 0.1, y: 0.1, w: 0.3, h: 0.1 }])}>
          Add a box
        </button>
      </div>
      {boxes.length > 0 && (
        <ul className="list" aria-label="Boxes">
          {boxes.map((b, i) => (
            <li key={i} className="stack">
              <strong>Box {i + 1}</strong>
              <div className="grid-2">
                {(
                  [
                    ['x', 'From the left (%)'],
                    ['y', 'From the top (%)'],
                    ['w', 'Width (%)'],
                    ['h', 'Height (%)'],
                  ] as const
                ).map(([k, label]) => (
                  <label className="field" key={k}>
                    <span>{label}</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={pct(b[k])}
                      id={`${uid}-${i}-${k}`}
                      onChange={(e) => setBox(i, { [k]: Number(e.target.value) / 100 })}
                    />
                  </label>
                ))}
              </div>
              <div>
                <button type="button" className="btn btn-small" onClick={() => setBoxes((all) => all.filter((_, j) => j !== i))}>
                  Remove box {i + 1}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="row">
        <button type="button" className="btn btn-primary btn-small" disabled={busy || boxes.length === 0} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save as a new file'}
        </button>
        <button type="button" className="btn btn-small" onClick={close} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ───────────────────────── search and the exhibit list ─────────────────────────

function downloadText(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Excerpt({ hit }: { hit: SearchHit }) {
  const e = hit.excerpt;
  if (!e) return null;
  return (
    <p className="small muted" data-testid="search-excerpt">
      “{e.text.slice(0, e.start)}
      <mark>{e.text.slice(e.start, e.end)}</mark>
      {e.text.slice(e.end)}”
    </p>
  );
}

const FIELD_WORDS = { name: 'the file name', description: 'your description', text: 'the text read from the image' } as const;

export function ExhibitSection({ exhibits }: { exhibits: Exhibit[] }) {
  const [query, setQuery] = useState('');
  const index = useMemo(() => new EvidenceIndex(exhibits), [exhibits]);
  const hits = useMemo(() => index.search(query), [index, query]);
  const qid = useId();
  return (
    <section className="card stack" aria-labelledby="exhibits" data-testid="exhibit-list">
      <h2 id="exhibits">Your files, numbered</h2>
      <p className="small muted">
        In the order you added them. The number is only a place in your own list, so a copy can say which file it was made from. Searching happens on this device:
        what you type isn’t saved or sent.
      </p>
      {exhibits.length === 0 ? (
        <p className="muted">Nothing to list yet.</p>
      ) : (
        <>
          <label className="field" htmlFor={qid}>
            <span>Search your files</span>
            <input id={qid} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="a name, a word you wrote, or a word from an image" autoComplete="off" />
          </label>
          {query.trim() && (
            <div role="status" aria-live="polite" data-testid="search-results">
              {hits.length === 0 ? (
                <p className="muted">No file matches. Only the names, your descriptions and text you’ve had read from images are searched.</p>
              ) : (
                <ul className="list">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <strong>Exhibit {h.number}: {h.fileName}</strong>
                      <span className="small muted"> · found in {h.fields.map((f) => FIELD_WORDS[f]).join(' and ')}</span>
                      <Excerpt hit={h} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="table-scroll">
            <table className="exhibit-table">
              <thead>
                <tr>
                  <th scope="col">No.</th>
                  <th scope="col">File</th>
                  <th scope="col">Added</th>
                  <th scope="col">Type</th>
                  <th scope="col">Size</th>
                  <th scope="col">Salted fingerprint of the original</th>
                </tr>
              </thead>
              <tbody>
                {exhibits.map((e) => (
                  <tr key={e.id} data-testid={`exhibit-row-${e.number}`}>
                    <td>{e.number}</td>
                    <td style={{ overflowWrap: 'anywhere' }}>{e.fileName}</td>
                    <td>{formatDate(e.addedAt)}</td>
                    <td>{e.kindLabel}</td>
                    <td>{formatBytes(e.sizeBytes)}</td>
                    <td className="mono small" style={{ overflowWrap: 'anywhere' }}>{e.fingerprint || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            The salted fingerprint is a scrambled version of the fingerprint of the file exactly as you chose it. It can be checked only with a key kept in your
            space, so nobody can use it to look for the file. It shows a file with those exact bytes existed when you added it. It doesn’t show that the cleaned
            copy came from that file.
          </p>
          <div className="row">
            <button type="button" className="btn btn-small" onClick={() => downloadText(`matra-exhibit-list-${new Date().toISOString().slice(0, 10)}.csv`, exhibitListCsv(exhibits), 'text/csv;charset=utf-8')}>
              Download the list (CSV)
            </button>
          </div>
        </>
      )}
    </section>
  );
}
