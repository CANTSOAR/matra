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
 OPRF key holders 1..m: one Shamir share each, any t of m evaluate (in-process or separate processes, section 4a).
```
(The package names in code are currently `@matra/*`. The rename to Matra is cosmetic.)

---

## 3. Key hierarchy

```
 passphrase (never leaves device; NFKC-normalized)
    │
    ▼  PBKDF2-HMAC-SHA256, 600,000 iterations, 16-byte random per-user salt
 512-bit seed
    ├── HKDF-SHA256(info="matra/auth")    ──► authKey (256 bit) ──► sent at login
    │                                              server stores scrypt(authKey, salt)
    │                                              (N=16384, r=8, p=1) — never the authKey
    ├── HKDF-SHA256(info="matra/match-x") ──► matchKey (HMAC-SHA256, non-extractable;
    │                                              sealed-matching x-coordinates, section 4a)
    └── HKDF-SHA256(info="matra/master")  ──► masterKey (AES-256-GCM, non-extractable,
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
- **Evidentiary trade-off:** re-encoding means the stored file is a *derivative*, not the original. Its hash will not match the original file, and probative original metadata (such as capture time) is lost. Survivors must be told to **keep the original file and device**; the Evidence screen and the story space say so whenever a file is added, and the HEIC and PDF advice says to keep the original too. A future option is to also store the encrypted original, with a clear location-data warning.

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
(protocol), `packages/crypto/src/threshold.ts` (threshold OPRF), `apps/server/src/oprf.ts`, `holders.ts`,
`holder.ts` (key holders), `apps/server/src/app.ts` (`/api/matching/*`, `/api/counselor/*`),
`apps/web/src/counselor/` (counselor portal). **Not audited.**

**Parties.** Survivor client · OPRF key holders 1..m (any t of them; default 2-of-3) · app server (stores ciphertext and tags, no
secrets) · the **matcher** (decides which groups are released and to which ONE counselor, from routing data the app
server cannot read; see "Matcher" below) · verified Legal Options Counselor(s) (an RSA-OAEP-3072 identity key, like
attorneys).

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
 holder i ∈ 1..m: (E_i, π_i) = BlindEvaluate(k_i, pk_i, B)    k_i = f(i), Shamir share of k; DLEQ proof per share
 client: (t, pk, pk_1..pk_m) must equal the keys pinned in the build; refuse t ∉ [2, m], m > 16, a duplicate or
         identity pk_i, pk = identity, or share keys that are not on one degree-(t−1) polynomial through pk;
         verify each π_i against pk_i (a bad one is rejected and named); with any t valid responses S:
         λ_i = Π_{j∈S, j≠i} j/(j−i) mod ℓ;  P̂ = Finalize(input, blind, Σ λ_i·E_i) = VOPRF_k(input)
 a = HKDF(P̂, "slope"),  k = HKDF(P̂, "intercept")      (a, k ∈ F_p, p = 2^256 + 297; salt "matra/match/v2")
 τ = HKDF(I2OSP(k, 33), "tag")        K_P = HKDF(I2OSP(k, 33), "entry-key")        ← the tag is bound to the line
 x   = HMAC(matchKey, "x|τ") mod p    matchKey = HKDF(passphrase material, "matra/match-x"), non-extractable HMAC key
 y   = a·x + k mod p                              her point on this perpetrator's line
 ke  = fresh AES-256 key;  bundle  = AES-GCM(ke, pad₁ₖ(summary bundle),  AAD "bundle|τ")
                           contact = AES-GCM(ke, pad₁ₖ(contact details), AAD "contact|τ")   (staged release, below)
 ce  = AES-GCM(K_P, ke, AAD "ce|τ")
 c_j = RSA-OAEP(pk_counselor_j, kc) ‖ AES-GCM(kc, {τ, x, y, ce}, AAD "seal|τ|j")   one per counselor on the signed roster
 → server: { τ, bundle, contact, c_1..c_n, label = AES-GCM_master(pad₁ₖ({label, identifier, contact, consent, state, epoch, {τ,x,y,ce}})) }
```
`pad₁ₖ` right-pads the JSON with spaces to 1 KiB, then whole KiB, so ciphertext sizes don't reveal name or note lengths.
The summary bundle (v2) holds the identifier kind and canonical form, the incident and home states, how she'd like to
be contacted (the *methods* only: call, text, email, voicemail) and her language, and the exact consent text she agreed
to and when. Her name, number or email and note are in the separate contact-details ciphertext under the same `ke`.
(v1 bundles, sealed before staged release, held everything in one ciphertext; counselors' clients still open them.)

**Server rules.** Stores rows keyed by τ with `UNIQUE(user, τ)` (a survivor cannot match herself; her x is the same
every time she names the same person) and the OPRF key epoch. A τ is **matched** when entries from **2 distinct
accounts** exist (a single, always-executed SQL statement). Survivors always see `sealed` (no match time, no τ); her
audit trail never mentions a match or a counselor; the ledger gets exactly one `escrow.sealed` per submission. **Only
matched groups are released, each to the ONE verified counselor the matcher assigned it to, who receives only the seals
addressed to her, and only once the entries are older than the release delay** (`MATRA_MATCH_RELEASE_DELAY_HOURS`,
default 72; an entry younger than that neither counts toward nor appears in a released group; the matcher and the app
server each apply it). Unmatched entries are never served to anyone but
their owner. Counselors (and attorneys) cannot call the OPRF endpoints. With each group the server sends **Sybil
signals**, computed by the matcher without revealing accounts: whether some entries come from accounts created within 24 h of each
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

**Deploying the key holders (threshold OPRF).** The OPRF key k is Shamir-shared over the ristretto255 scalar field
among m holders, any t of whom evaluate (default 2-of-3; `MATRA_OPRF_THRESHOLD`, `MATRA_OPRF_HOLDERS`, 2 ≤ t ≤ m ≤ 16).
Verified in `threshold.test.ts`: for 2-of-3 and 3-of-5, every t-subset of holder responses gives exactly the VOPRF
output under the unsplit key, t−1 responses are refused, and a tampered evaluation or proof (or an answer under another
share's key) is rejected by index while the remaining holders still produce the right output.
- *Key ceremony (dealer, MVP).* `npm run -w @matra/server oprf-ceremony -- --threshold 2 --holders 3 --out <dir>` draws
  k, splits it, writes one 0600 file per share and prints the public part (t, m, group key, share public keys) for
  pinning. It refuses to write into the database directory. Run it offline, hand each file to a different institution,
  delete the directory. **The dealer briefly knows k**; a distributed key generation (Pedersen / GJKR DKG), in which no
  party ever holds k, is future work, as is a proactive share refresh.
- *In-process mode* (development, tests, a single-host demo): `MATRA_OPRF_SHARE_<i>` or `…_<i>_FILE` for every i (files
  must be different and **outside the database directory**). This gives **no separation against the operator**: whoever
  runs the process holds every share.
- *Remote mode*: each holder is its own process (`npm run -w @matra/server holder`, `src/holder-server.ts`) with ONE
  share, its own quota database and its own logs, ideally run by a separate institution. The app server keeps the
  browser same-origin (`connect-src 'self'`) and relays `POST /api/matching/oprf/:i` to holder i
  (`MATRA_OPRF_HOLDER_URLS`, pinned `MATRA_OPRF_SHARE_PUBKEYS`; at startup it checks each reachable holder's `/key`
  and refuses to start on a mismatch, and only warns about a holder that is down, since t of m suffice). It sees
  blinded elements and evaluations only. Each relayed call carries a holder token: Ed25519 over
  `"matra/holder-token/v1|" ‖ {sub, aud, exp, jti, bh}` with `MATRA_HOLDER_TOKEN_KEY`, where `sub` = HMAC(pepper,
  "holder-sub|" ‖ user id) (holders never see user ids), `aud` = the holder's index, `exp` = 60 s, and `bh` =
  SHA-256 of the request's blinded element. The holder pins the token public key (`MATRA_HOLDER_TOKEN_PUBKEY`), checks
  audience, expiry (at most 90 s ahead of its clock) and that `bh` matches the body, and refuses a replayed `jti` until
  the token expires. Production refuses plain `http://` to a non-loopback holder. Holder quotas are keyed by the
  holder's index **and share public key**, so a key rotation starts fresh counters at every holder.
  **The holder trusts the app server's statement that `sub` is an eligible survivor**, and accepts any well-formed
  `sub`. So whoever holds `MATRA_HOLDER_TOKEN_KEY` — the operator, or anyone who steals it from the app server — can
  mint a fresh subject per query and get unlimited proof-checked evaluations from t honest holders, then combine them:
  **a full dictionary attack on guessed phone numbers or handles, with no per-subject limit**. Remote mode turns the
  operator's *offline* attack into an *online* one that runs through the holders; it does **not** take it away.
  What the holders can do is see and bound it: each standalone holder has a global daily evaluation budget
  (`MATRA_HOLDER_DAILY_BUDGET`, default 1000/day across all subjects; it logs an alert at 80% and when spent, then
  refuses until the next UTC day) and keeps an append-only table of daily totals that its institution can compare with
  expected volume. A targeted guess about one known suspect still costs only a few requests and stays under any
  budget. Closing this needs eligibility attested by a party other than the app server — for example anonymous tokens
  (Privacy Pass style) issued by a separate issuer after phone and age verification and spent at the holders, so the
  app server cannot mint subjects — which is future work.
- *Account budget.* The app server charges each survivor account **once per distinct blinded element**, whichever
  holders it is sent to (`AccountOprfBudget`, `src/oprf.ts`; ≤ 10/day, ≤ 50 lifetime by default), before relaying.
  Per-holder counters alone would let an account send each guess to a different t-subset (2-of-3: A→{1,2}, B→{1,3},
  C→{2,3}) and get ⌊m·L/t⌋ identifiers instead of L. Charged elements are remembered as SHA-256(B) in memory for the
  UTC day only. Each holder still counts its own calls as a backstop.
- *Custody checks.* With `NODE_ENV=production` the server **refuses to start** without every share (or the full
  remote configuration) and never generates them: a key set generated next to the DB would put t shares — and so an
  offline dictionary attack over every phone number, which takes milliseconds per thousand guesses — on the same volume
  as the tags. Development deals a ceremony once into `apps/server/data/oprf-share-<i>.key` with a warning. The old
  additive keys (`MATRA_OPRF_KEY_A/B`) are a fatal startup error pointing to the ceremony.
- *Pinning and rotation.* t, the group key and the share public keys are recorded in the DB on first start; the server
  **refuses to boot if they change** unless `MATRA_OPRF_ROTATE=1` (outside production a change is treated as a rotation
  with a warning), which starts a new **key epoch** (shown in `/api/matching/config`; quotas reset). A database still
  pinned to the additive keys counts as a change. Entries carry their epoch; on her next sign-in her client re-seals
  older-epoch entries from her encrypted label (identifier, contact, consent, state) under the current keys, atomically
  replacing the old entry. Web builds pin t, the group key and the share keys (`MATRA_OPRF_THRESHOLD`,
  `MATRA_OPRF_GROUP_PUBKEY`, `MATRA_OPRF_SHARE_PUBKEYS`).
- *What colluding holders can do.* Any t holders together hold k: they can compute τ for a guessed identifier and
  confirm whether it was entered (they still cannot open bundles, which need two survivors' shares and a counselor key).
  Fewer than t learn nothing about k. Open legal questions for holder institutions: Q-016 (compelled disclosure of a
  share), Q-040 (joint administration), Q-041, in the legal research bank; nothing here answers them.

**Deviations from Callisto (P1), on purpose.** VOPRF with per-holder DLEQ proofs instead of a plain OPRF (a key holder
can't silently return wrong evaluations, research A9). τ derived from the intercept so reconstruction can verify the
line. Per-survivor-per-perpetrator x (P1 used U = H(user id) for every perpetrator, which links a survivor's entries).
P1's assignment data (DLOC) becomes a routing tag sealed to the matcher's attested key rather than to a counselor tier
(see "Matcher"). Counselor key =
RSA-OAEP identity key instead of libsodium box. Matched groups are released by the server only after threshold and the
release delay. This **mitigates, but does not close,** research A7 (a counselor holding `sk_LOC` testing guesses): a
counselor cannot call the OPRF and never receives single-survivor seals, but a counselor colluding with (or running) a
Sybil survivor account can seal a guess and see whether a group appears after the delay. **Residual risk: Sybil +
counselor collusion; needs account-level Sybil resistance (partner invite codes / anonymous credentials) before real
use.** Name-only matching dropped. The survivor keeps her label (identifier, contact, share) instead of `cU = E(kU, ke)`.

**Phone verify-then-forget (W13, W19; `apps/server/src/sms.ts`).** Before an account can call the OPRF endpoints or
lodge an entry, it confirms a phone number that can get texts (`POST /api/matching/verification/start` then `/check`;
403 `phone_not_verified` otherwise). The number is canonicalised with the same strict E.164/NANP rules as identifiers.
The challenge (number, provider reference, attempts) lives only in the app server's memory, for at most 10 minutes and
5 wrong codes (each attempt is charged before the provider is called, so concurrent checks can't exceed it). On
success the server sets `users.matching_verified = 1` (its own commit, checkpointed out of the WAL, no audit event) and
buffers `HMAC-SHA256(MATRA_PHONE_HASH_KEY, "matra/phone-token/v1|" + E.164)` in memory; the buffered counts are written
to `phone_tokens` (no user id, no timestamps, `WITHOUT ROWID`) in a separate transaction at a random 10–60 minutes
later, then checkpointed, so no single commit pairs a token with an account. The number and the code are dropped. One
phone enables at most `MATRA_SMS_MAX_ACCOUNTS_PER_PHONE` accounts (default 2, counting the buffer), checked only after
she has proved control of the phone, so it can't be used to test whether someone else's number has been used. The hash
key is held outside the database like the OPRF shares. Code requests are capped in memory: 5 per account per day, 3 per
(account, phone) per hour, 10 per client IP per hour (keyed by an HMAC of the IP under a per-process key) and a global
200 per hour / 1000 per day (503 `sms_unavailable`), and only NANP numbers are accepted by default
(`MATRA_SMS_ALLOWED_COUNTRY_CODES`), against SMS pumping. The per-phone cap is deliberately per account, so other
accounts can neither observe nor exhaust it; the provider's own per-number limits still apply across accounts (Twilio
answers 429, shown as `rate_limited`, which does reveal that the number was sent codes in the last few minutes).
Providers: a **mock** for development and demos that sends nothing and verifies nothing (the code is shown on screen;
production refuses it unless `MATRA_DEMO_MODE=1`), and a **Twilio Verify** adapter (Twilio generates and checks the
code; a Lookup line-type check that fails closed: only numbers reported as `mobile` get a code) that is written to
Twilio's published API but **has not been run against the real service**. This is friction against cheap mass
accounts, not Sybil resistance: SIM farms and a few real phones still get through, and the gate is enforced by the app
server, not by cryptography (section 5). **The phone is not unlinkable from the account:** the provider records the
number and the time, and Matra's own timestamped activity for the account (sign-ins, when it first sealed) could be
lined up with it; whoever holds the hash key and the database can test a guessed number (W19). Open questions: Q-013,
Q-038.

**Matcher (W15, W18; `apps/matcher`, `apps/server/src/matcher-client.ts`, `packages/crypto/src/attestation.ts`).** A
separate service, not the app server, decides which matched groups exist, when each is released, and which **one**
counselor gets it. It holds only entry ids, tags, a pseudonymous survivor reference (HMAC of the tag and the account id
under the app server's pepper, so it can count distinct survivors per tag without user ids, and cannot link one
survivor's entries across tags), when each entry was sealed, the **hour**
the account was created (Sybil signals), and the two states from each survivor's **routing tag**: the incident state
and her home state, taken from her record on her device. Her client seals the routing tag to the matcher's static
P-256 key with ECIES (ephemeral ECDH P-256, HKDF-SHA256 with salt = both public keys and info
`matra/matcher-routing/v1`, AES-256-GCM with AAD `routing|τ`, plaintext padded to 256 bytes): the app server stores and
forwards it but cannot open it, and cannot move it to another entry (the AAD binds τ). This is standard ECIES from
WebCrypto primitives, not RFC 9180 HPKE. Assignment is deterministic: candidate states are the group's incident states
by frequency (ties alphabetical), then its survivors' states; the first state with a counselor licensed there (the
roster's `licensedStates`, now part of the org-signed roster v2) wins, the least-loaded such counselor is chosen (ties:
lowest SHA-256(τ | counselor id)), and the reason (`incident_state:NJ`, `survivor_state:NY`, `reassigned:…`) is recorded
and shown to the counselor in plain words. If nobody is licensed in any of the group's states, the group is **not
released** (ops sees only a count, behind the matcher's token). A group in which nobody gave any state (she left both
blank, or an entry predates routing) is not dropped: it goes to the least-loaded counselor on the whole roster, reason
`fallback:no_state`. An assignment is sticky while its counselor stays on the roster, licensed there, and has not
declined; otherwise it is reassigned with her excluded. The counselor declines from her portal (a conflict of interest,
before contacting anyone); the decline is kept per τ, so it survives the group dissolving and forming again, and is
erased once no entry with that τ remains. The app server forwards entries after responding
(the same way for a match or a miss), retries every minute, queues withdrawals until the matcher has them, and caches
assignments so released groups survive a matcher outage while new groups wait for it (fail closed). It runs
in-process (development, tests, single-host demo: the app server then holds the matcher key, so there is **no
separation**) or as its own process (`npm run -w @matra/matcher start`, bearer token `MATRA_MATCHER_TOKEN`).

*Attestation (SIMULATED).* The matcher serves `GET /v1/attestation?nonce=` (proxied by the app server at
`/api/matching/attestation`): an Ed25519-signed document `{ platform, measurement, encKey, signKey, nonce, issuedAt }`.
The measurement is SHA-256 over every source file the matcher loads from this repository: `apps/matcher/src`,
`packages/crypto/src` (which opens the routing tags and verifies the roster) and `packages/shared/src` (tests excluded),
their `package.json` files, and the root `package-lock.json`, which pins every third-party dependency's version and
integrity hash (`npm run -w @matra/matcher measure` prints it for publication). Installed `node_modules`, Node.js and
the OS image are not hashed; a real platform measures the whole image. The survivor's client fetches it with a fresh nonce
**before** anything else (so a failure costs no OPRF quota), checks the platform signature, nonce, freshness (5 min)
and that the measurement equals the value pinned in the build (`MATRA_ATTESTATION_PLATFORM_PUBKEY`,
`MATRA_MATCHER_MEASUREMENT`), and only then seals the routing tag to `encKey`; otherwise she sees "This matcher isn't
running the code this app trusts" and nothing is sealed. The app server makes the same check with the same pins at
first use and every 10 minutes, and forwards nothing while it fails. **This is not attestation.** Tonight's
"platform" is a dev Ed25519 key (`MATRA_ATTESTATION_PLATFORM_KEY`) held by whoever runs the matcher, and the
measurement is computed by the matcher process from its own files: anyone holding that key can sign any measurement,
and a modified process can report the published one. It exercises the protocol so that a real platform (AWS Nitro
Enclaves: NSM document over PCR0; GCP Confidential Space: attestation token over the image digest, from a reproducible
build) becomes a verifier plus configuration (`MATRA_ATTESTATION=nitro|confidential-space` exist as stubs that refuse
to start). A production web build with no matcher pins fails to build unless `MATRA_DEMO_MODE=1` (and such a client
refuses to seal at run time): the app server proxies the attestation, so an unpinned client would seal to whatever key
it is handed. Pinned production builds refuse a `simulated` platform unless built with `MATRA_DEMO_MODE=1`; the matcher
and the app server refuse to run the simulated attester in production unless `MATRA_DEMO_MODE=1`; unpinned
development builds accept any attestation with a console warning.

*What does not change.* The app server still stores τ (it must, to serve seals), so it still sees which entries share a
τ and could still compute groups itself. What the matcher adds: routing data the app server cannot read; release and
assignment decided by published code (attested, once attestation is real); and one counselor per group instead of
all. A malicious app server can still withhold groups, or serve a released group's seals to another listed counselor
(seals exist for every counselor). The matcher signs each assignment with its attested `signKey`; the counselor's
client does **not** verify that signature yet, so re-routing is not detected (W18). Open legal questions: Q-017
(automatic assignment to one counselor), Q-035 (which state's law governs), Q-042 (an uninspectable matcher).

**Staged release (W1, W21; `apps/server/src/app.ts`, `apps/web/src/counselor`).** A released group opens in stages,
and nothing about one survivor is ever shown to another.
1. *What matched.* The assigned counselor's client opens each summary bundle: identifier, states, contact methods,
   consent. The server withholds every entry's contact-details ciphertext.
2. *Conflict check.* She checks the identifier and states against her conflicts records outside Matra and records
   "no conflict" or "conflict" (`POST /api/counselor/groups/:id/conflict-check`, statement version 1; a
   `counselor.conflict_checked` ledger row hashes group, counselor, result and version). "No conflict" makes the server
   include the contact ciphertexts from then on; "conflict" asks the matcher to reassign the group with her excluded,
   cancels her unanswered requests in it, and removes it from her list. **This gate is the server's, not the
   cryptography's:** her client already holds `ke`, so a counselor colluding with the operator could skip it (W21).
3. *A full report, only with her yes.* After the check, and only after ticking that she has already spoken with the
   survivor and the survivor expects it (so the request is never the first sign of a match), the counselor may ask that
   one survivor for her full report (`report.requested`). The survivor sees the request only in her own space, with who
   is asking and their key fingerprint (checked automatically against the org-signed roster when the build pins the
   roster key, otherwise compared by hand as for attorneys). On a yes her device wraps her latest sealed record's key,
   and any evidence keys she ticks (unticked by default), to the counselor's RSA key, and the server stores a release
   with her consent text (`report.released`, hashing the consent text, record, counselor, key fingerprint, evidence ids
   and expiry, like `share.granted`). On a no (`report.declined`) the counselor sees only the decision and cannot ask
   again. She can revoke (`report.revoked`): before the counselor first opens it, the counselor never receives it;
   after, it stops future access only. Every opening is shown in her activity. Withdrawing the entry or deleting either
   account deletes the requests and releases.
Open legal questions: Q-018 (conflict checks), Q-022, Q-023, Q-050 (revocation), Q-052 (non-consenting survivors). Schema
v9 adds the tables and bumps the key epoch, so survivors' clients re-seal old entries into the split format at their
next sign-in.

**Data migration.** Schema v5 drops all existing matching data (entries, seals, groups, counselor notes, OPRF quotas):
the tag derivation and seal format changed, old entries cannot be converted without the plaintext identifiers, and
they only ever held demo data.

**Metadata still visible to Matra.** Which accounts submitted, when, and how many entries; the τ equality classes
(how many survivors named the same, unknown, person — including groups of one); that a group matched and when;
each entry's key epoch and which counselors it is sealed to; which counselor each released group was assigned to and
why (the reason names a state, so the app server learns the state of released groups; it never stores per-entry
states); OPRF quota counters (the account-level budget always;
per-holder counters in in-process mode, while in remote mode each holder keeps its own counters under a pseudonymous
subject, plus its daily totals); counselor note counts and times; for each group, when its counselor recorded her conflict check and the result; each
report request, its status and times, and each release (survivor, counselor, record, consent text, first-opened and
revoked times; the report itself stays ciphertext wrapped to the counselor); whether an account confirmed a phone, and keyed
phone hashes with counts (no account id; linkable by time together with the SMS provider's records, W19).

---

## 5. Threat model

Notation: ✅ protected in MVP · ⚠️ partially protected · ❌ not protected.

| Adversary / scenario | What they can do | Status | Notes and mitigations |
|---|---|---|---|
| **Server database leak / stolen backup** | Read all tables | ✅ content · ⚠️ metadata | Content is AES-256-GCM ciphertext. Exposed metadata includes usernames, record and blob counts and sizes, timestamps, share relationships, the plaintext survivor alias, attorney and counselor profiles, sealed-match tags and match state, and audit text. scrypt hashes protect authKeys, and the 600k PBKDF2 slows offline passphrase guessing. **Weak passphrases remain guessable** (enforce length, and suggest a diceware phrase). |
| **Subpoena or warrant to Matra** | Compel production | ✅ content · ⚠️ metadata | Matra cannot produce plaintext. It *can* produce the metadata above. See Legal Memo §2. The survivor herself can still be compelled. |
| **Compromised or malicious server (code, active attacker)** | Serve modified JavaScript; substitute keys | ❌ | **The central limitation of any web-based end-to-end encryption.** A malicious build can capture the passphrase. A malicious server can also return an **attacker-controlled "attorney" public key**, so the survivor encrypts to the attacker. Mitigations: publish build hashes and use subresource integrity; an out-of-band **key-fingerprint check** (**done** in the UI: the share screen shows the attorney's fingerprint, she must tick that it matches what the attorney read to her before she can share, and the fingerprint is in the consent statement; an independent verification path through the attorney's organization is still to do); later, key transparency, a signed desktop or mobile app, and reproducible builds. |
| **Matching: dictionary attack on identifiers** (operator / DB thief) | Test whether a known phone number or handle was entered | ✅ DB thief · ❌ operator (both modes) | The DB holds only τ (derived from VOPRF_k(id), k Shamir-shared t-of-m); computing τ for a guess needs **t** key shares — with them, a thousand phone numbers take milliseconds. Production refuses to start unless every share comes from the environment or from files **outside** the DB directory (or the holders are remote), and never generates them, so a DB volume copy or backup holds none. **The operator can still test guesses in both modes.** In in-process mode it holds every share (offline attack). In remote mode it holds the holder-token key, so it can mint fresh subjects and query t honest holders without any per-subject limit (online attack, section 4a); the holders' global daily budget and append-only daily totals make mass querying visible and bounded, but a few targeted guesses about a known suspect are not. Closing it needs eligibility attested by someone other than the app server (anonymous tokens from a separate issuer). An honest server charges each survivor account one evaluation per guess, whichever holders answer. |
| **Matching: perpetrator probing (self-check)** | Register as a "survivor", seal his own identifiers, see if they matched | ✅ **mitigated** · ⚠️ residual | Survivors only ever see `sealed`; no match time, τ, ledger entry, or audit text reveals a match; counselor views are never logged to a survivor. Attorneys no longer see counts either. **Residual:** a counselor who contacts him (because his fake entry matched) reveals the match — hence the counselor's plausibility check and the instruction never to confirm who else was named. |
| **Matching: Sybil / framing / decoys** | Create accounts that name a target to force a "match" and expose a real survivor's contact bundle to the counselor; or seal a decoy line under the real τ to hide real reports | ⚠️ (decoys ✅) | Threshold counts distinct **accounts**, not people. Decoy lines can no longer hide real reports (τ is bound to the line's intercept, every entry is opened with K_P, all pairs are tried, extra lines raise an alert). Mitigations: verified-adult survivor accounts only, an SMS-confirmed phone per account with at most 2 accounts per phone (verify-then-forget; friction, not proof of a distinct person), OPRF + entry rate limits, a 72 h release delay, Sybil signals (accounts created within 24 h of each other / < 7 days before sealing) shown to the counselor, a human counselor who reviews plausibility before any contact, and contact only on the survivor's terms. **Residual:** accounts still cost only a phone per two (SIM farms, a few real phones; the mock provider in demos verifies nothing); once one OPRF evaluation yields τ for a target, further accounts can reuse τ without more evaluations. Needs account verification (partner invite codes / anonymous credentials) before real data. |
| **Matching: colluding key holders** | t holders (or one operator running them all in-process) combine shares | ❌ in-process · ⚠️ remote | Any t shares give k: the colluders can compute τ for any guess and confirm whether it was entered (but still cannot open bundles: those need two survivors' shares and a counselor key). t−1 learn nothing. The dealer of the MVP ceremony briefly knew k. Fix: independent operators in remote mode, a DKG instead of a dealer, HSM/KMS custody, audit logs on every holder. |
| **Matching: malicious key holder** | Return a wrong evaluation to block matches or tag a user; present degenerate keys | ✅ | VOPRF DLEQ proofs are verified per holder against its own share key; a bad evaluation is rejected and named — also when t others are valid and sealing goes ahead (the client logs the holder index; there is no report channel to the operator yet) — and the remaining holders are used if t are still valid (fewer: nothing is sealed). Production builds pin t, the group key and every share key; the client refuses duplicate or identity share keys, an identity group key, and share keys inconsistent with the group key. The server records the key set and refuses to boot on a silent change (explicit rotation → new epoch → clients re-seal). A holder that refuses to answer only costs availability while t others answer. |
| **Matching: malicious app server** | Release unmatched entries, swap counselor keys, drop entries | ⚠️ | The server can withhold or delete entries (availability). It could hand a counselor unmatched seals, but a single share reveals nothing about k (the per-perpetrator 2-survivor line, not the OPRF key) — the counselor still needs two survivors' points. Substituting a counselor public key it controls (and then reconstructing any τ with two entries) is **blocked when the build pins the organization's roster key**: survivors seal only to counselors in the org-signed roster, with the listed key. Residual: development builds without a pinned key trust the server's list. Seals are bound to τ and the counselor id by AAD. |
| **Matching: counselor insider** | Counselor misuses matched contact details, tries to open unmatched entries, or tests guesses with a Sybil survivor account | ⚠️ | Counselors receive only matched groups and only seals addressed to them; they cannot call the OPRF themselves. Research A7 is **mitigated, not closed**: a counselor colluding with (or running) a Sybil survivor account can seal a guess and see whether a group appears; the 72 h release delay, OPRF quotas and Sybil signals slow and flag this. **Residual risk: Sybil + counselor collusion; needs account-level Sybil resistance before real use.** They do see contact details of matched survivors: vetting, contract, ethics rules, and per-counselor seals (removing a counselor from the roster deletes their seals). Roadmap: threshold-split counselor key, decryption logging on a separate system. |
| **Matching: linkability of tags** | Learn that entries are about the same (unknown) person | ⚠️ inherent | τ is deterministic per identifier, so the server sees equality classes and cluster sizes, including below threshold (Callisto has the same leak; MPC designs like SAE/WhoToo avoid it at much higher cost). τ does not link a survivor's entries about *different* people (x is per-perpetrator), and the ledger never contains τ. |
| **Matching: false matches** | Recycled numbers, shared emails, common handles on other apps | ⚠️ | Names are excluded entirely; handles are platform-qualified; phones are E.164. A match is a lead for a counselor conversation, not evidence. |
| **Abusive partner with device access** | Browse history; open the app; coerce the passphrase | ⚠️ | Quick Exit button and triple-Esc replace the page. A 12-hour session TTL and server-side logout apply, and the client **auto-locks after 15 minutes of inactivity** (**done**: keys, session and drafts are dropped from memory). **Residue:** browser history, downloaded PDFs, and an un-expired session token may remain (the summary and VCCO download buttons and "Download my data" warn that downloaded files are not encrypted). Roadmap: no-download "view only" mode, clearing local storage on exit, and safety-planning guidance (private browsing, safe device). **Coercion of the passphrase cannot be defended against cryptographically.** A duress or decoy vault is risky and needs advocate input before it is built. |
| **Malicious or compromised attorney account** | Read shared records; exfiltrate them | ⚠️ | Only **verified** attorneys can receive shares (an admin CLI sets verification today). Every open and download is written to the survivor's visible audit log. **Revocation stops future server fetches but cannot recall plaintext already downloaded.** Mitigations: identity and bar verification procedures (see MOU), share expiry (**done**: default 90 days, she can choose 30 days to 1 year, renewal keeps her chosen length), scoped shares, MFA and passkeys for attorneys, and partner agreements with breach duties. |
| **Insider (Matra staff)** | Database access; deploy code | ⚠️ | Same as a database leak plus the malicious-code risk. Mitigations: two-person code review and deploy, least-privilege production access, audit of admin actions (attorney verification), and a published security policy. |
| **Network attacker** | Intercept traffic | ✅ (with TLS) | TLS is required in deployment, along with HSTS. Even under TLS interception, payloads are already end-to-end encrypted. Login is protected by the derived authKey (the passphrase is never sent). |
| **Account takeover by guessing** | Online guessing | ⚠️ | Login rate limits are 10/min per username and 60/min per IP (in-memory, single process), and failed attempts are written to the user's audit log. Roadmap: persistent limiter, passkeys, alerts. |
| **Denial / destruction** | Delete data | ⚠️ | Records cannot be deleted except by the owner's crypto-shred. There is no server-side backup strategy yet. Define backup encryption and retention before the pilot. |

---

## 6. Roadmap

**Before any real-data pilot (blocking)**
1. **Sealed matching:** ~~hide match status from users~~ (**done**) · ~~split-key VOPRF, threshold-2 Shamir shares, counselor-only release of matched groups, OPRF rate limits, Legal Options Counselor role~~ (**done**, section 4a). ~~decoy-line-proof reconstruction, allow-list profile parsing, key pinning (holder keys + org-signed counselor roster), key-epoch re-sealing, release delay + Sybil signals, production key custody checks~~ (**done**, security review 2026-10). ~~t-of-m threshold OPRF with standalone holder processes, holder tokens and per-holder quota stores~~ (**done**, section 4a). Still to do before real data: run the holders at independent institutions (and replace the dealer ceremony with a DKG); set the build-time pins in every production build; account-level Sybil resistance (the release delay and signals only slow and flag Sybil + counselor guessing); a counselor vetting procedure and contract; an external cryptographic review of the protocol. Until then, keep matching **demo-only**.
2. **Independent security audit** of the crypto library, server, and web client. Commission a penetration test.
3. **Client integrity:** published build hashes, SRI, a strict CSP (**done** for production serving: same-origin only, no inline script or eval; see DEPLOY.md), and an attorney key-fingerprint check in the UI (**done**, manual: see section 5).
4. ~~**Share expiry** (VAWA "reasonably time-limited" consent)~~ (**done**: default 90 days, renewable, length in the consent text and ledger hash). Still to do: MFA or passkeys for attorneys, and a documented attorney-verification procedure.
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
- "Anything you give police will be shared with the defense."
- "Every saved version is kept. If you're ever asked to hand over your records, that can include earlier versions."
- "Matra knows that your account exists and when you used it. It doesn't know what you wrote."
- "When you share with a lawyer, they can read and save what you shared. Turning off sharing stops new access, but it can't erase what they already saved."
- "If someone controls your phone or computer, they may be able to see what you do. Use a safe device."
- "If you choose a sealed match, this app will always show it as sealed. If someone else names the same person, only a Legal Options Counselor sees the match. The counselor is a licensed attorney — not the police, not your school — and would reach out to you once, privately, by the way you chose. A match is a lead, not evidence. You can say no, and there's no follow-up after a no. There are no fees. Names aren't unique enough to match safely, so only an email, phone number or social media profile is used. You can withdraw it at any time." (The full consent text she agrees to is `MATCHING_CONSENT_LINES` in `apps/web/src/lib/disclosures.ts`. It also says that, in this test version, the people who run Matra could check whether a particular identifier was sealed; see threat model W2/W14.)
- "If there may be a legal case, talk to a lawyer before you delete anything." (shown on the "Delete everything" screen, with what is and isn't deleted)

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
