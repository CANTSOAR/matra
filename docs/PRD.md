# Matra: Product Requirements Document

*Tagline: a one-touch justice pipeline, survivor-controlled from first word to first lawyer.*

**Version:** 0.1 (MVP plus next phase) · **Date:** 2026-10-06 · **Owner:** founder · **Reviewers needed:** victims'-rights counsel, trauma-informed advocate, security auditor

Related: [Legal Research Memo](LEGAL_RESEARCH_MEMO.md) · [Security Whitepaper](SECURITY_WHITEPAPER.md) · [Brief field research](research/brief-fields.md)

---

## 1. Problem
Most sexual assaults are never reported to police. BJS estimates that **24%** of rape and sexual assault victimizations were reported in 2024, down from 46% in 2023. Single-year estimates swing widely because of sample size ([BJS, *Criminal Victimization, 2024*](https://bjs.ojp.gov/document/cv24.pdf)). Survivors who do want options face several problems at once. They must retell their story many times. They often don't know what to document or whom they told. They fear that anything they write becomes ammunition for the defense. And they have little access to a lawyer. Legal-aid organizations face the reverse problem: intake is slow and expensive, and facts arrive incomplete.

## 2. Product principles (non-negotiable)
1. **Survivor control.** Nothing is sent to police, schools, employers, or anyone else without an explicit, informed, logged choice made at that moment. Consent is revocable and (next phase) time-limited.
2. **Her words, verbatim.** No AI rewriting, summarizing, or "improving." Software adds labels and structure only.
3. **Trauma-informed by design.** Every question can be skipped. Prompts are non-leading and use sensory, cognitive-interview-style wording ("What do you remember hearing?"), avoid language of consensual sex or doubt, and include pauses and grounding. Quick Exit is available everywhere.
4. **Honest about limits.** We never say "subpoena-proof," "bulletproof," or "admissible." See the Legal Memo §8 for approved language.
5. **Zero knowledge.** The operator cannot read content. Metadata is minimized.
6. **No legal advice from software.** Information, not advice. Attorneys give advice.
7. **Nonprofit, no fee flow.** Matra takes no money from attorneys or from cases.

## 3. Personas

| Persona | Description | Primary needs | Key fears |
|---|---|---|---|
| **Survivor ("Jane")**, 18+, NJ/NY | Assaulted days or years ago. Has not decided whether to report. May share a device or live with the person who harmed her. | Document safely, at her own pace. Understand options. Talk to a lawyer without committing to anything. | Being disbelieved. Records used against her. The abuser finding out. Losing control. |
| **Pro-bono / victims'-rights attorney** | At a legal-aid organization, a clinic, or a firm pro-bono program. Licensed in NJ and/or NY. | Organized facts, evidence with integrity data, clear consent scope, conflict info early. Low admin burden. | Privilege or discoverability problems. UPL or fee-sharing ethics. Unvetted volume. Liability for platform failures. |
| **Advocate** (rape-crisis, campus confidential, county Victim-Witness) | Often the first trusted person the survivor reaches. | Help the survivor use the tool. Review the intake script. Stay a confidential resource. | Tools that re-traumatize, or that turn advocates into mandatory reporters. |
| **Legal-aid org admin** | Runs intake and pro-bono programs. Answers to funders (VOCA, OVW LAV). | Verify and onboard attorneys. Aggregate, de-identified metrics for grants. Compliance with VAWA confidentiality. | Data breaches. Grant-condition violations. Reputational risk. |
| **Matra operator (staff)** | Small nonprofit team. | Run the service without access to content. Verify attorneys. Respond to legal process. | Being compelled. Insider risk. |

## 4. Scope

### 4.1 MVP: built today (demo with fictional data only)
| # | Capability | Status |
|---|---|---|
| M1 | **Intake chatbot.** Deterministic script (no LLM). Covers incident, sensory narrative, perpetrator(s), witnesses, **disclosures (outcry)**, medical, prior reports, evidence, safety, financial impact, and goals. Every question skippable. Stored verbatim. | Built (web client in progress) |
| M2 | **Quick Exit** button and triple-Esc | Built |
| M3 | **Zero-knowledge vault.** Passphrase-derived keys. Per-record and per-blob AES-256-GCM. Server stores ciphertext only. No reset. | Built |
| M4 | **Evidence upload** with client-side image EXIF/GPS stripping and a SHA-256 integrity hash. Non-image metadata warning. | Built |
| M5 | **WORM ledger.** Append-only hash chain (records, blobs, consents, revocations, escrow, shred) with a verify endpoint. | Built (not externally anchored) |
| M6 | **Incident Summary PDF** (currently named "Police Evidentiary Brief", to be renamed) and an **NJ VCCO application draft**. Generated client-side. | Built |
| M7 | **Legal Shield sharing.** Choose a verified attorney, accept verbatim consent text (ledgered), share scoped record and evidence re-encrypted to the attorney, revoke at any time. Attorney access appears in the survivor's audit log. | Built |
| M8 | **Blind escrow (demo only).** Hashed identifiers. Both entries flip to "matched" on a cross-survivor match. | Built. **Not safe for real use** (see Security §5) |
| M9 | **Crypto-shred account deletion** | Built |

### 4.2 Next phase (pilot-readiness)
| # | Requirement | Why |
|---|---|---|
| N1 | **Attorney-first route:** "Talk to a lawyer first" before the long intake. The attorney can request that the survivor prepare her account for counsel, with an attorney-set designation. | Strengthens privilege and work product (Memo §2) |
| N2 | **Escrow redesign:** matches go to a vetted Legal Options Counselor, not to users. Account verification. OPRF with threshold key. | Prevents perpetrator probing (Security §5) |
| N3 | **Share expiry and renewal**, plus scoped consent per item | VAWA "reasonably time-limited" consent |
| N4 | **Warnings at key moments:** intake start, seal, share, export, and delete (discoverability, version history, spoliation) | Honest informed consent (Memo §2) |
| N5 | **Private notes vs. sealed statements.** Drafts are local and unsealed. Sealing is deliberate. | Reduces version-history impeachment risk |
| N6 | **Age gate (18+)** and minor-incident screening, with a referral path (2NDFLOOR, NJ DCPP info) | Mandatory reporting (Memo §4) |
| N7 | **Attorney verification workflow** (bar lookup, org attestation, MOU signature, MFA or passkey) and an admin audit trail | Malicious attorney threat |
| N8 | **Key-fingerprint verification** UI for attorney keys | Malicious server key substitution |
| N9 | **External timestamp anchoring** (RFC 3161 and/or a public log) | Evidentiary weight of the ledger |
| N10 | **Advocate role:** a confidential advocate can be invited, with the same consent model | Advocates are trusted intermediaries |
| N11 | **Recovery via Shamir shares** with a chosen advocate (opt-in) | Lost passphrase is the top usability risk |
| N12 | **Resource directory:** NJ county SA programs, Victim-Witness offices, RAINN hotline, NJ VCCO, NY OVS | Information, not advice |
| N13 | **Spanish** and other languages (script reviewed by native-speaking advocates) | Access |

## 5. User stories (selected)

**Survivor**
- As a survivor, I can begin documenting without creating an account, and save only when I choose to set a passphrase, so that I am not committed up front. *(N; today an account is required)*
- As a survivor, I can skip any question and come back later, so that I am never forced to relive something before I'm ready.
- As a survivor, I can press Quick Exit and land on a neutral website immediately, so that someone walking in sees nothing.
- As a survivor, I can upload a photo and know its location data was removed before it left my device.
- As a survivor, I can see exactly what a lawyer will receive, read the consent in plain language, and turn sharing off later.
- As a survivor, I can see when my lawyer opened my file or downloaded evidence.
- As a survivor, I am told plainly that a court could order me to hand over my records, and that police reports are shared with the defense, before I seal or share anything.
- As a survivor, I can generate a VCCO application draft that tells me honestly about the 9-month police-report requirement and the 5-year filing deadline.
- As a survivor, I can learn, through a counselor and never automatically, that someone else named the same person, and decide what, if anything, to do. *(N2)*

**Attorney**
- As a verified attorney, I can see incoming shares with the survivor's chosen alias, the consent scope, and the ledger hashes, so I can assess the matter and run conflicts.
- As an attorney, I can verify that the file I received matches the sealed ledger entry.
- As an attorney, I can ask the survivor to prepare her account at my direction for the purpose of legal advice. *(N1)*
- As an attorney, I lose access immediately when the survivor revokes, and I understand my duties for copies I already hold (MOU).

**Advocate / org admin**
- As an advocate, I can review the full intake script and propose wording changes through a versioned review process.
- As an org admin, I can verify my organization's attorneys and see aggregate, de-identified counts (shares received, response times) for grant reports.

## 6. Functional requirements (MVP acceptance)
- FR1: No plaintext IntakeRecord, narrative, identifier, or evidence byte is ever transmitted to the server. (Test: server request logging during an E2E run contains only Envelope or WrappedKey fields.)
- FR2: Every question has a visible "Skip". The narrative is stored byte-for-byte as typed.
- FR3: Quick Exit replaces the page and history entry within 300 ms of activation.
- FR4: Sealing a record or blob returns a ledger entry. `GET /api/ledger/verify` returns `ok: true` after any sequence of operations.
- FR5: Shares are possible only to verified attorneys. Consent text is stored verbatim and hashed into the ledger. Revocation blocks bundle and blob fetches immediately.
- FR6: Attorney opens and downloads create survivor-visible audit events.
- FR7: The brief and VCCO PDFs are generated client-side, include the not-legal-advice and not-sworn notices, and display ledger hashes.
- FR8: Account deletion removes all ciphertext and keys. Ledger entries remain.

## 7. Non-functional requirements
- **Security:** see the Security Whitepaper. PBKDF2 600k / scrypt / AES-256-GCM / RSA-OAEP-3072. TLS and HSTS. Strict CSP. No third-party analytics or trackers on any authenticated or intake page. Independent audit before real data.
- **Privacy:** data minimization. Server log retention ≤30 days with truncated IPs. No sale or sharing of data. Aggregate metrics only, with small-cell suppression (n<10). NJDPA-style opt-in for sensitive data. VAWA confidentiality where funded.
- **Accessibility:** WCAG 2.2 AA. Full keyboard operation, screen-reader labels, 200% zoom, reduced-motion support, plain language at about a 6th-8th grade reading level.
- **Trauma-informed UX:** calm visual design. No timers or forced progress. Content warnings before sensitive sections. "Take a break" saves state. Grounding resources are always available. No celebratory animations around disclosure.
- **Performance:** key derivation ≤2 s on a mid-range phone. Evidence uploads up to 100 MB with progress and resume (next phase).
- **Reliability:** encrypted backups with defined retention. RPO 24 h, RTO 72 h for the pilot.
- **Legal:** no automated legal advice. Approved-language list enforced in UI copy review. Nonprofit operation. No per-referral fees.

## 8. Out of scope (MVP and pilot)
- Automatic or one-click submission to police, prosecutors, Title IX offices, or employers.
- Any AI or LLM processing of survivor content.
- Users under 18.
- Jurisdictions outside NJ and NY.
- Matra employees giving legal advice or counseling.
- Payments, fee collection, or any revenue from attorneys.
- Public disclosure of matches or "naming" features.
- Native mobile apps (web only for the pilot).

## 9. Pilot success metrics (6-month pilot, 1-2 legal-aid partners)
**Safety and trust (gates; any failure pauses the pilot)**
- 0 security incidents involving plaintext exposure. 0 unauthorized shares.
- 100% of shares carry verbatim consent. 100% of revocations take effect immediately.
- Advocate review sign-off on the intake script before launch.

**Survivor outcomes**
- At least 60% of started intakes reach a saved record. Median sessions to completion recorded (no target; at her pace).
- Post-use survey (optional, anonymous): ≥80% "felt in control", ≥70% "would recommend to a friend".
- Quick Exit usage tracked as an anonymous count only.

**Attorney and partner outcomes**
- Median time from share to first attorney contact: ≤3 business days (MOU target).
- Attorney-reported intake time saved per matter, compared with the partner's baseline (target: 30% or more).
- At least 10 verified pro-bono attorneys onboarded. Attorney satisfaction ≥4/5.
- Number of matters opened (protective orders, VCCO claims, victims'-rights representation). Reported only in aggregate.

**Explicitly not success metrics:** number of police reports filed, or number of escrow matches. These must not be incentivized.

## 10. Open questions
1. Legal structure: own 501(c)(3), or fiscal sponsorship? Is a legal service plan registration required (RPC 7.3(e))?
2. Attorney-first or documentation-first as the default flow? This needs advocate and counsel input.
3. Should drafts be sealed at all before counsel is engaged? What is the right balance between integrity and impeachment risk?
4. Escrow: is matching worth its risk in the pilot, or should it be deferred until OPRF and the counselor model are in place? (Recommendation: defer real-data escrow.)
5. Who serves as Legal Options Counselor for matches, and under what privilege?
6. Recovery: which advocates can hold Shamir shares, and what happens if a share-holder is subpoenaed?
7. Campus pilot: which institution is willing to keep Matra fully independent of its Title IX office?
8. Language access priorities and costs.
9. Hosting jurisdiction and provider. Response policy for out-of-state legal process.
