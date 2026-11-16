/**
 * Every consent sentence matches what the recipient can decrypt (MATRA_PLAN PR 9).
 *
 * For each choice she can make on the attorney share screen and on the counselor release screen, the test drives the
 * real screen, takes what her device sends, opens it with the recipient's private key, and checks it against the
 * words: each field the recipient can read must have its own covering words (RECORD_FIELDS, @matra/shared consent.ts,
 * typed over every nested field), and those words must be in the statement she agreed to; the files that open must be
 * exactly the ones she ticked and as many as the statement says; the screen must show the same parts and every file
 * name that travels. The words themselves are pinned literally in consentWords.test.ts, so the two can't move
 * together unnoticed.
 */
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import {
  decryptBlob,
  decryptJSON,
  encryptBlob,
  generateContentKey,
  sha256Hex,
  unwrapKeyWithPrivate,
  wrapKeyWithMaster,
} from '@matra/crypto';
import {
  ACCOUNT_PARTS,
  RECORD_FIELDS,
  SHARE_ALIAS_RE,
  consentMatches,
  fieldWords,
  type FieldWords,
  shareAliasSentence,
  statedFileCount,
  type AttorneyProfile,
  type BlobMeta,
  type EvidenceItem,
  type IntakeRecord,
  type SurvivorReportRequest,
  type WrappedKey,
} from '@matra/shared';
import { sampleRecord } from '../brief/fixtures';
import { ReportRequest } from '../counselor/ReportRequest';
import { Share } from '../screens/Share';
import { useSession } from './session';
import { fakeAuthFetch } from '../test/fakeServer';
import { storedRecord, vaultRoutes, type StoredRecord } from '../test/fakeVault';
import { Harness, current } from '../test/sessionHarness';

