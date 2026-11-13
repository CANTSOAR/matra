---
id: Q-039
title: What must Matra produce when police or a court demand data, may it tell the survivor, and may it publish a warrant canary?
status: memo-ready
priority: P1
area: privacy
jurisdiction: NJ, NY, CA, PA, federal
source: interview 2026-11-11
blocks: Law-enforcement request policy; transparency report; what survivors are promised
related: Q-038, Q-040, Q-016
created: 2026-11-11
---

## Question

What must Matra produce in response to a subpoena, court order or warrant under the Stored Communications Act (18 U.S.C. § 2701 et seq.) and CalECPA (Cal. Penal Code § 1546 et seq.), when may it notify the affected survivor despite a nondisclosure order (18 U.S.C. § 2705(b)), and is a warrant canary lawful?

## Context

Founder's goal (interview 2026-11-11): "having the server is useless": anyone who obtains the server, by hacking or by legal process, gets nothing usable. Today Matra holds only ciphertext plus account and log metadata (see Q-038). No law-enforcement request policy exists yet. [LEGAL_RESEARCH_MEMO.md §6](../../LEGAL_RESEARCH_MEMO.md#6-privacy-data-protection-and-law-enforcement-requests) is background.

Interview 2026-11-11: the cloud provider is not chosen; the founder sees it as a logistics question (which provider supports the secure setup). Relevant to this question: a US provider can itself be served for Matra's stored data wherever it is hosted (CLOUD Act, 18 U.S.C. § 2713; see Research §6), possibly without Matra being told.

Decided 2026-11-11 for the build: no raw IPs on disk (in-memory keyed-hash rate limits expiring within 24 hours); the
phone number used for sealed-matching verification is kept only as a keyed hash; the OPRF key is split n-of-m across
separate institutions; hosting is on a US confidential-computing provider that stores only ciphertext.

## Research

*Prepared for counsel by a non-lawyer research pass (2026-11-11). Not legal advice.*

