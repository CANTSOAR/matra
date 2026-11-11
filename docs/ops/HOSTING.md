# Hosting: confidential computing for the matcher and key holders

*Engineering comparison, 2026-11-11. Provider facts are from memory of public documentation and are marked
**[VERIFY]** where they matter: check each against the provider's current documentation before relying on it. Prices
are not given; get quotes. Legal questions raised by who hosts what are open in the research bank: **Q-040**
(co-administering organizations as custodians), **Q-041** (public universities as key holders), **Q-039** (demands to
Matra or its hosts), **Q-044** (outside approvers).*

Decided direction: a US confidential-computing provider; the matcher is public code in an enclave that attests which
code it runs; the OPRF key is split t-of-m across separate institutions; the app host stores ciphertext and the
minimum metadata.

**What exists in code today:** the matcher's attestation is **simulated** (`apps/matcher/src/attestation.ts`: a dev
Ed25519 "platform" key signs the source measurement). `MATRA_ATTESTATION=nitro` and `confidential-space` are
placeholders that refuse to start. None of the providers below has been tried. Nothing on this page is built.

## 1. What runs where

| Component | Holds | Needs an enclave? |
|---|---|---|
| App server (`apps/server`) | Ciphertext of every record, file, share, seal and contact bundle; account metadata in clear (§4); OPRF tags | No for confidentiality of content (it is already ciphertext). It is the operator's, so an enclave would not remove the operator from it (W4: the operator also serves the web app) |
| Matcher (`apps/matcher`) | Tags, entry times, account-creation hours, incident and survivor **states in clear**, the routing key | **Yes.** This is the only place routing states are readable (W18). The point is that the operator cannot read them or change the routing code unseen |
| OPRF key holders (`npm run -w @matra/server holder`) | One Shamir share each; per-subject quotas | **Separation first, enclave second.** The protection is that t different institutions must cooperate (W14). An enclave per holder adds protection against that institution's own admins and lets a holder prove what code answers |
| Web app | Built bundle | No: it runs on her device. Integrity is a build-hash problem (W4, DEPLOY_GOVERNANCE.md §4) |

## 2. Provider comparison (matcher, and optionally holders)

| | AWS Nitro Enclaves | GCP Confidential Space | Azure confidential containers (ACI) |
|---|---|---|---|
| Isolation | An isolated VM carved from an EC2 parent instance by the Nitro hypervisor; no network, no persistent storage, no interactive access; talks to the parent over vsock [VERIFY] | A hardened container image on a Confidential VM (AMD SEV-SNP or Intel TDX memory encryption); the workload operator cannot SSH in or change the image [VERIFY] | Container group in a utility VM with AMD SEV-SNP memory encryption, plus an enforced container policy [VERIFY] |
| Who must be trusted | AWS (hypervisor-based isolation; memory is not encrypted against AWS itself) [VERIFY] | Google's attestation service and the CPU vendor (AMD / Intel) | Microsoft Azure Attestation and AMD |
| Attestation format | CBOR / COSE_Sign1 document signed by the Nitro Hypervisor, chain to the AWS Nitro root certificate; PCR0 (image), PCR1 (kernel), PCR2 (application), PCR3 (IAM role), PCR8 (signing cert); can carry a public key and nonce [VERIFY] | OIDC JWT from Google Cloud Attestation with claims incl. the container image digest and image signatures, the hardware type, and a nonce / audience [VERIFY] | JWT from Microsoft Azure Attestation over the SEV-SNP report; the report's host data field carries the hash of the confidential computing enforcement (CCE) policy, which lists image layers and allowed commands [VERIFY] |
| How it maps to our `measure` | PCR0 = hash of the enclave image (EIF) built from a Docker image of the measured source. Publish both our source measurement and PCR0, plus the recipe that turns one into the other | Image digest of a container built from the measured source. Closest to our existing Dockerfile | CCE policy hash, generated from the container image(s). Publish the policy file too |
| Key release on attestation | AWS KMS key policy conditions on the recipient's attestation (image SHA-384 / PCRs); KMS encrypts the answer to the enclave's ephemeral key [VERIFY] | Workload Identity Federation pool whose attribute conditions check the image digest, then Cloud KMS or Secret Manager [VERIFY] | Azure Key Vault (Premium or Managed HSM) Secure Key Release, policy on the attestation claims [VERIFY] |
| Fit with our code | The matcher already rebuilds its state from the app server at startup (in-memory DB by default), which suits an enclave with no disk. Needs a vsock proxy for HTTP in and out, and a client-side verifier for COSE / CBOR | Runs our container almost as is; a verifier for a JWT (JWKS from Google) is the smallest client change. Needs persistent state handled by re-sync, as today | Runs our container; preview-era tooling has changed often [VERIFY] |
| Ops burden | Highest: EIF builds, vsock plumbing, a parent instance to run and patch | Lowest: deploy an image to a Confidential VM template; Google maintains the base image | Medium: policy generation tooling; service maturity to check |
| Cost notes | No separate enclave charge; you pay for the parent EC2 instance, whose vCPUs and memory are split with the enclave [VERIFY] | Confidential VM premium over a regular VM [VERIFY] | Confidential container pricing above standard ACI [VERIFY] |