// The counselor release exists only with sealed matching on; this file tests both screens.
vi.hoisted(() => {
  (globalThis as { __MATRA_MATCHING__?: boolean }).__MATRA_MATCHING__ = true;
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const PASS = 'acorn-otter-river-lilac-tulip-zebra';

/** Three files her account lists: two uploaded (they can be shared), one she described but never uploaded. */
const FILES = [
  { name: 'wrists-photo.jpg', bytes: 'jpeg bytes of the wrists photo', upload: true },
  { name: 'sunday-text.png', bytes: 'png bytes of the screenshot', upload: true },
  { name: 'voicemail-notes.txt', bytes: 'never uploaded', upload: false },
] as const;

/** Her account with every field filled in, so every field's consent words are exercised. */
const fullRecord: IntakeRecord = {
  ...sampleRecord,
  survivor: {
    ...sampleRecord.survivor,
    accessibility: { interpreter: 'yes', interpreterLanguage: 'Yoruba', otherNeeds: 'An advocate with me in person.' },
  },
  incident: {
    ...sampleRecord.incident,
    dateEnd: '2026-08-15',
    jurisdiction: { ...sampleRecord.incident.jurisdiction, campus: 'None' },
  },
  narrative: {
    ...sampleRecord.narrative,
    entries: [{ id: 'n1', createdAt: '2026-08-18T21:04:00Z', text: sampleRecord.narrative.freeRecall, source: 'voice' }],
    sensory: { ...sampleRecord.narrative.sensory, taste: 'Wine.' },
  },
  perpetrators: [
    {
      ...sampleRecord.perpetrators[0]!,
      identifiers: [{ kind: 'social_handle', platform: 'Instagram', value: '@derek.lawson.demo' }, ...sampleRecord.perpetrators[0]!.identifiers],
      address: 'Somewhere in Highland Park',
      whereabouts: 'Still at the agency',
    },
  ],
  priorReports: [{ ...sampleRecord.priorReports[0]!, prosecutorFileNumber: 'MCPO-2026-118' }],
  physicalEvidence: { kinds: ['clothing'], description: 'The shirt I wore, in a paper bag in my closet.' },
  safety: { immediateSafety: 'safe', perpetratorHasAccess: true, wantsProtectiveOrder: 'unsure', notes: 'He knows where I live.' },
  financialImpact: {
    medicalCosts: '$400',
    counselingCosts: '$120 a week',
    lostWages: 'Two weeks',
    relocationCosts: 'None yet',
    otherCosts: 'Lock change',
    hasInsurance: 'yes',
  },
  compensation: {
    mailingAddress: { street: '1 Example Lane', city: 'Edison', state: 'NJ', zip: '08817' },
    claimant: 'self',
    claimantDetails: 'Myself',
    alternateContact: { name: 'Ada Okafor', relationship: 'Sister', phone: '(732) 555-0177', email: 'ada.demo@example.com' },
    insuranceCarrier: 'Example Health',
    employer: 'Example Agency',
    workDatesMissed: 'Aug 17 to Aug 28',
    goodCauseExplanation: 'I was afraid to report.',
  },
  goals: { policeReport: 'undecided', attorney: 'yes', compensation: 'yes', protectiveOrder: 'undecided' },
};

/** The least she can seal: her words, and nothing else she chose to fill in. */
const minimalRecord: IntakeRecord = {
  schemaVersion: 1,
  completedAt: '2026-08-19T14:20:51.000Z',
  survivor: { safeContact: { phone: false, text: false, email: false, voicemail: false } },
  incident: { dateIsApproximate: true, jurisdiction: {}, incidentTypes: [], isOngoing: false },
  narrative: { freeRecall: 'Only these words.', sensory: {} },
  perpetrators: [],
  witnesses: [],
  disclosures: [],
  medical: { soughtCare: false },
  priorReports: [],
  evidence: [],
  safety: { immediateSafety: undefined },
  financialImpact: {},
  goals: { policeReport: 'undecided', attorney: 'undecided', compensation: 'undecided', protectiveOrder: 'undecided' },
};

/** Every field path with a value (a leaf), e.g. ['survivor', 'phone'] or ['perpetrators', '0', 'name']. */
function leaves(v: unknown, path: string[] = []): string[][] {
  if (v === undefined || v === null || v === '') return [];
  if (Array.isArray(v)) return v.flatMap((x, i) => leaves(x, [...path, String(i)]));
  if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => leaves(x, [...path, k]));
  return [path];
}

interface Sent {
  recordId: string;
  recipientWrappedKey: WrappedKey;
  blobs: Array<{ blobId: string; recipientWrappedKey: WrappedKey }>;
  consentStatement: string;
  scope?: string[];
  survivorAlias?: string;
}

interface Vault {
  stored: StoredRecord[];
  /** ciphertext by blob id */
  ciphertexts: Map<string, Uint8Array>;
}

/**
 * Everything wrong with what she sent, judged only by her consent statement (and the screen she saw). Empty means the
 * recipient can open exactly what she agreed to.
 */
async function problems(
  sent: Sent,
  vault: Vault,
  privateKey: CryptoKey,
  saw: { parts: string[]; ticked: string[]; listed: string[]; alias?: string },
): Promise<string[]> {
  const out: string[] = [];
  const st = sent.consentStatement;
  const promised = new Set(ACCOUNT_PARTS.filter((p) => st.includes(p.consent)).map((p) => p.id));

  // the written account: only fields of parts the statement names
  const key = await unwrapKeyWithPrivate(sent.recipientWrappedKey, privateKey);
  const env = vault.stored.find((r) => r.record.id === sent.recordId)!.record.envelope;
  const payload = await decryptJSON<{ kind: string; record: IntakeRecord; savedAt: string }>(env, key);
  const top = Object.keys(payload).sort().join(',');
  if (top !== 'kind,record,savedAt') out.push(`the envelope holds more than her account: ${top}`);
  for (const path of leaves(payload.record)) {
    const fw = fieldWords(path);
    if (!fw) out.push(`${path.join('.')}: no consent words cover it`);
    else if ('words' in fw) {
      const part = ACCOUNT_PARTS.find((p) => p.id === fw.part)!;
      // its own words, inside its part's words, inside the statement she agreed to
      if (!(st.includes(fw.words) && part.consent.includes(fw.words) && promised.has(fw.part)))
        out.push(`${path.join('.')}: readable, but the statement doesn't say "${fw.words}"`);
    }
  }
  // every file name that travels was on her screen
  const names = payload.record.evidence.map((e) => e.fileName);
  if ([...names].sort().join(',') !== [...saw.listed].sort().join(',')) out.push(`file names that travel: [${names}], on screen: [${saw.listed}]`);

  // the screen showed the same parts the statement names
  const promisedOrder = ACCOUNT_PARTS.filter((p) => promised.has(p.id)).map((p) => p.id);
  if (saw.parts.join(',') !== promisedOrder.join(',')) out.push(`screen shows [${saw.parts}] but the statement names [${promisedOrder}]`);

  // the files themselves: exactly the ones she ticked, as many as the statement says
  const n = statedFileCount(st);
  if (n !== sent.blobs.length) out.push(`statement says ${n} files, ${sent.blobs.length} wrapped`);
  const opened: string[] = [];
  for (const b of sent.blobs) {
    const pt = await decryptBlob(vault.ciphertexts.get(b.blobId)!, await unwrapKeyWithPrivate(b.recipientWrappedKey, privateKey));
    const sha = await sha256Hex(pt);
    opened.push(payload.record.evidence.find((e) => e.sha256 === sha)?.fileName ?? `unlisted file ${sha}`);
  }
  if ([...opened].sort().join(',') !== [...saw.ticked].sort().join(',')) out.push(`files that open: [${opened}], ticked: [${saw.ticked}]`);

  // the attorney share's scope and label
  if (sent.scope) {
    const want = sent.blobs.length ? 'record,evidence' : 'record';
    if (sent.scope.join(',') !== want) out.push(`scope ${sent.scope} for ${sent.blobs.length} files`);
  }
  if (sent.survivorAlias !== undefined) {
    if (!SHARE_ALIAS_RE.test(sent.survivorAlias)) out.push(`label "${sent.survivorAlias}" is not a made-up one`);
    if (!st.includes(shareAliasSentence(sent.survivorAlias))) out.push('the statement names another label');
    if (saw.alias !== sent.survivorAlias) out.push(`screen showed label "${saw.alias}", sent "${sent.survivorAlias}"`);
  }
  // what the server checks before it stores anything (apps/server/src/app.ts)
  if (!consentMatches(st, { files: sent.blobs.length, alias: sent.survivorAlias })) out.push('the server would refuse this consent');

  // the statement is plain text on the server: nothing from her account in it
  for (const path of leaves(payload.record)) {
    const value = path.reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], payload.record);
    // free text, names and numbers (a one-word lowercase answer like "employer" can be one of the consent's own words)
    const fw = fieldWords(path);
    if (typeof value === 'string' && value.length >= 6 && /[\sA-Z0-9@]/.test(value) && !(fw && 'part' in fw && fw.part === 'sealed') && st.includes(value))
      out.push(`the statement carries "${value}" from her account`);
  }
  return out;
}

