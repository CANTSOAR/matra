# Matra: Security Whitepaper (MVP)

**Status:** describes the MVP as implemented in `packages/crypto`, `packages/shared`, and `apps/server` as of 2026-10-06 (sealed matching, section 4a: 2026-10-07). **No independent security audit has been performed.** Matra must not be used with real survivor data until the "Before any real-data pilot" items in section 8 are complete.

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
 │ Story space (on-device voice  │                  │ users: username, role, scrypt   │
 │ & suggestions)→ IntakeRecord  │                  │   (authKey), kdf salt, RSA pub, │
 │                               │   ciphertext +   │   wrapped RSA priv              │
 │ @matra/crypto (WebCrypto)     │   wrapped keys   │ records / blobs: ciphertext     │
 │  • derive keys from passphrase├─────────────────►│ shares: recipient-wrapped keys, │
 │  • AES-256-GCM encrypt        │     (TLS)        │   consent text, alias, status   │
 │  • strip image EXIF/GPS       │                  │ matching: tag π + sealed shares │
 │  • PDF brief generated locally│◄─────────────────┤ ledger: append-only hash chain  │
 └───────────────────────────────┘   ciphertext     │ audit_events: per-user log      │
                                                    └─────────────────────────────────┘
 Attorney browser: same crypto library; decrypts only what was re-wrapped to its RSA key.
 Counselor browser: same library; opens only MATCHED sealed-match groups (section 4a).
 OPRF key holders A and B: one key share each (in-process for the MVP; separable, section 4a).
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
- Account deletion crypto-shreds the account (ciphertext, keys, shares, sealed-match entries and OPRF quota rows, audit), with `secure_delete` on. Ledger rows (IDs, hashes, timestamps) remain, and an `account.shredded` entry is appended.
- Sealed matching writes exactly **one** ledger entry per submission (`escrow.sealed`, hashing the random contact-bundle ciphertext, never the matching tag). There is deliberately **no `escrow.matched` entry**: writing one at match time would let anyone watching `GET /api/ledger/head` see the sequence number jump after a submission and infer a match. The match time is kept only in the database (`match_groups.matched_at`). Withdrawals write no ledger entry.

**What the ledger proves, and what it does not**
- It **does** show internal consistency: no entry has been altered or removed *relative to the current head*.
- It **does not** stop the operator from rewriting the entire chain and recomputing every hash, because the operator controls the database and the clock. Until the head hash is anchored externally (section 6), a court has to trust the operator's testimony about its timestamps.
- Ledger hashes cover **ciphertext**. To connect ciphertext to plaintext, the key holder decrypts and shows that the stored plaintext hash matches. AES-GCM is **not key-committing**, so a party who controls keys could in theory craft a ciphertext that decrypts to different plaintexts under different keys. **Roadmap:** add a salted plaintext commitment to sealed records, or use a key-committing AEAD construction.

---

## 4a. Sealed matching (Callisto-style)

Replaces the earlier demo-only "blind escrow" (client PBKDF2 hash + server HMAC pepper), which the pepper holder could
brute-force. The design follows Rajan, Qin, Archer, Boneh, Lepoint, Varia, *Callisto*, COMPASS 2018, reimplemented
from the paper (no AGPL code copied) with modern standard primitives. Code: `packages/crypto/src/matching.ts`
(protocol), `apps/server/src/oprf.ts` (key holders), `apps/server/src/app.ts` (`/api/matching/*`, `/api/counselor/*`),
`apps/web/src/counselor/` (counselor portal). **Not audited.**

**Parties.** Survivor client · OPRF key holder A · OPRF key holder B · app server (stores ciphertext and tags, no
secrets) · verified Legal Options Counselor(s) (an RSA-OAEP-3072 identity key, like attorneys).