**1. Is Matra covered by the SCA?** A "remote computing service" is "the provision to the public of computer storage or
processing services by means of an electronic communications system" ([18 U.S.C. § 2711(2)](https://www.law.cornell.edu/uscode/text/18/2711)).
An encrypted vault open to any survivor appears to fit. Survivor–attorney messaging may also make it an electronic
communication service. If it is covered, Matra may not voluntarily give contents to anyone, or records to the government,
except under listed exceptions, which include consent and a good-faith emergency involving danger of death or serious
physical injury ([§ 2702(a)(2)–(3), (b)(3), (b)(8), (c)(2), (c)(4)](https://www.law.cornell.edu/uscode/text/18/2702)). Records may go to a
non-government person (§ 2702(c)(6)). On the statute's text there appears to be no exception for a civil subpoena for contents.

**2. What can be compelled** ([§ 2703](https://www.law.cornell.edu/uscode/text/18/2703)).
- *Contents* (ciphertext, sealed entries). The government can get them with a warrant (§ 2703(a), (b)(1)(A)). For a remote
  computing service, a subpoena or a § 2703(d) order also works if the government gives the customer prior notice, which
  can be delayed (§ 2703(b)(1)(B); § 2705(a)). Whether a warrant is constitutionally required for all stored content is argued
  circuit by circuit. **[VERIFY]**
- *Subscriber records* by subpoena (§ 2703(c)(2)): name, address, "records of session times and durations",
  "subscriber number or identity, including any temporarily assigned network address", and means of payment. With no
  raw IPs on disk, Matra would have no network address to produce. The keyed phone hash kept under verify-then-forget
  appears to be a record that can be compelled. It identifies someone only if the hash key can also be obtained
  (see Q-016, Q-013).
- *Other records* need a § 2703(d) order, meaning "specific and articulable facts" showing relevance and materiality, or a warrant.
- *Preservation.* On request, Matra "shall take all necessary steps to preserve records" for 90 days, renewable for
  90 more (§ 2703(f)). This may conflict with the 24-hour expiry of rate-limit hashes and with a survivor's own
  delete. It is unsettled whether a preservation letter requires Matra to keep data it would otherwise erase, or
  blocks a deletion the survivor herself asked for.
- *Decryption.* Nothing in § 2703 appears to require a provider to create plaintext it cannot read. The federal
  decryption duty in CALEA covers only a "telecommunications carrier", and only where "the encryption was provided by the
  carrier and the carrier possesses the information necessary to decrypt"
  ([47 U.S.C. § 1002(b)(3)](https://www.law.cornell.edu/uscode/text/47/1002)). Information services are excluded
  (§ 1002(b)(2)(A)). Whether a court could order technical assistance under the All Writs Act (28 U.S.C. § 1651) is
  unsettled. **[VERIFY]**
- Providers have no liability for disclosures that comply with process (§ 2703(e)).

**3. State law.** CalECPA bars a California government entity from compelling "electronic communication information
from a service provider" except by warrant, wiretap order, or the other listed process
(Cal. Penal Code § 1546.1(a)(1), (b) ([FindLaw text](https://codes.findlaw.com/ca/penal-code/pen-sect-1546-1/);
leginfo was unreachable)). It allows voluntary disclosure only "when that disclosure is not otherwise prohibited by state
or federal law" (§ 1546.1(f)). A service provider may "petition the issuing court to void or modify" non-compliant
process (§ 1546.4(c) ([FindLaw](https://codes.findlaw.com/ca/penal-code/pen-sect-1546-4/))). CalECPA appears to bind
only California agencies. NJ, NY and PA police would use the SCA plus their own law. In New Jersey, *State v. Reid*,
194 N.J. 386 (2008) (decided Apr. 21, 2008; caption confirmed on Leagle), reportedly holds that ISP subscriber information is protected under the NJ Constitution and can be
obtained by grand jury subpoena without notice to the subscriber **[VERIFY: holding seen only in secondary summaries; full text and pinpoint not opened; NY and PA analogues not researched]**.

**4. May Matra tell the survivor?** The SCA does not appear to forbid a provider from notifying its user unless a court
issues a § 2705(b) order. A court "shall" issue one for "such period as the court deems appropriate" if notice would
endanger a person's life or safety, lead to flight, destruction of evidence or witness intimidation, or otherwise seriously
jeopardize an investigation ([§ 2705(b)(1)–(5)](https://www.law.cornell.edu/uscode/text/18/2705)). In California, a delay
order under CalECPA lasts up to 90 days at a time, may be renewed, and bars "any party providing information from
notifying any other party" (§ 1546.2(b) ([FindLaw](https://codes.findlaw.com/ca/penal-code/pen-sect-1546-2/))). A
National Security Letter can carry its own gag ([18 U.S.C. § 2709(c)](https://www.law.cornell.edu/uscode/text/18/2709)).
DOJ policy since 2017 reportedly limits most § 2705(b) requests to one year **[VERIFY: Rosenstein memo, Oct. 19, 2017;
scanned copy at justice.gov not readable]**. *Microsoft Corp. v. DOJ*, 233 F. Supp. 3d 887 (W.D. Wash. Feb. 8, 2017),
reportedly let a First Amendment challenge to indefinite § 2705(b) orders proceed **[VERIFY: citation and date
confirmed; opinion text not opened]**. If Matra or a partner is a VAWA grantee or subgrantee, a release "compelled by statutory or court mandate" requires "reasonable attempts to provide notice to victims affected"
([34 U.S.C. § 12291(b)(2)(C)(i)](https://www.law.cornell.edu/uscode/text/34/12291)); VOCA rules not checked **[VERIFY]**.
How that duty interacts with a gag order is unsettled; one reading is notice once the gag lapses.

**5. Warrant canary.** No statute or case reviewed addresses canaries directly. The closest authority is *Twitter, Inc. v.
Garland*, 61 F.4th 686 (9th Cir. 2023), cert. denied, No. 23-342 (U.S. Jan. 8, 2024)
([slip op.](https://cdn.ca9.uscourts.gov/datastore/opinions/2023/03/06/20-16174.pdf)).
The court applied strict scrutiny and upheld the FBI's redaction of aggregate national-security request counts
(slip op. 6–7, 32). The reporting bands in [50 U.S.C. § 1874(a)](https://www.law.cornell.edu/uscode/text/50/1874) run
"starting with 0"; the court read each band to "begin[] with, and include[], zero", so a recipient "could not indicate
that it received no NSLs at all" (slip op. 13). That appears to bar a canary certifying zero *national-security*
process; the case does not address ordinary criminal process.
- *For a canary:* the government can forbid speech, but no case found compels a provider to keep publishing a statement
  that has become false.
- *Against:* removing the canary may itself be treated as notifying "any other person" in breach of a § 2705(b) or
  § 1546.2 order, with contempt risk.

An alternative that appears lower-risk is a periodic transparency report that uses the statutory bands and omits
gagged items. This remains unsettled.

**6. The hosting provider.** A US provider must preserve and disclose data within its "possession, custody, or control", "regardless of whether
such communication, record, or other information is located within or outside of the United States"
([18 U.S.C. § 2713](https://www.law.cornell.edu/uscode/text/18/2713)). It appears it can be served directly and gagged
under § 2705(b). Because it stores only ciphertext and attested-enclave state, what it could produce appears limited to
that plus its own account, billing and access logs (not reviewed). Contractual notice-to-customer terms and DOJ's stated preference for seeking
enterprise data from the customer **[VERIFY]** should be checked against the provider's contract.

## Ask for counsel

We propose a published law-enforcement policy with five commitments. (1) Produce only on valid process: a warrant for
contents, and a subpoena or court order for records. (2) Explain that contents are ciphertext Matra cannot decrypt.
(3) Honor § 2703(f) preservation letters but not suspend a survivor's own deletion. (4) Notify the survivor unless a
§ 2705(b), CalECPA § 1546.2 or NSL order bars it, and again when it lapses. (5) Publish a banded semiannual transparency
report instead of a warrant canary. Is each of these lawful, and is (3) in particular permitted?

## Answer

<!-- Empty until a licensed attorney answers. Then only "Resolved (D-###)." plus a one-line public conclusion if counsel
approved one. Counsel's actual advice lives in private/DECISIONS.md (gitignored; the repo is public). -->
