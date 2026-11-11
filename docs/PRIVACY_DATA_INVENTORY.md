# Privacy data inventory

Every piece of data Matra's own code keeps, where it lives, why, and for how long. Threat model:
[threat-model.md](threat-model.md) §2 and W11. Code: `apps/server/src/db.ts` (app DB), `apps/server/src/privacy.ts`
(IP handling, request logs), `apps/matcher/src/store.ts` (matcher DB), `apps/server/src/db.ts openHolderDb` (key
holders). Keep this file in step with the schema: a new column needs a row here.

This is an engineering inventory, not a legal analysis. Whether the retention below satisfies any particular law, and
what Matra must say about it in a privacy notice, are open questions for counsel (legal research bank).

**Never stored by Matra's code anywhere (DB, WAL, ledger, logs):** client IP addresses, user agents, referrers,
request URLs or query strings, request bodies, plaintext of anything the survivor writes or uploads, phone numbers,
SMS codes (except that development builds, not production, log each mock SMS code and a masked number to stdout:
`sms.ts MockSmsVerifier`), perpetrator identifiers. Identifiers are never stored; only OPRF tags are (keyed
pseudorandom values of the identifier, in `match_entries`, `match_groups`, `match_assignments` and `matcher_entries`).
Whoever holds t key shares can recompute the tag for a guessed identifier, and in the in-process development mode the
operator holds every share (W14). `apps/server/src/privacy.test.ts` drives a full session behind a
proxy (IPv4 and IPv6, a distinctive user agent) and fails if the IP or user agent appears in the database files or in
any log output. **No third-party requests:** the web app loads everything from its own origin (CSP `connect-src
'self'`, no analytics, no CDN, no web fonts from elsewhere); `npm run build` runs `scripts/audit-web-build.mjs`, and
every e2e test fails on a request to another origin.

**Outside our code.** The hosting provider's edge / load balancer and the SMS provider keep their own records (e.g.
access logs with IPs; the number and time of each verification). Turning IP logging off at the edge is a deployment
step ([DEPLOY.md](DEPLOY.md)); this code cannot enforce it.

Retention key: **account** = until the account is deleted (crypto-shred, `POST /api/account/delete`);
**forever** = never deleted (append-only); **memory** = process memory only, never written.

## 1. App server database (SQLite, `MATRA_DB_PATH`)

### users
| Column | What / why | Retention |
|---|---|---|
| id | random account id | account |
| username | chosen sign-in name (may be a pseudonym) | account |
| role | survivor / attorney / counselor | account |
| auth_hash, auth_salt | scrypt of the client-derived auth key; verifies sign-in without the passphrase | account |
| kdf_salt, kdf_iterations | returned at sign-in so her device can derive her keys | account |
| public_key | her RSA public key (others wrap keys to it) | account |
| wrapped_private_key | her private key, encrypted under her master key (server cannot open) | account |
| created_at | account creation time | account |
| age_confirmed_18, age_confirmed_at | survivor's 18+ self-attestation and when it was given | account |
| matching_verified | 1 once a phone was confirmed for sealed matching (no number, no time) | account |

### sessions
| Column | What / why | Retention |
|---|---|---|
| token_hash | SHA-256 of the bearer token (the token itself is never stored) | until logout, or at most 12 h + 10 min |
| user_id, created_at, expires_at | whose session, when; expiry enforcement | until logout, or at most 12 h + 10 min |

Sessions expire 12 h after sign-in (`SESSION_TTL_MS`). Expired rows are deleted at startup, on every sign-in, and by a
sweep every 10 minutes (`auth.ts purgeExpiredSessions`, `app.ts` housekeeping), so an abandoned session (tab closed,
quick exit, auto-lock) does not leave a sign-in time on disk. While a session is live, `created_at` is a sign-in time.

### attorney_profiles / counselor_profiles
| Column | What / why | Retention |
|---|---|---|
| display_name, organization, bar_number (attorneys), jurisdictions, practice_areas, accepts_pro_bono, verified | public directory a survivor chooses from; counselors' licensed states drive routing | account |

### records, blobs (the vault)
| Column | What / why | Retention |
|---|---|---|
| id, owner_id, supersedes | which account, which version | account |
| envelope / data | ciphertext of her record / evidence file | account |
| owner_wrapped_key | content key wrapped under her master key | account |
| content_hash, size_bytes | integrity check; size (W11: not padded yet) | account |
| created_at, ledger_entry_id | when sealed; link to the ledger | account |

### shares, share_blobs (survivor → attorney)
| Column | What / why | Retention |
|---|---|---|
| record_id, survivor_id, attorney_id, scope | what she shared with whom | account (either side) |
| recipient_wrapped_key | content key wrapped to the attorney's public key | account |
| consent_statement | the consent text she agreed to (also hashed into the ledger) | account |
| survivor_alias | the name she chose to show the attorney | account |
| status, created_at, expires_at, revoked_at, ledger_entry_id | access control and her audit view | account |

