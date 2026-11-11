---
id: Q-013
title: If matching requires phone, ID or .edu verification, what records can be compelled, and can we verify then forget?
status: memo-ready
priority: P0
area: sybil
jurisdiction: NJ, NY, CA, PA, federal
source: Callisto meeting 2026-11-10
blocks: Choice of account verification for sealed matching (W13 Sybil resistance)
related: Q-014
created: 2026-11-10
---

## Question

If Matra requires phone, ID or .edu-email verification before a survivor can lodge a matching entry, what records of that verification can be subpoenaed or must be kept, and does an anonymous-credential design (verify once, receive an unlinkable token, keep no link to the account) change that?

## Context

Decided at the Callisto meeting 2026-11-10: add login friction to stop fake accounts forcing matches. Proposal: friction only on sealed matching, not the vault. Options: phone with carrier lookup (no VoIP), .edu email for campus pilots, partner-advocate invite codes, government ID. 'Verify then forget' would use blind-signed tokens (Privacy Pass style) so the matching server cannot link a token back to the verification. Risk: a verification record ties a real person to 'reported someone'. Background: [threat-model.md](../../threat-model.md) W13, W15.

Founder (interview 2026-11-11): verification should make creating an account "hard enough that bad actors can't make a bunch but easy enough that it doesn't deter people". An MCP/agent interface (Q-048) would make bulk accounts easier. Age checking may share this step (Q-046).

Founder (interview 2026-11-11): sign-up collects phone number, email and username; verify the phone first, add ID verification only if phone proves too weak. Open design point: whether the phone and email are stored or verified then forgotten. SMS verification also leaves a record with the SMS provider.

Decided for the build (2026-11-11, pending counsel): SMS verification is required only for sealed matching; afterwards Matra keeps only a keyed hash of the phone number (to stop one phone verifying many accounts), never the raw number. No raw IPs on disk (Q-038). ID and .edu verification are not in the build. A blind-token (Privacy Pass) design that separates the verifier from the matching account is a later option, not built.

## Research

*Not legal advice. Prepared for counsel. Researched 2026-11-11.*

