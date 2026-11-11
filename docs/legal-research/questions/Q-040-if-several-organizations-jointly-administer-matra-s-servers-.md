---
id: Q-040
title: If several organizations jointly administer Matra's servers, is each a custodian that can be subpoenaed, and what agreements must bind them?
status: memo-ready
priority: P1
area: keys
jurisdiction: NJ, NY, CA, PA, federal
source: interview 2026-11-11
blocks: Multi-organization governance of servers and keys; agreements with key holders
related: Q-016, Q-039, Q-041, Q-009
created: 2026-11-11
---

## Question

If several organizations (universities, nonprofits) share administrative control of Matra's servers through a split-key scheme, is each organization a custodian that can be served with process for Matra data, and what must their agreements with Matra say (confidentiality, notice of demands, VAWA non-disclosure)?

## Context

Founder (interview 2026-11-11): "multiple orgs [should] have admin access, via the split key approach ... ideally it should exist in a way that actually having the server is useless, so that even if someone is able to attain access, they can't do anything harmful."

Founder (2026-11-11): admin access is a voting right; n of m votes are needed to push a change, mirroring n-of-m keys. See Q-044.

Build facts (decided 2026-11-11): hosting is a US confidential-computing provider that stores only ciphertext; the
matcher runs as public code in an attested enclave; the OPRF key is split n-of-m across separate institutions. So a
partner organization holds a key share and a deploy vote, not a copy of the data. No partner agreement exists yet.

## Research

*Prepared by a Claude research session, 2026-11-11. Not legal advice. Sources linked were opened this session; anything
else is marked [VERIFY]. Compelled production of a key share or compelled partial evaluations is covered in Q-016 and
not repeated here. Public-university records laws are Q-041. Joint-venture liability for votes is Q-044.*

