---
id: Q-042
title: If the matcher's logic cannot be inspected, can Matra or the counselor defend a match against defamation or reliability challenges?
status: memo-ready
priority: P1
area: matching
jurisdiction: NJ, NY, CA, PA
source: interview 2026-11-11
blocks: Matcher design (opaque vs. published logic); strength heuristic
related: Q-015, Q-014, Q-022
created: 2026-11-11
---

## Question

If no one can inspect the matcher's logic or inputs, can Matra and the counselor show a court why two reports were matched (for a defamation defence or a reliability challenge), and could a court order the logic disclosed?

## Context

Founder (interview 2026-11-11): the matcher should be "almost like a smart contract, where it just runs on a server with no one accessing it and no way to see what its logic is", using "the bare minimum from each report to match them by named person and strength of report via some heuristic". Note: the repo is public, so the code is visible; the founder's goal is that no person can access the running server or its data. Matching today uses unique identifiers, never names. Case strength is judged by the counselor (Q-022).

Build decisions 2026-11-11: the matcher is public code running in a confidential-computing enclave with remote
attestation; it compares blinded OPRF tokens (key split n-of-m across separate institutions) and declares a match when
two or more distinct SMS-verified accounts produce the same token. There is no "strength heuristic" and no AI on the
servers. The counselor (a licensed attorney) first sees matched identifiers, states and contact methods, and reads full
reports only after each survivor agrees. A match is described everywhere as "a lead, not evidence"
([LEGAL_RESEARCH_MEMO.md §7](../../LEGAL_RESEARCH_MEMO.md#7-blind-escrow-legal-status-of-a-match)).

## Research

*Researched 2026-11-11 by a Claude session; citations re-checked by a second session. Not legal advice.* The logic is
public; what no one can inspect is the **running instance and its inputs**.

**1. Defamation: the matcher is mostly not the issue.** The defamatory statement, if any, is the survivor's entry and
whatever the counselor later says; the match only explains why the counselor looked. The likely defences are privilege
and truth of the underlying account, not proof of how the matcher worked.
- *NJ.* The litigation privilege shields "any communication (1) made in judicial or quasi-judicial proceedings; (2) by
  litigants or other participants authorized by law; (3) to achieve the objects of the litigation; and (4) that have
  some connection or logical relation to the action" (*Buchanan v. Leonard*, 428 N.J. Super. 277, 286 (App. Div.
  2012)), and "[p]retrial communications by parties and witnesses are protected" (*Hawkins v. Harris*, 141 N.J. 207,
  218 (1995)), both as quoted in *Redenburg v. Merritt*, No. A-0110-20, slip op. at 6-7 (App. Div. May 21, 2021)
  (unpublished, non-precedential under R. 1:36-3)
  ([njcourts.gov](https://njcourts.gov/system/files/court-opinions/2021/a0110-20.pdf)). *Buchanan* and *Hawkins*
  themselves were not opened **[VERIFY]**. Whether a counselor's screening of a match before any suit is "pretrial"
  enough is unsettled **[VERIFY]**.
- *NY.* Statements made before litigation get only a **qualified** privilege: "If the statements are pertinent to a good
  faith anticipated litigation, no cause of action for defamation can be based on those statements," and the privilege
  "is lost where a defendant proves that the statements were not pertinent to a good faith anticipated litigation."
  *Front, Inc. v. Khalil*, 24 N.Y.3d 713, 715, 720 (2015) (Westlaw printout read:
  [nycomdiv.com](https://www.nycomdiv.com/wp-content/uploads/sites/933/2021/07/Front-Inc-v-Khalil.pdf)). *Front*
  concerned attorneys' cease-and-desist letters; its reach to a counselor's intake is **[VERIFY]**.
- *CA / PA.* Cal. Civ. Code § 47(b) (litigation privilege) and § 47(c) (common-interest privilege) are likely analogues;
  official text was blocked, **[VERIFY]**. PA not researched **[VERIFY]**.
- *Where the matcher could matter.* Under a qualified privilege a plaintiff could argue that acting on an unexplained or
  Sybil-forced match was not good faith (Q-014). Against that: a counselor who treats a match as a lead and contacts
  only consenting survivors relies on the survivors, not the software.

**2. Reliability challenges to software.** A match would come into court only if someone offered it as evidence, which
Matra's own documents say it is not.
- Authentication of machine output: "[e]vidence describing a process or system and showing that it produces an accurate
  result." Fed. R. Evid. 901(b)(9) ([LII](https://www.law.cornell.edu/rules/fre/rule_901)); 902(13) allows a
  certification instead of a live witness, though the 2017 committee note says it "establishes only that the output
  came from the computer," not that it is reliable (local copy
  `compiled_resources/02_digital_evidence_chain_of_custody/`). Expert testimony about it must meet Fed. R. Evid. 702
  as amended 2023 ("more likely than not") ([LII](https://www.law.cornell.edu/rules/fre/rule_702)). NJ/NY analogues
  **[VERIFY]**.
- *NJ:* *State v. Pickett*, No. A-4207-19T4 (App. Div. Feb. 3, 2021) (approved for publication; 466 N.J. Super. 270
  per secondary sources **[VERIFY]**; the State sought leave to appeal, N.J. Sup. Ct. Docket No. 085463, outcome not
  checked **[VERIFY]**), held that a defendant facing novel software-based evidence is "entitled to access, under an
  appropriate protective order, to the software's source code and supporting software development and related
  documentation—including that pertaining to testing, design, bug reporting, change logs, and program requirements" on a
  showing of "particularized need" (slip op. at 6-7; four-factor test at 7 and 48). "Hiding the source code is not the
  answer" (id. at 5) ([njcourts.gov](https://www.njcourts.gov/system/files/court-opinions/2021/a4207-19.pdf)).
- *NY:* *People v. Wakefield*, 38 N.Y.3d 367, 383-84 (2022), held disclosure of TrueAllele source code "was not needed"
  for the Frye hearing, the defence's arguments being "directed more toward the foundational concern of whether the
  source code performed accurately and as intended" (copy read:
  [cybgen.com](https://www.cybgen.com/information/admissibility/Wakefield2022.pdf); official text at
  [nycourts.gov](https://nycourts.gov/reporter/3dseries/2022/2022_02771.htm), not opened).
- Both were criminal cases about proprietary code. Matra's code is public, which removes the trade-secret obstacle
  *Pickett* addressed. The open gap is the one *Wakefield* calls "foundational": proving the code that ran is the
  published code. Attestation reports and reproducible builds are the technical answer; whether courts accept enclave
  attestation as 901(b)(9) foundation appears untested **[VERIFY: no case found]**.

**3. What a court could order.** Logic: already public. Inputs: tokens are blinded; turning them back into identifiers
needs the OPRF key holders (Q-016). Records: if a matter is anticipated, Fed. R. Civ. P. 37(e) reaches ESI "that should
have been preserved in the anticipation or conduct of litigation" and lost through failure "to take reasonable steps,"
with prejudice-curing measures under (e)(1) and adverse-inference or dismissal only on a finding of "intent to
deprive" under (e)(2) ([LII](https://www.law.cornell.edu/rules/frcp/rule_37)). The argument for Matra: routine, pre-designed non-retention is
not intent to deprive. The argument against: a design whose stated aim is that nothing can be shown may be cited as
such, and leaves Matra unable to prove its own good faith. Whether a litigation hold could require logging inside the
enclave is unsettled **[VERIFY]** (see Q-039).

**Unsettled:** whether a counselor's pre-suit match review is privileged in each state; whether attestation can
authenticate enclave output; how far a duty to preserve reaches a system built not to keep inputs.

## Ask for counsel

We plan to run public matcher code in an attested enclave, keep per match only an attestation report, code hash,
timestamp and the token count (no identifiers), and treat a match as a lead the counselor never cites as evidence.
(1) Is that record enough to support the NJ litigation privilege and to show good faith under NY's *Front*
qualified privilege? (2) Would a court likely treat routine non-retention of inputs as sanctionable under Rule 37(e) or
state analogues once a claim is anticipated, and should we build a litigation-hold mode?

## Answer

<!-- Empty until a licensed attorney answers. Then only "Resolved (D-###)." plus a one-line public conclusion if counsel
approved one. Counsel's actual advice lives in private/DECISIONS.md (gitignored; the repo is public). -->
