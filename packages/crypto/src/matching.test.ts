import { describe, expect, it } from 'vitest';
import { ristretto255_oprf } from '@noble/curves/ed25519.js';
import type { MatchContactBundle, MatchSummaryBundle } from '@matra/shared';
import * as c from './index';

const hex = (h: string) => Uint8Array.from(h.replace(/\s+/g, '').match(/../g)!.map((b) => parseInt(b, 16)));
const toHex = (b: Uint8Array) => c.toHex(b);

// RFC 9497 Appendix A.1 (ristretto255-SHA512)
const SEED = hex('a3'.repeat(32));
const KEY_INFO = hex('74657374206b6579');
const BLIND = '64d37aed22a27f5191de1c1d69fadb899d8862b58eb4220029e036ec4c1f6706';

describe('RFC 9497 test vectors (ristretto255-SHA512)', () => {
  it('OPRF mode, vectors 1 and 2', () => {
    const k = ristretto255_oprf.oprf.deriveKeyPair(SEED, KEY_INFO);
    expect(toHex(k.secretKey)).toBe('5ebcea5ee37023ccb9fc2d2019f9d7737be85591ae8652ffa9ef0f4d37063b0e');
    const vectors = [
      {
        input: '00',
        blinded: '609a0ae68c15a3cf6903766461307e5c8bb2f95e7e6550e1ffa2dc99e412803c',
        evaluated: '7ec6578ae5120958eb2db1745758ff379e77cb64fe77b0b2d8cc917ea0869c7e',
        output: '527759c3d9366f277d8c6020418d96bb393ba2afb20ff90df23fb7708264e2f3ab9135e3bd69955851de4b1f9fe8a0973396719b7912ba9ee8aa7d0b5e24bcf6',
      },
      {
        input: '5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a',
        blinded: 'da27ef466870f5f15296299850aa088629945a17d1f5b7f5ff043f76b3c06418',
        evaluated: 'b4cbf5a4f1eeda5a63ce7b77c7d23f461db3fcab0dd28e4e17cecb5c90d02c25',
        output: 'f4a74c9c592497375e796aa837e907b1a045d34306a749db9f34221f7e750cb4f2a6413a6bf6fa5e19ba6348eb673934a722a7ede2e7621306d18951e7cf2c73',
      },
    ];
    for (const v of vectors) {
      expect(toHex(ristretto255_oprf.oprf.blindEvaluate(k.secretKey, hex(v.blinded)))).toBe(v.evaluated);
      expect(toHex(ristretto255_oprf.oprf.finalize(hex(v.input), hex(BLIND), hex(v.evaluated)))).toBe(v.output);
    }
  });

  it('VOPRF mode, vectors 1 and 2: key derivation, evaluation, proof verification, output', () => {
    const k = ristretto255_oprf.voprf.deriveKeyPair(SEED, KEY_INFO);
    expect(toHex(k.secretKey)).toBe('e6f73f344b79b379f1a0dd37e07ff62e38d9f71345ce62ae3a9bc60b04ccd909');
    expect(toHex(k.publicKey)).toBe('c803e2cc6b05fc15064549b5920659ca4a77b2cca6f04f6b357009335476ad4e');
    expect(toHex(c.oprfPublicKey(k.secretKey))).toBe(toHex(k.publicKey));
    const vectors = [
      {
        input: '00',
        blinded: '863f330cc1a1259ed5a5998a23acfd37fb4351a793a5b3c090b642ddc439b945',
        evaluated: 'aa8fa048764d5623868679402ff6108d2521884fa138cd7f9c7669a9a014267e',
        proof: 'ddef93772692e535d1a53903db24367355cc2cc78de93b3be5a8ffcc6985dd066d4346421d17bf5117a2a1ff0fcb2a759f58a539dfbe857a40bce4cf49ec600d',
        output: 'b58cfbe118e0cb94d79b5fd6a6dafb98764dff49c14e1770b566e42402da1a7da4d8527693914139caee5bd03903af43a491351d23b430948dd50cde10d32b3c',
      },
      {
        input: '5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a',
        blinded: 'cc0b2a350101881d8a4cba4c80241d74fb7dcbfde4a61fde2f91443c2bf9ef0c',
        evaluated: '60a59a57208d48aca71e9e850d22674b611f752bed48b36f7a91b372bd7ad468',
        proof: '401a0da6264f8cf45bb2f5264bc31e109155600babb3cd4e5af7d181a2c9dc0a67154fabf031fd936051dec80b0b6ae29c9503493dde7393b722eafdf5a50b02',
        output: '8a9a2f3c7f085b65933594309041fc1898d42d0858e59f90814ae90571a6df60356f4610bf816f27afdd84f47719e480906d27ecd994985890e5f539e7ea74b6',
      },
    ];
    for (const v of vectors) {
      const out = ristretto255_oprf.voprf.finalize(hex(v.input), hex(BLIND), hex(v.evaluated), hex(v.blinded), k.publicKey, hex(v.proof));
      expect(toHex(out)).toBe(v.output);
      // our server path produces the same evaluated element (the proof is randomized, but must verify)
      const ev = c.oprfBlindEvaluate(k, hex(v.blinded));
      expect(toHex(ev.evaluated)).toBe(v.evaluated);
      expect(toHex(ristretto255_oprf.voprf.finalize(hex(v.input), hex(BLIND), ev.evaluated, hex(v.blinded), k.publicKey, ev.proof))).toBe(v.output);
      // a proof for another element is rejected
      expect(() =>
        ristretto255_oprf.voprf.finalize(hex(v.input), hex(BLIND), hex(vectors[0]!.evaluated === v.evaluated ? vectors[1]!.evaluated : vectors[0]!.evaluated), hex(v.blinded), k.publicKey, hex(v.proof)),
      ).toThrow();
    }
  });
});

