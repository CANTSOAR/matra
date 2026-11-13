---
id: Q-038
title: Can IP and device logs kept only for rate limiting and bot detection be compelled to identify a survivor, and how short must retention be?
status: memo-ready
priority: P1
area: privacy
jurisdiction: NJ, NY, CA, PA, federal
source: interview 2026-11-11
blocks: Logging and rate-limit design; privacy policy
related: Q-013, Q-039, Q-003
created: 2026-11-11
---

## Question

Can IP addresses and device information Matra keeps only for rate limiting and bot detection be compelled (e.g. under 18 U.S.C. § 2703(c)-(d) or a civil subpoena) to identify a survivor or link her to a report, and does deleting them after a short fixed period (hours or days) avoid that?

## Context

Founder (interview 2026-11-11): "record some IP and device info but only for rate limits and standard bot catching, not really for the report itself." Retention period not decided. Reports are end-to-end encrypted and the operator holds no plaintext ([SECURITY_WHITEPAPER.md](../../SECURITY_WHITEPAPER.md)), so these logs may be the most identifying thing Matra holds.

Proposed 2026-11-11 (founder asked for a recommendation; pending counsel): never write raw IPs to disk; rate-limit on a keyed hash of the IP held in memory and discarded within 24 hours; no device fingerprint stored with any account or report.

## Research

*Not legal advice. Prepared for counsel by a Claude session, 2026-11-11.*

**Current code (fact check for Context).** [apps/server/src/app.ts](../../../apps/server/src/app.ts) (`rateLimit`, ~l. 417) already keeps
login/register rate limits in memory only, keyed by the **raw** IP (and IP + username), with 60-second windows; the request
log line (~l. 358) records method, path, status and time, not the IP. Nothing is written to disk today, but the key is not
hashed, and expired entries are pruned only once the map exceeds 10,000 keys
([auth.ts](../../../apps/server/src/auth.ts) `RateLimiter.hit`, ~l. 132), so IP-username pairs can sit in memory well past 60 s.

