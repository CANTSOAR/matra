---
id: Q-016
title: Can an independent OPRF key holder be compelled to hand over its key share or test guesses?
status: memo-ready
priority: P1
area: keys
jurisdiction: NJ, NY, CA, PA, federal
source: Callisto meeting 2026-11-10
blocks: Choosing key holders (ISRG/Divvi Up, a university, Matra) and the threshold (n-of-m)
related: 
created: 2026-11-10
---

## Question

If Matra's matching key is split n-of-m across independent organizations, can a court or law enforcement compel a holder to produce its key share or evaluate guessed identifiers, and what holder agreement and jurisdiction mix make that hardest?

## Context

Decided at the Callisto meeting 2026-11-10: move from 2-of-2 to n-of-m threshold keys, borrowing crypto custody practice (distributed key generation, HSMs). Today Matra runs both holders, so the operator can test guesses (W14). Whoever holds a threshold of shares can test whether a phone number was entered, but cannot open entries. Candidate holders: ISRG (Divvi Up), a university such as BU. Background: [SECURITY_WHITEPAPER.md §4a](../../SECURITY_WHITEPAPER.md), [threat-model.md](../../threat-model.md) W2, W14.

Interview 2026-11-11: holders should be multiple universities or nonprofits, each useless alone. The founder also floated physical backup shares held by "very very trusted people" in an n-of-m scheme; individuals have no institutional counsel to resist a demand. See Q-040, Q-041.

## Research

*Prepared by a Claude research session, 2026-11-11. Not legal advice. Sources opened this session are linked; everything
else is marked [VERIFY].*

**Build facts this assumes (decided 2026-11-11).** The OPRF key is split n-of-m across separate institutions. No single
holder can evaluate the PRF alone; testing one guessed phone number needs n holders to each run a partial evaluation.
Shares sit in HSMs or enclaves. Matra keeps only ciphertext and keyed hashes. So "compelling a holder" means one of three
things: (a) produce the share itself, (b) run partial evaluations on guessed identifiers, or (c) produce records (logs,
agreements). Each is analysed below.

