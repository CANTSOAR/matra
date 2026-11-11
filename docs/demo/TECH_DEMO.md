# Matra: technical live demo (about 25 minutes)

*For the founder, presenting to an engineer, a security reviewer or a cryptographer. Branch `weekend-mvp`. Every command
below was run on 2026-11-11 against a fresh `npm run demo -- --reset`, and the click path is the one
`e2e/demo-stack.spec.ts` drives (5/5 passing the same day). Fictional data only. Nothing here is audited.*

Say this first and mean it: *"Everything you'll see is invented data on one laptop. The cryptography is standard
constructions from audited libraries (`@noble/curves`, WebCrypto), but the system as a whole has had no independent
review, and two pieces are simulated: the matcher's hardware attestation and the SMS provider. I'll show you exactly
where."*

Links are `file:line` into this branch. Construction details: [SECURITY_WHITEPAPER.md §4a](../SECURITY_WHITEPAPER.md),
threat-model rows W1–W21: [threat-model.md](../threat-model.md), plan and deviations: [design/WEEKEND_MVP.md](../design/WEEKEND_MVP.md).

---

## 0. Setup (do this 15 minutes before)

```sh
cd matra
npm install                      # once
npm run demo -- --reset          # fresh keys + seed, then starts everything (Ctrl-C stops it all)
```

Wait for the banner `Matra demo — FICTIONAL DATA ONLY`. One line during the seed,
`matcher sync (roster) failed: matcher PUT /v1/roster → 400`, is expected: the seed pushes the roster once before it has
signed it, then again after (`PUT /v1/roster 200`).