**1. Government process: the logs are reachable by subpoena, not just a § 2703(d) order.** If Matra is an
"electronic communication service" ([18 U.S.C. § 2510(15)](https://www.law.cornell.edu/uscode/text/18/2510)) or "remote
computing service" ("the provision to the public of computer storage or processing services",
[§ 2711(2)](https://www.law.cornell.edu/uscode/text/18/2711)), a provider "shall disclose" a subscriber's "telephone or
instrument number or other subscriber number or identity, including any temporarily assigned network address" and
"records of session times and durations" on a mere "administrative subpoena ... or a Federal or State grand jury or
trial subpoena" ([§ 2703(c)(2)(C), (E)](https://www.law.cornell.edu/uscode/text/18/2703)). Other non-content records need
a § 2703(d) order ("specific and articulable facts ... relevant and material to an ongoing criminal investigation") or a
warrant (§ 2703(c)(1)). So an IP log tied to an account appears to be among the *easiest* things to compel. Whether Matra
is an ECS/RCS at all (it stores data for users; survivors share with attorneys) is itself unsettled; the strongest view is
that it is at least an RCS **[VERIFY with counsel]**.

**2. Preservation demands extend retention.** On a government request a provider "shall take all necessary steps to
preserve records and other evidence in its possession", for 90 days, extendable by another 90
([§ 2703(f)](https://www.law.cornell.edu/uscode/text/18/2703)). The rule appears to reach only records "in its
possession" when the request arrives; it does not on its face require creating logs that do not exist. But a request
received while a 24-hour in-memory window is live would appear to require Matra to freeze that entry.

**3. State overlays.** NJ: *State v. Reid*, 194 N.J. 386 (2008), held under N.J. Const. art. I, ¶ 7 that "citizens have a
reasonable expectation of privacy ... in the subscriber information they provide to Internet service providers", which
police satisfy by "serving a grand jury subpoena on an ISP without notice to the subscriber" (read via
[vLex copy](https://case-law.vlex.com/vid/state-v-reid-105-889108887); pinpoint, reportedly 194 N.J. at 399, **[VERIFY]**;
official text not reached). Reid raises the bar (a municipal court subpoena with no pending case was held deficient and the
records suppressed) but says the State "may seek to reacquire the subscriber information with a proper grand jury subpoena."
CA: CalECPA defines "electronic communication information" to include information about any device in the communication,
"including, but not limited to, an IP address," and excludes "subscriber information" (Cal. Penal Code § 1546(d), (l)).
Government may compel electronic communication information only by warrant, wiretap order, pen/trap order, or a subpoena
not used to investigate a crime (§ 1546.1(a)(1), (b)(1)-(5)), but a subpoena may still reach "subscriber information"
(§ 1546.1(i)(3)). So CA appears to protect the IP log more than the account record (read via FindLaw copies of
[§ 1546](https://codes.findlaw.com/ca/penal-code/pen-sect-1546/) and
[§ 1546.1](https://codes.findlaw.com/ca/penal-code/pen-sect-1546-1/); leginfo returned 403; currency and pending 2025-26
amendments (e.g. AB 358) **[VERIFY]**). NY and PA: not researched **[VERIFY]**.

**4. Civil subpoenas.** The SCA lets a provider divulge non-content customer records "to any person other than a
governmental entity" ([§ 2702(c)(6)](https://www.law.cornell.edu/uscode/text/18/2702)); unlike content, the SCA appears to
give no shield against a civil Rule 45 subpoena for IP logs. The realistic civil requester is a named person suing an
unknown reporter for defamation and subpoenaing Matra to unmask her. NJ courts require notice, the exact statements, a prima facie
case with evidence on each element, and a First Amendment balancing before an ISP must unmask an anonymous poster
(*Dendrite Int'l v. John Doe No. 3*, 342 N.J. Super. 134, 775 A.2d 756 (App. Div. 2001), as block-quoted in
[*Immunomedics, Inc. v. Doe*](https://hallapproved.com/nj/cases/appeals/2001/2050739), 342 N.J. Super. 160, 775 A.2d 773,
776-77 (App. Div. 2001); Dendrite itself not opened, pinpoint **[VERIFY]**). See Q-003 for the NJ defense-subpoena standard.

**5. Does short retention avoid it? Arguments both ways.**
- *For:* compulsory process reaches only what exists. Rule 37(e) sanctions apply only to ESI "that should have been
  preserved in the anticipation or conduct of litigation", and the 2015 Committee Note says "the routine, good-faith
  operation of an electronic information system would be a relevant factor"
  ([FRCP 37](https://www.law.cornell.edu/rules/frcp/rule_37)); the harshest sanctions need "intent to deprive" (37(e)(2)).
  A documented, pre-existing 24-hour policy applied uniformly looks like routine operation.
- *Against:* the same Note adds that "the prospect of litigation may call for reasonable steps to preserve information by
  intervening in that routine operation." And "in memory" is not "not stored." *Columbia Pictures, Inc. v. Bunnell*, 245
  F.R.D. 443, 446 (C.D. Cal. 2007) held "data stored in RAM, however temporarily, is electronically stored information" and
  upheld a magistrate judge's order that a site operator begin preserving server-log data held only in RAM (id. at 448),
  with users' IP addresses masked (id. at 451); one district-court ruling, not binding elsewhere
  ([opinion copy](https://hallapproved.com/ca/cases/federal/district/2007/8765721/)). Once litigation is anticipated or a
  § 2703(f) letter arrives, Matra could be ordered to start logging. A keyed hash of an IP is also still linkable: anyone
  who obtains the key (by subpoena) can test a candidate IP against it.
- *Outside Matra:* the hosting provider, any CDN/reverse proxy and the SMS provider (Q-013) keep their own IP and phone
  logs and can be served directly, possibly without Matra knowing (Q-039). Minimizing Matra's own logs does not reach those.

**Unsettled:** whether Matra is an ECS/RCS; whether a court can order a provider to *create* logs prospectively for a named
user (Bunnell suggests yes in civil discovery; criminal real-time collection would run through pen/trap or wiretap law,
not researched **[VERIFY]**); whether hashing with a server-held key counts as "masking" or as retained identifying data.

## Ask for counsel

We plan to: never write IPs to disk; rate-limit on a keyed hash of the IP held only in memory and discarded within 24 hours
(key rotated daily, then destroyed); store no device fingerprint; publish this in the privacy policy; and contract with the
host/CDN for minimal IP logging. (1) Does that leave anything an SCA subpoena, § 2703(f) letter, or civil subpoena could
reach, and must we comply with an order to start logging a user? (2) Is daily key destruction a defensible routine
practice, or a spoliation risk once a demand or suit is anticipated?

## Answer

<!-- Empty until a licensed attorney answers. Then only "Resolved (D-###)." plus a one-line public conclusion if counsel
approved one. Counsel's actual advice lives in private/DECISIONS.md (gitignored; the repo is public). -->
