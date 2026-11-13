# Per-submission OPRF evaluation (deferred research note)

*Written 2026-11-11 with the matcher-service feature. Engineering research only; nothing here is legal advice. Status:
**deferred**. The decided default stays one OPRF evaluation per identifier (docs/design/WEEKEND_MVP.md). Citations
marked **[VERIFY]** have not been checked against the source.*

## 1. The gap it would close

Today a survivor's client evaluates the threshold VOPRF once per identifier and derives the tag
τ = HKDF(I2OSP(k_line, 33), "tag") from the output (packages/crypto/src/matching.ts). The output depends only on the
identifier and the OPRF key. So once anyone has evaluated a target's identifier **once** (one unit of one account's
quota), he knows τ, the line's intercept and the per-perpetrator key, and can seal any number of further entries for
that target **from other accounts without calling the OPRF again** (threat model W13: "after one OPRF evaluation the tag
for a target can be reused by more accounts without further evaluations"). The per-account OPRF quota and the phone
gate then bind only the first evaluation, not the Sybil entries that force a match.

What we want: each **submission** needs its own fresh evaluation, so N entries for one target cost N evaluations, each
charged to the account that submits it, while two honest survivors who name the same person still meet.

## 2. Candidate constructions

### 2.1 Partially-oblivious PRF with a public per-epoch input

RFC 9497 defines a third mode beside OPRF and VOPRF: **POPRF**, where the server's evaluation takes a public input
`info` in addition to the blinded private input, and proves it with a DLEQ proof **[VERIFY: RFC 9497 §3.3.3, the
3HashSDHI construction from Tyagi, Celi, Ristenpart, Sullivan, Tessaro, Wood, "A Fast and Simple Partially Oblivious
PRF, with Applications", EUROCRYPT 2022]**. With `info = epoch` (for example the current week), τ becomes
τ_epoch = f(k, identifier, epoch): an evaluation is only useful within its epoch.

- *Effect:* a tag learned in week w is useless in week w+1; Sybil entries have to be re-evaluated every epoch, so the
  quota binds per epoch instead of once.
- *Cost:* entries only match **within the same epoch**. Two survivors who seal months apart never meet unless every
  entry is re-sealed every epoch (her client can do that from her encrypted label, the same way it re-seals after a key
  rotation, but only when she signs in; dormant entries fall out of matching). That is a serious usability and safety
  loss for the use case (survivors often report years apart).
- *Threshold:* POPRF's server key is a scalar too; whether Shamir sharing with Lagrange combination in the exponent
  carries over to 3HashSDHI the way it does for the VOPRF needs a proof, not an assumption. **[VERIFY: threshold
  POPRF; the per-share proof of the `info`-tweaked key]**
- *Library:* `@noble/curves` ships RFC 9497 modes for ristretto255 **[VERIFY: whether its `ristretto255_oprf` exposes
  POPRF]**.

### 2.2 Matcher-side re-randomisation inside the enclave

Keep the client's single evaluation, but stop treating its output as the matching key. The client sends the VOPRF output
(or a value derived from it) sealed to the matcher's attested key; the matcher applies a second keyed PRF held only
inside the enclave, with a per-submission budget enforced there, and derives the tag the app server stores.

- *Effect:* a client can no longer compute τ itself, so it cannot reuse it; every entry has to pass through the matcher,
  which can count submissions per target (it sees each target's pseudonym) and per survivor reference.
- *Cost:* the matcher becomes a single point that sees, for every submission, a stable per-target pseudonym: much more
  trust in the enclave, and the attestation must be real (it is simulated today, W18). The counselor's reconstruction
  also changes: the line and K_P are derived from the client's OPRF output today, so either the matcher must hand the
  client a value to derive them from (and then the client learns something reusable again) or the line moves to
  matcher-derived secrets. It would also put a key in the matcher whose loss breaks every entry.

### 2.3 Rate-limited evaluation tokens

Make each evaluation spend a one-time token issued after the phone gate by a party other than the app server
(Privacy Pass-style anonymous tokens) **[VERIFY: RFC 9576 (architecture) and RFC 9578 (issuance protocols)]**, and
require the app server to present a fresh token with each **entry**, not only with each OPRF call.

- *Effect:* bounds Sybil **entries** per verified phone, and also closes the W14 residual that the app server can mint
  holder-token subjects. It does not stop reuse of τ by itself: the token has to be bound to the entry, so the server
  must refuse an entry whose tag was not produced by an evaluation that spent a token, which again needs the evaluation
  to be per submission (2.1 or 2.2), or a proof linking the entry to a fresh evaluation.
- *Cost:* an issuer at a separate institution, its key management, and a token per entry.

## 3. Why it is deferred

- 2.1 trades away matching across epochs, which is the point of the product (survivors come forward at different
  times). 2.2 concentrates trust in an enclave whose attestation is still simulated. 2.3 needs an independent issuer
  that does not exist yet, and only helps in combination with 2.1 or 2.2.
- The decided weekend-MVP defaults (phone verify-then-forget, release delay, Sybil signals, a counselor's plausibility
  review before any contact, one counselor per group) reduce the harm of a forced match without changing the protocol.
- Changing τ's derivation is a wire-format change: every existing entry has to be re-sealed (a key epoch bump).

## 4. What would bring it back

- Real attestation for the matcher (W18 residual 1), which makes 2.2 credible.
- An independent token issuer (W14 recommended fix), which makes 2.3 possible and helps both other options.
- Evidence from pilots that forced matches are happening despite the phone gate.
- A cryptographic review of threshold POPRF (2.1) or of the matcher-derived line (2.2) before either is built.