describe('threshold sharing and counselor reconstruction', () => {
  const shares = c.splitOprfKey(c.generateOprfKey().secretKey, 2, 3);
  const keys = { t: 2, groupPublicKey: c.combineShareKeysForTest(shares).publicKey, holders: shares };
  const oprf = (canonical: string) => {
    const bl = c.blindMatchIdentifier(canonical);
    return c.finalizeThresholdOprf(bl, keys, shares.slice(1).map((sh) => ({ index: sh.index, ...c.oprfBlindEvaluate(sh, bl.blinded) })));
  };
  const bundle = (name: string): MatchContactBundle => ({
    v: 1,
    identifier: { kind: 'social', canonical: 'instagram:bad_guy' },
    contact: { name, methods: ['text'], phone: '+12015550100' },
    consent: { statement: 'I agree.', at: '2026-10-07T00:00:00.000Z' },
  });
  const survivor = async (pass: string) => (await c.deriveKeys(pass, c.newKdfSalt(), 1000)).masterKey;

  async function setup() {
    const counselorMk = await survivor('counselor');
    const counselor = await c.generateIdentity(counselorMk);
    const priv = await c.unwrapPrivateKey(counselor.wrappedPrivateKey, counselorMk);
    const counselors = [{ userId: 'c1', publicKey: counselor.publicKey }];
    const make = async (mk: CryptoKey, name: string, canonical = 'instagram:bad_guy') => {
      const s = c.derivePerpetratorSecrets(oprf(canonical));
      const x = await c.survivorShareX(mk, s.tag);
      return { s, x, ...(await c.buildMatchEntry({ secrets: s, x, bundle: bundle(name), counselors })) };
    };
    return { priv, pub: counselor.publicKey, make };
  }

  it('same survivor + same person → same tag and same share; different survivors → same tag, different x', async () => {
    const mkA = await survivor('a');
    const mkB = await survivor('b');
    const s1 = c.derivePerpetratorSecrets(oprf('instagram:bad_guy'));
    const s2 = c.derivePerpetratorSecrets(oprf('instagram:bad_guy'));
    expect(s1).toEqual(s2);
    expect(await c.survivorShareX(mkA, s1.tag)).toBe(await c.survivorShareX(mkA, s1.tag));
    expect(await c.survivorShareX(mkA, s1.tag)).not.toBe(await c.survivorShareX(mkB, s1.tag));
    const s3 = c.derivePerpetratorSecrets(oprf('instagram:other'));
    expect(s3.tag).not.toBe(s1.tag);
    expect(await c.survivorShareX(mkA, s3.tag)).not.toBe(await c.survivorShareX(mkA, s1.tag)); // unlinkable across people
  });

  it('reconstructs with 2 shares from distinct survivors, fails with 1 (or 2 from the same survivor)', async () => {
    const { priv, make } = await setup();
    const mkA = await survivor('a');
    const mkB = await survivor('b');
    const ea = await make(mkA, 'A');
    const eb = await make(mkB, 'B');
    expect(ea.tag).toBe(eb.tag);
    const entry = (id: string, e: typeof ea) => ({ entryId: id, seal: e.seals[0]!, bundle: e.bundle });

    const ok = await c.reconstructMatchGroup(ea.tag, [entry('ea', ea), entry('eb', eb)], priv, 'c1');
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.failed).toEqual([]);
      expect(ok.bundles.map((x) => [x.entryId, x.contact?.name])).toEqual([['ea', 'A'], ['eb', 'B']]);
    }
    const one = await c.reconstructMatchGroup(ea.tag, [entry('ea', ea)], priv, 'c1');
    expect(one).toMatchObject({ ok: false, reason: 'too_few_shares' });
    const again = await make(mkA, 'A again');
    const self = await c.reconstructMatchGroup(ea.tag, [entry('ea', ea), entry('ea2', again)], priv, 'c1');
    expect(self).toMatchObject({ ok: false, reason: 'too_few_shares' });

    // one share alone gives no information about the key: a "line" through it and a guessed point fails
    const guess = c.lineThrough({ x: ea.x, y: c.shareY(ea.s, ea.x) }, { x: 1n, y: 12345n });
    expect(guess.intercept).not.toBe(ea.s.intercept);

    // the wrong counselor id / another group's tag cannot open the seal
    await expect(c.openCounselorSeal(ea.seals[0]!, priv, 'c2', ea.tag)).rejects.toThrow();
    await expect(c.openCounselorSeal(ea.seals[0]!, priv, 'c1', 'f'.repeat(64))).rejects.toThrow();
  });

  it('detects a tampered share (Algorithm 1): with 2 entries nothing opens; with 3 the bad one is flagged', async () => {
    const { priv, pub, make } = await setup();
    const [mkA, mkB, mkC] = await Promise.all([survivor('a'), survivor('b'), survivor('c')]);
    const ea = await make(mkA, 'A');
    const eb = await make(mkB, 'B');
    const ec = await make(mkC, 'C');
    // C's share is altered: correct tag and ciphertexts, but y is moved off the line, then re-sealed to the counselor
    const cs = await c.openCounselorSeal(ec.seals[0]!, priv, 'c1', ec.tag);
    const forgedSeal = await c.sealShareToCounselor({ ...cs, y: c.fieldToHex(c.hexToField(cs.y) + 1n) }, { userId: 'c1', publicKey: pub });
    const E = (id: string, seal: (typeof ea.seals)[number], bundle = ea.bundle) => ({ entryId: id, seal, bundle });

    const two = await c.reconstructMatchGroup(ea.tag, [E('ea', ea.seals[0]!), E('ec', forgedSeal, ec.bundle)], priv, 'c1');
    expect(two).toMatchObject({ ok: false, reason: 'could_not_reconstruct' });

    const three = await c.reconstructMatchGroup(
      ea.tag,
      [E('ea', ea.seals[0]!), E('eb', eb.seals[0]!, eb.bundle), E('ec', forgedSeal, ec.bundle)],
      priv,
      'c1',
    );
    expect(three.ok).toBe(true);
    if (three.ok) {
      // the key comes from the (ea, eb) line, whose intercept reproduces the tag; C's ciphertext is authentic, so it
      // opens with K_P — but its point is off the line, which is flagged
      expect(three.failed).toEqual([]);
      expect(three.bundles.map((x) => [x.contact?.name, x.onLine])).toEqual([['A', true], ['B', true], ['C', false]]);
      expect(three.alerts).toContain('off_line_share');
    }

    // a bit-flipped seal or bundle ciphertext is also caught
    const flip = (b64: string) => {
      const u = c.fromBase64(b64);
      u[u.length - 1]! ^= 1;
      return c.toBase64(u);
    };
    const flipped = await c.reconstructMatchGroup(
      ea.tag,
      [
        E('ea', ea.seals[0]!),
        E('eb', eb.seals[0]!, eb.bundle),
        E('ec', { ...ec.seals[0]!, envelope: { ...ec.seals[0]!.envelope, ct: flip(ec.seals[0]!.envelope.ct) } }, ec.bundle),
        E('ed', ec.seals[0]!, { ...ec.bundle, ct: flip(ec.bundle.ct) }),
      ],
      priv,
      'c1',
    );
    expect(flipped.ok && flipped.failed.sort()).toEqual(['ec', 'ed']);
    expect(flipped.ok && flipped.people).toBe(2);
  });
});

