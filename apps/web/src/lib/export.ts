/**
 * "Download my data": decrypts everything in her vault ON THIS DEVICE and packages it as one .zip
 * (STORE-only, see ./zip). The server is not told what is exported; it only serves the same ciphertext
 * it always does. The resulting file is NOT encrypted — the UI warns her before creating it.
 */
import type { ApiClient } from '../api/client';
import { createZip, safeFileName, type ZipEntry } from './zip';
import { blobKeyFor, escrowLabel, loadVault, mergeEvidence, openEvidence } from './vault';

export interface DataExport {
  zip: Uint8Array;
  fileName: string;
  recordCount: number;
  evidenceCount: number;
  /** Evidence files that could not be decrypted or failed their hash check (listed in the manifest too). */
  problems: string[];
}

const README = (alias: string, at: string) => `Matra — your data export
=======================

Exported by: ${alias}
Exported at: ${at}

This archive was created on your own device. Matra's server never saw its contents.

IMPORTANT: these files are NOT encrypted. Anyone who can open this file can read
everything in it. Keep it somewhere safe, and delete it when you no longer need it
(also empty your Downloads folder and trash/recycle bin).

What is inside
--------------
records.json            Every version of your account and every saved draft, decrypted,
                        with its vault ID, SHA-256 fingerprint and ledger (timestamp) entry.
                        Also your preferences (such as the name you asked us to call you).
evidence/manifest.json  One entry per evidence file: original name, type, size, the SHA-256
                        recorded when you added it, and whether this copy still matches it.
evidence/...            The evidence files themselves (as stored — with hidden details removed
                        where Matra could do that).
escrow.json             The labels of identifiers you sealed in escrow (the sealed codes
                        themselves cannot be reversed and are not included).
shares.json             Who you shared your file with, the exact consent text, and status.
activity.json           Your activity log (sign-ins, saves, shares, attorney access).

To check a file has not changed, compute its SHA-256 and compare it with the manifest:
  macOS/Linux:  shasum -a 256 <file>
  Windows:      certutil -hashfile <file> SHA256
`;

export async function buildDataExport(api: ApiClient, masterKey: CryptoKey, alias: string, now: Date = new Date()): Promise<DataExport> {
  const at = now.toISOString();
  const [vault, { blobs }, escrow, shares, audit] = await Promise.all([
    loadVault(api, masterKey, { includeProfile: true }),
    api.listBlobs(),
    api.listEscrow().catch(() => ({ entries: [] })),
    api.listShares().catch(() => ({ shares: [] })),
    api.listAudit().catch(() => ({ events: [] })),
  ]);

  const records = [...vault]
    .sort((a, b) => a.meta.createdAt.localeCompare(b.meta.createdAt))
    .map((r) => ({
      id: r.meta.id,
      kind: r.payload.kind === 'final' ? 'sealed account' : r.payload.kind === 'profile' ? 'your preferences' : 'saved draft',
      savedAt: r.payload.savedAt,
      createdAt: r.meta.createdAt,
      supersedes: r.meta.supersedes,
      supersededBy: r.supersededBy,
      contentHash: r.meta.contentHash,
      fingerprintVerified: r.verified,
      ledgerEntry: r.ledgerEntry,
      payload: r.payload,
    }));

  const itemByBlob = new Map(
    mergeEvidence(...vault.flatMap((r) => [r.payload.evidence, r.payload.record?.evidence]))
      .filter((e) => e.blobId)
      .map((e) => [e.blobId!, e]),
  );

  const entries: ZipEntry[] = [];
  const manifest: unknown[] = [];
  const problems: string[] = [];
  let i = 0;
  for (const b of [...blobs].sort((x, y) => x.createdAt.localeCompare(y.createdAt))) {
    i++;
    const item = itemByBlob.get(b.id);
    const name = `evidence/${String(i).padStart(3, '0')}-${safeFileName(item?.fileName ?? `${b.id}.bin`)}`;
    try {
      const key = await blobKeyFor(b, masterKey);
      const { bytes, hash, verified } = await openEvidence(api, key, b.id, item?.sha256);
      entries.push({ name, data: bytes, date: new Date(b.createdAt) });
      if (verified === false) problems.push(`${item?.fileName ?? b.id}: SHA-256 does not match the value recorded when it was added`);
      manifest.push({
        file: name, blobId: b.id, fileName: item?.fileName, kind: item?.kind, mimeType: item?.mimeType,
        sizeBytes: bytes.byteLength, sha256: hash, recordedSha256: item?.sha256, sha256Matches: verified,
        description: item?.description, capturedAt: item?.capturedAt, metadataStripped: item?.metadataStripped,
        addedToVaultAt: b.createdAt, ledgerEntryId: b.ledgerEntryId,
      });
    } catch (e) {
      problems.push(`${item?.fileName ?? b.id}: could not be decrypted (${e instanceof Error ? e.message : 'unknown error'})`);
      manifest.push({ file: null, blobId: b.id, fileName: item?.fileName, error: 'could not be decrypted', addedToVaultAt: b.createdAt });
    }
  }

  const escrowLabels = await Promise.all(
    escrow.entries.map(async (e) => ({ label: await escrowLabel(e.labelEnvelope, masterKey), sealedAt: e.createdAt, ledgerEntryId: e.ledgerEntryId })),
  );

  const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
  const files: ZipEntry[] = [
    { name: 'README.txt', data: README(alias, at), date: now },
    { name: 'records.json', data: json({ exportedAt: at, alias, records }), date: now },
    { name: 'evidence/manifest.json', data: json({ exportedAt: at, files: manifest, problems }), date: now },
    ...entries,
    { name: 'escrow.json', data: json({ exportedAt: at, sealed: escrowLabels }), date: now },
    { name: 'shares.json', data: json({ exportedAt: at, shares: shares.shares }), date: now },
    { name: 'activity.json', data: json({ exportedAt: at, events: audit.events }), date: now },
  ];
  return {
    zip: createZip(files),
    fileName: `matra-my-data-${at.slice(0, 10)}.zip`,
    recordCount: records.filter((r) => r.kind !== 'your preferences').length,
    evidenceCount: entries.length,
    problems,
  };
}

/** Trigger a browser download of arbitrary bytes. */
export function downloadBytes(bytes: Uint8Array, filename: string, type = 'application/octet-stream'): void {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const url = URL.createObjectURL(new Blob([buf], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
