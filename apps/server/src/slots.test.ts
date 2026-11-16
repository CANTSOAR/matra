import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import request from 'supertest';
import { encryptJSON, generateContentKey, openSlot, sealSlot, slotName, wrapKeyWithMaster } from '@matra/crypto';
import { SLOT_MAX_PER_ACCOUNT, parseDraftMode } from '@matra/shared';
import { createApp, getDb, getSlots } from './app.js';
import { draftsDbPathFor } from './slots.js';
import { TEST_PEPPER, createRecord, makeApp, registerUser, type TestUser } from './test-helpers.js';

const count = (db: ReturnType<typeof makeApp>['db'], sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n;

async function put(app: Parameters<typeof request>[0], u: TestUser, label: string, value: unknown, expectedVersion: string | null) {
  const name = await slotName(u.masterKey, label);
  return request(app).put(`/api/vault/slots/${name}`).set(u.auth).send({ ...(await sealSlot(value, u.masterKey)), expectedVersion });
}
const VERSION = /^[0-9a-f]{32}$/;

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matra-slots-'));
  onTestFinished(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe('draft slots', () => {
  it('ten autosaves write no record, no ledger entry and no activity row; she reads back the newest', async () => {
    const { app, db } = makeApp();
    const jane = await registerUser(app, 'jane.slot');
    const before = { records: count(db, 'SELECT COUNT(*) n FROM records'), ledger: count(db, 'SELECT COUNT(*) n FROM ledger'), audit: count(db, 'SELECT COUNT(*) n FROM audit_events WHERE user_id = ?', jane.user.id) };
    let version: string | null = null;
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const res = await put(app, jane, 'draft', { kind: 'draft', words: `version ${i}` }, version);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ updatedDay: new Date().toISOString().slice(0, 10), draftMode: 'slot' });
      expect(res.body.version).toMatch(VERSION);
      seen.add(res.body.version);
      version = res.body.version;
    }
    expect(seen.size).toBe(10); // a fresh random tag each time: the row never counts her saves
    expect(count(db, 'SELECT COUNT(*) n FROM records')).toBe(before.records);
    expect(count(db, 'SELECT COUNT(*) n FROM ledger')).toBe(before.ledger);
    expect(count(db, 'SELECT COUNT(*) n FROM audit_events WHERE user_id = ?', jane.user.id)).toBe(before.audit);

    const name = await slotName(jane.masterKey, 'draft');
    const got = await request(app).get(`/api/vault/slots/${name}`).set(jane.auth);
    expect(got.status).toBe(200);
    expect(got.body.draftMode).toBe('slot');
    expect(got.body.slot).toMatchObject({ name, version });
    expect(await openSlot(got.body.slot, jane.masterKey)).toEqual({ kind: 'draft', words: 'version 9' });
    // one row, overwritten in place; its only time is the UTC day
    const rows = getSlots(app).db.prepare('SELECT * FROM slots').all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(['envelope', 'name', 'owner_id', 'updated_day', 'version', 'wrapped_key']);
    expect(rows[0]!.updated_day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('a stale seq gets 409 slot_conflict and changes nothing (another device saved first)', async () => {
    const { app } = makeApp();
    const jane = await registerUser(app, 'jane.cas');
    const v1 = (await put(app, jane, 'draft', { from: 'laptop' }, null)).body.version;
    // her phone opened the draft at v1 too; the laptop saves again first
    const v2 = (await put(app, jane, 'draft', { from: 'laptop, later' }, v1)).body.version;
    const stale = await put(app, jane, 'draft', { from: 'phone' }, v1);
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('slot_conflict');
    // creating over an existing slot is a conflict too, and so is a made-up version
    expect((await put(app, jane, 'draft', { from: 'new device' }, null)).body.code).toBe('slot_conflict');
    expect((await put(app, jane, 'draft', { from: 'guess' }, '0'.repeat(32))).body.code).toBe('slot_conflict');
    const name = await slotName(jane.masterKey, 'draft');
    const got = await request(app).get(`/api/vault/slots/${name}`).set(jane.auth);
    expect(got.body.slot.version).toBe(v2);
    expect(await openSlot(got.body.slot, jane.masterKey)).toEqual({ from: 'laptop, later' });
  });

  it('refuses ciphertext that is not whole 16 KiB buckets, names that are not 64 hex, and other roles', async () => {
    const { app } = makeApp({ autoVerifyAttorneys: true });
    const jane = await registerUser(app, 'jane.pad');
    const name = await slotName(jane.masterKey, 'draft');
    const key = await generateContentKey();
    const unpadded = { envelope: await encryptJSON({ words: 'short' }, key), wrappedKey: await wrapKeyWithMaster(key, jane.masterKey), expectedVersion: null };
    const res = await request(app).put(`/api/vault/slots/${name}`).set(jane.auth).send(unpadded);
    expect(res.status).toBe(400);
    expect((await request(app).put('/api/vault/slots/draft').set(jane.auth).send({ ...(await sealSlot({}, jane.masterKey)), expectedVersion: null })).status).toBe(400);
    // a version must be 32 hex (never a count)
    expect((await request(app).put(`/api/vault/slots/${name}`).set(jane.auth).send({ ...(await sealSlot({}, jane.masterKey)), expectedVersion: 0 })).status).toBe(400);
    expect((await request(app).get(`/api/vault/slots/${name.toUpperCase()}`).set(jane.auth)).status).toBe(400);
    const atty = await registerUser(app, 'atty.slot', 'attorney');
    expect((await request(app).get(`/api/vault/slots/${name}`).set(atty.auth)).status).toBe(403);
    expect((await request(app).get(`/api/vault/slots/${name}`)).status).toBe(401);
  });

  it('slots are per account: the same name under another account is a different slot', async () => {
    const { app } = makeApp();
    const jane = await registerUser(app, 'jane.own');
    const sam = await registerUser(app, 'sam.own');
    await put(app, jane, 'draft', { mine: true }, null);
    const janeName = await slotName(jane.masterKey, 'draft');
    expect(await slotName(sam.masterKey, 'draft')).not.toBe(janeName);
    // even if Sam asks for Jane's opaque name, he only ever reaches his own (empty) slot
    expect((await request(app).get(`/api/vault/slots/${janeName}`).set(sam.auth)).body.slot).toBeNull();
    expect((await request(app).delete(`/api/vault/slots/${janeName}`).set(sam.auth)).status).toBe(200);
    expect((await request(app).get(`/api/vault/slots/${janeName}`).set(jane.auth)).body.slot.version).toMatch(VERSION);
  });

  it('caps the number of slots per account', async () => {
    const { app } = makeApp();
    const jane = await registerUser(app, 'jane.cap');
    for (let i = 0; i < SLOT_MAX_PER_ACCOUNT; i++) expect((await put(app, jane, `slot-${i}`, { i }, null)).status).toBe(200);
    const over = await put(app, jane, 'one-too-many', {}, null);
    expect(over.status).toBe(409);
    expect(over.body.code).toBe('too_many_slots');
  });

  it('deleting a slot clears it and leaves nothing in the WAL; a stale delete is refused', async () => {
    const dir = tmpDir();
    const { app } = makeApp({ dbPath: path.join(dir, 'matra.db') });
    const wal = path.join(dir, 'matra-drafts.db-wal');
    const jane = await registerUser(app, 'jane.del');
    const first = (await put(app, jane, 'draft', { words: 'first' }, null)).body.version;
    const second = (await put(app, jane, 'draft', { words: 'second' }, first)).body.version;
    // every write is checkpointed out of the WAL, so no earlier version waits there
    expect(fs.statSync(wal).size).toBe(0);
    const name = await slotName(jane.masterKey, 'draft');
    expect((await request(app).delete(`/api/vault/slots/${name}`).set(jane.auth).send({ expectedVersion: first })).body.code).toBe('slot_conflict');
    expect((await request(app).delete(`/api/vault/slots/${name}`).set(jane.auth).send({ expectedVersion: second })).body).toEqual({ ok: true });
    expect((await request(app).get(`/api/vault/slots/${name}`).set(jane.auth)).body.slot).toBeNull();
    expect(fs.statSync(wal).size).toBe(0);
    const onDisk = fs.readFileSync(path.join(dir, 'matra-drafts.db'));
    expect(onDisk.includes(Buffer.from(name))).toBe(false);
  });

  it('account deletion deletes her slots (and empties the drafts WAL); other accounts keep theirs', async () => {
    const dir = tmpDir();
    const { app } = makeApp({ dbPath: path.join(dir, 'matra.db') });
    const jane = await registerUser(app, 'jane.gone');
    const sam = await registerUser(app, 'sam.stays');
    await put(app, jane, 'draft', { words: 'hers' }, null);
    await put(app, jane, 'casecard', { words: 'hers too' }, null);
    await put(app, sam, 'draft', { words: 'his' }, null);
    const del = await request(app).post('/api/account/delete').set(jane.auth).send({ authKey: jane.authKey });
    expect(del.status).toBe(200);
    const slots = getSlots(app).db;
    expect(count(slots, 'SELECT COUNT(*) n FROM slots WHERE owner_id = ?', jane.user.id)).toBe(0);
    expect(count(slots, 'SELECT COUNT(*) n FROM slots WHERE owner_id = ?', sam.user.id)).toBe(1);
    expect(fs.statSync(path.join(dir, 'matra-drafts.db-wal')).size).toBe(0);
  });

  it('on start, removes only the slots of provably deleted accounts (deleted from the main DB, slots left behind)', async () => {
    const dir = tmpDir();
    const dbPath = path.join(dir, 'matra.db');
    const first = makeApp({ dbPath });
    const jane = await registerUser(first.app, 'jane.orphan');
    const gone = await registerUser(first.app, 'gone.orphan');
    await put(first.app, jane, 'draft', { words: 'hers' }, null);
    await put(first.app, gone, 'draft', { words: 'deleted' }, null);
    // an account deletion that stopped between the two files: her rows are gone, the account.shredded entry is written,
    // but her slot is still there (simulated by deleting through the route with the slot store's delete skipped)
    const drafts = getSlots(first.app);
    const keep = drafts.deleteOwner.bind(drafts);
    drafts.deleteOwner = () => {};
    expect((await request(first.app).post('/api/account/delete').set(gone.auth).send({ authKey: gone.authKey })).status).toBe(200);
    drafts.deleteOwner = keep;
    // and an owner nobody can account for (no user row, no deletion record): kept, never guessed at
    drafts.db.prepare(`INSERT INTO slots VALUES ('${'f'.repeat(32)}', '${'a'.repeat(64)}', '{}', '{}', '${'1'.repeat(32)}', '2026-01-01')`).run();
    first.db.close();
    drafts.db.close();
    const logs: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((m: string) => void logs.push(m));
    const warn = vi.spyOn(console, 'warn').mockImplementation((m: string) => void logs.push(m));
    const again = makeApp({ dbPath });
    log.mockRestore();
    warn.mockRestore();
    const s = getSlots(again.app).db;
    expect(count(s, 'SELECT COUNT(*) n FROM slots WHERE owner_id = ?', gone.user.id)).toBe(0);
    expect(count(s, 'SELECT COUNT(*) n FROM slots WHERE owner_id = ?', jane.user.id)).toBe(1);
    expect(count(s, 'SELECT COUNT(*) n FROM slots WHERE owner_id = ?', 'f'.repeat(32))).toBe(1);
    expect(logs.join('\n')).toMatch(/deleted the slots of 1 deleted account/);
    expect(logs.join('\n')).toMatch(/1 account\(s\) with slots are not in the main database and have no deletion record; their slots are kept/);
  });

  it('a drafts file never belongs to another or a brand-new main database: nothing is swept, and production refuses to start', async () => {
    const dir = tmpDir();
    const drafts = path.join(dir, 'drafts.db');
    const first = makeApp({ dbPath: path.join(dir, 'main.db'), draftsDbPath: drafts });
    const jane = await registerUser(first.app, 'jane.bound');
    await put(first.app, jane, 'draft', { words: 'hers' }, null);
    first.db.close();
    getSlots(first.app).db.close();

    // a mistyped MATRA_DB_PATH: a fresh, empty main database with the same drafts file
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const wrong = makeApp({ dbPath: path.join(dir, 'typo-main.db'), draftsDbPath: drafts });
    expect(warn.mock.calls.flat().join(' ')).toMatch(/belongs to a different main database/);
    warn.mockRestore();
    expect(count(getSlots(wrong.app).db, 'SELECT COUNT(*) n FROM slots')).toBe(1);
    wrong.db.close();
    getSlots(wrong.app).db.close();

    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => createApp({ dbPath: path.join(dir, 'typo-main.db'), draftsDbPath: drafts, pepper: TEST_PEPPER })).toThrow(/Refusing to start: the draft-slot file/);
    } finally {
      process.env.NODE_ENV = env;
    }
    // the right main database still opens it, and her slot is there
    const right = makeApp({ dbPath: path.join(dir, 'main.db'), draftsDbPath: drafts });
    expect(count(getSlots(right.app).db, 'SELECT COUNT(*) n FROM slots WHERE owner_id = ?', jane.user.id)).toBe(1);
  });

  it('an unbound drafts file with slots is adopted only if every slot belongs to an account here', async () => {
    const dir = tmpDir();
    const drafts = new (await import('./slots.js')).SlotStore(path.join(dir, 'loose-drafts.db'), 16);
    drafts.put('f'.repeat(32), 'a'.repeat(64), '{}', '{}', null);
    expect(drafts.bind('1'.repeat(32), () => false)).toBe('mismatch');
    expect(drafts.bind('1'.repeat(32), () => true)).toBe('new');
    expect(drafts.bind('1'.repeat(32), () => false)).toBe('bound');
    expect(drafts.bind('2'.repeat(32), () => true)).toBe('mismatch');
    drafts.db.close();
  });

  it('MATRA_DRAFT_MODE=keep-versions also files every save as a record with a ledger entry', async () => {
    const app = createApp({ dbPath: ':memory:', pepper: TEST_PEPPER, draftMode: 'keep-versions' });
    const db = getDb(app);
    const jane = await registerUser(app, 'jane.keep');
    const ledger0 = count(db, 'SELECT COUNT(*) n FROM ledger');
    const versions: Array<string | null> = [null];
    for (let i = 0; i < 3; i++) {
      const res = await put(app, jane, 'draft', { kind: 'draft', words: `v${i}` }, versions[i]!);
      expect(res.body.draftMode).toBe('keep-versions');
      versions.push(res.body.version);
    }
    // a stale write keeps nothing
    expect((await put(app, jane, 'draft', { kind: 'draft', words: 'stale' }, versions[1]!)).status).toBe(409);
    expect(count(db, 'SELECT COUNT(*) n FROM records WHERE owner_id = ?', jane.user.id)).toBe(3);
    expect(count(db, 'SELECT COUNT(*) n FROM ledger')).toBe(ledger0 + 3);
    const list = (await request(app).get('/api/vault/records').set(jane.auth)).body.records as Array<{ id: string }>;
    const opened = await Promise.all(
      list.map(async (r) => {
        const { record } = (await request(app).get(`/api/vault/records/${r.id}`).set(jane.auth)).body;
        return openSlot<{ words: string }>({ envelope: record.envelope, wrappedKey: record.ownerWrappedKey }, jane.masterKey);
      }),
    );
    expect(opened.map((o) => o.words)).toEqual(['v0', 'v1', 'v2']);
    expect((await request(app).get(`/api/vault/slots/${await slotName(jane.masterKey, 'draft')}`).set(jane.auth)).body.draftMode).toBe('keep-versions');
    // sealed records still work alongside
    expect((await createRecord(app, jane)).res.status).toBe(201);
  });

  it('MATRA_DRAFT_MODE: slot by default, keep-versions on request, anything else refused', () => {
    expect(parseDraftMode(undefined)).toBe('slot');
    expect(parseDraftMode('')).toBe('slot');
    expect(parseDraftMode(' Keep-Versions ')).toBe('keep-versions');
    expect(() => parseDraftMode('versions')).toThrow(/MATRA_DRAFT_MODE/);
    expect(draftsDbPathFor('/data/matra.db')).toBe('/data/matra-drafts.db');
    expect(draftsDbPathFor(':memory:')).toBe(':memory:');
  });
});
