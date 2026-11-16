# Matra

Matra is open-source, non-profit software for adult (18+) survivors of sexual assault. A survivor writes down what happened once, through a warm, trauma-informed intake: she can start anywhere and tell it her way, typed or spoken (transcribed on her device), or answer one question at a time. Every question can be skipped, and her words are never rewritten. Her record and evidence files are encrypted in her browser, so the server stores only ciphertext and the operator cannot read them from what it stores. (The browser code comes from the same server, so an operator who changed it could capture her passphrase; see the status note below.) She can then choose to share her sealed account, with explicit and revocable consent, with a verified attorney, plus any evidence files she ticks one by one. The attorney's portal decrypts only what she shared, and the share screen lists exactly what that is. While she writes, her draft is saved over in a separate encrypted slot (no new ledger entry each time); sealing keeps only her account as a permanent version. Matra also generates an incident-summary PDF and an NJ VCCO draft on her device, keeps a hash-chain integrity ledger, and lets her download all her data at any time. A demo-only matching feature (built along the lines of Callisto's published OPRF design) matches unique identifiers, never names. It is off by default and off for the pilot (`MATRA_MATCHING=off`): a pilot build and server contain none of it. When it is on, matches are never shown to survivors, and a Legal Options Counselor, a licensed attorney, sees the matched group and contacts each survivor who opted in. A match is a lead, not evidence.

**Status: MVP / pre-pilot prototype. Do not use it with real survivor data.** It has had no independent security audit and no review by licensed counsel. The integrity ledger is self-hosted and not yet externally anchored. Matra's server cannot decrypt records, but the survivor (and anyone she shares with) can still be compelled to produce them, and metadata is visible to the operator. The operator also delivers the app's code, so someone who controlled the server could ship a changed app that captures a passphrase (threat model W4); nothing yet lets a survivor check the code she was served. Passphrases are six random words made on her device; the strength rules are enforced by the app, not the server. See [docs/SECURITY_WHITEPAPER.md](docs/SECURITY_WHITEPAPER.md) and [docs/threat-model.md](docs/threat-model.md).

## Commitments

Written down so they can be held against us. Full text in [GOVERNANCE.md](GOVERNANCE.md).

- No business model, no equity, no sale of data, no advertising, no analytics or telemetry.
- Licensed under [AGPL-3.0-only](LICENSE). Every deployment must offer its users the source.
- The server stores survivor records only as ciphertext, so the operator cannot read them from what it stores. Where the operator can still see something (metadata), and the limit that it also serves the app's code (threat model W4), we say so in the security docs.
- Attorney routing is run on a non-profit basis with no referral fees and no fee sharing ([docs/LEGAL_RESEARCH_MEMO.md](docs/LEGAL_RESEARCH_MEMO.md) section 5).
- Survivors' data is theirs. We never delete it without her individual consent. She gets at least 90 days' notice of any shutdown or material change, export always, migration to a named successor only if she opts in, and no silent confidentiality downgrade. See [docs/SUCCESSION_AND_DATA_PROMISE.md](docs/SUCCESSION_AND_DATA_PROMISE.md) (parts still need board and counsel adoption).
- Built to last: diversified funding, reserves before real data, and a funded wind-down plan ([docs/SUSTAINABILITY_PLAN.md](docs/SUSTAINABILITY_PLAN.md)).
- No claims we can't back. If a document here overstates something, that is a bug. Please file it.

## Quickstart

Requires Node.js and npm.

```sh
npm install
npm run seed     # creates fictional demo accounts (synthetic data only)
npm run dev      # API on http://localhost:4000, web app on http://localhost:5173
                 # sealed matching is off by default; MATRA_MATCHING=on npm run seed / npm run dev turn it on
npm test
npm run typecheck
```

Open http://localhost:5173.

Production build (the API server also serves the built web app, under a strict CSP):

```sh
MATRA_DEMO_MODE=1 MATRA_MATCHING=off npm run build    # production builds must say MATRA_MATCHING=off|on
NODE_ENV=production MATRA_MATCHING=off MATRA_PEPPER=$(openssl rand -hex 32) npm start   # http://localhost:4000
npm run e2e          # browser suites: the demo path (matching on), the pilot path (off), the demo stack
npm run e2e:prod     # the demo path against a production build (build it with MATRA_MATCHING=on)
```

Deploying a demo instance (Docker / Render): see [docs/DEPLOY.md](docs/DEPLOY.md).

### Demo accounts (created by `npm run seed`)

| Username | Role | Passphrase |
|---|---|---|
| `jane.demo` | Survivor (no records; the demo creates them) | `demo-survivor-passphrase` |
| `attorney.nj1` | Verified attorney (NJ) | `demo-attorney-passphrase` |
| `attorney.ny1` | Verified attorney (NY) | `demo-attorney-passphrase` |
| `attorney.nj2` | Verified attorney (NJ/NY) | `demo-attorney-passphrase` |
| `counselor.demo` | Legal Options Counselor (sealed-matching demo, only seeded with `MATRA_MATCHING=on`; sign in via "I’m an attorney" or `/counselor`) | `demo-counselor-passphrase` |

