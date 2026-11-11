---
id: Q-035
title: Which state's law governs a report: where the survivor lives, where the assault happened, or where the lawyer is licensed?
status: memo-ready
priority: P1
area: jurisdiction
jurisdiction: NJ, NY, CA, PA
source: interview 2026-11-11
blocks: Matcher routing tags; which counselor licences are needed
related: Q-017, Q-034
created: 2026-11-11
---

## Question

When the survivor lives in one launch state, the assault happened in another, and the named person lives in a third, which state's privilege, reporting, solicitation and limitation-period rules govern her report and who must be licensed where to counsel her?

## Context

Founder (interview 2026-11-11): launch states are CA, NJ, NY and PA. The matcher picks a lawyer "near the case / person" from a routing tag.

Founder (2026-11-11): pilot NJ and CA first, expecting other states to be close to copy-paste. Referral, solicitation and privilege rules differ by state, so each state may need its own review (Q-034).

Decided 2026-11-11 for the build: routing uses **both** the incident state and the survivor's state. The assigned counselor is a licensed attorney who first sees only matched identifiers, states and contact methods; full reports are released only after the survivor agrees (Q-023). Matra stores only ciphertext with a US confidential-computing host.

## Research

Not legal advice. There appears to be no single "governing law" for a report: each issue has its own choice-of-law rule, and they can point to different states for the same survivor.

