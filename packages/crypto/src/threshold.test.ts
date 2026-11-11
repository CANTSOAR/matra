/**
 * Threshold OPRF (threshold.ts): Shamir t-of-m sharing of the RFC 9497 VOPRF key, per-share DLEQ proofs, Lagrange
 * combination in the exponent. The reference is always plain VOPRF under the unsplit key.
 */
import { describe, expect, it } from 'vitest';
import { ristretto255, ristretto255_oprf } from '@noble/curves/ed25519.js';
import type { MatchingConfig } from '@matra/shared';
import * as c from './index';

const Point = ristretto255.Point;
const Fn = Point.Fn;
const toHex = (b: Uint8Array) => c.toHex(b);

/** All k-subsets of xs. */
function subsets<T>(xs: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (xs.length < k) return [];
  const [h, ...rest] = xs;
  return [...subsets(rest, k - 1).map((s) => [h!, ...s]), ...subsets(rest, k)];
}

function deal(t: number, m: number) {
  const key = c.generateOprfKey();
  const shares = c.splitOprfKey(key.secretKey, t, m);
  const cfg = { t, groupPublicKey: key.publicKey, holders: shares.map(({ index, publicKey }) => ({ index, publicKey })) };
  return { key, shares, cfg };
}

/** Plain VOPRF under the unsplit key: the output every t-subset must reproduce. */
function reference(key: c.OprfKeyPair, canonical: string) {
  const bl = c.blindMatchIdentifier(canonical);
  const e = c.oprfBlindEvaluate(key, bl.blinded);
  return toHex(ristretto255_oprf.voprf.finalize(bl.input, bl.blind, e.evaluated, bl.blinded, key.publicKey, e.proof));
}

const evalAll = (shares: c.ShareKey[], bl: c.MatchBlind): c.HolderEvaluation[] =>
  shares.map((s) => ({ index: s.index, ...c.oprfBlindEvaluate(s, bl.blinded) }));

describe('threshold OPRF: any t of m equals the unsplit key', () => {
  for (const [t, m] of [
    [2, 3],
    [3, 5],
  ] as const) {
    it(`${t}-of-${m}: every t-subset gives exactly VOPRF_k(input); the combined share keys are k`, () => {
      const { key, shares, cfg } = deal(t, m);
      expect(toHex(c.combineShareKeysForTest(shares).secretKey)).toBe(toHex(key.secretKey));
      expect(toHex(c.groupKeyFromShares(cfg.holders, t))).toBe(toHex(key.publicKey));
      const want = reference(key, 'instagram:bad_guy');
      const bl = c.blindMatchIdentifier('instagram:bad_guy');
      const evals = evalAll(shares, bl);
      for (const S of subsets(evals, t)) expect(toHex(c.finalizeThresholdOprf(bl, cfg, S))).toBe(want);
      // more than t is fine too (the first t valid by index are used)
      expect(toHex(c.finalizeThresholdOprf(bl, cfg, evals))).toBe(want);
      // a different identifier → a different output
      const bl2 = c.blindMatchIdentifier('instagram:someone_else');
      expect(toHex(c.finalizeThresholdOprf(bl2, cfg, evalAll(shares, bl2).slice(0, t)))).not.toBe(want);
    });

    it(`${t}-of-${m}: t−1 holders cannot evaluate, and t−1 shares do not give k`, () => {
      const { key, shares, cfg } = deal(t, m);
      const bl = c.blindMatchIdentifier('phone:+12015550100');
      const evals = evalAll(shares, bl);
      for (const S of subsets(evals, t - 1)) {
        let err: unknown;
        try {
          c.finalizeThresholdOprf(bl, cfg, S);
        } catch (e) {
          err = e;
        }
        expect(err).toBeInstanceOf(c.ThresholdOprfError);
        expect((err as c.ThresholdOprfError).missing).toBe(1);
        expect((err as c.ThresholdOprfError).badHolders).toEqual([]);
      }
      // Lagrange-combining only t−1 shares (as if they were enough) gives neither k nor the real output
      for (const S of subsets(shares, t - 1)) {
        if (S.length < 2) continue; // lagrangeAt over one index is just that share
        const wrong = c.combineShareKeysForTest(S);
        expect(toHex(wrong.secretKey)).not.toBe(toHex(key.secretKey));
        expect(reference(wrong, 'phone:+12015550100')).not.toBe(reference(key, 'phone:+12015550100'));
      }
      expect(toHex(shares[0]!.secretKey)).not.toBe(toHex(key.secretKey));
    });
  }
});

