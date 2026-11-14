# Matra MVP: status and gap list

*First assessed 2026-10-07 at commit `74f2a51`. Updated 2026-11-11 for branch `weekend-mvp` (§0 below; not merged to `main`, not pushed). Written for the founder.*

## Verdict

**As a demo for outreach: strong.** As a product that real survivors can use: **not yet, and the blockers are mostly not code.**

It is well above a typical student MVP. The full survivor-to-attorney loop works end to end in a real browser. The crypto is standard WebCrypto, not home-made. The legal and security docs are unusually honest, and that honesty is the best credibility asset in outreach. What's missing is the external validation that only other people can give: advocates, counsel, an auditor, a fiscal sponsor and a pilot partner. That's why outreach is the critical path now, not more features.

| Area | Grade | Why |
|---|---|---|
| Core flow (story space → vault → PDF → share → revoke → sealed match → counselor) | **A-** | Built and covered by Playwright scenarios (13 on weekend-mvp, incl. phone verification, staged release and recovery code) (dump-first story, interview mode, evidence, summary/export, sharing, revocation, sealed match with the counselor portal, Quick Exit, sign-in errors) against both the dev and production builds, plus an opt-in on-device voice test |
| Crypto design | **B** | Sound primitives (AES-256-GCM, RSA-OAEP-3072, PBKDF2 600k). Known gaps W2–W5 and W12 are documented. *weekend-mvp:* threshold OPRF (ristretto255, Shamir, DLEQ via `@noble`), ECIES routing, recovery code; `packages/crypto` now has 191 unit tests including tamper, wrong-key and t−1-shares-fail cases |
| Server | **B** | Express + SQLite, append-only ledger enforced by triggers, rate limits on register and login, strict CSP in production |
| Trauma-informed UX | **B / unvalidated** | Skip-anything, Quick Exit, triple-Esc, 15-minute idle lock, 18+ gate. **No advocate has reviewed the script yet**, which is the single biggest credibility gap |
| Legal posture | **B+ research / F review** | Excellent memo. Zero review by licensed counsel |
| Ops readiness | **D+** | No hosted demo URL, no entity, no legal-request policy, no audit, no CI. *weekend-mvp:* drafts in [ops/](ops/): incident-response plan (pending counsel), n-of-m deploy governance (proposed, not configured), hosting comparison (nothing provisioned), export-control question |
| Escrow (matching) | **C+, demo-only** | Survivor self-probing is closed. *weekend-mvp* (details in §0): 2-of-3 threshold OPRF with separate holder processes, phone verify-then-forget, a separate matcher routing each group to one counselor by state, counselor-first staged release. Still demo-only: the operator can test guessed identifiers in both holder modes (W2, W14), attestation is simulated (W18), the contact gate is server-side (W21), phones are friction, not Sybil resistance (W13, W19). Correctly kept off for any pilot |

## 0. Branch `weekend-mvp` (2026-11-11): what shipped

Plan: [design/WEEKEND_MVP.md](design/WEEKEND_MVP.md) (with a Deviations section per feature). Every feature below was
committed with typecheck, unit tests and e2e green, then fixed after an adversarial review (the "review fixes"
commits). Threat-model rows: [threat-model.md](threat-model.md).

