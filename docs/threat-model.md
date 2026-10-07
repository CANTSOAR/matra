# Threat model

Status: draft by the author, written from reading the code. Not reviewed by an outside cryptographer. Not audited. Update it with every security-relevant change.

**This is a supplement to the [Security Whitepaper](SECURITY_WHITEPAPER.md), which is the primary description of the architecture, key hierarchy, ledger and threat model.** This file is the engineering tracker of known weaknesses (W1 to W17). Where the two disagree, the whitepaper and the code win; fix this file.

## 1. What is protected

| Asset | Where it lives |
|---|---|
| Record contents and attachments | Encrypted in the browser (AES-256-GCM); server stores ciphertext only |
| Passphrase and master key | Browser memory only. The server receives a separate derived `authKey` |
| Per-record keys | Wrapped by the master key; re-wrapped to an attorney's RSA-OAEP public key on sharing |
| Sealed-match identifiers (perpetrator email, phone, social profile; never names) | Canonicalised in the browser, then mapped through a split-key RFC 9497 VOPRF (holders A + B) to a pseudorandom tag. The server stores the tag, a contact bundle encrypted under a per-perpetrator key, and Shamir shares sealed to counselors. Not private from someone holding **both** key shares (W2, W14) |
| Matched survivors' contact preferences | Openable only by a verified counselor holding two survivors' shares for the same tag (whitepaper §4a) |
| Integrity history | Append-only SHA-256 hash-chain ledger, enforced by SQLite triggers |

## 2. What the operator can still see

Zero-knowledge covers content, not metadata. A server operator, database thief or a party with a subpoena can see:

