/**
 * "Check a file" (/verify): anyone with a Matra incident summary PDF and its evidence files can check them here, with
 * no account. Everything is computed in this browser: each file's SHA-256 (WebCrypto), the verification data the PDF
 * carries (brief/verification.ts), and the hash chain (@matra/crypto checkLedgerProof). The only request is
 * POST /api/ledger/proof with the record ciphertext hash the PDF names: the files themselves never leave the device.
 * The PDF link ("Open <app>/verify ...") lands here (App.tsx reads the path once at start-up).
 */
import { useRef, useState } from 'react';
import { sha256Hex } from '@matra/crypto';
import { ErrorNote, Loading, PageTitle } from '../components/common';
import { friendlyError, useSession } from '../lib/session';
import { formatBytes } from '../lib/vault';
import type { SummaryVerification } from '../brief/verification';
import { CheckLines } from './CheckLines';
import { accountCheck, chainCheck, evidenceCheck, overallTone, proofHashes, type CheckLine } from './checks';

interface Dropped {
  name: string;
  size: number;
  sha256: string;
  /** a Matra incident summary: the verification data it carries */
  summary?: SummaryVerification;
}

const isPdf = (b: Uint8Array) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d;

export function VerifyPage() {
  const { api } = useSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [files, setFiles] = useState<Dropped[]>([]);
  const [code, setCode] = useState('');
  const [lines, setLines] = useState<CheckLine[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check(all: Dropped[], typed: string) {
    setError(null);
    const summary = all.find((f) => f.summary)?.summary;
    const hash = typed.trim().toLowerCase();
    const meta: Pick<SummaryVerification, 'recordId' | 'recordContentHash' | 'evidence'> | undefined =
      summary ?? (/^[0-9a-f]{64}$/.test(hash) ? { recordContentHash: hash, evidence: [] } : undefined);
    const evidence = all.filter((f) => !f.summary);
    if (!meta) {
      setLines(
        all.length
          ? [
              {
                id: 'files',
                tone: 'info',
                text: 'None of these is a Matra incident summary. Add the summary PDF the files came with, or type the code printed in it, and we’ll compare them.',
                details: evidence.map((f) => `${f.name}: ${f.sha256}`),
              },
            ]
          : null,
      );
      return;
    }
    setBusy('Checking the ledger…');
    try {
      const hashes = proofHashes(meta.recordContentHash);
      const proof = hashes.length ? await api.ledgerProof(hashes) : undefined;
      const out: CheckLine[] = [
        accountCheck({ recordId: meta.recordId, recordContentHash: meta.recordContentHash, proof, recomputed: false }),
        ...evidenceCheck(meta.evidence, evidence),
      ];
      const chain = chainCheck(proof);
      if (chain) out.push(chain);
      setLines(out);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  async function add(list: File[]) {
    setBusy('Reading on this device…');
    try {
      const { readVerification } = await import('../brief/verification');
      const next = [...files];
      for (const f of list) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const sha256 = await sha256Hex(bytes);
        if (next.some((x) => x.sha256 === sha256)) continue;
        const summary = isPdf(bytes) ? await readVerification(bytes) : null;
        next.push({ name: f.name, size: f.size, sha256, ...(summary && { summary }) });
      }
      setFiles(next);
      await check(next, code);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  const tone = lines ? overallTone(lines) : null;

  return (
    <div className="stack-lg">
      <PageTitle
        eyebrow="Check a file"
        testId="verify-title"
        lead="Drop in a Matra incident summary (PDF) and the evidence files that came with it. Your browser checks them on this device. The files are never uploaded."
      >
        Has anything changed?
      </PageTitle>

      <section className="card stack" aria-labelledby="verify-add">
        <h2 id="verify-add">Add the files</h2>
        <div
          className={`dropzone stack${over ? ' over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void add(Array.from(e.dataTransfer.files));
          }}
        >
          <p className="muted" style={{ margin: 0 }}>Drop the PDF and the evidence files here, or</p>
          <div>
            <button type="button" className="btn btn-primary" onClick={() => inputRef.current?.click()} disabled={!!busy}>
              Choose files
            </button>
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="visually-hidden"
            aria-label="Choose files to check"
            onChange={(e) => {
              // copy first: the FileList is live, and clearing the input (so the same file can be added again) empties it
              if (e.target.files) void add(Array.from(e.target.files));
              e.target.value = '';
            }}
          />
        </div>
        {files.length > 0 && (
          <ul className="list small" data-testid="verify-files">
            {files.map((f) => (
              <li key={f.sha256} className="row" style={{ justifyContent: 'space-between' }}>
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                  <strong>{f.name}</strong> <span className="muted">· {formatBytes(f.size)}</span>
                </span>
                {f.summary && <span className="badge sage">Matra summary</span>}
              </li>
            ))}
          </ul>
        )}
        <details className="disclosure small">
          <summary>The PDF was printed or re-saved?</summary>
          <form
            className="stack"
            style={{ marginTop: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              void check(files, code);
            }}
          >
            <label className="field">
              <span>Record ciphertext SHA-256 (printed under “Integrity &amp; Chain of Custody”)</span>
              <input className="mono" value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} autoComplete="off" />
            </label>
            <div>
              <button className="btn btn-small" type="submit" disabled={!!busy || !/^[0-9a-fA-F]{64}$/.test(code.trim())}>
                Check this code
              </button>
            </div>
          </form>
        </details>
        {files.length > 0 && (
          <div>
            <button
              className="btn btn-small"
              onClick={() => {
                setFiles([]);
                setLines(null);
                setCode('');
              }}
            >
              Start again
            </button>
          </div>
        )}
      </section>

      {busy && <Loading label={busy} />}
      {error && <ErrorNote>{error}</ErrorNote>}
      {lines && (
        <section className="card stack" aria-labelledby="verify-result" data-testid="verify-result" data-tone={tone ?? undefined}>
          <h2 id="verify-result">
            {tone === 'bad' ? 'Something doesn’t match' : tone === 'ok' ? 'What we checked' : 'Not checked yet'}
          </h2>
          <CheckLines lines={lines} testId="verify-lines" />
        </section>
      )}

      <section className="card soft small stack" aria-labelledby="verify-limits">
        <h2 id="verify-limits">What this can and can’t tell you</h2>
        <p style={{ margin: 0 }}>
          It checks that each evidence file is exactly the file listed in the summary, that the sealed account the summary
          names is in Matra’s tamper-evident ledger, and when it was sealed. It can’t read the account, so it can’t check
          the summary’s printed words. Counsel the survivor shared her file with can see that check in the attorney
          portal.
        </p>
      </section>
    </div>
  );
}
