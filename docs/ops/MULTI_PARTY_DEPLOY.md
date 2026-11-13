# Running Matra across several organizations

*Status: the single-machine Compose stack works today with fictional data. Running the pieces at separate
organizations is described here but has not been done yet. Nothing in this file is legal advice. The legal questions
it raises are linked by question ID.*

Matra's security story depends on **no single organization holding everything**. Sealed matching needs 2 of 3 OPRF
key shares, and the matcher runs code that anyone can check. So each piece is a separate service, and in a real
deployment each one runs at a different organization.

## The five services

All five run from one Docker image (the [Dockerfile](../../Dockerfile)); the command picks the role.

| Service | Who runs it (target) | Holds | Receives | Reachable from |
|---|---|---|---|---|
| **app** (`apps/server/src/index.ts`) | Matra | Ciphertext, account metadata, the ledger, keyed phone hashes. Serves the website. | Everything from browsers | The internet (port 8080 behind https) |
| **holder 1–3** (`apps/server/src/holder-server.ts`) | Three separate institutions, e.g. Matra, a university, ISRG/Divvi Up | One OPRF key share each, its own quota DB | Blinded elements and a short-lived token signed by the app server | The app server only |
| **matcher** (`apps/matcher/src/server.ts`) | A confidential-computing host (see [HOSTING.md](HOSTING.md)) | Match tags, routing states, the signed counselor roster | Tags and states, after the app server has checked its attestation | The app server only |

What crosses the wire, and why each party learns little:
- **App to holder:** a blinded element. The holder can't tell which identifier it is. One holder alone can't compute a
  tag; any 2 of 3 can, which is why the shares must sit at organizations that won't collude (Q-016, Q-040).
- **App to matcher:** pseudorandom tags and two US states. Before sending, the app server checks the matcher's
  attestation, a signed hash of its code, against the value pinned at build time. **The attestation is simulated
  today** (W18).
- **Browsers to app:** only ciphertext for content. Browsers never talk to a holder or the matcher directly.

## Option 1: all five on one machine (demo)

```
npm install
npm run stack:init      # keys and pins into .stack/ (gitignored)
npm run stack:up        # builds the image, starts everything, seeds fictional accounts once
open http://localhost:8080            # Server view: http://localhost:8080/inspector
npm run stack:logs      # follow all five services
npm run stack:down      # stop, keeping data
npm run stack:reset     # stop, delete all volumes, new keys, start again
```

The logins are the same as `npm run demo` ([DEMO_SCRIPT.md](../DEMO_SCRIPT.md)). What this gives you over
`npm run demo`:

- **Separate processes:** each service runs in its own container, with its own volume and database.
- **Separate secrets:** each container mounts only its own secrets (`compose.yaml` `secrets:`). Key holder 2 never
  sees share 1, and the matcher never sees the pepper.
- **Private network:** only the app server's port is published. The holders and the matcher are reachable only on the
  private `matra` Docker network.

It is still a demo:
- **One dealer had every key.** `stack:init` generated every key on one machine, so for a moment one place held
  everything. Real deployments still use a dealer today, but each share goes to a different organization afterwards
  (below). Distributed key generation, where no dealer exists, is future work.
- **Plain http inside the network.** The services talk plain http over the private network. The server allows that
  only when both `MATRA_DEMO_MODE=1` and `MATRA_DEMO_PRIVATE_NETWORK=1` are set (`plainHttpAllowed` in
  [config.ts](../../apps/server/src/config.ts)). Otherwise production refuses plain http to anything but loopback.
- **Demo stand-ins:** mock SMS, simulated attestation, and the Server view are all on.

## Option 2: each organization runs its own piece

Each organization builds the **same tagged release**, verified against the published hash (see
[DEPLOY_GOVERNANCE.md](DEPLOY_GOVERNANCE.md) §4). Then it runs one role behind its own https endpoint, such as Caddy
or a cloud load balancer with a real certificate.

**Key ceremony** (once, offline):
1. Run `npm run -w @matra/server oprf-ceremony -- --threshold 2 --holders 3 --out <dir>` on a machine nobody keeps.
2. Send `oprf-share-i.key` to holder institution *i* only, over a channel only it can read. Then delete `<dir>`.
3. Publish the public output: the group key, the share public keys, and the holder-token public key. These are pins,
   not secrets.

**Key holder *i*** (each institution):
```
docker run -d --name matra-holder -p 127.0.0.1:8080:8080 \
  -e NODE_ENV=production -e MATRA_HOLDER_INDEX=i \
  -e MATRA_OPRF_SHARE_FILE=/run/secrets/share -v /secure/oprf-share-i.key:/run/secrets/share:ro \
  -e MATRA_HOLDER_TOKEN_PUBKEY=<published> -e MATRA_HOLDER_DB_PATH=/data/holder.db -v holder-data:/data \
  <image> node --import tsx apps/server/src/holder-server.ts
```
Put it behind https at, for example, `https://oprf.<institution>.org`, and accept traffic only from Matra's app server.

**Matcher** (confidential-computing host): the same pattern with `apps/matcher/src/server.ts`, its own key, token and
DB. On real hardware the attestation comes from the platform (Nitro or Confidential Space) instead of
`MATRA_ATTESTATION_PLATFORM_KEY`. That swap is not built yet ([HOSTING.md](HOSTING.md) "Work needed").

**App server** (Matra):
- `MATRA_OPRF_HOLDER_URLS=https://oprf.a.org,https://oprf.b.org,https://oprf.c.org`
- `MATRA_MATCHER_URL=https://matcher…`
- its own pepper, phone-hash key and holder-token signing key
- the pins, both at runtime and as build arguments for the website, so survivors' browsers check them too

[DEPLOY.md](../DEPLOY.md) lists every variable.

**What each organization must agree to** (open legal questions):
- Who is a custodian that can be subpoenaed: Q-040
- Whether a holder can be compelled to use its share: Q-016
- Public-records exposure for a public university: Q-041
- Joint control of code changes: Q-044

## Not done yet

- **No real attestation.** Matcher attestation is simulated; the Nitro or Confidential Space adapter isn't built.
- **No distributed key generation.** The dealer ceremony is still a single point in time.
- **Shared-secret auth for the matcher.** The app server proves itself to the matcher with a shared bearer token, not
  mutual TLS. Holders verify tokens signed by the app server.
- **No reproducible builds.** Nothing yet lets each organization independently reproduce the same image hash (W4).
- **No monitoring.** There's no alerting on unusual evaluation volume at a holder.
