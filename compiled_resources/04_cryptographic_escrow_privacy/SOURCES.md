# 04 - Cryptographic Escrow & Privacy: Sources

Retrieved 2026-10-06. All files are open-access copies (author or publisher open access, NSF Public Access Repository, IETF/RFC Editor, OWASP CC-BY-SA). Nothing paywalled was downloaded.

## A. Callisto and later allegation-escrow papers

| File | Citation | URL |
|---|---|---|
| `callisto_rajan2018_compass.pdf` | Anjana Rajan, Lucy Qin, David W. Archer, Dan Boneh, Tancrède Lepoint, Mayank Varia. "Callisto: A Cryptographic Approach to Detecting Serial Perpetrators of Sexual Misconduct." *Proc. 1st ACM SIGCAS Conference on Computing and Sustainable Societies (COMPASS '18)*, 2018. DOI 10.1145/3209811.3212699 | https://par.nsf.gov/biblio/10061833 (PDF: https://par.nsf.gov/servlets/purl/10061833) |
| `metoo_kuykendall2019_popets.pdf` | Benjamin Kuykendall, Hugo Krawczyk, Tal Rabin. "Cryptography for #MeToo." *Proceedings on Privacy Enhancing Technologies* 2019(3):409-429. DOI 10.2478/popets-2019-0054 | https://petsymposium.org/popets/2019/popets-2019-0054.php |
| `sae_arun2020_ndss.pdf` | Venkat Arun, Aniket Kate, Deepak Garg, Peter Druschel, Bobby Bhattacharjee. "Finding Safety in Numbers with Secure Allegation Escrows." *NDSS 2020*. DOI 10.14722/ndss.2020.24331 (also arXiv:1810.10123) | https://www.mpi-sws.org/~dg/papers/ndss20.pdf |
| *(not downloaded, link only)* | Nishat Koti, Varsha Bhat Kukkala, Arpita Patra, Bhavish Raj Gopal. "Shield: Secure Allegation Escrow System with Stronger Guarantees." *ACM Web Conference (WWW) 2023*, pp. 2252-2262. IACR ePrint 2023/338 | https://eprint.iacr.org/2023/338 |

**Notes**
- **Callisto (Rajan et al. 2018).** This is the canonical Callisto paper: a 4-page short paper. It describes the matching escrow. The client obtains an OPRF output on the perpetrator identifier (phone number, social-media URL, email) from a key server and uses it to place the report in a "matching bucket". The report key is Shamir-secret-shared so that a second matching report reveals it, and only the Legal Options Counselor (a lawyer) can decrypt. Funding is acknowledged as NSF grants #1718135 and #1414119 for Qin and Varia, and NSF and others for Boneh. Read Sections 2-3 for the threat model and the reasons for OPRF, key federation and Shamir secret sharing.
- **WhoToo (Kuykendall, Krawczyk, Rabin 2019).** This is the "WhoToo" paper you remembered; its title is "Cryptography for #MeToo". It argues that Callisto protects the accuser but not the *accused* (the server can learn who is being reported). It also argues that Callisto does not trace false or Sybil accusations. It proposes the WhoToo protocol, which uses threshold cryptography across several servers, has a reveal threshold, and keeps the accused confidential until that threshold is met.
- **Secure Allegation Escrows (Arun et al. 2020).** This is the clearest published security critique of Callisto. It shows two problems: (1) the OPRF server learns who files allegations; (2) allegers are not held accountable, so an attacker can make OPRF queries and, with the database, *probe how many allegations exist against a given person*. It proposes an SAE design using MPC across distributed servers plus accountability and anti-Sybil measures. Read this before designing your matching layer.
- **Shield (Koti et al. 2023).** This paper describes further attacks on prior SAE schemes, including Arun et al. It presents an MPC-based design with a duplicity check (preventing one user filing many allegations) and supports editing and deleting allegations. ePrint is behind a Cloudflare bot check, so it was not downloaded; open the link in a browser (free).

## B. Why hashing low-entropy identifiers fails; OPRF and PSI

| File | Citation | URL |
|---|---|---|
| `demir2018_pitfalls_of_hashing_for_privacy.pdf` | Levent Demir, Amrit Kumar, Mathieu Cunche, Cédric Lauradoux. "The Pitfalls of Hashing for Privacy." *IEEE Communications Surveys & Tutorials* 20(1), 2018. DOI 10.1109/COMST.2017.2747598 (HAL author copy hal-01589210) | https://inria.hal.science/hal-01589210 |
| `hagen2021_all_the_numbers_are_us_ndss.pdf` | Christoph Hagen, Christian Weinert, Christoph Sendner, Alexandra Dmitrienko, Thomas Schneider. "All the Numbers are US: Large-scale Abuse of Contact Discovery in Mobile Messengers." *NDSS 2021*. | https://www.ndss-symposium.org/wp-content/uploads/ndss2021_1C-3_23159_paper.pdf |
| `signal2017_private_contact_discovery.md` | Moxie Marlinspike, "Technology preview: Private contact discovery for Signal," Signal blog, 26 Sep 2017. | https://signal.org/blog/private-contact-discovery/ |
| `rfc9497_oprf.txt` | A. Davidson, A. Faz-Hernandez, N. Sullivan, C. A. Wood. RFC 9497, "Oblivious Pseudorandom Functions (OPRFs) Using Prime-Order Groups," IRTF/CFRG, Dec 2023. | https://www.rfc-editor.org/rfc/rfc9497 |
| `morales2023_psi_systematic_review.pdf` | Daniel Morales, Isaac Agudo, Javier Lopez. "Private Set Intersection: A Systematic Literature Review." *Computer Science Review* 49, 2023. (Author copy, Univ. of Málaga NICS Lab) | https://www.nics.uma.es/pub/papers/morales2023psi.pdf |

**Notes**
- **Demir et al.** This tutorial explains why hashing is not anonymization. The key idea is that a hash of an identifier from a small, enumerable space (MAC addresses, email addresses, phone numbers) can be reversed by enumeration. A salt does not change this when the attacker has the salt. The paper includes case studies and is the best general citation for "salted hash of a phone number is not protection".
- **Hagen et al.** This is the practical evidence. Using a database of mobile phone prefixes and few resources, the authors crawled 10% of US mobile numbers on WhatsApp and 100% on Signal. They also show that "hashing-based contact discovery protocols are severely broken": they compare dictionary lookup, hashcat brute force and an improved rainbow-table construction for reversing hashed phone numbers. It is directly relevant because perpetrator identifiers in a Callisto-style system are mostly phone numbers. It also shows why an OPRF endpoint needs rate limiting.
- **Signal blog.** This is a short, readable account: "the hash of a user identifier can almost always be inverted ... the keyspace of all possible identifiers is too small." It also explains why Signal moved to SGX-based private contact discovery. Use it as a plain-language explanation for non-cryptographer advisors.
- **RFC 9497.** This is the standard OPRF construction (OPRF/VOPRF/POPRF over ristretto255, P-256 and similar groups). It is the building block Callisto used to turn a low-entropy identifier into a value that cannot be brute-forced offline, because brute-forcing requires the server's key and every guess becomes a rate-limitable online query. Section 1 and the security considerations are the essential reading.
- **Morales et al.** This is a broad survey of PSI. It names OPRF, OT and homomorphic encryption as the main building blocks and compares protocols on cost and practicality. Use it to choose a PSI or OPRF approach and to see the design space beyond Callisto.

## C. Practical guidance (OWASP Cheat Sheet Series, CC BY-SA 4.0)

| File | Source | URL |
|---|---|---|
| `OWASP_Password_Storage_Cheat_Sheet.md` | OWASP Cheat Sheet Series, "Password Storage Cheat Sheet" (raw markdown from GitHub master) | https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html |
| `OWASP_Cryptographic_Storage_Cheat_Sheet.md` | OWASP Cheat Sheet Series, "Cryptographic Storage Cheat Sheet" | https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html |

**Notes**
- **Password Storage.** This covers Argon2id, scrypt, bcrypt and PBKDF2 parameters, salting versus peppering, and work factors. It is relevant to user-account passphrases and passphrase-derived keys for client-side encryption. It is *not* a fix for identifier matching, because slow hashes only add a constant factor against a space of about 10^10 phone numbers.
- **Cryptographic Storage.** This covers algorithm choice (AES-GCM and others), key management, key separation and rotation, and secret storage. It is relevant to the encrypted report vault and to server-side key handling (OPRF keys, KMS/HSM).

## README discrepancies (README.md line 28)

1. **Wrong authors.** The README says "Anson et al." No Callisto author is named Anson. The authors are **Rajan, Qin, Archer, Boneh, Lepoint, Varia** (the sixth author is Mayank Varia of Boston University, not Mariana Raykova).
2. **Truncated title.** The full title is "Callisto: A Cryptographic Approach to Detecting Serial Perpetrators *of Sexual Misconduct*", ACM COMPASS 2018. "NSF-funded" is accurate (NSF grants #1718135 and #1414119 are acknowledged, and the paper is in the NSF Public Access Repository).
3. **Wrong technique, and the most important correction.** The README says Callisto teaches you to "hash user identifiers (phone numbers, social media handles) with salt so a database breach never reveals raw target identities." **Callisto does not do this, and it would not work.** Phone numbers have very low entropy (about 10^10 possibilities), so anyone holding the salt or pepper can reverse a salted hash in minutes to hours (Demir et al. 2018; Hagen et al. 2021). A unique salt per record would also make matching impossible. Callisto uses an **OPRF with a server-held key**, plus **key federation** and **Shamir secret sharing**, so that brute-forcing requires online, rate-limited queries to the key server. Even this design has known leaks (Arun et al. 2020; Kuykendall et al. 2019).
4. **PSI framing.** Callisto is better described as a *threshold matching escrow* built on OPRF than as classic two-party PSI. PSI and OPRF are the right concepts to study, though.
5. **"Callisto Vault" / "Callisto Expanded".** No academic paper by these names was found. Callisto Vault is a product name (Callisto's encrypted record and matching service), not a separate publication. The later literature is WhoToo (PoPETs 2019), Secure Allegation Escrows (NDSS 2020) and Shield (WWW 2023). No paper titled "Breaking and Fixing Callisto", no Yerukhimovich Callisto paper, and no "SNARKs for Callisto"/"Arke" Callisto paper were found. (Arke is an unrelated contact-discovery paper.)