| Feature | What it does | What is simulated, mocked or still open |
|---|---|---|
| Flaky e2e scenario 2 | Fixed a race between the evidence draft save and reopening her story (`foldInLateEvidence`) | — |
| Threshold OPRF (W2, W14) | The OPRF key is a t-of-m Shamir key (default 2-of-3) with per-share DLEQ proofs, combined on her device; each holder can run as its own process with its own quota DB; account-level budget; holder tokens; key rotation via `MATRA_OPRF_ROTATE` | The dealer briefly knows the whole key (no DKG). In-process mode gives the operator every share; in remote mode the operator holds the holder-token key, so holders turn an offline guessing attack into an observable online one, they don't stop it. Holders aren't at separate institutions yet |
| SMS verify-then-forget (W13, W19) | A phone must be confirmed by SMS before sealed matching; at most 2 accounts per phone; only a keyed hash with no account id is kept; VoIP refusal and anti-pumping caps | Demos run a **mock** SMS provider that verifies nothing; the Twilio Verify adapter is untested against the real service. Friction, not Sybil resistance. The SMS provider sees numbers (Q-013) |
| Separate matcher (W15, W18) | `apps/matcher` assigns each matched group to ONE counselor, licensed where it happened, else where a survivor lives, from routing states sealed to the matcher; counselors can decline (conflict) | Attestation is **simulated**: a dev key signs a hash of the matcher's own source. It shows the protocol, not hardware assurance. Real platforms are placeholders that refuse to start ([ops/HOSTING.md](ops/HOSTING.md)) |
| Staged release (W1, W21) | The counselor first sees the identifier, states and contact methods; contact details after she records a conflict check; a full report only with that survivor's yes, wrapped to the counselor's key on her device; every step ledgered | The contact gate is a server gate, not a cryptographic one (W21) |
| Metadata minimization (W11) | No IPs or user agents in the DB, WAL, ledger or logs; daily-salted in-memory rate-limit keys; route-only request logs; expired sessions swept; web build audited for third-party requests; [data inventory](PRIVACY_DATA_INVENTORY.md) | Size padding, encrypted alias and the host's edge logs are not done |
| Recovery code (W20) | An optional code only she holds (shown once) can set a new passphrase; the server stores only a scrypt hash and wrapped keys and cannot reset anyone | Shamir recovery with trusted people is later. Doesn't fix W5 (passphrase still PBKDF2) |
| Ops docs | [Deploy governance](ops/DEPLOY_GOVERNANCE.md) (n-of-m approvals, signed tags, published hashes, emergency path), [incident response](ops/INCIDENT_RESPONSE.md) (**draft pending counsel**, plans as if a ciphertext-only leak may need notice: Q-055), [hosting](ops/HOSTING.md) (Nitro vs Confidential Space vs Azure; recommends Confidential Space for the matcher), [export control](ops/EXPORT_CONTROL.md) (question only: Q-056) | Process proposed, nothing configured: no branch protection, no CI, no approver organizations yet |
| Demo stack | `npm run demo` starts all five processes (3 key holders, matcher, app server) plus the web app, in production mode with `MATRA_DEMO_MODE=1`; `npm run demo:reset` makes fresh demo keys and seeds fictional accounts through the real API (a NY/NJ matched group, a survivor who said no to matching, a story already shared with an attorney, counselors licensed in NY, NJ and PA). The **Server view** (`/inspector`, dev and demo builds only) shows what every process holds and received next to what was typed; `e2e/demo-stack.spec.ts` runs the whole demo path on that stack | Everything on one laptop: all three key shares, the roster key and the "platform" key sit side by side, which no real deployment allows. The Server view is unauthenticated (refused in production unless demo mode). Walkthroughs: [demo/TECH_DEMO.md](demo/TECH_DEMO.md), [demo/LAWYER_DEMO.md](demo/LAWYER_DEMO.md) and slide *content* in [demo/LAWYER_SLIDES.md](demo/LAWYER_SLIDES.md) (no built deck yet). The "break it" moments (a holder stopped, the matcher changed) are not e2e-tested: rehearse them |
| Signed attorney directory (W3) | The org key that signs the counselor roster also signs each verified attorney's name and key fingerprint (`sign-roster`, or `verify-attorney` given the key); her app checks the attorney's key against it and shows *"Verified by Matra: this key belongs to …"*. The manual fingerprint call is gone: the fingerprint is an optional, collapsed *Check it yourself* detail. A swapped key or unsigned directory turns sharing off. The demo signs and pins it | Trust moves to the org signing key and its vetting (W7); no transparency log yet; unpinned builds trust the server (labelled *Development version*). The counselor report-request screen still asks for a by-hand comparison in unpinned builds |
| In-browser verification (W10, W22) | The attorney's case view shows a **Verification** panel in plain language ("This account has not changed since it was sealed on …", "3 of 3 evidence files match", "Ledger chain intact through entry N"), computed in the browser, with technical details folded underneath. **Check a file** (`/verify`, public, linked from the attorney portal, her Home and the PDF) takes the summary PDF and evidence files, hashes them locally and checks them against the ledger; the PDF carries machine-readable verification data and its *How to verify* leads with that page (manual method kept as an appendix). New public `POST /api/ledger/proof`: exact sealed-content hashes only, bare chain links, rate-limited, nothing stored | The PDF itself is not signed: the checker can't read the account, so it checks the files and the sealed record, not the printed words (the attorney portal does). Ledger head still not anchored externally (W10) |
| Research note | [design/PER_SUBMISSION_OPRF.md](design/PER_SUBMISSION_OPRF.md): per-submission OPRF evaluation (would close part of W13), deferred | Not built |
| Legal research bank | 14 tech-adjacent questions researched and citation-checked (memo-ready), some sources still [VERIFY] | Research, not advice; nothing reviewed by counsel |