**1. Producing the share: a key is reachable like any other record or thing.**
- *Lavabit.* The district court ordered an email provider to hand over its SSL private keys under a pen/trap order and
  a seizure warrant. It imposed $5,000/day sanctions, and the keys were produced two days later. The Fourth Circuit
  affirmed the contempt *on waiver grounds* and did not decide whether the Pen/Trap Statute, the warrant or the Fourth
  Amendment allow compelling keys ([In re Under Seal (United States v. Lavabit), 749 F.3d 276 (4th Cir. 2014),
  slip op. at 4, 14-18, 36-41](https://www.ca4.uscourts.gov/Opinions/Published/134625.P.pdf); reporter pin cites
  [VERIFY]). The Pen/Trap argument was held waived (slip op. at 37-38); the warrant and constitutional arguments were
  not reached (slip op. at 39-41). The rule therefore appears **unsettled, not favorable**: a court has ordered keys
  produced, and this session found no appellate holding that it may not [VERIFY].
- *Pen/trap assistance reaches any "other person."* 18 U.S.C. § 3124(a)-(b)
  ([LII](https://www.law.cornell.edu/uscode/text/18/3124)) requires a "provider of wire or electronic communication
  service, landlord, custodian, or other person" to give technical assistance when ordered. That was one of the Lavabit
  bases. It is not limited to communications providers, so being "only a key holder" may not take a holder outside it.
- *No Fifth Amendment shield for institutions.* "A custodian may not resist a subpoena for corporate records on Fifth
  Amendment grounds" ([Braswell v. United States, 487 U.S. 99 (1988)](https://www.law.cornell.edu/supremecourt/text/487/99);
  pin [VERIFY]). Extending this collective-entity rule to a university or nonprofit
  holder is an inference [VERIFY], but such a holder appears unlikely to have the privilege. An individual holder of a paper backup share likely has none either: the share does not incriminate *her*, and in
  holding a compelled bank-consent directive non-testimonial, the Court likened it to surrendering "a key to a
  strongbox" rather than revealing "the combination" to a safe
  ([Doe v. United States, 487 U.S. 201, n.9 (1988)](https://www.law.cornell.edu/supremecourt/text/487/201); page [VERIFY]).
- *Civil subpoenas.* A party to a civil suit (for example an accused man suing for defamation) could subpoena a
  non-party holder. A federal court "must quash or modify" a subpoena that requires "disclosure of privileged or other
  protected matter" or "subjects a person to undue burden" ([Fed. R. Civ. P. 45(d)(3)(A)(iii)-(iv)](https://www.law.cornell.edu/rules/frcp/rule_45)).
  Whether a key share is "protected matter" is untested [VERIFY]. A state-court litigant must domesticate the subpoena
  in the holder's state, e.g. New York's UIDDA, [CPLR 3119(b)](https://www.nysenate.gov/legislation/laws/CVP/3119).
  That gives an out-of-state holder its home courts, not immunity.

**2. Testing guesses: compelled assistance, not production.** No record exists until the holder computes. The likely
federal route is the All Writs Act, [28 U.S.C. § 1651(a)](https://www.law.cornell.edu/uscode/text/28/1651).
- *For compulsion.* [United States v. New York Telephone Co., 434 U.S. 159, 171-175 (1977)](https://www.law.cornell.edu/supremecourt/text/434/159)
  (Part IV; pins [VERIFY]) upheld an order, finding the company not "so far removed from the underlying
  controversy that its assistance could not be permissibly compelled" and that compliance "required minimal effort."
  Running one partial evaluation per guess is cheap, which cuts toward compulsion.
- *Against.* The same case says "unreasonable burdens may not be imposed." *In re Order Requiring Apple Inc. to Assist*,
  149 F. Supp. 3d 341 (E.D.N.Y. 2016) ([text](https://www.cs.columbia.edu/~smb/classes/f23/Files/In_re_Order_Requiring_Apple_to_Assist.html))
  refused an AWA order. It held Apple "too far removed," the burden unreasonable and necessity unshown, and read
  Congress's comprehensive scheme (CALEA, the SCA) as a deliberate choice not to impose the duty. That is a magistrate judge's
  opinion, persuasive only; its later procedural history was not checked [VERIFY]. CALEA itself says a carrier is not responsible for decrypting unless it "provided" the
  encryption and "possesses the information necessary to decrypt"
  ([47 U.S.C. § 1002(b)(3)](https://www.law.cornell.edu/uscode/text/47/1002)). A key holder is likely not a
  "telecommunications carrier," so the clause probably does not protect it directly, but the remoteness argument is the
  same. The strongest argument for a holder appears to be: it never sees any survivor's data, one share is useless, and
  an order would have to conscript n institutions.
- *State courts* have no § 1651. Whether NJ, NY, CA or PA courts can order a non-party to perform a computation (as
  opposed to producing existing records) was not researched [VERIFY].

**3. Is a holder an SCA "provider"?** The SCA gag-order power (18 U.S.C. § 2705(b),
[LII](https://www.law.cornell.edu/uscode/text/18/2705)) and the CLOUD Act's reach to data held abroad
([18 U.S.C. § 2713](https://www.law.cornell.edu/uscode/text/18/2713)) apply to providers of electronic communication or
"remote computing service," defined as "the provision to the public of computer storage or processing services"
([§ 2711(2)](https://www.law.cornell.edu/uscode/text/18/2711)). A holder that evaluates blinded inputs for Matra is
arguably giving processing services to Matra, not "to the public" [VERIFY]. If it *is* a provider, a holder could be
gagged from telling Matra or the other holders, which defeats any "notify us of demands" clause.

**4. What the design and jurisdiction mix can and cannot do.**
- *Raises the cost:* a threshold that needs holders in several states (and possibly one abroad) means several
  proceedings, several sets of counsel, and visibility to the other holders. A holder outside the US would require
  mutual legal assistance, but § 2713 reaches data a US provider controls abroad, so a foreign affiliate of a US
  institution adds little [VERIFY].
- *Does not prevent:* each US holder can be served; individuals holding paper backup shares have no institutional
  counsel, and Lavabit shows that sanctions get compliance.
- *Non-exportable HSM keys:* impossibility is generally a defense to civil contempt [VERIFY]. But a court could still
  order a holder to *run* evaluations (item 2). Re-architecting *after* a demand to defeat it risks obstruction and
  contempt exposure [VERIFY]. Design choices made in advance and documented are a different posture.
- *Holder agreement terms worth asking about:* notify Matra and the other holders of any demand unless legally barred;
  move to quash or narrow; no voluntary assistance; rate-limit and log every evaluation; key rotation that makes older
  shares useless. Q-040 covers the custodian question for admin keys, and Q-041 covers public-records exposure of a
  public-university holder.

**Unsettled:** whether courts can compel keys (Lavabit left it open); whether the AWA reaches a remote non-provider
key holder; whether a share is "protected matter" under Rule 45; whether a holder is an SCA provider.

## Ask for counsel

We plan a 3-of-5 OPRF key split across independent US universities and nonprofits in different states, with
non-exportable HSM shares, a holder agreement (notice of demands, move to quash, no voluntary help, logged evaluations)
and no individual or paper backup shares. Is that a sound posture against subpoenas, warrants and All Writs Act orders
to produce a share or test guesses? Should any holder sit outside the US, and should individuals ever hold shares?

## Answer

<!-- Empty until a licensed attorney answers. Then only "Resolved (D-###)." plus a one-line public conclusion if counsel
approved one. Counsel's actual advice lives in private/DECISIONS.md (gitignored; the repo is public). -->
