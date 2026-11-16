/**
 * "Download my data": decrypts everything in her vault ON THIS DEVICE and packages it as one .zip
 * (STORE-only, see ./zip). The server is not told what is exported; it only serves the same ciphertext
 * it always does. The resulting file is NOT encrypted — the UI warns her before creating it.
 */
import type { EvidenceItem } from '@matra/shared';
import type { ApiClient } from '../api/client';
import { createZip, safeFileName, type ZipEntry } from './zip';
import { DRAFT_PROBLEM_ID, blobKeyFor, loadSpace, openEvidence, spaceEvidence, type VaultProblem } from './vault';
import { matchingApi } from '../api/matching';
import { escrowLabel } from './matching';
import { buildExhibits, exhibitListCsv } from '../evidence/exhibits';
import { loadPrivate } from '../evidence/privateStore';

export interface DataExport {
  zip: Uint8Array;
  fileName: string;
  recordCount: number;
  evidenceCount: number;
  /** Saved versions of her space that could not be opened, so are missing from records.json (manifest problems too). */
  unreadableRecords: number;
  /** Evidence files that could not be decrypted or failed their hash check (listed in the manifest too). */
  problems: string[];
}

/** Only in a build with sealed matching (MATRA_MATCHING=on). */
const ESCROW_README = `escrow.json             The labels of identifiers you sealed in escrow (the sealed codes
                        themselves cannot be reversed and are not included).
`;

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
records.json            Every sealed version of your account, decrypted, with its vault ID,
                        SHA-256 fingerprint and ledger (timestamp) entry. Also your preferences
                        (such as the name you asked us to call you), and any drafts that were
                        kept as separate versions.
draft.json              Your current draft (what you are still writing or adding to), decrypted.
                        It is saved over as you write, so it is the newest copy only.
evidence/manifest.json  One entry per evidence file: original name, type, size, the SHA-256
                        recorded when you added it, and whether this copy still matches it.
evidence/...            The evidence files themselves (as stored — with hidden details removed
                        where Matra could do that).
evidence/unattributed/  Stored files that Matra cannot tie to a file in your list (for example when
                        another device saved its details first). They are kept here so nothing is
                        left out, but they have no exhibit number and are not in the exhibit list.
evidence/exhibit-list.csv   Your files in the order you added them: number, name, date added, type, size
                        and a salted fingerprint of the original file you chose (if one was kept).
evidence/private-details.json   What only you hold about each file: the fingerprint of the original, the
                        secret salt that goes with the salted fingerprint, and any text you had read from
                        an image. To check a salted fingerprint: SHA-256 of the 32 salt bytes followed by
                        the 32 bytes of the original file's SHA-256 equals it
                        (printf '%s' "<salt><original sha256>" | xxd -r -p | shasum -a 256). This shows a
                        file with those exact bytes existed when you added it; it does not show that the
                        cleaned copy in this archive came from it. Treat the salt as private.
${__MATRA_MATCHING__ ? ESCROW_README : ''}shares.json             Who you shared your file with, the exact consent text, and status.
activity.json           Your activity log (sign-ins, saves, shares, attorney access).

To check a file has not changed, compute its SHA-256 and compare it with the manifest:
  macOS/Linux:  shasum -a 256 <file>
  Windows:      certutil -hashfile <file> SHA256