describe('threshold OPRF: a bad share or proof is rejected and named', () => {
  const { key, shares, cfg } = deal(2, 3);
  const canonical = 'email:x@example.com';
  const want = reference(key, canonical);

  it('a tampered evaluation, a tampered proof, or another share’s key: rejected by index; the other t still work', () => {
    const bl = c.blindMatchIdentifier(canonical);
    const good = evalAll(shares, bl);
    const otherPoint = Point.fromBytes(good[0]!.evaluated).add(Point.BASE).toBytes();
    const flipped = good[1]!.proof.slice();
    flipped[5]! ^= 1;
    const signedByShare1 = { index: 3, ...c.oprfBlindEvaluate(shares[0]!, bl.blinded) }; // holder 3 answers with k_1
    const rogue = { index: 2, ...c.oprfBlindEvaluate(c.generateOprfKey(), bl.blinded) };
    for (const [badIndex, bad] of [
      [1, { ...good[0]!, evaluated: otherPoint }],
      [2, { ...good[1]!, proof: flipped }],
      [3, signedByShare1],
      [2, rogue],
      [1, { index: 1, evaluated: new Uint8Array(0), proof: new Uint8Array(0) }],
    ] as const) {
      const evals = good.map((g) => (g.index === badIndex ? bad : g));
      // with every other holder valid: the output is still right, and the bad holder is still named
      expect(toHex(c.finalizeThresholdOprf(bl, cfg, evals))).toBe(want);
      const report = c.finalizeThresholdOprfReport(bl, cfg, evals);
      expect(toHex(report.output)).toBe(want);
      expect(report.badHolders).toEqual([badIndex]);
      // with only one other valid holder: refused, naming the bad one
      const two = evals.filter((e) => e.index === badIndex || e.index === (badIndex === 1 ? 2 : 1));
      let err: c.ThresholdOprfError | undefined;
      try {
        c.finalizeThresholdOprf(bl, cfg, two);
      } catch (e) {
        err = e as c.ThresholdOprfError;
      }
      expect(err).toBeInstanceOf(c.ThresholdOprfError);
      expect(err!.badHolders).toEqual([badIndex]);
      expect(err!.missing).toBe(1);
    }
  });

  it('a duplicated answer or an unknown index never counts twice', () => {
    const bl = c.blindMatchIdentifier(canonical);
    const [e1, e2] = evalAll(shares, bl);
    expect(() => c.finalizeThresholdOprf(bl, cfg, [e1!, e1!])).toThrow(c.ThresholdOprfError);
    expect(() => c.finalizeThresholdOprf(bl, cfg, [e1!, { ...e2!, index: 9 }])).toThrow(/bad proof from holder 9/);
  });
});