## 3. Recommendation

**GCP Confidential Space for the matcher**, with AWS Nitro Enclaves as the fallback.

- It runs our existing container with the least new code, and its attestation names the image digest directly, which
  maps cleanly onto "publish the measurement, pin it in the web build" (DEPLOY_GOVERNANCE.md §4).
- Its model separates the *workload operator* (Matra) from the *data and key owners*, which is the separation we want:
  the matcher's routing key is released by KMS only to the published image digest, so Matra cannot get the key out
  by running different code.
- Memory encryption (SEV-SNP / TDX) protects against the cloud host as well as against Matra; Nitro's isolation is
  against the parent instance, with AWS trusted [VERIFY].
- Nitro is a strong fallback with the most mature attestation documents; choose it if a partner institution is
  already on AWS or if Confidential Space availability or price does not work.

**Key holders:** each institution runs its own holder on infrastructure **it** controls (its own cloud account or
data center), so no single provider or admin can reach t shares. A Confidential Space or Nitro holder is better and
should be offered as the default recipe, but the pilot should not depend on every holder running an enclave. Each
holder keeps its share on its own KMS, never in the app server's account.

**App server:** an ordinary US host is acceptable for the pilot (its data is ciphertext plus the metadata in §4); a
Confidential VM is a cheap extra layer against the host but does not protect against Matra.

Before choosing, verify every [VERIFY] above, get prices, and have the matcher verifier and key release reviewed as
part of the security audit (GOVERNANCE.md §5.1).

### Work needed to make it real

1. A real attester / verifier pair in `apps/matcher/src/attestation.ts` and the web client for the chosen platform
   (replacing `UnimplementedAttester`), with tests on recorded attestation documents.
2. Reproducible matcher image build; publish source measurement + platform measurement per release.
3. Matcher routing key released by KMS on attestation (not `MATRA_MATCHER_KEY` in the environment).
4. Holder recipe for the same platform, with the share in the institution's KMS.

## 4. What stays ciphertext-only, and what does not

On the **app host** (full list: [PRIVACY_DATA_INVENTORY.md](../PRIVACY_DATA_INVENTORY.md)):

- **Ciphertext the server cannot open:** records, evidence files, share and release keys, seals, contact bundles and
  contact details, her labels, counselor notes, routing states (sealed to the matcher), wrapped private and account
  keys.
- **Keyed or hashed, not reversible without a key:** OPRF tags (need t shares), phone tokens (need
  `MATRA_PHONE_HASH_KEY`), auth and recovery hashes (scrypt), session token hashes.
- **In clear (metadata):** usernames, roles, creation times, record sizes (not padded yet, W11), share metadata and
  consent text, aliases she chose for attorneys, audit rows, ledger hashes and times, attorney and counselor directory
  entries, staged-release requests and answers.

So "the app host stores only ciphertext" is **not** accurate today; "the app host stores no plaintext of her story,
files or identifiers, and only the metadata listed in the inventory" is.

In the **matcher enclave:** routing states in clear inside the enclave's memory and its database (W18); in a real
enclave that database would need to be encrypted under a key released on attestation, or rebuilt from the app server
at startup as it is today.

## 5. Edge logs (keeping the W11 promise)

Matra's code writes no IP addresses or user agents. The host's edge usually does. For whichever host is chosen:

- **Load balancer / edge access logs:** turn off, or set the shortest retention allowed. Examples to check: AWS ALB
  access logs are opt-in to S3 [VERIFY]; GCP HTTP(S) load balancer logging is per backend service and can be disabled
  or sampled at 0 [VERIFY]; Cloud Run writes request logs with the remote IP to Cloud Logging by default, which needs an
  exclusion filter on the `_Default` sink [VERIFY]; Render: unknown whether edge logs can be turned off (DEPLOY.md).
- **Platform audit logs** (who deployed, who read secrets) stay **on**: they are about the operator, not survivors.
- **No log drains** to third parties; no CDN or WAF that logs IPs unless its retention is known and stated.
- Record in the deployment config what the host keeps and for how long, and say so in the privacy notice if it cannot
  be turned off.

## 6. Open legal questions this choice touches

Linked, not answered: Q-040 (each host or co-administrator as a custodian that can be served), Q-041 (public
universities as holders), Q-039 (what a host must produce, and gag orders), Q-055 (breach notice when only ciphertext
leaks). Export control of the published crypto code is a separate note: [EXPORT_CONTROL.md](EXPORT_CONTROL.md).