**1. What can be compelled from Matra depends on what Matra holds.**
- If Matra is a provider of an "electronic communication service" ("any service which provides to users thereof the ability to send or receive wire or electronic communications", [18 U.S.C. § 2510(15)](https://www.law.cornell.edu/uscode/text/18/2510)) or a "remote computing service" ("computer storage or processing services", [§ 2711(2)](https://www.law.cornell.edu/uscode/text/18/2711)), the Stored Communications Act lets the government get basic subscriber records, including "telephone or instrument number or other subscriber number or identity", with only "a Federal or State grand jury or trial subpoena" or administrative subpoena ([§ 2703(c)(2)(E)](https://www.law.cornell.edu/uscode/text/18/2703)). Other non-content records need a § 2703(d) order ("specific and articulable facts"). Whether Matra is an ECS or RCS at all (vault storage and attorney sharing suggest RCS) is open. **[VERIFY with counsel]**
- Civil litigants (e.g. a named person suing for defamation, Q-015) use subpoenas for documents "in that person's possession, custody, or control" ([Fed. R. Civ. P. 45(a)(1)(A)(iii)](https://www.law.cornell.edu/rules/frcp/rule_45)), quashable for "undue burden" (45(d)(3)(A)(iv)). The rule appears to reach only what exists; we found no general US or NJ/NY/CA/PA rule requiring a web service to *create or keep* verification records. **[VERIFY: absence of any state retention mandate]**
- **Keyed hash is still a record.** ESI includes data obtainable "after translation by the responding party into a reasonably usable form" ([Fed. R. Civ. P. 34(a)(1)(A)](https://www.law.cornell.edu/rules/frcp/rule_34)). If Matra holds the hash key, a requester who already knows a phone number could probably make Matra hash it and say whether an account (and therefore a matching entry) exists. FTC technologists warn hashes "aren't 'anonymous' and can still be used to identify users", using phone numbers and emails as examples ([FTC Office of Technology, July 24, 2024](https://www.ftc.gov/policy/advocacy-research/tech-at-ftc/2024/07/no-hashing-still-doesnt-make-your-data-anonymous)). A secret key blocks outsiders, not a court that can compel the key holder. Compelled technical assistance has precedent: the All Writs Act reached a non-party phone company that was not "so far removed from the underlying controversy" where the burden was minimal, though "unreasonable burdens may not be imposed" ([*United States v. New York Telephone Co.*, 434 U.S. 159, 172-174 (1977)](https://www.law.cornell.edu/supremecourt/text/434/159)) (pinpoints mapped from the dissent's "ante, at 172/174" cites; no star paging seen **[VERIFY pinpoint]**).

**2. Must anything be kept?**
- **Preservation on request:** on a government request a provider "shall take all necessary steps to preserve records and other evidence in its possession" for 90 days, renewable once ([§ 2703(f)](https://www.law.cornell.edu/uscode/text/18/2703)). This reaches only what is "in its possession"; a raw number already discarded cannot be preserved, but the stored hash and account timestamps could be.
- **Litigation hold:** sanctions follow when ESI "that should have been preserved in the anticipation or conduct of litigation is lost because a party failed to take reasonable steps" ([Fed. R. Civ. P. 37(e)](https://www.law.cornell.edu/rules/frcp/rule_37)). A pre-dispute deletion schedule appears to be the usual safe ground, though it may have to be suspended once a claim is anticipated (cf. Q-004).
- **Grant conditions cut the other way:** VAWA "grantees and subgrantees" "shall not ... disclose ... any personally identifying information ... collected in connection with services requested, utilized, or denied through grantees' and subgrantees' programs, regardless of whether the information has been encoded, encrypted, hashed, or otherwise protected", and if release is "compelled by statutory or court mandate" must make "reasonable attempts to provide notice" to affected victims ([34 U.S.C. § 12291(b)(2)(B)(i), (C)](https://www.law.cornell.edu/uscode/text/34/12291); PII defined in (a)(25), also "regardless of whether the information is encoded, encrypted, hashed"). This applies only if Matra or a partner is a grantee under that subchapter; if so, the text suggests a phone hash would still count as PII.

**3. Records held by others.** The SMS provider and the carrier hold their own logs (number, time, sender short code). These are outside Matra's control; the Fourth Amendment appears to give little protection to numbers "voluntarily conveyed" to a phone company (*Smith v. Maryland*, 442 U.S. 735, 744 (1979)), and *Carpenter v. United States*, 585 U.S. 296 (2018), called its decision "a narrow one" that does "not disturb the application of Smith" to conventional records (slip op. at 17-18; both in compiled_resources/03). A message reading "Your Matra code" itself reveals use of Matra. FCC rules require toll-*call* records for 18 months ([47 C.F.R. § 42.6](https://www.law.cornell.edu/cfr/text/47/42.6)); we found nothing applying this to SMS. **[VERIFY]** Twilio Verify retention (reportedly 13 months) is unverified (Twilio pages 403). **[VERIFY]**

**4. State-law protections for the person identified.**
- **NJ:** *State v. Reid*, 194 N.J. 386, 945 A.2d 26 (2008), is reported (secondary sources only) to hold that internet subscriber information is protected under N.J. Const. art. I, ¶ 7 but obtainable by grand jury subpoena on a relevance showing, without notice to the subscriber (relevance at 403-04 per later cases). Opinion text not opened (Justia 403; Leagle excerpt only). **[VERIFY]**
- **NJ, civil unmasking:** [*Dendrite Int'l, Inc. v. Doe No. 3*, 342 N.J. Super. 134 (App. Div. 2001)](https://caselaw.findlaw.com/nj-superior-court-appellate-division/1283697.html), requires efforts "to notify the anonymous posters", the "exact statements", evidence of each element "on a prima facie basis", and a balance of "the defendant's First Amendment right of anonymous free speech" before disclosure (at 141-42 **[VERIFY pinpoint]**). Whether it covers a non-public matching entry (not "speech" to anyone) is unsettled.
- **CA:** CalECPA bars a California government entity from compelling "electronic communication information from a service provider" except by warrant, wiretap order or other listed process (Cal. Penal Code § 1546.1(a)(1), (b)), but expressly does not limit its power to "require a service provider to provide subscriber information" (§ 1546.1(i)(3)). Read on an unofficial copy ([onecle](https://law.onecle.com/california/penal/1546.1.html); leginfo 403); amendments pending (AB 358). **[VERIFY current text]**

**5. Does an anonymous-credential design change this?** Privacy Pass is built so a token "cannot be linked to the protocol interaction where that token was initially issued" ([RFC 9576 §1](https://www.rfc-editor.org/rfc/rfc9576.html)), but entities in one deployment box "are assumed to be operated by the same party and are therefore able to collude" (§4), as in the shared origin/attester/issuer model (§4.1). The legal effect appears to follow the facts: if the verifier keeps a per-phone record (needed to stop one phone minting many tokens) but holds nothing linking it to an account or entry, a subpoena to the verifier yields "this phone verified" and nothing about matching; a subpoena to Matra yields tokens tied to no phone. That only holds if the verifier is a separate entity and Matra cannot be compelled to log the link in future (cf. Q-016 on compelled key holders; prospective-assistance orders are the open risk).

**Unsettled:** whether Matra is an SCA provider; whether a court would order Matra to hash and look up a supplied number (Rule 34's "translation" language suggests it could); whether "verify then forget" deletion is spoliation once a named person threatens suit; whether a separate verifier would be treated as Matra's agent (control under Rule 45).

## Ask for counsel

We plan to require SMS verification only for sealed matching, then discard the number and keep a keyed hash on the account (later: a separate verifier issuing unlinkable blind tokens). Decision needed: (1) Can Matra be compelled to hash a supplied number and confirm whether it has an account, and is that hash "PII" under 34 U.S.C. § 12291? (2) Is a fixed pre-dispute deletion schedule for verification data defensible against spoliation claims in NJ/NY/CA/PA? (3) Would moving the hash to an independent verifier with no account link put it outside Matra's "possession, custody, or control"?

## Answer

<!-- Empty until a licensed attorney answers. Then only "Resolved (D-###)." plus a one-line public conclusion if counsel
approved one. Counsel's actual advice lives in private/DECISIONS.md (gitignored; the repo is public). -->
