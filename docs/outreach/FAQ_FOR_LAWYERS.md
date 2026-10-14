# Matra: FAQ for Lawyers

*For pro-bono attorneys, legal-aid directors, clinic faculty, and victims'-rights counsel. Updated 2026-10-07.*

> **Read this first.** Matra is a **pre-pilot prototype**. It runs on **invented data only**, it has **not had an independent security audit**, and none of this is legal advice. The legal analysis behind these answers was prepared by a non-lawyer research function and **has not been reviewed by licensed counsel**. Reviewing it is one of the things we are asking you for. Sources: [Legal Research Memo](../LEGAL_RESEARCH_MEMO.md) (cited below as "Memo"), [Security Whitepaper](../SECURITY_WHITEPAPER.md) ("Whitepaper"), [PRD](../PRD.md), [MOU template](../ATTORNEY_PARTNER_MOU_TEMPLATE.md).

---

## The product

**1. What is Matra, in one paragraph?**
A nonprofit, open-source (AGPL-3.0) web app for adult (18+) survivors of sexual assault in New Jersey and New York. A warm, story-first intake helps her document what happened at her own pace, in any order, typed or spoken (speech is transcribed on her device), or one question at a time; every question is skippable and her words are stored verbatim. Content is encrypted on her device, so the operator holds only ciphertext. From her record she can generate, on her device, an **Incident Summary in the Survivor's Own Words**, an **evidence inventory** (with SHA-256 hashes), and an **NJ VCCO compensation application draft**. Only if she chooses, she can share a scoped, re-encrypted copy with a verified attorney she picks from a directory. She can revoke at any time and she sees every time the attorney opens or downloads it.

**2. What does "Incident Summary in the Survivor's Own Words" mean? Is it a police report?**
No. It was originally called the "Police Evidentiary Brief" and is being renamed because the old name implied legal work product and a police audience (Memo §1, §5). It reproduces her own words verbatim in labelled sections (her account, sensory details, statements by the person responsible, witnesses, **disclosures**, medical, prior reports, evidence inventory, safety, her stated goals, integrity data). Software adds labels and structure only. It carries "not legal advice" and "not a sworn statement unless signed" notices. *(Some screens and code may still show the old name while the rename is completed.)*

**3. Does it use AI on her account?**
Nothing rewrites her words. Voice is transcribed and suggestions are made on her device, and she confirms every one; no AI runs on any server or third-party service. Nothing summarizes or "improves" her account either. The two optional helpers run **only in her browser**; the speech model (about 94 MB) downloads once from Matra's own server, never from a third party. Speech-to-text turns her spoken words into text she can review. On-device suggestions propose where a piece belongs (a date, a person), and she confirms or dismisses each one. The one-question-at-a-time mode is a deterministic script. Verbatim storage is a product principle (PRD §2), and it matters for N.J.R.E. 803(c)(5): a record reworded by software would undercut the requirement that she made or adopted it (Memo §1). *Counsel may want to consider whether an on-device transcript she reviewed counts as her own words for that purpose* **[VERIFY]**.

**4. Does anything go to police, a school, or an employer automatically?**
Never. There is no automatic or one-click submission to police, prosecutors, Title IX offices, or employers (PRD §8). This tracks N.J.S.A. 52:4B-60.2 (the right to choose whether to participate in an investigation).

**5. What stage is it at?**
A working MVP with fictional data. Not audited. **No real survivor data** until the gates in GOVERNANCE.md §5 are met: independent security audit, outside cryptographer review of the threat model, licensed-counsel review in NJ and NY, a signed pilot agreement with an organization that has trained advocates, resolution of known blockers (escrow probing, 18+ enforcement; open-ended shares are now fixed: shares expire), and a published law-enforcement request guide and incident-response plan.

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
Yes, and it's a real trade-off. The ledger is append-only; a correction is a new sealed version that supersedes the old one, and both remain. If she produces or shares the full history, routine trauma-memory inconsistencies could be used to impeach (N.J.R.E. 613). Mitigations: plain-language warnings before she starts writing, before sealing ("Every saved version is kept") and before sharing are built (PRD N4); private, unsealed local drafts and sealing as a deliberate step are planned (PRD N5). We want counsel's view on the right default.

