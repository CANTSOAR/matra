---
id: Q-023
title: What consent must a survivor give for her report to be released to an attorney she did not choose, on a threshold she cannot see?
status: memo-ready
priority: P0
area: consent
jurisdiction: NJ, NY, CA, PA, federal
source: interview 2026-11-10
blocks: Report consent screen; single-report release; whether the survivor sees or approves the assigned lawyer
related: Q-021, Q-022, Q-009, Q-010
created: 2026-11-11
---

## Question

What must a survivor be told and agree to, at the time she writes a report, for Matra to later release it to an attorney she did not pick, when a threshold she cannot see is met, possibly with no other matching report?

## Context

Founder (interview 2026-11-10): survivors document at their own pace and supply as much or as little as they can; Matra creates a sealed "report" on their behalf. Release happens when the matcher decides a case threshold is met, which may be one detailed report alone, not a match. The lawyer is chosen by the matcher by location and circumstance. Current consent text covers only counselor contact after a match (`MATCHING_CONSENT_LINES`, [LEGAL_RESEARCH_MEMO.md §7A](../../LEGAL_RESEARCH_MEMO.md#7a-legal-options-counselor-model-privilege-and-solicitation)). VAWA consent must be 'reasonably time-limited' if grant funds are involved (Q-009).

Founder (2026-11-10, follow-up): consent should be optional at several points: at the start, again after seeing who the lawyer is, and again after learning more people are involved (see Q-032).

Build decision 2026-11-11 (added by research session; correct if wrong): the "threshold" is now mechanical, not a
strength judgment. A match exists when two or more distinct phone-verified accounts produce the same OPRF identifier
token; routing to one counselor uses incident state and survivor state (Q-017). Case strength is judged by the
attorney counselor (Q-022). The counselor first sees only the matched identifiers, states and the contact method she
chose; the full report is released only after that survivor agrees, at that time. So one report alone no longer
triggers automatic release, and the "attorney she did not choose" is the counselor, not the litigating lawyer, whom
survivors choose (Q-010). The current opt-in text is `MATCHING_CONSENT_LINES` in `apps/web/src/lib/disclosures.ts`.

## Research

*Researched 2026-11-11 by a Claude session. Not legal advice.* With the 2026-11-11 design, the question splits into
two consents: (A) at lodging, to release the **matching entry** (identifiers, states, contact method) to a counselor
picked by a published rule; (B) at contact, to release the **full report** to that now-named counselor. The law below
bears on how specific, written and time-limited (A) must be, and on what (B) must explain.

**1. Attorney-ethics "informed consent" (binds the counselor, not Matra).**
- *NY.* Rule 1.0(j): agreement "after the lawyer has communicated information adequate for the person to make an
  informed decision, and after the lawyer has adequately explained to the person the material risks of the proposed
  course of conduct and reasonably available alternatives"; 1.0(e) "confirmed in writing" includes a writing from the
  person ([22 NYCRR 1200.0, R. 1.0](https://www.law.cornell.edu/regulations/new-york/22-NYCRR-1200.1.0)).
- *NJ.* RPC 1.0(e) appears to track the same language **[VERIFY: njcourts.gov RPC PDF blocked our fetch]**.
- Consent (A) is given to Matra's software before any lawyer is in the picture, so it is not itself a lawyer-obtained
  "informed consent". The rules appear to bite at (B): the counselor's own disclosures (limited scope under
  [NY R. 1.2(c)](https://www.law.cornell.edu/regulations/new-york/22-NYCRR-1200.1.2), the
  third-party payer under RPC 1.8(f), which in NY requires "the client gives informed consent" and no interference with
  independent judgment ([R. 1.8(f)](https://www.law.cornell.edu/regulations/new-york/22-NYCRR-1200.1.8))).
- *Prospective client.* NY R. 1.18(a) covers a person who "consults with a lawyer about the possibility of forming a
  client-lawyer relationship"; 1.18(e)(1) excludes one who "communicates information unilaterally ... without any
  reasonable expectation that the lawyer is willing to discuss" it ([R. 1.18](https://www.law.cornell.edu/regulations/new-york/22-NYCRR-1200.1.18)).
  Argument for Matra's design: consent text that frames the entry as a request to be contacted by an attorney about
  her options gives her a "reasonable expectation", which supports 1.18 confidentiality (and the privilege theory in
  memo §7A). Counter: she consults no identifiable lawyer, and a role-based recipient chosen later is untested.
  NJ RPC 1.18 text **[VERIFY]**.

**2. VAWA, if any VAWA-funded grantee or subgrantee touches the data (Q-009).** 34 U.S.C. 12291(b)(2)(B)(ii) bars
release of "individual client information without the informed, written, reasonably time-limited consent" of the
person, "regardless of whether the information has been encoded, encrypted, hashed" ((b)(2)(B)(i)); and (D)(ii)(I)
bars requiring consent "as a condition of eligibility for the services" ([LII](https://www.law.cornell.edu/uscode/text/34/12291);
local copy in `compiled_resources/08_legal_landscape_and_pitfalls/`). OVW's FAQ ([Oct. 2017](https://www.justice.gov/ovw/page/file/1006896/download),
local copy `OVW_VAWA_Confidentiality_FAQ_2017.pdf`; no later edition found) is agency guidance, not a rule, and the
most specific found:
- Q15 (pp. 5-6): releases must be "written, informed, reasonably time limited, and signed"; no "blanket release";
  must "specify the scope and limited circumstances"; discuss "why the
  information might be shared, who would have access ... and what information could be shared"; "record the
  agreement"; and "specify the duration".
- Q16 (p. 6): duration must be "reasonable", depending "on the specific situation". Q19 (p. 6): voluntary, not a
  condition of service. Q20 (p. 6): oral releases are not allowed; email or fax may work.
- Q8 (p. 3): non-funded partners are not covered but are encouraged to "opt-in".

Tension: (A) names a role and a rule, not a person, and a sealed entry may wait years. For compliance: scope (which
fields), recipient class (a licensed attorney counselor from a published roster for her state), trigger and duration
can all be stated exactly, and the full report waits for (B). Against: "who would have access" may require a named
recipient, and an open-ended wait is hard to call "reasonably time-limited". No authority found either way.

**3. "Written" for a tap in an app.** E-SIGN, 15 U.S.C. 7001(a)(1), stops a record being denied effect "solely
because it is in electronic form", but only for a "transaction", i.e. actions "relating to the conduct of business,
consumer, or commercial affairs" (§ 7006(13)) ([7001](https://www.law.cornell.edu/uscode/text/15/7001),
[7006](https://www.law.cornell.edu/uscode/text/15/7006)). A free victim-services release may not be a "transaction".
NY R. 1.0(x) defines "writing" to include an "electronic record" and a "signed" writing to include an electronic
"process ... executed or adopted by a person with the intent to sign" ([R. 1.0](https://www.law.cornell.edu/regulations/new-york/22-NYCRR-1200.1.0)),
but that governs lawyers, not VAWA. OVW Q15 says "signed" and Q20 accepts email or fax, which suggests a recorded
electronic act may suffice. Whether an in-app click with the stored text (which Matra already keeps) is a "written",
"signed" VAWA release is **unsettled**; NJ UETA (N.J.S.A. 12A:12-1 et seq.) **[VERIFY]**.

**4. State privacy-law consent, as a benchmark.** NJ Data Privacy Act, N.J.S.A. 56:8-166.4 (as restated by
P.L.2025, c.367, approved Jan. 20, 2026): "Consent" is "a clear affirmative act signifying a consumer's freely given,
specific, informed, and unambiguous agreement"; it excludes "acceptance of a general or broad terms of use" and "dark
patterns" ([c.367](https://pub.njleg.gov/Bills/2024/PL25/367_.HTM)). Sensitive data includes "sex life"; processing
it needs consent, and revocation must be "at least as easy as" giving consent, with processing stopped within 15
days (C.56:8-166.12(a)(4), (6), [c.266](https://pub.njleg.gov/Bills/2022/PL23/266_.HTM)). The act has no nonprofit
exemption (C.56:8-166.13 as amended), but applies only at 100,000 consumers (or 25,000 plus revenue from data sales)
(C.56:8-166.5), so likely not in a pilot; it is a useful drafting floor. The FTC Act's "corporation" covers entities
"organized to carry on business for its own profit or that of its members" ([15 U.S.C. 44](https://www.law.cornell.edu/uscode/text/15/44)),
so a true nonprofit may be outside FTC deception jurisdiction; state UDAP and CA/PA law **[VERIFY]** (Q-036).

**5. Staged consent.** The founder's three points map onto (A), (B) and a later step; (B) after a named counselor
appears to meet "who would have access" for the full report. Telling her others exist is Q-032 and Q-052; revocation
after release is Q-050.

**Unsettled.** No case or opinion found on advance consent to release to a role-defined, not-yet-chosen attorney on a
mechanical trigger. Whether VAWA applies at all depends on funding (Q-009). Pinpoints to the ABA Model Rule 1.0 and
1.7 comments on advance consent could not be opened (americanbar.org blocked) **[VERIFY]**.

## Ask for counsel

We propose: at lodging, a separate, unbundled, revocable opt-in that releases only her identifiers, states and chosen
contact method to one licensed attorney counselor from a published state roster, triggered only when a second verified
account names the same identifier, valid 12 months with in-app renewal; the full report goes only after a second
consent once the named counselor contacts her. Is that a valid "informed, written, reasonably time-limited" release
under 34 U.S.C. 12291(b)(2) and adequate under NJ/NY RPC 1.0 and 1.18, and must the counselor be named at lodging?

## Answer

<!-- Empty until a licensed attorney answers. Then only "Resolved (D-###)." plus a one-line public conclusion if counsel
approved one. Counsel's actual advice lives in private/DECISIONS.md (gitignored; the repo is public). -->