**1. Lawyer conduct (confidentiality, solicitation, conflicts): mostly where the lawyer acts, unless the "predominant effect" is elsewhere.** Cal. RPC 8.5(b) (read in the [2026 State Bar edition](https://www.calbar.ca.gov/sites/default/files/portals/0/documents/rules/Rules-of-Professional-Conduct.pdf), pp. 59-60): (1) conduct in a matter pending before a tribunal follows the tribunal's rules; (2) other conduct follows "the rules of the jurisdiction in which the lawyer's conduct occurred, or, if the predominant effect of the conduct is in a different jurisdiction, the rules of that jurisdiction," with a safe harbor if the lawyer conforms to the rules of a state where she "reasonably believes" the predominant effect will occur. Rule 8.5(a) reaches a non-California lawyer who "provides or offers to provide any legal services in California." Pa. RPC 8.5(b)(2), [204 Pa. Code § 81.4](https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/204/chapter81/s8.5.html), has the same predominant-effect test and reasonable-belief safe harbor. NJ and NY versions are reported to track ABA Model Rule 8.5, but one secondary source says NJ omits the safe harbor **[VERIFY: NJ RPC 8.5 and NY 22 NYCRR 1200.0 Rule 8.5; njcourts.gov and nycourts.gov blocked automated access]**. ABA Formal Op. 504 (Mar. 2023) interprets Model Rule 8.5 and "predominant effect" (existence and topic confirmed only from secondary reports) **[VERIFY text; americanbar.org blocked]**. Before any suit, a counselor's pre-filing contact with a survivor is arguably "other conduct," so the predominant-effect test seems likely to apply, and it may point to the survivor's home state (where she receives the advice) rather than the incident state. This is unsettled.

**2. Who must be licensed where (UPL): the survivor's location may matter.** Cal. Bus. & Prof. Code § 6125: "No person shall practice law in California unless the person is an active licensee of the State Bar" ([leginfo](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=6125); text read via FindLaw mirror). Cal. RPC 5.5(b)(1) (2026 ed., p. 49) bars a non-admitted lawyer, "except as authorized by these rules or other law," from a "systematic or continuous presence in California for the practice of law"; the comment cites, as examples ("See, e.g."), § 6125 and Cal. Rules of Court 9.40-9.48. California's rule has no general temporary-practice paragraph like Model Rule 5.5(c). A routine pipeline sending California-resident survivors to an out-of-state lawyer could arguably be "systematic" contact; whether remote advice to a Californian is practice "in California" is not settled by the rule text. The counter-argument elsewhere: Pa. RPC 5.5(c)(4), [204 Pa. Code § 81.4](https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/204/chapter81/s5.5.html), lets an out-of-state lawyer provide temporary services that "arise out of or are reasonably related to the lawyer's practice in a jurisdiction in which the lawyer is admitted"; NJ and NY versions differ and were not read **[VERIFY: NJ RPC 5.5; NY Rule 5.5 and 22 NYCRR Part 523]**. Practical reading: a counselor may need a licence in the survivor's state, the incident state (where suit or prosecution would likely be), or both.

**3. Limitation periods: the forum's choice-of-law rule decides, and borrowing statutes differ.**
- *NJ (forum):* no general borrowing statute **[VERIFY; McCarrell does not discuss one]**; McCarrell v. Hoffmann-La Roche, Inc., 227 N.J. 569, 574 (2017) adopts Restatement (Second) Conflict of Laws § 142: NJ's period applies if NJ "has a substantial interest in the maintenance of the claim" absent "exceptional circumstances." NJ's own period for adult victims is 7 years from "reasonable discovery of the injury and its causal relationship to the act," N.J.S.A. 2A:14-2a(b)(1), as amended by [P.L. 2019, c. 120](https://pub.njleg.gov/bills/2018/PL19/120_.HTM) **[VERIFY no later amendment]**. Criminal: aggravated sexual assault and sexual assault (2C:14-2) "may be commenced at any time," N.J.S.A. 2C:1-6(a)(1) (read via FindLaw mirror).
- *NY:* CPLR 202 ([nysenate.gov](https://www.nysenate.gov/legislation/laws/CVP/202)): a claim "accruing without the state" is barred if late under either NY law or the law of the place it accrued, except that "in favor of a resident of the state the time limited by the laws of the state shall apply." NY's period for the listed Penal Law sexual offenses is 20 years, [CPLR 213-c](https://www.nysenate.gov/legislation/laws/CVP/213-C) (rev. 2024-09-06).
- *PA:* 42 Pa.C.S. § 5521(b) ([palegis.us](https://www.palegis.us/statutes/consolidated/view-statute?txtType=HTM&ttl=42&div=0&chapter=55&section=21&subsctn=0); Uniform Statute of Limitations on Foreign Claims Act): the shorter of PA's period or that of "the place where the claim accrued." PA's period for assault and battery is two years, § 5524(1); § 5524 has no adult-specific sexual-assault extension **[VERIFY other PA provisions and pending bills]**.
- *CA:* CCP § 340.16(a): for an assault at 18 or older, the later of 10 years from the last act or 3 years from reasonable discovery (text read via FindLaw mirror of [leginfo](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CCP&sectionNum=340.16)). CCP § 361 (read via FindLaw mirror) borrows a foreign time bar unless the plaintiff is a California citizen who has held the claim since accrual.
- Where a tort "accrues" for borrowing purposes is generally where the injury occurred, which for an assault is the incident state **[VERIFY per state]**. Net effect: the incident state's period may cap the claim in PA, in CA (except for California citizens), and in NY (except for NY residents), while NJ may apply its own longer period. A deadline computed from one state can be wrong.

**4. Privilege: forum law plus that forum's conflicts rule.** In federal court, FRE 501 applies state privilege law when "state law supplies the rule of decision" (civil), and federal common law otherwise ([LII](https://www.law.cornell.edu/rules/fre/rule_501)). In state court, many states apply Restatement (Second) Conflict of Laws § 139 (state with "most significant relationship" to the communication, with a forum-policy override) **[VERIFY: § 139 text and whether NJ, NY, CA, PA courts follow it]**. So the privilege that protects a survivor-counselor communication depends on where a later subpoena issues, which Matra cannot know at routing time.

**5. Criminal law and reporting.** Prosecution follows territorial jurisdiction, ordinarily the incident state; e.g., N.J.S.A. 2C:1-3(a)(1) reaches an offense when "the conduct which is an element of the offense or the result which is such an element occurs within this State" (read via FindLaw mirror, current as of 2024). Mandatory-reporting duties appear to turn on the reporter's status and location (not researched here), see Q-006, Q-036, Q-046.

**What is unsettled:** how "predominant effect" applies to a remote, app-mediated first contact; whether a counselor licensed only in the incident state may advise a survivor living elsewhere; and whether the routing tag itself becomes part of a lawyer-referral analysis (Q-017, Q-034).

## Ask for counsel

We plan to route each matched group to one counselor licensed in **both** the incident state and the survivor's home
state, or, if none exists, to two co-counseling counselors (one per state). Under each launch state's Rule 5.5 (NJ, NY,
CA, PA), is a licence in the survivor's home state required for first contact and screening, or is the incident state's
enough? For pre-suit counseling, which state's rules should counselors treat as the Rule 8.5 "predominant effect"?

## Answer

<!-- Empty until a licensed attorney answers. Then only "Resolved (D-###)." plus a one-line public conclusion if counsel
approved one. Counsel's actual advice lives in private/DECISIONS.md (gitignored; the repo is public). -->
