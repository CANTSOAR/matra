# Weekend MVP: design and build plan

*Branch `weekend-mvp`, written 2026-11-11 from the code at `b7c5390`. Engineering design only. Nothing here is legal
advice; every legal question it raises is linked to the legal research bank by ID and stays a question.*

This is the plan for the overnight build: eight engineering steps, a demo, and the docs. One agent builds each step
in one session, **in the order in §2**, on top of the previous step's commit. Every implementer reads §1 (shared
conventions) and §2 (build order and interfaces) before their own section, and follows them over anything they would
otherwise do. If something in your section turns out to be wrong once you are in the code, do the smallest correct
thing, write down the deviation in this file under your feature's **Deviations** heading, and commit that edit with
your feature.

The decided defaults come from the founder's session 2 and the 2026-11-10 Callisto meeting (phone verify-then-forget
on sealed matching; n-of-m OPRF keys at separate institutions; a separate matcher that is not the lawyer; counselor
sees identifiers before full reports). Threat-model IDs refer to [docs/threat-model.md](../threat-model.md).

---

## 0. What exists today (the parts this plan changes)

| Area | Today | File |
|---|---|---|
| OPRF | RFC 9497 VOPRF (ristretto255-SHA512). Key split **additively** `k = k_A + k_B`. Two in-process holders, endpoints `/api/matching/oprf-a`, `/oprf-b`. Client sums evaluations and finalizes (`finalizeSplitOprf`). Keys `MATRA_OPRF_KEY_A/B` (env or file outside the DB dir; production refuses auto-generation). Public keys recorded in `matching_meta`; silent change refused; `MATRA_OPRF_ROTATE=1` bumps `key_epoch` and clients re-seal from their encrypted label. Quotas in `oprf_quota (user_id, holder CHECK IN ('a','b'))`. | `packages/crypto/src/matching.ts`, `apps/server/src/oprf.ts`, `config.ts`, `app.ts` |
| Entries | `match_entries(tag, bundle, label_envelope, key_epoch)`; one `match_seals` row per (entry, counselor) sealed to **every** verified counselor on the signed roster. The bundle (`MatchContactBundle`) holds identifier, contact details, consent, and one optional `state`. | `db.ts` v4–v5 |
| Groups | `markMatched` inserts `match_groups` at ≥ 2 distinct survivors. `GET /api/counselor/groups` releases a group to **every** verified counselor once ≥ 2 entries are older than `MATRA_MATCH_RELEASE_DELAY_HOURS` (default 72), with Sybil signals from `users.created_at`. | `app.ts` ~L1086–1180 |
| Counselor | Opens seals on her device, `reconstructMatchGroup`, sees every bundle in full, writes encrypted notes. No conflict check, no staged release, no access to full reports. | `apps/web/src/counselor/Counselor.tsx` |
| Keys | `deriveKeys`: PBKDF2-SHA256 600k → HKDF → `authKey`, non-extractable `masterKey` (AES-GCM), `matchKey` (HMAC). The master key **is** a function of the passphrase, so there is no way to reset a passphrase. | `packages/crypto/src/index.ts` |
| Rate limits | In-memory `RateLimiter` keyed by raw `req.ip` (never written to disk, but kept raw in memory). Request log: `METHOD path status ms` (paths include ids). | `auth.ts`, `app.ts` |
| Demo flags | `MATRA_DEMO_BANNER=1` (banner). No "demo mode" concept beyond that. | `index.ts` |
| Migrations | `MIGRATIONS` array in `db.ts`, 5 entries (schema v1–v5). | `db.ts` |

---

## 1. Shared conventions (every implementer)

### 1.1 Rules from the task (restated so nobody misses them)

- Stay on `weekend-mvp`. `git add` explicit paths only. **Never stage anything under `docs/legal-research/`.** Never
  `git stash`, `git reset --hard`, `git checkout -- .`, `git clean`, or anything else that discards changes you did
  not make. Never push. Commit messages end with a blank line and
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before each commit: `npm run typecheck`, `npm test`, `npm run e2e` all green. For anything touching the production
  build, the CSP or startup config, also `npm run build && npm run e2e:prod`. A flaky scenario may be rerun once; say so
  in the commit message.
- Audited primitives only: `@noble/curves`, `@noble/hashes`, WebCrypto. No new crypto dependency without writing the
  reason in your Deviations. No home-made primitives.
- Follow the existing style: the long explanatory block comment at the top of each module, short "why" comments,
  `HttpError(status, code, message)`, zod schemas in `schemas.ts`, prepared statements, `audit()` for her own trail,
  `appendLedger()` for integrity events.
- Docs move with the code and never overclaim: simulated attestation is **not** attestation; a server-side gate is
  **not** a cryptographic guarantee; a mock SMS provider verifies nothing.
- If you can't finish: leave the tree green, put the unfinished part behind a flag that is off by default (or revert
  only your own changes), and say so in your report and in your Deviations.

### 1.2 Demo mode and mock providers (one flag, one helper)

`MATRA_DEMO_MODE=1` is the **only** switch that lets a production process (`NODE_ENV=production`) run with a mock or
simulated provider. The first feature that needs it (**sms-verify**, §3.4) adds to `apps/server/src/config.ts`:

```ts
/** MATRA_DEMO_MODE=1: a fictional-data demo. Allows mock/simulated providers in production and forces the DEMO banner. */
export function loadDemoMode(env: Env = process.env): boolean;
/**
 * Throws in production unless demo mode is on: `${what} is a mock/simulated provider and cannot run in production.
 * Configure a real provider, or set MATRA_DEMO_MODE=1 for a fictional-data demo.` Logs one warning in development.
 */
export function assertMockAllowed(what: string, env: Env = process.env): void;
```

`index.ts` turns the demo banner on whenever `MATRA_DEMO_MODE=1`. Later features call `assertMockAllowed('SMS
verification (mock)')`, `assertMockAllowed('matcher attestation (simulated)')`. Each gets a `config.test.ts` case:
production + mock + no demo flag → throws; production + mock + demo flag → ok.

The web build gets one define, `__MATRA_DEMO__` (from `MATRA_DEMO_MODE` at build time), added by **matcher-service**
(the first feature whose client behaviour depends on it). `playwright.prod.config.ts` does not rebuild, so e2e:prod
relies on the unpinned-dev path (§3.5), not on `__MATRA_DEMO__`.

### 1.3 Secrets held outside the database

Every new server secret follows the OPRF-key pattern already in `config.ts` (`loadOprfKey`): `NAME` (value) or
`NAME_FILE` (path that must be **outside** the DB directory), fatal if missing in production, auto-generated in
development into a dev file with a warning. **threshold-oprf** (§3.3) factors that into one helper and every later
secret uses it:

```ts
export function loadSecretBytes(name: string, opts: {
  env?: Env; bytes?: number;            // default 32
  devFile: string;                      // absolute path used only outside production
  parse?: (raw: string) => Uint8Array;  // default: 64 hex chars, else HKDF-derive from a ≥ 32-char secret
  label: string;                        // used in error messages
}): Uint8Array;
```

Secrets introduced by this plan: `MATRA_OPRF_SHARE_<i>` (holder shares), `MATRA_HOLDER_TOKEN_KEY` (app server →
holders), `MATRA_PHONE_HASH_KEY` (phone token HMAC), `MATRA_MATCHER_KEY` (matcher routing + assignment keys),
`MATRA_ATTESTATION_PLATFORM_KEY` (simulated platform only), `MATRA_MATCHER_TOKEN` (app server ↔ matcher service auth).

Dev key files go in `apps/server/data/` as today (gitignored). Demo and e2e key files go in `.demo/keys/` and
`e2e/.keys/` (outside their DB directories). **demo** (§4) adds `.demo/` and `e2e/.keys/` to `.gitignore`;
**threshold-oprf** adds `e2e/.keys/` first because e2e:prod needs it.

### 1.4 Migrations

Append to `MIGRATIONS` in `db.ts`; never edit or renumber an earlier entry. Reserved numbers, by build order:

| Schema | Feature | Content (details in the feature section) |
|---|---|---|
| v6 | threshold-oprf | rebuild `oprf_quota` with `holder TEXT` (index "1".."m"), drop old quotas |
| v7 | sms-verify | `phone_tokens` (WITHOUT ROWID), `users.matching_verified` |
| v8 | matcher-service | `match_entries.routing_envelope`, `match_entries.matcher_synced`, `match_assignments` |
| v9 | staged-release | `match_entries.contact_bundle`, `conflict_checks`, `report_requests`, `report_releases`, `report_release_blobs` |
| v10 | recovery-code | `users.key_version`, `users.wrapped_account_key`, `users.recovery_*` |

If the order changes, take the next free number and fix this table in the same commit. Matching data has only ever
been demo data (see `DEPLOY.md`), so a migration may drop matching rows when a format change makes them unusable, as v5
did; say so in its comment and in `DEPLOY.md`.

### 1.5 Shared types and the API summary

`packages/shared/src/index.ts`: each feature adds its types in its own clearly headed block (`// ── threshold OPRF ──`,
`// ── phone verification ──`, …) next to the sealed-matching section, and updates the endpoint summary comment at the
bottom. Don't reorder other blocks; that keeps sequential diffs small.

### 1.6 Console warnings in e2e

The e2e fixture (`e2e/helpers.ts`) fails on any console warning. A feature that adds an expected dev-only warning (an
unpinned key, simulated attestation) adds **one** precise regex to the allowlist there, next to the existing roster
one, with a comment.

### 1.7 Logging (applies from metadata-min onwards)

Server, holders and matcher log `METHOD <route pattern> status ms` only (e.g. `GET /api/shares/:id/bundle 200 4ms`),
never a raw path with ids, never a query string, body, IP or user agent. Errors log `err.message` only. Every new
process uses the helper **metadata-min** adds (`apps/server/src/logging.ts`, §3.2).

### 1.8 Ledger and audit

New ledger types are added to `LedgerType` in `ledger.ts`. A ledger entry holds only ids, a content hash and a time.
The anti-probing rule stays: **nothing is written at match time**, no response differs between a match and a miss, and
no survivor-visible text mentions a match until a counselor has actually contacted her (staged-release §3.6).

### 1.9 Threat-model IDs reserved for new rows

W18 matcher (simulated attestation, what the app server still sees) · W19 phone tokens (membership test by the key
holder, SMS provider sees the phone) · W20 recovery code (a second secret on paper) · W21 staged release (contact gate
is server-enforced, not cryptographic). Existing rows W2, W5, W11, W13, W14, W15 are updated by the features that
change them.

