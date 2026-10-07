# Matra: Grant Boilerplate

*Reusable sections for letters of inquiry and proposals. Updated 2026-10-06. Adapt the length to each funder's limits. Every statistic is cited; re-check the figures before submission, because single-year estimates change. Nothing here is legal advice.*

> **Before using any section:** confirm the fiscal sponsor's name and EIN, the partner names (only with written permission), and the funder's restrictions (e.g., federal grant conditions, VAWA/VOCA confidentiality). Never include survivor stories or individual data.

---

## 1. Organization summary (≈100 words)

Matra is a nonprofit, open-source (AGPL-3.0) project building survivor-controlled documentation and a confidential path to a lawyer for adult survivors of sexual assault in New Jersey and New York. A scripted, trauma-informed intake (no AI) records her account in her own words. It is encrypted on her device so the operator cannot read it. From that record she can produce an Incident Summary in the Survivor's Own Words, an evidence inventory, and a New Jersey crime-victim-compensation draft. She shares them with a verified pro-bono attorney only with her explicit, revocable consent. Matra is fiscally sponsored by [Sponsor / pending], takes no fees from attorneys or cases, and will not accept real survivor data until an independent security audit and licensed-counsel review are complete.

---

## 2. Statement of need

**Most sexual violence never reaches the justice system.** The U.S. Bureau of Justice Statistics estimates that **24%** of rape and sexual assault victimizations were reported to police in 2024. The 2023 estimate was 46%; single-year figures are volatile because of sample size, but reporting is consistently a minority ([BJS, *Criminal Victimization, 2024*](https://bjs.ojp.gov/document/cv24.pdf)). RAINN's multi-year estimate is about **31%**, but it rests on older NCVS data and its page could not be re-checked on 2026-10-06, so prefer the BJS figure ([RAINN](https://rainn.org/get-information/statistics/reporting-rates)).
**Sexual violence is common, and in New Jersey it rarely ends in a solved case.**
- **45.1%** of U.S. women have experienced contact sexual violence in their lifetime, and **21.0%** have experienced completed or attempted rape. In New Jersey, the estimate is **37.0%** of women for contact sexual violence (95% CI 27.1–48.0) ([CDC, NISVS 2023/2024 Data Brief on Sexual Violence, Dec. 2025](https://www.cdc.gov/nisvs/media/pdfs/sexualviolence-brief.pdf)). *NISVS changed its methodology for this cycle, so do not compare these figures with earlier NISVS reports as a trend.*
- The 2024 BJS reporting figure above comes from *Criminal Victimization, 2024* (NCJ 310547). Cite it as a single-year estimate.
- New Jersey police recorded **1,611 rape offenses** in 2023, and **330** of them (about **20%**) were cleared ([NJ State Police, *2023 Uniform Crime Report*, county tables](https://www.nj.gov/njsp/ucr/pdf/current/20250416_2023_Uniform_Crime_Report.xlsx)). *Matra computed these figures by summing the county totals. Re-check them against the statewide table before submission.* Because most rapes are never reported, these numbers cover only a fraction of incidents.

**Survivors' civil legal needs go largely unmet, and counsel matters.**
- Low-income Americans receive no legal help, or not enough, for **92%** of their substantial civil legal problems. **98%** of low-income households with recent domestic violence had at least one other civil legal problem in the past year, not counting problems involving the violence itself. *LSC reports this for domestic violence, so do not restate it as a sexual-assault figure* ([Legal Services Corporation, *The Justice Gap*, 2022](https://justicegap.lsc.gov/resource/executive-summary/)).
- In one study cited in Congress, **83%** of victims represented by an attorney obtained a protective order, compared with **32%** of those without one ([House Judiciary Committee, statement on the POWER Act](https://judiciary.house.gov/media/press-releases/goodlatte-floor-statement-on-the-power-act)). *Cite it as "one study cited in Congress"; it is not a national estimate.*

**Survivors face three compounding barriers.**
1. *Retelling.* Survivors who seek options must tell their story repeatedly, to advocates, attorneys, and agencies. They often don't know which details matter or who counts as a witness to their first disclosure.
2. *Fear of their own words.* Survivors have good reason to fear that what they write will be used against them. Any record given to police is discoverable to the defense, and inconsistencies that are routine in trauma memory can be used to impeach.
3. *Access to counsel.* Legal-aid organizations spend scarce attorney hours reconstructing facts at intake. Survivors who haven't reported to police are often ineligible for compensation-funded legal help. In New Jersey, VCCO legal-assistance reimbursement ($275/hour, up to $10,000 within the $25,000 claim cap) requires VCCO eligibility, which today means a police report within 9 months (N.J.S.A. 52:4B-8(b), -18; N.J.A.C. 13:75-4.10).

**The gap Matra fills.** Existing tools either route reports to institutions (police, campus security, employers) or don't connect documentation to a lawyer. Matra is survivor-owned: nothing goes anywhere unless she chooses, and when she does choose, it goes to an attorney she picked, in a format that saves attorney time.

---

## 3. Project description

**What we will do in 12 months:** take Matra from a working prototype to a safety-gated, supervised pilot with one New Jersey legal-aid or advocacy partner.

**What exists today (working MVP, invented data only)**
- Scripted, trauma-informed intake: every question skippable, non-leading sensory prompts, words stored verbatim, Quick Exit.
- Zero-knowledge vault: client-side encryption (AES-256-GCM, keys derived from her passphrase). The server stores only ciphertext.
- Evidence handling: on-device removal of photo location data, plus SHA-256 integrity hashes.
- A tamper-evident, append-only ledger. It is self-hosted today; external timestamp anchoring is planned.
- On-device generation of the **Incident Summary in the Survivor's Own Words** and an **NJ VCCO application draft** that states eligibility rules accurately.
- Consent-based sharing with a verified attorney. Consent text is logged verbatim, she can revoke, and she sees every access.
- Published security whitepaper, legal research memo, governance commitments, and draft partner agreements.

**What this grant funds**
1. **Independent security audit** of the cryptography, server, and web client, plus remediation and publication of results.
2. **Advocate co-design**: trained sexual-violence advocates review and co-own the intake script, consent text, and warnings. Survivor-voice honoraria are included.
3. **Licensed-counsel review** of open legal questions: attorney-directory status under NJ RPC 7.3(e), privilege design, deletion and spoliation warnings, and VAWA/VOCA confidentiality.
4. **Pilot-readiness engineering**: share expiry, an enforced 18+ age gate, an attorney-first route, private drafts, an attorney key-fingerprint check, MFA or passkeys, metadata minimization, and an incident-response plan.
5. **A two-phase pilot** with [Partner]: synthetic data first, then supervised real use only if every safety gate is met.

**What Matra will not do:** automatic reporting to police, schools, or employers; AI processing of survivor content; legal advice from software; serving minors; taking fees or data revenue of any kind. The experimental matching ("escrow") feature stays **disabled** throughout the pilot.

---

## 4. Goals, objectives, and measurable outcomes (12-month pilot)

**Goal 1: Make Matra safe enough to hold real survivor data.**
- Obj 1.1: Complete an independent security audit by Month 4. Fix all high and critical findings and publish the report (fixed or disclosed) by Month 5.
- Obj 1.2: Complete the pre-pilot security items (share expiry, key-fingerprint check, attorney MFA, metadata minimization, incident-response plan) by Month 4.
- Obj 1.3: Obtain an outside cryptographer's review of the threat model by Month 4.
- *Outcome measure:* all GOVERNANCE.md §5 gates met and published before any real data (yes/no).

**Goal 2: Center survivors and advocates in the design.**
- Obj 2.1: At least [3] trained advocates review the intake script. Advocate sign-off by Month 3.
- Obj 2.2: Run at least [2] usability sessions with fictional personas, plus a survivor-voice review (compensated).
- *Outcome measure:* documented sign-off. Number of script changes made in response to advocate review.

**Goal 3: Resolve the legal-structure questions.**
- Obj 3.1: A written opinion from licensed NJ counsel on RPC 7.3(e) status, privilege design, and deletion warnings by Month 3. Register if required.
- *Outcome measure:* counsel memo received; survivor-facing language updated accordingly.

**Goal 4: Demonstrate value in a supervised pilot (Months 3-9, conditional on Goals 1-3).**
- Obj 4.1: Onboard at least **10 verified pro-bono attorneys** under the partner MOU.
- Obj 4.2: Median share-to-first-attorney-contact time of **≤3 business days**.
- Obj 4.3: At least **80%** of surveyed survivors report they "felt in control" (optional, anonymous survey). At least 70% would recommend Matra to a friend.
- Obj 4.4: Attorney-reported intake time saved per matter of **≥30%** versus the partner's baseline. Attorney satisfaction ≥4/5.
- *Safety gates (any failure pauses the pilot):* 0 plaintext-exposure incidents, 0 unauthorized shares, 100% verbatim consent on shares, 100% of revocations effective immediately.

**Explicitly not measured as success:** number of police reports filed, or number of matching ("escrow") hits. These will not be incentivized.

---

## 5. Evaluation plan

- **Design:** a mixed-methods formative evaluation with pre/post comparison against the partner's own intake baseline. No randomization, because it would be inappropriate for survivors.
- **Data sources:**
  - Aggregate platform counts: shares, revocations, time to first attorney contact, Quick Exit usage counted anonymously. Small-cell suppression applies (no figure under 10 is reported).
  - Optional, anonymous survivor survey, offered by advocates, never a condition of service.
  - Attorney and advocate surveys and structured debriefs.
  - Audit report and incident log.
  - The partner's baseline intake-time estimate.
- **What we will not collect:** survivor narratives, identities, or individual-level data for evaluation. Funders receive aggregate reports only.
- **Independence:** [Optional: an evaluation advisor from a university partner or the advocate reviewer group reviews the instruments and the report.]
- **Reporting:** a midpoint safety review (Month 6), a final report (Month 12), and a public summary that includes audit results and a transparency report on any legal requests.

---

## 6. Trauma-informed and privacy safeguards

- **Survivor control:** nothing is sent anywhere without her explicit, informed choice at the moment of sending. Consent is logged verbatim, revocable, and time-limited (the share-expiry feature is due before the pilot).
- **Her words, verbatim:** no AI rewriting. Software adds labels and structure only.
- **Trauma-informed design:** every question can be skipped; prompts are non-leading; there are no timers or progress pressure; content warnings; "take a break"; grounding resources; Quick Exit everywhere.
- **Honest warnings** before writing, sealing, sharing, and deleting. These cover court-ordered production from her, discoverability of anything given to police, version history, unrecoverable passphrases, and the fact that revocation can't recall copies already downloaded.
- **Zero knowledge:** the operator can't decrypt content. Metadata is minimized: logs are kept at most 30 days with truncated IPs.
- **No telemetry, no advertising, no data sales** (binding governance commitment).
- **Adults only:** an 18+ gate and screening for incidents involving minors, with a referral path. Partners follow their own mandatory-reporting duties.
- **Campus independence:** any campus channel stays independent of the institution's Title IX and Clery reporting structures.
- **VAWA/VOCA confidentiality:** the design follows 34 U.S.C. 12291(b)(2) and 28 C.F.R. 94.115. Encrypted or hashed PII is still treated as PII, and no individual-level data goes to funders.
- **Accessibility:** a WCAG 2.2 AA target and plain language. Spanish is planned, with review by native-speaking advocates.

---

## 7. Sustainability

- **Funding model:** grants and individual donations through a 501(c)(3) fiscal sponsor. No revenue from attorneys, cases, survivors, or data, by binding governance commitment.
- **Low operating cost:** after the one-time audit and pilot-readiness work, running costs are modest (hosting, maintenance, periodic re-audit, a part-time coordinator). See the budget assumptions.
- **Partner-carried costs:** legal-aid partners with VOCA or OVW Legal Assistance for Victims funding may treat Matra as an intake-efficiency tool within their own projects, subject to their grant conditions.
- **Attorney capacity:** pro-bono attorneys and clinics provide representation. Some NJ matters may be eligible for VCCO-funded representation paid **directly to the attorney** (see §9).
- **Open-source continuity:** under AGPL-3.0 a partner can self-host. Governance requires 90 days' notice and data export if the project ever winds down.
- **Year 2 plan:** re-audit, a second NJ partner, and a New York partner. Seek multi-year operating support.

---

## 8. Draft 12-month budget

> **Every figure below is a planning assumption, not a quote.** Replace each with real quotes before submission. Ranges reflect typical public pricing and need confirming; pro-bono or in-kind offers would lower them.

| Line item | Amount (USD) | Assumption / basis |
|---|---|---|
| Independent security audit (crypto library, server, web client) + retest | $40,000 | **Assumption.** Small codebase; roughly 2-3 auditor-weeks plus a retest. Commercial crypto/web audits commonly run tens of thousands of dollars. Could fall to $0-15,000 through a pro-bono or audit-funding program (see TARGETS.md). Get 2-3 quotes. |
| Outside cryptographer review of escrow/threat model | $5,000 | **Assumption.** A short design review (≈20-30 hours). |
| Part-time advocate reviewer / survivor-voice honoraria | $12,000 | **Assumption.** Advocate reviewer at ~8 hrs/month × 12 × $75/hr ≈ $7,200, plus survivor-voice panel honoraria (e.g., 6 people × 4 sessions × $200 = $4,800). |
| Part-time pilot coordinator (0.25 FTE) | $20,000 | **Assumption.** Partner liaison, attorney onboarding and verification, evaluation logistics. |
| Legal review (licensed NJ/NY counsel) | $10,000 | **Assumption.** RPC 7.3(e) opinion, terms of use/privacy notice, MOU review. Reduce if a clinic or pro-bono counsel takes it on. |
| Pilot-readiness engineering (contract) | $25,000 | **Assumption.** Share expiry, 18+ gate, attorney-first route, key-fingerprint UI, MFA/passkeys, metadata minimization, accessibility fixes. |
| Hosting, backups, domain, TLS, monitoring (no third-party analytics) | $3,000 | **Assumption.** A small managed VPS/database with encrypted backups (~$150-250/month). May be reduced by nonprofit credits. |
| Insurance (cyber liability; D&O/GL if not covered by sponsor) | $5,000 | **Assumption.** Confirm what the fiscal sponsor's policy covers. Cyber premiums vary widely. |
| Spanish translation + native-speaker advocate review | $4,000 | **Assumption.** Intake script, warnings, consent text. |
| Evaluation (survey tools without trackers, analysis) | $3,000 | **Assumption.** |
| Contingency (5%) | $6,350 | |
| **Subtotal** | **$133,350** | |
| Fiscal sponsor fee (assume 8%; confirm) | $10,668 | **Assumption.** Sponsor fees commonly fall in the 5-15% range. |
| **Total request** | **≈$144,000** | |

*Leaner version (pro-bono audit and counsel, volunteer engineering):* roughly $40,000-60,000, covering advocate honoraria, coordinator, hosting, insurance, translation, and the sponsor fee.

---

## 9. Funding-flow constraint (include in every proposal)

> Matra takes **no fees from attorneys**: no listing fees, referral fees, or per-case payments, and no share of any legal fee, settlement, court award, or victim-compensation payment. New Jersey bars for-profit lawyer referral and fee sharing with non-lawyers (RPC 5.4(a), 7.2(c), 7.3(d); Joint Opinion ACPE 732 / CAA 44 / UPL 54 (2017)). Where a survivor's matter qualifies for New Jersey VCCO legal-assistance reimbursement ($275/hour, up to $10,000, within the $25,000 claim cap, for VCCO-eligible victims; N.J.S.A. 52:4B-8(b); N.J.A.C. 13:75-4.10), **that payment goes to the attorney, not to Matra**. Such work is not counted as pro bono. Matra is funded only by grants and donations that are not tied to individual cases or referrals, and funders receive no individual-level data and no say in which attorney a survivor chooses.

---

## 10. Short-form versions

**One sentence:** Matra is a nonprofit, open-source tool that lets adult sexual-assault survivors document what happened in their own words, encrypted so no one else can read it, and choose whether to share it with a pro-bono attorney.

**50 words:** Fewer than a third of sexual assaults are reported to police. Matra gives adult survivors in NJ and NY a trauma-informed, zero-knowledge way to document what happened, in their own words, and a consent-based path to a verified pro-bono attorney. It is nonprofit and open-source, and it takes no fees from attorneys or cases.

**Ask line:** We seek [$X] over 12 months for an independent security audit, advocate co-design, licensed-counsel review, and a safety-gated pilot with a New Jersey legal-aid partner.

---

## 11. Attachments checklist
- [ ] Fiscal sponsor letter / determination letter
- [ ] [One-pager](../PITCH_ONE_PAGER.md)
- [ ] [Security whitepaper](../SECURITY_WHITEPAPER.md) (or a summary)
- [ ] [GOVERNANCE.md](../../GOVERNANCE.md)
- [ ] Partner letter of support (only with written permission)
- [ ] Budget with quotes replacing assumptions
- [ ] Advisor list (only those who've agreed to be named)
