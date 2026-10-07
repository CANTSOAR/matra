# Threat model

Status: draft by the author, written from reading the code. Not reviewed by an outside cryptographer. Not audited. Update it with every security-relevant change.

**This is a supplement to the [Security Whitepaper](SECURITY_WHITEPAPER.md), which is the primary description of the architecture, key hierarchy, ledger and threat model.** This file is the engineering tracker of known weaknesses (W1 to W12). Where the two disagree, the whitepaper and the code win; fix this file.

## 1. What is protected

| Asset | Where it lives |
|---|---|
| Record contents and attachments | Encrypted in the browser (AES-256-GCM); server stores ciphertext only |
| Passphrase and master key | Browser memory only. The server receives a separate derived `authKey` |
| Per-record keys | Wrapped by the master key; re-wrapped to an attorney's RSA-OAEP public key on sharing |
| Escrow identifiers (perpetrator phone, handle, etc.) | Hashed in the browser (PBKDF2, fixed global salt), then HMAC'd again by the server with a secret pepper. Not private from the pepper holder (W2) |
| Integrity history | Append-only SHA-256 hash-chain ledger, enforced by SQLite triggers |

## 2. What the operator can still see

Zero-knowledge covers content, not metadata. A server operator, database thief or a party with a subpoena can see:

- Usernames, roles, account creation time, login times, IP addresses (subject to log retention).
- Number, size and timestamps of records and attachments.
- Which survivor shared with which attorney, when, and the consent statement text (hashed in the ledger; stored in the share record).
- Attorney profiles (name, organization, bar number, jurisdictions).
- Whether and when an escrow entry matched, and the peppered identifier hash. (Survivors never see this. Only a verified attorney with an active share sees a matched *count* for that survivor's own entries.)

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

## 4. Known weaknesses (fix before real data)

Severity: **High** = blocks any real use.

| # | Weakness | Sev | Notes / planned fix |
|---|---|---|---|
| W1 | **Escrow probing.** *Survivor-facing self-check is fixed:* `POST`/`GET /api/escrow` always return `sealed` with no match time, nothing in the survivor's audit log mentions a match, and no `escrow.matched` ledger entry is written (so the ledger head does not leak matches). Matches are released only as counts to a verified attorney with an active share. **Residual:** a perpetrator who gets a verified attorney to accept a share could learn of a match through that attorney; no rate limits or account verification yet. | Med (was High) | Rate-limit and verify accounts; delayed or batched match evaluation; route matches to a trained counselor who can contact both survivors (the Callisto model). Keep escrow demo-only until W2 is addressed. |
| W2 | **Low-entropy escrow identifiers.** Phone numbers have ~10^10 values. Whoever holds the pepper (the operator) can confirm guessed identifiers. A salted or peppered hash is not private against the party holding the secret. | High | Move to an OPRF-based protocol with key splitting (RFC 9497; see `compiled_resources/04_*`). Until then, do not claim the escrow is private from the operator. |
| W3 | **Attorney key substitution.** The client fetches attorney public keys from the server (`GET /api/attorneys`). A malicious or compromised operator could substitute its own key and receive shared record keys. | High | The share screen now shows the attorney's key fingerprint, embeds it in the consent statement, and suggests asking the attorney to read it out. The check is optional and manual. Still to do: an out-of-band verification path through the attorney's organization; consider key transparency. |
| W4 | **The operator ships the client code.** A compromised server can serve a modified web app that exfiltrates the passphrase. Zero-knowledge from the server doesn't protect against this. | High | Reproducible builds, subresource integrity, a native or extension client with signed releases, and publishing build hashes. Independent hosting of the client. |
| W5 | **Passphrase strength and offline attack.** Keys derive from a passphrase via PBKDF2-SHA256 (600k). A stolen database enables offline guessing of weak passphrases. | Med | Move to Argon2id (needs a WASM dependency) and enforce passphrase strength (generated diceware recommended). No password recovery exists by design. Say so plainly. |
| W6 | **Shares never expire.** Shares are open-ended until revoked. Revocation can't claw back already-decrypted content. VAWA-funded partners need time-limited consent. | Med | Add an expiry with easy renewal; tell survivors that revocation stops future access only. |
| W7 | **Attorney verification is a manual flag** (`verify-attorney.ts`). No defined vetting process, so someone could pose as an attorney. | High | Define a vetting procedure (bar lookup plus a call to the organization) in the partner terms. Log who verified whom and when. Re-verify periodically. |
| W8 | **Device and shoulder-surfing risk.** An abuser with device access may find the app, history, or an unlocked session. | High | Built: Quick Exit button and triple-Esc, 12-hour session TTL, keys held in memory only. Still to do: auto-lock on inactivity, neutral naming and icon, clearing residue on exit, browser-history guidance. Needs advocate review. |
| W9 | **No 18+ enforcement.** NJ requires anyone to report suspected child abuse (N.J.S.A. 9:6-8.10). | High | Registration affirmation plus partner-channel onboarding. Counsel to specify the wording. |
| W10 | **Ledger is tamper-evident, not tamper-proof.** The operator controls the head. A fully rewritten chain looks valid. | Med | Anchor the ledger head externally (RFC 3161 timestamps or a public transparency log). Publish heads regularly. |
| W11 | **Metadata exposure** (section 2). | Med | Minimize logs (30 days, truncated IPs), padding for record sizes, avoid storing the consent text in plaintext if the ledger hash suffices. |
| W12 | **Client-side RSA-OAEP with long-lived keys, no forward secrecy.** A compromised attorney private key exposes every record ever shared with that attorney. | Low–Med | Per-share keys or periodic rotation; attorney key hygiene in partner terms. |

## 5. Out of scope for now

Coercion of the survivor, malware on her device, a state-level adversary, and traffic analysis. Say so in user-facing documents.

## 6. Required before real data

- Close the residual W1 risks and fix W3, W4, W7, W8 and W9. Mitigate W2 or stop claiming escrow privacy. (Same list as the whitepaper's "Before any real-data pilot" roadmap.)
- Independent audit of `packages/crypto` and the server, results published.
- Incident-response plan and law-enforcement request guide.
- See the gates in [GOVERNANCE.md](../GOVERNANCE.md).
