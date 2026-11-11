# Export control and the public crypto code (open question)

*Engineering note, 2026-11-11. No conclusion: this is a question for counsel, tracked as **Q-056** (related: Q-037).
Nothing here says whether any rule applies or what Matra must do.*

## The facts counsel will need

- The repository is public on GitHub under AGPL-3.0-only, with no access restrictions and no fee.
- Encryption-related code in it:
  - `packages/crypto`: AES-256-GCM record encryption, RSA-OAEP-3072 key wrapping, PBKDF2 and HKDF key derivation,
    ECIES on P-256 for routing tags, Ed25519 signatures, a ristretto255 VOPRF with t-of-m
    Shamir threshold shares and DLEQ proofs, the recovery-code wrapping.
  - It uses published libraries (`@noble/curves`, `@noble/hashes` and the browser's WebCrypto); it does not implement
    new primitives.
  - `apps/server` (scrypt for auth hashes, the OPRF key holders), `apps/matcher` (opening routing tags).
- Distribution: the source on GitHub; the built web app served from Matra's own server to anyone who visits; possibly
  app-store builds later (not built). Docker images may be published.
- Contributors may be outside the US.
- The purpose is protecting survivors' records. The software is free; nothing is sold.

## The question (as in Q-056)

Whether this publicly available encryption source code is outside the Export Administration Regulations as
"published", and whether any notification (for example to BIS and the ENC Encryption Request Coordinator) or
classification applies, for the source and separately for compiled or app-store distribution. Q-056 cites the
candidate provisions and marks them [VERIFY].

## Until counsel answers

- Keep doing what the repository already does: publish the source openly. Do not add restrictions or
  notices on our own reading of the rules.
- Before any app-store submission (stores ask an encryption question), get counsel's answer to Q-056 first.
- Record here, with the date, any notice counsel advises sending and any reply. Do not put counsel's advice in this
  public file; it goes in the private decisions file (docs/legal-research/README.md).