/** Her space: `record` sealed, the FILES uploaded ones in her blob list, and the screen's routes. */
async function space(record: IntakeRecord, mk: CryptoKey, extra: (url: URL, init?: RequestInit) => Response | null) {
  const stored: StoredRecord[] = [];
  const ciphertexts = new Map<string, Uint8Array>();
  const metas: BlobMeta[] = [];
  const evidence: EvidenceItem[] = [];
  for (const [i, f] of FILES.entries()) {
    const bytes = new TextEncoder().encode(f.bytes);
    const item: EvidenceItem = {
      id: `ev${i}`, kind: 'photo', fileName: f.name, mimeType: 'application/octet-stream', sizeBytes: bytes.length, sha256: await sha256Hex(bytes),
      metadataStripped: true, description: `About ${f.name}`, capturedAt: '2026-08-16',
    };
    if (f.upload) {
      const key = await generateContentKey();
      item.blobId = `b${i}`;
      ciphertexts.set(item.blobId, await encryptBlob(bytes, key));
      metas.push({ id: item.blobId, ownerId: 'u', sizeBytes: bytes.length, contentHash: 'c', createdAt: '2026-08-18T00:00:00Z', ledgerEntryId: `l-${i}`, ownerWrappedKey: await wrapKeyWithMaster(key, mk) });
    }
    evidence.push(item);
  }
  stored.push(await storedRecord(mk, { kind: 'final', record: { ...record, evidence }, savedAt: '2026-08-19T14:21:00Z' }, { id: 'r-final', createdAt: '2026-08-19T14:22:07.381Z' }));
  const routes = vaultRoutes(stored);
  const route = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://x');
    if (url.pathname === '/api/vault/blobs' && (init?.method ?? 'GET') === 'GET') return json(200, { blobs: metas });
    return extra(url, init) ?? routes(input, init);
  };
  return { vault: { stored, ciphertexts }, route };
}

/** What the screen listed as always shared, by part id. */
const partsOnScreen = () =>
  within(screen.getByTestId('account-parts'))
    .getAllByRole('listitem')
    .map((li) => li.getAttribute('data-part')!);

