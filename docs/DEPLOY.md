# Deploying a Matra demo instance

This guide covers a **demo** instance: one you show to lawyers, advocates and funders using fictional data.

> **Never put real survivor information on an instance until every blocking item in the pre-launch checklist is done.** The checklist is "Before any real-data pilot (blocking)" in [SECURITY_WHITEPAPER.md §6](SECURITY_WHITEPAPER.md#6-roadmap). It includes an escrow redesign, an independent security audit, client-integrity measures, MFA for attorneys, metadata minimization, and an incident-response plan. Until then, keep the **DEMO banner** on (`MATRA_DEMO_BANNER=1`). It tells every visitor not to enter real information.

## What runs in production

One Node process (`npm start`, or the Docker image) serves both:

- the API under `/api`, which only ever handles ciphertext, wrapped keys and hashes, and
- the built web app (`apps/web/dist`) from the same origin, with an SPA fallback to `index.html`.

When `NODE_ENV=production`:

- The web app is served with a strict Content-Security-Policy: `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`. There are no inline scripts, no `eval`, and no third-party origins. `'wasm-unsafe-eval'` lets WebAssembly compile (it does not allow JavaScript `eval`) and `worker-src 'self'` allows the same-origin worker, both for on-device voice transcription. `Permissions-Policy` allows the microphone for this origin only. API responses keep `default-src 'none'`.
- Hashed files under `/assets/` are cached as immutable. `index.html` and all API responses are `no-store`.
- `MATRA_PEPPER` is required. The server refuses to start without it.
- The sealed-matching **threshold OPRF** key set is required: every share `MATRA_OPRF_SHARE_<i>` (in-process mode), or the remote holders' URLs, pinned share public keys and the holder-token key (remote mode). Shares are **never generated automatically in production** and `…_FILE` paths must be outside the database directory: whoever holds t shares and the database can recover every sealed phone number by brute force in seconds. The old additive `MATRA_OPRF_KEY_A/B` are a fatal startup error.
- Sealed matching asks each survivor to confirm a phone by SMS first (W13). The SMS provider defaults to **Twilio
  Verify** (`MATRA_SMS_PROVIDER=twilio` + `TWILIO_*`); the **mock** provider (no texts are sent, the code is shown on
  screen, nothing about the phone is verified) is refused unless `MATRA_DEMO_MODE=1`. `MATRA_PHONE_HASH_KEY` (or
  `_FILE`, outside the database directory) is required and never generated. `MATRA_REQUIRE_PHONE_VERIFICATION=0` is
  refused. On the Twilio account, enable **Verify Fraud Guard** and restrict **Geo Permissions** (SMS) to the countries
  in `MATRA_SMS_ALLOWED_COUNTRY_CODES` (default NANP only), and enable the Lookup **line type intelligence** add-on:
  without it every number is refused (the check fails closed; the server warns once in its log). The app also caps
  sends per IP and globally (`MATRA_SMS_MAX_PER_*`), but those caps are in memory and reset on restart; Twilio's
  settings are the backstop against SMS pumping. Phone-token counts are written to the DB 10–60 min after each
  verification and on SIGTERM/SIGINT; a crash loses the unwritten counts (W19).
- The server records t, the group key and the share public keys in the database on first start and **refuses to start if they change**, unless you restart once with `MATRA_OPRF_ROTATE=1` (a deliberate rotation: a new key epoch begins, and each survivor's app re-seals her entries the next time she signs in).

### On-device voice transcription: the model files

Voice notes are transcribed **on her device** by Whisper (`onnx-community/whisper-base`, multilingual, 8-bit quantized) running in a Web Worker. Audio never leaves the device. The model and the ONNX Runtime wasm are served from **our own origin** under `/models/`; the app is configured so it can never fetch them from huggingface.co or a CDN (a request there would tell a third party that someone is using Matra), and the CSP's `connect-src 'self'` enforces it.

`npm run build` runs `npm run fetch-models` first. It downloads the pinned model revision from Hugging Face **at build time only**, checks every file's sha256 and size, and copies the ONNX Runtime wasm from `node_modules` into `apps/web/public/models/` (gitignored). Vite then copies them into `apps/web/dist/models/`. It is idempotent: verified files are not downloaded again.

```sh
npm run fetch-models                     # ~80 MB download the first time; prints progress
node scripts/fetch-models.mjs --check    # verify only (exit 1 if anything is missing or wrong)
MATRA_SKIP_MODELS=1 npm run build        # build without voice: the app offers typing instead
```

The build machine (or Docker build stage) needs outbound HTTPS to `huggingface.co`. The running server never contacts it. The model revision and hashes are in `apps/web/src/voice/model-manifest.json`. What she downloads once, on first use, is about 94 MB (model 80 MB + CPU runtime 14 MB). The browser keeps it in Cache Storage under a neutral name (`speech-model-…`), so it is not downloaded again.

Optional speed-up: sending `Cross-Origin-Embedder-Policy: require-corp` alongside the existing `Cross-Origin-Opener-Policy: same-origin` makes the page cross-origin isolated, and transcription then uses up to 4 wasm threads. In our measurements this was about 3× faster. The server does not send this header yet.

To prove transcription works end to end under the production CSP, with zero requests to any other origin (needs macOS `say` for the test clip, or `MATRA_VOICE_WAV=<16 kHz wav>`):

```sh
npm run fetch-models
MATRA_VOICE_HARNESS=1 MATRA_DEMO_MODE=1 npm run build   # adds a standalone test page; never part of a normal build
npx playwright test -c playwright.prod.config.ts --grep @voice
# If Chromium's fake microphone hangs (seen on macOS without mic permission for the terminal), add MATRA_VOICE_MIC=inject
```

To check the production build locally, including the full browser suite under the CSP with the banner on:

```sh
MATRA_DEMO_MODE=1 npm run build      # a production build without matcher pins is refused unless it is a demo build
npm run -s -w @matra/server oprf-ceremony -- --threshold 2 --holders 3 --out /tmp/matra-keys --force   # prints the pins
NODE_ENV=production MATRA_DEMO_MODE=1 MATRA_SMS_PROVIDER=mock MATRA_PHONE_HASH_KEY=$(openssl rand -hex 32) \
  MATRA_PEPPER=$(openssl rand -hex 32) MATRA_OPRF_SHARE_1_FILE=/tmp/matra-keys/oprf-share-1.key \
  MATRA_OPRF_SHARE_2_FILE=/tmp/matra-keys/oprf-share-2.key MATRA_OPRF_SHARE_3_FILE=/tmp/matra-keys/oprf-share-3.key \
  MATRA_DB_PATH=/tmp/matra-demo/matra.db npm start   # http://localhost:4000 (in-process holders)
npm run e2e:prod      # the demo-path scenarios against the production build on port 4300, with 3 separate holder processes
```

## Environment variables

| Variable | Demo value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Serves the web app and enforces the production checks |
| `MATRA_PEPPER` | random, ≥ 32 chars | HMAC key for escrow hashes and fake prelogin salts. **Secret.** Set it once and never change it: changing it breaks escrow matching for existing entries. Generate with `openssl rand -hex 32` |
| `MATRA_DEMO_BANNER` | `1` | Shows "DEMO — do not enter real information" on every page |
| `MATRA_DEMO_MODE` | `1` | Fictional-data demo: lets mock/simulated providers (the mock SMS provider) run in production, and turns the DEMO banner on. **Never on an instance with real data** |
| `MATRA_SMS_PROVIDER` | `mock` | `twilio` (production default) or `mock` (development default; production only with `MATRA_DEMO_MODE=1`). Phone verification before sealed matching |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` | unset in a demo | With `MATRA_SMS_PROVIDER=twilio`: a Twilio Verify service. **Secret** (the token). The adapter is written to Twilio's published API but **has not been tested against the real service**: try it on a test number before relying on it. Twilio sees the phone number and when it was verified (a third party; legal question Q-013) |
| `MATRA_SMS_REJECT_VOIP` | unset (on) | Twilio only: `0` turns off the Lookup line-type check. When on, only numbers Lookup reports as `mobile` get a code; VoIP, landline, toll-free, unknown and unchecked numbers are refused (fails closed). The check uses the paid Lookup "line type intelligence" add-on, which must be enabled on the Twilio account, or every number is refused |
| `MATRA_SMS_ALLOWED_COUNTRY_CODES` | `1` | Comma-separated E.164 country calling codes that codes may be sent to (default NANP: US, Canada, …). Match Twilio's Geo Permissions |
| `MATRA_SMS_MAX_PER_IP_PER_HOUR`, `MATRA_SMS_MAX_PER_HOUR`, `MATRA_SMS_MAX_PER_DAY` | `10`, `200`, `1000` | Code-request caps against SMS pumping: per client IP (hashed, in memory) and global; the global caps answer 503 `sms_unavailable`. Also 5 per account per day and 3 per (account, phone) per hour |
| `MATRA_PHONE_HASH_KEY` (or `_FILE`) | random, ≥ 32 chars | HMAC key for phone tokens (verify-then-forget, W19). **Secret**, outside the database directory; required in production. Whoever holds it and the database can test whether a guessed number was used. Changing it resets the per-phone counts |
| `MATRA_SMS_MAX_ACCOUNTS_PER_PHONE` | `2` | How many accounts one phone can enable for sealed matching. Counts are never decremented |
| `MATRA_REQUIRE_PHONE_VERIFICATION` | unset | `0` turns the phone step off in development only; refused in production |
| `MATRA_DB_PATH` | `/app/apps/server/data/matra.db` | Must be on the persistent disk |
| `MATRA_TRUST_PROXY` | `1` | Number of proxy hops in front of the app (Render: 1). Needed for per-IP rate limiting |
| `PORT` | set by the host | Default 4000 locally, 8080 in the Docker image. The server binds `0.0.0.0` in production |
| `MATRA_OPRF_THRESHOLD`, `MATRA_OPRF_HOLDERS` | `2`, `3` | t and m of the threshold OPRF (2 ≤ t ≤ m ≤ 16). Must match the ceremony |
| `MATRA_OPRF_SHARE_<i>` (i = 1..m) | from `oprf-ceremony` | **In-process mode.** Share i: 64 hex chars (a scalar the ceremony wrote; a platform-generated secret does **not** work — shares must come from one ceremony). Or `MATRA_OPRF_SHARE_<i>_FILE`, **outside** the database directory, a different file per share. **Secret.** Required in production. All shares in one process give no separation against the operator |
| `MATRA_OPRF_HOLDER_URLS`, `MATRA_OPRF_SHARE_PUBKEYS` | m URLs; m base64 keys | **Remote mode** (replaces the shares above): holder base URLs and their pinned share public keys, comma-separated in index order. At startup each reachable holder's `/key` must match, or the server refuses to start; a holder that is down only warns |
| `MATRA_HOLDER_TOKEN_KEY` (or `_FILE`) | 64 hex | Remote mode: Ed25519 seed the app server signs holder tokens with. **Secret.** Its public key is `MATRA_HOLDER_TOKEN_PUBKEY` on every holder. Whoever holds it can query the holders under any subject (W14), so guard it like the shares. Holder URLs must be `https://` (plain `http://` is refused in production except to loopback) |
| `MATRA_HOLDER_DAILY_BUDGET` | `1000` | On each **holder** process: evaluations per UTC day across all subjects. Logs an alert at 80% and when spent, then refuses until the next day. Daily totals are kept in the holder DB's append-only `daily_totals` table; the holder's institution should review them |
| `MATRA_OPRF_ROTATE` | **unset** | Set to `1` for one restart only, to accept new OPRF keys on purpose (new key epoch; survivors' apps re-seal on sign-in) |
| `MATRA_MATCH_RELEASE_DELAY_HOURS` | `72` | A matched group reaches counselors only once its entries are this old (slows Sybil / counselor guessing). `0` only for tests |
| `MATRA_OPRF_THRESHOLD`, `MATRA_OPRF_GROUP_PUBKEY`, `MATRA_OPRF_SHARE_PUBKEYS` | build time | Pinned into the **web build** (Vite): t, the group public key and the share public keys (comma-separated, index order), as printed by `oprf-ceremony` (also `GET /api/matching/oprf/<i>/key`). The client refuses a key set that differs. All three or none: the build fails if only some are set, or if they are not one consistent t-of-m key set (checked with the same code the client uses). Docker: `--build-arg`. The old `MATRA_OPRF_PUBKEY_A/B` make the build fail |
| `MATRA_COUNSELOR_ROSTER_PUBKEY` | build time | Pinned into the web build: base64 Ed25519 public key of the organization that signs the counselor roster. With it, survivors seal only to counselors in the signed roster. Docker: `--build-arg` |
| `MATRA_MATCHER_KEY` (or `_FILE`) | random, ≥ 32 chars | **In-process matcher** (no `MATRA_MATCHER_URL`; demo only): the matcher's secret (its routing P-256 key and signing key are derived from it). **Secret**, outside the database directory; required in production. Changing it makes existing routing tags unreadable (their groups route as "no state" until survivors re-seal) |
| `MATRA_ATTESTATION_PLATFORM_KEY` (or `_FILE`) | random, ≥ 32 chars | In-process matcher: the **simulated** attestation platform's Ed25519 key. It is not a hardware key: whoever holds it can sign any measurement (W18). Required in production, where the simulated matcher also needs `MATRA_DEMO_MODE=1` |
| `MATRA_MATCHER_DB_PATH` | unset (in memory) | In-process matcher's own database. In memory by default: the app server re-sends every entry at startup (assignments are recomputed; load balancing may then differ) |
| `MATRA_MATCHER_URL`, `MATRA_MATCHER_TOKEN` (or `_FILE`) | unset | **Separate matcher process** (`npm run -w @matra/matcher start`): its base URL and the shared bearer token (≥ 32 chars). **Secret** (the token). Plain `http://` is refused in production except to loopback |
| `MATRA_ATTESTATION_PLATFORM_PUBKEY`, `MATRA_MATCHER_MEASUREMENT` | unset in a single-host demo | The matcher pins, on the **app server** and in the **web build** (Vite; Docker `--build-arg`): the platform's base64 public key and the hex measurement printed by `npm run -w @matra/matcher measure`. Both or neither. With a separate matcher, production requires them. A pinned build refuses a simulated attestation unless it was built with `MATRA_DEMO_MODE=1` |
| `MATRA_AUTO_VERIFY_ATTORNEYS` | **unset** | Development only. On a demo, verify attorneys explicitly (see below) |
| `MATRA_SERVE_WEB`, `MATRA_WEB_DIR` | unset | Advanced: turn web serving on or off, or serve from another directory |

## Sealed matching: keys, pins and the counselor roster

1. **OPRF key ceremony (dealer).** Offline, on a machine nobody keeps: `npm run -w @matra/server oprf-ceremony -- --threshold 2 --holders 3 --out <dir>`. It writes `oprf-share-<i>.key` (mode 0600) and prints `{ t, m, groupPublicKey, holders: [{ index, publicKey }] }`. Hand each share file to a **different** holder institution, then delete `<dir>`. The dealer briefly knew the whole key; a dealer-free DKG is future work (SECURITY_WHITEPAPER.md §4a).
2. **Run the holders.**
   - *Demo, one host (in-process):* give the app server every share (`MATRA_OPRF_SHARE_<i>_FILE`, outside the database volume and its backups). This is fine for fictional data but gives **no separation against the operator**.
   - *Separate holders (remote):* each institution runs `npm run -w @matra/server holder` with `MATRA_HOLDER_INDEX=<i>`, `MATRA_OPRF_SHARE_FILE=<its file>`, `MATRA_HOLDER_TOKEN_PUBKEY=<app server's token public key>`, `MATRA_HOLDER_DB_PATH=<its own quota DB>`, `PORT`, behind https. The app server gets `MATRA_OPRF_HOLDER_URLS`, `MATRA_OPRF_SHARE_PUBKEYS` (the ceremony's `holders[].publicKey`) and `MATRA_HOLDER_TOKEN_KEY`. Generate the token key with `openssl rand -hex 32`; for its public key, `oprf-ceremony --token-key` writes one and prints `holderTokenPublicKey` (single-operator demos; in a real deployment the app operator generates it). Holders only ever see blinded elements and a pseudonymous subject; they trust the app server that the subject is an eligible survivor.
3. **Pin the key set in the web build**: `MATRA_OPRF_THRESHOLD`, `MATRA_OPRF_GROUP_PUBKEY`, `MATRA_OPRF_SHARE_PUBKEYS` from the ceremony output (Docker `--build-arg`). If you ever rotate keys (a new ceremony), rebuild with the new pins in the same release and restart once with `MATRA_OPRF_ROTATE=1`.
4. **Counselor roster key.** Once, offline: `npm run -w @matra/server sign-roster -- --generate`. Keep the secret on the machine (or hardware token) of the person who verifies counselors — never on the server or in its environment. Build the web app with `MATRA_COUNSELOR_ROSTER_PUBKEY` set to the printed public key.
5. **Sign the roster** after every counselor verification or removal: `MATRA_COUNSELOR_ROSTER_SIGNING_KEY=<secret> npm run -w @matra/server sign-roster` against the production database (for example from the host's maintenance shell, typing the key only for that command; `--dry-run` prints without storing). The server serves the signed roster; seals for counselors who are no longer listed are deleted, and survivors' apps add seals for new counselors on their next sign-in.
6. Without pins (development, the e2e suite) everything works, and the app logs one warning that the counselor list is not pinned.

## The matcher service

The matcher (apps/matcher) decides which matched groups are released and to which **one** counselor, by state: a
counselor licensed where it happened, else where a survivor lives (SECURITY_WHITEPAPER.md §4a "Matcher", threat model
W18). A counselor's licensed states are her profile's `jurisdictions`; with a signed roster they come from the roster
(v2), so **re-sign the roster after upgrading** (a v1 roster lists nobody as licensed, and nothing is assigned).

- *Single-host demo (default):* the matcher runs inside the app server with a **simulated** attestation. Set
  `MATRA_MATCHER_KEY` and `MATRA_ATTESTATION_PLATFORM_KEY` (random, outside the DB volume) and `MATRA_DEMO_MODE=1`;
  production refuses it otherwise. No separation from the operator.
- *Separate process:* run `npm run -w @matra/matcher start` with `MATRA_MATCHER_KEY`, `MATRA_MATCHER_TOKEN`,
  `MATRA_ATTESTATION_PLATFORM_KEY` (simulated platform), `MATRA_MATCHER_DB_PATH` (its own DB), `MATRA_MATCH_RELEASE_DELAY_HOURS`
  (same as the app server), `MATRA_COUNSELOR_ROSTER_PUBKEY` (then it accepts only the signed roster; **required in
  production** unless `MATRA_DEMO_MODE=1`, since without it the matcher would take the app server's word for who the
  counselors are and where they're licensed) and `PORT` (default 4320). Production refuses the simulated attester unless
  `MATRA_DEMO_MODE=1`; `MATRA_ATTESTATION=nitro` or
  `confidential-space` are placeholders that refuse to start until a real verifier exists. Give the app server
  `MATRA_MATCHER_URL` and the same `MATRA_MATCHER_TOKEN`. Its public endpoints are `/v1/attestation` and `/v1/health`
  (`{ ok, measurement, platform }`, no counts: a count would show anyone who can reach it when a match forms); the
  number of groups no licensed counselor can take is at `GET /v1/stats`, behind the token.
- *Pins:* publish the measurement (`npm run -w @matra/matcher measure` on the released source) and the platform's
  public key, and set `MATRA_ATTESTATION_PLATFORM_PUBKEY` + `MATRA_MATCHER_MEASUREMENT` on the app server and as web
  build args. **A production web build without them fails** unless it is a demo build (`MATRA_DEMO_MODE=1`), because the
  attestation reaches survivors through the app server's proxy and an unpinned client would seal her states to whatever
  key it is handed. The measurement covers `apps/matcher/src`, `packages/crypto/src` and `packages/shared/src` (tests
  excluded), the three `package.json` files and the root `package-lock.json` (which pins every third-party dependency's
  version and integrity hash). Installed `node_modules`, Node.js and the OS image are not hashed. Any change to a
  measured file changes the measurement: rebuild the web app with the new value in the same release, or every survivor's client refuses to seal ("This matcher isn't running the code this
  app trusts"). In a real enclave the measurement would be the platform's (Nitro PCR0, Confidential Space image digest)
  over a reproducible build, not this file hash.
- If the matcher is unreachable or its attestation fails, entries are still saved and wait (`matcher_synced = 0`); the
  app server retries every minute and before counselors load their groups. Groups already released stay visible.

Upgrading an existing instance: schema v9 (staged release) adds `match_entries.contact_bundle`, `conflict_checks`, `report_requests`, `report_releases` and `report_release_blobs`, and bumps the key epoch so survivors' apps re-seal their entries on next sign-in into the split format (summary + separate contact details). Until an entry is re-sealed, its v1 bundle still carries the contact details, and only the counselor's UI hides them before the conflict check (W21). Schema v8 (matcher) adds the routing column, the assignment cache and a queue of
withdrawals for the matcher, and bumps the key epoch so survivors' apps re-seal their entries on next sign-in, this time
with routing data (until then their groups route as "no state" and are not released). Database schema v5 **drops all sealed-matching data** (entries, seals, groups, counselor notes, OPRF quotas), because the matching format changed and old entries can't be converted. Matching only ever held demo data; survivors can seal again. Schema v6 (threshold OPRF) drops the OPRF quota counters, and the first start with threshold shares is a **key change**: start once with `MATRA_OPRF_ROTATE=1` (new key epoch; survivors' apps re-seal their entries on next sign-in). Schema v7 (phone verification) adds `phone_tokens` and `users.matching_verified`; accounts that already have sealed entries are marked verified so their apps can still re-seal, and every other survivor confirms a phone the next time she turns on a sealed match. Set `MATRA_PHONE_HASH_KEY` and the SMS provider (or `MATRA_DEMO_MODE=1` + `MATRA_SMS_PROVIDER=mock` for a demo) before upgrading, or the server refuses to start. Remove `MATRA_OPRF_KEY_A/B` from the environment, or the server refuses to start. Since the holder-quota fix (quotas keyed by index and share public key, plus an account-level budget), existing per-holder counters are no longer read, so every survivor's per-holder count starts again once; and holder tokens now carry `bh`, so upgrade the holders together with the app server (an upgraded holder refuses tokens without it).

## Option A: Render (Blueprint)

The repository includes [`render.yaml`](../render.yaml). It defines one Docker web service (`matra-demo`) with:

- a 1 GB persistent disk mounted at `/app/apps/server/data` (SQLite database),
- a health check on `/api/health`,
- `MATRA_PEPPER` generated by Render on first deploy (`generateValue`),
- `MATRA_OPRF_SHARE_1..3` declared but **not** generated (`sync: false`): Render cannot generate consistent Shamir shares. Run the ceremony (step 1 above) and paste each share's hex into the dashboard before the first deploy. All three shares then sit with one operator (in-process): demo only,
- `MATRA_DEMO_BANNER=1` and `MATRA_TRUST_PROXY=1`,
- `MATRA_DEMO_MODE=1` with `MATRA_SMS_PROVIDER=mock` (phone verification shows its code on screen; no texts are sent and nothing about the phone is verified), and `MATRA_PHONE_HASH_KEY` generated by Render. For anything beyond fictional data, switch to `twilio` and remove `MATRA_DEMO_MODE`,
- auto-deploy off, so nothing ships without a deliberate click.

Steps:

1. In Render, choose **New → Blueprint** and select this repository. Review the plan (persistent disks need a paid instance type) and apply.
2. Wait for the health check to pass, then open the service URL. The red DEMO banner should appear at the top of every page.
3. **Seed the demo accounts.** Open the service's **Shell** and run:
   ```sh
   node --import tsx apps/server/src/seed.ts
   ```
   This is idempotent. It creates the fictional attorneys (`attorney.nj1`, `attorney.ny1`, `attorney.nj2`, all verified) and `jane.demo`. The passphrases are printed and listed in the root README. They are public, so anyone can sign in as these accounts. That is acceptable for fictional data only.
4. Optional: to verify an attorney who registered through the UI, run `node --import tsx apps/server/src/verify-attorney.ts <username>` in the Shell.
5. Back up or reset: the database is the single file at `MATRA_DB_PATH` (plus `-wal`/`-shm`). To reset a demo, stop the service, delete those files on the disk, start it, and seed again.

Unverified on Render: the container runs as the non-root `node` user. If the mounted disk turns out not to be writable by that user (the server will log `SQLITE_CANTOPEN` or `EACCES` on boot), fix the ownership of the mount once from the Shell, or ask Render support. Do not switch the image to run as root.

## Option B: any Docker host

```sh
docker build -t matra .
docker volume create matra-data
docker run -d --name matra -p 8080:8080 \
  -e MATRA_PEPPER="$(openssl rand -hex 32)" \
  -e MATRA_OPRF_SHARE_1="$(cat ~/matra-ceremony/oprf-share-1.key)" \
  -e MATRA_OPRF_SHARE_2="$(cat ~/matra-ceremony/oprf-share-2.key)" \
  -e MATRA_OPRF_SHARE_3="$(cat ~/matra-ceremony/oprf-share-3.key)" \
  -e MATRA_DEMO_BANNER=1 \
  -v matra-data:/app/apps/server/data \
  matra
docker exec matra node --import tsx apps/server/src/seed.ts
```

First run the ceremony on your machine (`npm run -w @matra/server oprf-ceremony -- --out ~/matra-ceremony`). Store the pepper and the OPRF key shares somewhere safe, **separately from the data volume** (for example, your host's secret manager). You must pass the same value on every restart.

The image is a multi-stage build on `node:22-slim`. It runs as the non-root `node` user, declares a volume at `/app/apps/server/data`, and has a Docker `HEALTHCHECK` against `/api/health`. Put TLS in front of it with a reverse proxy, and set `MATRA_TRUST_PROXY` to the number of proxy hops.

## Demo-day checklist

- [ ] The DEMO banner is visible on the welcome page, the vault, and the attorney portal.
- [ ] `GET /api/health` returns `{"ok":true}`.
- [ ] The demo accounts sign in. A fresh survivor can register (the "I am 18 or older" box is required) and complete and seal the intake.
- [ ] The incident summary and VCCO draft download. **Download my data** produces a .zip.
- [ ] Nobody on the demo has typed real names, phone numbers or events. If they have, reset the database.
