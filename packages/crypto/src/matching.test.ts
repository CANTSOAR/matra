import { describe, expect, it } from 'vitest';
import { ristretto255_oprf } from '@noble/curves/ed25519.js';
import type { MatchContactBundle } from '@matra/shared';
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

describe('split-key VOPRF', () => {
  it('combining two holders equals one evaluation under k_A + k_B, and a bad proof is rejected', () => {
    const a = c.generateOprfKey();
    const b = c.generateOprfKey();
    const sum = c.combineOprfKeys(a, b);
    const canonical = 'instagram:bad_guy';

    const bl = c.blindMatchIdentifier(canonical);
    const ea = c.oprfBlindEvaluate(a, bl.blinded);
    const eb = c.oprfBlindEvaluate(b, bl.blinded);
    const split = c.finalizeSplitOprf(bl, { publicKey: a.publicKey, ...ea }, { publicKey: b.publicKey, ...eb });

    const bl2 = c.blindMatchIdentifier(canonical);
    const es = c.oprfBlindEvaluate(sum, bl2.blinded);
    const single = ristretto255_oprf.voprf.finalize(bl2.input, bl2.blind, es.evaluated, bl2.blinded, sum.publicKey, es.proof);
    expect(toHex(split)).toBe(toHex(single));

    // a different identifier gives a different output; a single holder's key alone gives a different output
    const bl3 = c.blindMatchIdentifier('instagram:someone_else');
    const other = c.finalizeSplitOprf(
      bl3,
      { publicKey: a.publicKey, ...c.oprfBlindEvaluate(a, bl3.blinded) },
      { publicKey: b.publicKey, ...c.oprfBlindEvaluate(b, bl3.blinded) },
    );
    expect(toHex(other)).not.toBe(toHex(split));

    // holder B answers with a key other than its published one → proof fails → client refuses
    const rogue = c.generateOprfKey();
    const bad = c.oprfBlindEvaluate(rogue, bl.blinded);
    expect(() => c.finalizeSplitOprf(bl, { publicKey: a.publicKey, ...ea }, { publicKey: b.publicKey, ...bad })).toThrow();
    expect(() => c.finalizeSplitOprf(bl, { publicKey: a.publicKey, ...ea })).toThrow();
  });
});

describe('normalizers', () => {
  const canon = (kind: Parameters<typeof c.normalizeMatchIdentifier>[0], v: string, p?: string) => {
    const r = c.normalizeMatchIdentifier(kind, v, p);
    return r.ok ? r.canonical : r.reason;
  };
  it('maps profile URLs and handles to one canonical form', () => {
    const ig = [
      ['social_handle', 'https://www.instagram.com/Demo_Handle_123/', undefined],
      ['social_handle', 'instagram.com/demo_handle_123?igsh=abc123', undefined],
      ['social_handle', '@Demo_Handle_123', 'instagram'],
      ['social_handle', 'demo_handle_123', 'Instagram'],
      ['other', 'https://instagram.com/stories/demo_handle_123/31234', undefined],
    ] as const;
    for (const [k, v, p] of ig) expect(canon(k, v, p)).toBe('instagram:demo_handle_123');
    expect(canon('social_handle', 'https://www.instagram.com/p/Cabc123/')).toBe('unrecognized');

    expect(canon('social_handle', 'https://www.facebook.com/profile.php?id=100012345678')).toBe('facebook:id:100012345678');
    expect(canon('social_handle', 'https://facebook.com/people/Some-Name/100012345678/')).toBe('facebook:id:100012345678');
    expect(canon('social_handle', 'https://m.facebook.com/John.Doe.77')).toBe('facebook:johndoe77');
    expect(canon('social_handle', 'johndoe77', 'facebook')).toBe('facebook:johndoe77');
    expect(canon('social_handle', 'https://www.facebook.com/groups/123456')).toBe('unrecognized');

    expect(canon('social_handle', 'https://twitter.com/Bad_Guy')).toBe('x:bad_guy');
    expect(canon('social_handle', 'https://x.com/bad_guy/status/123')).toBe('x:bad_guy');
    expect(canon('social_handle', '@BAD_GUY', 'x')).toBe('x:bad_guy');
    expect(canon('social_handle', 'https://twitter.com/search?q=x')).toBe('unrecognized');

    expect(canon('social_handle', 'https://www.tiktok.com/@Bad.Guy/video/1')).toBe('tiktok:bad.guy');
    expect(canon('social_handle', 'https://www.snapchat.com/add/badguy22')).toBe('snapchat:badguy22');
    expect(canon('social_handle', 'https://www.linkedin.com/in/Jane-Doe-1a2b3c/')).toBe('linkedin:jane-doe-1a2b3c');
    expect(canon('social_handle', 'bad_guy', 'tiktok')).not.toBe(canon('social_handle', 'bad_guy', 'instagram'));
    expect(canon('social_handle', 'someone', 'dating_app')).toBe('unrecognized');
  });

  it('phones to E.164, emails canonical, names refused', () => {
    expect(canon('phone', '(201) 555-0100')).toBe('phone:+12015550100');
    expect(canon('phone', '+1 201 555 0100')).toBe('phone:+12015550100');
    expect(canon('phone', '1-201-555-0100')).toBe('phone:+12015550100');
    expect(canon('phone', '0044 20 7946 0958')).toBe('phone:+442079460958');
    expect(canon('phone', '555-0100')).toBe('unrecognized');
    expect(canon('social_handle', '201 555 0100', 'whatsapp')).toBe('phone:+12015550100');
    expect(canon('email', ' John.Doe+x@GMAIL.com')).toBe('email:johndoe@gmail.com');
    expect(canon('email', 'J.Doe+tag@Example.org')).toBe('email:j.doe@example.org');
    expect(canon('email', 'not an email')).toBe('unrecognized');
    expect(canon('full_name', 'Ryan Smith')).toBe('name_not_unique');
    expect(canon('other', 'someone@example.com')).toBe('email:someone@example.com');
    expect(canon('other', 'tall guy with a beard')).toBe('unrecognized');
    expect(canon('email', '   ')).toBe('empty');
  });
});

describe('threshold sharing and counselor reconstruction', () => {
  const a = c.generateOprfKey();
  const b = c.generateOprfKey();
  const oprf = (canonical: string) => {
    const bl = c.blindMatchIdentifier(canonical);
    return c.finalizeSplitOprf(bl, { publicKey: a.publicKey, ...c.oprfBlindEvaluate(a, bl.blinded) }, { publicKey: b.publicKey, ...c.oprfBlindEvaluate(b, bl.blinded) });
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
      expect(ok.bundles.map((x) => [x.entryId, x.bundle.contact.name])).toEqual([['ea', 'A'], ['eb', 'B']]);
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
      expect(three.failed).toEqual(['ec']);
      expect(three.bundles.map((x) => x.bundle.contact.name)).toEqual(['A', 'B']);
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
  });
});
