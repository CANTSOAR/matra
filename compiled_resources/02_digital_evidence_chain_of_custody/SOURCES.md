# 02 — Digital Evidence & Chain of Custody: Sources

Retrieved 2026-10-06. Every file was checked with `file` after download. All are free, official or public-domain sources; nothing paywalled was downloaded.

---

## 1. NIST SP 800-86: forensics and incident response

- **File:** `NIST_SP_800-86_forensics_incident_response.pdf` (121 pp.)
- **Citation:** Kent, K., Chevalier, S., Grance, T., & Dang, H. *Guide to Integrating Forensic Techniques into Incident Response*. NIST Special Publication 800-86, August 2006.
- **URL:** https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-86.pdf (the legacy URL still works; the landing page is https://csrc.nist.gov/pubs/sp/800/86/final)
- **Why it matters:** This is the standard reference for the collect → examine → analyze → report process. It covers chain-of-custody logging, write-blocking, and using message digests to show that collected data has not changed, which is the method the app's hash-on-creation design depends on.
- **Caveats:** It dates from 2006. Its examples use MD5 and SHA-1, which should no longer be used for integrity; use SHA-256 or stronger. It is written for an organization investigating its own IT incidents, not for evidence a person creates about themselves. It is not a legal admissibility standard, and courts do not "certify" compliance with it. It mentions timestamps mainly as file metadata (MAC times) to be preserved. It does not set out a "timestamp validation" standard.

## 2. Federal Rules of Evidence: full text

- **File:** `FRE_federal_rules_of_evidence_Dec2025.pdf` (44 pp.)
- **Citation:** *Federal Rules of Evidence*, as amended to December 1, 2025. Printed for the House Committee on the Judiciary.
- **URL:** https://www.uscourts.gov/sites/default/files/document/federal-rules-of-evidence.pdf (index page: https://www.uscourts.gov/forms-rules/current-rules-practice-procedure/federal-rules-evidence)
- **Why it matters:** This is the authoritative current text. Rules 803(5), 803(6), 901, 902(11), 902(13) and 902(14) are the ones that matter here. Also read Rule 801(d)(1)(B) (prior consistent statements) and Rule 1001–1008 (best evidence; a printout of the record counts as an "original" under Rule 1001(d)).
- **Note:** A new Rule 707 on machine-generated evidence was proposed and published for comment in 2025. Check its status on uscourts.gov before relying on any AI-generated summaries in the brief.

## 3. FRE Rule 803 (LII), with Advisory Committee Notes

- **File:** `FRE_Rule_803_hearsay_exceptions_LII.md`
- **Citation:** Fed. R. Evid. 803 and the Notes of the Advisory Committee. Legal Information Institute, Cornell Law School.
- **URL:** https://www.law.cornell.edu/rules/fre/rule_803
- **803(5), recorded recollection.** The record must be (A) on a matter the witness once knew about but *now cannot recall well enough to testify fully and accurately*, (B) *made or adopted by the witness when the matter was fresh in memory*, and (C) accurate in reflecting the witness's knowledge. Practical consequences for the app:
  - The survivor normally has to take the stand. She must lay the foundation: she made the record, it was fresh, and it was accurate when made. Then she must show she now cannot remember well.
  - The exception is only available if her memory has actually failed at trial. If she remembers, the statement does not come in under 803(5).
  - The record is *read into evidence*. It is not received as an exhibit unless the opposing party offers it. A polished PDF brief would not go to the jury room this way.
  - 803(5) is a **hearsay** exception, not an authentication rule. A hash supports element (C) and rebuts claims of later alteration. It does not by itself satisfy 803(5).
  - The text must be the survivor's own words, or a record she reviewed and adopted. App-generated summaries, rewording, or AI "standardization" of her narrative weakens the "made or adopted by the witness" element. Store her verbatim input and record her explicit adoption of any derived text, with its own timestamp.
- **803(6), business records.** This generally does **not** fit a survivor's own statement. She is not recording it as a regular practice of a business, and a statement prepared in anticipation of litigation risks the "lack of trustworthiness" proviso. The *platform's own* system records (audit logs, hash and timestamp records) could qualify as the operator's regularly kept records. They can be certified under 902(11), or treated as machine output under 901(b)(9) and 902(13).

## 4. FRE Rule 901 (LII), authentication

- **File:** `FRE_Rule_901_authentication_LII.md`
- **Citation:** Fed. R. Evid. 901 and the Notes of the Advisory Committee. LII.
- **URL:** https://www.law.cornell.edu/rules/fre/rule_901
- **Why it matters:** 901(a) sets a low bar: evidence "sufficient to support a finding that the item is what the proponent claims it is." The relevant examples are 901(b)(1) (testimony of a witness with knowledge, e.g. the survivor saying "this is what I wrote"), 901(b)(4) (distinctive characteristics) and 901(b)(9) (evidence describing a process or system and showing it produces an accurate result). 901(b)(9) is where testimony about the hashing, timestamping and storage pipeline fits.

## 5. FRE Rule 902 (LII), self-authentication, including 902(13)/(14) notes

- **File:** `FRE_Rule_902_self_authentication_LII.md` (includes the 2017 Advisory Committee Notes for ¶¶ 13 and 14)
- **Citation:** Fed. R. Evid. 902, as amended December 1, 2017, and the Committee Notes. LII.
- **URL:** https://www.law.cornell.edu/rules/fre/rule_902
- **Why it matters:** For proving that a hashed file has not been altered, **902(14) is more directly relevant than 803(5).** It lets data copied from a device or file be self-authenticated "by a process of digital identification." The 2017 note names hash values as the usual method. **902(13)** covers records produced by an electronic process or system, such as the app's timestamp and audit-log output. Both require a **certification by a qualified person** (meeting the 902(11) formalities, i.e. under penalty of perjury) and **reasonable written notice before trial** to the other side.
- **Limits stated in the notes:** These rules are "solely limited to authentication." The opposing party can still object on hearsay, relevance, or (in criminal cases) **confrontation** grounds. Authenticity also does not prove *who* entered the data or that the content is true.
- **Design implications:**
  1. Someone must be able to sign the certification. Decide who that is (the operator's custodian, or a forensic examiner), and make sure your zero-knowledge design still lets that person verify the hash. For example, publish or escrow the hash of the plaintext or ciphertext, and document the procedure.
  2. Keep a documented, repeatable process. 902(13) needs a showing that the system "produces an accurate result."

## 6. Lorraine v. Markel American Insurance Co. (D. Md. 2007)

- **File:** `Lorraine_v_Markel_2007_241FRD534_ESI_authentication.md`
- **Citation:** *Lorraine v. Markel Am. Ins. Co.*, 241 F.R.D. 534 (D. Md. 2007) (Grimm, C.M.J.).
- **URL:** https://static.case.law/frd/241/html/0534-01.html (Caselaw Access Project, Harvard Law School; public-domain opinion). Also listed on CourtListener: https://www.courtlistener.com/opinion/8763831/lorraine-v-markel-american-insurance/
- **Why it matters:** This is the standard opinion on admitting ESI. It sets out five hurdles: relevance (401), authenticity (901/902), hearsay (801–807), original writing (1001–1008), and unfair prejudice (403). It discusses hash values as a "distinctive characteristic" under 901(b)(4). The useful lesson for the app is that both sides lost summary judgment because they failed to authenticate their emails. Integrity tooling only helps if someone can explain it in a foundation.
- **Caveat:** It predates 902(13)/(14) (2017), so read it together with the Grimm/Capra/Joseph article below.

## 7. Grimm, Capra & Joseph: "Authenticating Digital Evidence" (2017)

- **File:** `Grimm_Capra_Joseph_2017_Authenticating_Digital_Evidence_Baylor.pdf` (55 pp.)
- **Citation:** Hon. Paul W. Grimm, Daniel J. Capra & Gregory P. Joseph, *Authenticating Digital Evidence*, 69 Baylor L. Rev. 1 (2017).
- **URL:** https://law.baylor.edu/sites/g/files/ecbvkj1546/files/2023-11/7_grimm_capra_joseph.pdf (mirror: https://www.txs.uscourts.gov/sites/txs/files/Grimm%20Baylor%20L%20Rev%20Auth%20Digital%20Evid%20pdf%20051117.pdf)
- **Why it matters:** Written by the judge who decided Lorraine and the Reporter to the Advisory Committee on Evidence Rules. It covers the post-2017 framework, including 902(13)/(14), with factor lists for authenticating emails, texts, social media and other evidence. It is the most practical free guide for drafting the platform's certification template and foundation testimony.

## 8. FIPS 180-4: Secure Hash Standard (SHA-2)

- **File:** `NIST_FIPS_180-4_SHA-2.pdf` (36 pp.)
- **Citation:** NIST, *Secure Hash Standard (SHS)*, FIPS PUB 180-4, August 2015.
- **URL:** https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf
- **Why it matters:** This is the normative spec to cite for SHA-256 and SHA-512 in a certification or expert declaration ("hash computed with SHA-256 per FIPS 180-4"). Citing a recognized standard makes the 901(b)(9) and 902(14) process easier to defend. Do not use SHA-1 or MD5. (SHA-3 is FIPS 202 if needed.)

## 9. RFC 3161: Time-Stamp Protocol (TSP)

- **File:** `RFC3161_trusted_timestamping.txt`
- **Citation:** Adams, C., Cain, P., Pinkas, D., & Zuccherato, R. *Internet X.509 Public Key Infrastructure Time-Stamp Protocol (TSP)*. RFC 3161, IETF, August 2001 (updated by RFC 5816).
- **URL:** https://www.rfc-editor.org/rfc/rfc3161.txt
- **Why it matters:** A hash proves that content has not changed *since it was hashed*. It does not prove *when* the hash was made. A timestamp from the app's own server is only as credible as the operator. An RFC 3161 token from an independent Time-Stamping Authority binds the hash to a time the operator cannot later change. That is the piece that actually supports "recorded when fresh." Consider anchoring each statement hash with a third-party TSA token, or several.

---

## Where the README framing is incomplete or off

1. **"803(5) … proves why a timestamped, hashed statement … is admissible."** This mixes up two separate hurdles. Hashing and timestamps go to **authentication** (901/902). 803(5) is a **hearsay** exception, and it depends on the survivor *testifying* that she made or adopted the record while it was fresh, that it was accurate, and that she now cannot recall well. Even then the record is only read aloud, not admitted as an exhibit (unless the opponent offers it). It cannot replace her appearing at trial.
2. **Confrontation Clause.** This is missing from the README and is the biggest gap. A statement created specifically "to be usable as evidence" is very likely **testimonial** under *Crawford v. Washington*, 541 U.S. 36 (2004), and *Davis v. Washington*, 547 U.S. 813 (2006). In a criminal case it cannot come in against the accused unless the survivor testifies and is available for cross-examination, whatever hearsay exception applies. The 902(13)/(14) notes say this explicitly.
3. **902(13)/(14) and the certification process are not named.** These are the rules that actually tie "hash" to "unaltered." The README's mention of "WORM storage" is not a legal concept in the FRE. WORM only helps as part of a process that a qualified person can certify, with pre-trial notice.
4. **Other relevant rules are missing.** 801(d)(1)(B) (prior consistent statement, which can rebut a charge of recent fabrication; the fresh, hashed record is valuable here), 803(6) and 902(11) for the platform's own logs, and Rules 1001–1008 (best evidence) are not mentioned.
5. **The FRE only governs federal courts.** Most sexual-assault prosecutions and many civil claims are in **state court**. New Jersey has its own N.J.R.E. 803(c)(5), 901, etc. Check whether the target state has adopted equivalents of 902(13)/(14), since not all have. Title IX proceedings, VCCO claims and protective-order hearings have their own, often looser, evidentiary standards.
6. **SP 800-86 is overstated.** It is a 2006 organizational incident-response guide. It is not a standard that "withstands forensic audit" in court, and it does not define timestamp validation. Pair it with FIPS 180-4 (hashing) and RFC 3161 (trusted time).
7. **Integrity is not the same as authorship or truth.** A hash shows the file has not changed. It does not show *who* typed it or that it is accurate. Record authentication events and the survivor's explicit adoption of the final text. Keep verbatim input separate from any app-generated or AI-generated summaries, which also raise the "made or adopted by the witness" problem under 803(5) and, potentially, proposed Rule 707 issues.
