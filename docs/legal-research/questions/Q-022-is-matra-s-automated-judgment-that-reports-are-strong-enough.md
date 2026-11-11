---
id: Q-022
title: Is Matra's automated judgment that reports are strong enough to open a case the unauthorized practice of law?
status: memo-ready
priority: P0
area: upl
jurisdiction: NJ, NY, CA, PA
source: interview 2026-11-10
blocks: Case-strength threshold in the matcher; whether a human attorney must make that call
related: Q-017, Q-001, Q-014
created: 2026-11-11
---

## Question

If Matra (a nonlawyer nonprofit) or its software decides whether one or more reports are strong enough to 'open a case' and send to an attorney, is that the unauthorized practice of law in NJ or NY?

## Context

Founder (interview 2026-11-10): the old design used a fixed number of matching reports; the founder now thinks the threshold should be variable, e.g. one very detailed report might be enough to open a case, while five spotty or diverging reports might not. The matcher would evaluate whether a case is strong enough, ideally without seeing the content (the founder suggested a zero-knowledge proof). Technically, a zero-knowledge proof can only prove a fixed, computable rule (e.g. 'these fields are filled in'), so 'strength' would have to be either a defined scoring rule over structured fields or a human (attorney) reading the reports. Background: [LEGAL_RESEARCH_MEMO.md §5](../../LEGAL_RESEARCH_MEMO.md#5-unauthorized-practice-of-law-lawyer-referral-and-fee-sharing).

Decided 2026-11-11 (founder): case strength is judged by the attorney counselor, not by software (see Q-010).

Build decision 2026-11-11: software still decides two things mechanically: that a match exists (two or more distinct verified accounts produced the same OPRF identifier token) and which counselor gets it (routing on incident state and survivor state, Q-017). There is no AI on the servers. The counselor first sees only the matched identifiers, states and contact methods; she reads a full report only after that survivor agrees. So any strength judgment the counselor makes before contact rests on very little, and the full judgment comes after consent.

## Research

*Researched 2026-11-11 by a Claude session. Not legal advice.* Since the 2026-11-11 decision, the question is less
"is the software practicing law" than (a) whether the mechanical steps that remain are legal judgment, and (b) whether
Matra, a nonlawyer nonprofit, may pay an attorney to make the strength call for survivors.

**1. What counts as practicing law.**
- *NJ.* The Court frames UPL disputes around the public interest: "Our resolution of the dispute turns on the
  identification of the public interest." *In re Opinion No. 26 of the Comm. on the Unauthorized Practice of Law*,
  139 N.J. 323 (1995) ([leagle](https://www.leagle.com/decision/1995462139nj3231282); no pinpoint shown). That NJ has
  no fixed definition and decides case by case is commonly said but was not found in the text read, **[VERIFY]**.
- *NY.* Practice of law includes "the rendering of legal advice and opinions directed to particular clients" (*In re
  Rowe*, 80 N.Y.2d 336, 341-42 (1992), as quoted in *Upsolve, Inc. v. James*, No. 22-1345 (2d Cir. Sept. 9, 2025),
  cert. pet. App. 9a; *Rowe* itself not opened, **[VERIFY]**). *Upsolve* held that NY's UPL statutes, as applied to
  the plaintiffs' individualized advice, are content neutral and get only intermediate scrutiny (App. 3a, 21a-22a),
  vacating a preliminary injunction and remanding; cert. denied, No. 25-948 (U.S. Mar. 30, 2026)
  ([docket](https://www.supremecourt.gov/docket/docketfiles/html/public/25-948.html)). A speech defense for advice
  features therefore appears weak in the Second Circuit. Local copy:
  `compiled_resources/08_legal_landscape_and_pitfalls/Upsolve_v_James_2dCir_2025-09-09_opinion.pdf`.
- *Machines.* In *Lola v. Skadden, Arps*, 620 F. App'x 37 (2d Cir. 2015), the parties agreed at oral argument, and
  the court relied on it, that a document reviewer who "undertakes tasks that could otherwise be performed entirely by a
  machine cannot be said to engage in the practice of law" (id. at 45); the court read an NC ethics opinion to suggest
  "at least a modicum of independent legal judgment" is inherent in practicing law (id. at 44)
  ([text](https://hallapproved.com/us/cases/ca2/2015/8695118/)). This is an unpublished summary order on a concession
  under NC law in an FLSA case, so its weight elsewhere is limited.
- *PA.* 42 Pa.C.S. § 2524(a) makes practicing law without being an attorney a third-degree misdemeanor on a first
  violation; § 2524(b)(1) says an association does not violate (a) if it "provides legal services only through
  officers, employees or agents who are duly admitted to practice law" ([text](https://www.palegis.us/statutes/consolidated/view-statute?txtType=PDF&ttl=42&div=0&chapter=25&section=24&subsctn=0)).
- *CA.* Bus. & Prof. Code § 6125 bars practice by anyone not an active State Bar licensee (official site blocked our
  fetch; text and its corporate-practice gloss are **[VERIFY]**).

**2. The software steps that remain.** Deciding that two accounts produced the same identifier token, and routing by
state, are fixed computable rules applied to every report alike. On the *Rowe* and *Lola* framing, the stronger
argument appears to be that these are not legal judgment. The contrary argument: routing chooses which lawyer a survivor's matter goes
to, and NY Jud. Law § 495(1)(d) bars a corporation from "furnish[ing] attorneys or counsel"
([text](https://www.nysenate.gov/legislation/laws/JUD/495)); that is a referral question, covered in Q-017 and Q-001.
A content-based "strength score" would look much more like an opinion on a particular person's claim.

**3. Matra paying the attorney who makes the call.** This is now the main risk.
- *NJ.* UPL Op. 58 / ACPE Op. 740 (June 21, 2021): companies that are not law firms "cannot provide legal services to
  customers of the companies, either through staff lawyers or by furnishing outside lawyers" (at 1); in-house counsel
  may advise only their employer (at 3, citing R. 1:27-2, R. 1:21-1); a lawyer paid by the company risks RPC 5.4(a)
  fee-sharing and RPC 7.3(e) (at 3-5). Op. 58 lists who may pay or recommend a lawyer under RPC 7.3(e), including "a
  bona fide nonprofit community organization" (at 4); whether Matra qualifies is **[VERIFY]**. Footnote 1 (at 2): nonprofits
  that provide legal assistance to the poor, act as a public interest law firm, or serve persons of low and
  low-moderate means "may practice law through staff attorneys, with restrictions. R. 1:21-1(e)" (local copy:
  `compiled_resources/08_legal_landscape_and_pitfalls/NJ_UPL58_ACPE740_2021_nonlegal_companies_matching_lawyers.pdf`).
  Op. 58 also says calling the service "matching" does not help if the customer in substance contracts with the company
  for legal services (at 3). Whether Matra fits R. 1:21-1(e), and what its "restrictions" are, is **[VERIFY]** (rule
  text not opened).
- *NY.* § 495(7) exempts "non-profit organizations ... organized and operating primarily for a purpose other than the
  provision of legal services and which furnish legal services as an incidental activity in furtherance of their primary
  purpose." Matra's primary purpose (an encrypted documentation vault) is arguably not legal services, which supports
  the exemption; the counter is that the counselor program is a central feature, not an incidental one.
- *PA.* § 2524(b)(1) appears to permit an association to deliver legal services through admitted lawyers; whether
  Matra is an "association" here, and how PA Supreme Court rules bear on it, is **[VERIFY]**.
- *Independence.* NY RPC 5.4(c): unless the law otherwise provides, a lawyer "shall not permit a person who
  recommends, employs or pays the lawyer to render legal service for another to direct or regulate the lawyer's
  professional judgment" (as quoted in [NYSBA Ethics Op. 1183](https://nysba.org/ethics-opinion-1183/); official text not
  opened). NJ's RPC 5.4(c) is assumed similar, **[VERIFY]**. If Matra's software or policy set the strength criteria the
  counselor must apply, that could look like the payer directing judgment; if the counselor (or her organization) sets
  them, it does not.

**Unsettled.** No opinion found addresses an attorney paid by a nonprofit to evaluate pooled, encrypted reports from
people who are not yet anyone's clients. Whether the counselor's strength call is "legal services to customers" of
Matra (Op. 58) or her own work for a partner organization likely turns on who employs and pays her. See Q-010, Q-017.

## Ask for counsel

We propose: software only detects identifier matches and routes by state (no content scoring, no AI); a licensed
counselor decides case strength using criteria she or her partner organization sets, not Matra; she is paid a flat
amount and never takes the case. (1) Is the mechanical match-and-route step free of UPL risk in NJ, NY, CA and PA?
(2) May Matra, a nonprofit, pay that counselor directly (R. 1:21-1(e); NY Jud. Law § 495(7); 42 Pa.C.S. § 2524(b)),
or must the counselor be employed by a separate legal-services or partner organization to avoid UPL Op. 58?

## Answer

<!-- Empty until a licensed attorney answers. Then only "Resolved (D-###)." plus a one-line public conclusion if counsel
approved one. Counsel's actual advice lives in private/DECISIONS.md (gitignored; the repo is public). -->
