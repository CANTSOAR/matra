# Matra: FAQ for Lawyers

*For pro-bono attorneys, legal-aid directors, clinic faculty, and victims'-rights counsel. Updated 2026-10-06.*

> **Read this first.** Matra is a **pre-pilot prototype**. It runs on **invented data only**, it has **not had an independent security audit**, and none of this is legal advice. The legal analysis behind these answers was prepared by a non-lawyer research function and **has not been reviewed by licensed counsel**. Reviewing it is one of the things we are asking you for. Sources: [Legal Research Memo](../LEGAL_RESEARCH_MEMO.md) (cited below as "Memo"), [Security Whitepaper](../SECURITY_WHITEPAPER.md) ("Whitepaper"), [PRD](../PRD.md), [MOU template](../ATTORNEY_PARTNER_MOU_TEMPLATE.md).

---

## The product

**1. What is Matra, in one paragraph?**
A nonprofit, open-source (AGPL-3.0) web app for adult (18+) survivors of sexual assault in New Jersey and New York. A scripted intake (no AI) helps her document what happened at her own pace; every question is skippable and her words are stored verbatim. Content is encrypted on her device, so the operator holds only ciphertext. From her record she can generate, on her device, an **Incident Summary in the Survivor's Own Words**, an **evidence inventory** (with SHA-256 hashes), and an **NJ VCCO compensation application draft**. Only if she chooses, she can share a scoped, re-encrypted copy with a verified attorney she picks from a directory. She can revoke at any time and she sees every time the attorney opens or downloads it.

**2. What does "Incident Summary in the Survivor's Own Words" mean? Is it a police report?**
No. It was originally called the "Police Evidentiary Brief" and is being renamed because the old name implied legal work product and a police audience (Memo §1, §5). It reproduces her own words verbatim in labelled sections (her account, sensory details, statements by the person responsible, witnesses, **disclosures**, medical, prior reports, evidence inventory, safety, her stated goals, integrity data). Software adds labels and structure only. It carries "not legal advice" and "not a sworn statement unless signed" notices. *(Some screens and code may still show the old name while the rename is completed.)*

**3. Does it use AI on her account?**
No. The intake is a deterministic script. There is no AI rewriting, summarizing, or "improving" of her account. That is a product principle (PRD §2) and also matters for N.J.R.E. 803(c)(5): a record reworded by software would undercut the requirement that she made or adopted it (Memo §1).

**4. Does anything go to police, a school, or an employer automatically?**
Never. There is no automatic or one-click submission to police, prosecutors, Title IX offices, or employers (PRD §8). This tracks N.J.S.A. 52:4B-60.2 (the right to choose whether to participate in an investigation).

**5. What stage is it at?**
A working MVP with fictional data. Not audited. **No real survivor data** until the gates in GOVERNANCE.md §5 are met: independent security audit, outside cryptographer review of the threat model, licensed-counsel review in NJ and NY, a signed pilot agreement with an organization that has trained advocates, resolution of known blockers (escrow probing, open-ended shares, 18+ enforcement), and a published law-enforcement request guide and incident-response plan.

---

## Discovery, subpoenas, privilege