**What can be matched.** Only unique identifiers, canonicalised on the device (`packages/crypto/src/normalize.ts`):
email (lower-case; trailing dot removed; internationalised domains converted to punycode; `+tag` removed **only** for
providers known to support plus-addressing — Gmail/Googlemail, Outlook/Hotmail/Live/MSN, iCloud, Fastmail, Proton;
Gmail dots removed; quoted or non-ASCII local parts refused), phone (E.164; letters refused except a trailing `ext`/`x`
extension; `(0)` after a country code dropped; `+1` and un-prefixed 10-digit numbers must be valid NANP
`[2-9]XX[2-9]XXXXXX` — nothing else is assumed to be `+1`), and social profiles. Profile URLs are parsed with a
**per-host allow-list** of the path shapes that name one person (e.g. `instagram.com/<handle>` and `/_u/<handle>`,
`facebook.com/<username>`, `profile.php?id=N`, `/people/<name>/<id>`, `/messages/t/<id>`, `x.com/<handle>`,
`tiktok.com/@<handle>`, `snapchat.com/add/<name>`, `[cc.]linkedin.com/in/<handle>`; host prefixes `www.`, `m.`,
`mobile.`, `mbasic.`, `web.`, `touch.` and country subdomains); every other path (share links, stories/highlights,
reels, posts, groups, pages, events, messages lists, `*.php` other than `profile.php`, link shims …) is refused with
"That link doesn’t point to one person’s profile — try their profile page or @handle", and short links (`vm.tiktok.com`,
`fb.me`, …) are refused because they can't be resolved offline. This replaced a reserved-path deny-list that turned
share/messenger/stories links into "magnet" canonicals (`instagram:share`, `facebook:messages`, …) that would match
unrelated reports; the test suite carries a denylist of such canonicals and fuzzes >10,000 non-profile URLs against it.
**Names and free text are never matched**: `full_name` → `name_not_unique`, and the "anything else that identifies
them" field (`other`) → `not_supported` — the normalizer, the intake opt-in logic and `lodgeEscrow` all refuse them.

**Submission** (threshold t = 2, one entry per identifier):
```
 x_id  = canonical identifier, e.g. "instagram:bad_guy"
 input = "matra/match/v2|" || x_id
 client: (blind, B) = VOPRF.Blind(input)                                 RFC 9497, ristretto255-SHA512, mode 0x01
 A: (E_A, π_A) = BlindEvaluate(k_A, pk_A, B)   B: (E_B, π_B) = BlindEvaluate(k_B, pk_B, B)   (DLEQ proofs)
 client: pk_A, pk_B must equal the keys pinned in the build; refuse pk_A = pk_B, an identity key, or pk_A + pk_B = 0;
         verify π_A against pk_A and π_B against pk_B; P̂ = Finalize(input, blind, E_A + E_B) = VOPRF_{k_A+k_B}(input)
 a = HKDF(P̂, "slope"),  k = HKDF(P̂, "intercept")      (a, k ∈ F_p, p = 2^256 + 297; salt "matra/match/v2")
 τ = HKDF(I2OSP(k, 33), "tag")        K_P = HKDF(I2OSP(k, 33), "entry-key")        ← the tag is bound to the line
 x   = HMAC(matchKey, "x|τ") mod p    matchKey = HKDF(passphrase material, "matra/match-x"), non-extractable HMAC key
 y   = a·x + k mod p                              her point on this perpetrator's line
 ke  = fresh AES-256 key;  bundle = AES-GCM(ke, pad₁ₖ(contact bundle), AAD "bundle|τ")
 ce  = AES-GCM(K_P, ke, AAD "ce|τ")
 c_j = RSA-OAEP(pk_counselor_j, kc) ‖ AES-GCM(kc, {τ, x, y, ce}, AAD "seal|τ|j")   one per counselor on the signed roster
 → server: { τ, bundle, c_1..c_n, label = AES-GCM_master(pad₁ₖ({label, identifier, contact, consent, state, epoch, {τ,x,y,ce}})) }
```
`pad₁ₖ` right-pads the JSON with spaces to 1 KiB, then whole KiB, so ciphertext sizes don't reveal name or note lengths.
The contact bundle holds how she'd like to be contacted (method, number or email, safe times, name, language), the
exact consent text she agreed to and when, the identifier kind and canonical form, and an optional state.