**11. What about deletion and spoliation?**
She can crypto-shred her account. Ledger hashes remain, so the ledger would show that records existed and were deleted. If litigation is pending or reasonably anticipated, deletion could create spoliation exposure, and N.J.S.A. 2C:28-6 may be implicated **[VERIFY elements]**. The "Delete everything" screen leads with that caution (talk to a lawyer before deleting; information, not advice), says what is and isn't deleted (including that copies an attorney already downloaded can't be recalled), offers "Download my data" first, and needs a typed confirmation (Memo §2).

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
It's a trade-off. EXIF/GPS is stripped on her device to protect her location, so the stored copy is a **derivative** whose hash won't match the original, and capture-time metadata is lost. We tell her to **keep the original file and device** whenever she adds evidence, and the HEIC and PDF advice says to keep the original too. Non-image files are not stripped and the UI warns her. Optional encrypted storage of originals is on the roadmap (Whitepaper §3).

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
Possibly, but check your grant conditions first. VAWA confidentiality (34 U.S.C. 12291(b)(2); and 28 C.F.R. 94.115 for VOCA) bars releasing PII "regardless of whether the information has been encoded, encrypted, hashed," and requires informed, written, **reasonably time-limited** consent. Implications: hashed escrow identifiers are still PII; shares need an expiry (built: default 90 days, she can choose 30 days to 1 year, and renew); funders must never receive individual-level data (Memo §6).

**25. What if an abuser poses as a survivor, or as an attorney?**
Attorneys: only **verified** attorneys can receive shares; today an admin verifies manually. The pilot adds bar-record checks, organizational attestation, MFA or passkeys, annual re-verification, and the MOU (Whitepaper §5; MOU §3). Every attorney access appears in the survivor's log. Revocation stops future access but **cannot recall what was already downloaded**, which is why the MOU has deletion duties. A malicious server could in theory substitute an attorney's public key; the share screen already makes her confirm the attorney's key fingerprint (read to her by phone or in person) before sharing; verification through the attorney's organization is on the pre-pilot list.

---

## Confidential matching (repeat-perpetrator "escrow")

**26. What is matching, and is it live?**
A **demo-only** prototype, now being rebuilt along the lines of Callisto's published design (Rajan et al., COMPASS 2018). A survivor can opt in to seal a **unique identifier** (phone, email, social handle; never a name) for the person responsible. Her device normalizes it, so `@handle` and the profile URL are the same, and runs an OPRF against two key servers, so the server never sees the raw identifier. If two different accounts seal the same identifier, a match is recorded. It is **not for real use** until audited and reviewed by counsel (Whitepaper §6; Memo §7A).

**27. Who learns of a match?**
**Never the survivor in the app.** Her app always shows "Sealed," and nothing in her own log mentions a match. This prevents a perpetrator from registering, entering his own number, and learning he's been named. No ledger entry is written at match time. In the rebuild, a **Legal Options Counselor**, a licensed NJ or NY **attorney** under contract, sees the matched group. The counselor checks it for plausibility, then contacts **each** survivor separately, once, by the safe method she chose when she opted in. The counselor explains options, including doing nothing, and introduces survivors only if both agree. The counselor takes no fee from survivors, and we propose that the counselor not take paid representation of anyone they contact.

**27A. Why an attorney, not an advocate? Isn't contacting her solicitation?**
Callisto's design relied on attorney-client privilege for what the counselor sees. When Callisto moved that role to advocates in April 2026, its privacy policy said privilege no longer applied ([privacy policy](https://www.projectcallisto.org/privacy-policy)). We keep an attorney, and we commit never to change that without at least 90 days' notice and a chance to withdraw ([Succession and Data Promise](../SUCCESSION_AND_DATA_PROMISE.md) D7). On solicitation: she opted in to this specific contact, the counselor seeks no employment or fee, and the protocol respects her state of mind (one contact, easy "no", no follow-up). We think that keeps the contact outside NJ RPC 7.3(b) and NY Rule 7.3 (compare *In re Primus*, 436 U.S. 412 (1978)). **This is exactly the question we need you to check** (Memo §7A, §9 Q10).

**28. What is a match worth legally?**
A **lead, not evidence**. Other-acts evidence in NJ goes through N.J.R.E. 404(b) and *State v. Cofield*, 127 N.J. 328 (1992); NJ has no counterpart to FRE 413/415. The other survivor's testimony would be needed. A match must never be relayed to third parties as an accusation (defamation and harassment risk). False matches happen (common names, recycled numbers).

