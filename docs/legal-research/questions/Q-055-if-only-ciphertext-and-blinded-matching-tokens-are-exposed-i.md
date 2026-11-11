---
id: Q-055
title: If only ciphertext and blinded matching tokens are exposed in a breach, must Matra notify survivors or regulators under NJ, NY, CA or PA breach laws?
status: memo-ready
priority: P1
area: privacy
jurisdiction: NJ, NY, CA, PA
source: interview 2026-11-11
blocks: Incident-response plan; what the privacy policy promises about breaches
related: Q-036, Q-038, Q-039
created: 2026-11-11
---

## Question

If an attacker obtains only end-to-end encrypted reports and OPRF-blinded matching tokens (no keys), does that trigger notification under N.J.S.A. 56:8-161 to -163, N.Y. Gen. Bus. Law § 899-aa, Cal. Civ. Code § 1798.82 or 73 P.S. § 2301 et seq. [VERIFY all], and what if account data such as a hashed phone number is also exposed?

## Context

Founder's goal (interview 2026-11-11): "having the server is useless" to anyone who obtains it. Proposed design: no raw IPs on disk, phone verified then kept only as a hashed token (Q-013, Q-038), reports encrypted on the survivor's device. Key shares are held by separate organizations (Q-016).

What a full database dump would also contain today ([apps/server/src/db.ts](../../../apps/server/src/db.ts)): each account's chosen `username`, a scrypt hash of a passphrase-derived auth key, the client KDF salt and iteration count (PBKDF2, 600k), and the private key wrapped under the passphrase; attorney display names and bar numbers in clear; share `survivor_alias`; and matching tags whose equality classes show which entries concern the same (unknown) person ([SECURITY_WHITEPAPER.md](../../SECURITY_WHITEPAPER.md)). The passphrase-strength floor (W5) is not built yet. Planned for the build (2026-11-11): verify-then-forget SMS (keyed hash only), OPRF key split n-of-m across institutions, matcher in an attested enclave, US confidential-computing host storing only ciphertext.

## Research

*Not legal advice. Texts read 2026-11-11 (verifier re-read every source the same day); NJ from the 2019 session law, NY from nysenate.gov (revision of 2025-03-28), CA and PA from FindLaw ("current as of Jan. 1, 2026"), so check NJ, CA and PA against the official current code **[VERIFY]**.*