What is running (all on 127.0.0.1, every service `NODE_ENV=production` + `MATRA_DEMO_MODE=1` + `MATRA_INSPECTOR=1`,
[scripts/demo-lib.mjs:55](../../scripts/demo-lib.mjs#L55)):

| Process | Port | Holds |
|---|---|---|
| Key holder 1, 2, 3 | 4011–4013 | one Shamir share `k_i` of the OPRF key each, its own quota DB |
| Matcher | 4020 | P-256 routing key + Ed25519 assignment key (from `matcher.key`), its own DB, **simulated** attestation |
| App server | 4000 | ciphertext, hashes, the ledger; relays blinded elements; mock SMS |
| Web (Vite) | 5173 | the client, **built with pins**: OPRF group + share keys, roster key, platform key, matcher measurement |

Open two windows of the same browser side by side:

- **Left:** http://localhost:5173 (the app)
- **Right:** http://localhost:5173/inspector (the **Server view**: one column per process plus **On her device**, polled every 2 s)

And one terminal at the repo root. Create the three helper scripts the "break it" section uses. They go in `.demo/`,
which is gitignored and survives `demo:reset` (it deletes only `.demo/db` and `.demo/keys`):

<details>
<summary><code>.demo/oprf-demo.mts</code>: play the operator against the live key holders (t−1 fails, forged answer named)</summary>

```sh
cat > .demo/oprf-demo.mts <<'EOF'
// Fictional-data demo only. Plays the OPERATOR on this laptop: it holds the holder-token key, so it can ask holders directly.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { blindMatchIdentifier, derivePerpetratorSecrets, finalizeThresholdOprfReport, fromBase64, normalizeMatchIdentifier, toBase64 } from '@matra/crypto';
import { blindedHash, holderTokenPrivateKey, signHolderToken } from '../apps/server/src/holders.ts';

const ask = process.argv.slice(2).map(Number); // which holders to ask, e.g. 1 3
const pub = JSON.parse(fs.readFileSync('.demo/keys/public.json', 'utf8'));
const tokenKey = holderTokenPrivateKey(Buffer.from(fs.readFileSync('.demo/keys/holder-token.key', 'utf8').trim(), 'hex'));
const id = normalizeMatchIdentifier('social_handle', 'https://www.instagram.com/demo_handle_123/', 'instagram');
if (!id.ok) throw new Error('normalize failed');
console.log('canonical identifier :', id.canonical);
const b = blindMatchIdentifier(id.canonical);
const blinded = toBase64(b.blinded);
console.log('blinded element sent :', blinded);
const evals = [];
for (const i of ask) {
  const token = signHolderToken(tokenKey, { sub: 'f'.repeat(64), aud: i, bh: blindedHash(blinded) });
  const r = await fetch(`http://127.0.0.1:${4010 + i}/evaluate`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Matra-Holder-Token': token }, body: JSON.stringify({ blinded }) }).catch(() => null);
  if (!r) { console.log(`holder ${i} answered    : (down)`); continue; }
  const j = await r.json();
  console.log(`holder ${i} answered    :`, r.status, j.evaluated ?? j.code);
  if (!r.ok) continue;
  const evaluated = fromBase64(j.evaluated);
  if (Number(process.env.FORGE) === i) { evaluated[0] ^= 1; console.log(`  (forging holder ${i}'s answer: one bit flipped)`); }
  evals.push({ index: i, evaluated, proof: fromBase64(j.proof) });
}
const cfg = { t: pub.t, groupPublicKey: fromBase64(pub.groupPublicKey), holders: pub.holders.map((h: { index: number; publicKey: string }) => ({ index: h.index, publicKey: fromBase64(h.publicKey) })) };
try {
  const { output, badHolders } = finalizeThresholdOprfReport(b, cfg, evals);
  if (badHolders.length) console.log('DLEQ proof failed, ignored holder(s):', badHolders.join(', '));
  const { tag } = derivePerpetratorSecrets(output);
  console.log('tag (Lagrange-combined, unblinded):', tag);
  const inDb = execSync(`sqlite3 .demo/db/matra.db "SELECT COUNT(*) FROM match_entries WHERE tag='${tag}'"`).toString().trim();
  console.log('match_entries rows with this tag :', inDb);
} catch (e) {
  console.log('REFUSED:', (e as Error).name, '-', (e as Error).message);
}
EOF
```
</details>

<details>
<summary><code>.demo/attest-check.mts</code>: verify the matcher's attestation exactly as her browser does</summary>

```sh
cat > .demo/attest-check.mts <<'EOF'
// Verify the matcher's attestation exactly as her browser does (packages/crypto verifyAttestation), with this demo's pins.
import fs from 'node:fs';
import { newAttestationNonce, verifyAttestation } from '@matra/crypto';
const pub = JSON.parse(fs.readFileSync('.demo/keys/public.json', 'utf8'));
const nonce = newAttestationNonce();
const doc = await (await fetch(`http://127.0.0.1:4000/api/matching/attestation?nonce=${nonce}`)).json();
const claimed = JSON.parse(doc.payload);
console.log('platform    :', claimed.platform);
console.log('measurement :', claimed.measurement, '(what the matcher says it runs)');
console.log('pinned      :', pub.measurement, '(what this build trusts)');
try {
  const v = verifyAttestation(doc, { nonce, platformKey: pub.platformPublicKey, expectedMeasurement: pub.measurement, allowSimulated: true });
  console.log('VERIFIED: seal routing states to encKey', v.encKey.x.slice(0, 16) + '…');
} catch (e) {
  console.log('REFUSED:', (e as { code?: string }).code, '-', (e as Error).message);
}
for (const [what, d] of [
  ['payload edited after signing (measurement rewritten)', { ...doc, payload: doc.payload.replace(claimed.measurement, claimed.measurement === pub.measurement ? '0'.repeat(64) : pub.measurement) }],
  ['replayed for another nonce', doc],
] as const) {
  try {
    verifyAttestation(d, { nonce: what.startsWith('replayed') ? newAttestationNonce() : nonce, platformKey: pub.platformPublicKey, expectedMeasurement: pub.measurement, allowSimulated: true });
    console.log(`${what}: accepted (!)`);
  } catch (e) {
    console.log(`${what}: REFUSED ${(e as { code?: string }).code}`);
  }
}
EOF
```
</details>

<details>
<summary><code>.demo/tamper-demo.mts</code>: play the matcher; open real routing envelopes, then flip a bit or move one</summary>

```sh
cat > .demo/tamper-demo.mts <<'EOF'
// Fictional-data demo only. Plays the MATCHER (this laptop holds its key): open real routing envelopes from the app DB,
// then show that a flipped bit, or an envelope moved to another entry's tag, does not open. AES-GCM + AAD = "routing|" + tag.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { decryptJSON, encryptJSON, generateContentKey, matcherKeysFromSeed, openRouting } from '@matra/crypto';

const seed = Buffer.from(fs.readFileSync('.demo/keys/matcher.key', 'utf8').trim(), 'hex');
const keys = matcherKeysFromSeed(new Uint8Array(seed));
const rows = JSON.parse(execSync(`sqlite3 -json .demo/db/matra.db "SELECT id, tag, routing_envelope FROM match_entries ORDER BY created_at"`).toString() || '[]');
const show = async (what: string, f: () => Promise<unknown>) => {
  try { console.log(`${what}: opened`, JSON.stringify(await f())); }
  catch (e) { console.log(`${what}: REFUSED (${(e as Error).name})`); }
};
for (const r of rows) {
  const env = JSON.parse(r.routing_envelope);
  console.log(`\nentry ${r.id.slice(0, 8)}…  tag ${r.tag.slice(0, 16)}…  ciphertext ${Buffer.from(env.ct, 'base64').length} bytes`);
  await show('  as stored                ', () => openRouting(env, keys.encPrivateJwk, r.tag));
  const ct = Buffer.from(env.ct, 'base64'); ct[42] ^= 0x01;
  await show('  one bit flipped          ', () => openRouting({ ...env, ct: ct.toString('base64') }, keys.encPrivateJwk, r.tag));
  await show('  moved to another tag     ', () => openRouting(env, keys.encPrivateJwk, 'f'.repeat(64)));
}
// The same AEAD property for her story (records.envelope is AES-256-GCM under a per-record key only her device unwraps):
const k = await generateContentKey();
const sealed = await encryptJSON({ story: 'fictional text' }, k);
const bad = Buffer.from(sealed.ct, 'base64'); bad[0] ^= 0x80;
await show('\nrecord envelope, as sealed ', () => decryptJSON(sealed, k));
await show('record envelope, 1 bit off ', () => decryptJSON({ ...sealed, ct: bad.toString('base64') }, k));
EOF
```
</details>

Smoke-test before the audience arrives (these change no app data; each `oprf-demo` run spends one unit of a made-up
"operator" subject's quota at each holder it asks, 10 per day, so don't rehearse it more than a few times without
`npm run demo -- --reset`):

```sh
npx tsx .demo/attest-check.mts      # → VERIFIED, then two REFUSED lines
npx tsx .demo/tamper-demo.mts       # → Sam's and Morgan's states open; every tampered variant REFUSED
```

Needs `sqlite3` on the PATH (macOS has it).

Rehearse the whole thing once on a fresh stack, then `npm run demo -- --reset` again: Jane can seal only once.

---

## 1. The shape of it (0:00 – 2:00)

Point at the Server view's five columns, left to right.

```
 her browser ──(ciphertext)──────────────────────────► App server ──► SQLite (records, ledger, match_entries…)
   │  blinded element B ──► App server ──(token: sub, aud=i, bh=H(B))──► Holder i: E_i = k_i·B + DLEQ proof
   │  routing {tag, states} sealed (ECIES) to the matcher's ATTESTED key ─► App server (can't open) ─► Matcher
   │                                                                       Matcher ─► one counselor per group
 counselor's browser ◄── seals + bundles (RSA-OAEP / AES-GCM, opened only on her device)