`;

export async function buildDataExport(
  api: ApiClient,
  masterKey: CryptoKey,
  alias: string,
  now: Date = new Date(),
  /** the file details the Evidence screen also holds in memory (session working data), so every view numbers the same set */
  workingEvidence?: EvidenceItem[],
): Promise<DataExport> {
  const at = now.toISOString();
  // A copy of what she has, so it reads partially (`allowPartial`), and says what is left out and why.
  const [{ vault, slot, problems: loadProblems }, { blobs }, escrow, shares, audit] = await Promise.all([
    loadSpace(api, masterKey, { includeProfile: true, allowPartial: true }),
    api.listBlobs(),
    __MATRA_MATCHING__ ? matchingApi(api).listEscrow().catch(() => ({ entries: [] })) : { entries: [] },
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
    spaceEvidence(vault, slot.slot, workingEvidence)
      .filter((e) => e.blobId)
      .map((e) => [e.blobId!, e]),
  );

  // The evidence reader's private details (when they opened): which files are kept originals, and what only she holds.
  const priv = await loadPrivate(api, masterKey).catch(() => null);
  // Kept originals, by what HER record says (the blob id saved when the upload returned it, or the link). Nothing the server
  // reports (a content hash) decides this alone.
  const originalOf = new Map<string, string>(); // kept original's blob id -> the file it is the original of
  // A lead only: an original whose id was never saved, matched by the ciphertext hash reserved before it was sent. Followed
  // only for a blob no file claims, only when exactly one blob carries that hash, and only after the decrypted bytes are
  // checked against the original's own hash; anything less is marked "probable" in the manifest and never renamed.
  const leads = new Map<string, { fileName: string; originalSha256?: string; alone: boolean }>();
  if (priv && !priv.unreadable)
    for (const [itemId, p] of Object.entries(priv.value.items)) {
      const parent = [...itemByBlob.values()].find((e) => e.id === itemId);
      if (!parent) continue;
      if (p.originalBlobId) originalOf.set(p.originalBlobId, parent.fileName);
      if (p.originalPending?.blobId) originalOf.set(p.originalPending.blobId, parent.fileName);
      if (p.originalPending && !p.originalBlobId && !p.originalPending.blobId) {
        const same = blobs.filter((b) => b.contentHash === p.originalPending!.ciphertextSha256);
        for (const b of same) if (!itemByBlob.has(b.id)) leads.set(b.id, { fileName: parent.fileName, originalSha256: p.originalSha256, alone: same.length === 1 });
      }
    }
  // an item whose stored file the server did not list: said in the problems, not numbered around
  const listedBlobs = new Set(blobs.map((b) => b.id));
  const entries: ZipEntry[] = [];
  const manifest: unknown[] = [];
  const problems: string[] = [];
  for (const m of [...itemByBlob.values()].filter((e) => !listedBlobs.has(e.blobId!)))
    problems.push(`${m.fileName}: your story lists this file but it is not among your stored files, so it has no exhibit number`);
  let i = 0;
  for (const b of [...blobs].sort((x, y) => x.createdAt.localeCompare(y.createdAt))) {
    i++;
    const item = itemByBlob.get(b.id);
    let originalFor = originalOf.get(b.id);
    const lead = item ? undefined : leads.get(b.id);
    let attribution: 'verified' | 'probable' | undefined;
    try {
      const key = await blobKeyFor(b, masterKey);
      const { bytes, hash, verified } = await openEvidence(api, key, b.id, item?.sha256);
      if (lead) {
        if (lead.alone && lead.originalSha256 && hash === lead.originalSha256) (originalFor = lead.fileName), (attribution = 'verified');
        else attribution = 'probable';
      }
      // a blob tied to no file in her list is kept in the archive (nothing of hers is left out) but apart, and never numbered
      const unattributed = !item && !originalFor;
      const name = `evidence/${unattributed ? 'unattributed/' : ''}${String(i).padStart(3, '0')}-${safeFileName(originalFor ? `original-of-${originalFor}` : (item?.fileName ?? `${b.id}.bin`))}`;
      entries.push({ name, data: bytes, date: new Date(b.createdAt) });
      if (verified === false) problems.push(`${item?.fileName ?? b.id}: SHA-256 does not match the value recorded when it was added`);
      manifest.push({
        file: name, blobId: b.id, fileName: item?.fileName, kind: item?.kind, mimeType: item?.mimeType,
        sizeBytes: bytes.byteLength, sha256: hash, recordedSha256: item?.sha256, sha256Matches: verified,
        description: item?.description, capturedAt: item?.capturedAt, metadataStripped: item?.metadataStripped,
        addedToVaultAt: b.createdAt, ledgerEntryId: b.ledgerEntryId,
        ...(originalFor && { originalOf: originalFor }),
        ...(attribution && { attribution }),
        ...(attribution === 'probable' && lead && { possibleOriginalOf: lead.fileName, attributionNote: 'Probably the kept original of this file (matched by a hash the server reports), but it could not be confirmed, so it is kept apart and not renamed.' }),
        ...(unattributed && { attributedToAFile: false }),
      });
    } catch (e) {
      problems.push(`${item?.fileName ?? b.id}: could not be decrypted (${e instanceof Error ? e.message : 'unknown error'})`);
      manifest.push({ file: null, blobId: b.id, fileName: item?.fileName, error: 'could not be decrypted', addedToVaultAt: b.createdAt, ...(lead && { possibleOriginalOf: lead.fileName }) });
    }
  }

  const evidenceFileCount = entries.length; // the evidence files themselves, before the lists below
  if (priv && !priv.unreadable) {
    const items = [...itemByBlob.values()];
    const exhibits = buildExhibits(blobs, items, priv.value.items);
    // private details that match no file she has details for (another device saved first): kept so a ledgered commitment can still be opened
    const named = new Set(exhibits.map((e) => e.id));
    const unlisted = Object.entries(priv.value.items).filter(([id]) => !named.has(id));
    entries.push({ name: 'evidence/exhibit-list.csv', data: exhibitListCsv(exhibits), date: now });
    entries.push({
      name: 'evidence/private-details.json',
      data: JSON.stringify(
        {
          exportedAt: at,
          note: 'Private: the salts and hashes here are what let you show a salted fingerprint is yours. Keep this file as safe as the evidence itself.',
          ...(unlisted.length > 0 && {
            unlistedDetails: {
              note: 'Details saved for files whose names were not saved (for example when another device saved first). Match them to a file by its salted fingerprint on the ledger.',
              items: unlisted.map(([id, p]) => ({ id, ...p })),
            },
          }),
          files: exhibits.map((e) => {
            const p = priv.value.items[e.id];
            return {
              exhibit: e.number,
              fileName: e.fileName,
              ...(p?.originalSha256 && { originalSha256: p.originalSha256, salt: p.salt, saltedFingerprint: p.commitment }),
              ...(p?.importedAt && { addedAt: p.importedAt }),
              ...(p?.originalBlobId && { originalKept: true, originalFileBlobId: p.originalBlobId }),
              ...(e.redactedCopyOf !== undefined && { redactedCopyOf: e.redactedCopyOf }),
              ...(p?.ocr && { textRead: p.ocr.text, textReadWith: p.ocr.engine, textReadAt: p.ocr.at }),
            };
          }),
        },
        null,
        2,
      ) + '\n',
      date: now,
    });
  }

  const escrowLabels = __MATRA_MATCHING__
    ? await Promise.all(
        escrow.entries.map(async (e) => ({ label: await escrowLabel(e.labelEnvelope, masterKey), sealedAt: e.createdAt, ledgerEntryId: e.ledgerEntryId })),
      )
    : [];

  // What didn't load (or didn't match what she saved) is not in records.json / draft.json: say so in the manifest's
  // problems list too, so this copy is never taken as complete.
  const unreadableProblem = loadProblems.map(describeProblem);
  const versionProblems = loadProblems.filter((p) => p.id !== DRAFT_PROBLEM_ID);
  const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
  const files: ZipEntry[] = [
    { name: 'README.txt', data: README(alias, at), date: now },
    {
      name: 'records.json',
      data: json({ exportedAt: at, alias, records, unreadableRecords: versionProblems.length, ...(versionProblems.length > 0 && { notIncluded: versionProblems }) }),
      date: now,
    },
    {
      name: 'draft.json',
      data: json({
        exportedAt: at,
        draft: slot.slot ? { ...slot.slot.value, savedOnDay: slot.slot.updatedDay } : null,
        draftUnreadable: slot.unreadable,
      }),
      date: now,
    },
    { name: 'evidence/manifest.json', data: json({ exportedAt: at, files: manifest, problems: [...unreadableProblem, ...problems] }), date: now },
    ...entries,
    ...(__MATRA_MATCHING__ ? [{ name: 'escrow.json', data: json({ exportedAt: at, sealed: escrowLabels }), date: now }] : []),
    { name: 'shares.json', data: json({ exportedAt: at, shares: shares.shares }), date: now },
    { name: 'activity.json', data: json({ exportedAt: at, events: audit.events }), date: now },
  ];
  return {
    zip: createZip(files),
    fileName: `matra-my-data-${at.slice(0, 10)}.zip`,
    recordCount: records.filter((r) => r.kind !== 'your preferences').length,
    evidenceCount: evidenceFileCount,
    unreadableRecords: loadProblems.length,
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

/** One line for the manifest: what is left out, and whether it couldn't be fetched or didn't match what she saved. */
function describeProblem(p: VaultProblem): string {
  const what = p.id === DRAFT_PROBLEM_ID ? 'Your current draft' : `Saved version ${p.id}`;
  const where = p.id === DRAFT_PROBLEM_ID ? 'draft.json' : 'records.json';
  if (p.kind === 'unavailable') return `${what} could not be fetched just now and is not in ${where}`;
  if (p.kind === 'missing') return `${what} is referred to by your space but the server did not provide it, so it is not in ${where}`;
  const why: Record<NonNullable<VaultProblem['reason']>, string> = {
    gcm: 'does not decrypt with your key',
    hash: 'does not match its recorded fingerprint (SHA-256)',
    ledger: 'does not match its ledger entry',
    shape: 'is not in a format this app wrote',
  };
  return `${what} ${why[p.reason ?? 'shape']}, so it is not in ${where}`;
}