---

## 2. Build order and cross-feature interfaces

```
 0 e2e-flaky ─► 1 metadata-min ─► 2 threshold-oprf ─► 3 sms-verify ─► 4 matcher-service ─► 5 staged-release
                                                                                              │
                                              6 recovery-code ◄─────────────────────────────┘
                                                     │
                                              7 demo (seed, demo:reset, inspector, walkthroughs)
                                                     │
                                              8 docs-ops (process docs, MVP_STATUS, README links)
```

Why this order: the flaky test first, so every later e2e run means something. Metadata-min next because it is small
and sets the logging and rate-limit helpers every new process reuses. Threshold-OPRF changes the matching wire format
and config that sms-verify (gate), matcher (entry creation) and staged-release (bundle) all build on. Sms-verify adds
`loadDemoMode` / `assertMockAllowed`, which the matcher needs. Staged-release needs the matcher's single assignment
(the "assigned counselor"). Recovery-code is independent of matching and goes after it so two agents never edit
`matching.ts` and `session.tsx` login at once. Demo needs everything. Docs-ops reads the final git log.

**Cut line if time runs out** (cut from the bottom): the matcher's signed assignments (§3.5 stretch) → recovery-code
regenerate/turn-off UI (keep set-up and recover) → separate-process holders in e2e:prod (keep in-process) → staged
release Stage 2 evidence files (keep the record only). Never cut: tests for crypto paths, production refusal of mocks,
doc honesty.

### 2.1 Interface contracts between features

These are the seams. An earlier feature must leave them exactly like this so the later one can build without
reopening its design.

| Seam | Defined by | Used by | Contract |
|---|---|---|---|
| `logRoute(req,res)` request logger; `HashedRateLimiter` | metadata-min | all servers | §3.2 |
| `loadSecretBytes()` | threshold-oprf | sms, matcher, holders | §1.3 |
| `MatchingConfig.oprf: ThresholdOprfConfig` (replaces `keyHolders`) | threshold-oprf | web, seed, tests | §3.3 |
| `MatchTransport.evaluate(index: number, req)` | threshold-oprf | matcher, staged-release (unchanged), seed | §3.3 |
| `loadDemoMode()`, `assertMockAllowed()` | sms-verify | matcher | §1.2 |
| `requireMatchingEligible` middleware (adult + phone-verified) replaces `verifiedAdultSurvivor` on the OPRF and entry-creation routes | sms-verify | matcher, staged-release | §3.4 |
| `submitMatchEntry(…, { states: { incident?, survivor? }, routing })` and `MatchLabel.states` | matcher-service | staged-release, demo seed | §3.5 |
| `MatcherClient` interface (`upsertEntry`, `removeEntry`, `putRoster`, `assignments`, `decline`) | matcher-service | staged-release (decline on conflict) | §3.5 |
| `match_assignments` row = "the assigned counselor" for a tag | matcher-service | staged-release | §3.5 |
| Bundle split: `MatchSummaryBundle` + `contactBundle` envelope | staged-release | demo, inspector | §3.6 |
| `PublicUser.keyVersion`, `wrappedAccountKey`, `hasRecoveryCode` | recovery-code | demo | §3.7 |
| `/api/dev/inspector` and holder/matcher `/debug/state` | demo | — | §4 |

---

## 3. Features

### 3.1 e2e-flaky: make scenario 2 (evidence/EXIF) reliable

**Problem.** `docs/MVP_STATUS.md`: scenario 2 failed once on the dev stack and passed on rerun with no change; the six
tests after it then did not run (the suite is `serial`).

**Method.** Root cause, not sleeps.
1. Run `npm run e2e` and `npm run build && npm run e2e:prod` at least 3 times each (and `npx playwright test -g "2\."
   --repeat-each 10` against a stack where scenario 1 ran). Keep `trace: 'retain-on-failure'` and read the trace.
2. Likely places, in order: (a) `setInputFiles` on `Choose evidence files` while the evidence screen is still
   mounting or re-rendering after the first upload (the second `setInputFiles` lands on a replaced input); (b) the
   "Saved to your space…" status text is transient and is asserted after it has gone; (c) `nav(Home)` → `nav(Evidence)`
   while an upload or vault save is still in flight, so the vault list reloads before the blob exists; (d) `Unlock &
   view` clicked before the row's data is ready; (e) the download waiter set up after the click resolves; (f) the
   re-seal assertion `2 files kept safely` racing the draft reload.
3. Fix in the app if the app has a real race (e.g. disable the file input while a batch is processing, keep a stable
   input element, expose a stable "saved" state rather than a transient toast), or in the test by waiting on a stable
   state (`aria-busy`, a `data-state="saved"` attribute, a response wait with `page.waitForResponse('/api/vault/blobs')`).
   No `waitForTimeout`.

**Files.** `e2e/demo.spec.ts`, `e2e/helpers.ts`, possibly `apps/web/src/screens/Evidence.tsx`.

**Acceptance.** 3 consecutive green runs of each suite plus `--repeat-each 10` of scenario 2 green; commit message
names the root cause. Update the MVP_STATUS line about scenario 2.

**Demo.** Step 5 of the demo script (evidence) no longer needs a fallback.

---

### 3.2 metadata-min: no raw IPs anywhere, hashed short-lived rate limits (W11)

**Goal.** No IP address or user agent ever reaches disk (DB, WAL, logs written by our code, ledger). Rate limiting
keeps working, from in-memory keyed hashes that cannot outlive 24 hours. No third-party requests from the web app.

**Design.**
- `apps/server/src/auth.ts`: add `HashedRateLimiter` (same `hit(key)` API as `RateLimiter`):
  - key = `HMAC-SHA256(salt, kind | ip | extra)`, first 16 bytes hex; the raw IP is never stored in the map.
  - `salt` = 32 random bytes held in memory, regenerated at each UTC midnight (checked on `hit`). On rotation the map
    is **cleared**, so no entry lives longer than one UTC day (max < 24 h), and an entry's own window (60 s for login)
    is far shorter anyway.
  - Size cap as today (sweep expired entries over 10,000).
  - Export `clientIpKey(req)`: `req.ip ?? req.socket.remoteAddress ?? 'unknown'`, used only to feed the limiter.
- `app.ts`: `rateLimit()` uses `HashedRateLimiter`. Keep the existing limits.
- `apps/server/src/logging.ts` (new): `requestLogger()` middleware logging `METHOD <route pattern> status ms`, where the
  pattern is `req.route?.path` joined with `req.baseUrl` (fallback `(unmatched)` / `(static)`), and
  `logError(err)`. `app.ts` uses it in place of the inline logger. `MATRA_LOG_REQUESTS=0` turns request logs off
  (default on).
- Nothing in the schema stores an IP today; add a comment to `db.ts` saying so, and a test that keeps it that way.
- Web: audit the build for external requests. `index.html`, CSS and JS must contain no `http(s)://` origin other than
  XML namespaces (`http://www.w3.org/…`). Fonts are `@fontsource` (bundled). Keep `connect-src 'self'`.
- e2e fixture: in `e2e/helpers.ts` record every request URL (`page.on('request')`) and fail the test if any origin is
  not the app's own (the stubbed Quick Exit host is the only allowed exception). This covers both e2e and e2e:prod.

**Tests.**
- `apps/server/src/privacy.test.ts` (new): an app on a temp-file DB with `trustProxy: 1`; spy on `console.log/warn/
  error`; drive register, login (including a failing login), vault record + blob upload, share, sealed-match entry,
  counselor groups, and a 404, all with `X-Forwarded-For: 203.0.113.77` and `User-Agent: ua-canary-7f3e`, plus one with
  `2001:db8::77`. Then read the `.db` and `-wal` bytes and all captured log lines: none contains `203.0.113.77`,
  `2001:db8::77`, `ua-canary-7f3e`. Later features extend the drive list (phone verify, matcher, report release,
  recovery) in their own commits.
- `auth.test.ts`: `HashedRateLimiter` limits by IP; map keys are not the IP; rotation clears entries (fake timers).
- `web.test.ts`: the built `index.html` (when present) has no external origins; CSP unchanged.