```

Talking points:

- *"The app server is the only thing on the internet. It stores ciphertext and hashes and relays blinded group elements.
  It never sees a story, an identifier, a phone number after the check, or a state."*
- *"Three OPRF key holders, any two of which evaluate. They see random-looking group elements and a pseudonymous
  subject, never an account or an identifier."*
- *"A separate matcher that only ever sees a tag and two US states per entry, decides which ONE counselor gets a matched
  group."*
- Show the pins the web build trusts: `cat .demo/keys/public.json` (group key, three share keys, roster key, platform key,
  matcher measurement). Code: [scripts/demo-lib.mjs:85](../../scripts/demo-lib.mjs#L85) (`pinEnv`) and
  [apps/web/src/matchPins.ts](../../apps/web/src/matchPins.ts).

---

## 2. Phone verify-then-forget (2:00 – 4:30)

**Click path (left window):** **Sign in** → Alias `jane.demo`, passphrase `demo-survivor-passphrase` → on Home, under
*Sealed matches*, **Review or withdraw** → **Confirm a phone number** → *"One quick step before your sealed match"* →
*Phone number that can get texts* `(201) 555-0113` → **Text me a code** → the mock shows *"Demo: your code is NNNNNN"* →
type it into *Code from the text* → **Confirm** → *"Done. The number has been forgotten."* → **Back to Home**.

**Server view:**

- **On her device:** *Phone number (sealed-match check) (201) 555-0113*. That column is a same-origin `BroadcastChannel`
  from the app tab, compiled out of non-demo builds ([apps/web/src/dev/mirror.ts](../../apps/web/src/dev/mirror.ts),
  [PhoneVerify.tsx:46](../../apps/web/src/counselor/PhoneVerify.tsx#L46)).
- **App server → requests:** `POST /api/matching/verification/start` with `phone: [redacted: never stored: …]`, then
  `…/check` with `code: [redacted: …]`. The redaction list is [packages/shared/src/inspector.ts:68](../../packages/shared/src/inspector.ts#L68).
- **App server → phone challenges (memory):** a count, for at most 10 minutes.
- **App server → `users`:** `matching_verified` flips to 1 for `jane.demo`. No timestamp column.
- **App server → `phone_tokens`:** still 2 rows (Sam's and Morgan's). Jane's token is **buffered in memory** and written
  in its own transaction 10–60 minutes later, at random, sorted with other tokens, then `wal_checkpoint(TRUNCATE)`. So no
  single WAL commit pairs her `users` row with her phone token. *"You won't see her row appear during this demo, and
  that's the point."*

**Construction:**

```
token = HMAC-SHA256(K_phone, "matra/phone-token/v1|" + E.164)        stored: (token, accounts)  WITHOUT ROWID, no user id, no time
limit: accounts(token) + pending(token) < 2   → otherwise 409 phone_limit_reached (checked only AFTER she proves control)
```

Code: `phoneToken` [apps/server/src/sms.ts:207](../../apps/server/src/sms.ts#L207); start route with per-account,
per-(account, phone), per-IP (daily-salted HMAC) and global caps [apps/server/src/app.ts:1358](../../apps/server/src/app.ts#L1358);
check, buffered flush and the flag in its own commit [app.ts:1397–1484](../../apps/server/src/app.ts#L1397).

**Say the limit out loud:** whoever holds `K_phone` **and** the DB can test a guessed number (10^10 space); the SMS
provider sees the number and the time, and its records plus Matra's could link the two (W19, Q-013). It is friction
against making a crowd of fake survivors, not Sybil resistance (W13).

---

## 3. Her story and the threshold OPRF seal (4:30 – 10:00)

**Before sealing, stop key holder 3** (terminal):

```sh
kill $(lsof -ti tcp:4013 -sTCP:LISTEN)
```

The demo terminal prints `holder 3 exited`; the Server view's *Key holder 3* column drops to *"Separate process at
http://127.0.0.1:4013."* with no tables.

**Click path:** **My story** → *somewhere safe?* **Yes** → paste *"We met at the lighthouse cafe after the concert. He kept
my phone so I could not call anyone."* → open **The person** → *Name, or what you call them* `D.`, *How you know them*
`met at a concert`, *Did you know this person before?* **No** → **More details, only if you know them** → *Their social
media name or handle* `@demo_handle_123`, *Which app or site?* **Instagram** → save → on **D.**: **Yes, seal it** → save →
*Best way to reach you* **Text message**, *Phone number or email to use* `(555) 010-0213` → save → **Back to your story** →
open **When and where** → *State* **NY** → save → **Back to your story** → **Review** → **Seal my account** → *"Your
account is sealed"* with a ledger entry number. Home → *Sealed matches* says **Sealed** (it always says that; no survivor
ever learns whether anything matched, W1).

**Server view (right), top to bottom:**

- **On her device:** the story text, and *Sealed match: the person she named* `instagram:demo_handle_123 · happened in NY ·
  … · contact by text` ([vault.ts:368](../../apps/web/src/lib/vault.ts#L368)).
- Type `lighthouse` and then `demo_handle_123` into **Look for something she typed**: *"not in any column of any table
  in the app server's database, and not in what the key holders or the matcher hold."* The search runs server-side over
  **full** values, not the 48-character previews ([apps/server/src/inspector.ts:137](../../apps/server/src/inspector.ts#L137)).
- **App server → requests:** `POST /api/vault/records` with an `{"v":1,"alg":"A256GCM",…}` envelope;
  `GET /api/matching/attestation` (see §4); `POST /api/matching/oprf/1` and `/oprf/2` (one blinded element each);
  `POST /api/matching/entries`.
- **Key holder 1 and 2 → evaluations:** one new row each: `blinded`, `evaluated`, `proof`, a 64-hex `subject`. Point out
  the two `blinded` values are identical (one blinding, sent to every holder) and the two `evaluated` values differ (each
  is under a different share). **Key holder 3:** nothing, it's down, and the seal still worked: 2-of-3.
- **Key holder i → `oprf_quota`:** per pseudonymous subject `HMAC(pepper, "holder-sub|" + userId)`, today and lifetime
  counts ([holders.ts:101](../../apps/server/src/holders.ts#L101)).
- **App server → `match_entries`:** three rows now, all with the **same tag**: Sam, Morgan, Jane. `bundle`,
  `contact_bundle`, `label_envelope` are all the same length (1443 chars: the 1 KiB padding bucket), whoever wrote
  them and whatever they hold; `routing_envelope` is ciphertext.

Bring holder 3 back (any time):

```sh
node --input-type=module -e "import { start, holderEnv, loadPublic, TSX } from './scripts/demo-lib.mjs'; start('holder 3', TSX, ['apps/server/src/holder-server.ts'], holderEnv(loadPublic(), 3));" &
```

### The math (put this on screen)

Group: ristretto255, prime order ℓ, generator G. Suite: RFC 9497 VOPRF, ristretto255-SHA512.

```
Dealer (once, offline; apps/server/src/oprf-ceremony.ts)
  k  ←$ Z_ℓ \ {0}                         f(x) = k + a₁·x   (t = 2; degree t−1)
  k_i = f(i),  pk_i = k_i·G  (i = 1..3)    pk = k·G          then the dealer forgets k, a₁

