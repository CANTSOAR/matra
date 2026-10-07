# Matra: Security Whitepaper (MVP)

**Status:** describes the MVP as implemented in `packages/crypto`, `packages/shared`, and `apps/server` as of 2026-10-06. **No independent security audit has been performed.** Matra must not be used with real survivor data until the "Before any real-data pilot" items in section 8 are complete.

---

## 1. Goals and non-goals

**Goals**
1. **Confidentiality from the operator.** Survivor content (narratives, evidence files, perpetrator identifiers) is encrypted on the survivor's device. The server stores only ciphertext and cannot decrypt it.
2. **Survivor control.** Content reaches a third party (an attorney) only through an explicit, logged, revocable consent. Nothing is ever sent automatically to police, schools, or employers.
3. **Integrity and time-evidence.** Every sealed record, evidence file, and consent event receives an entry in an append-only hash chain. This lets anyone show later that a given ciphertext existed no later than the server's recorded time and has not been altered since.
4. **Safety in use.** Quick Exit, no plaintext in the server or its logs, and minimal on-device residue.

**Non-goals (MVP)**
- Protecting a survivor whose device is compromised (malware, a stalkerware-infected phone) or who is coerced into revealing her passphrase.
- Hiding *that* a person uses Matra from a network observer or the operator.
- Court-grade trusted timestamping. The ledger is self-hosted and not yet externally anchored (section 6).

---

## 2. Architecture

```
 Survivor browser (client)                          Matra server (Node + SQLite)
 ┌───────────────────────────────┐                  ┌─────────────────────────────────┐
 │ Intake chatbot (scripted, no  │                  │ users: username, role, scrypt   │
 │ AI) → IntakeRecord (plaintext)│                  │   (authKey), kdf salt, RSA pub, │
 │                               │   ciphertext +   │   wrapped RSA priv              │
 │ @matra/crypto (WebCrypto)     │   wrapped keys   │ records / blobs: ciphertext     │
 │  • derive keys from passphrase├─────────────────►│ shares: recipient-wrapped keys, │
 │  • AES-256-GCM encrypt        │     (TLS)        │   consent text, alias, status   │
 │  • strip image EXIF/GPS       │                  │ escrow: HMAC(pepper, idHash)    │
 │  • PDF brief generated locally│◄─────────────────┤ ledger: append-only hash chain  │
 └───────────────────────────────┘   ciphertext     │ audit_events: per-user log      │
                                                    └─────────────────────────────────┘
 Attorney browser: same crypto library; decrypts only what was re-wrapped to its RSA key.
```
(The package names in code are currently `@matra/*`. The rename to Matra is cosmetic.)

---

## 3. Key hierarchy

```
 passphrase (never leaves device; NFKC-normalized)
    │
    ▼  PBKDF2-HMAC-SHA256, 600,000 iterations, 16-byte random per-user salt
 512-bit seed
    ├── HKDF-SHA256(info="shield/auth")   ──► authKey (256 bit) ──► sent at login
    │                                              server stores scrypt(authKey, salt)
    │                                              (N=16384, r=8, p=1) — never the authKey
    └── HKDF-SHA256(info="shield/master") ──► masterKey (AES-256-GCM, non-extractable,
                                                in memory only)
             │
             ├── wraps ► RSA-OAEP-3072 (SHA-256) identity private key  (stored wrapped on server)
             ├── wraps ► per-record content key  K_r  (AES-256-GCM, random)  ──► record ciphertext
             └── wraps ► per-blob content key    K_b  (AES-256-GCM, random)  ──► evidence ciphertext

 Sharing with attorney A:  K_r, K_b  ──RSA-OAEP(A.publicKey)──► recipient-wrapped keys (server)
 Attorney decrypts: A.passphrase → A.masterKey → A.RSA private key → K_r, K_b → plaintext
```

**Properties**
- The server never sees the passphrase, the masterKey, any content key, or any plaintext record.
- Knowing the authKey (for example, from a stolen login exchange) does not reveal the masterKey, because HKDF provides domain separation.
- `GET /api/auth/prelogin` returns a deterministic fake salt for unknown usernames, which limits username enumeration.
- **No password reset exists.** A forgotten passphrase means the data is permanently unrecoverable. This is inherent to zero knowledge (see the roadmap for recovery options).
- AES-GCM uses a random 96-bit IV per encryption. Every key is random and per-object, so nonce reuse is not a practical concern at MVP scale.