describe('threshold OPRF: key-set checks', () => {
  const { shares, cfg } = deal(2, 3);
  const pks = cfg.holders;
  const identity = Point.ZERO.toBytes();

  it('accepts the dealt set and rejects malformed or degenerate sets', () => {
    expect(() => c.checkThresholdKeys(cfg)).not.toThrow();
    const bad = (holders: typeof pks, t = 2, groupPublicKey = cfg.groupPublicKey) => () => c.checkThresholdKeys({ t, groupPublicKey, holders });
    expect(bad([pks[0]!, { ...pks[1]!, index: 1 }, pks[2]!])).toThrow(/twice/);
    expect(bad([{ ...pks[0]!, index: 0 }, pks[1]!, pks[2]!])).toThrow(/not in 1\.\./);
    expect(bad([pks[0]!, { ...pks[1]!, publicKey: identity }, pks[2]!])).toThrow(/identity/);
    expect(bad([pks[0]!, { ...pks[1]!, publicKey: pks[0]!.publicKey }, pks[2]!])).toThrow(/same public key/);
    expect(bad(pks, 2, identity)).toThrow(/does not match/);
    expect(bad(pks, 2, c.generateOprfKey().publicKey)).toThrow(/does not match/);
    // one share public key replaced by an unrelated key: not on the same polynomial
    expect(bad([pks[0]!, pks[1]!, { ...pks[2]!, publicKey: c.generateOprfKey().publicKey }])).toThrow(/inconsistent/);
    expect(bad(pks, 4)).toThrow(/2 ≤ t ≤ m/);
    expect(bad(pks, 1)).toThrow(/2 ≤ t ≤ m/);
    expect(() => c.splitOprfKey(shares[0]!.secretKey, 3, 2)).toThrow(/2 ≤ t ≤ m/);
    expect(() => c.splitOprfKey(shares[0]!.secretKey, 1, 3)).toThrow(/2 ≤ t ≤ m/);
    expect(() => c.splitOprfKey(shares[0]!.secretKey, 2, 17)).toThrow(/2 ≤ t ≤ m/);
    expect(() => c.splitOprfKey(new Uint8Array(32), 2, 3)).toThrow(/non-zero/);
  });

  it('two holder sets that each look fine but cancel to an identity group key are refused', () => {
    // pk_2 = 2·pk_1 means f(x) = a·x in the exponent: f(0) = identity (the group key would be "no key at all")
    const k1 = Fn.fromBytes(c.generateOprfKey().secretKey);
    const holders = [1n, 2n, 3n].map((i) => ({ index: Number(i), publicKey: Point.BASE.multiply(Fn.mul(k1, i)).toBytes() }));
    expect(() => c.groupKeyFromShares(holders, 2)).toThrow(/identity/);
  });

  it('lagrangeAt: coefficients at 0 sum to 1 and interpolate a known polynomial', () => {
    for (const S of [[1, 2], [1, 3], [2, 3], [1, 2, 3, 4, 5]]) {
      const l = c.lagrangeAt(0n, S);
      expect([...l.values()].reduce((a, b) => Fn.add(a, b), 0n)).toBe(1n);
    }
    // f(x) = 7 + 5x: f(1)=12, f(3)=22 → f(0)=7, f(2)=17
    const at = (x: bigint) => {
      const l = c.lagrangeAt(x, [1, 3]);
      return Fn.add(Fn.mul(l.get(1)!, 12n), Fn.mul(l.get(3)!, 22n));
    };
    expect(at(0n)).toBe(7n);
    expect(at(2n)).toBe(17n);
  });
});

