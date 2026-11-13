---
id: Q-043
title: If shares of a survivor's recovery key are held by advocates or key holders, can those holders be compelled to help decrypt her reports?
status: memo-ready
priority: P2
area: keys
jurisdiction: NJ, NY, CA, PA, federal
source: interview 2026-11-11
blocks: Account recovery design (Shamir recovery, roadmap)
related: Q-016, Q-004
created: 2026-11-11
---

## Question

If a survivor's recovery key is split among trusted advocates or institutional key holders so she can recover a lost account, can those holders be compelled to combine their shares and decrypt her reports?

## Context

Today there is no password reset; a forgotten passphrase means the data is gone ([SECURITY_WHITEPAPER.md](../../SECURITY_WHITEPAPER.md)). The roadmap proposes 2-of-3 Shamir recovery among the survivor and trusted advocates. (Corrected 2026-11-11: Callisto's published recovery scheme, IACR ePrint 2024/962, is email validation plus security questions with OPRF rate limiting, not advocate-held shares.) Founder (interview 2026-11-11) asked for a recommendation; proposed: a recovery code only she holds by default, with share-based recovery optional and opt-in after a plain warning.

Build decision 2026-11-11: launch ships a recovery code held only by the survivor; Shamir share recovery is deferred.
Matra's servers hold only ciphertext, so opening a report needs the ciphertext (from Matra) plus her passphrase, her
recovery code, or a threshold of shares.

## Research

*Prepared by a Claude research session, 2026-11-11. Not legal advice. Sources opened this session are linked;
everything else is marked [VERIFY]. Q-016 covers compelling institutional OPRF key holders (Lavabit, All Writs Act,
Rule 45); that analysis appears to carry over to institutional recovery-share holders and is not repeated here.*

**1. A share is probably reachable like any other record; holders have no Fifth Amendment shield.**
- The privilege "protects a person only against being incriminated by his own compelled testimonial communications"
  ([Fisher v. United States, 425 U.S. 391, 409 (1976)](https://tile.loc.gov/storage-services/service/ll/usrep/usrep425/usrep425391/usrep425391.pdf)).
  It is personal: enforcement against the taxpayer's lawyer "would not 'compel' the taxpayer to do anything" (id. at
  397). *Couch v. United States*, 409 U.S. 322, 329 (1973)
  ([U.S. Reports](https://tile.loc.gov/storage-services/service/ll/usrep/usrep409/usrep409322/usrep409322.pdf)) let an
  accountant be made to produce a taxpayer's records: "the ingredient of personal compulsion against an accused is
  lacking," and the accountant, "not the taxpayer, is the only one compelled to do anything."
- So the rule appears to be: once a survivor hands shares to others, any testimonial protection a memorised secret
  might have had is gone as to those shares. Holders cannot claim it for her, and a share does not incriminate them.
- This protection appears thin for her anyway: she is usually a witness or civil party, not a suspect, and the Fifth
  Amendment does not reach non-incriminating material. Courts are split even for suspects: New Jersey
  allowed compelled passcode disclosure under the "foregone conclusion" exception (*State v. Andrews*, A-72-18 (N.J.
  Aug. 10, 2020), [court summary](https://www.njcourts.gov/court-opinion/state-v-robert-andrews-082209-essex-county-statewide-published);
  reported at 243 N.J. 447 [VERIFY; full opinion not read]); Pennsylvania held the exception does not apply to a
  compelled computer password (*Commonwealth v. Davis*, 220 A.3d 534 (Pa. 2019) [VERIFY; only the dissent's
  description of the majority was read]).

**2. Advocate holders: the counselor privileges may help, but they were written for communications, not keys.**
- *NJ.* A "victim counselor" (40 hours of training, under a direct services supervisor at a victim counseling center)
  "has a privilege not to be examined as a witness in any civil or criminal proceeding with regard to any confidential
  communication," defined as "any information exchanged between a victim and a victim counselor" that is "disclosed
  in the course of the counselor's treatment of the victim for any emotional or psychological condition," including
  "all information received by the victim counselor in the course of that relationship" (P.L.1987, c.169, §§ 3(b),
  3(e), 4, codified at N.J.S.A. 2A:84A-22.14(b), (e), -22.15; N.J.R.E. 517; enacted text in [compiled_resources](../../../compiled_resources/03_legal_ethics_privilege_statutes/NJ_Victim_Counselor_Privilege_PL1987c169_LegHistory.txt);
  current text and the 2001 amendment, P.L.2001, c.81, not checked [VERIFY]). The stated policy is to "render immune
  from discovery or legal process the records of these communications maintained by the counselor" (id. § 2, N.J.S.A.
  2A:84A-22.13). *State v. J.G.*, 261 N.J. Super. 409 (App. Div. 1993) ([local copy](../../../compiled_resources/03_legal_ethics_privilege_statutes/State_v_JG_261NJSuper409_1993_victim_counselor.md))
  called it "an absolute privilege" and held that "in the absence of compelling circumstances" such communications
  are "absolutely immune from disclosure," refusing even in camera review (page pins [VERIFY]).
- *PA.* A "sexual assault counselor" may not, "without the written consent of the victim," disclose confidential
  communications, defined as "All information, oral or written, transmitted between a victim ... and a sexual assault
  counselor in the course of their relationship, including ... records or the like"
  ([42 Pa.C.S. § 5945.1(a), (b)(1)](https://www.palegis.us/statutes/consolidated/view-statute?txtType=PDF&ttl=42&div=0&chapter=59&section=45&subsctn=1)).
  Whether Pennsylvania treats it as absolute against a defendant's confrontation claims was not checked [VERIFY].
- *NY.* Neither communications nor "any records made in the course of the services given to the client" shall "be
  required to be disclosed, nor shall the client be compelled to disclose such communication or records," waivable
  only by "informed, written and reasonably time-limited consent" ([CPLR 4510(b)-(c)](https://www.nysenate.gov/legislation/laws/CVP/4510)). Counselor must be
  certified by and supervised under an approved rape crisis program (§ 4510(a)(2)).
- *CA.* Sexual assault counselor privilege, Evid. Code §§ 1035-1036.2 [VERIFY; leginfo was unreachable].
- *For coverage:* a share handed over during an advocacy relationship is arguably "information exchanged" or a
  "record" of it. The statutes' breadth ("all information received") supports that.
- *Against:* a share is a random number, not a communication about her condition. The ciphertext the share unlocks
  was never given to the advocate; it sits with Matra, which is not a counseling center. NJ's definition also ties
  coverage to information disclosed "in the course of the counselor's treatment," and PA's privilege runs to the
  victim's communications "to the counselor." A court could quash a demand for the advocate's testimony yet order the
  share produced as a "thing," or order the survivor herself. Only trained, supervised counselors at qualifying
  programs are covered; a friend, a university, or a Matra-chosen institution is not. No case applying any of these privileges to a cryptographic key was found [VERIFY].
- *Federal court:* privileges in federal question and federal criminal cases come from FRE 501 common law, and no
  federal advocate privilege was checked [VERIFY]. Fed. R. Crim. P. 17(c)(3) does require a court order and, usually,
  notice to the victim before a subpoena for "personal or confidential information about a victim" goes to a third
  party, so she can move to quash ([Fed. R. Crim. P. 17(c)(3)](https://www.law.cornell.edu/rules/frcrmp/rule_17)).
- *VAWA-funded programs* may not release client information without "informed, written, reasonably time-limited
  consent," and if release is "compelled by statutory or court mandate" must try to notify the victim
  ([34 U.S.C. § 12291(b)(2)(B)-(C)](https://www.law.cornell.edu/uscode/text/34/12291)). That gives notice, not immunity.

**3. Recovery may change what counts as within her "control."** A party must produce ESI in her "possession,
custody, or control," including data obtainable "after translation by the responding party into a reasonably usable
form" ([Fed. R. Civ. P. 34(a)(1)(A)](https://www.law.cornell.edu/rules/frcp/rule_34)). Today, a survivor who lost her
passphrase plausibly cannot produce. With share recovery (or a recovery code she kept), a court could find the
reports within her control and order her to run recovery. Whether "control" reaches data recoverable only with
others' cooperation is unsettled and state rules vary [VERIFY]. Destroying a code or asking holders to delete shares
*after* a demand risks spoliation or contempt [VERIFY] (see Q-016 §4).

**What appears unsettled:** whether any counselor privilege covers a key share; whether a court can order holders to
*combine* shares (an act, not production of a record; see Q-016 §2); whether holders may be gagged from telling her.

## Ask for counsel

We plan to launch with a recovery code held only by the survivor, and later offer opt-in 2-of-3 share recovery with
shares only at privileged counselors (NJ 2A:84A-22.15, NY CPLR 4510, PA 5945.1), never institutions or friends.
Does a counselor privilege plausibly cover a recovery share, and does offering recovery put lost-passphrase reports
within her "control" for discovery? What must the opt-in warning say, and what should a share holder's agreement require?

## Answer

<!-- Empty until a licensed attorney answers. Then only "Resolved (D-###)." plus a one-line public conclusion if counsel
approved one. Counsel's actual advice lives in private/DECISIONS.md (gitignored; the repo is public). -->