**Server rules.** Stores rows keyed by τ with `UNIQUE(user, τ)` (a survivor cannot match herself; her x is the same
every time she names the same person) and the OPRF key epoch. A τ is **matched** when entries from **2 distinct
accounts** exist (a single, always-executed SQL statement). Survivors always see `sealed` (no match time, no τ); her
audit trail never mentions a match or a counselor; the ledger gets exactly one `escrow.sealed` per submission. **Only
matched groups are released, only to verified counselors, each receives only the seals addressed to them, and only
once the entries are older than the release delay** (`MATRA_MATCH_RELEASE_DELAY_HOURS`, default 72; an entry younger
than that neither counts toward nor appears in a released group). Unmatched entries are never served to anyone but
their owner. Counselors (and attorneys) cannot call the OPRF endpoints. With each group the server sends **Sybil
signals** computed without revealing accounts: whether some entries come from accounts created within 24 h of each
other, and how many were sealed < 7 days after account creation; the portal shows them as a warning. A survivor can
**withdraw** any entry at any time (`DELETE /api/matching/entries/:id` deletes it, its seals and counselor notes about
it); groups with no entries left are deleted with all their counselor notes (also on account deletion).

**OPRF access.** Only verified-adult survivor accounts (`age_confirmed_18`), rate-limited **per account and per key
holder**: ≤ 10 evaluations per UTC day and ≤ 50 in total by default (`MATRA_OPRF_PER_DAY`, `MATRA_OPRF_LIFETIME`); each
identifier costs one evaluation at each holder. Only a day and two counters are stored (no per-call timestamps).
Entries per account are also capped at the lifetime limit.

**Reveal (counselor device).** Open the seals → (x_i, y_i, ce_i). For **every** pair with distinct x, interpolate the
line; keep only lines whose intercept k reproduces τ = HKDF(I2OSP(k,33)). Derive K_P from that k and open **every**
entry's ce and bundle with it directly (not only the points on one line). Consequence: a *decoy line* — two Sybil
accounts sealing points on a fake line under the real τ (possible for anyone who can compute τ for his own identifier) —
is never accepted as the key and cannot hide the real reports, whatever order the entries arrive in (review H1; the
previous "first pair that opens" rule let a decoy hide every real report). The result carries **alerts**, shown
prominently in the portal ("Possible decoy or tampering — do not contact anyone until you have checked this group"):
more than one verified line, a self-consistent foreign line, a point off the main line, a duplicated share, or bundles
naming different identifiers. Bundles are de-duplicated by x and the "N people" badge counts only verified distinct
survivors. Every card shows the canonical identifier its bundle names, and warns if the card's own contact details are
that identifier. The τ inside each seal (and in its AAD) must equal the group's τ, so the server cannot move seals
between groups. The portal shows each survivor's contact preferences **separately**, an ethics banner (independent of
schools and police; never reveal one survivor to another without both consenting; a match is a lead, not evidence; do
plausibility checks before confirming anything; be wary of a card whose contact is the named identifier), and encrypted
outreach notes (encrypted under the counselor's own master key).

**Counselor roster (organization-signed).** The counselors a survivor seals to come from a roster signed offline by the
organization's Ed25519 key (`npm run -w @matra/server sign-roster`; the org secret key is supplied only to that command,
never stored on the server). The server serves the signed roster in `/api/matching/config`; the web build pins the org
public key (`MATRA_COUNSELOR_ROSTER_PUBKEY`), and the client seals **only** to counselors listed in a validly signed
roster with exactly the listed RSA key — the app server cannot add a counselor or swap a counselor's key. With a roster
stored, the server also accepts seals only for listed, verified counselors and deletes seals for anyone removed.
Development builds without a pinned key trust the server's list and log a warning. Operational model: the person who
verifies counselors holds the org key (ideally offline / on a hardware token); after verifying or removing a counselor
they run `sign-roster` against the production DB (or a maintenance shell) and the key never leaves their machine.
On each sign-in, her client compares every entry's counselors with the current roster and adds seals for new ones from
the share kept in her encrypted label (`POST /api/matching/entries/:id/seals`, owner-only); a group is released to a
counselor once ≥ 2 entries hold a seal for that counselor, so release converges as survivors sign in. Up to 200
counselors per entry.