**6. Can defense counsel subpoena her Matra records?**
- **From Matra:** we can produce **ciphertext and metadata only**: that an account exists, timestamps, record counts and sizes, share relationships, the plaintext alias shown to the attorney, server-side escrow status, audit log, and IP addresses in server logs. Metadata is not nothing (Memo §2).
- **From her:** yes, she can be compelled to produce records in her possession, custody, or control, subject to a motion to quash (R. 1:9-2; Fed. R. Crim. P. 17(c), including 17(c)(3) for victim information). Encryption is not a privilege.
- **From the prosecutor:** anything she gives police is discoverable under R. 3:13-3, and inconsistencies are *Brady*/*Giglio* material.
- Whether NJ courts would apply a heightened standard (like *State v. Chambers* (2023) / *State v. R.F.P.* (2026) for privileged mental-health records) to **non-privileged** victim writings is an open question we want counsel's view on. Our working assumption is that the bar would likely be lower. **[VERIFY]**

**7. So "subpoena-proof" is wrong?**
Yes. We never say it. The accurate claim: *the operator cannot decrypt content, so it cannot produce plaintext. The survivor, and anyone she shares with, can be compelled. Metadata is producible* (Memo §8). The operator-cannot-decrypt claim also assumes the served web code has not been maliciously modified (Whitepaper §5).

**8. Is what she writes privileged?**
Not by default. A personal journal is not privileged just because it is encrypted (*Fisher*; *Upjohn* on facts). Communications with counsel for legal advice are (N.J.R.E. 504; RPC 1.18 for prospective clients). We are designing an **attorney-first route** (PRD N1) where counsel can ask her to prepare her account for counsel, with an attorney-set designation, to strengthen privilege and work-product claims. How far that goes is a question for you.

**9. Does the NJ victim-counselor privilege apply?**
Not to Matra. Matra is not a victim counseling centre and has no counselors (N.J.S.A. 2A:84A-22.13 to -22.16; N.J.R.E. 517). Whether a partnered county program's qualified counselors could communicate through Matra within that privilege is an open question for counsel. NY's analogue (CPLR 4510) is flagged **[VERIFY]** (Memo §2).

**10. Every sealed version is kept. Isn't that impeachment material?**
Yes, and it's a real trade-off. The ledger is append-only; a correction is a new sealed version that supersedes the old one, and both remain. If she produces or shares the full history, routine trauma-memory inconsistencies could be used to impeach (N.J.R.E. 613). Planned mitigations: private, unsealed local drafts; sealing as a deliberate step; plain-language warnings before sealing and sharing (PRD N4, N5). We want counsel's view on the right default.

**11. What about deletion and spoliation?**
She can crypto-shred her account. Ledger hashes remain, so the ledger would show that records existed and were deleted. If litigation is pending or reasonably anticipated, deletion could create spoliation exposure, and N.J.S.A. 2C:28-6 may be implicated **[VERIFY elements]**. The deletion flow must warn and recommend speaking to a lawyer first (Memo §2).

---

## Evidence value

**12. Can a Matra record substitute for her testimony?**
No. A structured account written to establish past events is very likely **testimonial** (*Crawford*, *Davis*, *Bryant*). If she does not testify, the Confrontation Clause bars the State from using it. We never market Matra as a way to avoid testifying (Memo §1).

**13. Is an app entry a "fresh complaint" in New Jersey?**
No. Fresh complaint requires disclosure to **a person** the victim would ordinarily turn to for support (*State v. R.K.*, 220 N.J. 444 (2015); *State v. Hill*, 121 N.J. 150 (1990)). What Matra does is help her and her lawyer identify **who she told, when, how, and what was said**, so counsel can find the actual fresh-complaint witnesses.

**14. Then what evidentiary value does it have?**
Narrow, honest value: a sealed, timestamped record **may** help rebut a claim of *recent* fabrication if made before the alleged motive arose (N.J.R.E. 803(a)(2); *Tome*). In a trial years later it might support recorded recollection (N.J.R.E. 803(c)(5)), read in, not admitted as an exhibit. It can refresh recollection (but see N.J.R.E. 612: the adversary may get to inspect it). It does not make anything "admissible" and does not prove truth.

**15. Is the hash-chain ledger admissible? Who certifies it?**
Hashes go to authentication and integrity (FRE 901(b)(9), 902(13)-(14)), not hearsay or truth. Today the ledger is **self-hosted and not externally anchored**, so it shows integrity, not independent proof of time: the operator controls the clock and could in principle rewrite the whole chain (Whitepaper §4). Before anyone relies on it we need external timestamp anchoring (RFC 3161 or a public log), a documented procedure, and a named custodian. Whether N.J.R.E. 902 has an equivalent of FRE 902(13)-(14) is **[VERIFY]**; in NJ authentication would more likely come through a witness under N.J.R.E. 901.

**16. Photos are metadata-stripped. Doesn't that hurt authenticity?**
It's a trade-off. EXIF/GPS is stripped on her device to protect her location, so the stored copy is a **derivative** whose hash won't match the original, and capture-time metadata is lost. We tell her to **keep the original file and device**. Non-image files are not stripped and the UI warns her. Optional encrypted storage of originals is on the roadmap (Whitepaper §3).

---

## Ethics: UPL, referrals, fees

**17. Is this the unauthorized practice of law?**
We've designed to stay on the scrivener side. Compiling her own words is low risk; the software does **not** suggest charges, elements, remedies, or strategy, and does not recommend whether to report (Memo §5, citing *In re Opinion No. 26*, 139 N.J. 323 (1995) and UPL committee guidance **[VERIFY citation details]**). The VCCO draft fills in what she provided and states the eligibility rules; it does not tell her she qualifies. We want counsel to review the copy.

**18. Is the attorney directory a lawyer referral service or a legal service plan?**
Open question, and the most important one we need counsel to answer (Memo §9 Q1). Current design: a **nonprofit** operates it; **the survivor chooses** from a list of verified attorneys; Matra does not assign, rank, or recommend; no per-referral fees. If counsel concludes it is a legal service plan, we would register under RPC 7.3(e)(4)(vii).

**19. Do attorneys pay anything? Does Matra take a cut of fees?**
No, and never. No listing fees, no referral fees, no share of any fee, settlement, award, or VCCO payment (RPC 5.4(a), 7.2(c), 7.3(d); ACPE 732 / CAA 44 / UPL 54 (2017)). Governance makes this a binding commitment (GOVERNANCE.md §2). Donations from participating attorneys, if any, must be unrelated to referrals, and counsel is asked whether to bar them entirely (MOU §7.3).

**20. What about the NJ VCCO $275/hour?**
Accurate, with qualifiers. N.J.S.A. 52:4B-8(b) and N.J.A.C. 13:75-4.10 pay **$275/hour, up to $10,000**, for legal assistance in matters arising from the victimization, **inside the $25,000** overall claim cap, and **only if the victim is otherwise VCCO-eligible**, which currently means a **police report within 9 months** (the VCCO FAQ also lists filing for a restraining order or sexual violence protective order). Help filing the VCCO claim itself is limited to the lesser of $275/hour or 15% of the award, $500 minimum. Filing deadline: 5 years. Pending bill S1294 would add a forensic-exam exception; status **unconfirmed**. Important framing: VCCO-paid work is **not pro bono**, it doesn't reach survivors who haven't reported, and **Matra takes none of it**. Some stale nj.gov pages still show $125/hr or a $3,000 cap; cite the statute and regulation (Memo §3).

**21. And New York?**
NY OVS reimburses attorney fees only for representation before OVS and/or the Appellate Division on review, **up to $1,000** (Exec. Law § 626). There is no NY analogue to NJ's $10,000 legal-assistance benefit (Memo §3).

---

## Safety, reporting, confidentiality

**22. What about minors and mandatory reporting?**
Matra is **18+ only**. New Jersey makes **any person** a reporter of suspected child abuse (N.J.S.A. 9:6-8.10). Matra staff cannot read content, but attorneys and advocates who receive shares can. The MOU (§6.6) has partners follow their own obligations; a protocol for adults disclosing historical childhood abuse is an open question for counsel, including how RPC 1.6 interacts with 9:6-8.10 (Memo §4, §9 Q6). Age attestation is built into the plan; robust 18+ enforcement is one of the blocking gates.

**23. Campus? Title IX? Clery?**
Any campus channel must keep Matra **structurally independent** of the school so no Title IX "official with authority" (34 C.F.R. 106.30, 2020 rule, restored Sept. 29, 2026) or Clery Campus Security Authority learns of reports through Matra. The institution would receive aggregate, de-identified data at most. The share screen must say whether a school-affiliated recipient is a confidential resource or a mandatory reporter under policy (Memo §4).

**24. Our program is VAWA/VOCA funded. Can we use this?**
Possibly, but check your grant conditions first. VAWA confidentiality (34 U.S.C. 12291(b)(2); and 28 C.F.R. 94.115 for VOCA) bars releasing PII "regardless of whether the information has been encoded, encrypted, hashed," and requires informed, written, **reasonably time-limited** consent. Implications: hashed escrow identifiers are still PII; shares need an expiry (today they are open-ended until revoked, a known blocker); funders must never receive individual-level data (Memo §6).

**25. What if an abuser poses as a survivor, or as an attorney?**
Attorneys: only **verified** attorneys can receive shares; today an admin verifies manually. The pilot adds bar-record checks, organizational attestation, MFA or passkeys, annual re-verification, and the MOU (Whitepaper §5; MOU §3). Every attorney access appears in the survivor's log. Revocation stops future access but **cannot recall what was already downloaded**, which is why the MOU has deletion duties. A malicious server could in theory substitute an attorney's public key; an out-of-band key-fingerprint check is on the pre-pilot list.

---

## The "escrow" (repeat-perpetrator matching)

**26. What is the escrow, and is it live?**
A **demo-only** prototype. A survivor can seal an identifier (a handle, a phone number) for the person responsible. If two accounts seal the same normalized identifier, the server records a match. It is **not for real use** until redesigned (Whitepaper §6).

**27. Who learns of a match?**
**Never the survivor.** Her app always shows "Sealed," and nothing in her own log mentions a match. This prevents a perpetrator from registering, entering his own number, and learning he's been named. No ledger entry is written at match time, so the ledger can't be watched either. The only person told is the **verified attorney the survivor has an active share with**, and only as **counts** (how many of this client's sealed names exist, how many matched): no names, no hashes, nothing about the other survivor. The attorney sees a notice to discuss it with the client and to treat it as a lead, not evidence.

**28. What is a match worth legally?**
A **lead, not evidence**. Other-acts evidence in NJ goes through N.J.R.E. 404(b) and *State v. Cofield*, 127 N.J. 328 (1992); NJ has no counterpart to FRE 413/415. The other survivor's testimony would be needed. A match must never be relayed to third parties as an accusation (defamation and harassment risk). False matches happen (common names, recycled numbers).

**29. What risks remain?**
(1) A perpetrator who gets a verified attorney to accept his "case" could learn of a match through that attorney; mitigated by verification and professional judgment, not cryptography. Attorneys should be alert to a "client" whose named person looks like himself. (2) Whoever holds the server pepper can test low-entropy identifiers like phone numbers. Roadmap: account verification, rate limits, a trained counselor, and OPRF (RFC 9497) with a threshold key, as in Callisto's design. Until then, **escrow stays disabled in any pilot** (Memo §7; Whitepaper §5).

**30. If you match, could I end up with conflicts?**
If a counselor-mediated matching program ever exists, any attorney receiving matched survivors must assess joint-representation conflicts (RPC 1.7) first (MOU §5.3). Not applicable today.

---

## Practicalities

**31. What would you ask me to commit to?**
Depends on your role (see [MEETING_PLAYBOOK.md](MEETING_PLAYBOOK.md)). For a partner attorney, the draft MOU asks: verification documents; acknowledge each share within **[3] business days** (accept or decline); honor her safe-contact instructions; run conflicts with minimal information; secure storage; deletion on revocation or decline if no relationship formed; no fee sharing; breach notice within 72 hours. **No real matters until the gates are met.** Right now the most valuable thing is review: the consent text, the warnings, the summary format, and the referral structure.

**32. What liability do I take on?**
Your usual professional obligations for any matter you accept. Matra provides the platform "as is" and does not direct your judgment (RPC 5.4(c)); the MOU's indemnity and limitation clauses are bracketed for counsel. We will not ask you to rely on Matra's ledger or claims in court beyond what the Whitepaper supports (MOU §8.2).

**33. How is this different from Callisto?**
Callisto pioneered encrypted matching with a lawyer "Legal Options Counselor" and stronger cryptography (OPRF, key federation, Shamir sharing), historically for college students. Matra's focus is the documentation-to-attorney pipeline for adults in NJ and NY, with VCCO drafting. Our matching is behind Callisto's and stays demo-only until it catches up. We'd like to learn from them, not compete.

**34. How is it funded? How does it survive?**
Grants and donations only, through a 501(c)(3) fiscal sponsor (being sought) and later possibly its own nonprofit. No revenue from attorneys, cases, data, or advertising. Partners with VOCA or OVW Legal Assistance for Victims funding could treat Matra as an intake-efficiency tool within their projects, subject to their grant conditions. If Matra shuts down, governance requires 90 days' notice and data export.

**35. Where's the code? Can our IT or a security person look?**
Yes. It's open source under AGPL-3.0, and we welcome review. The Whitepaper and threat model describe what is and isn't protected. Please report vulnerabilities through SECURITY.md rather than publicly.

---

*Matra is a pre-pilot prototype. Nothing here is legal advice. Corrections are welcome and will be credited with permission.*
