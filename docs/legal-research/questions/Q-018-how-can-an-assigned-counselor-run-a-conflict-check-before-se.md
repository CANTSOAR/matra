---
id: Q-018
title: How can an assigned counselor run a conflict check before seeing a matched group's contact details?
status: memo-ready
priority: P0
area: counselor
jurisdiction: NJ, NY, CA, PA
source: Callisto meeting 2026-11-10
blocks: Matcher/router design; release flow
related: Q-017, Q-010
created: 2026-11-10
---

## Question

What conflict check (RPC 1.7, 1.18) must the assigned counselor run before opening a matched group, and can it be done on limited information (for example, the named person's identifiers but not survivors' contact details) without breaching the survivors' confidentiality?

## Context

The assigned counselor or their firm might represent the named person or his employer. Build decision 2026-11-11: the
counselor (a licensed attorney) first sees the matched identifiers, states and survivors' contact methods; full reports
only after each survivor agrees. No conflict-check step precedes that first view today. Background:
[SECURITY_WHITEPAPER.md §4a](../../SECURITY_WHITEPAPER.md),
[LEGAL_RESEARCH_MEMO.md §7A](../../LEGAL_RESEARCH_MEMO.md#7a-legal-options-counselor-model-privilege-and-solicitation).

Interview 2026-11-11: a conflict case worth naming for counsel: a counselor or listed lawyer who is themselves a named
person, or who represents the named person's employer or school.

## Research

*Research by a Claude session, 2026-11-11; citations re-checked by a second session the same day. Not legal advice.
Rule text quoted was read in the sources linked; everything else is marked **[VERIFY]**.*

**1. Which conflicts matter.** (a) The counselor's firm represents, or represented, the named person or his employer or
school: a concurrent conflict if "the representation of one client will be directly adverse to another client", or a
"significant risk" of material limitation by duties to "another client, a former client or a third person"
([NY Rule 1.7(a)(1)-(2)](https://nysba.org/wp-content/uploads/2026/09/NYSBA-NY-Rules-of-Professional-Conduct-as-amended-through-July-1-2026-1.pdf);
[PA RPC 1.7(a)(1)-(2)](https://www.padisciplinaryboard.org/Storage/media/pdfs/20251112/194946-rpc2024-11-14.pdf), same
substance). (b) The counselor is, or is close to, the named person: material limitation by "the lawyer's own ...
personal interests" (NY 1.7(a)(2); PA "a personal interest of the lawyer"). Consent cures only if the lawyer reasonably
believes she can be competent and diligent (NY 1.7(b)(1)), which may be hard to meet in case (b). (c) Matched
survivors whose accounts diverge (see Q-024). NJ RPC 1.7 is believed to track the Model Rule **[VERIFY: the
njcourts.gov RPC PDF returned 404 this session]**.

**2. A check is required, and the rules reward limiting what the lawyer sees first.**
- NY requires every firm, solos included, to keep written records of engagements and a system checking "proposed
  engagements ... against current and previous engagements" when it "agrees to represent a new client"; substantial
  failure is itself a violation (NY 1.10(e)(1), (f); cmt [9]-[9A], which are NYSBA comments, not court-adopted). NYC Bar
  Formal Op. 2003-03 (under predecessor DR 5-105(e)) says the records should at minimum hold client names, "the precise
  names of parties ... whose interests are materially adverse", and "a brief description of each engagement or
  prospective engagement" ([nycbar.org](https://www.nycbar.org/?p=2013)). Whether PA, CA and NJ have an express
  record-keeping rule was not checked **[VERIFY]**.
- Prospective clients (NY, PA, CA Rule 1.18): what the lawyer learns stays confidential even if no relationship forms
  (NY 1.18(b); PA 1.18(b) limits this to information "which may be significantly harmful"). If she receives information
  that "could be significantly harmful" (NY, PA 1.18(c)) or that is "material to the matter" (CA 1.18(c), a lower bar),
  she and her firm are barred from the adverse side unless both clients consent, or she "took reasonable measures to
  avoid exposure to more disqualifying information than was reasonably necessary to determine whether to represent the
  prospective client" and is screened with written notice (NY 1.18(d)(2); PA 1.18(d)(2)(i)-(iii);
  [CA 1.18(d)(2)](https://www.calbar.ca.gov/Portals/0/documents/rules/Rule_1.18-Exec_Summary-Redline.pdf), which says
  "more information"). NY cmt [3]: the lawyer "often must learn such information to determine whether there is a
  conflict of interest"; cmt [4]: she "should limit the initial consultation to only such information as reasonably
  appears necessary". CA cmt [3] says "must limit the initial interview". ABA Formal Op. 492 (2020), Part D, pp. 8-9,
  says lawyers "should warn prospective clients against disclosing detailed information"
  ([copy read](https://omahadailyrecord.com/sites/default/files/ABA%20Prospective%20Clients%20-%20ABA%20Formal%20Opinion%20492.pdf)).
- **Reading for Matra:** the rules appear to contemplate a staged release. Showing only the named person's identifiers
  and state before a conflict check looks like the "reasonable measures" these rules describe; the 2026-11-11 flow,
  which shows survivors' contact methods at the same time, gives the counselor more than the check needs. Counter-
  argument: the named person's identity plus "someone accused him" may itself be significantly harmful or material, so
  even stage one can disqualify a conflicted counselor; limiting reduces, not removes, exposure.

**3. Running the check without breaching confidentiality.** Inside a firm, sharing a prospective matter's parties with
colleagues to detect conflicts appears permitted "when the disclosure is otherwise authorized" (Model Rule 1.6 cmt
[14], [local copy](../../../compiled_resources/03_legal_ethics_privilege_statutes/ABA_Model_Rule_1.6_Confidentiality.md);
PA RPC 1.6 cmt [20], same words). NY 1.6(a)(2) allows disclosure "impliedly authorized to advance the best interests of
the client" that is "reasonable" or "customary in the professional community". CA Rule 1.6 (eff. 2018) has no
conflict-check exception; its only exception is preventing a criminal act likely to cause death or substantial bodily
harm (CA 1.6(b),
[text](https://www.calbar.ca.gov/Portals/0/documents/rules/Rule_1.6-Exec_Summary-Redline.pdf)), so an in-firm check
would rest on consent or on B&P Code § 6068(e) as construed **[VERIFY]**. Between firms (the lateral-move and merger
setting), Model 1.6 cmt [13] bars even limited disclosure where it would "prejudice the client", e.g. a consultation
about "a criminal investigation that has not led to a public charge"; an unreported sexual-assault allegation looks
analogous. Practical problems: (i) a firm conflict database becomes a durable, discoverable record that someone accused
the named person, against Matra's minimisation design; (ii) Matra matches on unique identifiers (phone, email, handle)
while conflict systems are keyed on names and entities, so a check on identifiers alone may miss a hit. An alternative
is a Matra-run check against a list each counselor supplies, but that list is likely her clients' "confidential
information" under NY 1.6(a) ("likely to be embarrassing or detrimental"), needing consent or a blinded comparison
**[VERIFY]**.

**4. Limited-services safe harbor (fit unsettled).** NY Rule 6.5 and PA RPC 6.5 relax conflict checking for
"short-term limited legal services" under a sponsored program (NY sponsors: "court, government agency, bar association
or not-for-profit legal services organization", services "free of charge", 6.5(c); PA: "nonprofit organization or
court"): the lawyer complies with 1.7 and 1.9 only if she "knows" of a conflict, and 1.10 imputation is largely
inapplicable (NY 6.5(a)-(b), cmt [1], [3], [4A]; PA 6.5(a)-(b), cmt [1]-[4]). NY cmt [1]: such programs operate where
"it is not feasible for a lawyer to utilize the conflict-checking system required by Rule 1.10(e)". Open points: whether
Matra or a legal-aid partner is a qualifying sponsor; whether a paid counselor fits NY's free, pro bono framing; whether
reviewing a matched group is "short-term"; and the rule never excuses a known conflict. NJ and CA Rule 6.5
**[VERIFY]**.

**Unsettled:** whether one counselor reviewing a matched group has several prospective clients at once; whether the
named person's identifiers alone are "significantly harmful"/"material"; whether a Matra-run conflict list satisfies NY
1.10(e) for the counselor's firm.

## Ask for counsel

Decided flow: the counselor first sees the named person's identifiers, states and survivors' contact methods; full
reports only with each survivor's consent. Must a conflict check (NJ, NY, CA, PA RPC 1.7/1.18; NY 1.10(e)) come before
she sees contact methods, so that we split the first view into identifiers-and-states, then contact methods? May she
enter the named person's identifiers in her firm's conflict database, or should Matra check against a list she
supplies? Does Rule 6.5 apply?

## Answer

<!-- Empty until a licensed attorney answers. Then only "Resolved (D-###)." plus a one-line public conclusion if counsel
approved one. Counsel's actual advice lives in private/DECISIONS.md (gitignored; the repo is public). -->