**Deploying the key holders.** k = k_A + k_B (additive 2-of-2; verified in `matching.test.ts`: Σ evaluations then
Finalize equals one evaluation under k_A + k_B). Keys: `MATRA_OPRF_KEY_A` / `MATRA_OPRF_KEY_B` (64 hex, or any ≥ 32-char
secret from which the key is derived) or `…_FILE` paths **outside the database directory**. With `NODE_ENV=production`
the server **refuses to start** without both and never generates them (a key generated next to the DB would put both
shares — and so an offline dictionary attack over every phone number, which takes milliseconds per thousand guesses —
on the same volume as the tags). Dev keys are generated once into `apps/server/data/oprf-key-{a,b}.key`. The holder
public keys are recorded in the DB on first start; the server **refuses to boot if they change** unless
`MATRA_OPRF_ROTATE=1`, which starts a new **key epoch** (shown in `/api/matching/config`; quotas reset). Entries carry
their epoch; on her next sign-in her client re-seals older-epoch entries from her encrypted label (identifier, contact,
consent, state) under the current keys, atomically replacing the old entry. Web builds pin both holder keys
(`MATRA_OPRF_PUBKEY_A/B`). In the MVP both holders run inside the API process at `/api/matching/oprf-a` and
`/api/matching/oprf-b` with separate keys and separate quota counters, which gives **no real separation against the
operator**. For production: run holder B as its own service on a different host and cloud, ideally operated by a
separate organisation (partner legal-aid group or university lab), generating and backing up its own key; the app
server issues a short-lived signed token per survivor request that each holder verifies and rate-limits against.