- Usernames, roles, account creation time, login times, IP addresses (subject to log retention).
- Number, size and timestamps of records and attachments.
- Which survivor shared with which attorney, when, and the consent statement text (hashed in the ledger; stored in the share record).
- Attorney profiles (name, organization, bar number, jurisdictions).
- Sealed-match tags: which entries name the same (unknown) person, cluster sizes even below the threshold, and whether and when a group matched. (Survivors never see match state; attorneys no longer see counts; only verified counselors receive matched groups.)
- OPRF quota counters per account (today's count and a lifetime total), and counselor outreach-note counts and times (note contents are encrypted to the counselor).

Never describe the system as "mathematically impossible to hand over data." Say: *the operator cannot decrypt record contents. The survivor and anyone she shared with still can be compelled, and metadata is producible.*

## 3. Adversaries

| Adversary | Goal |
|---|---|
| Abuser or associate with access to the survivor's device or accounts | Read records, learn she is documenting |
| Abuser using the platform | Learn whether he has been reported (escrow probing); impersonate an attorney |
| Network attacker | Intercept or modify traffic |
| Database or backup thief | Read data, brute-force passphrases offline |
| Malicious or compromised operator or insider | Read data, substitute keys, silently alter the web client |
| Legal process (defense subpoena, law enforcement) | Compel the operator, survivor or attorney |
| Malicious or careless attorney | Leak or misuse shared records |
| Malicious or careless counselor | Misuse matched survivors' contact details; try to open unmatched entries |
| OPRF key holder(s), or someone who obtains both key shares | Test guessed identifiers; tag or block users with wrong evaluations |
| Sybil attacker | Create accounts to force a "match" on a target and expose a real survivor's contact bundle |

## 4. Known weaknesses (fix before real data)

Severity: **High** = blocks any real use.

| # | Weakness | Sev | Notes / planned fix |
|---|---|---|---|
| W1 | **Match probing.** *Fixed for survivors and attorneys:* `/api/matching/entries` and `/api/escrow` always return `sealed` with no match time or tag; nothing in a survivor's audit log mentions a match or a counselor; no ledger entry at match time (ledger grows by exactly one per submission); the match insert is one always-executed statement. Attorneys no longer receive match counts (`ShareBundle.escrow` removed). Matched groups go only to verified counselors. **Residual:** a counselor contacting a perpetrator whose fake entry matched reveals the match. | Low–Med | Counselor plausibility review before contact; never confirm who else was named; delayed/batched release could be added. |
| W2 | **Low-entropy identifiers.** Phone numbers have ~10^10 values. *Addressed by design:* tags need VOPRF_{k_A+k_B}; a DB thief can't test guesses, and each API guess costs a rate-limited evaluation at both holders (≤ 10/day, ≤ 50 lifetime per verified-adult survivor account). *Key custody (security review M3, fixed):* production refuses to start unless both shares come from the environment or files outside the DB directory, and never auto-generates them, so a DB volume copy holds neither. **Residual:** whoever holds **both** shares can brute-force offline in milliseconds per thousand guesses (W14; regression test `apps/server/src/config.test.ts`). | Med (was High) | Independent operators for holders A and B; HSM/KMS custody; monitoring of evaluation volume. |
| W3 | **Attorney key substitution.** The client fetches attorney public keys from the server (`GET /api/attorneys`). A malicious or compromised operator could substitute its own key and receive shared record keys. | High | The share screen now shows the attorney's key fingerprint, embeds it in the consent statement, and suggests asking the attorney to read it out. The check is optional and manual. Still to do: an out-of-band verification path through the attorney's organization; consider key transparency. |
| W4 | **The operator ships the client code.** A compromised server can serve a modified web app that exfiltrates the passphrase. Zero-knowledge from the server doesn't protect against this. | High | Reproducible builds, subresource integrity, a native or extension client with signed releases, and publishing build hashes. Independent hosting of the client. |
| W5 | **Passphrase strength and offline attack.** Keys derive from a passphrase via PBKDF2-SHA256 (600k). A stolen database enables offline guessing of weak passphrases. | Med | Move to Argon2id (needs a WASM dependency) and enforce passphrase strength (generated diceware recommended). No password recovery exists by design. Say so plainly. |
| W6 | **Shares never expire.** *Fixed (expiry):* every share has `expires_at` (default 90 days, survivor-selectable 1 to 365 days, set in the consent statement and the `share.granted` ledger hash). The bundle route and evidence download return 403 `share_expired` after that time. `POST /api/shares/:id/renew` extends it and writes a `share.renewed` ledger entry and audit rows; the dashboard shows expiry and offers renewal. Existing rows were migrated to created_at + 90 days. **Residual:** expiry and revocation stop future access only; content already decrypted by the attorney cannot be clawed back (stated in the consent text). | Low | Keep telling survivors this plainly; partner terms on attorney-side retention. |
| W7 | **Attorney verification is a manual flag** (`verify-attorney.ts`). No defined vetting process, so someone could pose as an attorney. | High | Define a vetting procedure (bar lookup plus a call to the organization) in the partner terms. Log who verified whom and when. Re-verify periodically. |
| W8 | **Device and shoulder-surfing risk.** An abuser with device access may find the app, history, or an unlocked session. | High | Built: Quick Exit button and triple-Esc, 12-hour session TTL, keys held in memory only. Still to do: auto-lock on inactivity, neutral naming and icon, clearing residue on exit, browser-history guidance. Needs advocate review. |
| W9 | **No 18+ enforcement.** NJ requires anyone to report suspected child abuse (N.J.S.A. 9:6-8.10). | Medium | **Mitigated (self-attestation only).** Survivor registration requires "I am 18 or older" (server schema `ageConfirmed18: true`, stored as a flag plus server timestamp). Anyone who says they're under 18 sees a kind message pointing to Childhelp (1-800-422-4453), RAINN (800-656-4673) and 911, and nothing is saved or sent. It cannot verify age. Partner-channel onboarding and counsel review of the wording remain. |
| W10 | **Ledger is tamper-evident, not tamper-proof.** The operator controls the head. A fully rewritten chain looks valid. | Med | Anchor the ledger head externally (RFC 3161 timestamps or a public transparency log). Publish heads regularly. |
| W11 | **Metadata exposure** (section 2). | Med | Minimize logs (30 days, truncated IPs), padding for record sizes, avoid storing the consent text in plaintext if the ledger hash suffices. |
| W12 | **Client-side RSA-OAEP with long-lived keys, no forward secrecy.** A compromised attorney private key exposes every record ever shared with that attorney. | Low–Med | Per-share keys or periodic rotation; attorney key hygiene in partner terms. |
| W13 | **Sybil matches.** The threshold counts distinct *accounts*. Accounts are cheap (self-attested 18+), and after one OPRF evaluation the tag for a target can be reused by more accounts without further evaluations. A forced match exposes a real survivor's contact bundle to a counselor (not to the attacker). *Decoy lines fixed (review H1):* the tag is derived from the line's intercept and every entry is opened with K_P, so Sybil entries sealed on a fake line can no longer hide real reports, and extra/foreign lines raise a counselor alert. *Mitigated (review M2):* groups are released only once the matching entries are ≥ 72 h old (`MATRA_MATCH_RELEASE_DELAY_HOURS`), and the counselor sees Sybil signals (accounts created within 24 h of each other, entries sealed < 7 days after account creation). | High | Account verification without a user list (partner invite codes, anonymous credentials); counselor plausibility review before any contact; contact only on the survivor's own terms. |
| W14 | **Both OPRF key shares live in one process (MVP).** `/api/matching/oprf-a` and `/oprf-b` use separate keys (`MATRA_OPRF_KEY_A/B`) and quotas, but the operator holds both, so the operator can test guessed identifiers offline. Colluding holders have the same power (they still cannot open bundles). *Done:* builds can pin both public keys (`MATRA_OPRF_PUBKEY_A/B`); the client refuses pk_A = pk_B, identity keys and pk_A + pk_B = 0; the server records the keys and refuses to boot on a silent change (`MATRA_OPRF_ROTATE=1` → new key epoch, clients re-seal on sign-in). | High | Run holder B as a separate service, host and organisation with its own key generation, backups, token-verified auth and quota store. |
| W15 | **Counselor key substitution / insider.** *Key substitution mitigated (review M4):* the counselor roster is signed offline with the organization's Ed25519 key (`npm run -w @matra/server sign-roster`) and builds pin its public key (`MATRA_COUNSELOR_ROSTER_PUBKEY`); clients then seal only to listed counselors with the listed key. Residual: unpinned (dev) builds trust the server's list. *Insider:* a real counselor sees matched survivors' contact details. Seals are per-counselor and bound to the tag by AAD; counselors cannot call the OPRF or open unmatched entries. Research A7 is **mitigated, not closed**: a counselor colluding with a Sybil survivor account can seal a guess and see whether a group appears after the release delay. **Residual risk: Sybil + counselor collusion; needs account-level Sybil resistance before real use.** | High | Account-level Sybil resistance (W13); vetting and contract; org key held offline; split the counselor key (threshold decryption); log decryptions on a separate system. |
| W16 | **Magnet identifiers (review H2, fixed).** A reserved-path deny-list turned share / messenger / stories links into canonicals like `instagram:share` or `facebook:messages` that would match unrelated reports, and free-text "other" identifiers containing digits became phone numbers. Now: per-host allow-list profile parsing, `other` and names are never sealed, strict E.164/NANP and email rules, and a test-time denylist + fuzzing of >10,000 non-profile URLs. **Residual:** platforms add new URL shapes; anything unknown is refused (a gentle message asks for the profile page or @handle). | Low | Re-review the allow-lists when platforms change their URLs. |
| W17 | **Counselor-side verification limits.** The counselor can't check that a bundle's identifier matches the tag (that needs the OPRF), so a survivor-side entry naming a different identifier on the real line is only flagged (*identifier_mismatch*), and a duplicated entry is only de-duplicated by x. Bundles and labels are now padded to 1 KiB buckets. | Low | Counselor plausibility checks (ethics banner); report alerts to Matra. |

## 5. Out of scope for now

Coercion of the survivor, malware on her device, a state-level adversary, and traffic analysis. Say so in user-facing documents.

## 6. Required before real data

- Close the residual W1 risks and fix W3, W4, W7, W8, W9, W13, W14 and W15 (for W15: account-level Sybil resistance, since A7 is only mitigated). Until W14 is fixed, do not claim sealed matching is private from the operator. (Same list as the whitepaper's "Before any real-data pilot" roadmap.)
- Independent audit of `packages/crypto` and the server, results published.
- Incident-response plan and law-enforcement request guide.
- See the gates in [GOVERNANCE.md](../GOVERNANCE.md).
