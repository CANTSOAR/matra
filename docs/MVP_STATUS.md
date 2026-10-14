# Matra MVP: status and gap list

*Assessed 2026-10-07 from the code, tests and docs at commit `74f2a51` (plus uncommitted work in progress). Written for the founder.*

## Verdict

**As a demo for outreach: strong.** As a product that real survivors can use: **not yet, and the blockers are mostly not code.**

It is well above a typical student MVP. The full survivor-to-attorney loop works end to end in a real browser. The crypto is standard WebCrypto, not home-made. The legal and security docs are unusually honest, and that honesty is the best credibility asset in outreach. What's missing is the external validation that only other people can give: advocates, counsel, an auditor, a fiscal sponsor and a pilot partner. That's why outreach is the critical path now, not more features.

| Area | Grade | Why |
|---|---|---|
| Core flow (story space → vault → PDF → share → revoke → sealed match → counselor) | **A-** | Built and covered by 9 Playwright scenarios (dump-first story, interview mode, evidence, summary/export, sharing, revocation, sealed match with the counselor portal, Quick Exit, sign-in errors) against both the dev and production builds, plus an opt-in on-device voice test |
| Crypto design | **B** | Sound primitives (AES-256-GCM, RSA-OAEP-3072, PBKDF2 600k). Known gaps W2–W5 and W12 are documented. Thin unit tests (2 crypto tests) |
| Server | **B** | Express + SQLite, append-only ledger enforced by triggers, rate limits on register and login, strict CSP in production |
| Trauma-informed UX | **B / unvalidated** | Skip-anything, Quick Exit, triple-Esc, 15-minute idle lock, 18+ gate. **No advocate has reviewed the script yet**, which is the single biggest credibility gap |
| Legal posture | **B+ research / F review** | Excellent memo. Zero review by licensed counsel |
| Ops readiness | **D** | No hosted demo URL, no entity, no incident-response plan, no legal-request policy, no audit |
| Escrow (matching) | **C, demo-only** | Survivor self-probing is closed. The operator (pepper holder) can still test guessed identifiers (W2). Correctly kept off for any pilot |

### Verification run on 2026-10-07

- `npm run typecheck`: clean across all 4 workspaces.
- `npm test`: 94 passing, 1 skipped (crypto 2, shared/server 26, web 66).
- Later the same day, after the story space, on-device voice and counselor portal landed: `npm run e2e:prod` **9/9 passed** (voice test skipped unless built with `MATRA_VOICE_HARNESS=1`; it passes on both the CPU and the opt-in WebGPU path).
- `npm run e2e` (morning run): **8/8 passed** on the second run. The first run failed on scenario 2 (evidence/EXIF) and the 6 tests after it didn't run. The rerun passed with no code changes, so treat scenario 2 as **flaky**. Fix it before you rely on it in a live demo.

## What it still needs, in order

### 1. Before you send outreach (days, you can do it alone)

1. **A hosted demo URL.** Every template has a `[demo link]` placeholder, and "clone the repo and run npm" loses most non-engineers. `render.yaml` and the Dockerfile exist: deploy with `MATRA_DEMO_BANNER=1` and seeded fictional accounts, then put the URL in the one-pager, deck and signature.
2. ~~**Settle the "no AI" claim against the new story flow.**~~ *Fixed 2026-10-07.* The dump-first story space has shipped with on-device voice transcription (Whisper, run in her browser; the model, about 94 MB, downloads once from Matra's own server) and on-device suggestions (`compromise`, `chrono-node`) that she keeps, changes or sets aside. The one-pager, PRD, grant boilerplate, FAQ, meeting playbook, demo script, legal memo and email templates now all use one precise line: *"Nothing rewrites her words. Voice is transcribed and suggestions are made on her device, and she confirms every one; no AI runs on any server or third-party service."* Don't shorten it back to "no AI".

3. **A dedicated project email address** (not a personal Gmail) and a public repo link. Both are placeholders in the signature block.
4. **Fix the flaky e2e scenario 2.**
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
| Published incident-response plan and law-enforcement request guide | Not written | You (templates exist elsewhere; counsel reviews) |
| **W3** attorney key substitution: out-of-band fingerprint check | Partly done (manual fingerprint in the UI; she must confirm it before sharing) | Code |
| **W4** malicious client code: published build hashes, SRI, reproducible builds | CSP done; the rest isn't | Code |
| **W5** Argon2id and a passphrase-strength floor | Not done | Code |
| **W7** attorney-verification procedure, plus MFA or passkeys for attorneys | Manual CLI flag only | Code + partner terms |
| **W8** device safety (residue on exit, neutral naming) | Partly done (Quick Exit, idle lock) | Code + advocate review |
| **W11** metadata minimization (log retention, IP truncation, encrypted alias, size padding) | Not done | Code |

### 3. Engineering backlog that would make the audit cheaper and the pilot safer

Short items that you or a contributor can do now, in rough priority order:

1. Attorney MFA or passkeys and a logged verification workflow (W7, N7).
2. Argon2id via WASM and a passphrase-strength meter (W5).
3. Metadata minimization: log retention and IP truncation (W11).
4. Published build hashes and an SRI manifest (W4).
5. More crypto unit tests: tamper detection, wrong-key failure, key-wrap round trips and fingerprint stability. Auditors price by uncertainty, and 2 tests on the crypto package invites a higher quote.
6. Attorney-first route (N1) and the private-draft vs sealed-statement split (N5). These are the two things lawyers are most likely to ask for.
7. Resource directory (N12) with NJ county programs and hotlines.
8. External ledger anchoring (W10, N9). Not blocking, but it's the next credibility step for "integrity" claims.

### 4. Leave alone for now

- Escrow beyond the demo. Keep it off until OPRF plus a threshold key and a counselor model exist. In conversations, present it as a research question, not a feature.
- NY expansion, Spanish, Shamir recovery. Do these after the NJ pilot.

## How to talk about readiness in one sentence

> "The full flow works end to end on invented data and is covered by automated browser tests. Before any real survivor uses it, we need advocate sign-off on the script, a counsel review, an independent security audit and a pilot partner, and that's exactly what I'm asking for help with."
