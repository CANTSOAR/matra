---
id: Q-017
title: Is automatically assigning a matched group to one counselor by jurisdiction and circumstance a lawyer referral?
status: memo-ready
priority: P0
area: referral
jurisdiction: NJ, NY, CA, PA
source: Callisto meeting 2026-11-10
blocks: Matcher/router design
related: Q-001, Q-018
created: 2026-11-10
---

## Question

If a separate matcher server assigns each matched group to one qualified counselor based on the survivor's jurisdiction and circumstance, is that a lawyer referral (RPC 7.2(b)-(c), 7.3) and what rules govern how the assignment is made?

## Context

Decided at the Callisto meeting 2026-11-10: the matcher should not be the lawyer. A separate server learns only 'match + routing tag' (state, category such as campus/workplace/criminal), holds no decryption keys, and assigns the group to one counselor; only that counselor's seals are released. Today every counselor on the roster with seals receives the group. Related: Q-001. Background: [SECURITY_WHITEPAPER.md §4a](../../SECURITY_WHITEPAPER.md), [LEGAL_RESEARCH_MEMO.md §5](../../LEGAL_RESEARCH_MEMO.md#5-unauthorized-practice-of-law-lawyer-referral-and-fee-sharing).

Interview 2026-11-10: the founder now wants the matcher to also judge whether reports are strong enough to open a case (see Q-022), pick a lawyer near the case or person using low-knowledge metadata, and send the bundle to that lawyer directly (see Q-021).

Build decisions 2026-11-11 (facts for counsel to correct): the matcher is public code running in a confidential-computing
enclave with attestation; it routes on **both** the incident state and the survivor's state; the assigned counselor (a
licensed attorney, engaged and paid by Matra or a legal-aid partner, never by survivors, and barred from paid representation
of survivors she contacts, per [LEGAL_RESEARCH_MEMO.md §7A](../../LEGAL_RESEARCH_MEMO.md)) first sees only matched identifiers,
states and contact methods, and sees full reports only after each survivor agrees. No attorney pays Matra anything
([ATTORNEY_PARTNER_MOU_TEMPLATE.md §7](../../ATTORNEY_PARTNER_MOU_TEMPLATE.md)).

## Research

*Research by a non-lawyer Claude session, 2026-11-11. Not legal advice.*

**1. The rules turn on payment, who is the client, and who selects; none addresses algorithmic routing as such.** No rule,
opinion or case found this session treats software assignment differently from human assignment. The tests are functional.

- **NJ, payment.** RPC 7.3(d) bars giving "anything of value to a person or organization to recommend or secure the lawyer's
  employment", except public communications and fees of a lawyer referral service "operated, sponsored, or approved by a bar
  association" (text as quoted in [ACPE 732 / CAA 44 / UPL 54 (2017)](../../../compiled_resources/08_legal_landscape_and_pitfalls/NJ_ACPE732_CAA44_UPL54_2017_Avvo_LegalZoom_RocketLawyer.pdf), slip op. 5;
  RPC 7.2(c) quoted id. at 4). Labels do not control; a per-matter fee is "a hallmark of an attorney referral service"
  (id. at 7; on labels, id. at 4, 6). Per-lead flat fees can be allowed, per-client fees cannot (id. at 5, citing CAA Op. 43). On Matra's facts
  (no money from counselors or survivors) this leg appears not to be triggered.
- **NJ, furnishing lawyers.** RPC 7.3(e) bars a lawyer from knowingly assisting an organization "that furnishes or pays for
  legal services to others"; lawyers may be "recommended, employed or paid by or cooperat[e] with" only listed bodies,
  including "a legal aid office", "a bona fide nonprofit community organization" (as the opinion paraphrases the list) and
  "any bona fide organization that recommends, furnishes or pays for legal services to its members or beneficiaries"
  ([ACPE 740 / UPL 58 (2021)](../../../compiled_resources/08_legal_landscape_and_pitfalls/NJ_UPL58_ACPE740_2021_nonlegal_companies_matching_lawyers.pdf), slip op. 4).
  The last category is a legal service plan with conditions: client is the member, not the organization
  (7.3(e)(4)(iv)); member may select other counsel (7.3(e)(4)(v)); registration with the AOC (7.3(e)(4)(vii)) (ACPE 732 at 3).
  ACPE 740 held that a company that "matches" customers with a lawyer is "holding itself out as an entity that will furnish a
  lawyer", whatever it calls the service, and that lawyers who take the work violate RPC 5.5(a)(2) and 7.3(e) (slip op. 3-5).
  It also says non-law-firm companies cannot serve customers "either through staff lawyers or by furnishing outside lawyers",
  and in-house counsel "may not provide legal advice or legal services to customers of their employer" (id. at 3-4);
  footnote 1 (id. at 2) notes nonprofits serving low and moderate income persons may practice through staff attorneys under R. 1:21-1(e).
  Full current text of RPC 7.2, 7.3 and R. 1:21-1(e) not opened (njcourts.gov blocked automated access) **[VERIFY]**.
- **NY.** NY Rule 7.2(a) (22 NYCRR 1200.0) bars paying for a recommendation; 7.2(b) lets a lawyer be "recommended, employed or paid
  by, or cooperate with" a legal aid office "operated or sponsored by a bona fide, non-profit community organization"
  ((b)(1)(ii)), a bar-approved referral service (b)(3), or a bona fide organization serving members or beneficiaries under
  six conditions, including that the member "is recognized as the client" and the organization gives relief to a member who
  claims its chosen counsel "would be unethical, improper or inadequate" ((b)(4)(iii)-(iv)); all require "no interference with the exercise of independent professional
  judgment" ([LII, Rule 7.2](https://www.law.cornell.edu/regulations/new-york/22-NYCRR-1200.7.2)).
