/**
 * Threshold OPRF for sealed matching: the RFC 9497 VOPRF key k (ristretto255-SHA512) is Shamir-shared among m
 * independent key holders, and ANY t of them (default 2-of-3) jointly evaluate the matching function. Fewer than t
 * holders learn nothing about k and cannot compute a single tag (W2, W14 in docs/threat-model.md).
 *
 * NOT AUDITED. Standard construction, no new primitives (all group and field arithmetic is @noble/curves):
 *
 *   Sharing  (dealer key ceremony, apps/server/src/oprf-ceremony.ts): k ← random scalar ≠ 0 in the ristretto255 scalar
 *            field F_ℓ. f(x) = k + a_1·x + … + a_{t−1}·x^{t−1} with random a_j. Holder i ∈ {1..m} gets k_i = f(i) and
 *            publishes pk_i = k_i·G; the group key is pk = k·G. The dealer then forgets k and the a_j. (A distributed
 *            key generation, e.g. Pedersen / GJKR, would remove the dealer — future work, see the whitepaper.)
 *   Evaluate (holder i): E_i = k_i·B for the client's blinded element B, with a DLEQ proof π_i that log_G(pk_i) =
 *            log_B(E_i) — exactly RFC 9497 BlindEvaluate under the share k_i (oprfBlindEvaluate, unchanged).
 *   Combine  (client): verify every π_i against the PINNED pk_i (a holder that answers with any other key is
 *            rejected and named); take any t valid responses with index set S; Lagrange coefficients at 0
 *            λ_i = Π_{j∈S, j≠i} j / (j − i) mod ℓ; E = Σ λ_i·E_i = (Σ λ_i·k_i)·B = k·B; then RFC 9497 Finalize(input,
 *            blind, E) = VOPRF_k(input). Every step after Finalize (tag, line, seals) is unchanged.
 *   Key set  (client, from config and build-time pins): 2 ≤ t ≤ m ≤ 16, indices distinct in 1..m, no identity pk_i, pk_i
 *            pairwise distinct, pk ≠ identity, and the pk_i lie on ONE degree-(t−1) polynomial in the exponent whose
 *            value at 0 is pk (interpolate pk from the first t, and check each remaining pk_j). This replaces the
 *            additive scheme's pk_A ≠ pk_B / pk_A + pk_B ≠ 0 checks: a server cannot slip in a share that is not part
 *            of the published key, nor make the group key degenerate.
 *
 * What it does not protect against: any t colluding holders hold k (they can test guessed identifiers offline, as one
 * holder of an unsplit key could). The dealer briefly knows k during the ceremony.
 */
import { ristretto255, ristretto255_oprf } from '@noble/curves/ed25519.js';
import { bytesToNumberLE } from '@noble/curves/utils.js';
import { randomBytes } from '@noble/hashes/utils.js';
import type { MatchBlind, OprfKeyPair } from './matching';

const Point = ristretto255.Point;
const Fn = Point.Fn;
const OPRF = ristretto255_oprf;
type P = InstanceType<typeof Point>;

/** Hard upper bound on m (and so t): keeps every loop tiny and every index a small positive integer. */
export const MAX_OPRF_HOLDERS = 16;

export interface ShareKey { index: number; secretKey: Uint8Array; publicKey: Uint8Array }
export interface HolderEvaluation { index: number; evaluated: Uint8Array; proof: Uint8Array }
export interface ThresholdKeyConfig {
  t: number;
  groupPublicKey: Uint8Array;
  holders: Array<{ index: number; publicKey: Uint8Array }>;
}

/** Fewer than t holders gave a valid, proof-checked evaluation. `badHolders` are the indices whose proof failed. */
export class ThresholdOprfError extends Error {
  constructor(
    message: string,
    readonly badHolders: number[],
    /** how many more valid evaluations were needed */
    readonly missing: number,
  ) {
    super(message);
    this.name = 'ThresholdOprfError';
  }
}