describe('threshold OPRF: client orchestration (matching.ts)', () => {
  const { key, shares, cfg } = deal(2, 3);
  const b64 = c.toBase64;
  const config: MatchingConfig = {
    threshold: 2,
    oprf: {
      suite: 'ristretto255-SHA512',
      mode: 'voprf',
      t: 2,
      m: 3,
      groupPublicKey: b64(cfg.groupPublicKey),
      holders: shares.map((s) => ({ index: s.index, publicKey: b64(s.publicKey) })),
    },
    counselors: [],
    limits: { perDay: 1, lifetime: 1 },
    keyEpoch: 1,
  };
  const pins = { oprf: { t: 2, groupPublicKey: b64(cfg.groupPublicKey), holders: shares.map((s) => b64(s.publicKey)) } };
  const answer = (i: number, req: { blinded: string }) => {
    const e = c.oprfBlindEvaluate(shares[i - 1]!, c.fromBase64(req.blinded));
    return { evaluated: b64(e.evaluated), proof: b64(e.proof) };
  };
  const transport = (evaluate: c.MatchTransport['evaluate']): c.MatchTransport => ({
    config: async () => config,
    evaluate,
    createEntry: async () => {
      throw new Error('not reached');
    },
  });

  it('pins that differ from the served key set, or a served set that is inconsistent, are refused', () => {
    expect(c.matchingOprfKeys(config, pins).t).toBe(2);
    const other = deal(2, 3);
    for (const p of [
      { oprf: { ...pins.oprf, t: 3 } },
      { oprf: { ...pins.oprf, groupPublicKey: b64(other.cfg.groupPublicKey) } },
      { oprf: { ...pins.oprf, holders: [pins.oprf.holders[1]!, pins.oprf.holders[0]!, pins.oprf.holders[2]!] } },
      { oprf: { ...pins.oprf, holders: pins.oprf.holders.slice(0, 2) } },
    ])
      expect(() => c.matchingOprfKeys(config, p)).toThrow(/pinned/);
    // without pins (dev), the served set must still be self-consistent
    const swapped = { ...config, oprf: { ...config.oprf, groupPublicKey: b64(other.cfg.groupPublicKey) } };
    expect(() => c.matchingOprfKeys(swapped)).toThrow(/does not match/);
    const short = { ...config, oprf: { ...config.oprf, m: 4 } };
    expect(() => c.matchingOprfKeys(short)).toThrow(/wrong number/);
  });

  it('one holder down still evaluates; two down → holders_unavailable; a 429 is surfaced; a bad proof names the holder', async () => {
    const keys = c.matchingOprfKeys(config, pins);
    const want = reference(key, 'email:x@example.com');
    const down = (dead: number[], err: () => unknown = () => new Error('connection refused')) =>
      transport(async (i, req) => {
        if (dead.includes(i)) throw err();
        return answer(i, req);
      });
    const bl = c.blindMatchIdentifier('email:x@example.com');
    expect(toHex(await c.evaluateMatchOprf(down([3]), keys, bl))).toBe(want);
    expect(toHex(await c.evaluateMatchOprf(down([1]), keys, bl))).toBe(want);
    await expect(c.evaluateMatchOprf(down([1, 2]), keys, bl)).rejects.toMatchObject({ name: 'MatchingError', code: 'holders_unavailable' });
    const limited = Object.assign(new Error('429 rate_limited_daily'), { status: 429, code: 'rate_limited_daily' });
    await expect(c.evaluateMatchOprf(down([1, 2, 3], () => limited), keys, bl)).rejects.toBe(limited);
    const lying = transport(async (i, req) => (i === 2 ? answer(1, req) : i === 3 ? Promise.reject(new Error('down')) : answer(i, req)));
    const err = await c.evaluateMatchOprf(lying, keys, bl).catch((e) => e);
    expect(err).toBeInstanceOf(c.ThresholdOprfError);
    expect(err.badHolders).toEqual([2]);
    // a lying holder while the other two answer: sealing goes ahead, and the transport is told which holder lied
    const reported: number[][] = [];
    const covered = { ...transport(async (i, req) => (i === 2 ? answer(1, req) : answer(i, req))), onBadHolders: (ix: number[]) => reported.push(ix) };
    expect(toHex(await c.evaluateMatchOprf(covered, keys, bl))).toBe(want);
    expect(reported).toEqual([[2]]);
    // all honest: nothing reported
    const quiet: number[][] = [];
    await c.evaluateMatchOprf({ ...transport(async (i, req) => answer(i, req)), onBadHolders: (ix: number[]) => quiet.push(ix) }, keys, bl);
    expect(quiet).toEqual([]);
  });
});

describe('isOprfElement (app server pre-check before charging the account quota)', () => {
  it('accepts a blinded element; refuses the identity, a non-canonical encoding and a wrong length', () => {
    expect(c.isOprfElement(c.blindMatchIdentifier('email:x@example.com').blinded)).toBe(true);
    expect(c.isOprfElement(new Uint8Array(32))).toBe(false); // identity
    expect(c.isOprfElement(new Uint8Array(32).fill(255))).toBe(false);
    expect(c.isOprfElement(new Uint8Array(31))).toBe(false);
  });
});