**Not built on this branch yet:** a built slide deck (the slide content is Markdown in
[demo/LAWYER_SLIDES.md](demo/LAWYER_SLIDES.md)); a hosted demo URL; CI. `docs/DEMO_SCRIPT.md` has the new setup,
accounts, matching section and a Server view section.

### Verification run on 2026-11-11 (`weekend-mvp`, final check after the walkthrough docs)

- `npm run typecheck`: clean across all workspaces.
- `npm test`: **591 passing, 1 skipped** (crypto 191, matcher 30, server 146, web 224 + 1 skipped). On the first run one
  web test (`DeleteAccount.test.tsx`, the redirect after deleting) failed under full-suite load and passed alone and on
  two more full runs; its wait was raised from 1 s to 15 s.
- `npm run e2e`: default suite **12 passed, 1 skipped** (voice), demo stack **5 passed**. The demo stack logs one
  harmless `matcher sync (roster) failed: ... 400` at startup, before the seed has stored the signed roster; the next
  sync succeeds.
- `MATRA_DEMO_MODE=1 npm run build` (web audit ok) and `npm run e2e:prod`: **12 passed, 1 skipped**, on two runs.
- `npm run demo:reset` then `npm run demo`: all five processes and the web app answer (`/api/health`, matcher
  `/v1/health` with `platform: simulated`, holders 1 to 3, `/` and `/inspector`). Smoke only: the click path was not
  walked by hand (the demo-stack e2e walks it).

### Verification run on 2026-11-11 (`weekend-mvp`, demo commit)

- `npm run typecheck`: clean across all workspaces.
- `npm test`: **591 passing, 1 skipped** (crypto 191, matcher 30, server 146, web 224 + 1 skipped).
- `npm run e2e`: default suite **12 passed, 1 skipped** (voice), then the demo stack (`e2e/demo-stack.spec.ts`) **5 passed**.
- `MATRA_DEMO_MODE=1 npm run build && npm run e2e:prod`: **12 passed, 1 skipped**. Scenario 1 failed once on a heavily
  loaded machine and passed on the next two runs with no change (noted as a possible flake).

### Verification run on 2026-11-11 (`weekend-mvp`, before the ops-docs commit)

- `npm run typecheck`: clean across all workspaces.
- `npm test`: **582 passing, 1 skipped** (crypto 191, matcher 28, server 140, web 223 + 1 skipped).
- `npm run e2e`: **12 passed, 1 skipped** (the on-device voice test, skipped unless built with `MATRA_VOICE_HARNESS=1`), first run, no retries. `e2e:prod` was not rerun.

### Verification run on 2026-10-07

- `npm run typecheck`: clean across all 4 workspaces.
- `npm test`: 94 passing, 1 skipped (crypto 2, shared/server 26, web 66).
- Later the same day, after the story space, on-device voice and counselor portal landed: `npm run e2e:prod` **9/9 passed** (voice test skipped unless built with `MATRA_VOICE_HARNESS=1`; it passes on both the CPU and the opt-in WebGPU path).
- `npm run e2e` (morning run): **8/8 passed** on the second run. The first run failed on scenario 2 (evidence/EXIF) and the 6 tests after it didn't run. The rerun passed with no code changes, so treat scenario 2 as **flaky**. *Fixed 2026-11-11 (see item 4 below).*