/** Every file name the screen says travels with her account. */
const listedOnScreen = () =>
  within(screen.getByTestId('listed-files'))
    .getAllByRole('listitem')
    .map((li) => li.getAttribute('data-file')!);

function Gate() {
  return useSession().session ? <Share /> : <p>Signed out</p>;
}

/** She opens the attorney share screen, ticks `ticked`, agrees, shares. Returns what her device sent. */
async function shareWithAttorney(record: IntakeRecord, ticked: string[], username: string) {
  const user = userEvent.setup();
  const base = fakeAuthFetch();
  const attorneys: AttorneyProfile[] = [];
  const sent: Sent[] = [];
  const hold: { route?: (i: RequestInfo | URL, n?: RequestInit) => Response | null } = {};
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => hold.route?.(input, init) ?? base.fetchImpl(input, init));
  render(
    <Harness fetchImpl={fetchImpl as unknown as typeof fetch}>
      <MemoryRouter>
        <Gate />
      </MemoryRouter>
    </Harness>,
  );
  await act(async () => {
    await current!.register({ username, passphrase: PASS, role: 'survivor', ageConfirmed18: true });
  });
  const s = current!.session!;
  const built = await space(record, s.masterKey, (url, init) => {
    if (url.pathname === '/api/attorneys') return json(200, { attorneys });
    if (url.pathname === '/api/shares' && init?.method === 'POST') {
      sent.push(JSON.parse(String(init.body)));
      return json(201, { share: {}, ledgerEntry: {} });
    }
    return null;
  });
  hold.route = built.route;
  // the attorney's key is her own here, so the test can open what the attorney would receive
  attorneys.push({ userId: 'a1', displayName: 'Attorney Test', jurisdictions: ['NJ'], practiceAreas: [], verified: true, acceptsProBono: true, publicKey: s.user.publicKey });
  await act(async () => {
    current!.lock();
  });
  await act(async () => {
    await current!.login(username, PASS);
  });
  const review = await screen.findByRole('button', { name: 'Review and decide' }, { timeout: 15_000 });
  // a development build has no org key to check the attorney against: its badge claims nothing
  expect(screen.getByText('Not checked (development version)')).toHaveClass('badge', 'neutral');
  expect(screen.queryByText('Verified attorney')).toBeNull();
  await user.click(review);
  // none is ticked until she ticks it
  for (const f of FILES.filter((x) => x.upload)) expect(screen.getByLabelText(new RegExp(f.name))).not.toBeChecked();
  expect(screen.queryByLabelText(/voicemail-notes/)).toBeNull(); // never uploaded: nothing to share
  for (const name of ticked) await user.click(screen.getByLabelText(new RegExp(name)));
  const alias = /“(Client [^”]+)”/.exec(screen.getByTestId('share-alias').textContent ?? '')?.[1];
  const parts = partsOnScreen();
  const listed = listedOnScreen();
  await user.click(screen.getByLabelText('I agree to the statement above.'));
  await user.click(screen.getByRole('button', { name: /Yes, share with Attorney Test/ }));
  await screen.findByText(/Shared with Attorney Test/, {}, { timeout: 15_000 });
  expect(sent).toHaveLength(1);
  return { sent: sent[0]!, vault: built.vault, privateKey: current!.session!.privateKey, saw: { parts, ticked, listed, alias }, username };
}