All names and organizations are fictional and labelled "Demo —". For a guided walkthrough, see [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

### Configuration

| Variable | Purpose |
|---|---|
| `MATRA_DB_PATH` | SQLite database location (default `apps/server/data/matra.db`) |
| `MATRA_DRAFTS_DB_PATH` | Her draft slots' own SQLite file (default `<name>-drafts.db` beside `MATRA_DB_PATH`). Back it up, restore it and delete it together with the main database. See docs/DEPLOY.md |
| `MATRA_DRAFT_MODE` | `slot` (default): her draft is saved over as she writes, and only a seal is a kept, ledgered version. `keep-versions`: every draft save is also kept as a record. Which one launches is for counsel (docs/DEPLOY.md) |
| `MATRA_PEPPER` | Server secret (used for enumeration-resistant fake login salts), at least 32 characters. **Required in production.** In development one is generated in `apps/server/data/pepper.key` |
| `MATRA_CORS_ORIGINS` | Comma-separated allowed origins (rarely needed; the Vite dev server proxies `/api`) |
| `MATRA_DEMO_BANNER` | `1` shows a "DEMO — do not enter real information" banner on every page (production serving) |
| `MATRA_TRUST_PROXY` | Number of reverse-proxy hops to trust for client IPs (rate limiting), e.g. `1` on Render |
| `MATRA_MATCHING` | `off` or `on`: sealed matching in this deployment, for the server and the web build. Off (the default outside production, and the pilot setting) leaves it out entirely and refuses every matching variable below. **Required in production.** See docs/DEPLOY.md |
| `MATRA_OPRF_SHARE_<i>` (or `_FILE` variants), `MATRA_OPRF_THRESHOLD`, `MATRA_OPRF_HOLDERS` | With `MATRA_MATCHING=on`: the sealed-matching threshold OPRF key shares (default 2-of-3), from `npm run -w @matra/server oprf-ceremony`. In production run each holder as its own process (`npm run -w @matra/server holder`; see docs/DEPLOY.md) and keep shares secret; in development a ceremony runs once into `apps/server/data/oprf-share-<i>.key`. `MATRA_REQUIRE_OPRF_KEYS=1` makes a missing share fatal |
| `MATRA_OPRF_PER_DAY`, `MATRA_OPRF_LIFETIME` | Per-account rate limits on matching evaluations (defaults 10/day, 50 lifetime) |
| `MATRA_AUTO_VERIFY_ATTORNEYS` | `1` auto-verifies new attorney accounts. **Development only.** Otherwise use `npm run -w @matra/server verify-attorney -- <username>` |

Don't deploy it for real use yet.

## Repository map

| Path | What |
|---|---|
| `packages/crypto` (`@matra/crypto`) | WebCrypto library for browser and Node: key derivation, record encryption, key wrapping for sharing, escrow identifiers, key fingerprints |
| `packages/shared` (`@matra/shared`) | Shared types and API data contract |
| `apps/server` (`@matra/server`) | Express + SQLite API. Stores ciphertext, a hash-chain ledger, shares and escrow entries. Seed and attorney-verification scripts |
| `apps/web` (`@matra/web`) | React client: intake, vault, evidence upload with image metadata stripping, consent sharing, attorney portal, incident-summary and VCCO PDFs, data export, Quick Exit |
| `docs/` | Product, security and legal documents. Start at [docs/README.md](docs/README.md) |
| `docs/legal/` | Agreement and policy templates. **Not yet lawyer-reviewed** |
| `compiled_resources/` | Citations and notes on the source material behind the research (third-party full texts are not committed) |

## Documentation

| Document | For |
|---|---|
| [docs/PITCH_ONE_PAGER.md](docs/PITCH_ONE_PAGER.md) | Lawyers and funders: problem, what the MVP does, honest limits, asks |
| [docs/SUCCESSION_AND_DATA_PROMISE.md](docs/SUCCESSION_AND_DATA_PROMISE.md) | Survivors and partners: what happens to her data if Matra changes or closes |
| [docs/SUSTAINABILITY_PLAN.md](docs/SUSTAINABILITY_PLAN.md) | Board, funders, fiscal sponsor: revenue mix, reserves, privacy-preserving impact measurement, the "if funding fails" runbook |
| [docs/research/callisto.md](docs/research/callisto.md) | Everyone: what Callisto built, why it closed, and what Matra learned |
| [docs/LEGAL_RESEARCH_MEMO.md](docs/LEGAL_RESEARCH_MEMO.md) | Counsel and advisors. Research memo, **not reviewed by a lawyer** and not legal advice |
| [docs/SECURITY_WHITEPAPER.md](docs/SECURITY_WHITEPAPER.md) | Security reviewers: architecture, key hierarchy, ledger, threat model, roadmap |
| [docs/threat-model.md](docs/threat-model.md) | Engineering: known-weakness tracker (supplement to the whitepaper) |
| [docs/PRD.md](docs/PRD.md) | Requirements, scope, pilot metrics |
| [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) | Presenter's 10-minute demo |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Deploying a demo instance (Docker, Render), production serving and CSP |
| [docs/ATTORNEY_PARTNER_MOU_TEMPLATE.md](docs/ATTORNEY_PARTNER_MOU_TEMPLATE.md) | MOU template for legal-aid organizations and attorney partners |
| [docs/legal/README.md](docs/legal/README.md) | Advisor, pilot-partner and attorney terms, trademark policy |

## Get involved

- Advisors (legal, clinical, advocacy): see [docs/legal/advisor-agreement.md](docs/legal/advisor-agreement.md).
- Organizations that want to pilot it: see [docs/legal/pilot-partner-agreement.md](docs/legal/pilot-partner-agreement.md).
- Developers: see [CONTRIBUTING.md](CONTRIBUTING.md).
- Found a vulnerability: see [SECURITY.md](SECURITY.md). Please don't open a public issue.