- **CA (strictest).** [Bus. & Prof. Code § 6155(a)](https://california.public.law/codes/business_and_professions_code_section_6155)
  bars any nongovernmental entity from operating "for the direct or indirect purpose, in whole or in part, of referring
  potential clients to attorneys", and bars attorneys from accepting such referrals, unless the service is State Bar-certified
  ((a)(1)). The prohibition itself has no fee element. § 6155(g) contrasts joint advertising, where the consumer may "select and initiate contact with" named
  attorneys ((g)(1)(A)), with "certifiable referral activity", where someone other than the consumer "refers the consumer to an
  attorney" ((g)(2)). "None of the following is a lawyer referral service" ((c)): group or prepaid plans for members ((c)(2)); "a program having as its purpose the referral of
  clients to attorneys for representation on a pro bono basis" ((c)(3)); a nonprofit partnering with a certified service
  ((c)(4)). The State Bar's minimum standards for referral services were not read **[VERIFY]**.
- **PA.** [Pa.R.P.C. 7.2(b)(2)](https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/204/chapter81/s7.2.html)
  (as amended 2024, 54 Pa.B. 6696) allows paying "the usual charges of a lawyer referral service or legal service plan";
  Comment (6) defines a referral service as an entity "that receives a fee or charge for referring" a client to a lawyer from a
  panel. Comment (4) allows paying lead generators that do "not recommend the lawyer" and do not imply they have "analyzed a
  person's legal problems when determining which lawyer should receive the referral" (relevant to Q-022). A fee-free router
  appears to fall outside the PA definition.

**2. Arguments that automatic assignment is *not* a lawyer referral.** (a) The counselor is Matra's (or a legal-aid
partner's) own engaged attorney giving limited options counseling, not an outside lawyer "secured" for employment; the
survivor never becomes her paying client (memo §7A). Internal allocation of one organization's staff by state resembles a
legal aid office assigning an intake attorney, a setting NJ 7.3(e) and NY 7.2(b)(1) permit lawyers to work in, if Matra or
its partner qualifies as such an office (Q-001).
(b) No value flows, so NJ 7.3(d)/7.2(c), NY 7.2(a) and the PA definition are not engaged. (c) In CA the program could fit
§ 6155(c)(3) if the counselor's work is free to the survivor.

**3. Arguments that it *is* (or becomes) one.** (a) ACPE 740 looked past the "matching" label to whether the entity holds
itself out to furnish a lawyer; a nonlawyer nonprofit that is not itself a qualifying legal-services organization may be in
that position, which is Q-001 and Q-051; ACPE 740's "staff lawyers" language cuts against argument 2(a) unless an
exception such as R. 1:21-1(e) applies. (b) CA § 6155(a) reaches "indirect" referral "in part" with no fee element, and
(g) treats selection by someone other than the consumer as the mark of referral; an algorithm choosing the counselor is
that. Whether a counselor paid by Matra is "pro bono" for (c)(3) is unsettled. (c) If the matcher later sends a bundle to an
outside lawyer for representation, judged by case strength (Q-021, Q-022), it moves from internal allocation to
furnishing outside counsel, the fact pattern in ACPE 740, and adds a UPL question about the strength judgment.

**4. What the rules appear to require of the assignment itself (if permitted).** Survivor is the client, not Matra (NJ
7.3(e)(4)(iv); NY 7.2(b)(4)(iii)); she can decline the assigned counselor and get another or choose her own (NJ
7.3(e)(4)(v); NY (b)(4)(iv)); Matra does not direct the counselor's judgment (NY 7.2(b) chapeau; NJ RPC 5.4(c) as discussed in
ACPE 732 at 4); no lawyer pays for placement on the roster. Routing by both states raises whether the counselor must be
admitted where the incident occurred, where the survivor lives, or both; RPC 5.5 was not reviewed this session **[VERIFY]**.

**Unsettled.** No NJ, NY, CA or PA authority found on a nonprofit's automated allocation of its own counselors; whether a
nonlawyer nonprofit can furnish counselors at all (Q-001, Q-051); CA "pro bono" scope; whether registration as a plan or
bar approval is the safer route in NJ. Westlaw/Lexis unavailable. ABA Model Rule 7.2 comments not reachable **[VERIFY]**.

## Ask for counsel

We plan to have an attested matcher assign each matched group to one Matra-engaged attorney counselor (paid by Matra or a
legal-aid partner, nothing from survivors or lawyers) chosen by incident state and survivor state, with the survivor free to
decline and request another counselor or her own lawyer. Is that a lawyer referral or legal-service-plan activity needing bar
approval, registration, or CA § 6155 certification in NJ, NY, CA or PA, and must the counselor be admitted in both states?
If it is, would survivor choice from a list of eligible counselors, or running it through a legal-aid partner, avoid it?

## Answer

<!-- Empty until a licensed attorney answers. Then only "Resolved (D-###)." plus a one-line public conclusion if counsel
approved one. Counsel's actual advice lives in private/DECISIONS.md (gitignored; the repo is public). -->