/** She opens the counselor's request, ticks `ticked`, confirms the key, agrees, says yes. Returns what her device sent. */
async function releaseToCounselor(ticked: string[], username: string) {
  const user = userEvent.setup();
  const base = fakeAuthFetch();
  const requests: SurvivorReportRequest[] = [];
  const sent: Sent[] = [];
  const hold: { route?: (i: RequestInfo | URL, n?: RequestInit) => Response | null } = {};
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => hold.route?.(input, init) ?? base.fetchImpl(input, init));
  const { rerender } = render(<Harness fetchImpl={fetchImpl as unknown as typeof fetch} />);
  await act(async () => {
    await current!.register({ username, passphrase: PASS, role: 'survivor', ageConfirmed18: true });
  });
  const s = current!.session!;
  const built = await space(fullRecord, s.masterKey, (url, init) => {
    if (url.pathname === '/api/report-requests') return json(200, { requests });
    if (url.pathname === '/api/escrow') return json(200, { entries: [] });
    if (url.pathname === '/api/report-requests/rq1/consent' && init?.method === 'POST') {
      sent.push(JSON.parse(String(init.body)));
      return json(201, { release: {}, ledgerEntry: {} });
    }
    return null;
  });
  hold.route = built.route;
  requests.push({
    id: 'rq1', entryId: 'e1', status: 'pending', createdAt: '2026-09-01T00:00:00Z',
    counselor: { userId: 'c1', displayName: 'Counselor Test', jurisdictions: ['NJ'], publicKey: s.user.publicKey },
  });
  rerender(
    <Harness fetchImpl={fetchImpl as unknown as typeof fetch}>
      <MemoryRouter initialEntries={['/vault/requests/rq1']}>
        <Routes>
          <Route path="/vault/requests/:id" element={<ReportRequest />} />
        </Routes>
      </MemoryRouter>
    </Harness>,
  );
  await screen.findByTestId('share-contents', {}, { timeout: 15_000 });
  for (const f of FILES.filter((x) => x.upload)) expect(screen.getByLabelText(new RegExp(f.name))).not.toBeChecked();
  for (const name of ticked) await user.click(screen.getByLabelText(new RegExp(name)));
  const parts = partsOnScreen();
  const listed = listedOnScreen();
  await user.click(screen.getByLabelText('This matches what the counselor told me.'));
  await user.click(screen.getByLabelText('I agree to the statement above.'));
  await user.click(screen.getByRole('button', { name: 'Yes, share my report' }));
  await vi.waitFor(() => expect(sent).toHaveLength(1), { timeout: 15_000 });
  return { sent: sent[0]!, vault: built.vault, privateKey: s.privateKey, saw: { parts, ticked, listed } };
}

const NONE: string[] = [];
const ONE = ['sunday-text.png'];
const BOTH = ['wrists-photo.jpg', 'sunday-text.png'];

/** Every leaf path of the field map, e.g. ['evidence', 'sizeBytes'] (array elements without an index). */
function mapPaths(node: unknown, path: string[] = []): string[][] {
  if (typeof node === 'object' && node !== null && !('words' in node) && !('internal' in node))
    return Object.entries(node).flatMap(([k, v]) => mapPaths(v, [...path, k]));
  return [path];
}

/** The value at a field-map path in a record, through the first element of each array. */
function valueAt(rec: unknown, path: string[]): unknown {
  let v = rec;
  for (const k of path) {
    if (Array.isArray(v)) v = v[0];
    v = (v as Record<string, unknown> | undefined)?.[k];
  }
  return Array.isArray(v) ? v[0] : v;
}

/** fullRecord with an evidence item that has every field, for the coverage check. */
const everyField: IntakeRecord = {
  ...fullRecord,
  evidence: [{ id: 'e', kind: 'photo', fileName: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 1, sha256: 'f'.repeat(64), blobId: 'b', description: 'd', capturedAt: '2026-08-16', metadataStripped: true }],
};

describe('the consent words cover every field of her account', () => {
  it('every field (nested ones too) has covering words that are inside its part’s consent words', () => {
    const paths = mapPaths(RECORD_FIELDS);
    expect(paths.length).toBeGreaterThan(100);
    for (const path of paths) {
      const fw = fieldWords(path) as FieldWords;
      expect(fw, path.join('.')).toBeDefined();
      if ('words' in fw) expect(ACCOUNT_PARTS.find((p) => p.id === fw.part)!.consent, path.join('.')).toContain(fw.words);
      else expect(fw.internal.length, path.join('.')).toBeGreaterThan(20);
    }
  });

  it('the test account fills in every field, so every field’s words are exercised against what decrypts', () => {
    const missing = mapPaths(RECORD_FIELDS).filter((p) => valueAt(everyField, p) === undefined);
    expect(missing.map((p) => p.join('.'))).toEqual([]);
    for (const path of leaves(everyField)) expect(fieldWords(path), path.join('.')).toBeDefined();
  });

  it('a field outside the map is caught, not covered by its parent’s words', () => {
    expect(fieldWords(['compensation', 'bankAccountNumber'])).toBeUndefined();
    expect(fieldWords(['evidence', '0', 'gpsLatLong'])).toBeUndefined();
    expect(fieldWords(['survivor'])).toBeUndefined();
    expect(fieldWords(['evidence', '3', 'sizeBytes'])).toEqual({ part: 'evidenceList', words: 'sizes' });
  });
});