**Evidence handling**
- Images are **re-encoded client-side to strip EXIF and GPS metadata** before hashing and encryption. The `sha256` stored inside the encrypted record is the hash of the *stripped* bytes, which an examiner can re-verify.
- Non-image files (PDF, video, audio, documents) are **not** metadata-stripped. The UI warns the survivor.
- **Evidentiary trade-off:** re-encoding means the stored file is a *derivative*, not the original. Its hash will not match the original file, and probative original metadata (such as capture time) is lost. Survivors must be told to **keep the original file and device**. A future option is to also store the encrypted original, with a clear location-data warning.

---

## 4. Ledger (WORM-style hash chain)

```
 entryHash_n = SHA-256( seq | type | subjectId | contentHash | timestamp | prevHash_{n-1} )
 genesis prevHash = 0×64
 contentHash = SHA-256(ciphertext) for record.sealed / blob.sealed;
               SHA-256(canonical consent JSON) for share.granted (attests exact consent text)
```
- SQLite triggers reject any `UPDATE` or `DELETE` on the ledger, and reject any `INSERT` that does not extend the chain (`seq = max+1`, `prevHash = head`). Records are immutable. A correction is a new row with `supersedes`.
- `GET /api/ledger/verify` recomputes the chain. The brief PDF prints ledger entry IDs and hashes so a third party can re-check them.
- Account deletion crypto-shreds the account (ciphertext, keys, shares, escrow, audit), with `secure_delete` on. Ledger rows (IDs, hashes, timestamps) remain, and an `account.shredded` entry is appended.
- Escrow writes exactly **one** ledger entry per submission (`escrow.sealed`, hashing the encrypted label, never the identifier hash). There is deliberately **no `escrow.matched` entry**: writing one at match time would let anyone watching `GET /api/ledger/head` see the sequence number jump after a submission and infer a match. The match time is kept only in the database (`escrow_entries.matched_at`).

**What the ledger proves, and what it does not**
- It **does** show internal consistency: no entry has been altered or removed *relative to the current head*.
- It **does not** stop the operator from rewriting the entire chain and recomputing every hash, because the operator controls the database and the clock. Until the head hash is anchored externally (section 6), a court has to trust the operator's testimony about its timestamps.
- Ledger hashes cover **ciphertext**. To connect ciphertext to plaintext, the key holder decrypts and shows that the stored plaintext hash matches. AES-GCM is **not key-committing**, so a party who controls keys could in theory craft a ciphertext that decrypts to different plaintexts under different keys. **Roadmap:** add a salted plaintext commitment to sealed records, or use a key-committing AEAD construction.

---

## 5. Threat model

Notation: ✅ protected in MVP · ⚠️ partially protected · ❌ not protected.