function checkTM(t: number, m: number) {
  if (!Number.isInteger(t) || !Number.isInteger(m) || t < 2 || m < t || m > MAX_OPRF_HOLDERS)
    throw new Error(`OPRF threshold must satisfy 2 ≤ t ≤ m ≤ ${MAX_OPRF_HOLDERS} (got t=${t}, m=${m})`);
}

function checkIndices(indices: number[], max = MAX_OPRF_HOLDERS) {
  const seen = new Set<number>();
  for (const i of indices) {
    if (!Number.isInteger(i) || i < 1 || i > max) throw new Error(`OPRF holder index ${i} is not in 1..${max}`);
    if (seen.has(i)) throw new Error(`OPRF holder index ${i} appears twice`);
    seen.add(i);
  }
}

/** Uniform non-zero scalar: 64 random bytes reduced mod ℓ (bias ≤ 2^-260). */
function randomScalar(): bigint {
  for (;;) {
    const s = Fn.create(bytesToNumberLE(randomBytes(64)));
    if (!Fn.is0(s)) return s;
  }
}

/**
 * Lagrange coefficients λ_i(x) = Π_{j ∈ indices, j ≠ i} (x − j) / (i − j) mod ℓ, for interpolating a polynomial at `x`
 * from its values at `indices`. Indices must be distinct integers in 1..16.
 */
export function lagrangeAt(x: bigint, indices: number[]): Map<number, bigint> {
  checkIndices(indices);
  const out = new Map<number, bigint>();
  for (const i of indices) {
    let num = Fn.ONE;
    let den = Fn.ONE;
    for (const j of indices) {
      if (j === i) continue;
      num = Fn.mul(num, Fn.sub(Fn.create(x), BigInt(j)));
      den = Fn.mul(den, Fn.sub(BigInt(i), BigInt(j)));
    }
    out.set(i, Fn.div(num, den));
  }
  return out;
}

/** Σ λ_i·P_i (points), skipping zero coefficients (only possible when x is one of the indices). */
function combinePoints(lambdas: Map<number, bigint>, points: Map<number, P>): P {
  let acc = Point.ZERO;
  for (const [i, l] of lambdas) if (!Fn.is0(l)) acc = acc.add(points.get(i)!.multiply(l));
  return acc;
}

/**
 * Dealer only (key ceremony): Shamir-share an OPRF secret key among m holders, any t of whom can evaluate. The caller
 * must overwrite `secretKey` afterwards. The polynomial coefficients exist only inside this call.
 */
export function splitOprfKey(secretKey: Uint8Array, t: number, m: number): ShareKey[] {
  checkTM(t, m);
  const k = Fn.fromBytes(secretKey);
  if (Fn.is0(k)) throw new Error('OPRF secret key must be non-zero');
  for (;;) {
    const coeffs = [k, ...Array.from({ length: t - 1 }, randomScalar)];
    const shares: ShareKey[] = [];
    for (let i = 1; i <= m; i++) {
      // Horner: f(i) = (((a_{t−1}·i + a_{t−2})·i + …)·i + k
      let y = Fn.ZERO;
      for (let j = coeffs.length - 1; j >= 0; j--) y = Fn.add(Fn.mul(y, BigInt(i)), coeffs[j]!);
      if (Fn.is0(y)) break; // a zero share (probability ~m/ℓ) would be an identity public key: deal again
      const sk = Fn.toBytes(y);
      shares.push({ index: i, secretKey: sk, publicKey: Point.BASE.multiply(y).toBytes() });
    }
    coeffs.fill(0n);
    if (shares.length === m) return shares;
  }
}

/**
 * The group public key pk = k·G, interpolated in the exponent from the first t share public keys; every further share
 * public key must lie on the same polynomial. Throws if the set is inconsistent, degenerate or malformed.
 */
