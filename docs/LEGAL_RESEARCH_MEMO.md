# Matra: Legal Research Memorandum

**To:** Matra founding team, advisory council, and prospective partner counsel
**Re:** Evidentiary, privilege, ethics, funding, reporting, and privacy issues raised by the Matra MVP
**Jurisdictions:** New Jersey (primary), New York (secondary), federal
**Research date:** 2026-10-06 (§7A, Callisto updates and §9 additions: 2026-10-07)

> **Not legal advice.** This memo was prepared by a non-lawyer research function to help counsel review the product. It has not been reviewed by a licensed attorney. Every conclusion must be checked by licensed New Jersey and New York counsel before anyone relies on it, especially before we make statements to survivors. Citations were checked against primary or official sources where we could reach them. Items we could not confirm are marked **[VERIFY]**.

---

## 0. Executive summary

| # | Topic | Bottom line |
|---|---|---|
| 1 | Confrontation and hearsay | Matra records cannot replace live testimony. If the State offered a statement the survivor wrote for police (for example, the "Police Evidentiary Brief") while she did not testify, it would very likely be **testimonial** under *Crawford* and *Davis* and therefore barred. An app entry is also **not** a "fresh complaint" in New Jersey, because that doctrine requires disclosure to *a person* the victim would naturally turn to for support. The app's real evidentiary value is narrower. It can document *who she told* (the actual fresh-complaint witnesses), help preserve her own recollection, and, in limited cases, be a prior consistent statement or a recorded recollection. |
| 2 | Discoverability | Zero-knowledge encryption means **Matra (the operator) cannot produce plaintext**. The **survivor can still be compelled**, and so can any attorney or prosecutor she shares with. Once a record reaches the prosecutor it is discoverable to the defense (R. 3:13-3, *Brady*/*Giglio*). Every sealed version is kept (WORM), so inconsistencies between versions are potential impeachment material. A survivor's own journal is **not privileged** merely because it is encrypted. Privilege is most likely to attach when the survivor writes **at an attorney's direction, for the purpose of legal advice**. |
| 3 | VCCO attorney fees | **The "$275/hour" figure is accurate, but the blueprint's framing is wrong.** N.J.S.A. 52:4B-8(b) and N.J.A.C. 13:75-4.10 pay **$275/hr, capped at $10,000**, for legal assistance in matters arising from the victimization. Payment counts within the **$25,000** overall award cap and is available **only if the victim is otherwise eligible**, which currently requires a **police report within 9 months** (not "90 days"). Help with the VCCO claim itself is paid at the lesser of $275/hr or 15% of the award, with a $500 minimum. An attorney who is paid by VCCO is not providing "pro bono" service in the usual sense. Matra may never take any share of those fees. |
| 4 | Mandatory reporting | New Jersey requires **any person** to report suspected child abuse (N.J.S.A. 9:6-8.10). The MVP must be **18+ only**. A campus pilot must keep Matra structurally independent of the school, so that no "official with authority" (Title IX) or Campus Security Authority (Clery) learns of reports through Matra. |
| 5 | UPL and referrals | Compiling the survivor's own words into a document is low-risk scrivener work. Advising her on charges, elements, or which forms to file is not. New Jersey forbids **for-profit** lawyer referral and fee sharing (RPC 5.4(a), 7.2(c), 7.3(d); ACPE 732/CAA 44/UPL 54 (2017)). Any matching function should be run by a **nonprofit**, charge no per-referral fees, and be registered as a legal service plan under RPC 7.3(e)(4)(vii) if counsel concludes it is one. The blueprint's PBC/equity option is incompatible with the attorney-routing feature unless that feature is run by a separate nonprofit. |
| 6 | Privacy | HIPAA almost certainly does not apply. The New Jersey breach statute applies, and the NJ Data Privacy Act has **no nonprofit exemption**, although its thresholds will not be met during a pilot. If we accept VAWA or VOCA funds, **VAWA confidentiality** (34 U.S.C. 12291(b)(2)) applies. It forbids disclosure of personally identifying information **"regardless of whether the information has been encoded, encrypted, hashed"**, and it requires consent to be **"reasonably time-limited"**. This affects escrow hashes and how long shares last. |
| 7 | Escrow | A match is a **lead, not evidence**. New Jersey has **no counterpart to FRE 413**. Other-acts evidence goes through N.J.R.E. 404(b) and the four-part *Cofield* test. The original MVP let anyone who knew an identifier **probe whether it had been reported**, including a perpetrator checking his own phone number. **That self-check is now mitigated:** survivors never see match results, and matches go only to the verified attorney a survivor has actively shared with. Residual risks remain (see section 7 and the Security Whitepaper). |
| 7A | Legal Options Counselor | Matching is being rebuilt so a **Matra-contracted attorney counselor** reviews matched groups and contacts each matched survivor who opted in. Keep the counselor an **attorney**: Callisto's design rested on attorney-client privilege, and its April 2026 move to advocates came with an explicit warning that privilege no longer applied. Because she opted in and the counselor takes no fee, the contact is probably not prohibited solicitation under **NJ RPC 7.3**. That conclusion depends on structure (no pecuniary motive, prior specific consent, respect for her state of mind) and **must be confirmed by counsel**. |

---

## 1. Confrontation Clause and hearsay: what can a Matra record do in court?

### Question
Are a survivor's pre-trial written or app statements "testimonial"? Can they substitute for her testimony or corroborate it? Do any hearsay exceptions apply, including New Jersey's fresh-complaint doctrine?

### Short answer
Matra statements cannot substitute for testimony. A statement written to create a record for police or prosecution is very likely testimonial. If the survivor does not testify and has not been available for cross-examination, the Sixth Amendment bars the State from offering it against the accused. If she **does** testify and is cross-examined, the Confrontation Clause is satisfied (*Crawford*, 541 U.S. at 59 n.9), and admissibility turns on ordinary hearsay rules. Her app entries will rarely fit those rules. In New Jersey the most useful doctrine is **fresh complaint**, which covers her disclosures *to people*, not to software.

### Discussion

**Testimonial statements.**
- *Crawford v. Washington*, 541 U.S. 36 (2004): testimonial hearsay from an absent witness is admissible only if the witness is unavailable and the defendant had a prior opportunity to cross-examine. https://supreme.justia.com/cases/federal/us/541/36/
- *Davis v. Washington*, 547 U.S. 813 (2006): the "primary purpose" test. Statements made to meet an ongoing emergency (a 911 call) are nontestimonial. Statements made to establish past events for later prosecution (the *Hammon* affidavit) are testimonial. https://supreme.justia.com/cases/federal/us/547/813/
- *Michigan v. Bryant*, 562 U.S. 344 (2011): primary purpose is assessed objectively, considering formality and whether an emergency was ongoing. https://supreme.justia.com/cases/federal/us/562/344/
- *Ohio v. Clark*, 576 U.S. 237 (2015): statements to people other than law enforcement are "much less likely" to be testimonial, but the test is still primary purpose. https://supreme.justia.com/cases/federal/us/576/237/

**Application to Matra.** A private journal entry written only for the survivor herself is arguably nontestimonial (compare *Clark*). However, our intake is a structured, formal account. It produces a document titled for **police**, and it is designed to be shared with attorneys and potentially law enforcement. A court would likely find that the primary purpose of at least the sealed record and the brief is to "establish or prove past events potentially relevant to later criminal prosecution" (*Davis*). **Product consequence:** we must never market Matra as a way to avoid testifying, or as something that "speaks for her" in court. If a case goes to trial, she will almost certainly need to testify.

**Hearsay routes, if she testifies:**

1. **Fresh complaint (New Jersey common law).** Evidence of a victim's complaint of sexual abuse is admissible, though otherwise hearsay, "to negate the inference that the victim's initial silence or delay indicates that the charge is fabricated." To qualify, the statement must be made "spontaneously and voluntarily, within a reasonable time after the alleged assault, **to a person the victim would ordinarily turn to for support**." It proves only *that she complained*, not the truth of the details, and courts limit its detail and its repetition. *State v. R.K.*, 220 N.J. 444, 455-56 (2015) (citing *State v. Hill*, 121 N.J. 150, 163 (1990)), https://www.njcourts.gov/system/files/court-opinions/2015/a_39_13.pdf. The State bears the burden, and delays must be explained. See *State v. I.G.* (Law Div. Mar. 18, 2026) (unpublished; motion denied for a five-year delay), https://www.njcourts.gov/system/files/court-opinions/2026/mer-25-1708-fresh-complaint.pdf.
   - **An app entry is not a fresh complaint.** Software is not "a person the victim would ordinarily turn to for support." Whether a confidential advocate reached *through* a platform could qualify is untested **[VERIFY with counsel]**.
   - **What Matra does well:** the intake's `disclosures` section (who she told, when, how, and what was said) helps counsel identify and preserve the **actual** fresh-complaint witnesses. This is the honest version of the blueprint's claim.

2. **Prior consistent statement to rebut recent fabrication.** N.J.R.E. 803(a)(2) and Fed. R. Evid. 801(d)(1)(B) admit a testifying witness's prior consistent statement offered to rebut a charge of recent fabrication or improper motive. Under federal law the statement must have been made **before** the alleged motive to fabricate arose. *Tome v. United States*, 513 U.S. 150 (1995), https://supreme.justia.com/cases/federal/us/513/150/. A sealed, timestamped record made soon after the incident and before any alleged motive (a custody dispute, a breakup, a civil claim) can therefore help. It does not help if the defense theory is that the motive existed from the start.

3. **Recorded recollection.** N.J.R.E. 803(c)(5) and Fed. R. Evid. 803(5) require the following. The witness must testify that she lacks sufficient present recollection. The record must have been made when the matter was fresh in her memory, by her or at her direction. It must have been accurate when made. The record is **read into evidence, not received as an exhibit** unless the adversary offers it. This is a narrow fallback for trials years later. It is not a general admissibility route for the brief (see `compiled_resources/02_digital_evidence_chain_of_custody/SOURCES.md`). **Verbatim storage matters:** software rewording would undermine the requirement that the witness made or adopted the record.

4. **Excited utterance.** N.J.R.E. 803(c)(2) and FRE 803(2) are unlikely to apply. Typing a structured account through a multi-step intake is reflective, not spontaneous. A message sent in the immediate aftermath, such as a text to a friend, is a better candidate, and that is evidence she already holds, not Matra's.

5. **Refreshing recollection.** If she uses a Matra record to refresh her memory, the adverse party may be entitled to inspect it. N.J.R.E. 612 and FRE 612 give the court discretion when the writing is used before testifying. This is a quiet but significant discovery path (see section 2).

**Authentication versus truth.** Hash chains and timestamps go to **authentication and integrity** (FRE 901(b)(9), 902(13)-(14); the 2017 Advisory Committee notes identify hash values as the typical method of "digital identification", https://www.law.cornell.edu/rules/fre/rule_902). They do **not** make content admissible over a hearsay or confrontation objection, and they do not prove the content is true. Rule 902(13)-(14) also requires a certification by a qualified person and pretrial notice. Matra will need a documented procedure and a named custodian who can certify ledger output. Whether New Jersey's N.J.R.E. 902 has a direct equivalent of FRE 902(13)-(14) is **[VERIFY]**. In New Jersey the operator would more likely authenticate through witness testimony under N.J.R.E. 901.

### Product implications
- Retire the claims that Matra "blocks defense claims of late fabrication" or "makes statements admissible." Replace them with: *"A sealed, timestamped record can corroborate when and what you documented. It may help rebut a claim of recent fabrication in some cases. It cannot replace your testimony."*
- Keep narratives **verbatim** and record the survivor's explicit **adoption** (with a timestamp) of any derived document, such as the brief.
- Rename the "Police Evidentiary Brief" to something like **"Incident Summary (survivor's own words)"**, and do not frame it as prepared *for* police. See section 5 (UPL) and section 2 (discoverability).
- Highlight the **disclosures** section as the way to identify fresh-complaint witnesses.

---

## 2. Discoverability, subpoenas, and privilege

### Question
Can the defense obtain a survivor's Matra records? Do drafts and journal entries become discoverable? When does attorney-client privilege, work product, or the New Jersey victim-counselor privilege attach?

### Short answer
- **From Matra (the company):** a subpoena or warrant would yield **ciphertext and metadata only**. That metadata includes account existence, timestamps, record counts and sizes, share relationships (which survivor account shared with which attorney, and when), the plaintext alias shown to the attorney, escrow match status (stored server-side even though survivors are never shown it), the audit log, and the IP addresses in server logs. Matra cannot decrypt content. This is accurate and valuable, but **metadata is not nothing**.
- **From the survivor:** she can be **compelled** to produce records within her possession, custody, or control, subject to a motion to quash. In a criminal case the Fifth Amendment does not protect a non-defendant witness from producing non-incriminating records. Encryption is not a privilege.
- **From the prosecutor:** anything the survivor gives police or the prosecutor is within the State's possession. It is discoverable under **R. 3:13-3**, and any inconsistency with her testimony is impeachment material that must be disclosed under *Brady v. Maryland*, 373 U.S. 83 (1963) and *Giglio v. United States*, 405 U.S. 150 (1972).
- **Privilege:** a survivor's journal written for herself is **not privileged**. Communications with an attorney made for the purpose of legal advice **are** privileged (N.J.R.E. 504). This includes communications from a prospective client (RPC 1.18). Pre-existing documents do not become privileged by being sent to a lawyer (*Fisher v. United States*, 425 U.S. 391 (1976)), and underlying facts are never privileged (*Upjohn Co. v. United States*, 449 U.S. 383 (1981)).

### Discussion

**Correction to the blueprint.** The blueprint cites *Upjohn* for the question of whether data entered into a non-attorney platform waives confidentiality. *Upjohn* concerns the scope of **corporate** privilege for employee communications with company counsel. Its relevance here is limited to its statement that facts themselves are not privileged. The real questions are (a) whether a communication was *to* counsel for legal advice, and (b) whether routing it through a third-party service waives confidentiality. On (b), using a service provider that cannot read the content, under reasonable security, is generally consistent with confidentiality. See ABA Formal Op. 477R (2017) on securing client communications **[VERIFY applicable NJ ACPE opinions on cloud services]**.

**Defense subpoenas to third parties and victims.**
- *Federal:* Fed. R. Crim. P. 17(c) subpoenas must meet the *United States v. Nixon*, 418 U.S. 683 (1974) standard of relevance, admissibility, and specificity. Under **Rule 17(c)(3)**, once a charge is filed, a subpoena for "personal or confidential information about a victim" may be served on a third party **only by court order**, and the victim must generally receive notice and an opportunity to move to quash. https://www.law.cornell.edu/rules/frcrmp/rule_17
- *New Jersey:* subpoenas duces tecum issue under **R. 1:9-2**, and the court may quash or modify them if compliance would be "unreasonable or oppressive." For a sexual-assault victim's privileged mental-health records, the New Jersey Supreme Court requires a heightened, particularized showing before in camera review. *State v. Chambers*, 288 A.3d 12 (N.J. 2023) requires a substantial, particularized need, shown by a preponderance, that cannot be met by less intrusive means (https://statecourtreport.org/sites/default/files/fastcase/converted/State%20v.%20Chambers%2C%20N.J.%20A-35-21.pdf). In *State v. R.F.P.*, A-5-25 (N.J. July 9, 2026), a 5-2 Court upheld an order for limited in camera review and noted the victim had not received the notice state law requires (https://www.njcourts.gov/cases/a-5-25; https://newjerseymonitor.com/2026/07/09/njs-top-court-says-defendant-can-seek-sex-assault-victims-mental-health-records/). The Chambers/R.F.P. framework addresses privileged mental-health records. Unprivileged personal writings, such as a Matra journal, would likely face a **lower** bar. **[VERIFY: whether NJ courts apply a comparable heightened standard to non-privileged victim records.]** (Note: **R. 3:9-3**, sometimes cited in early research notes, governs plea discussions, not subpoenas.) We could not locate the blueprint's "*State v. Kane*" third-party-records case and do not rely on it.
- *Pennsylvania v. Ritchie*, 480 U.S. 39 (1987): due process may entitle a defendant to in camera review of confidential records that are material to the defense.

**Drafts and versions.** Matra's vault is append-only. A correction creates a new sealed version that "supersedes" the old one, and the old one is kept. This is good for integrity but creates a **record of every change**. If the survivor is compelled to produce, or chooses to share, the full version history could expose immaterial inconsistencies that are routine in trauma memory. Defense counsel may use them to impeach (N.J.R.E. 613; FRE 613). Trauma-informed expert testimony can address this, but survivors must be told in advance.

**Deletion and spoliation.** Account deletion ("crypto-shred") permanently destroys ciphertext and keys, while ledger hashes remain. If litigation is pending or reasonably anticipated, destroying relevant records can create **spoliation** exposure in civil cases and potentially criminal exposure: N.J.S.A. 2C:28-6 makes it an offense to destroy a record "believing that an official proceeding or investigation is pending or about to be instituted" **[VERIFY elements with counsel]**. The ledger would also show that records existed and were deleted. The deletion flow must warn about this and recommend consulting an attorney first.

**Work product.** Materials prepared in anticipation of litigation by or for a party or its representative receive protection (civil: R. 4:10-2(c); FRCP 26(b)(3); criminal: R. 3:13-3 work-product limits). A survivor writing on her own, before any litigation, is unlikely to qualify. Writing **at counsel's request** for the case strengthens the claim.

**New Jersey victim-counselor privilege.** N.J.S.A. 2A:84A-22.13 to -22.16 (N.J.R.E. 517) protect confidential communications between a victim and a **"victim counselor"**. That is a person working at a qualifying **victim counseling centre**, who has completed **40 hours of training**, and who is under a direct-services supervisor. The privilege can be waived only by the victim's written consent. https://ruledex.com/new-jersey/new-jersey-rules-of-evidence/article-v-privileges/rule-517-victim-counselor-privilege/. *State v. J.G.*, 261 N.J. Super. 409 (App. Div. 1993), read the privilege broadly. It declined in camera inspection absent a compelling reason and held that a mistaken release was not a waiver (https://case-law.vlex.com/vid/state-v-j-g-888714600). **Matra is not a victim counseling centre and has no counselors, so the privilege does not attach to Matra itself.** A partnered county sexual-violence program whose qualified counselors communicate with survivors could potentially bring *those* communications within the privilege **[VERIFY the structure with counsel]**. New York's analogue is CPLR 4510, the rape crisis counselor privilege **[VERIFY]**.

### What is true about "it is mathematically impossible to hand over raw data"

| Claim | Accurate version |
|---|---|
| "Mathematically impossible to hand over raw data" | **Matra the operator** cannot decrypt survivor content, so it cannot produce plaintext in response to a subpoena or warrant. This is true *as long as* the client code served to users is not modified (see the Security Whitepaper on malicious-update risk). **The survivor, and anyone she shares with, can be compelled to produce plaintext.** Matra *can* produce metadata. |
| "Subpoena-proof" | False. Content is protected from compelled production *by the company*. The person holding the passphrase remains subject to ordinary process. |

### Product implications (design mitigations)
1. **Attorney-first routing (recommended default for the next phase).** Offer "Talk to a lawyer first" before the long narrative intake. Once an attorney-client or prospective-client relationship exists, the attorney can direct the survivor to prepare her account for counsel. This places the communication within N.J.R.E. 504 and strengthens any work-product claim. The record should then carry a "Prepared at the request of counsel for the purpose of legal advice" designation, decided by the attorney, not by software.
2. **Plain-language warnings** at intake start, before sealing, before sharing, and before deletion. Examples: *"Matra can't read this. But a court can order **you** to hand it over. Anything you give police will be shared with the defense."* and *"Every saved version is kept."*
3. **Separate a private "notes" space from sealed statements.** Drafts stay local, unsealed, and deletable. Only what she chooses to seal enters the ledger. Counsel must review this design because of the spoliation timing.
4. **Never auto-send** anything to police, schools, or employers. This is already a product invariant.
5. **Transparency:** publish a law-enforcement-request policy and a transparency report (see section 6).
6. **Minimize metadata:** encrypt the survivor alias shown to the attorney, pad blob sizes, and set retention for server logs.

---

## 3. Victims' rights, attorney fees, and funding

### Question
What do New Jersey's victims' rights framework and VCCO actually provide? Is "VCCO reimburses attorneys at $275/hour" correct? What funding streams are available for attorneys and for the platform?

### Short answer: the $275/hour verdict
**Verified, but the claim as framed in the blueprint ("$275/hr up to statutory caps"; "report filing deadlines (typically within 90 days)") is incomplete and partly wrong.**

| Item | Current law | Source |
|---|---|---|
| Legal assistance in matters arising from the victimization (enforcing victims' rights in all courts, family law, protective and restraining orders, employment, public benefits, and more) | **$275/hour, maximum $10,000** per victim. The statute says "$275 or more to be fixed by the office" and the regulation fixes $275.00. | N.J.S.A. 52:4B-8(b) (P.L.2019, c.380); N.J.A.C. 13:75-4.10 (amended 53 N.J.R. 1852(c), eff. 11/1/2021) https://www.law.cornell.edu/regulations/new-jersey/N-J-A-C-13-75-4-10 ; https://www.nj.gov/oag/njvictims/pdfs/vcco-law-changes_2020-0821c.pdf |
| Condition | Paid only if the victim "is otherwise eligible to receive compensation", and it counts toward the 52:4B-18 limit | N.J.S.A. 52:4B-8(b) (statute compilation: https://www.nj.gov/oag/njvictims/pdfs/2020-08-01_Statute.pdf) |
| Representing the applicant *before VCCO* | At most 15% of the award, paid in addition to it, with a **$500 minimum**. $500 may be paid even on denial if counsel was diligent. Asking for more is unlawful. | N.J.S.A. 52:4B-8(a); see `docs/research/brief-fields.md` §2.1 (VCCO application: the lesser of $275/hr or 15%) |
| Overall cap | **$25,000** per claim (supplemental amounts exist for catastrophic injury) | N.J.S.A. 52:4B-18 |
| Police-report requirement | Reported to law enforcement **within 9 months** of the occurrence or reasonable discovery. The VCCO FAQ also lists filing a restraining order or sexual violence protective order. It is **not 90 days**; 90 days was the pre-2020 rule, and today 90 days is VCCO's *decision* deadline. A bill (S1294) would add an exception for victims who had a forensic exam but did not report. Its status is **unconfirmed** as of this memo. | N.J.S.A. 52:4B-18; https://www.njoag.gov/wp-content/uploads/2025/05/NJ-VCCO-FAQ.pdf ; `docs/research/brief-fields.md` §2.2 |
| Filing deadline | **5 years** from the crime, or from the 18th birthday for minors, extendable for good cause | N.J.S.A. 52:4B-18 |

*Caution:* some nj.gov pages are stale. One still shows $125/hr (former N.J.A.C. 13:75-1.12) and another shows a $3,000 cap for legal assistance (old 52:4B-8). Cite the current statute and the 13:75-4.10 regulation.

**Implications for the pitch:**
- The money is **discretionary reimbursement to an attorney** on an hourly affidavit, for an **eligible VCCO claimant**. In practice that means a survivor who reported to police within 9 months, or who filed for an RO or SVPO. It does **not** fund survivors who have not reported, and many Matra users will not have reported.
- An attorney who accepts VCCO fees is not working pro bono (see RPC 6.1). Present it as *"some matters may be eligible for VCCO-funded representation at $275/hr up to $10,000"*. Do not present it as funding for pro-bono attorneys.
- **Matra may receive no part of any attorney fee** (RPC 5.4(a); see section 5).

**Victims' rights framework (New Jersey).** N.J. Const. art. I, ¶22 (Victim's Rights Amendment). Crime Victim's Bill of Rights, N.J.S.A. 52:4B-34 to -38. Sexual violence victims' rights, N.J.S.A. 52:4B-60.2 (P.L.2019, c.103), including the right "**to choose whether to participate in any investigation**", to be free from any suggestion that victims must report to receive other rights, and retention of forensic evidence for at least 5 years. New Jersey Campus Sexual Assault Victim's Bill of Rights, N.J.S.A. 18A:61E-1 et seq. These provisions support Matra's "nothing is auto-sent; you choose" design.

**New York.** Office of Victim Services (Executive Law art. 22). Attorney fees are reimbursable only for representation **before OVS and/or the Appellate Division on judicial review, up to $1,000** (Exec. Law § 626), and the regulations limit when they are awarded. https://ovs.ny.gov/legal-information. New York therefore has **no** analogue to New Jersey's $10,000 legal-assistance benefit.

**Funding streams for attorneys and for the platform:**
- **VOCA** (Crime Victims Fund, 34 U.S.C. 20101 et seq.), administered in New Jersey by the Department of Law and Public Safety. The OAG **Division of Violence Intervention and Victim Assistance (VIVA)** was created by AG Directive 2022-10 and codified by P.L.2023, c.167 (https://www.nj.gov/oag/dcj/agguide/directives/ag-Directive-2022-10_Directive-Creating-the-Division-of%20Violence-Intervention-and-Victim-Assistance.pdf). The VOCA Assistance Rule is 28 C.F.R. Part 94, which covers allowable costs including legal assistance and confidentiality requirements (https://www.ecfr.gov/current/title-28/chapter-I/part-94). A nonprofit legal-aid partner is the natural subrecipient. Matra could be a technology cost within that partner's project.
- **OVW Legal Assistance for Victims (LAV)** program: comprehensive legal services for victims of DV, dating violence, SA, and stalking. Eligible applicants are nonprofits, law schools, and tribal entities. The FY2026 solicitation (O-OVW-2026-172580) offered roughly $400k-$900k awards, with applications due July 31 / Aug 4, 2026. https://www.justice.gov/ovw/grant-programs. Recipients take on **VAWA confidentiality** obligations (section 6).
- **NY OVS** funds victim-assistance programs in New York, including legal services, through VOCA **[VERIFY current RFAs]**.

### Product implications
- The VCCO draft generator must state the 9-month report requirement and the 5-year deadline accurately, must not imply eligibility, and must route the survivor to free county Victim-Witness Advocacy for help filing.
- Pitch the funding as "partners can bring VOCA/LAV funding; Matra lowers their intake cost". Do not pitch it as "the state pays our lawyers".

---

## 4. Mandatory reporting (minors, Title IX, Clery)

### Question
When could survivor data trigger mandatory reporting, and how does that shape a campus pilot?

### Short answer
- **Minors:** New Jersey is a universal-reporter state. "Any person having reasonable cause to believe that a child has been subjected to child abuse" must report immediately to DCPP. Knowingly failing to report sexual abuse is a fourth-degree crime (N.J.S.A. 9:6-8.10, 9:6-8.14; https://www.childwelfare.gov/resources/making-and-screening-reports-child-abuse-and-neglect-new-jersey). Matra staff cannot read content because of zero knowledge, but **partner attorneys and advocates who receive shares can**. **Restrict the MVP to adults (18+)** with an age attestation, and screen out incidents involving current minors. Disclosures by adults of *childhood* abuse whose perpetrator still has access to children raise a separate question for counsel **[VERIFY DCPP guidance; also how RPC 1.6 interacts with 9:6-8.10 for attorneys]**. New York's mandated reporters are profession-specific (Soc. Serv. Law § 413).
- **Title IX:** the 2024 rule was vacated nationwide in *Tennessee v. Cardona* (E.D. Ky. Jan. 9, 2025), and ED formally restored the **2020 rule** on Sept. 29, 2026 (https://www.hklaw.com/en/insights/publications/2026/09/education-department-formally-repeals-2024-title-ix-rule). Under 34 C.F.R. 106.30, a postsecondary institution has "actual knowledge" only when the **Title IX Coordinator or an official with authority to institute corrective measures** receives notice. Many schools nonetheless make most employees mandatory reporters **by policy**.
- **Clery Act:** Campus Security Authorities must report Clery crimes they learn of for statistics. Statistics are published without personally identifying information, and timely warnings withhold victim names (34 C.F.R. 668.46). Professional and pastoral counselors are exempt.

### Product implications for a campus pilot
1. Matra must be operated **independently** of the institution. University employees must not administer it or have access to it, and it must not be branded or deployed in a way that makes Matra or its staff an agent, an "official with authority", or a CSA. Institutional data-sharing agreements should state that the school receives **aggregate, de-identified usage only**, with thresholds to avoid small-cell re-identification.
2. Before a campus user shares a record with anyone affiliated with the school, the share screen must state whether that person is a **confidential resource** or a **mandatory reporter under school policy**.
3. Partner attorneys and advocates need a written **minor-disclosure protocol** (see the MOU).
4. Reaching out to the New Jersey Campus Sexual Assault Victim's Bill of Rights (N.J.S.A. 18A:61E) and campus confidential advocates is a better pilot channel than the Title IX office.

---

## 5. Unauthorized practice of law, lawyer referral, and fee sharing

### Question
Does an automated brief or form generator risk UPL? How must "auto-routing to a pro-bono lawyer" and any funding flow be structured under New Jersey's RPCs?

### Short answer
- **UPL:** New Jersey defines the practice of law functionally (*In re Opinion No. 26 of the Committee on the Unauthorized Practice of Law*, 139 N.J. 323 (1995)). The Committee on UPL has said nonlawyers (and software sellers) may provide forms and **type or transcribe** a customer's information. They may **not** advise what to put in the forms or select legal strategy (UPL Op. 40, on "Do-It-Yourself" kits **[VERIFY citation details]**; see https://njlaw.rutgers.edu/collections/ethics/cuap/). Matra's brief reproduces the survivor's own words and is low risk. Features that would cross the line include **suggesting charges or legal elements, recommending whether to report or which remedy to seek, or tailoring content to "make the case stronger."**
- **Referral and fee sharing:** New Jersey prohibits paying for referrals (RPC 7.2(c), 7.3(d)) and sharing fees with nonlawyers (RPC 5.4(a)). The one exception lets a lawyer share **court-awarded** fees with the **nonprofit** that employed, retained, or recommended the lawyer (NJ RPC 5.4(a)(5) **[VERIFY numbering]**). A "bona fide organization" that recommends or furnishes lawyers to its members or beneficiaries is a **legal service plan**. If it is for-profit, its lawyers may not be "employed, directed, supervised or selected by it". Plans must be **registered** with the AOC (RPC 7.3(e)(4)). In Joint Opinion **ACPE 732 / CAA 44 / UPL 54** (June 21, 2017), the committees held that New Jersey lawyers could not participate in Avvo's fee-based model or in **unregistered** LegalZoom and Rocket Lawyer plans. https://ezel.ai/ethics-opinions/njacpe/732-avvo-legalzoom-rocket-lawyer-legal-service-plans

### Discussion and recommended structure
- Operate the attorney-routing function through a **501(c)(3) nonprofit**, or under a fiscal sponsor. Take **no** per-referral fees, no percentage of fees, and no payment from attorneys tied to cases. Fund it through grants and donations.
- The survivor **chooses** the attorney from a list of verified partners. Matra does not assign. Before launch, partner counsel should decide whether Matra is (a) a directory, (b) a nonprofit lawyer referral service, or (c) a legal service plan, and register under RPC 7.3(e)(4)(vii) if needed.
- The client relationship is **between the survivor and the attorney**. Matra is not a party to it and does not direct the attorney's professional judgment (RPC 5.4(c)).
- **The blueprint's PBC with advisor equity** is incompatible with selecting or routing lawyers. A for-profit entity cannot run the referral function in New Jersey. If a PBC exists for software, the routing and partner relationships must sit in a separate nonprofit with no fee flow back to the PBC.
- Contrast with competitor JDoe, which was reported to be funded by attorneys paying for access to potential civil claims (https://techindex.law.stanford.edu/companies/jdoe). That model is impermissible in New Jersey under ACPE 732.
- **Brief naming:** "Police Evidentiary Brief" suggests legal work product. Use "Incident Summary in the Survivor's Own Words". Include a footer: "Prepared by the survivor using Matra. Not legal advice. Not reviewed by an attorney unless indicated."

---

## 6. Privacy, data protection, and law-enforcement requests

### Short answer and discussion
- **HIPAA:** Matra is not a covered entity or business associate, so HIPAA does not apply even though records may contain health information (45 C.F.R. 160.103). Do not market Matra as "HIPAA-compliant". If it is ever operated *for* a covered entity, re-assess.
- **FTC Health Breach Notification Rule** (16 C.F.R. Part 318, amended 2024) covers vendors of personal health records outside HIPAA. The FTC's jurisdiction over nonprofits is limited **[VERIFY applicability to the operating entity]**.
- **New Jersey breach notification:** N.J.S.A. 56:8-161 to -163. Encrypted data is generally excluded when the key has not also been compromised. **NJ Data Privacy Act** (N.J.S.A. 56:8-166.4 et seq., eff. Jan. 15, 2025): **no nonprofit exemption**. It applies at 100,000 NJ consumers, or 25,000 with revenue from data sales. "Sensitive data", which includes sex life and health, requires **opt-in consent** (https://www.orrick.com/en/Insights/2024/03/New-Jersey-Data-Privacy-Act-What-Companies-Should-Know-About-the-States-New-Consumer-Privacy-Law). A pilot will not meet the thresholds, but design to the standard now. **New York:** the SHIELD Act (GBL §§ 899-aa, 899-bb) requires reasonable safeguards and breach notice.
- **VAWA confidentiality** (34 U.S.C. 12291(b)(2)) applies to Matra or partners if they are OVW-funded. It also applies to VOCA-funded grantees through comparable conditions (28 C.F.R. 94.115). Grantees "may not disclose, reveal, or release" personally identifying information "**regardless of whether the information has been encoded, encrypted, hashed, or otherwise protected**." Release requires the victim's "informed, written, **reasonably time-limited**" consent, or a statute or court mandate with notice to the victim (https://www.justice.gov/ovw/page/file/1006896/download). Implications:
  - Escrow identifier hashes and ciphertext still count as personally identifying information for VAWA purposes, so hashing them does not remove them from scope.
  - Shares to attorneys need an **expiry date** and an easy renewal. Today they are open-ended until revoked.
  - Funders cannot receive individual-level data.
- **Law-enforcement requests:** under the Stored Communications Act (18 U.S.C. 2701-2713), content requires a warrant and basic subscriber records can be obtained by subpoena. Matra's response would be limited to ciphertext and metadata. Publish a **law-enforcement guide and transparency report**. Commit to **notify users** of requests unless legally prohibited, and to challenge overbroad requests. **Warrant canaries** have uncertain legal effect. Treat one as a signal, not a guarantee, and have counsel review it before use.
- **Callisto precedent:** Callisto's privacy policy says that if ordered to disclose encrypted data it "would simply be unable to produce it." It also warns users that communications with their advocate "may be subject to disclosure in response to a subpoena, court order, or other legal process" (https://www.projectcallisto.org/privacy-policy). Matra should be equally candid.
- **Retention:** the default should be retention until the survivor deletes, combined with inactivity prompts. Keep server logs short (for example, 30 days, with IPs truncated). Ledger entries contain only hashes and are retained permanently. Disclose all of this.

---

## 7. Blind escrow: legal status of a "match"

> **Status update (2026-10-07).** The matching feature is being rebuilt to a Callisto-style design: an OPRF with split keys, unique identifiers only (names are never matched), and a **Legal Options Counselor** who reviews a matched group and contacts each matched survivor separately through the safe contact method she chose. The discussion below of attorney-count release describes the earlier demo. The counselor model and its privilege and solicitation questions are in §7A. Escrow stays off for real data until the GOVERNANCE.md §5 gates are met.

### Question
What is a match worth legally? Does it create a "prosecutable pattern"?

### Short answer
A match is a **confidential lead** that two different accounts entered the same normalized identifier. It is not evidence of guilt, not proof that two incidents occurred, and not a "pattern" a prosecutor can use as such. Whether another victim's account is admissible is governed by **N.J.R.E. 404(b)**. That rule bars propensity evidence and allows other-acts evidence only for a non-propensity purpose under *State v. Cofield*, 127 N.J. 328 (1992): relevance to a material issue, similarity and closeness in time, clear and convincing proof, and probative value not outweighed by prejudice. **New Jersey has no counterpart to Fed. R. Evid. 413/415**, the federal rules that permit propensity evidence of prior sexual assaults in federal cases. In either system, the other survivor's testimony is needed. A database match is not.

### Discussion
- **Who learns of a match.** Displaying a match directly to any account lets a **perpetrator or his associate create an account, enter his own identifiers, and learn that someone has reported him**. That is a retaliation risk. The literature documents this "probing" attack (Arun et al., NDSS 2020; Kuykendall, Krawczyk & Rabin, PoPETs 2019). The first MVP had exactly this flaw. **It is now mitigated:**
  - Survivors never see match results. Their app always shows "Sealed", and nothing in their own activity log mentions a match.
  - No ledger entry is written when a match happens, so the public ledger cannot be watched to infer one.
  - A match is released only through a **human gatekeeper**: the verified attorney the survivor has an **active** share with. That attorney sees only counts for this client's own sealed names (how many are sealed, how many matched). The attorney sees no names, no hashes, and nothing about the other survivor. The attorney's screen says: *"Another person independently named someone this client also named. Their identity is not shared with you or anyone. Discuss with your client how she'd like to proceed; a match is an investigative lead, not evidence."*
  - This is close to Callisto's design, where a lawyer (a "Legal Options Counselor") is notified and reaches out to each survivor (Rajan et al., COMPASS 2018, https://par.nsf.gov/biblio/10061833). The difference is that Matra's gatekeeper is the survivor's own chosen attorney. No one can contact the other survivor yet.
- **Remaining limitations.** (1) A perpetrator who obtains an active share with a verified attorney could still learn of a match through that attorney. This is mitigated by attorney verification and by the attorney's professional judgment and duties and by the partner MOU, not by cryptography. Attorneys should be alert to a "client" whose own named person looks like himself. (2) The pepper holder can still test identifiers (next bullet). An OPRF with a threshold key is on the roadmap.
- **Ethics note for the gatekeeping attorney.** Telling a client about a match is a counseling decision. The attorney should raise it with care, never relay it to third parties as an accusation, and never treat it as proof.
- **False matches** come from common names, shared or recycled phone numbers, and typos.
- **Defamation and harassment risk:** a match must never be published or relayed to third parties as an accusation.
- **Evidentiary weakness of the escrow layer:** the server holds the pepper. Phone numbers are low-entropy (about 10^10 values), so whoever holds the pepper can confirm a guessed identifier (Demir et al. 2018; Hagen et al., NDSS 2021). The Security Whitepaper covers this and the roadmap to OPRF with key splitting.

### Product implications
- Replace "prosecutable pattern" and "bulletproof" in all materials with: *"a confidential signal that may help a survivor and her attorney decide whether to come forward, together or separately."*
- Done: matches are no longer displayed to users. They reach only the verified attorney with an active share, as counts.
- Before any non-demo use: verify and rate-limit survivor accounts, decide whether a trained counselor should also be able to reach the other survivor, and add the OPRF roadmap.

---

## 7A. Legal Options Counselor model: privilege and solicitation

*Flag for counsel. Everything in this section is a research view, not a conclusion.*

### The model
- When a survivor lodges a matching entry, she consents to a specific statement: *if another person names the same person, a Matra Legal Options Counselor (a licensed NJ or NY attorney) may open this entry and contact you by the method you chose.* The entry holds unique identifiers, jurisdiction, and her chosen safe contact method. Names are never matched.
- When a match occurs, the counselor (the demo account is `counselor.demo`) sees the **matched group**: which entries name the same person. The counselor reviews it for plausibility (fake or Sybil entries, a "survivor" who seems to be the named person himself). The counselor then contacts **each survivor separately**, explains her options (criminal, civil, protective orders, campus or workplace processes, restorative approaches, or doing nothing), and introduces survivors to each other **only with both consents**. Survivors never see a match in the app.
- The counselor is engaged by contract or MOU, ideally through a legal-aid partner. The counselor is paid by Matra or the partner, not by survivors, and gives limited-scope options counseling (RPC 1.2(c)). For representation, she chooses her own attorney.
- This follows the model in Rajan et al., COMPASS 2018 (§3.2), which Callisto ran with attorney counselors until April 2026 (see [research/callisto.md](research/callisto.md) §3, §7).

### Privilege: attorney counselor versus advocate
- **Callisto's theory.** The counselor is an attorney, so what the counselor decrypts is a communication from a prospective client seeking legal advice. That makes it privileged, and Callisto, which held no keys, had nothing to produce (P1 §3.2). Callisto's April 2026 privacy policy moved matched survivors to advocates from a partner organization and stated that attorney-client privilege **no longer applies** ([privacy policy, updated 17 Apr 2026](https://www.projectcallisto.org/privacy-policy)).
- **Attorney counselor (Matra's choice).** The duty of confidentiality to a prospective client applies even if no relationship forms (RPC 1.18; RPC 1.6). The evidentiary privilege (N.J.R.E. 504) covers communications between lawyer and client "in the course of that relationship and in professional confidence". Whether it reaches an entry written **before** any particular attorney was identified, sent to a counselor role, is untested **[VERIFY]**. Two limits hold either way. The underlying facts, including the named person's identifiers, are not privileged (*Upjohn*). And a pre-existing document does not become privileged by being sent to counsel (*Fisher*). Drafting the consent so that the entry is expressly a request for legal advice from the counselor strengthens the claim **[VERIFY]**.
- **Advocate counselor (not recommended).** An advocate creates no attorney-client privilege. The NJ victim-counselor privilege (N.J.S.A. 2A:84A-22.15; N.J.R.E. 517) covers only trained counselors at a qualifying victim counseling centre (§2). A partnered county program's CSVA might qualify, but the scope and waiver rules differ. NY's analogue is CPLR 4510 **[VERIFY]**. Using advocates would weaken the legal protection survivors were promised.
- **Commitment.** Matra keeps the counselor an attorney. If that ever changes, the [Succession and Data Promise](SUCCESSION_AND_DATA_PROMISE.md) D7 applies: survivors are told at least 90 days before the change, can withdraw first, and entries lodged under the attorney model are never released to a non-attorney.

### Solicitation: NJ RPC 7.3
NJ RPC 7.3(b) bars a lawyer from contacting a prospective client "for the purpose of obtaining professional employment" in listed circumstances. These include where the lawyer knows or reasonably should know that the person's physical, emotional or mental state means she could not exercise reasonable judgment in employing a lawyer; where she has made known a desire not to be contacted; where the contact involves coercion, duress or harassment; and unsolicited direct contact about a specific event when pecuniary gain is a significant motive (regular-mail letters excepted) **[VERIFY current subsection text and numbering]**. Applied to the counselor:
1. **Purpose.** The counselor does not seek employment or a fee from the survivor. The counselor is paid a fixed amount by Matra or the partner and offers options, not representation. That points away from RPC 7.3. It holds only if the counselor is barred from taking **paid** representation of the survivors they contact (for example, contingency civil matters or VCCO-reimbursed work). We recommend that bar, with representation handled through her own choice of attorney.
2. **Not unsolicited.** She opted in, at lodging time, to contact by a specific method if a match occurs. Consent should be specific, renewable (VAWA's "reasonably time-limited" standard, §6), and revocable by withdrawing the entry at any time. A contact she has opted out of, or a method she did not choose, would fail RPC 7.3(b).
3. **State of mind.** Contacting a sexual-assault survivor about the person who harmed her is exactly where RPC 7.3(b)'s state-of-mind clause bites. The counselor protocol should give one neutral, low-pressure contact; an easy "not now" or "never"; no follow-up after a decline; and no persuasion toward any course of action. It should be trauma-informed and written with advocates.
4. **Constitutional backdrop.** Non-pecuniary contact by a nonprofit about legal rights gets First Amendment protection (*In re Primus*, 436 U.S. 412 (1978)). In-person contact for pecuniary gain does not (*Ohralik v. Ohio State Bar Ass'n*, 436 U.S. 447 (1978)). Matra's structure should stay clearly on the *Primus* side.
5. **Related rules.** RPC 1.8(f) and 5.4(c): a third-party payer must not interfere with the counselor's judgment, and the survivor's informed consent to the payment arrangement is required. RPC 1.7: the counselor should not represent two matched survivors jointly, and an introduction is not representation. RPC 1.18 may disqualify the counselor from adverse matters. RPC 7.2(c) and 7.3(d): nothing of value goes to anyone for a recommendation. RPC 7.3(e): a counselor program makes the legal-service-plan question (§5) sharper. Labelling rules for written solicitations (an "ADVERTISEMENT" legend) probably do not apply to non-employment contact **[VERIFY]**.
6. **New York.** NY Rule 7.3 defines "solicitation" by reference to a primary purpose of retention for pecuniary gain, and bars most in-person and telephone solicitation. A fee-free, opt-in counselor contact is probably outside it, but filing and retention rules should be checked **[VERIFY]**.

### Product implications
- Consent text at lodging names the counselor role, the profession (attorney), the contact method, and that a match is a lead, not evidence. It is renewable and withdrawable.
- The counselor gets no OPRF access, sees only server-released matched entries, and every decryption is logged (security research A7).
- Budget counselor hours. If the budget runs out, matched entries stay sealed and nobody is contacted until funding resumes. Disclose this at consent ([SUSTAINABILITY_PLAN.md](SUSTAINABILITY_PLAN.md) §5).
- Counselor engagement terms go into the MOU, covering scope, the bar on paid representation of contacted survivors, a contact protocol, conflicts, and deletion.

---

## 8. Corrections to blueprint claims (consolidated)

| Blueprint claim | Status | Accurate statement |
|---|---|---|
| "Mathematically impossible to hand over raw data" | **Overstated** | The operator cannot decrypt content. The survivor and her recipients can be compelled. Metadata is producible. |
| Records "block defense claims of late fabrication" | **Overstated** | Corroborative, not conclusive. Possibly admissible as a prior consistent statement if made before the alleged motive (*Tome*; N.J.R.E. 803(a)(2)). App entries are not fresh complaints. |
| Rule 803(5) makes the statement admissible "even if memory fades years later" | **Partly true** | Only if she testifies, lacks recollection, and lays the foundation. The record is read in, not admitted as an exhibit. |
| Escrow yields a "bulletproof", "prosecutable pattern" | **Wrong** | A match is a lead. Other-acts evidence goes through N.J.R.E. 404(b) and *Cofield*. NJ has no FRE 413. |
| VCCO reimburses "$275/hr up to statutory caps" | **Correct number, incomplete** | $275/hr, maximum $10,000, inside the $25,000 cap. Requires VCCO eligibility (police report within 9 months). Claim-filing help is ≤15% of the award with a $500 minimum. |
| VCCO "report filing deadlines (typically within 90 days)" | **Outdated** | 9 months to report, 5 years to file. 90 days is VCCO's decision window. |
| *Upjohn* governs platform confidentiality | **Misapplied** | *Upjohn* concerns corporate privilege. The relevant authorities are *Fisher* (pre-existing documents), N.J.R.E. 504, RPC 1.18, and the confidentiality of communications through service providers. |
| Callisto = "Anson et al.", salted hashes of identifiers | **Wrong** | Rajan, Qin, Archer, Boneh, Lepoint & Varia (COMPASS 2018). The design uses OPRF, key federation, and Shamir sharing. A salted hash of a phone number is reversible by whoever holds the salt or pepper. |
| "Leveraging state compensation funds (like NJ VCCO) to cover counsel" for pro-bono attorneys | **Misframed** | VCCO-paid work is not pro bono, and it is unavailable to survivors who have not reported. Matra can take no cut. |
| PBC with equity, routing to lawyers | **Structural conflict** | For-profit referral and fee sharing are barred in NJ. Routing must sit in a nonprofit and may need registration under RPC 7.3(e)(4)(vii). |

---

## 9. Open questions for licensed counsel
1. Is Matra a directory, a nonprofit lawyer referral service, or a legal service plan under RPC 7.3(e)? Is registration required?
2. Do attorney-directed narratives prepared through Matra receive privilege and work-product protection? How should the "prepared at counsel's request" designation be documented?
3. What heightened standard, if any, applies in NJ to defense subpoenas for **non-privileged** victim writings? What R. 1:9-2 and victim-notice practice applies?
4. Spoliation and 2C:28-6 timing for survivor-initiated deletion: what warning language should we use?
5. Could a partnered NJ victim counseling centre's counselors communicate through Matra within N.J.S.A. 2A:84A-22.15?
6. Duties of partner attorneys under N.J.S.A. 9:6-8.10 versus RPC 1.6 for disclosures of historical child abuse.
7. Does N.J.R.E. 902 permit self-authentication of ledger output analogous to FRE 902(13)-(14)?
8. Status of S1294 (VCCO forensic-exam exception).
9. VAWA confidentiality and VOCA conditions if a partner uses grant funds for Matra costs.
10. **Legal Options Counselor (§7A).** Does a pre-identified-counselor matching entry receive N.J.R.E. 504 / RPC 1.18 protection? Is counselor contact with an opted-in survivor outside NJ RPC 7.3 and NY Rule 7.3, and what consent and contact protocol makes that clear? Does RPC 1.8(f) consent need to be in the lodging flow? Does a counselor program make Matra a legal service plan under RPC 7.3(e)?
11. **Succession (Promise D2, D6, D7).** Is end-of-life crypto-shred after notice, disclosed at signup, adequate consent? How do preservation orders interact with it? What must a successor-migration opt-in say? Can matching entries lodged under the attorney-counselor terms be migrated to a successor's counselor without re-consent?

---

---

## 10. Competitive landscape (verified as of 2026-10-06)

| Product | One line | Relevance to Matra | Source |
|---|---|---|---|
| **Callisto (Callisto Vault)** | Nonprofit. Encrypted, timestamped incident log plus a matching escrow, for users with a .edu email. Matches went to an attorney "Legal Options Counselor" and, from April 2026, to partner advocates without attorney-client privilege. **Closing:** the board announced closure on 22 Jul 2026, with new accounts disabled and existing users able to download or delete. It is looking for a new home for its technology (status as of 2026-10-07: no successor announced, **UNVERIFIED** absence). | The precedent Matra's matching design follows (OPRF, key federation, Shamir sharing, counselor review). Its closure lessons shape Matra's [Succession and Data Promise](SUCCESSION_AND_DATA_PROMISE.md) and [Sustainability Plan](SUSTAINABILITY_PLAN.md). Its privacy policy candidly says it "would simply be unable to produce" encrypted data. | https://www.projectcallisto.org/blog/closing · https://par.nsf.gov/biblio/10061833 · https://www.projectcallisto.org/privacy-policy · [research/callisto.md](research/callisto.md) |
| **Seek Then Speak** (EVAWI) | Free online tool. "Seek" lets survivors explore options privately. "Speak" is a self-guided series of questions that prepares documentation for an initial police report. Deployed by local and state agencies (e.g., Washington AG). Ages 13+. | Law-enforcement-oriented. Matra is attorney- and advocate-oriented and does not route to police. | https://evawintl.org/ (program info: https://laurenmccluskey.org/about/news/seekthenspeak-wa-attorney-general/) |
| **#NotMe** | Employer-purchased whistleblowing and misconduct-reporting app with an employer dashboard. Founded by an employment lawyer. | Institution-facing. Matra is survivor-owned and never reports to employers. | https://www.nbcbayarea.com/news/tech/notme-tech-company-launches-app-to-report-harassment-anonymously/2223910/ |
| **Spot** (talktospot.com) | AI chatbot (All Turtles) that uses cognitive-interview techniques to help people record workplace harassment. Reports can be kept private or sent to the employer. | Uses NLP/AI. Nothing rewrites her words. Voice is transcribed and suggestions are made on her device, and she confirms every one; no AI runs on any server or third-party service. Matra never sends her account to an AI service. | https://techtarget.com/searchhrsoftware/feature/Reporting-harassment-at-work-eased-by-new-enterprise-chatbot |
| **JDoe** | For-profit anonymous reporting app with perpetrator matching. Reported to be funded by attorneys paying for access to potential civil claims. Current status **[VERIFY]**. | Its funding model would be impermissible in NJ (RPC 5.4, 7.2(c), 7.3(d); ACPE 732). | https://techindex.law.stanford.edu/companies/jdoe |
| **LiveSafe** (Vector Solutions) | Campus and enterprise safety app: anonymous tips to campus security, SafeWalk, emergency tools. Acquired by Vector Solutions in 2020. | Institution-facing. Tips go to campus security, and could create Clery and Title IX obligations. | https://www.vectorsolutions.com/resources/press-releases/vector-solutions-expands-safety-capabilities-with-acquisition-of-livesafe/ |
| **RAINN** | National nonprofit. Operates the National Sexual Assault Hotline (800-656-HOPE and online chat) and publishes statistics. | Crisis support, not documentation. Matra should link to it, not compete with it. | https://rainn.org/ |

---

### Appendix: principal sources
- Supreme Court: *Crawford*, *Davis*, *Bryant*, *Clark*, *Tome*, *Brady*, *Giglio*, *Nixon*, *Ritchie*, *Fisher*, *Upjohn* (links inline).
- NJ: *State v. R.K.*, 220 N.J. 444 (2015); *State v. Hill*, 121 N.J. 150 (1990); *State v. Chambers*, 288 A.3d 12 (N.J. 2023); *State v. R.F.P.*, A-5-25 (2026); *State v. J.G.*, 261 N.J. Super. 409 (App. Div. 1993); *State v. Cofield*, 127 N.J. 328 (1992); *In re Opinion No. 26*, 139 N.J. 323 (1995).
- NJ statutes and rules: N.J.S.A. 52:4B-8, -18, -34 to -38, -60.2; 2A:84A-22.13 to -22.16; 9:6-8.10; 18A:61E-1; 56:8-161 to -166; 56:8-166.4 et seq.; N.J.A.C. 13:75-4.10; R. 1:9-2, R. 3:13-3; N.J.R.E. 404(b), 504, 517, 612, 613, 803; RPC 1.6, 1.18, 5.4, 6.1, 7.2, 7.3.
- Federal: FRE 404(b), 413, 415, 612, 801(d)(1)(B), 803, 901, 902; Fed. R. Crim. P. 17(c); 34 U.S.C. 12291(b)(2); 28 C.F.R. Part 94; 34 C.F.R. 106.30, 668.46; 18 U.S.C. 2701 et seq.
- Escrow cryptography: Rajan et al. (2018); Kuykendall, Krawczyk & Rabin (2019); Arun et al. (2020); Demir et al. (2018); Hagen et al. (2021); RFC 9497. Local copies are in `compiled_resources/04_cryptographic_escrow_privacy/`.