describe('attorney share: what the attorney can decrypt is exactly what her consent says', () => {
  it.each([
    ['every field filled in, no files ticked', fullRecord, NONE],
    ['every field filled in, one file ticked', fullRecord, ONE],
    ['every field filled in, both uploaded files ticked', fullRecord, BOTH],
    ['only her words, no files ticked', minimalRecord, NONE],
    ['only her words, one file ticked', minimalRecord, ONE],
  ])('%s', async (_name, record, ticked) => {
    const r = await shareWithAttorney(record, ticked, `wren-${ticked.length}-${record === fullRecord ? 'full' : 'min'}`);
    expect(await problems(r.sent, r.vault, r.privateKey, r.saw)).toEqual([]);
    expect(r.sent.survivorAlias).not.toContain(r.username);
    expect(r.sent.consentStatement).not.toContain(r.username);
  }, 60_000);

  it('the check has teeth: drop words from her consent, or send a file she didn’t tick, and it says so', async () => {
    const r = await shareWithAttorney(fullRecord, ONE, 'wren-teeth');
    const evidenceList = ACCOUNT_PARTS.find((p) => p.id === 'evidenceList')!;
    const contact = ACCOUNT_PARTS.find((p) => p.id === 'contact')!;
    const narrowed = { ...r.sent, consentStatement: r.sent.consentStatement.replace(evidenceList.consent, '').replace(contact.consent, '') };
    const found = await problems(narrowed, r.vault, r.privateKey, r.saw);
    expect(found).toContain('survivor.phone: readable, but the statement doesn\'t say "phone number"');
    expect(found).toContain('evidence.0.fileName: readable, but the statement doesn\'t say "names"');
    expect(found.some((p) => p.startsWith('screen shows'))).toBe(true);
    // the reviewer's drift: the contact words say something else, and fields appear that no words cover
    const reworded = { ...r.sent, consentStatement: r.sent.consentStatement.replace(contact.consent, 'my preferred greeting') };
    expect(await problems(reworded, r.vault, r.privateKey, r.saw)).toContain('survivor.email: readable, but the statement doesn\'t say "email"');
    cleanup();
    const extra = await shareWithAttorney(
      { ...fullRecord, compensation: { ...fullRecord.compensation, bankAccountNumber: '021000021-998877' } } as IntakeRecord,
      NONE,
      'wren-teeth-extra',
    );
    expect(await problems(extra.sent, extra.vault, extra.privateKey, extra.saw)).toContain('compensation.bankAccountNumber: no consent words cover it');
    const hidden = await problems(r.sent, r.vault, r.privateKey, { ...r.saw, listed: r.saw.listed.slice(1) });
    expect(hidden.some((p) => p.startsWith('file names that travel'))).toBe(true);
    const extraFile = await problems(r.sent, r.vault, r.privateKey, { ...r.saw, ticked: [] });
    expect(extraFile).toContain('files that open: [sunday-text.png], ticked: []');
    const leaked = await problems({ ...r.sent, consentStatement: `${r.sent.consentStatement}\n${fullRecord.survivor.legalName}` }, r.vault, r.privateKey, r.saw);
    expect(leaked).toContain(`the statement carries "${fullRecord.survivor.legalName}" from her account`);
  }, 60_000);

  it('two shares get different labels, neither of them her username', async () => {
    const a = await shareWithAttorney(minimalRecord, NONE, 'wren-label');
    cleanup();
    const b = await shareWithAttorney(minimalRecord, NONE, 'wren-label2');
    expect(a.sent.survivorAlias).toMatch(SHARE_ALIAS_RE);
    expect(b.sent.survivorAlias).toMatch(SHARE_ALIAS_RE);
    expect(a.sent.survivorAlias).not.toBe(b.sent.survivorAlias);
  }, 60_000);
});

describe('counselor release: what the counselor can decrypt is exactly what her consent says', () => {
  it.each([
    ['no files ticked', NONE],
    ['one file ticked', ONE],
    ['both uploaded files ticked', BOTH],
  ])('%s', async (_name, ticked) => {
    const r = await releaseToCounselor(ticked, `wren-rel-${ticked.length}`);
    expect(await problems(r.sent, r.vault, r.privateKey, r.saw)).toEqual([]);
  }, 60_000);
});