export function groupKeyFromShares(shares: Array<{ index: number; publicKey: Uint8Array }>, t: number): Uint8Array {
  checkTM(t, shares.length);
  checkIndices(shares.map((s) => s.index));
  const pts = new Map<number, P>();
  for (const s of shares) {
    const p = Point.fromBytes(s.publicKey); // throws on a non-canonical encoding
    if (p.is0()) throw new Error(`OPRF holder ${s.index} public key is the identity`);
    for (const [j, q] of pts) if (q.equals(p)) throw new Error(`OPRF holders ${j} and ${s.index} use the same public key`);
    pts.set(s.index, p);
  }
  const base = shares.slice(0, t).map((s) => s.index);
  const pk = combinePoints(lagrangeAt(0n, base), pts);
  if (pk.is0()) throw new Error('OPRF group public key is the identity');
  for (const s of shares.slice(t)) {
    const expected = combinePoints(lagrangeAt(BigInt(s.index), base), pts);
    if (!expected.equals(pts.get(s.index)!))
      throw new Error(`OPRF holder ${s.index} public key is not a share of the same key as the others (inconsistent key set)`);
  }
  return pk.toBytes();
}

/** Client: refuse a key configuration that is malformed, degenerate or inconsistent with its group key. */
export function checkThresholdKeys(cfg: ThresholdKeyConfig): void {
  const pk = groupKeyFromShares(cfg.holders, cfg.t);
  if (!Point.fromBytes(cfg.groupPublicKey).equals(Point.fromBytes(pk)))
    throw new Error('OPRF group public key does not match the holders’ share public keys');
}

/**
 * Client: verify each holder's DLEQ proof against its own (pinned) share public key, combine any t valid evaluations
 * with Lagrange coefficients in the exponent, and RFC 9497 Finalize. Returns the 64-byte output VOPRF_k(input).
 * Throws ThresholdOprfError (naming every holder whose proof failed) if fewer than t evaluations are valid.
 */
export function finalizeThresholdOprf(b: MatchBlind, cfg: ThresholdKeyConfig, evals: HolderEvaluation[]): Uint8Array {
  checkThresholdKeys(cfg);
  const pkOf = new Map(cfg.holders.map((h) => [h.index, h.publicKey]));
  const valid = new Map<number, P>();
  const bad: number[] = [];
  for (const e of evals) {
    const pk = pkOf.get(e.index);
    if (!pk || valid.has(e.index)) {
      bad.push(e.index); // unknown holder, or a second answer for the same index
      continue;
    }
    try {
      // voprf.finalize verifies the DLEQ proof against pk_i (and throws if it fails); its output is discarded.
      OPRF.voprf.finalize(b.input, b.blind, e.evaluated, b.blinded, pk, e.proof);
      valid.set(e.index, Point.fromBytes(e.evaluated));
    } catch {
      bad.push(e.index);
    }
  }
  if (valid.size < cfg.t)
    throw new ThresholdOprfError(
      `need ${cfg.t} valid OPRF evaluations, got ${valid.size}` + (bad.length ? ` (bad proof from holder ${bad.join(', ')})` : ''),
      bad,
      cfg.t - valid.size,
    );
  const S = [...valid.keys()].sort((x, y) => x - y).slice(0, cfg.t);
  const E = combinePoints(lagrangeAt(0n, S), valid);
  // RFC 9497 Finalize is mode-independent (unblind + Hash(len‖input‖len‖element‖"Finalize")); the blinded element was
  // built with the VOPRF-mode hash-to-group, so this equals VOPRF_k(input).
  return OPRF.oprf.finalize(b.input, b.blind, E.toBytes());
}

/** TESTS ONLY: reconstruct k from shares (interpolation at 0). Never computed in production: no party holds t shares. */
export function combineShareKeysForTest(shares: ShareKey[]): OprfKeyPair {
  const lambdas = lagrangeAt(0n, shares.map((s) => s.index));
  let k = Fn.ZERO;
  for (const s of shares) k = Fn.add(k, Fn.mul(lambdas.get(s.index)!, Fn.fromBytes(s.secretKey)));
  const secretKey = Fn.toBytes(k);
  return { secretKey, publicKey: Fn.is0(k) ? Point.ZERO.toBytes() : Point.BASE.multiply(k).toBytes() };
}