| Adversary / scenario | What they can do | Status | Notes and mitigations |
|---|---|---|---|
| **Server database leak / stolen backup** | Read all tables | ✅ content · ⚠️ metadata | Content is AES-256-GCM ciphertext. Exposed metadata includes usernames, record and blob counts and sizes, timestamps, share relationships, the plaintext survivor alias, attorney profiles, escrow status, and audit text. scrypt hashes protect authKeys, and the 600k PBKDF2 slows offline passphrase guessing. **Weak passphrases remain guessable** (enforce length, and suggest a diceware phrase). |
| **Subpoena or warrant to Matra** | Compel production | ✅ content · ⚠️ metadata | Matra cannot produce plaintext. It *can* produce the metadata above. See Legal Memo §2. The survivor herself can still be compelled. |
| **Compromised or malicious server (code, active attacker)** | Serve modified JavaScript; substitute keys | ❌ | **The central limitation of any web-based end-to-end encryption.** A malicious build can capture the passphrase. A malicious server can also return an **attacker-controlled "attorney" public key**, so the survivor encrypts to the attacker. Mitigations: publish build hashes and use subresource integrity; offer an out-of-band **key-fingerprint check** (`publicKeyFingerprint()` already exists; surface it in the UI); later, key transparency, a signed desktop or mobile app, and reproducible builds. |
| **Escrow: operator or anyone holding the pepper** | Confirm whether a known identifier was entered | ❌ | Identifiers are low-entropy (about 10^10 phone numbers). Client PBKDF2 (200k iterations, fixed global salt) plus server HMAC (pepper) stops an attacker who has only the database. **It does not stop the pepper holder**, who can test a specific person's number instantly or brute-force the phone space at modest cost (Demir et al. 2018; Hagen et al. NDSS 2021). The server also learns *which accounts* entered the same identifier. |
| **Escrow: perpetrator probing (self-check)** | Register as a "survivor", enter his own phone number or handle, and see whether it "matched" | ✅ **mitigated** · ⚠️ residual | **Fixed.** Survivors never see match results: `POST /api/escrow` and `GET /api/escrow` always return `status: 'sealed'` with no `matchedAt`, and nothing in the survivor's own audit log mentions a match. The real state stays in the database. The ledger side channel is closed too: no `escrow.matched` entry is written, so the ledger grows by exactly one entry per submission whether or not it matched. Matches are released only through a **human gatekeeper**: the verified attorney the survivor has an **active share** with sees `ShareBundle.escrow = { sealedCount, matchedCount }` for that survivor's own entries (no labels, no hashes, nothing about the other survivor), with a notice to discuss it with the client and treat it as a lead, not evidence. Server tests assert all of this. **Residual risks:** (1) a perpetrator who gets a verified attorney to accept a share could learn of a match through that attorney. This is mitigated by attorney verification and the attorney's professional duties, not by cryptography. (2) The pepper holder can still test identifiers (row above). Still on the roadmap: account verification, rate limits, delayed or batched match evaluation, and a trained Legal Options Counselor who can contact both parties (Callisto's model). Literature: Arun et al. NDSS 2020; Kuykendall et al. PoPETs 2019. |
| **Escrow: false matches** | Common names, recycled numbers | ⚠️ | Normalization (lower-casing, Gmail dot/plus removal, NANP phone form) reduces misses but increases false matches on names. Weight full-name-only matches lower, or exclude them. Treat a match as a lead only. |
| **Abusive partner with device access** | Browse history; open the app; coerce the passphrase | ⚠️ | Quick Exit button and triple-Esc replace the page. A 12-hour session TTL and server-side logout apply. **Residue:** browser history, downloaded PDFs, and an un-expired session token may remain. Roadmap: auto-lock on inactivity, no-download "view only" mode, clearing local storage on exit, and safety-planning guidance (private browsing, safe device). **Coercion of the passphrase cannot be defended against cryptographically.** A duress or decoy vault is risky and needs advocate input before it is built. |
| **Malicious or compromised attorney account** | Read shared records; exfiltrate them | ⚠️ | Only **verified** attorneys can receive shares (an admin CLI sets verification today). Every open and download is written to the survivor's visible audit log. **Revocation stops future server fetches but cannot recall plaintext already downloaded.** Mitigations: identity and bar verification procedures (see MOU), share expiry, scoped shares, MFA and passkeys for attorneys, and partner agreements with breach duties. |
| **Insider (Matra staff)** | Database access; deploy code | ⚠️ | Same as a database leak plus the malicious-code risk. Mitigations: two-person code review and deploy, least-privilege production access, audit of admin actions (attorney verification), and a published security policy. |
| **Network attacker** | Intercept traffic | ✅ (with TLS) | TLS is required in deployment, along with HSTS. Even under TLS interception, payloads are already end-to-end encrypted. Login is protected by the derived authKey (the passphrase is never sent). |
| **Account takeover by guessing** | Online guessing | ⚠️ | Login rate limits are 10/min per username and 60/min per IP (in-memory, single process), and failed attempts are written to the user's audit log. Roadmap: persistent limiter, passkeys, alerts. |
| **Denial / destruction** | Delete data | ⚠️ | Records cannot be deleted except by the owner's crypto-shred. There is no server-side backup strategy yet. Define backup encryption and retention before the pilot. |

---

## 6. Roadmap

