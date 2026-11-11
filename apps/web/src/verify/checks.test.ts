// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { LEDGER_GENESIS_HASH, ledgerEntryHash } from '@matra/crypto';
import type { LedgerEntry, LedgerProofResponse } from '@matra/shared';
import { accountCheck, chainCheck, evidenceCheck, overallTone, proofHashes } from './checks';

const h = (c: string) => c.repeat(64);

/** A small valid chain: 1 someone else's record, 2 her record, 3 her evidence, 4 someone else's share. */
function chain() {
  const raw = [
    { type: 'record.sealed', subjectId: 'other-record', contentHash: h('1') },
    { type: 'record.sealed', subjectId: 'rec-1', contentHash: h('a') },
    { type: 'blob.sealed', subjectId: 'blob-1', contentHash: h('b') },
    { type: 'share.granted', subjectId: 'share-x', contentHash: h('2') },
  ];
  const all: LedgerEntry[] = [];
  let prev = LEDGER_GENESIS_HASH;
  raw.forEach((r, i) => {
    const e = { seq: i + 1, id: `entry-${i + 1}`, timestamp: `2026-11-0${i + 1}T10:00:00.000Z`, prevHash: prev, ...r };
    const entry = { ...e, entryHash: ledgerEntryHash(e) };
    all.push(entry);
    prev = entry.entryHash;
  });
  const proof: LedgerProofResponse = {
    entries: [all[1]!],
    links: all.slice(1).map((e) => ({ seq: e.seq, prevHash: e.prevHash, entryHash: e.entryHash })),
    head: { seq: 4, entryHash: all[3]!.entryHash },
    truncated: false,
  };
  return proof;
}

describe('accountCheck', () => {
  it('green when the sealed hash is in the ledger for this record', () => {
    const line = accountCheck({ recordId: 'rec-1', recordContentHash: h('a'), proof: chain(), recomputed: true });
    expect(line.tone).toBe('ok');
    expect(line.text).toMatch(/^This account has not changed since it was sealed on /);
    const fromPdf = accountCheck({ recordId: 'rec-1', recordContentHash: h('a'), proof: chain(), recomputed: false });
    expect(fromPdf.text).toMatch(/^The sealed account behind this summary is in the ledger: sealed on /);
    expect(fromPdf.details.join(' ')).toMatch(/does not check the printed words/);
  });

  it('red for a changed account (hash not sealed) and for a summary that names the wrong record', () => {
    expect(accountCheck({ recordId: 'rec-1', recordContentHash: h('c'), proof: chain(), recomputed: true })).toMatchObject({
      tone: 'bad',
      text: 'This account does not match what was sealed. Treat it as unverified.',
    });
    const wrong = accountCheck({ recordId: 'rec-2', recordContentHash: h('a'), proof: chain(), recomputed: false });
    expect(wrong.tone).toBe('bad');
    expect(wrong.text).toMatch(/different record/);
  });

  it('says so plainly when the summary was never sealed', () => {
    expect(accountCheck({ recomputed: false }).tone).toBe('info');
  });
});

describe('evidenceCheck', () => {
  const listed = [
    { fileName: 'photo.jpg', sha256: h('d') },
    { fileName: 'texts.pdf', sha256: h('e') },
    { fileName: 'receipt.png', sha256: h('f') },
  ];

  it('3 of 3 when every file matches by content (names may differ)', () => {
    const lines = evidenceCheck(listed, [
      { name: 'IMG_0001.jpg', sha256: h('d') },
      { name: 'texts.pdf', sha256: h('e') },
      { name: 'receipt.png', sha256: h('f') },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ tone: 'ok', text: '3 of 3 evidence files match. Each is bit-for-bit the file that was sealed.' });
  });

  it('a tampered file matches nothing and is named in red', () => {
    const lines = evidenceCheck(listed, [
      { name: 'photo.jpg', sha256: h('9') }, // edited after sealing
      { name: 'texts.pdf', sha256: h('e') },
    ]);
    expect(lines.map((l) => l.tone)).toEqual(['ok', 'bad']);
    expect(lines[0]!.text).toBe('1 of 3 evidence files match so far. 2 files not checked yet.');
    expect(lines[1]!.text).toMatch(/^photo\.jpg doesn’t match any file in this summary/);
    expect(overallTone(lines)).toBe('bad');
  });

  it('nothing dropped: says how many are listed; no list: every file is unmatched', () => {
    expect(evidenceCheck(listed, [])[0]).toMatchObject({ tone: 'info', text: 'This summary lists 3 evidence files. Add them to check them.' });
    expect(evidenceCheck([], [{ name: 'x', sha256: h('d') }])[0]!.tone).toBe('bad');
    expect(evidenceCheck([], [])).toEqual([]);
  });
});

describe('chainCheck', () => {
  it('intact through the head', () => {
    expect(chainCheck(chain())).toMatchObject({ tone: 'ok', text: 'Ledger chain intact through entry 4.' });
  });

  it('red for a back-dated entry, a broken link, or a chain that stops short of the head', () => {
    const backdated = chain();
    backdated.entries[0] = { ...backdated.entries[0]!, timestamp: '2020-01-01T00:00:00.000Z' };
    expect(chainCheck(backdated)).toMatchObject({ tone: 'bad', text: 'The ledger chain is broken at entry 2. Treat these results as unverified.' });
    const broken = chain();
    broken.links[1] = { ...broken.links[1]!, prevHash: h('0') };
    expect(chainCheck(broken)!.tone).toBe('bad');
    const short = chain();
    short.links.pop();
    expect(chainCheck(short)!.tone).toBe('bad');
  });

  it('nothing to check without entries', () => {
    expect(chainCheck({ ...chain(), entries: [] })).toBeNull();
    expect(chainCheck(undefined)).toBeNull();
  });
});

it('proofHashes keeps exact hex hashes only, once each', () => {
  expect(proofHashes(h('a'), undefined, h('a'), 'abc', h('A'))).toEqual([h('a')]);
});