## What it still needs, in order

### 1. Before you send outreach (days, you can do it alone)

1. **A hosted demo URL.** Every template has a `[demo link]` placeholder, and "clone the repo and run npm" loses most non-engineers. `render.yaml` and the Dockerfile exist: deploy with `MATRA_DEMO_BANNER=1` and seeded fictional accounts, then put the URL in the one-pager, deck and signature.
2. ~~**Settle the "no AI" claim against the new story flow.**~~ *Fixed 2026-10-07.* The dump-first story space has shipped with on-device voice transcription (Whisper, run in her browser; the model, about 94 MB, downloads once from Matra's own server) and on-device suggestions (`compromise`, `chrono-node`) that she keeps, changes or sets aside. The one-pager, PRD, grant boilerplate, FAQ, meeting playbook, demo script, legal memo and email templates now all use one precise line: *"Nothing rewrites her words. Voice is transcribed and suggestions are made on her device, and she confirms every one; no AI runs on any server or third-party service."* Don't shorten it back to "no AI".

3. **A dedicated project email address** (not a personal Gmail) and a public repo link. Both are placeholders in the signature block.
4. ~~**Fix the flaky e2e scenario 2.**~~ *Fixed 2026-11-11.* Two races, both timing-dependent. (1) Fixed 2026-10-14: a file chosen before the Evidence page had opened her vault saved an empty draft over her story. (2) Fixed 2026-11-11: a file's details are added to her draft a moment *after* its row appears. The test (and a fast user) could leave the page and open My story inside that window. The story read the files once when it opened, so it showed "1 file" and would have sealed without the second file. Reproduced on demand by delaying that one save by 8 s. Now the open story takes in files whose details land later (`foldInLateEvidence`, unit-tested), and the test waits for the PDF's "Saved to your space" status before it leaves, as she would. `MATRA_E2E_CPU_THROTTLE=4` slows the page's CPU for flake hunting.
5. ~~**Doc drift.**~~ *Fixed 2026-10-07.* GOVERNANCE.md §2.6 said data export was "not yet built", but it is built (the "Download my data" zip is covered by e2e scenario 3). Update it, noting that §2 changes follow GOVERNANCE §6 (this one is a factual status fix, not a change to the commitment).

### 2. Gates before any real survivor data (months; these need other people)

These come from GOVERNANCE.md §5, the whitepaper §6 and the threat model §6. Each one maps to a contact type in [outreach/PEOPLE.md](outreach/PEOPLE.md).

| Gate | Status | Who unblocks it |
|---|---|---|
| Advocate review and sign-off of the intake script | Not started | NJ county CSVA programs, NJCASA |
| Licensed-counsel review (RPC 7.3(e), privilege, spoliation warnings, consent text) in NJ, then NY | Not started | Law-school clinic, NJCVLC, VRLC TA |
| Fiscal sponsor / 501(c)(3) | Not started | Superbloom, CS&S, Hopewell |
| Designated Successor named, reserve policy adopted, Succession and Data Promise reviewed by counsel (proposed GOVERNANCE §5.7) | Not started | Fiscal sponsor, an NJ legal-aid or county SV program, board ([SUCCESSION_AND_DATA_PROMISE.md](SUCCESSION_AND_DATA_PROMISE.md)) |
| Independent security audit | Not started; needs ~$30k+ or a funded route | OTF Security Lab, OSTIF, Least Authority, GitHub SOSF money |
| Outside cryptographer review of the threat model | Not started | Academic crypto contacts (Varia, Ristenpart, Qin) |
| Signed pilot partner with trained advocates | Not started | SAVE of Essex, healingSPACE, Partners (NJ) |
| Published incident-response plan and law-enforcement request guide | *weekend-mvp:* incident-response plan drafted ([ops/INCIDENT_RESPONSE.md](ops/INCIDENT_RESPONSE.md), pending counsel; Q-055, Q-036); law-enforcement request guide not written (Q-039) | You (templates exist elsewhere; counsel reviews) |
| **W3** attorney key substitution | Mitigated on weekend-mvp: org-signed attorney directory checked automatically by her client (no phone call, no tick box). A production build that is not a demo now fails without the pin and refuses unpinned keys. Still to do: key transparency log | Code |
| **W4** malicious client code: published build hashes, SRI, reproducible builds | CSP done; release process proposed in [ops/DEPLOY_GOVERNANCE.md](ops/DEPLOY_GOVERNANCE.md) (signed tags, published hashes, n-of-m approvals), not yet configured or shown reproducible | Code |
| **W5** Argon2id and a passphrase-strength floor | Not done. *2026-11-11 (weekend-mvp):* an optional recovery code only she holds (128 random bits, shown once, confirm-last-4) can now set a new passphrase; the server stores only a scrypt hash and wrapped keys and cannot reset anyone (W20). It does not change W5: the passphrase is still PBKDF2 | Code |
| **W7** attorney-verification procedure, plus MFA or passkeys for attorneys | Manual CLI flag only | Code + partner terms |
| **W8** device safety (residue on exit, neutral naming) | Partly done (Quick Exit, idle lock) | Code + advocate review |
| **W11** metadata minimization (log retention, IP truncation, encrypted alias, size padding) | Partly done: no IPs or user agents on disk or in logs (daily-salted in-memory hashes for rate limits), route-only request logs (app server, key holders, matcher), expired sessions swept every 10 minutes, web build audited for third-party requests, [data inventory](PRIVACY_DATA_INVENTORY.md). Still to do: size padding for records, encrypted alias, edge-log settings at the host | Code + hosting |
| **W14** key holders at separate institutions, remote mode, eligibility attested by someone other than the app server | Code supports remote holders; no institutions signed (Q-040, Q-041) | Partner institutions + counsel |
| **W18** real enclave attestation for the matcher (replace the simulation) | Not started; comparison and recommendation in [ops/HOSTING.md](ops/HOSTING.md) | Code + hosting |
| n-of-m deploy approvals from separate organizations | Proposed ([ops/DEPLOY_GOVERNANCE.md](ops/DEPLOY_GOVERNANCE.md)); needs approver organizations (Q-044) | Partner organizations + counsel |

### 3. Engineering backlog that would make the audit cheaper and the pilot safer

Short items that you or a contributor can do now, in rough priority order:

1. Attorney MFA or passkeys and a logged verification workflow (W7, N7).
2. Argon2id via WASM and a passphrase-strength meter (W5).
3. Metadata minimization, the rest of W11: size padding for records and blobs, encrypted share alias (IPs and request logs are done).
4. Published build hashes and an SRI manifest (W4).
5. ~~More crypto unit tests.~~ *Mostly done on weekend-mvp:* `packages/crypto` has 191 tests (tamper, wrong key, threshold t−1, attestation, recovery). Still worth adding: key-wrap round trips and fingerprint stability for the original vault code. Auditors price by uncertainty.
6. Attorney-first route (N1) and the private-draft vs sealed-statement split (N5). These are the two things lawyers are most likely to ask for.
7. Resource directory (N12) with NJ county programs and hotlines.
8. External ledger anchoring (W10, N9). Not blocking, but it's the next credibility step for "integrity" claims.

### 4. Leave alone for now

- Escrow beyond the demo. The OPRF, threshold key and counselor model now exist in demo form (weekend-mvp), but keep matching off for any pilot until the W13, W14, W18 and W21 residuals are closed. In conversations, present it as a research question, not a feature.
- NY expansion, Spanish, Shamir recovery (recovery shares with people she trusts; the single recovery code she holds herself is built, W20). Do these after the NJ pilot.

## How to talk about readiness in one sentence

> "The full flow works end to end on invented data and is covered by automated browser tests. Before any real survivor uses it, we need advocate sign-off on the script, a counsel review, an independent security audit and a pilot partner, and that's exactly what I'm asking for help with."