Client (her browser)
  input = "matra/match/v2|" ‖ canonical    e.g. instagram:demo_handle_123 (URL and @handle normalize the same)
  r ←$ Z_ℓ,  B = r·HashToGroup(input)      ← the ONLY thing any holder sees

Holder i
  E_i = k_i·B,   π_i = DLEQ proof that log_G(pk_i) = log_B(E_i)

Client
  verify every π_i against the PINNED pk_i (a holder that answers under any other key is named and ignored)
  S = any t valid indices;  λ_i = Π_{j∈S, j≠i} j / (j − i)  mod ℓ       (Lagrange at 0)
  E = Σ_{i∈S} λ_i·E_i = (Σ λ_i·k_i)·B = f(0)·B = k·B
  y = Finalize(input, r, E) = SHA-512(len‖input‖len‖r⁻¹·E‖"Finalize")  = VOPRF_k(input)
```

With S = {1, 2}: λ₁ = 2, λ₂ = −1, so E = 2·E₁ − E₂ = (2k₁ − k₂)·B = (2(k+a₁) − (k+2a₁))·B = k·B.

**Key-set check before anything is sent** ([threshold.ts:142](../../packages/crypto/src/threshold.ts#L142),
[threshold.ts:164](../../packages/crypto/src/threshold.ts#L164), called from
[matching.ts:749](../../packages/crypto/src/matching.ts#L749)): the client interpolates pk from pk₁, pk₂ **in the
exponent** and requires pk₃ = λ'₁·pk₁ + λ'₂·pk₂ (Lagrange at x = 3), pk ≠ identity, all pk_i distinct and non-identity,
and everything equal to the build-time pins. A server can't slip in a share that isn't part of the published key.

**DLEQ (RFC 9497 §2.2, Chaum–Pedersen made non-interactive with Fiat–Shamir):** holder picks random s, sends
`c = H(G, pk_i, B, E_i, s·G, s·B)` and `z = s − c·k_i`; the client recomputes `z·G + c·pk_i` and `z·B + c·E_i` and checks
the hash. It proves E_i was computed with the same k_i that pk_i commits to, without revealing k_i. That turns "a
malicious holder silently returns garbage to block or tag a survivor" into "a holder that misbehaves is named".

Code: [threshold.ts:118](../../packages/crypto/src/threshold.ts#L118) `splitOprfKey` (Horner, re-deal on a zero share);
[threshold.ts:87](../../packages/crypto/src/threshold.ts#L87) `lagrangeAt`;
[threshold.ts:177](../../packages/crypto/src/threshold.ts#L177) `finalizeThresholdOprfReport`: proof check at
[:194](../../packages/crypto/src/threshold.ts#L194), combine at [:207](../../packages/crypto/src/threshold.ts#L207), Finalize
at [:210](../../packages/crypto/src/threshold.ts#L210); parallel fan-out to every holder
[matching.ts:777](../../packages/crypto/src/matching.ts#L777). RFC 9497 test vectors pass in
[matching.test.ts:14](../../packages/crypto/src/matching.test.ts#L14).

**Holder authorization:** the app server relays each blinded element with a 60-second Ed25519 token
`{sub, aud = holder index, exp, jti, bh = SHA-256(B)}`: bound to that holder and that exact element, replay refused
([holders.ts:107](../../apps/server/src/holders.ts#L107), verify at [:131](../../apps/server/src/holders.ts#L131)). The
app server charges an account-level budget once per blinded element before relaying
([app.ts:1536](../../apps/server/src/app.ts#L1536)); each holder enforces its own per-subject quota (10/day, 50
lifetime) and a global daily budget ([holder.ts:131](../../apps/server/src/holder.ts#L131)).

### From the OPRF output to what is sealed (Callisto, P1)

```
a  = HKDF(y, "slope"),  k' = HKDF(y, "intercept")   ∈ F_p, p = 2^256 + 297      line Y = a·X + k'
π  = HKDF(I2OSP(k', 33), "tag")                      the tag the server stores (bound to the intercept: decoy lines fail)
K_P = HKDF(I2OSP(k', 33), "entry-key")
her point: x = HMAC(matchKey, "x|π") mod p,  y = a·x + k'     same survivor + same person → same x (can't match herself)
ke ←$ AES key;  bundle  = AES-GCM(ke, pad(summary),  AAD "bundle|"+π)    summary = identifier, states, contact METHODS
                contact = AES-GCM(ke, pad(details),  AAD "contact|"+π)   details = the actual number / email
                ce      = AES-GCM(K_P, ke, AAD "ce|"+π)
seal_j = RSA-OAEP-3072(pk_counselor_j) ⊕ AES-GCM({π, x, y, ce}, AAD "seal|"+π+"|"+j)   for each counselor on the SIGNED roster
```

Code: [matching.ts:229](../../packages/crypto/src/matching.ts#L229) `derivePerpetratorSecrets`,
[:249](../../packages/crypto/src/matching.ts#L249) `survivorShareX`, [:338](../../packages/crypto/src/matching.ts#L338)
`buildMatchEntry`, [:810](../../packages/crypto/src/matching.ts#L810) `submitMatchEntry` (order matters: attestation
first, then OPRF, then seal). Two distinct survivors → two points → the line → k' → check π → K_P → every `ce` opens.

---

## 4. The matcher: attestation and the routing seal (10:00 – 13:00)

**Server view → Matcher column:**

- **attestation document (fresh):** `payload` = canonical JSON `{v, platform: "simulated", measurement, encKey, signKey,
  nonce, issuedAt}`, `signature` = Ed25519 over `"matra/attestation/v1|" + payload`.
- **matcher_entries:** one row per entry: tag, a `survivor_ref` (HMAC, not an account id), `account_created_hour`, and
  **`incident_state` / `survivor_state` in clear**. Sam: NY/NJ; Morgan: NY/NY; Jane: NY/(none). *"This is the only
  plaintext about a survivor anywhere outside her device and the counselor's: two US states."*
- **matcher_assignments:** one row for the tag, `reason: incident_state:NY`, the counselor id, a signature.

**What her browser did before sealing** ([matching.ts:697](../../packages/crypto/src/matching.ts#L697)
`verifiedMatcher`, called at [:832](../../packages/crypto/src/matching.ts#L832) **before** any OPRF call, so a refused
attestation costs no quota): fresh 32-byte nonce → `GET /api/matching/attestation?nonce=…` (proxied by the app server so
CSP stays `connect-src 'self'`) → [attestation.ts:176](../../packages/crypto/src/attestation.ts#L176)
`verifyAttestation`, in this order:

1. Ed25519 signature against the **pinned** platform key → `bad_signature`
2. payload parses and is byte-for-byte canonical → `malformed`
3. platform is one we have a verifier for (`nitro` / `confidential-space` → `unsupported_platform`) and simulated is
   allowed in this build (only demo builds) → `simulated_not_allowed`
4. our nonce → `wrong_nonce`; issued within 5 minutes → `stale`
5. `measurement` equals the **pinned** measurement → `measurement_mismatch`

Only then is `encKey` used.

**The measurement** ([apps/matcher/src/measure.ts:49](../../apps/matcher/src/measure.ts#L49)):
`SHA-256` over sorted lines `path \0 sha256(file) \n` for every non-test file under `apps/matcher/src`,
`packages/crypto/src`, `packages/shared/src`, their `package.json` files, and the root `package-lock.json`. Show it:

```sh
npm run -s -w @matra/matcher measure        # = "measurement" in .demo/keys/public.json
jq -r .measurement .demo/keys/public.json
```

**The routing seal (ECIES, P-256)** ([attestation.ts:229](../../packages/crypto/src/attestation.ts#L229)):

```
eph ←$ P-256;  Z = ECDH(eph, encKey)
K   = HKDF-SHA256(Z, salt = ephPub ‖ encKeyPub, info = "matra/matcher-routing/v1")
ct  = AES-256-GCM(K, pad₂₅₆(JSON{v, tag, incidentState, survivorState}), AAD = "routing|" + tag)
```

The AAD binds it to the entry's tag, so the app server can't move one survivor's states onto another entry; the fixed
256-byte padding means the length doesn't say which states she gave (all three envelopes are 272 bytes of ciphertext).
The matcher opens it at [apps/matcher/src/matcher.ts:144](../../apps/matcher/src/matcher.ts#L144) and routes at
[:264](../../apps/matcher/src/matcher.ts#L264): candidate states by frequency, incident states first, then home states;
the least-loaded roster counselor licensed in the first state that has one; sticky while she stays licensed and on the
roster; a conflict excludes her and reassigns.

The app server re-verifies the matcher before forwarding entries ([apps/server/src/matcher-client.ts:148](../../apps/server/src/matcher-client.ts#L148)),
every 10 minutes while it's good, every minute while it isn't.

---

## 5. The counselor: routing, reconstruction, conflict check (13:00 – 15:30)

Counselors sign in through **I'm an attorney → Sign in** (Username, passphrase `demo-counselor-passphrase`, **Unlock**).

1. **`counselor.nj`** → *"No matches right now."* She is licensed where Sam lives, not where it happened. (Optionally
   `counselor.pa` too.) Lock / sign out.
2. **`counselor.ny`** → one group, **3 people**, *"Assigned to you because this happened in New York, where you're
   licensed."* → **Open with my private key**.
   - On her device: unwrap each seal (RSA-OAEP), try **every pair** of points, keep only lines whose intercept k'
     reproduces π, derive K_P, open every `ce` → `ke` → every summary bundle
     ([matching.ts:471](../../packages/crypto/src/matching.ts#L471) `reconstructMatchGroup`, used at
     [Counselor.tsx:209](../../apps/web/src/counselor/Counselor.tsx#L209)). Decoy lines, off-line points, duplicates and
     differing identifiers raise alerts instead of being trusted.
   - Stage 1: three cards with `instagram:demo_handle_123`, the states and the contact **methods**. **No numbers or
     emails.** No aliases anywhere. Taylor isn't there: she named the same profile but didn't opt in, so nothing about it
     left her vault.
3. **I have no conflict** → the contact details appear, one card per person: Sam `(555) 010-0201` by text, Morgan by
   email, Jane `(555) 010-0213` by text.

**Be precise about this gate:** the details were sealed under the same `ke` as the summary. The server simply withholds
the `contact_bundle` ciphertext until a `clear` row exists in `conflict_checks` for this counselor
([app.ts:1815](../../apps/server/src/app.ts#L1815); recorded and ledgered at
[app.ts:1892](../../apps/server/src/app.ts#L1892)). A counselor colluding with the operator could skip it. That is W21:
a server gate, not a cryptographic one.

**Server view:** `conflict_checks` (group, counselor, `clear`, time, ledger id), `match_assignments` now cached on the app
server, and `ledger` has a `counselor.conflict_checked` row whose `content_hash` is SHA-256 of the decision, not the
decision.

**Also say:** the app server can see *which accounts share a tag* (it forms `match_groups` when two distinct accounts hold
entries with one tag, [app.ts:1627](../../apps/server/src/app.ts#L1627)). It cannot see who they named, where, or how to
reach them. Survivors' own APIs never reveal a match (W1).

---

## 6. Staged release: a full report only with her yes (15:30 – 18:00)

1. Still as `counselor.ny`: on Jane's card and Morgan's card tick *"I've spoken with this person and they expect this
   request."* → **Ask for their full report**. Both show *"They haven't decided"*. Sign out.
2. As **`jane.demo`**: Home → **See the request** → the counselor's key is on the organization-signed roster this build
   pins (*"…so it has been checked for you"*) → read the consent statement → *I agree to the statement above.* →
   **Yes, share my report**.
3. As **`morgan.demo`**: Home → **See the request** → **No, don't share**. That no is final in Matra for that sealed
   entry, whoever holds the group later and across re-seals (`409 she_said_no`).
4. As **`counselor.ny`**: Morgan's card: *"They decided not to share their report."*, no link. Jane's: **Open their
   report** → her words, decrypted on the counselor's device.

**Construction:** Jane's browser takes her record's AES-256-GCM content key (and each evidence key) and wraps it to the
counselor's RSA-OAEP-3072 public key ([ReportRequest.tsx:103–108](../../apps/web/src/counselor/ReportRequest.tsx#L103)).
The server checks that the consent statement contains the confirmed key fingerprint and that it matches the key on file
(`409 counselor_key_mismatch`, [app.ts:2140](../../apps/server/src/app.ts#L2140)), that the counselor is still verified,
on the signed roster and assigned the group, then writes `report_releases` and a `report.released` ledger row whose
content hash covers release id, record, counselor, fingerprint, consent text, blob ids and expiry
([app.ts:2116–2170](../../apps/server/src/app.ts#L2116)). Every read re-checks active + unexpired + still assigned + still
on the roster ([app.ts:2022](../../apps/server/src/app.ts#L2022)); a later conflict, a re-seal into a new tag or a
withdrawal ends it, with a ledger row and a line in her trail.

**Server view:** `report_releases` = 1 row: `recipient_wrapped_key` (RSA-OAEP ciphertext), the consent statement, times.
`report_requests` = 2. Search `lighthouse` again: still nowhere.

---

## 7. Break it (18:00 – 23:00)

### 7a. t − 1 holders cannot evaluate; a forged answer is named

Terminal (you are now the operator, with the token-signing key that only the app server should have):

```sh
npx tsx .demo/oprf-demo.mts 1 3     # two holders → the tag; "match_entries rows with this tag : 3"
npx tsx .demo/oprf-demo.mts 2 3     # a different pair, a different blinding, the SAME tag
npx tsx .demo/oprf-demo.mts 1       # one holder → REFUSED: ThresholdOprfError - need 2 valid OPRF evaluations, got 1
FORGE=3 npx tsx .demo/oprf-demo.mts 1 3      # holder 3's answer altered → REFUSED … (bad proof from holder 3)
FORGE=3 npx tsx .demo/oprf-demo.mts 1 2 3    # → "DLEQ proof failed, ignored holder(s): 3", the tag from holders 1 + 2
```

Then stop two holders and show the system-level failure:

```sh
kill $(lsof -ti tcp:4013 -sTCP:LISTEN); kill $(lsof -ti tcp:4012 -sTCP:LISTEN)
npx tsx .demo/oprf-demo.mts 1 2 3   # holder 2 (down), holder 3 (down) → REFUSED … got 1
```

In the app a survivor in that state gets *"Nothing was sealed"* ([vault.ts:387](../../apps/web/src/lib/vault.ts#L387),
`MatchingError('holders_unavailable')` from [matching.ts:793](../../packages/crypto/src/matching.ts#L793); on screen
today it shows the generic copy, see 7b). Bring them back:

```sh
node --input-type=module -e "import { start, holderEnv, loadPublic, TSX } from './scripts/demo-lib.mjs'; for (const i of [2, 3]) start('holder ' + i, TSX, ['apps/server/src/holder-server.ts'], holderEnv(loadPublic(), i));" &
curl -s -o /dev/null -w 'no token → %{http_code}\n' -X POST -H 'content-type: application/json' -d '{"blinded":"AAAA"}' http://127.0.0.1:4011/evaluate   # → 401
```

**The honest half of this demo:** the first command just computed the tag for a *guessed* identifier and confirmed it is
in the database. That works because this laptop holds the holder-token key and all three holders. In production the
operator still mints holder tokens, so **t holders turn an offline dictionary attack into an online one that their own
quotas limit and log; they don't prevent it** (W2, W14). The Server view shows it: each holder's `oprf_quota` now has a
`ffff…` subject with a count. Real protection needs holders at separate institutions that each check eligibility
themselves (Q-040, Q-041).

Unit-test version (no stack needed):

```sh
npm test -w @matra/crypto -- -t "cannot evaluate"     # 2-of-3 and 3-of-5: t−1 shares neither evaluate nor give k
npm test -w @matra/crypto -- threshold                # incl. tampered evaluation / proof / wrong share key, named by index
```

### 7b. A tampered matcher is refused

```sh
echo '// demo tamper: one extra line' >> apps/matcher/src/matcher.ts
npm run -s -w @matra/matcher measure          # a new measurement
kill $(lsof -ti tcp:4020 -sTCP:LISTEN)
node --input-type=module -e "import { start, matcherEnv, loadPublic, TSX } from './scripts/demo-lib.mjs'; start('matcher', TSX, ['apps/matcher/src/server.ts'], matcherEnv(loadPublic()));" &
npx tsx .demo/attest-check.mts
```

Expected (the hashes depend only on the code, so they match on this commit):

```
measurement : 8b97…  (what the matcher says it runs)
pinned      : dc6d…  (what this build trusts)
REFUSED: measurement_mismatch - the matcher is not running the code this app trusts
payload edited after signing (measurement rewritten): REFUSED bad_signature
replayed for another nonce: REFUSED wrong_nonce
```

The browser runs this same function on every seal. Verified in rehearsal: with the tampered matcher a survivor's seal
stopped at `GET /api/matching/attestation`. No `/api/matching/oprf/*` request followed, no quota was spent, and
`match_entries` didn't change; her story itself still sealed. **Known UI bug:** the screen shows the generic
*"…could not be set up right now (Something didn't work. Nothing was shared. Please try again.)"* instead of the specific
*"This matcher isn't running the code this app trusts…"* ([vault.ts:399](../../apps/web/src/lib/vault.ts#L399)), because
`friendlyError` ([session.tsx:622](../../apps/web/src/lib/session.tsx#L622)) only passes through `ApiError` and
`SessionError` messages. The same applies to the "holders unavailable" copy. So show the refusal with the script and the
request log, not the survivor screen.

Restore it:

```sh
git checkout apps/matcher/src/matcher.ts
kill $(lsof -ti tcp:4020 -sTCP:LISTEN)
node --input-type=module -e "import { start, matcherEnv, loadPublic, TSX } from './scripts/demo-lib.mjs'; start('matcher', TSX, ['apps/matcher/src/server.ts'], matcherEnv(loadPublic()));" &
npx tsx .demo/attest-check.mts        # → VERIFIED
```

(`npm run demo` also warns at startup when the matcher code differs from the pinned measurement.)

**Say immediately:** *"That check is real; the thing it checks is not. The 'platform key' is a file on this laptop, and the
measurement is computed by the matcher process itself, so a modified matcher could simply report the old value and
sign it. It shows the protocol shape. Hardware attestation (Nitro PCR0, Confidential Space image digest) is what makes
the measurement mean anything."*

### 7c. Tampered ciphertext is refused

```sh
npx tsx .demo/tamper-demo.mts
```

Playing the matcher with its key, it opens each real `routing_envelope` (`{"v":1,"tag":"…","incidentState":"NY",
"survivorState":"NJ"}` for Sam; tags differ per reset), then: one bit flipped → `REFUSED (OperationError)`; same envelope checked against another
tag → `REFUSED`. Same for a record envelope. AES-GCM authenticates the ciphertext and the AAD, so the server can neither
alter nor re-home a ciphertext without detection.

The ledger and records are WORM at the database level:

```sh
sqlite3 .demo/db/matra.db "UPDATE ledger SET content_hash='00' WHERE seq=1;"   # Error: ledger is append-only (WORM)
sqlite3 .demo/db/matra.db "DELETE FROM records;"                               # Error: records are immutable (WORM)…
```

*"Triggers stop accidents and casual edits, not a root operator who drops them. That's why the chain needs external
anchoring (W10)."*

Unit-test versions:

```sh
npm test -w @matra/crypto -- attestation   # bad signature, wrong nonce, stale, measurement, non-canonical; routing moved/tampered
npm test -w @matra/crypto -- matching      # tampered share, decoy lines, contact ciphertext swapped between entries
npm test -w @matra/matcher -- measure      # one changed source file changes the measurement; tests don't
```

---

## 8. What is simulated or not real yet (23:00 – 25:00)

Say all of it; don't wait to be asked.

| Piece | Today | What real looks like |
|---|---|---|
| Matcher attestation (W18) | **Simulated.** A dev Ed25519 key in `.demo/keys/attestation-platform.key` signs a measurement the matcher computes over its own files. Whoever holds the key can sign anything. `nitro` / `confidential-space` are placeholders that refuse to start ([apps/matcher/src/attestation.ts:50](../../apps/matcher/src/attestation.ts#L50)). | Platform-signed document over the enclave image, reproducible build, published measurement ([ops/HOSTING.md](../ops/HOSTING.md) recommends Confidential Space). |
| Matcher installed node_modules / runtime | Not measured: the lockfile pins versions but installed files and Node aren't hashed. | Whole-image measurement covers them. |
| Signed assignments | The matcher signs each assignment; the counselor portal does **not** verify the signature yet, so the app server could re-route a group undetected (W18). | Portal verifies against the attested `signKey`. |
| Key custody (W2, W14) | All three shares, the holder-token key, matcher key, platform key, roster org key, pepper and phone-hash key are on **one laptop**. `oprf-demo.mts` proves what that means. | Holders at separate institutions; eligibility attested by someone other than the app server; no single party can mint tokens for all holders. |
| Dealer | The ceremony briefly knows k (no DKG). Bigints can't be wiped. | Pedersen/GJKR DKG, or an offline ceremony machine that is destroyed. |
| SMS (W13, W19) | **Mock** provider: texts nobody, shows the code on screen. Production refuses it without `MATRA_DEMO_MODE=1`. Twilio Verify adapter exists but is untested against the real service. | Real provider; still friction, not Sybil resistance. |
| Contact gate (W21) | Server gate (withholds the contact ciphertext until a conflict check). | A second key released only after the check, or accepted as a policy control. |
| Release delay | `MATRA_MATCH_RELEASE_DELAY_HOURS=0` so the group appears immediately. | Default 72 hours. |
| Server view | Unauthenticated; exists only in dev and demo builds and with `MATRA_INSPECTOR=1`. Holder "evaluations" are kept in memory only because it is on. | Not present in production builds at all (checked by building both). |
| Error copy | Refused seals show a generic message (see 7b). | Show `MatchingError` messages. |
| Metadata (W11) | No IPs or user agents stored; route-only logs. Size padding for records and blobs, an encrypted alias and the host's edge logs are not done. The app server sees aliases, times, and which accounts share a tag. | |
| Passphrase (W5) | PBKDF2-SHA256 600k; no strength floor. The recovery code (W20) doesn't change that. | Argon2id via WASM + a floor. |
| Review | No independent security audit, no outside cryptographer review. Matching stays **off** for any pilot. | Audit + crypto review are gates before real data. |

Close: *"Every one of these is written down in the threat model with its ID. What I want from you is the review that
turns 'standard constructions, carefully wired' into something a survivor can rely on."*

---

## Appendix

**Reset between runs:** `Ctrl-C` the demo terminal (stops the processes `npm run demo` started; anything you restarted by
hand with the `node --input-type=module …` lines runs on its own, so stop those with
`for p in 4011 4012 4013 4020; do lsof -ti tcp:$p -sTCP:LISTEN | xargs kill; done`), then `npm run demo -- --reset`.

**Run the whole demo path headless** (own ports and `e2e/.demo`, doesn't touch yours): `npm run e2e:demo` (5 tests,
about 1.5 minutes).

**If something is off:**

- *Server view says "Inspector is off"*: the app server isn't up or wasn't started by `npm run demo`.
- *`oprf-demo` prints `429`*: the made-up operator subject used its 10 evaluations for today at that holder; reset.
- *Seal says sealed matching isn't available*: fewer than two holders are up, or the matcher fails attestation (7b left
  tampered? run the restore block).
- *Port in use*: `lsof -nP -iTCP:4000,4011,4012,4013,4020,5173 -sTCP:LISTEN`.

**Optional extra (2 min): recovery code (W20).** Home → recovery code card → **Set one up** → make one (16 random bytes + CRC-8, 28
Crockford base32 chars). Server view `users`: `key_version` 2, `recovery_auth_hash` (scrypt of
`HKDF(code, "auth")`), `recovery_wrapped_key` (account secret under `HKDF(code, "kek")`). The server can't reset anyone.
Code: [packages/crypto/src/recovery.ts:131](../../packages/crypto/src/recovery.ts#L131).