**1. Who is a "custodian": the test is possession, custody or control, not job title.**
- A federal subpoena reaches materials "in that person's possession, custody, or control"
  ([Fed. R. Civ. P. 45(a)(1)(A)(iii)](https://www.law.cornell.edu/rules/frcp/rule_45)). New York uses the same words for
  non-party subpoenas ([CPLR 3120(1)(i)](https://www.nysenate.gov/legislation/laws/CVP/3120)). NJ (R. 1:9-2, R. 4:14-7),
  CA and PA equivalents were not opened [VERIFY].
- *Control* is defined as a legal right to obtain on demand in many courts. The Third Circuit has said "[i]n the
  absence of control by a litigating corporation over documents in the physical possession of another corporation, the
  litigating corporation has no duty to produce" (*Gerling Int'l Ins. Co. v. Comm'r*, 839 F.2d 131, 140 (3d Cir.
  1988)). In consecutive sentences it has also said "the legal right or ability to obtain" (*Mercy Cath. Med. Ctr. v.
  Thompson*, 380 F.3d 142, 160 (3d Cir. 2004)). Both are quoted in *In re Valsartan, Losartan & Irbesartan Prods. Liab.
  Litig.*, No. 1:19-md-02875, Special Master Order No. 6, ECF No. 1018, slip op. at 5, 9 (D.N.J. Mar. 12, 2021)
  ([PDF](https://www.njd.uscourts.gov/sites/njd/files/MDL2875_SMOrder6%28%231018%29.pdf)), a Rule 34 party-control
  ruling. The order calls the Third Circuit's position "a bit ambiguous" (at 9), cites D.N.J. and E.D. Pa. rulings that
  "reject the 'practical ability' test in favor of the 'legal right' test" (at 8), and found neither test met, so did
  not resolve it (at 9). It asked "what did the contracts ... provide with respect to the ... right to compel production"
  (at 11). It also reports plaintiffs' reliance on *Afros S.P.A. v. Krauss-Maffei Corp.*, 113 F.R.D. 127, 129 (D. Del.
  1986): "[i]f a party has control over or shares control of documents with a third person, then a court can order
  production" (at 4; *Afros* not opened). The Ninth Circuit is said to reject a practical-ability test in *In re
  Citric Acid Litig.*, 191 F.3d 1090, 1107-08 (9th Cir. 1999) [VERIFY: not opened]; Second Circuit courts are often
  described as using practical ability [VERIFY].
- *Applied to Matra (an argument, untested).* A partner that holds one key share and one deploy vote has no copy of the
  data and cannot obtain it alone, which points to **no possession and no control** under a legal-right test. Three
  facts cut the other way. (a) If the partner agreement gives partners a right to receive Matra data or logs, that right
  is itself control; the Valsartan order shows courts read the contract. (b) Under a practical-ability or "shares
  control" test, n partners acting together *can* deploy code, so a litigant may argue each partner shares control of
  the system. (c) Whatever a partner does hold (its share, its vote records, emails with Matra, any admin or audit logs)
  is in its own possession and is reachable like any other record, subject to undue-burden limits
  ([Rule 45(d)(1), (d)(3)(A)(iv)](https://www.law.cornell.edu/rules/frcp/rule_45)) and relevance (Rule 26(b)(1), not
  opened [VERIFY]).

**2. The Stored Communications Act may help with civil subpoenas, and cuts both ways with the government.**
- A provider of "remote computing service", "the provision to the public of computer storage or processing services"
  ([18 U.S.C. § 2711(2)](https://www.law.cornell.edu/uscode/text/18/2711)), "shall not knowingly divulge" content
  ([§ 2702(a)(2)](https://www.law.cornell.edu/uscode/text/18/2702)). Non-content records may go to "any person other
  than a governmental entity" ([§ 2702(c)(6)](https://www.law.cornell.edu/uscode/text/18/2702)).
- *O'Grady v. Superior Court*, 139 Cal. App. 4th 1423 (6th Dist. 2006)
  ([text](https://caselaw.findlaw.com/ca-court-of-appeal/1025400.html); pin cites [VERIFY]) held civil subpoenas to
  email providers unenforceable because the Act "makes no exception for civil discovery"; "the discovery must be
  directed to the owner of the data, not the bailee to whom it was entrusted." It is a California intermediate
  appellate decision; how NJ, NY and PA courts treat the point is [VERIFY]. If Matra and its host are RCS providers, a
  civil litigant (for example a named man suing for defamation) may be unable to get even the ciphertext from them,
  and may be sent to the survivor. Whether Matra's vault is a service "to the public" for § 2702(a)(2), and whether a
  key-share partner is a "provider" at all (it serves Matra, not the public), are doubtful [VERIFY].
- Government process is different. RCS content can be compelled by warrant, or by subpoena or § 2703(d) order with
  prior notice to the subscriber ([§ 2703(b)(1)](https://www.law.cornell.edu/uscode/text/18/2703)); subscriber
  records, including "temporarily assigned network address", by subpoena (§ 2703(c)(2)); preservation on request
  (§ 2703(f)). A provider served under § 2703 can
  be ordered not to notify "any other person" ([§ 2705(b)](https://www.law.cornell.edu/uscode/text/18/2705)). A
  notice-of-demand clause therefore cannot promise notice in every case, and it binds only to the extent the law allows.

**3. VAWA confidentiality reaches a partner only through funding or contract.**
- Grantees and subgrantees may not disclose personally identifying information, defined to include data "encoded,
  encrypted, hashed, or otherwise protected", without "informed, written, reasonably time-limited" consent; if a
  statute or court compels release they must make "reasonable attempts to provide notice" to victims
  ([34 U.S.C. § 12291(a)(25), (b)(2)(B)-(C)](https://www.law.cornell.edu/uscode/text/34/12291)).
- OVW's FAQ ([Oct. 2017](https://www.justice.gov/ovw/page/file/1006896/download); predates the 2022 reauthorization,
  currency [VERIFY]) says partners that receive no VAWA funds "are not covered" but are encouraged to "opt-in" (Q8). For third-party or cloud storage, "reasonable
  precautions" include a contract specifying that "the service provider owns the information" (Q32); "service provider"
  there appears to mean the victim-service grantee, not the host [VERIFY with OVW]. The FAQ treats only a statute or a
  *court* as compelling release (Q5); whether an attorney-issued subpoena without a court order qualifies is unclear
  [VERIFY]. So VAWA terms bind a university or nonprofit partner only if it or Matra takes VAWA money (Q-009) or if the
  agreement imports them by contract.

**What is unsettled.** No case found applies possession-custody-control to a holder of a threshold key share or deploy
vote. Which "control" test a NJ, NY, CA or PA state court would use for such a partner was not researched [VERIFY].
Whether a contractual confidentiality clause gives any ground to resist a subpoena (as opposed to a reason to seek a
protective order) was not researched [VERIFY]; it is commonly assumed, but not checked here, that private agreements
do not override compulsory process.

**Drafting points a lawyer could test (from the above, not advice).** No partner right to obtain Matra data or logs on
demand; Matra (or the survivor) owns all data; partner keeps minimal records of its votes and evaluations; prompt notice
to Matra of any demand "unless legally prohibited", and a commitment to let Matra move to quash or seek a protective
order; VAWA confidentiality opted into by contract, including notice to victims if release is compelled; each partner
states where it can be served, so the forum mix in Q-016 is known in advance.

## Ask for counsel

We plan to give 3-5 universities and nonprofits each one key share and one deploy vote, with no copy of the data and no
contractual right to obtain it, under an agreement with notice-of-demand (unless prohibited), cooperation to quash, and
VAWA-style confidentiality by contract. (1) Under NJ, NY, CA, PA and federal law, does such a partner have "possession,
custody, or control" of Matra data, or only of its own share and records? (2) Do the SCA and O'Grady keep civil
litigants from getting ciphertext from Matra and its host? (3) What must the agreement add or drop?

## Answer

<!-- Empty until a licensed attorney answers. Then only "Resolved (D-###)." plus a one-line public conclusion if counsel
approved one. Counsel's actual advice lives in private/DECISIONS.md (gitignored; the repo is public). -->