// ═════════════ regressions from the adversarial review (scratchpad/review/*.mts) ═════════════

describe('regression decoy.mts (H1): a decoy line under the real tag cannot hide real reports', () => {
  const subtle = globalThis.crypto.subtle;
  const rnd = () => c.mod(BigInt('0x' + c.toHex(globalThis.crypto.getRandomValues(new Uint8Array(40)))));
  const hmacKey = () => subtle.generateKey({ name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
  const bundle = (who: string, canonical = 'email:bad@x.com'): MatchContactBundle => ({
    v: 1,
    identifier: { kind: 'email', canonical },
    contact: { methods: ['email'], email: who },
    consent: { statement: 's', at: '2026-10-07T00:00:00.000Z' },
  });

  async function scenario() {
    const kp = await subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['encrypt', 'decrypt'],
    );
    const counselor = { userId: 'c1', publicKey: await subtle.exportKey('jwk', kp.publicKey) };
    const real = c.derivePerpetratorSecrets(globalThis.crypto.getRandomValues(new Uint8Array(64)));
    const entry = async (id: string, secrets: c.PerpetratorSecrets, who: string, canonical?: string) => {
      const x = await c.survivorShareX(await hmacKey(), secrets.tag);
      const b = await c.buildMatchEntry({ secrets, x, bundle: bundle(who, canonical), counselors: [counselor] });
      return { entryId: id, seal: b.seals[0]!, bundle: b.bundle };
    };
    return { priv: kp.privateKey, real, entry };
  }
  const shown = (r: c.ReconstructResult) => (r.ok ? r.bundles.map((b) => b.contact?.email).sort() : []);

  it('decoy line with a different intercept: rejected in both orders, real reports shown, alert raised', async () => {
    const { priv, real, entry } = await scenario();
    // The perpetrator knows his own identifier, hence the real tag; two Sybil accounts seal a DECOY line under it.
    const decoy = { tag: real.tag, slope: rnd(), intercept: rnd() };
    const A1 = await entry('A1', decoy, 'sybil1@attacker');
    const A2 = await entry('A2', decoy, 'sybil2@attacker');
    const S1 = await entry('S1', real, 'survivor1@real');
    const S2 = await entry('S2', real, 'survivor2@real');
    for (const order of [[A1, A2, S1, S2], [S1, S2, A1, A2], [A1, S1, A2, S2]]) {
      const r = await c.reconstructMatchGroup(real.tag, order, priv, 'c1');
      expect(r.ok).toBe(true);
      expect(shown(r)).toEqual(['survivor1@real', 'survivor2@real']);
      if (r.ok) {
        expect(r.failed.sort()).toEqual(['A1', 'A2']);
        expect(r.alerts).toContain('foreign_line');
        expect(r.people).toBe(2);
      }
    }
  });

  it('decoy line through the real intercept (different slope): every report is shown and flagged', async () => {
    const { priv, real, entry } = await scenario();
    const decoy2 = { tag: real.tag, slope: rnd(), intercept: real.intercept };
    const B1 = await entry('B1', decoy2, 'sybil1');
    const B2 = await entry('B2', decoy2, 'sybil2');
    const S1 = await entry('S1', real, 'survivor1@real');
    const S2 = await entry('S2', real, 'survivor2@real');
    const r3 = await c.reconstructMatchGroup(real.tag, [B1, B2, S1], priv, 'c1');
    expect(shown(r3)).toContain('survivor1@real'); // before the fix, S1 was "failed" and hidden
    expect(r3.ok && r3.alerts).toContain('off_line_share');
    const r4 = await c.reconstructMatchGroup(real.tag, [B1, B2, S1, S2], priv, 'c1');
    expect(shown(r4)).toEqual(['survivor1@real', 'survivor2@real', 'sybil1', 'sybil2']);
    expect(r4.ok && r4.alerts).toContain('multiple_lines');
  });

  it('a duplicated entry is not counted twice (L2), and differing identifiers are flagged (L1)', async () => {
    const { priv, real, entry } = await scenario();
    const S1 = await entry('S1', real, 'survivor1@real');
    const S2 = await entry('S2', real, 'survivor2@real');
    const r = await c.reconstructMatchGroup(real.tag, [S1, S2, { ...S1, entryId: 'S1-dup' }], priv, 'c1');
    expect(r.ok && r.bundles.map((b) => b.entryId)).toEqual(['S1', 'S2']);
    expect(r.ok && r.people).toBe(2);
    expect(r.ok && r.duplicates).toEqual(['S1-dup']);
    expect(r.ok && r.alerts).toContain('duplicate_share');

    const E = await entry('E', real, 'p', 'email:innocent@victim.com');
    const r5 = await c.reconstructMatchGroup(real.tag, [E, S1], priv, 'c1');
    expect(r5.ok && r5.canonicals.sort()).toEqual(['email:bad@x.com', 'email:innocent@victim.com']);
    expect(r5.ok && r5.alerts).toContain('identifier_mismatch');
  });

  it('the tag is bound to the intercept, and K_P / tag use I2OSP(k, 33)', () => {
    const s = c.derivePerpetratorSecrets(new Uint8Array(64).fill(7));
    expect(s.tag).toBe(c.tagFromIntercept(s.intercept));
    expect(c.tagFromIntercept(s.intercept + 1n)).not.toBe(s.tag);
    expect(c.i2osp33(258n)).toEqual(Uint8Array.from([...new Array(31).fill(0), 1, 2]));
    expect(c.i2osp33(c.FIELD_P - 1n)[0]).toBe(1);
  });
});

describe('survivor share x (INFO): dedicated HKDF-derived HMAC key, no fixed-IV AES', () => {
  it('is deterministic per survivor + tag, available from the master key, and refuses keys without one', async () => {
    const k = await c.deriveKeys('pass one', c.newKdfSalt(), 1000);
    const t1 = 'a'.repeat(64);
    expect(await c.survivorShareX(k.masterKey, t1)).toBe(await c.survivorShareX(k.matchKey, t1));
    expect(await c.survivorShareX(k.masterKey, t1)).not.toBe(await c.survivorShareX(k.masterKey, 'b'.repeat(64)));
    const stray = await globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await expect(c.survivorShareX(stray, t1)).rejects.toThrow(/sign in again/);
  });
});

describe('staged release: summary and contact details are sealed apart (W21)', () => {
  const shares = c.splitOprfKey(c.generateOprfKey().secretKey, 2, 3);
  const keys = { t: 2, groupPublicKey: c.combineShareKeysForTest(shares).publicKey, holders: shares };
  const oprf = (canonical: string) => {
    const bl = c.blindMatchIdentifier(canonical);
    return c.finalizeThresholdOprf(bl, keys, shares.slice(0, 2).map((sh) => ({ index: sh.index, ...c.oprfBlindEvaluate(sh, bl.blinded) })));
  };
  const summary = (incident: string): MatchSummaryBundle => ({
    v: 2,
    identifier: { kind: 'phone', canonical: 'phone:+12015550142' },
    states: { incident, survivor: 'NJ' },
    methods: ['text'],
    consent: { statement: 'I agree.', at: '2026-11-11T00:00:00.000Z' },
  });
  async function setup() {
    const mk = (await c.deriveKeys('counselor', c.newKdfSalt(), 1000)).masterKey;
    const id = await c.generateIdentity(mk);
    const priv = await c.unwrapPrivateKey(id.wrappedPrivateKey, mk);
    const counselors = [{ userId: 'c1', publicKey: id.publicKey }];
    const s = c.derivePerpetratorSecrets(oprf('phone:+12015550142'));
    const make = async (who: string, name: string, phone: string) => {
      const x = await c.survivorShareX((await c.deriveKeys(who, c.newKdfSalt(), 1000)).masterKey, s.tag);
      return c.buildMatchEntry({ secrets: s, x, bundle: summary('NY'), contact: { v: 1, name, phone }, counselors });
    };
    return { priv, make, tag: s.tag, counselors };
  }

  it('without the contact ciphertext only the summary opens; with it, the details open too', async () => {
    const { priv, make, tag } = await setup();
    const a = await make('a', 'A', '(555) 010-0100');
    const b = await make('b', 'B', '(555) 010-0300');
    expect(a.contactBundle).toBeDefined();
    // the summary ciphertext holds no contact details at all
    const stage1 = await c.reconstructMatchGroup(tag, [
      { entryId: 'a', seal: a.seals[0]!, bundle: a.bundle },
      { entryId: 'b', seal: b.seals[0]!, bundle: b.bundle },
    ], priv, 'c1');
    expect(stage1.ok).toBe(true);
    if (!stage1.ok) return;
    expect(stage1.bundles.map((x) => x.contact)).toEqual([undefined, undefined]);
    expect(stage1.bundles.map((x) => [x.summary.states, x.summary.methods, x.legacyBundle])).toEqual([
      [{ incident: 'NY', survivor: 'NJ' }, ['text'], false],
      [{ incident: 'NY', survivor: 'NJ' }, ['text'], false],
    ]);
    expect(JSON.stringify(stage1.bundles)).not.toMatch(/010-0/);
    const stage2 = await c.reconstructMatchGroup(tag, [
      { entryId: 'a', seal: a.seals[0]!, bundle: a.bundle, contactBundle: a.contactBundle! },
      { entryId: 'b', seal: b.seals[0]!, bundle: b.bundle, contactBundle: b.contactBundle! },
    ], priv, 'c1');
    expect(stage2.ok && stage2.bundles.map((x) => [x.contact?.name, x.contact?.phone])).toEqual([
      ['A', '(555) 010-0100'],
      ['B', '(555) 010-0300'],
    ]);
  });

  it('a contact ciphertext swapped between entries, or moved from another tag, does not open (AAD and key)', async () => {
    const { priv, make, tag, counselors } = await setup();
    const a = await make('a', 'A', '1');
    const b = await make('b', 'B', '2');
    // swapped: each entry has its own ke, so B's contact does not open under A's key
    const swapped = await c.reconstructMatchGroup(tag, [
      { entryId: 'a', seal: a.seals[0]!, bundle: a.bundle, contactBundle: b.contactBundle! },
      { entryId: 'b', seal: b.seals[0]!, bundle: b.bundle, contactBundle: a.contactBundle! },
    ], priv, 'c1');
    expect(swapped.ok && swapped.bundles.map((x) => [x.contact, x.contactError])).toEqual([
      [undefined, true],
      [undefined, true],
    ]);
    // the same ke, but the contact ciphertext sealed for another tag: the AAD "contact|tag" no longer matches
    const other = c.derivePerpetratorSecrets(oprf('phone:+12015550199'));
    const moved = await c.buildMatchEntry({ secrets: other, x: 7n, bundle: summary('NY'), contact: { v: 1, name: 'X' }, counselors });
    expect(moved.tag).not.toBe(tag);
    const r = await c.reconstructMatchGroup(tag, [
      { entryId: 'a', seal: a.seals[0]!, bundle: a.bundle, contactBundle: moved.contactBundle! },
      { entryId: 'b', seal: b.seals[0]!, bundle: b.bundle },
    ], priv, 'c1');
    expect(r.ok && r.bundles[0]!.contactError).toBe(true);
    // and the summary ciphertext cannot be passed off as the contact one (different AAD label)
    const asContact = await c.reconstructMatchGroup(tag, [
      { entryId: 'a', seal: a.seals[0]!, bundle: a.bundle, contactBundle: a.bundle },
      { entryId: 'b', seal: b.seals[0]!, bundle: b.bundle },
    ], priv, 'c1');
    expect(asContact.ok && asContact.bundles[0]!.contactError).toBe(true);
  });

  it('a legacy v1 bundle still opens: summarised, with its details flagged legacyBundle', async () => {
    const { priv, make, tag, counselors } = await setup();
    const a = await make('a', 'A', '1');
    const s = c.derivePerpetratorSecrets(oprf('phone:+12015550142'));
    const x = await c.survivorShareX((await c.deriveKeys('legacy', c.newKdfSalt(), 1000)).masterKey, s.tag);
    const legacy = await c.buildMatchEntry({
      secrets: s,
      x,
      bundle: {
        v: 1,
        identifier: { kind: 'phone', canonical: 'phone:+12015550142' },
        contact: { name: 'L', methods: ['call'], phone: '9', language: 'es' },
        consent: { statement: 'ok', at: 'now' },
        state: 'NJ',
      },
      counselors,
    });
    const r = await c.reconstructMatchGroup(tag, [
      { entryId: 'a', seal: a.seals[0]!, bundle: a.bundle },
      { entryId: 'l', seal: legacy.seals[0]!, bundle: legacy.bundle },
    ], priv, 'c1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const l = r.bundles.find((b) => b.entryId === 'l')!;
    expect(l.legacyBundle).toBe(true);
    expect(l.summary).toMatchObject({ v: 2, states: { incident: 'NJ' }, methods: ['call'], language: 'es' });
    expect(l.contact).toEqual({ v: 1, name: 'L', phone: '9' });
  });

  it('splitContact keeps methods and language in the summary and everything identifying in the details', () => {
    expect(c.splitContact({ name: 'N', methods: ['text', 'email'], phone: 'p', email: 'e', notes: 'n', language: 'fr' })).toEqual({
      methods: ['text', 'email'],
      language: 'fr',
      details: { v: 1, name: 'N', phone: 'p', email: 'e', notes: 'n' },
    });
  });
});

describe('padding (L5)', () => {
  it('bundles and labels of different lengths encrypt to the same size bucket', async () => {
    expect(c.padJson({ a: 'x' }).length).toBe(1024);
    expect(c.padJson({ a: 'x'.repeat(1500) }).length).toBe(2048);
    expect(JSON.parse(new TextDecoder().decode(c.padJson({ a: 1 })))).toEqual({ a: 1 });
    const s = c.derivePerpetratorSecrets(new Uint8Array(64).fill(1));
    const mk = await c.deriveKeys('p', c.newKdfSalt(), 1000);
    const id = await c.generateIdentity(mk.masterKey);
    const mkBundle = (notes: string): MatchContactBundle => ({
      v: 1,
      identifier: { kind: 'email', canonical: 'email:a@b.co' },
      contact: { methods: ['text'], notes },
      consent: { statement: 's', at: 'now' },
    });
    const counselors = [{ userId: 'c1', publicKey: id.publicKey }];
    const short = await c.buildMatchEntry({ secrets: s, x: 5n, bundle: mkBundle('hi'), counselors });
    const long = await c.buildMatchEntry({ secrets: s, x: 5n, bundle: mkBundle('a much longer note about when to call'), counselors });
    expect(short.bundle.ct.length).toBe(long.bundle.ct.length);
  });
});

describe('counselor roster signing (M4)', () => {
  it('only counselors in the org-signed roster, with the listed key, are sealed to; unsigned/forged rosters are refused', async () => {
    const org = c.generateRosterKey();
    const pin = c.toBase64(org.publicKey);
    const mk = (await c.deriveKeys('p', c.newKdfSalt(), 1000)).masterKey;
    const [k1, k2, k3] = await Promise.all([c.generateIdentity(mk), c.generateIdentity(mk), c.generateIdentity(mk)]);
    const listed = [
      { userId: 'c1', publicKey: k1.publicKey },
      { userId: 'c2', publicKey: k2.publicKey },
    ];
    const roster = c.signCounselorRoster(listed, org.secretKey);
    const profile = (userId: string, publicKey: JsonWebKey) => ({ userId, displayName: userId, jurisdictions: ['NJ'], verified: true, publicKey });
    const config = (counselors: ReturnType<typeof profile>[], r: typeof roster | null = roster) =>
      ({
        threshold: 2,
        oprf: { suite: 'ristretto255-SHA512', mode: 'voprf', t: 2, m: 0, groupPublicKey: '', holders: [] as never[] },
        counselors,
        limits: { perDay: 1, lifetime: 1 },
        keyEpoch: 1,
        ...(r && { roster: r }),
      }) as const;
    // the server adds an unlisted counselor (c3) and swaps c2's key → only c1 survives
    const cfg = config([profile('c1', k1.publicKey), profile('c2', k3.publicKey), profile('c3', k3.publicKey)]);
    expect(c.counselorsToSealTo(cfg, pin).map((x) => x.userId)).toEqual(['c1']);
    expect(() => c.counselorsToSealTo(config([profile('c1', k1.publicKey)], null), pin)).toThrow(/not signed/);
    const forged = { ...roster, payload: roster.payload.replace('"c2"', '"c3"') };
    expect(() => c.counselorsToSealTo(config([profile('c1', k1.publicKey)], forged), pin)).toThrow(/not signed/);
    const other = c.generateRosterKey();
    expect(() => c.counselorsToSealTo(cfg, c.toBase64(other.publicKey))).toThrow(/not signed/);
    // no pinned key (dev): the server's list, with a warning
    expect(c.counselorsToSealTo(cfg).map((x) => x.userId)).toEqual(['c1', 'c2', 'c3']);
  });
});