**1. All four statutes reach nonprofits.** NJ "business" includes entities "whether or not organized to operate at a profit" (N.J.S.A. 56:8-161, as amended by [P.L. 2019, c. 95, § 1](https://pub.njleg.gov/bills/2018/PL19/95_.HTM)). CA uses the same wording ([Cal. Civ. Code § 1798.80(a)](https://codes.findlaw.com/ca/civil-code/civ-sect-1798-80/)), as does PA ([73 P.S. § 2302](https://codes.findlaw.com/pa/title-73-ps-trade-and-commerce/pa-st-sect-73-2302/), "business"). NY covers "any person or business" ([N.Y. Gen. Bus. Law § 899-aa(2)](https://www.nysenate.gov/legislation/laws/GBS/899-AA)).

**2. Encrypted data is carved out unless the key goes too.** The statutes word this differently:
- **NJ.** A "breach of security" is unauthorized access that compromises personal information "when access to the personal information has not been secured by encryption or by any other method or technology that renders the personal information unreadable or unusable" (§ 56:8-161).
- **NY.** Data elements count only if "not encrypted" or "encrypted with an encryption key that has also been accessed or acquired" (§ 899-aa(1)(b)).
- **CA.** Encrypted data triggers notice only if the key or security credential was, or is reasonably believed to have been, acquired and "could render that personal information readable or usable." "Encrypted" means "rendered unusable, unreadable, or indecipherable to an unauthorized person" ([§ 1798.82(a)(1), (i)(4), (k)](https://codes.findlaw.com/ca/civil-code/civ-sect-1798-82/)).
- **PA.** The duty covers "unencrypted and unredacted" data. Encrypted data counts if it is acquired "in an unencrypted form," if the breach is linked to a breach of the encryption, or if it involves "a person with access to the encryption key" ([73 P.S. § 2303(a)–(b)](https://codes.findlaw.com/pa/title-73-ps-trade-and-commerce/pa-st-sect-73-2303/)).

On ciphertext alone, the rule appears to be that no notice is owed in any of the four states.

**3. Most of what the server holds may not be "personal information" at all.** NJ, CA and PA generally require a first name or initial plus last name linked to a listed element (CA and PA, unlike NJ, make the online-credential element stand alone) (§ 56:8-161; § 1798.82(h)(1); § 2302). NY's base is any identifier "which ... can be used to identify such natural person" (§ 899-aa(1)(a)). A phone number is not a listed element in any of the four, so a hashed phone number alone appears to fall outside all of them. The plaintext the server holds is attorney names and bar numbers, aliases, and match-cluster sizes, and none of those is a listed element. A report's contents could count as "medical information" in NY and CA, since both cover a "mental or physical condition" (§ 899-aa(1)(b)(i)(6); § 1798.82(i)(2)). PA lists medical information only when held by a state agency or state agency contractor (§ 2302, item (iv)), but it does list health insurance information. While the reports stay encrypted, this matters only if the key is lost too.

**4. Three gaps where the safe harbor may not hold.**
- **(a) Login credentials.** All four list a username or email address combined with a password or security question that would permit access to an online account (§ 56:8-161, "personal information" item (4), which in NJ counts only when linked to the person's name; § 899-aa(1)(b)(ii); § 1798.82(h)(2); § 2302, "personal information" item (vi)). Matra stores usernames and a slow hash, not passwords. The argument that a hash is not a "password", and is "secured ... unusable", seems strong. But no case or AG guidance applying this to salted hashes was found **[VERIFY]**.
- **(b) Passphrase-derived keys.** The wrapped private key and KDF salt sit on the server, so an attacker holding a dump can guess passphrases offline. Weak passphrases would make the "key" practically acquired. CA's definition turns on the data being "indecipherable to an unauthorized person." Whether a guessable passphrase is "encryption" under these statutes appears unsettled. This argues for building W5 (a passphrase-strength floor and Argon2id) before real data.
- **(c) Keyed hashes and the hashing key.** NJ treats dissociated data as personal information "if the means to link the dissociated data were accessed" with it (§ 56:8-161). Phone numbers are too few to resist guessing, so a leaked HMAC key or pepper would undo the hash. Whether a hash counts as "encryption" in NY and PA (which define it as transforming data with "low probability of assigning meaning without ... [a] key", § 2302) is untested **[VERIFY]**.

**5. Risk-of-harm exceptions differ.** NJ excuses notice if the business "establishes that misuse of the information is not reasonably possible," documented in writing and kept 5 years (§ 56:8-163(a)). Where notice is due, NJ requires reporting to the State Police first (§ 56:8-163(c)(1)). PA's breach definition already requires "access and acquisition" that "materially compromises" the data and causes, or is reasonably believed to cause, loss or injury (§ 2302). NY's exception covers only inadvertent disclosure by authorized persons (§ 899-aa(2)(a)), so it does not help after an outside attack. NY notice is due within 30 days, with copies to the AG, the Department of State and the State Police (§ 899-aa(2), (8)(a)). CA notice is due within 30 calendar days, with the AG if more than 500 residents are affected (§ 1798.82(a)(2)(A), (f)). PA notifies the AG when more than 500 residents are affected (§ 2303(c.1)).

**6. Other duties.**
- **Service providers.** A "maintainer," such as a hosting provider or key-holding institution, must notify the owner (§ 899-aa(3); § 1798.82(b)), so Matra's contracts should require that.
- **Matching key shares.** If fewer than the threshold number of n-of-m shares leak, no key is acquired. Whether a leaked share alone is a breach "linked to a breach of the security of the encryption" under PA § 2303(b) appears untested; the words could be read that way **[VERIFY]**.
- **FTC Health Breach Notification Rule.** The rule ([16 C.F.R. § 318.2](https://www.law.cornell.edu/cfr/text/16/318.2)) applies to a "vendor of personal health records" and only to "unsecured" PHR identifiable health information, meaning data not protected by a technology or methodology specified in HHS guidance. Whether Matra is such a vendor, and whether the FTC reaches a nonprofit operator, is open (memo § 6) **[VERIFY]**.
- **Promises.** Separately from notice, what the privacy policy promises about breaches can create liability under consumer-protection law if the promises are wrong **[VERIFY]**.

## Ask for counsel

We plan to treat a breach of ciphertext, OPRF-blinded tags and keyed-hashed phones (no key, pepper or threshold of shares taken) as not notifiable in NJ, NY, CA or PA.
We would record an NJ § 56:8-163(a) "misuse not reasonably possible" determination, and notify survivors voluntarily anyway.
Decisions needed: (1) is that reading right; (2) are stored usernames plus slow hashes of passphrase-derived keys "user name ... in combination with a password";
(3) does a dump that allows offline guessing of weak passphrases count as acquiring the key; (4) what may the privacy policy promise about breaches?

## Answer

<!-- Empty until a licensed attorney answers. Then only "Resolved (D-###)." plus a one-line public conclusion if counsel
approved one. Counsel's actual advice lives in private/DECISIONS.md (gitignored; the repo is public). -->