### ledger (append-only)
| Column | What / why | Retention |
|---|---|---|
| seq, id, type, subject_id, content_hash, timestamp, prev_hash, entry_hash | tamper-evident history: ids, hashes, times only. No content, no IP, no identifier tag | **forever** (survives account deletion; hashes only) |

### audit_events
| Column | What / why | Retention |
|---|---|---|
| user_id, action, detail, at | her own activity trail shown to her ("an attorney opened your file at …"); no IP or device | account |

### Sealed matching
| Table | What / why | Retention |
|---|---|---|
| match_entries | per (survivor, identifier): OPRF tag, contact bundle and contact details (ciphertext), her label (ciphertext), routing states sealed to the matcher (ciphertext), key epoch, sync flag | until she withdraws it or deletes her account |
| match_seals | per (entry, counselor): seal ciphertext | with the entry |
| match_groups | tag and time a group formed | until no entry with that tag remains (it outlives a withdrawal while another survivor's entry with the tag is still there) |
| match_assignments | matcher's signed answer: counselor, reason (one state), signals | replaced wholesale on each refresh from the matcher, so it follows the matcher's groups |
| matcher_pending_deletes | entry ids queued for deletion at the matcher | until the matcher confirms |
| counselor_notes | counselor's notes, encrypted under her own key | group-level notes: until no entry with the group's tag remains (or the counselor's account is deleted); notes about one entry: with that entry |
| conflict_checks | counselor's conflict-check result and time per group | until no entry with the group's tag remains (or the counselor's account is deleted) |
| report_requests, report_releases, report_release_blobs | staged release: who asked whom, her yes/no, wrapped keys, consent text, times | with the entry / account |
| oprf_quota | per account and holder: today's count and lifetime count (no per-call times) | account |
| phone_tokens | keyed hash of a verified number and a count; no account id, no rowid | **forever** (no row names an account, so none can be deleted with one) |
| matching_meta | OPRF public keys, key epoch, signed counselor roster | deployment |
| shred_authorizations | transient row inside the account-deletion transaction | never committed |

## 2. App server memory (never written)

| Data | Why | Lifetime |
|---|---|---|
| Per-client rate-limit keys: `HMAC-SHA256(daily salt, IP)` | sign-in/registration, SMS sends, attestation proxy limits | window ≤ 24 h; a timer at midnight UTC zero-fills the salt and empties these limiters even if no request arrives; salt never written |
| Per-account / per-username rate-limit counters | brute-force and SMS-spend limits | window ≤ 24 h; expired entries swept every 10 minutes |
| SMS send limiter key `account id \| phone token` (`app.ts smsStartPerAccountPhone`) | caps code requests per (account, number) | 1 h window, then swept within 10 minutes. This is the account-to-phone-token link that W19 keeps off disk: it exists in memory for that hour, so a memory snapshot taken then links them |
| Phone verification challenge (account id, E.164 number, provider ref) | to check the code she types | ≤ 10 minutes, then swept within 10 minutes |
| Mock SMS provider's pending codes (development / demo only): MACs of the code and number | to check the code | ≤ 10 minutes |
| Pending phone tokens | written to `phone_tokens` in a later batch, apart from the account flag | until the next flush |

## 3. Logs (stdout)

Request lines are `METHOD <route pattern> <status> <ms>` (e.g. `GET /api/shares/:id 200 4ms`): no URL, ids, query
string, IP, user agent, account or body (`@matra/shared request-log.ts`, used by the app server, the key holders and the
matcher). `MATRA_LOG_REQUESTS=0` turns them off in each. Other lines are startup configuration, warnings and error
*messages* only (never the thrown object, which can carry request data). In development (not production) the mock SMS
provider also logs each code and a masked number. Retention of
stdout is whatever the host keeps; see [DEPLOY.md](DEPLOY.md).

## 4. OPRF key holders (each its own SQLite)

| Table | What / why | Retention |
|---|---|---|
| oprf_quota | per pseudonymous token subject (not the account id): today's and lifetime evaluation counts | holder's lifetime |
| daily_totals | evaluations and refusals per UTC day (append-only), for abuse detection | forever |
| (memory) token replay cache: each holder token's random `jti` and expiry | refuse a replayed token | until that token's own expiry (minutes) |

## 5. Matcher (its own SQLite)

| Table | What / why | Retention |
|---|---|---|
| matcher_entries | entry id, tag, pseudonymous survivor ref, entry time, account-creation **hour**, incident and survivor state (in clear here, W18) | until withdrawn / account deleted |
| matcher_assignments, matcher_exclusions | which counselor each group went to and who declined | with the group |
| matcher_roster | the signed counselor roster it routes by | replaced on update |

## 6. Survivor's device

The web app keeps no account data in localStorage, sessionStorage, IndexedDB or cookies (`apps/web/src/lib/session.tsx`);
keys live in memory for the session. The one thing it caches is the on-device speech model (Cache Storage,
`apps/web/src/voice/`): public model files, no audio and no transcript, but their presence shows the device has used
voice input on this site (W8). Downloads she chooses (PDFs, her data export) are hers.
