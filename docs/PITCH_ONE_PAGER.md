# Matra
**Survivor-controlled documentation and a confidential path to a lawyer: zero-knowledge, trauma-informed, nonprofit.**

*For legal-aid organizations, pro-bono attorneys, advocates, and funders · New Jersey and New York · October 2026*

---

### The problem
- **Most sexual violence never reaches the justice system.** The U.S. Bureau of Justice Statistics estimates that **24%** of rape and sexual assault victimizations were reported to police in 2024. The 2023 estimate was 46%, and single-year figures are volatile, but reporting is consistently a minority ([BJS, *Criminal Victimization, 2024*](https://bjs.ojp.gov/document/cv24.pdf)). RAINN's multi-year estimate is about **31%** ([RAINN](https://rainn.org/get-information/statistics/reporting-rates)).
- Survivors who want options must retell their story repeatedly. They often don't know which details matter or who counts as an "outcry" witness. They have good reason to fear that what they write will be used against them.
- Legal-aid organizations spend scarce attorney hours reconstructing facts at intake.

### What Matra does today (working MVP, fictional data only)
1. **Trauma-informed intake.** A scripted (no AI) conversation. Every question can be skipped. Prompts are non-leading and sensory. Her words are stored **verbatim**. **Quick Exit** is available at all times.
2. **Zero-knowledge vault.** Content is encrypted on her device. Our server stores only ciphertext. **Matra cannot read or produce her content.**
3. **Evidence handling.** Photo location and EXIF data are stripped on her device. Each file is fingerprinted with SHA-256.
4. **Tamper-evident ledger.** Every sealed record, file, and consent gets an entry in an append-only hash chain. *(Today it is self-hosted. External timestamp anchoring is on the roadmap. Until then it shows integrity, not independent proof of time.)*
5. **Incident summary PDF** in her own words, plus an **NJ VCCO compensation application draft**. Both are generated on her device.
6. **Legal Shield sharing.** She picks a verified attorney, reads and accepts plain consent text (logged verbatim), and shares a scoped, re-encrypted file. She can revoke at any time and **sees every time the attorney opens it**.
7. **Blind escrow (demo only).** A prototype of confidential repeat-perpetrator matching. It is not for real use until redesigned (see below).

**Never:** auto-sending to police, schools, or employers · AI rewriting of her account · legal advice from software · fees from attorneys.

### What we are honest about
- Matra cannot be compelled to produce content it cannot decrypt. **She can be.** Anything given to police becomes discoverable to the defense. We tell her this before she writes, seals, or shares.
- A Matra record **cannot replace testimony**. An app entry is not a New Jersey "fresh complaint," because the doctrine requires telling a *person*. Matra helps her and her lawyer identify who she told.
- An escrow match is **a lead, not evidence** (N.J.R.E. 404(b); New Jersey has no counterpart to FRE 413). Before any real use, matching will route through a trained counselor and stronger cryptography (OPRF), because the current design could let a perpetrator probe whether he has been named.
- **No independent security audit yet.** One is required before real survivor data.
Full analysis: [Legal Research Memo](LEGAL_RESEARCH_MEMO.md) · [Security Whitepaper](SECURITY_WHITEPAPER.md)

### How it fits funding and ethics
- **Nonprofit operation. No referral fees, no fee sharing** (NJ RPC 5.4, 7.2(c), 7.3(d); ACPE 732 (2017)). The survivor chooses her attorney.
- **NJ VCCO** can reimburse attorneys **$275/hr, up to $10,000**, for legal assistance arising from the victimization. The award must sit within the $25,000 claim cap, and only for VCCO-eligible victims, which today requires a police report within 9 months (N.J.S.A. 52:4B-8(b), -18; N.J.A.C. 13:75-4.10). That funds some matters. It is not a substitute for pro-bono capacity.
- Partners with **VOCA** or **OVW Legal Assistance for Victims** grants can treat Matra as an intake-efficiency tool. We design to **VAWA confidentiality** (34 U.S.C. 12291(b)(2)).

### Pilot plan (corrected from the original blueprint)
| Phase | Timing | What happens | Exit criteria |
|---|---|---|---|
| **1. Expert review** | Months 0-3 | Advocates review the intake script. Victims'-rights counsel reviews the brief, consent, warnings, and referral structure. Independent security audit. Nonprofit or fiscal-sponsor structure set up. Fictional data only. | Script sign-off. Audit findings fixed. Counsel memo on RPC 7.3 status. |
| **2. Closed pilot, 1-2 NJ legal-aid partners** | Months 3-9 | Adults (18+) referred by partner advocates. Attorney-first option. Share expiry. **Escrow disabled.** | Safety gates met (0 plaintext incidents). Attorney response ≤3 business days median. Survivor "felt in control" ≥80%. |
| **3. Expand** | Months 9-15 | Add NY partners and a campus confidential-advocate channel. Institution receives no individual data. External ledger anchoring. Recovery with an advocate. | Second audit. Partner renewal. |
| **4. Matching (only if justified)** | Month 15+ | Counselor-mediated matching on OPRF/threshold cryptography, after independent review. | Ethics, security, and advocate approval. Published threat model. |

*Changes from the blueprint:* no automatic routing or "prosecutable pattern" claims; matching moved last and gated; nonprofit structure required for attorney routing; VCCO described accurately.

### What we need from partners
- **Pro-bono attorneys** (NJ, NY): victims' rights, protective orders, VCCO claims, Title IX, civil remedies. Sign the [partner MOU](ATTORNEY_PARTNER_MOU_TEMPLATE.md) and respond within 3 business days.
- **Advocates and trauma-informed interviewers** to review and co-own the intake script (about 2 hours per month).
- **A security auditor** (pro bono or grant-funded) for the crypto, server, and web client.
- **A fiscal sponsor** or nonprofit home, and **victims'-rights counsel** to review the referral structure.
- **Funding** for the audit, pilot hosting, and a part-time program coordinator.

### Contact
Aryan Malik, founder · [email] · [demo link]
*Matra is a pre-pilot prototype. Nothing here is legal advice.*