**Before any real-data pilot (blocking)**
1. **Escrow redesign:** ~~hide match status from users~~ (**done**: survivors always see "sealed"; matches are released only as counts to the verified attorney with an active share; no `escrow.matched` ledger entries). Still to do: a vetted counselor who can reach both parties, account verification, and rate limiting. Evaluate an **OPRF** (RFC 9497) with a **threshold or federated key**, so that no single party, including Matra, can test identifiers offline (Callisto, Rajan et al. 2018). Until then, keep escrow **demo-only**.
2. **Independent security audit** of the crypto library, server, and web client. Commission a penetration test.
3. **Client integrity:** published build hashes, SRI, a strict CSP, and an attorney key-fingerprint check in the UI.
4. **Share expiry** (VAWA "reasonably time-limited" consent), MFA or passkeys for attorneys, and a documented attorney-verification procedure.
5. **Metadata minimization:** encrypt the survivor alias, pad sizes, set log retention, and truncate IPs.
6. **Incident response plan** and breach-notification procedure (N.J.S.A. 56:8-163; NY GBL 899-aa).

**Next phase**
7. **External timestamp anchoring** of the ledger head: an RFC 3161 Time-Stamp Authority, and/or periodic publication to a public, append-only log. This turns "trust our server clock" into third-party-verifiable time evidence.
8. **Plaintext commitments** or a key-committing AEAD for sealed records (section 4).
9. **Recovery without operator access:** Shamir secret sharing of a recovery key among the survivor and one or more trusted advocates (for example, 2-of-3). The survivor would be fully informed of the risks if an advocate is compromised or compelled.
10. **Passkeys (WebAuthn)** for login and possibly key wrapping (PRF extension).
11. A native or packaged client to reduce the malicious-JavaScript risk.
12. Optional encrypted storage of **original** evidence files alongside stripped copies.
13. A documented forensic verification procedure and a named custodian for FRE 902(13)/(14)-style certifications.

---

## 7. What we tell survivors (plain language)
- "We can't read what you write. Not even our staff can."
- "If you forget your passphrase, nobody can recover your information. Not us, not anyone."
- "A court can order **you** to share your records. We can't be forced to, because we can't open them."
- "Matra knows that your account exists and when you used it. It doesn't know what you wrote."
- "When you share with a lawyer, they can read and save what you shared. Turning off sharing stops new access, but it can't erase what they already saved."
- "If someone controls your phone or computer, they may be able to see what you do. Use a safe device."
- "If you seal a name, this app will always show it as sealed. If someone else names the same person, only the attorney you choose to share with is told, and never who the other person is."

## 8. References
- Rajan, Qin, Archer, Boneh, Lepoint, Varia, "Callisto: A Cryptographic Approach to Detecting Serial Perpetrators of Sexual Misconduct," COMPASS 2018. https://par.nsf.gov/biblio/10061833
- Kuykendall, Krawczyk, Rabin, "Cryptography for #MeToo," PoPETs 2019(3). https://petsymposium.org/popets/2019/popets-2019-0054.php
- Arun et al., "Finding Safety in Numbers with Secure Allegation Escrows," NDSS 2020. https://www.mpi-sws.org/~dg/papers/ndss20.pdf
- Little, Qin, Varia, "Secure Account Recovery for a Privacy-Preserving Web Service," IACR ePrint 2024/962 (Callisto recovery). https://eprint.iacr.org/2024/962
- Demir et al., "The Pitfalls of Hashing for Privacy," IEEE COMST 2018. https://inria.hal.science/hal-01589210
- Hagen et al., "All the Numbers are US," NDSS 2021. https://www.ndss-symposium.org/wp-content/uploads/ndss2021_1C-3_23159_paper.pdf
- RFC 9497 (OPRF). https://www.rfc-editor.org/rfc/rfc9497 · RFC 3161 (Time-Stamp Protocol). https://www.rfc-editor.org/rfc/rfc3161
- OWASP Password Storage and Cryptographic Storage Cheat Sheets. https://cheatsheetseries.owasp.org/
- Fed. R. Evid. 902(13)-(14) and the 2017 committee notes. https://www.law.cornell.edu/rules/fre/rule_902
- Local copies: `compiled_resources/02_digital_evidence_chain_of_custody/`, `compiled_resources/04_cryptographic_escrow_privacy/`.