**29. What risks remain?**
(1) **Fake accounts** created to push a target past the threshold and expose a real survivor's entry to the counselor. Mitigations: account verification without a user list (for example partner-issued invite codes), OPRF rate limits per verified account, and counselor review before any contact. (2) **Key-server compromise.** If both OPRF key shares are compromised or held by one operator, low-entropy identifiers such as phone numbers can be tested. The design puts the shares with independent operators. (3) **Metadata.** The server still sees that entries share an identifier class and when they were made. (4) **Counselor key misuse.** The counselor gets no OPRF access and only server-released matched entries, and every decryption is logged. The earlier demo design, where the pepper holder could test identifiers, is being replaced. Until the rebuild is reviewed, **matching stays disabled in any pilot** (Memo §7, §7A; Whitepaper §5).

**30. If you match, could I end up with conflicts?**
The counselor gives limited-scope options counseling (RPC 1.2(c)) and should not represent two matched survivors jointly. An introduction is not representation. Any attorney a matched survivor later chooses must assess joint-representation conflicts (RPC 1.7) and prospective-client duties (RPC 1.18) first (MOU §5.3). Because Matra or a partner pays the counselor, RPC 1.8(f) and 5.4(c) apply. Not live today.

---

## Practicalities

**31. What would you ask me to commit to?**
Depends on your role (see [MEETING_PLAYBOOK.md](MEETING_PLAYBOOK.md)). For a partner attorney, the draft MOU asks: verification documents; acknowledge each share within **[3] business days** (accept or decline); honor her safe-contact instructions; run conflicts with minimal information; secure storage; deletion on revocation or decline if no relationship formed; no fee sharing; breach notice within 72 hours. **No real matters until the gates are met.** Right now the most valuable thing is review: the consent text, the warnings, the summary format, and the referral structure.

**32. What liability do I take on?**
Your usual professional obligations for any matter you accept. Matra provides the platform "as is" and does not direct your judgment (RPC 5.4(c)); the MOU's indemnity and limitation clauses are bracketed for counsel. We will not ask you to rely on Matra's ledger or claims in court beyond what the Whitepaper supports (MOU §8.2).

**33. What happened to Callisto, and how is Matra different?**
For more than a decade, Callisto showed that survivors want private, survivor-controlled ways to document harm and to find out they are not alone. Matra's matching design follows its published research. On 22 July 2026 Callisto's board announced it is closing, citing funding. A multi-year grant did not come through, and in the board's words adult sexual assault survivors are "without a clear home in anyone's portfolio". New accounts are disabled, existing users can download their records, and Callisto is looking for a new home for its technology ([Callisto, 22 Jul 2026](https://www.projectcallisto.org/blog/closing)). It is a loss for the field. We don't claim to replace Callisto, and we don't approach its users.

What we've changed because of its experience ([research notes](../research/callisto.md)):
- **Who it serves:** adults anywhere in NJ and NY, not .edu-gated, and focused on the path from documentation to an attorney, including VCCO drafting.
- **Funding:** access-to-justice and victim-services framing, no funder above about 30%, no campus or employer licensing, and a 6–12-month reserve before real data ([Sustainability Plan](../SUSTAINABILITY_PLAN.md)).
- **Trust during change:** no deletion without her consent, at least 90 days' notice, export always, opt-in-only migration to a named successor, and no silent confidentiality downgrade ([Succession and Data Promise](../SUCCESSION_AND_DATA_PROMISE.md)).
- **Counselor:** an attorney, for privilege (27A).

We'd welcome a conversation with Callisto's team on its terms. We hold no view on how it should handle its users or its technology.

**34. How is it funded? How does it survive?**
Grants and donations only, through a 501(c)(3) fiscal sponsor (being sought) and later possibly its own nonprofit. No revenue from attorneys, cases, data, or advertising. Partners with VOCA or OVW Legal Assistance for Victims funding could treat Matra as an intake-efficiency tool within their projects, subject to their grant conditions. Diversification rules (no funder above about 30%), reserve targets, and privacy-preserving impact measurement are in the [Sustainability Plan](../SUSTAINABILITY_PLAN.md). If Matra shuts down, survivors get at least 90 days' notice and export throughout. Encrypted data moves to a named successor nonprofit **only with each survivor's opt-in**, and everything else is crypto-shredded at the end of notice. A ring-fenced wind-down reserve pays for this ([Succession and Data Promise](../SUCCESSION_AND_DATA_PROMISE.md); several items still need board and counsel adoption).

**35. Where's the code? Can our IT or a security person look?**
Yes. It's open source under AGPL-3.0, and we welcome review. The Whitepaper and threat model describe what is and isn't protected. Please report vulnerabilities through SECURITY.md rather than publicly.

---

*Matra is a pre-pilot prototype. Nothing here is legal advice. Corrections are welcome and will be credited with permission.*