**Deviations from Callisto (P1), on purpose.** VOPRF with per-holder DLEQ proofs instead of a plain OPRF (a key holder
can't silently return wrong evaluations, research A9). τ derived from the intercept so reconstruction can verify the
line. Per-survivor-per-perpetrator x (P1 used U = H(user id) for every perpetrator, which links a survivor's entries).
No separate assignment-data / DLOC ciphertext (one counselor tier; `state` rides inside the bundle). Counselor key =
RSA-OAEP identity key instead of libsodium box. Matched groups are released by the server only after threshold and the
release delay. This **mitigates, but does not close,** research A7 (a counselor holding `sk_LOC` testing guesses): a
counselor cannot call the OPRF and never receives single-survivor seals, but a counselor colluding with (or running) a
Sybil survivor account can seal a guess and see whether a group appears after the delay. **Residual risk: Sybil +
counselor collusion; needs account-level Sybil resistance (partner invite codes / anonymous credentials) before real
use.** Name-only matching dropped. The survivor keeps her label (identifier, contact, share) instead of `cU = E(kU, ke)`.

**Data migration.** Schema v5 drops all existing matching data (entries, seals, groups, counselor notes, OPRF quotas):
the tag derivation and seal format changed, old entries cannot be converted without the plaintext identifiers, and
they only ever held demo data.

**Metadata still visible to Matra.** Which accounts submitted, when, and how many entries; the τ equality classes
(how many survivors named the same, unknown, person — including groups of one); that a group matched and when;
each entry's key epoch and which counselors it is sealed to; OPRF quota counters; counselor note counts and times.

---

## 5. Threat model

Notation: ✅ protected in MVP · ⚠️ partially protected · ❌ not protected.

| Adversary / scenario | What they can do | Status | Notes and mitigations |
|---|---|---|---|
| **Server database leak / stolen backup** | Read all tables | ✅ content · ⚠️ metadata | Content is AES-256-GCM ciphertext. Exposed metadata includes usernames, record and blob counts and sizes, timestamps, share relationships, the plaintext survivor alias, attorney and counselor profiles, sealed-match tags and match state, and audit text. scrypt hashes protect authKeys, and the 600k PBKDF2 slows offline passphrase guessing. **Weak passphrases remain guessable** (enforce length, and suggest a diceware phrase). |
| **Subpoena or warrant to Matra** | Compel production | ✅ content · ⚠️ metadata | Matra cannot produce plaintext. It *can* produce the metadata above. See Legal Memo §2. The survivor herself can still be compelled. |
| **Compromised or malicious server (code, active attacker)** | Serve modified JavaScript; substitute keys | ❌ | **The central limitation of any web-based end-to-end encryption.** A malicious build can capture the passphrase. A malicious server can also return an **attacker-controlled "attorney" public key**, so the survivor encrypts to the attacker. Mitigations: publish build hashes and use subresource integrity; offer an out-of-band **key-fingerprint check** (`publicKeyFingerprint()` already exists; surface it in the UI); later, key transparency, a signed desktop or mobile app, and reproducible builds. |
| **Matching: dictionary attack on identifiers** (operator / DB thief) | Test whether a known phone number or handle was entered | ✅ DB thief · ⚠️ operator | The DB holds only τ (derived from VOPRF_{k_A+k_B}(id)); computing τ for a guess needs **both** key shares — with both, a thousand phone numbers take milliseconds. Production refuses to start unless both shares come from the environment or from files **outside** the DB directory, and never generates them, so a DB volume copy or backup holds neither. **In the MVP the operator runs both holders**, so the operator can still test guesses until holder B is run by a separate party (section 4a). Each guess through the API costs one rate-limited evaluation per holder. |
| **Matching: perpetrator probing (self-check)** | Register as a "survivor", seal his own identifiers, see if they matched | ✅ **mitigated** · ⚠️ residual | Survivors only ever see `sealed`; no match time, τ, ledger entry, or audit text reveals a match; counselor views are never logged to a survivor. Attorneys no longer see counts either. **Residual:** a counselor who contacts him (because his fake entry matched) reveals the match — hence the counselor's plausibility check and the instruction never to confirm who else was named. |
| **Matching: Sybil / framing / decoys** | Create accounts that name a target to force a "match" and expose a real survivor's contact bundle to the counselor; or seal a decoy line under the real τ to hide real reports | ⚠️ (decoys ✅) | Threshold counts distinct **accounts**, not people. Decoy lines can no longer hide real reports (τ is bound to the line's intercept, every entry is opened with K_P, all pairs are tried, extra lines raise an alert). Mitigations: verified-adult survivor accounts only, OPRF + entry rate limits, a 72 h release delay, Sybil signals (accounts created within 24 h of each other / < 7 days before sealing) shown to the counselor, a human counselor who reviews plausibility before any contact, and contact only on the survivor's terms. **Residual:** account creation is cheap (self-attested 18+); once one OPRF evaluation yields τ for a target, further accounts can reuse τ without more evaluations. Needs account verification (partner invite codes / anonymous credentials) before real data. |
| **Matching: colluding key holders** | Holders A and B (or one operator running both) combine keys | ❌ in MVP | With k_A + k_B the colluders can compute τ for any guess and confirm whether it was entered (but still cannot open bundles: those need two survivors' shares and a counselor key). Fix: independent operators, HSM/KMS custody, audit logs on both holders. |
| **Matching: malicious key holder** | Return a wrong evaluation to block matches or tag a user; present degenerate keys | ✅ | VOPRF DLEQ proofs are verified per holder against its published key; a bad evaluation makes the client refuse. Production builds pin both public keys (`MATRA_OPRF_PUBKEY_A/B`); the client refuses pk_A = pk_B, identity keys and pk_A + pk_B = 0. The server records the keys and refuses to boot on a silent change (explicit rotation → new epoch → clients re-seal). |
| **Matching: malicious app server** | Release unmatched entries, swap counselor keys, drop entries | ⚠️ | The server can withhold or delete entries (availability). It could hand a counselor unmatched seals, but a single share reveals nothing about k (2-of-2 Shamir) — the counselor still needs two survivors' points. Substituting a counselor public key it controls (and then reconstructing any τ with two entries) is **blocked when the build pins the organization's roster key**: survivors seal only to counselors in the org-signed roster, with the listed key. Residual: development builds without a pinned key trust the server's list. Seals are bound to τ and the counselor id by AAD. |
| **Matching: counselor insider** | Counselor misuses matched contact details, tries to open unmatched entries, or tests guesses with a Sybil survivor account | ⚠️ | Counselors receive only matched groups and only seals addressed to them; they cannot call the OPRF themselves. Research A7 is **mitigated, not closed**: a counselor colluding with (or running) a Sybil survivor account can seal a guess and see whether a group appears; the 72 h release delay, OPRF quotas and Sybil signals slow and flag this. **Residual risk: Sybil + counselor collusion; needs account-level Sybil resistance before real use.** They do see contact details of matched survivors: vetting, contract, ethics rules, and per-counselor seals (removing a counselor from the roster deletes their seals). Roadmap: threshold-split counselor key, decryption logging on a separate system. |
| **Matching: linkability of tags** | Learn that entries are about the same (unknown) person | ⚠️ inherent | τ is deterministic per identifier, so the server sees equality classes and cluster sizes, including below threshold (Callisto has the same leak; MPC designs like SAE/WhoToo avoid it at much higher cost). τ does not link a survivor's entries about *different* people (x is per-perpetrator), and the ledger never contains τ. |
| **Matching: false matches** | Recycled numbers, shared emails, common handles on other apps | ⚠️ | Names are excluded entirely; handles are platform-qualified; phones are E.164. A match is a lead for a counselor conversation, not evidence. |
| **Abusive partner with device access** | Browse history; open the app; coerce the passphrase | ⚠️ | Quick Exit button and triple-Esc replace the page. A 12-hour session TTL and server-side logout apply. **Residue:** browser history, downloaded PDFs, and an un-expired session token may remain. Roadmap: auto-lock on inactivity, no-download "view only" mode, clearing local storage on exit, and safety-planning guidance (private browsing, safe device). **Coercion of the passphrase cannot be defended against cryptographically.** A duress or decoy vault is risky and needs advocate input before it is built. |
| **Malicious or compromised attorney account** | Read shared records; exfiltrate them | ⚠️ | Only **verified** attorneys can receive shares (an admin CLI sets verification today). Every open and download is written to the survivor's visible audit log. **Revocation stops future server fetches but cannot recall plaintext already downloaded.** Mitigations: identity and bar verification procedures (see MOU), share expiry, scoped shares, MFA and passkeys for attorneys, and partner agreements with breach duties. |
| **Insider (Matra staff)** | Database access; deploy code | ⚠️ | Same as a database leak plus the malicious-code risk. Mitigations: two-person code review and deploy, least-privilege production access, audit of admin actions (attorney verification), and a published security policy. |
| **Network attacker** | Intercept traffic | ✅ (with TLS) | TLS is required in deployment, along with HSTS. Even under TLS interception, payloads are already end-to-end encrypted. Login is protected by the derived authKey (the passphrase is never sent). |
| **Account takeover by guessing** | Online guessing | ⚠️ | Login rate limits are 10/min per username and 60/min per IP (in-memory, single process), and failed attempts are written to the user's audit log. Roadmap: persistent limiter, passkeys, alerts. |
| **Denial / destruction** | Delete data | ⚠️ | Records cannot be deleted except by the owner's crypto-shred. There is no server-side backup strategy yet. Define backup encryption and retention before the pilot. |

---

## 6. Roadmap

**Before any real-data pilot (blocking)**
1. **Sealed matching:** ~~hide match status from users~~ (**done**) · ~~split-key VOPRF, threshold-2 Shamir shares, counselor-only release of matched groups, OPRF rate limits, Legal Options Counselor role~~ (**done**, section 4a). ~~decoy-line-proof reconstruction, allow-list profile parsing, key pinning (holder keys + org-signed counselor roster), key-epoch re-sealing, release delay + Sybil signals, production key custody checks~~ (**done**, security review 2026-10). Still to do before real data: run OPRF holder B as an independent service/organisation with its own token-based auth and quota store; set the build-time pins in every production build; account-level Sybil resistance (the release delay and signals only slow and flag Sybil + counselor guessing); a counselor vetting procedure and contract; an external cryptographic review of the protocol. Until then, keep matching **demo-only**.
2. **Independent security audit** of the crypto library, server, and web client. Commission a penetration test.
3. **Client integrity:** published build hashes, SRI, a strict CSP (**done** for production serving: same-origin only, no inline script or eval; see DEPLOY.md), and an attorney key-fingerprint check in the UI.
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
- "If you choose a sealed match, this app will always show it as sealed. If someone else names the same person, a trained legal options counselor — not the police, not your school — will reach out privately to talk about your options. You decide everything after that. Names aren't unique enough to match safely, so only an email, phone number or social media profile is used. You can withdraw it at any time."

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