**Docs.** `docs/PRIVACY_DATA_INVENTORY.md` (new): one table per store (app DB tables and every column; in-memory maps;
logs; holder DBs; matcher DB; client-only data) with *what, why, retention, who can read it*. Later features add their
rows. Threat model §2 and W11: IPs only in memory as daily-salted hashes, < 24 h; request logs without ids/IP/UA;
what remains (hosting provider's own edge logs: out of our code, must be configured, see `docs/ops/HOSTING.md`). Link
Q-038 and Q-039 as open questions.

**Acceptance.** Privacy test green; e2e fixture fails on any third-party request; `grep -rn "req.ip" apps/server/src`
shows only `clientIpKey`.

**Demo.** Inspector (§4) shows the rate-limit map as hashes with expiry times, and the request log lines.

---

### 3.3 threshold-oprf: n-of-m threshold OPRF (W2, W14)

**Goal.** Replace `k = k_A + k_B` with Shamir sharing of `k` over the ristretto255 scalar field, any `t` of `m`
holders (default 2-of-3), each holder a separately runnable process with its own key share, quota store and auth.

**Construction (standard threshold VOPRF; no new primitives).**
- Group: ristretto255, scalar field order ℓ (`ristretto255.Point.Fn` from `@noble/curves`).
- **Dealer key ceremony (MVP).** `k ← random scalar ≠ 0`. Polynomial `f(x) = k + a_1 x + … + a_{t-1} x^{t-1}` with
  random `a_j`. Holder `i ∈ {1..m}` gets `k_i = f(i)`, public share key `pk_i = k_i·G`; group key `pk = k·G`. The dealer
  then drops `k` and the coefficients. (Distributed key generation, e.g. Pedersen/GJKR, removes the dealer: future
  work, written in the whitepaper.)
- **Evaluation.** Client blinds once (`VOPRF.Blind`, RFC 9497 mode 0x01), sends the same `B` to holders. Holder `i`
  returns `E_i = k_i·B` with a DLEQ proof `π_i` against **its own** `pk_i` (`OPRF.voprf.blindEvaluate(k_i, pk_i, B)`,
  unchanged noble call).
- **Client combine.** Verify every proof against the pinned `pk_i` (`OPRF.voprf.finalize(...)` throws on a bad proof;
  record which index failed). Take any `t` valid responses with indices `S`; Lagrange coefficients at 0
  `λ_i = Π_{j∈S, j≠i} j / (j − i) mod ℓ`; `E = Σ λ_i·E_i = k·B`; output `OPRF.oprf.finalize(input, blind, E)` =
  `VOPRF_k(input)`. Same final step as today, so every tag derivation after it is unchanged.
- **Key-set checks (client, from config and pins).** `2 ≤ t ≤ m ≤ 16`; indices distinct in `1..m`; no identity
  `pk_i`; `pk_i` pairwise distinct; group `pk` not identity; and **consistency**: the `pk_i` lie on one degree-`t−1`
  polynomial in the exponent whose value at 0 is `pk` (interpolate `pk` from the first `t`, and check each remaining
  `pk_j` equals `Σ λ_i(j)·pk_i` with Lagrange coefficients at `x = j`). This replaces today's
  `pk_A ≠ pk_B`, `pk_A + pk_B ≠ 0` checks.

**`packages/crypto/src/threshold.ts` (new, re-exported from `matching.ts`):**
```ts
export interface ShareKey { index: number; secretKey: Uint8Array; publicKey: Uint8Array }
export function splitOprfKey(secretKey: Uint8Array, t: number, m: number): ShareKey[];          // dealer only
export function lagrangeAt(x: bigint, indices: number[]): Map<number, bigint>;                 // mod ℓ
export function groupKeyFromShares(shares: Array<{ index: number; publicKey: Uint8Array }>, t: number): Uint8Array; // throws if inconsistent
export function checkThresholdKeys(cfg: { t: number; groupPublicKey: Uint8Array; holders: Array<{ index: number; publicKey: Uint8Array }> }): void;
export interface HolderEvaluation { index: number; evaluated: Uint8Array; proof: Uint8Array }
export class ThresholdOprfError extends Error { readonly badHolders: number[]; readonly missing: number }
/** Verify each proof; combine any t valid; RFC 9497 Finalize. Throws ThresholdOprfError naming bad indices if < t valid. */
export function finalizeThresholdOprf(
  b: MatchBlind,
  cfg: { t: number; groupPublicKey: Uint8Array; holders: Array<{ index: number; publicKey: Uint8Array }> },
  evals: HolderEvaluation[],
): Uint8Array;
export function combineShareKeysForTest(shares: ShareKey[]): Uint8Array;                       // tests only
```
`finalizeSplitOprf` and `combineOprfKeys` are removed; `oprfKeyFromSecret(secret, label)` takes a free label
(`matra/oprf-share/<i>`) for deterministic test keys.

**Client orchestration (`matching.ts`).** `MatchTransport.evaluate(index: number, req)`. `submitMatchEntry` calls all
`m` holders in parallel (`Promise.allSettled`), passes the fulfilled ones to `finalizeThresholdOprf`. If a holder
returns 429, surface that error (quotas are per holder and equal). If fewer than `t` valid: throw a
`MatchingError('holders_unavailable')` the UI words as "Sealed matching isn't available right now. Nothing was sealed."
`checkPinnedKeys` compares `config.oprf` with `MatchPins.oprf`.

**Shared types.**
```ts
export interface OprfHolderInfo { index: number; publicKey: string }            // base64 pk_i
export interface ThresholdOprfConfig { suite: 'ristretto255-SHA512'; mode: 'voprf'; t: number; m: number; groupPublicKey: string; holders: OprfHolderInfo[] }
// MatchingConfig: remove `suite`, `mode`, `keyHolders`; add `oprf: ThresholdOprfConfig`. `threshold: 2` stays: it is the
// MATCH threshold (survivors), not the OPRF threshold. Add a comment saying so.
```

**Server.**
- `oprf.ts`: `OprfKeyHolder(index: number, share: OprfKeyPair, quota: QuotaStore, limits)`. `QuotaStore` interface
  (`get(subject, holder)`, `put(...)`) with a SQLite implementation over any `DB`, so the in-process holders use the app
  DB and the standalone holder its own. `subject` is the user id in-process and the token subject standalone.
- `holders.ts` (new): `HolderPool` with `evaluate(index, subject, blinded)` and `publicKeys()`; two backends:
  in-process (`OprfKeyHolder`s) and remote (`fetch` to `MATRA_OPRF_HOLDER_URLS[i-1]` + `/evaluate`, with a signed
  holder token, 3 s timeout, response shape validated).
- Holder token (remote mode): the app server signs `matra/holder-token/v1|<payload>` with Ed25519
  (`MATRA_HOLDER_TOKEN_KEY`); payload `{ sub, aud: <index>, exp: now+60s, jti }`, where
  `sub = HMAC(pepper, "holder-sub|" + userId)` hex, so holders never see user ids. Header `X-Matra-Holder-Token`.
  Each holder pins the app server's token public key (`MATRA_HOLDER_TOKEN_PUBKEY`), checks `aud` = its own index,
  `exp`, and refuses a replayed `jti` (in-memory set, 2-minute TTL). The holder trusts the app server's statement that
  `sub` is an eligible survivor (adult, phone-verified); it can't check that itself. Write that down.
- Routes: `GET /api/matching/oprf/:index/key` → `{ index, publicKey }`; `POST /api/matching/oprf/:index` (eligible
  survivor) → `OprfEvaluateResponse`. The app server always sits in the path (in-process, or proxying to remote), so
  the browser's `connect-src 'self'` stays. The proxy only ever sees blinded elements and evaluations. Remove
  `/oprf-a`, `/oprf-b`.
- `apps/server/src/holder.ts` (new standalone entrypoint, `npm run -w @matra/server holder`): an Express app with
  `GET /key`, `POST /evaluate { blinded }` (token required), `GET /health`, and (demo mode only, §4) `GET /debug/state`.
  Env: `MATRA_HOLDER_INDEX`, `MATRA_OPRF_SHARE` / `_FILE`, `MATRA_HOLDER_TOKEN_PUBKEY`, `MATRA_HOLDER_DB_PATH` (own
  SQLite with just a quota table), `PORT`, `MATRA_OPRF_PER_DAY`, `MATRA_OPRF_LIFETIME`. Uses `requestLogger` from §3.2.
  Exported `createHolderApp(opts)` for tests.
- `apps/server/src/oprf-ceremony.ts` (new, `npm run -w @matra/server oprf-ceremony -- --threshold 2 --holders 3
  --out <dir> [--force]`): runs the dealer ceremony, writes `oprf-share-<i>.key` (hex scalar, mode 0600) into `<dir>`,
  prints JSON `{ t, m, groupPublicKey, holders: [{ index, publicKey }] }` for pinning, overwrites `k` in memory. Refuses
  to write into the DB directory. Header comment: run offline, hand each file to a different institution, delete the
  directory; the dealer briefly knows `k` (that's why DKG is listed as future work).
- `config.ts`: `loadOprfThreshold(env)` → `{ t, m, mode: 'in-process' | 'remote', shares?: ShareKey[], urls?: string[],
  holderPublicKeys?: string[] }`.
  - `MATRA_OPRF_THRESHOLD` (default 2), `MATRA_OPRF_HOLDERS` (default 3).
  - In-process: `MATRA_OPRF_SHARE_<i>` / `_FILE` for every `i`, via `loadSecretBytes`. Files must differ from each other
    and be outside the DB dir.
  - Remote: `MATRA_OPRF_HOLDER_URLS` (comma list of `m` URLs) + `MATRA_OPRF_SHARE_PUBKEYS` (comma list of `m` base64
    `pk_i`); at startup fetch each `/key` and refuse to start on a mismatch (warn and continue if a holder is down,
    since `t` of `m` is enough).
  - Development with nothing set: run the ceremony once into `apps/server/data/oprf-share-<i>.key` with the usual
    warning. Production: never.
  - If `MATRA_OPRF_KEY_A` or `_B` is set: fatal error explaining that additive keys were replaced and pointing to
    `oprf-ceremony` and `DEPLOY.md`.
- `app.ts` key pinning: `matching_meta` keys `oprf_t`, `oprf_group_pk`, `oprf_share_pks` (JSON). First start records
  them. A difference (including the old `oprf_pk_a/b` keys being present) is refused unless `MATRA_OPRF_ROTATE=1`
  (production) or the process is not production (dev: treat as a rotation with a warning). A rotation increments
  `key_epoch`, deletes quotas, and clients re-seal from their labels on next sign-in (existing mechanism).
- Migration **v6**: rebuild `oprf_quota (user_id TEXT, holder TEXT, day, day_count, lifetime_count, PK(user_id,
  holder))` without the `('a','b')` CHECK; `DELETE` existing quotas.
- `CreateAppOptions.matching`: replace `keyA/keyB` with `oprf?: { t: number; shares?: ShareKey[]; remote?: { urls:
  string[]; publicKeys: string[]; tokenKey: Uint8Array } }`. Omitted in tests → ephemeral 2-of-3 ceremony.

**Web.** `vite.config.ts` pins: `MATRA_OPRF_GROUP_PUBKEY`, `MATRA_OPRF_SHARE_PUBKEYS` (comma list in index order),
`MATRA_OPRF_THRESHOLD`; drop `MATRA_OPRF_PUBKEY_A/B`. `matchPins.ts` → `MatchPins.oprf?: { t; groupPublicKey;
holders: string[] }`. `lib/vault.ts` `matchTransport.evaluate(index, req)`; `api/client.ts` `oprfEvaluate(index, req)`.

**Seed / e2e / deploy.**
- `seed.ts` uses `loadOprfThreshold`.
- `playwright.prod.config.ts`: replace `MATRA_OPRF_KEY_A/B` with a ceremony into `e2e/.keys/` (`--force`) and
  `MATRA_OPRF_SHARE_<i>_FILE`. Then (stretch, cut line) run the three holders as separate processes
  (`npm run -w @matra/server holder`, ports 4311–4313) with `MATRA_OPRF_HOLDER_URLS`, so e2e:prod exercises the remote
  mode. Add `e2e/.keys/` to `.gitignore`.
- `render.yaml`: replace the two `generateValue` keys with `MATRA_OPRF_SHARE_1..3` as `sync: false` (set from ceremony
  output; Render can't generate consistent Shamir shares). `Dockerfile` unchanged except build args for the new pins.

**Tests.**
- `packages/crypto/src/threshold.test.ts`: for 2-of-3 and 3-of-5, **every** `t`-subset gives exactly the output of
  `VOPRF` under the unsplit key (`combineShareKeysForTest` + plain `voprf.blindEvaluate`); any `t−1` responses → throws
  `ThresholdOprfError` (and the Lagrange combination of `t−1` shares ≠ the real output); a tampered `E_i` or `π_i`, or
  a response signed with another share's key, is rejected and its index named, while the remaining `t` still produce the
  right output; duplicate index, index 0, identity `pk_i`, equal `pk_i`, identity group key, inconsistent share
  public keys (one `pk_j` replaced) → `checkThresholdKeys` throws; `t > m`, `t < 2` rejected; pins mismatch rejected.
- `apps/server/src/matching.test.ts` and `config.test.ts`: migrated from a/b to indices (same assertions:
  eligibility, per-holder quotas, rotation/epoch, production refusal of missing shares, files outside the DB dir,
  legacy `MATRA_OPRF_KEY_A` fatal).
- `apps/server/src/holder.test.ts` (new): standalone holder via `createHolderApp` + supertest: valid token works;
  expired, wrong `aud`, bad signature, replayed `jti` → 401; quota enforced in its own DB; remote `HolderPool` with one
  holder down still seals (2 of 3); two down → 503 `holders_unavailable`.
- Existing e2e scenario 5 passes unchanged (dev in-process; prod per above).

**Docs.** Whitepaper §4a (submission block, parties, "Deploying the key holders"), threat model W2/W14 (threshold,
remote mode, token, what colluding `t` holders can do; dealer ceremony caveat; DKG future), `DEPLOY.md` (new env vars,
ceremony steps, pins, render.yaml), `PRIVACY_DATA_INVENTORY.md` (holder quota DB). Link Q-016, Q-040, Q-041 as open
questions for holder institutions.

**Acceptance.** `t`-of-`m` tests above; e2e and e2e:prod green; the server boots in production only with all shares
(in-process) or URLs + pinned pubkeys (remote); `grep -rn "oprf-a\|KEY_A\|keyHolders" apps packages e2e` finds nothing
but the fatal-legacy check and its test.

**Demo.** `npm run demo` (§4) runs three holder processes; the inspector shows each holder's quota rows and the one
blinded element each received, and the tech run-through stops holder 3 mid-demo to show sealing still works with 2.

---

### 3.4 sms-verify: phone verify-then-forget before sealed matching (W13)

**Goal.** A survivor must confirm a phone number by SMS before she can create a sealed-matching entry. Afterwards the
server keeps **only** a keyed hash of the phone in a table not linked to her account, to limit how many accounts one
phone can enable, and a flag on her account. Never the phone, never the code. Email is not required.

**Provider interface (`apps/server/src/sms.ts`, new).**
```ts
export interface SmsVerifier {
  readonly name: 'mock' | 'twilio';
  /** Sends a code to an E.164 number. demoCode only from the mock (shown on screen in dev/demo mode). */
  start(phoneE164: string): Promise<{ providerRef: string; demoCode?: string }>;
  check(providerRef: string, phoneE164: string, code: string): Promise<'approved' | 'wrong_code' | 'expired'>;
}
export class MockSmsVerifier implements SmsVerifier { /* 6-digit code from crypto.randomInt; keeps only HMAC(code) in memory; logs "[matra] DEV SMS to +1•••0100: code 123456" only when not production */ }
export class TwilioVerifySmsVerifier implements SmsVerifier { /* Verify v2: POST /Services/{sid}/Verifications, /VerificationCheck; Basic auth */ }
export function loadSmsVerifier(env): SmsVerifier;  // MATRA_SMS_PROVIDER=mock|twilio; mock → assertMockAllowed('SMS verification (mock)')
```
Twilio adapter: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`; uses `fetch`; written and
type-checked but **untested against the real service** (say so in the file header and `DEPLOY.md`). VoIP rejection
belongs in the real adapter only (Twilio Lookup line type intelligence before `start`; behind `MATRA_SMS_REJECT_VOIP=1`,
default on for twilio). Document that the provider sees the phone number and the time, which is a third party seeing
data (privacy inventory; Q-013).

**Flow and storage.**
- Pending challenges live **in memory only**: `Map<challengeId, { userId, phoneE164, expiresAt, attempts }>`, TTL 10
  min, deleted on success, on expiry, and after 5 wrong codes. The raw phone is in memory only for those minutes
  (the Twilio check call needs it).
- Canonicalise the phone with the existing `normalizeMatchIdentifier('phone', …)` from `@matra/crypto` (strict
  E.164/NANP); reject anything else with a gentle message.
- On `approved`, one transaction:
  - `token = HMAC-SHA256(MATRA_PHONE_HASH_KEY, "matra/phone-token/v1|" + e164)` hex.
  - `phone_tokens(token_hash TEXT PRIMARY KEY, accounts INTEGER NOT NULL) WITHOUT ROWID`. No timestamps, no user id,
    and WITHOUT ROWID so insertion order isn't kept in a rowid that could be lined up with `users`.
  - If `accounts >= MATRA_SMS_MAX_ACCOUNTS_PER_PHONE` (default 2): 409 `phone_limit_reached`, nothing changes.
    Otherwise upsert `accounts + 1`.
  - `UPDATE users SET matching_verified = 1` (no timestamp column; her own audit trail gets "You confirmed a phone
    number for sealed matching. The number itself was not kept.").
  - The count is **not** decremented on account deletion (the row is not linked to any account). Document.
- The limit is checked only **after** she has proved control of the phone, so the endpoint can't be used to test
  whether someone else's number is on Matra.
- Rate limits (in memory, §3.2 style): `start` 5 per account per day and 3 per phone-token per hour; `check` 5 attempts
  per challenge.
- `MATRA_PHONE_HASH_KEY` via `loadSecretBytes` (outside the DB dir; production required). Whoever holds that key and
  the DB can test whether a guessed phone number was ever used to verify **some** account (not which). That is W19.

**Migration v7.** `CREATE TABLE phone_tokens (...) WITHOUT ROWID; ALTER TABLE users ADD COLUMN matching_verified
INTEGER NOT NULL DEFAULT 0; UPDATE users SET matching_verified = 1 WHERE id IN (SELECT user_id FROM match_entries)`
(grandfathers demo accounts that already have entries, so their clients can still re-seal; comment says so).

**API.**
```
GET  /api/matching/verification                       -> { required: boolean, verified: boolean }       (survivor)
POST /api/matching/verification/start { phone }       -> { challengeId, expiresAt, demoCode? }         (adult survivor)
POST /api/matching/verification/check { challengeId, code } -> { verified: true }
     400 code_invalid | code_expired · 409 phone_limit_reached · 429 rate_limited
```
`demoCode` is returned only by the mock provider, and only when not production or when `MATRA_DEMO_MODE=1`.

**Gate.** `requireMatchingEligible` = adult survivor **and** (`matching_verified = 1` or phone verification disabled).
It replaces `verifiedAdultSurvivor` on `POST /api/matching/oprf/:index` and `POST /api/matching/entries`. Config and
listing stay adult-only, so the UI can explain. `CreateAppOptions.matching.requirePhoneVerification` (default true;
env `MATRA_REQUIRE_PHONE_VERIFICATION=0` to disable in dev only, refused in production). 403 `phone_not_verified`.

**Web.**
- `apps/web/src/counselor/PhoneVerify.tsx` (new), route `vault/matching/verify`. Two short steps, skip-anything tone:
  1. "**One quick step before your sealed match.** To make it harder for someone to fake a match with made-up
     accounts, we ask for a phone number that can get texts. We send a code, check it, and then **forget the number**.
     We keep only a scrambled fingerprint of it that isn't connected to your account, so one phone can't be used for
     lots of accounts. It doesn't have to be your main number. You can skip this; your story is saved either way."
     Field: phone number. Buttons: "Text me a code", "Not now".
  2. Code field (one-time-code autocomplete). In dev/demo, a muted note: "Demo: your code is 123456". "Didn't get it?
     Send again" after 30 s. Success: "Done. The number has been forgotten."
- `lib/vault.ts` `lodgeEscrow`: before sealing, `GET /api/matching/verification`; if required and not verified, throw
  `MatchingError` with code `phone_verification_required`. The review/seal screen and Home show a calm card: "Your
  story is sealed. To turn on your sealed match, confirm a phone number first." → link to the verify route, which on
  success returns to Home and re-runs `lodgeEscrow` for her current sealed record (the same retry path the "sealed match
  could not be set up" message uses today).
- `api/client.ts`: three methods.

**Tests.**
- `apps/server/src/sms.test.ts`: mock flow end to end; wrong code ×5 → challenge gone; expiry (fake timers); the phone
  and code appear in no DB byte or log line (extend the §3.2 privacy test with this flow); `phone_tokens` has no
  user id column and is WITHOUT ROWID (`pragma table_info`, `sqlite_master.sql`); limit reached → 409 and her account
  stays unverified; the same phone in different formats (`(201) 555-0100`, `+12015550100`) → one token; OPRF/entries
  → 403 `phone_not_verified` until verified; grandfather migration; `loadSmsVerifier` production + mock without demo →
  throws; Twilio adapter request shape against a stubbed `fetch`.
- `test-helpers.ts`: `verifyPhone(app, user, phone?)` using the mock's `demoCode`; `registerUser(..., { phoneVerified:
  true })` default for survivors used by matching tests, so existing tests stay short.
- e2e: scenario 5 (and scenario 1's seal with matching) gains the verify step: reads the demo code from the screen.
  New assertions: after verifying, the page says the number was forgotten; a second survivor using the same phone
  succeeds (limit 2); a third → the kind limit message.

**Docs.** Threat model W13 (phone friction: what it stops — cheap mass accounts — and what it doesn't — SIM farms,
someone with a few phones; VoIP rejection only with the real provider), new W19; `PRIVACY_DATA_INVENTORY.md`
(`phone_tokens`, `users.matching_verified`, in-memory challenges, provider); whitepaper §4a; `DEPLOY.md`
(`MATRA_SMS_PROVIDER`, Twilio vars, `MATRA_PHONE_HASH_KEY`, `MATRA_SMS_MAX_ACCOUNTS_PER_PHONE`, demo mode). Link Q-013
and Q-038.

**Acceptance.** No entry can be created without verification; nothing linkable to her account or the raw number is
on disk; production refuses the mock without `MATRA_DEMO_MODE=1`.

**Demo.** Survivor sees the explanation and the on-screen demo code; inspector shows the `phone_tokens` row (a hash and
a count, nothing else) and `users.matching_verified = 1`, and the inspector's request log shows the phone redacted.

---

### 3.5 matcher-service: a separate matcher with simulated attestation, routing by both states (W15, W18)

**Goal.** Move "which groups exist, when they're released, and which one counselor gets each" out of the app server
into a separate service that holds only match tags and routing tags, runs public code, and attests (simulated
tonight) to which code it runs. Routing uses the incident state and the survivor's state: assign a counselor licensed
in the incident state if possible, otherwise in the survivor's state; load-balance; record the reason.

**What moves and what doesn't (be honest in the docs).** The app server still stores tags (it must, to serve seals),
so it can still see that two entries share a tag. What the matcher adds: (1) routing data (states) is sealed to the
matcher's attested key and never readable by the app server; (2) release and assignment decisions are made by code
whose hash is published and attested; (3) a group is released to **one** counselor, not all. A malicious app server
could still withhold groups or serve seals to another listed counselor; the stretch item (signed assignments, below)
lets the counselor's client detect the second.

**Workspace `apps/matcher` (`@matra/matcher`).**
```
apps/matcher/src/matcher.ts      core: entries, group detection, release delay, Sybil signals, assignment (pure, store-backed)
apps/matcher/src/store.ts        SQLite (better-sqlite3) store: matcher_entries, matcher_assignments, matcher_roster
apps/matcher/src/attestation.ts  SimulatedAttester (measurement + platform-signed doc); AttestationProvider interface
apps/matcher/src/measure.ts      measurement = build hash (see below); `npm run -w @matra/matcher measure` prints it
apps/matcher/src/server.ts       Express entrypoint (`npm run -w @matra/matcher start`), createMatcherApp(opts) for tests
apps/matcher/src/*.test.ts
```
Scripts: `dev`, `start`, `test`, `typecheck`, `measure`. Depends on `@matra/crypto`, `@matra/shared`,
`better-sqlite3`, `express`. Root `npm test` / `typecheck` pick it up automatically (workspaces).

**Data held by the matcher** (its own DB, `MATRA_MATCHER_DB_PATH`):
- `matcher_entries(entry_id PK, tag, survivor_ref, created_at, account_created_hour, incident_state, survivor_state)`.
  `survivor_ref = HMAC(pepper, "matcher-ref|" + userId)` computed by the app server: lets the matcher count distinct
  survivors without user ids. States are USPS codes or null.
- `matcher_assignments(tag PK, counselor_id, reason, assigned_at, excluded JSON)`.
- `matcher_roster(payload, signature)` (latest signed roster).

**Assignment algorithm** (`assignGroups(now)`, run on every `upsertEntry`, `removeEntry`, `putRoster` and
`assignments()` call; deterministic):
1. Eligible entries for a tag: `created_at <= now − releaseDelay` (`MATRA_MATCH_RELEASE_DELAY_HOURS`, default 72; the
   app server keeps its own check too). A group exists when eligible entries come from ≥ 2 distinct `survivor_ref`.
2. Sybil signals per group (as today): `accountsCreatedClose` (two accounts created within 24 h), `newAccountEntries`
   (entries < 7 days after account creation). Signals are recorded with the assignment and shown to the counselor;
   they don't block release (a counselor judgment, as today).
3. Candidate states in order: incident states of the group's entries by frequency (ties alphabetical), then survivor
   states the same way.
4. Counselors: from the signed roster (verified by the pinned roster key, `MATRA_COUNSELOR_ROSTER_PUBKEY`; unpinned dev
   accepts the app server's list with a warning), minus `excluded` (conflicts, §3.6). For the first candidate state with
   at least one counselor licensed there, pick the one with the fewest open assignments; tie-break by lowest
   `sha256(tag | counselorId)`.
5. Reason: `incident_state:NJ`, `survivor_state:NY`, or, if nobody is licensed in any of the group's states,
   **no assignment** with reason `unassigned:no_licensed_counselor` (the group isn't released; ops sees a count only).
   An entry without states routes as `unassigned:no_state` unless another entry in the group carries one.
6. Sticky: an assignment stays while its counselor remains on the roster and hasn't declined. If the counselor leaves
   the roster or declines, reassign with that counselor excluded and reason prefixed `reassigned:`.

**Roster gains licensed states.** `CounselorRosterPayload` v2: `counselors: [{ userId, publicKey, licensedStates:
string[] }]`. `canonicalRosterPayload` emits v2; `verifyCounselorRoster` accepts v1 (licensedStates = []) and v2.
`sign-roster.ts` fills `licensedStates` from `counselor_profiles.jurisdictions` (add a comment in `db.ts` that for
counselors this column means licensed states). A roster v1 means no counselor is licensed anywhere, so nothing is
assigned; re-sign after upgrading (`DEPLOY.md`).

**Routing data from the survivor (sealed to the matcher).**
- `MatchRoutingTag { v: 1; tag: string; incidentState?: string; survivorState?: string }`.
- `sealRouting(routing, matcherEncKey: JsonWebKey)` in `packages/crypto/src/attestation.ts`: ephemeral ECDH P-256
  (WebCrypto) with the matcher's attested static key, `HKDF-SHA256(salt = ephPub ‖ recipientPub, info =
  "matra/matcher-routing/v1")` → AES-256-GCM, AAD = `"routing|" + tag`. Output `{ v: 1, epk: JWK, iv, ct }`. That is
  standard ECIES built from WebCrypto primitives; it is not RFC 9180 HPKE (note that, and that `@hpke/core` is the swap
  if a reviewer prefers). `openRouting` is the matcher side. The AAD ties the routing tag to the entry's tag, so the
  app server can't move routing data between entries.
- Client: `lodgeEscrow` passes `states: { incident: record.incident.jurisdiction?.state, survivor:
  record.survivor.residenceState }` to `submitMatchEntry`, which (a) puts both states in the bundle the counselor
  opens (staged-release turns this into the summary), (b) keeps them in `MatchLabel.states` (so re-seals keep routing),
  (c) seals the routing tag after verifying the attestation (below). `CreateMatchEntryRequest.routing: RoutingEnvelope`
  (required for new entries; re-seals of old labels without states send states as undefined).

**Attestation (simulated).**
- `AttestationDocument`: `{ payload: string; signature: string }`, payload = canonical JSON `{ v: 1, platform:
  'simulated', measurement, encKey (P-256 JWK), signKey (base64 Ed25519, for the stretch), nonce, issuedAt }`, signed
  `Ed25519("matra/attestation/v1|" + payload)` by the **platform** key (`MATRA_ATTESTATION_PLATFORM_KEY`; dev
  auto-generated). Endpoint `GET /v1/attestation?nonce=<64 hex>`.
- Measurement = SHA-256 over, in sorted path order, `path \0 sha256(content) \n` for every file in `apps/matcher/src`
  (excluding `*.test.ts`) and `apps/matcher/package.json`. The matcher computes it at startup from its own files;
  `npm run -w @matra/matcher measure` prints the same value for publication and pinning. In a real enclave this is the
  image measurement (Nitro PCR0, Confidential Space image digest) produced by a reproducible build, not a file hash;
  `docs/ops/HOSTING.md` explains the mapping.
- `AttestationProvider` interface (`attest(nonce) → AttestationDocument`) with `SimulatedAttester`; `MATRA_ATTESTATION
  =simulated|nitro|confidential-space`; the real ones are stubs that throw "not implemented" (config only). Simulated in
  production → `assertMockAllowed('matcher attestation (simulated)')`.
- `verifyAttestation(doc, { platformKey, expectedMeasurement?, nonce, maxAgeMs = 5 min, allowSimulated })` in
  `packages/crypto/src/attestation.ts` returns `{ encKey, signKey, measurement }` or throws: bad signature, wrong
  nonce, stale, measurement ≠ pinned, `platform: 'simulated'` when not allowed.
- **Who verifies.**
  - Survivor client, before sealing routing data: `GET /api/matching/attestation?nonce=` (the app server proxies to the
    matcher, keeping `connect-src 'self'`; the nonce is fresh per submission). Pins in the web build:
    `MATRA_ATTESTATION_PLATFORM_PUBKEY`, `MATRA_MATCHER_MEASUREMENT` (define `__MATRA_ATTESTATION__`). Unpinned (dev,
    e2e): accept with one console warning (allowlist it, §1.6). `allowSimulated` = unpinned **or** `__MATRA_DEMO__`.
    A production build with pins and without demo mode refuses a simulated document.
  - App server, before forwarding any entry: verifies at startup and every 10 minutes with the same pins as server env
    (`MATRA_ATTESTATION_PLATFORM_PUBKEY`, `MATRA_MATCHER_MEASUREMENT`); on failure it stops forwarding (entries stay
    `matcher_synced = 0`) and logs the reason.

**Matcher API** (bearer `MATRA_MATCHER_TOKEN` between app server and matcher, compared in constant time; attestation
and health are public):
```
GET    /v1/attestation?nonce=           -> AttestationDocument
GET    /v1/health                       -> { ok, measurement }
PUT    /v1/roster   { roster: SignedCounselorRoster, verifiedIds: string[] }
POST   /v1/entries  { entryId, tag, survivorRef, createdAt, accountCreatedAt, routing }   -> { ok: true }   (idempotent; never says whether it matched)
DELETE /v1/entries/:entryId             -> { ok: true }
GET    /v1/assignments                  -> { assignments: Array<{ tag, counselorId, reason, assignedAt, signals, signature? }> }
POST   /v1/assignments/:tag/decline { counselorId, reason: 'conflict' } -> { ok: true }   (reassigns)
GET    /v1/debug/state                  (demo mode only, §4)
```

**App server changes.**
- `apps/server/src/matcher-client.ts`: `MatcherClient` interface; `InProcessMatcher` (imports `createMatcher` from
  `@matra/matcher` with its own in-memory or file DB) and `HttpMatcher` (`MATRA_MATCHER_URL`, `MATRA_MATCHER_TOKEN`).
  Default: in-process (dev, tests); `npm run demo` and e2e:prod (stretch) use the HTTP one.
- Migration **v8**: `ALTER TABLE match_entries ADD COLUMN routing_envelope TEXT; ADD COLUMN matcher_synced INTEGER NOT
  NULL DEFAULT 0; CREATE TABLE match_assignments (tag TEXT PRIMARY KEY, counselor_id TEXT NOT NULL, reason TEXT NOT
  NULL, assigned_at TEXT NOT NULL, signals TEXT NOT NULL, signature TEXT)`; bump `key_epoch` so existing clients re-seal
  with routing data (comment says why).
- `POST /api/matching/entries`: stores `routing_envelope`, then (after the transaction, same code path for match or
  miss) `matcher.upsertEntry(...)`; on success `matcher_synced = 1`. Failures are retried by a sync loop (startup + every
  60 s) that pushes unsynced entries and deletions. Withdraw and account deletion call `removeEntry`. Roster changes
  (sign-roster, counselor verification) → `putRoster` on next sync.
- `GET /api/counselor/groups`: refresh `match_assignments` from `matcher.assignments()` (on failure, use the cached
  rows: fail closed for new groups), then release only groups whose assignment `counselor_id = me`, still applying the
  release-delay cutoff, with the matcher's signals and a new `assignment: { reason, assignedAt }` field.
- `markMatched` stays (it gives group ids for notes), but no longer decides release.
- `/api/matching/attestation` proxy route (public, rate-limited).

**Stretch (cut first).** Signed assignments: the matcher signs `matra/assignment/v1|tag|counselorId|assignedAt` with
its attested Ed25519 `signKey`; the counselor portal fetches an attestation and verifies the signature before opening,
showing "Assigned by the matcher (simulated attestation)". Without the stretch, write in W18 that the app server could
re-route released seals among listed counselors.

**Per-submission OPRF (deferred).** Write `docs/design/PER_SUBMISSION_OPRF.md`: the idea (an OPRF evaluation per
submission bound to a fresh nonce, so a tag can't be reused by more Sybil accounts without new evaluations; W13 note
"after one evaluation the tag for a target can be reused"), candidate constructions (partially-oblivious PRF with a
public per-epoch input; matcher-side re-randomisation inside the enclave; rate-limited evaluation tokens), what each
costs (matching only within an epoch, more trust in the enclave), and why it's deferred (decided: one evaluation per
identifier for now). Research note only, marked [VERIFY] where it cites papers it hasn't checked.

**Web.**
- `lib/vault.ts`: states into `submitMatchEntry`; attestation fetch + verify; routing seal.
- Counselor portal: shows "Assigned to you because the incident state is NJ (where you're licensed)" from
  `assignment.reason`, in plain words; Sybil signals as today.
- e2e helpers: allowlist the "simulated attestation / measurement not pinned" warning.

**Tests.**
- `apps/matcher/src/matcher.test.ts`: group at 2 distinct refs, not at 2 entries from one ref; release delay respected
  (fake clock); incident state preferred over survivor state; falls back to survivor state; none licensed →
  unassigned with reason; load balance across two NJ counselors (alternates); deterministic tie-break; sticky across
  calls; decline → reassigned with exclusion and `reassigned:` reason; counselor removed from roster → reassigned;
  unsigned/badly signed roster refused when a roster key is pinned; v1 roster → nothing assigned; `upsertEntry`
  response identical for match and miss.
- `attestation.test.ts` (crypto): round trip; wrong platform key; altered payload; wrong/missing nonce; stale;
  measurement mismatch; simulated refused when not allowed; `sealRouting`/`openRouting` round trip; AAD mismatch (moved
  between tags) fails; wrong recipient key fails.
- `measure.test.ts`: changing a source file changes the measurement; test files don't.
- Server: groups go only to the assigned counselor (two counselors seeded: NJ-licensed and NY-licensed; incident NY →
  NY counselor sees it, NJ counselor sees nothing); matcher down → entries created, released later after sync; app
  server refuses to forward when the measurement doesn't match its pin; production + simulated + no demo → refuses to
  start; privacy test extended (the app DB has no plaintext state column; `routing_envelope` opens only with the
  matcher key, and fails with any other key or under another entry's tag).
- e2e scenario 5: seed has two counselors (NJ, NY); B's incident is NY → only the NY counselor sees the group, with the
  NY reason; the NJ counselor sees "No matches right now".

**Docs.** Whitepaper (new "Matcher" subsection: parties, what it sees, attestation simulated, measurement procedure);
threat model W15 (one counselor per group), new W18 (simulated attestation is not attestation; app server still sees
tags; re-routing risk unless the stretch ships); `PRIVACY_DATA_INVENTORY.md` (matcher DB); `DEPLOY.md` (matcher env,
measure/pin steps). Link Q-017, Q-035, Q-042 as open questions.

**Acceptance.** Matcher runs in-process and as a separate process; one counselor per group by the rules above, with a
reason; the client and app server both refuse a measurement mismatch; production refuses simulated attestation without
demo mode.

**Demo.** Inspector's matcher pane: entries (tag, survivor_ref hash, states), the assignment row with its reason, and
the attestation document (measurement, platform: simulated). Tech run-through edits one character in
`apps/matcher/src/matcher.ts`, restarts the matcher, and shows the client refusing to seal ("This matcher isn't
running the code this app trusts") because the pinned measurement no longer matches (demo builds pin the measurement).

---

### 3.6 staged-release: counselor-first, then full reports only with each survivor's yes (W1, W21)

**Goal.** Stage 1: the assigned counselor sees the matched identifier, each survivor's states and her contact
*methods*; she records a conflict check; only then does she see contact *details*. Stage 2: the counselor may request
a survivor's full report; each survivor decides alone; only consenting survivors' reports are released, sealed to the
counselor's key on the survivor's device. Nothing about one survivor is ever shown to another.

**Bundle split (client crypto, `matching.ts`).**
- `MatchSummaryBundle { v: 2; identifier; states: { incident?: string; survivor?: string }; methods:
  MatchContactPreferences['methods']; language?: string; consent: { statement; at } }`, encrypted as today
  (`bundle`, AAD `bundle|tag`, padded to 1 KiB).
- `MatchContactDetails { v: 1; name?; phone?; email?; notes? }`, encrypted under the **same** entry key `ke`, AAD
  `contact|tag`, padded → new `CreateMatchEntryRequest.contactBundle: Envelope`.
- `reconstructMatchGroup(tag, entries, privateKey, counselorId)` returns the summary per survivor and, when an entry
  carries `contactBundle`, the opened details. It keeps all current alerts. Old v1 bundles (full contact inside
  `bundle`) are still opened, flagged `legacyBundle: true`; their details are hidden in the UI until the conflict check
  like v2 (UI-only for legacy). Migration v9 bumps `key_epoch` so clients re-seal into v2 anyway.
- The gate on contact details is **server-enforced** (the server withholds `contactBundle` until the check is recorded).
  A counselor who colludes with the server operator could skip it. That is W21; write it plainly.

**Conflict check.**
- `POST /api/counselor/groups/:id/conflict-check { result: 'clear' | 'conflict', statementVersion: 1 }` (assigned
  counselor only). The UI lists the identifier(s) and states and asks her to check them against her conflicts records
  outside Matra; the statement text is fixed and versioned in `apps/web/src/lib/disclosures.ts`.
- `conflict_checks(group_id, counselor_id, result, created_at, ledger_entry_id, PRIMARY KEY(group_id, counselor_id))`;
  ledger `counselor.conflict_checked` over `sha256(groupId|counselorId|result|statementVersion)`; her own audit trail.
- `clear` → subsequent `GET /api/counselor/groups` includes `contactBundle` for each entry.
- `conflict` → `matcher.decline(tag, counselorId)`; the group disappears from her list and is reassigned with her
  excluded. If nobody else is eligible, it stays unassigned (`unassigned:all_conflicted`).

**Report requests (Stage 2).**
- Counselor: per survivor card, after `clear`: "Ask her for her full report". Requires ticking "I've spoken with her
  and she expects this request" (so the request never surprises her and never is her first sign of a match).
  `POST /api/counselor/groups/:id/report-requests { entryId }` → `report_requests(id, group_id, entry_id, counselor_id,
  status 'pending'|'consented'|'declined'|'cancelled', created_at, decided_at, ledger_entry_id)`; ledger
  `report.requested`. One open request per (entry, counselor). Counselor can cancel a pending one.
- Survivor: `GET /api/report-requests` → her requests (server joins `entry_id → user_id`): `{ id, createdAt, status,
  counselor: { displayName, organization, publicKey } }`. Shown only to her, about her entry. Nothing about other
  survivors, the group size, or the identifier beyond her own label (her client decrypts her own label for context).
- Consent: `POST /api/report-requests/:id/consent { recordId, recipientWrappedKey, blobs: [{ blobId,
  recipientWrappedKey }], consentStatement, counselorKeyFingerprint, expiresInDays? }`. Her client wraps the record key
  (and chosen evidence keys) to the counselor's RSA key exactly like an attorney share (`wrapKeyForRecipient`). Key
  check: when the build pins the roster key, the counselor's key must equal the one in the signed roster (automatic);
  otherwise she compares the fingerprint as in the attorney flow. Server: `report_releases(id, request_id UNIQUE,
  survivor_id, counselor_id, record_id, recipient_wrapped_key, consent_statement, status 'active'|'revoked', created_at,
  expires_at, first_opened_at, revoked_at, ledger_entry_id)` + `report_release_blobs(release_id, blob_id,
  recipient_wrapped_key)`; ledger `report.released` (content hash over the consent statement, record id, counselor id
  and expiry, like `share.granted`); request → `consented`.
- Decline: `POST /api/report-requests/:id/decline` → `declined`; ledger `report.declined` (hash of id + decision);
  the counselor sees "She decided not to share her report" with no reason field.
- Revoke: `POST /api/report-releases/:id/revoke` → ledger `report.revoked`; future access stops. **Revocable before
  release**: until the counselor first opens it (`first_opened_at` null) revocation means she never sees it; after that
  it stops future access only (same honest wording as attorney shares; Q-050).
- Counselor reads: `GET /api/counselor/releases` (her active releases) and `GET /api/counselor/releases/:id/bundle` →
  `ReportReleaseBundle` (same shape as `ShareBundle` minus `survivorAlias`, plus `groupId`, `entryId`); sets
  `first_opened_at`; survivor's audit trail: "The legal options counselor opened your report at …".
  `GET /api/counselor/releases/:id/blobs/:blobId` for evidence. 403 `release_revoked` / `release_expired`.
- Account deletion and entry withdrawal: delete her requests and releases (and blobs rows); counselor sees them vanish.
- **Non-consent stays sealed (Q-052 intent).** No route ever returns one survivor's report, contact details or label to
  anyone but her and, after her yes, the requesting counselor. The counselor UI has no "share with" or "combine"
  action. Test it.

**Migration v9.** `match_entries.contact_bundle TEXT`; the four tables above with indexes; `key_epoch` bump.

**Web.**
- Counselor portal (`Counselor.tsx`), per group, in stages with clear headings:
  1. "What matched": identifier, each person's states ("Incident: NY · Lives in: NJ"), how each person prefers to be
     contacted (methods only), warnings and Sybil signals, assignment reason.
  2. "Conflict check": the identifiers to check; "I have no conflict" / "I have a conflict: pass this to another
     counselor". Short explanation of why contact details come after this.
  3. After clear: contact details per person, notes (as today), and "Ask her for her full report" with the
     "she expects this" tick.
  4. "Reports shared with you": opens with her private key (reuse the attorney case viewer's decrypt path,
     `apps/web/src/attorney/Attorney.tsx`, factored into a shared component if needed).
- Survivor: Home shows a card only when she has a request: "**A legal options counselor has asked to see your report.**
  You don't have to decide now, and you can say no. Nothing is shared unless you say yes." → `vault/requests/:id`
  (`apps/web/src/counselor/ReportRequest.tsx`, new): who is asking (name, organization, licensed attorney, key
  fingerprint), exactly what would be shared (choose the sealed record; evidence optional, unticked by default), the
  consent statement (in `disclosures.ts`: shared only with this counselor; not with the other people who named the same
  person; she can stop future access at any time; what's already been read can't be taken back), equally weighted
  buttons "Yes, share my report" / "No, not now", and after a yes, "Stop sharing". Copy follows the existing
  skip-anything, no-pressure tone. Advocate review is still pending for all of it.

**Tests.**
- Crypto: summary/contact split round trip; contact envelope moved to another tag fails (AAD); legacy v1 bundle still
  opens.
- Server (`staged-release.test.ts`): contactBundle absent before the check and present after `clear`; only the
  assigned counselor can check/request; `conflict` → reassigned (second counselor now sees it, first doesn't); request
  requires `clear` and an entry in the group; survivor sees only her own requests; consent → release → counselor bundle
  decrypts to her record (end-to-end with real keys); decline → no release row, counselor sees declined; survivor B who
  never consents: no route returns anything of hers to the counselor beyond Stage 1 (enumerate every counselor route);
  revoke before open → 403 and `first_opened_at` null forever; revoke after open → 403 afterwards; ledger types and
  counts (no ledger row at match time still holds); withdrawal/deletion cascades; privacy test extended.
- e2e: extend scenario 5 (or add 5b): counselor opens group → sees identifier, states, methods, **no** phone numbers →
  conflict check clear → phone numbers visible → requests A's report → A signs in, sees the request card, says yes →
  counselor opens A's report (sees A's story text); B declines → counselor sees "decided not to share"; counselor
  never sees B's story; A revokes → counselor blocked.

**Docs.** Whitepaper (staged release, consent flow), threat model W1 (residual: the request reveals a match to someone
the counselor has already contacted; mitigated by the "she expects this" step), new W21, `PRIVACY_DATA_INVENTORY.md`
(new tables), PRD (user stories). Link Q-018, Q-023, Q-050, Q-052, Q-022 as open questions; no conclusions.

**Acceptance.** As in the tests; nothing about a non-consenting survivor reaches anyone; every consent, decline,
release and revoke has a ledger row.

**Demo.** Counselor sees the group in two steps (no phone numbers until the conflict check); survivor sees a request
she expects and says yes; the second survivor says no; inspector shows `report_releases` holding a wrapped key and
ciphertext only.

---

### 3.7 recovery-code: a code only she holds can reset her passphrase (W5 note, W20)

**Today.** The master key is derived from the passphrase (`deriveKeys`), so a forgotten passphrase means lost data,
and there is no way to re-wrap. Passphrase-wrapped keys exist only for the RSA private key and record keys (under the
master key).

**Design: introduce a wrapped account secret, keeping today's key bytes.**
- **Account secret** `AS` = 64 bytes = `master (32) ‖ matchX (32)`. For existing accounts these are exactly the bytes
  `deriveKeys` produces today: `HKDF(ikm, "matra/master", 256)` and `HKDF(ikm, "matra/match-x", 256)` (WebCrypto
  `deriveKey` of a 256-bit AES/HMAC key equals `deriveBits(256)` with the same parameters; add a test that proves it).
  So switching an account to the new scheme re-encrypts nothing.
- **Key version 2**: the server stores `wrapped_account_key` = `AES-256-GCM(KEK_pass, AS)`, `KEK_pass = HKDF(ikm,
  "matra/kek")`, `ikm` from PBKDF2 as today (W5 unchanged; Argon2id for the passphrase stays future work). Login: derive
  `ikm`, `authKey` as today; after login, unwrap `AS` with `KEK_pass`, import master (non-extractable AES-GCM) and
  matchX (HMAC), register in `MATCH_KEYS`. Version 1 accounts keep today's derivation.
- **Recovery code**: 16 random bytes (128 bits) + 1 checksum byte (first byte of SHA-256 of the 16), Crockford base32 →
  28 characters, shown as 7 groups of 4 (`7KQ2-M9XD-…`). Parsing: uppercase, strip spaces and hyphens, Crockford
  aliases (O→0, I/L→1), checksum must match (catches typos before any network call).
- From the code: `rk = HKDF-SHA256(code bytes, salt = "matra/recovery/v1", info = …)`: `recoveryAuthKey = rk("auth")`
  (sent to the server, which stores only `scrypt` of it like the auth key), `KEK_rec = rk("kek")` (AES-256-GCM), and
  `recovery_wrapped_key = AES-GCM(KEK_rec, AS)`. No Argon2id here: the code has 128 bits of entropy, so slow hashing
  adds nothing (write that down; W5 is about the human-chosen passphrase).
- **Set up / regenerate** (signed in): her client re-derives `AS` (version 1: asks for her passphrase again and
  derives the bits; version 2: already unwrapped in memory, kept only for the length of this operation), generates a
  code, sends `{ authKey (current, re-auth), wrappedAccountKey (only if moving to v2), recoveryAuthKey,
  recoveryWrappedKey }`. The server replaces the recovery columns, so the old code stops working. `key_version = 2`.
- **Recover** (signed out): alias + code → `POST /api/auth/recover/start { username, recoveryAuthKey }` → on success
  `{ resetToken, recoveryWrappedKey }` (token in memory, 10 min, single use); unknown alias or wrong code → the same
  401 after `dummyVerify` (same timing), rate-limited per username and IP hash. Client unwraps `AS`, she picks a new
  passphrase, client derives a new `ikm'`, new salt, `authKey'`, `wrappedAccountKey' = AES-GCM(KEK_pass', AS)`, and
  **a new recovery code** (a used code is burned) → `POST /api/auth/recover/finish { resetToken, kdfSalt,
  kdfIterations, authKey, wrappedAccountKey, recoveryAuthKey, recoveryWrappedKey }` → `AuthResponse`. All her other
  sessions are deleted; her audit trail: "Your passphrase was reset with your recovery code"; ledger
  `account.recovered` (hash of user id + time).
- **Turn off**: `DELETE /api/account/recovery { authKey }` clears the recovery columns.
- The server never sees the code, `KEK_rec`, `KEK_pass` or `AS`, so it can't recover anything itself. Someone who
  finds the paper code and knows her alias can take over her account; that is W20, and the UI says so.

**Migration v10.** `users`: `key_version INTEGER NOT NULL DEFAULT 1`, `wrapped_account_key TEXT`,
`recovery_auth_hash BLOB`, `recovery_auth_salt BLOB`, `recovery_wrapped_key TEXT`.

**Types.** `PublicUser` gains `keyVersion: 1 | 2`, `wrappedAccountKey?: Envelope`, `hasRecoveryCode: boolean`
(returned only to the user herself: login, register, `/api/me`). Request/response types for the endpoints above.

**Crypto (`packages/crypto/src/recovery.ts`, new).** `generateRecoveryCode()`, `formatRecoveryCode()`,
`parseRecoveryCode()`, `deriveRecoveryKeys(codeBytes)`, `deriveAccountSecret(passphrase, salt, iterations)`,
`deriveKek(…)`, `wrapAccountSecret` / `unwrapAccountSecret`, `importAccountSecret(bytes) → { masterKey, matchKey }`.
`deriveKeys` gets an optional `wrappedAccountKey` parameter (v2 path). Wipe `Uint8Array`s with `fill(0)` after use.

**Web.**
- `lib/session.tsx`: v2 unwrap on login; `setUpRecovery(passphrase?)`, `recover(username, code, newPassphrase)`.
- Show-once screen (`apps/web/src/components/RecoveryCode.tsx`): offered right after sign-up (as an optional step:
  "Set it up now" / "Maybe later") and from Home ("Recovery code" in the account section, near "Delete everything").
  Copy: "If you ever forget your passphrase, this code lets you set a new one. **Only you have it**; Matra can't see it
  or send it to you again. Anyone who has it and knows your alias could get into your account, so keep it somewhere
  only you can reach. You don't have to set one up." Actions: Copy, Download as a text file (with the existing
  "not encrypted" warning), Print. Confirm step: "Type the last 4 characters" → saved. Replacing: "Your old code will
  stop working."
- Sign-in screen: "Forgot your passphrase?" → `recover` route (public): alias + code → new passphrase twice (existing
  passphrase guidance) → new code shown once → into her vault.

**Tests.**
- Crypto: deriveKey vs deriveBits equality; v2 unwrap gives a master key that decrypts records written under v1;
  checksum catches each single-character typo in a sample; parse aliases; wrong code → unwrap fails; codes are 128-bit
  random (length, no repeats across 1,000).
- Server: set up → recover start/finish → old passphrase login fails, new works, old records decrypt; wrong code 401
  with timing parity path (dummyVerify called); token single-use and expiry; regenerate invalidates the old code;
  turning off; other sessions revoked; rate limit; privacy test extended (no code material in DB/logs except hashes and
  wrapped key).
- Web unit: show-once confirm logic; recover form validation.
- e2e (new scenario 9): register → set up recovery code (read it from the screen, confirm last 4) → write something →
  sign out → "Forgot your passphrase?" → alias + code → new passphrase → vault shows the same record; signing in with
  the old passphrase fails; the old code no longer works.

**Docs.** Whitepaper §3 (key hierarchy diagram with `AS`, KEK_pass, KEK_rec), threat model W5 (unchanged; note the
recovery code is not passphrase-derived) and new W20, `PRIVACY_DATA_INVENTORY.md`, DEMO_SCRIPT hard question "What if
she forgets her passphrase?" (now: an optional recovery code only she holds; Shamir recovery shares with people she
trusts are later, Q-043). No legal conclusions.

**Acceptance.** As tests; the server cannot reset anyone's passphrase without the code.

**Demo.** Sign up, save the code, "forget" the passphrase, recover; inspector shows only `recovery_auth_hash` (scrypt)
and `recovery_wrapped_key` (ciphertext).

---

### 3.8 docs-ops: process docs for the remaining defaults (no product code)

Write, linking question IDs and giving no legal conclusions:
1. `docs/ops/DEPLOY_GOVERNANCE.md`: n-of-m approval for deploys (GitHub branch protection on `main`, required reviews
   from members of separate organisations via `CODEOWNERS`, signed tags for releases, a reproducible-build hash of the
   web bundle and of the matcher image published per release and pinned in `MATRA_MATCHER_MEASUREMENT`); emergency
   security fix path (one maintainer may ship, after-the-fact review within N days, logged). Link Q-044.
2. `docs/ops/INCIDENT_RESPONSE.md`: **draft pending counsel**. Plans as if a ciphertext-only leak may still require
   notice (link Q-055, Q-036, Q-039): detection, containment, key rotation (OPRF ceremony + `MATRA_OPRF_ROTATE`, matcher
   key, phone hash key), who decides, survivor communication principles, record-keeping.
3. `docs/ops/HOSTING.md`: AWS Nitro Enclaves vs GCP Confidential Space vs Azure confidential containers for the matcher
   and the key holders (attestation format, how measurement maps to our `measure`, KMS release-on-attestation, cost
   notes marked [VERIFY], ops burden); a recommendation; what stays ciphertext-only on the app host; edge-log settings
   needed to keep the W11 promise. Link Q-040, Q-041.
4. Export control note (a short section in `docs/ops/HOSTING.md` or `docs/ops/EXPORT_CONTROL.md`): open-source crypto
   and public availability, as a question; link Q-056; no conclusion.
5. `docs/README.md` links; `docs/MVP_STATUS.md` rewritten from `git log weekend-mvp` (what shipped, test counts from a
   fresh run, what's simulated, gates still open).

---

## 4. Demo plan (built after §3.7, before §3.8)

### 4.1 Running it

- `npm run demo:reset` (`scripts/demo-reset.mjs`): deletes `.demo/db/*` (app DB, matcher DB, three holder DBs);
  generates demo key material in `.demo/keys/` (OPRF ceremony 2-of-3, holder token key, phone hash key, matcher key,
  simulated platform key, roster org key); prints the pins; runs the seed with `MATRA_DEMO_MODE=1`,
  `MATRA_MATCH_RELEASE_DELAY_HOURS=0`. Idempotent; refuses to run if `NODE_ENV=production` or if the DB path isn't
  under `.demo/`.
- `npm run demo` (`scripts/demo.mjs` or `concurrently`): app server (port 4000, `MATRA_DEMO_MODE=1`,
  `MATRA_INSPECTOR=1`, remote holders, HTTP matcher), holders 1–3 (4011–4013), matcher (4020), web (5173, with the
  demo pins incl. the matcher measurement so the tamper demo works). Prints URLs and demo accounts.
- `.demo/` gitignored.

### 4.2 Seeded fictional data (`seed.ts` gains a `--demo` profile; all names prefixed "Demo —")

- Attorneys as today (`attorney.nj1`, `attorney.ny1`, `attorney.nj2`).
- Counselors: `counselor.nj` (licensed NJ), `counselor.ny` (licensed NY), `counselor.pa` (licensed PA), verified,
  roster signed with the demo org key (licensed states included).
- Survivors: `jane.demo` (empty, for the live flow); `sam.demo` (phone-verified with the mock; one sealed record; a
  sealed-match entry naming `instagram:demo_handle_123`, incident NY, lives NJ, contact by text) so that when Jane seals
  the same handle live, a group forms at once and routes to `counselor.ny`; `riley.demo` (a record already shared with
  `attorney.nj1`, for the attorney part without waiting).
- Every seeded entry goes through the real API and the real client crypto in Node (as `seed.ts` does today).

### 4.3 "What the server sees" inspector (dev/demo only)

- Server: `GET /api/dev/inspector` mounted only when `MATRA_INSPECTOR=1` **and** (not production **or**
  `MATRA_DEMO_MODE=1`). Returns:
  - `requests`: in-memory ring buffer (last 200) of `{ at, method, route, status, body }` where `body` is a summary:
    field names with values truncated to 48 characters; `authKey`, `recoveryAuthKey`, `code`, `phone`, `passphrase`
    always shown as `[redacted: …]` with a reason ("never stored"). No headers, no IPs. The inspector's own polling is
    excluded.
  - `tables`: latest 20 rows of `users` (username, role, created_at, key_version, matching_verified, hash columns
    truncated), `records`, `blobs` (size, hash, first bytes of ciphertext), `match_entries` (tag, ciphertext lengths),
    `match_seals`, `match_assignments`, `phone_tokens`, `oprf_quota`, `report_releases`, `ledger`.
  - `rateLimits`: the hashed keys and expiry times.
- Holders and matcher: `GET /debug/state` / `/v1/debug/state` (same flags): holder quota rows and the last 20
  blinded elements it evaluated; matcher entries, assignments and current attestation document. The app server
  aggregates them into the inspector response.
- Web: route `inspector` (public; renders "Inspector is off" unless the server answers), in `apps/web/src/dev/
  Inspector.tsx`, lazy-loaded. One column per process (App server · Holder 1 · Holder 2 · Holder 3 · Matcher), polls
  every 2 s, newest first, ciphertext in a monospace muted style and anything readable highlighted, each section with
  a one-line caption ("This is all the app server has for Jane's story: an encrypted blob and its hash").
- Test: inspector absent in production without the flags; redaction of the listed fields; no IP in its output.

### 4.4 How each feature shows

| Feature | Survivor / counselor screen | Inspector |
|---|---|---|
| e2e-flaky | Evidence upload works first time | — |
| metadata-min | — | request log lines without ids/IP; rate-limit map of hashes with expiry |
| threshold-oprf | Sealing works; stop holder 3 and seal again | each holder saw one blinded element; quotas per holder |
| sms-verify | "One quick step…", demo code on screen, "the number has been forgotten" | `phone_tokens`: a hash and a count; phone redacted in requests |
| matcher-service | Counselor NY gets the group, NJ doesn't; reason shown | routing ciphertext in app DB; states only in matcher; attestation doc; tamper → client refuses |
| staged-release | No phone numbers until conflict check; request; Jane says yes, Sam says no | `report_releases`: wrapped key only |
| recovery-code | Save code, recover, old passphrase fails | `recovery_auth_hash`, wrapped key |

### 4.5 Walkthroughs (written by the demo agent)

- `docs/demo/TECH_RUNTHROUGH.md`: for an engineer or cryptographer, 20 minutes, browser + inspector side by side,
  step by step with the inspector reading at each step, plus the two "break it" moments (holder down, matcher
  tampered) and what's simulated.
- `docs/demo/LAWYER_WALKTHROUGH.md`: for a lawyer, about 12 minutes, plain language, scripted lines, no crypto words
  beyond one sentence each; where each design choice raises an open question, cite the question ID (Q-013, Q-017,
  Q-018, Q-023, Q-035, Q-052 …) and say it's open. Disclaimer up front: fictional data, prototype, not legal advice.
  A short slide deck to go with it (the demo agent picks the format; no real names, no contact details).
- Update `docs/DEMO_SCRIPT.md` setup to `npm run demo:reset && npm run demo`, the new accounts, and the matching section
  (states, assignment, conflict check, request).

---

## 5. Deviations

Implementers append here, one subsection per feature, when the code had to differ from this plan.

### threshold-oprf

Built before metadata-min (§3.2 had not landed when this feature ran), so:
- `logging.ts` does not exist yet. The standalone holder logs `[holder i] METHOD <route pattern> status ms` with its own
  tiny middleware (no ids, tokens, IPs or query strings); swap it for `requestLogger()` when metadata-min lands.
  `docs/PRIVACY_DATA_INVENTORY.md` does not exist yet either; metadata-min should add a row for each holder's quota DB
  (`oprf_quota`: pseudonymous subject = HMAC(pepper, user id), holder index, UTC day, day count, lifetime count).

Code shape:
- The holder is split in two files: `holder.ts` exports `createHolderApp` (tests import it) and `holder-server.ts` is
  the process entrypoint (`npm run -w @matra/server holder`), so importing the app never starts a server.
- `combineShareKeysForTest` returns an `OprfKeyPair` (secret + public), not bare bytes.
- `matching.ts` also exports `matchingOprfKeys(config, pins)` (pins + `checkThresholdKeys`, run **before** anything is
  sent to a holder), `evaluateMatchOprf(transport, keys, blind)` (parallel calls, any t, 429 surfacing) and
  `MatchingError` (`code: 'holders_unavailable'`). The web maps both that and `ThresholdOprfError` to "Sealed matching
  isn't available right now. Nothing was sealed."
- `CreateAppOptions.matching.oprf = { t, shares? , remote?: { urls, publicKeys, tokenKey } }`; `loadOprfThreshold`
  returns `{ t, m, mode, shares?, remote? }` (assignable to it) instead of top-level `urls` / `holderPublicKeys`.
- `loadSecretBytes` gained `required`, `dbPath` (the holder checks against its own quota DB) and `generate` options.
  Shares never use the default "≥ 32-char secret → HKDF" parser: a share must be the exact scalar f(i).
- Holder tokens use node's built-in Ed25519 (`node:crypto`) rather than adding `@noble/curves` as a server dependency.
- Outside production, a changed key set is accepted as a rotation with a warning (`loadMatchingSettings` sets
  `allowKeyRotation` unless `NODE_ENV=production`), so old dev databases pinned to `oprf_pk_a/b` keep working.
- `oprf-ceremony --token-key` also writes a holder-token seed and prints its public key (single-operator demos and
  e2e:prod only). The ceremony helper `writeOprfCeremony` lives in `config.ts` so dev auto-setup and the CLI share it.
- `/debug/state` on holders is left to the demo feature (§4).
- e2e:prod runs the three holders as separate processes (the stretch item), with a fresh ceremony per run.
