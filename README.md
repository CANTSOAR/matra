# Matra

Matra is open-source, non-profit software for adult (18+) survivors of sexual assault. A survivor writes down what happened once, through a scripted, trauma-informed intake (every question can be skipped). Her record and evidence files are encrypted in her browser, so the operator cannot read them. She can then choose to share a record, with explicit and revocable consent, with a verified attorney. The attorney's portal decrypts only what she shared. Matra also generates an incident-summary PDF and an NJ VCCO draft on her device, keeps a hash-chain integrity ledger, and has a demo-only "blind escrow" for perpetrator identifiers. Escrow matches are never shown to survivors. A verified attorney with an active share sees only a count, and should treat it as a lead, not evidence.

**Status: MVP / pre-pilot prototype. Do not use it with real survivor data.** It has had no independent security audit and no review by licensed counsel. The integrity ledger is self-hosted and not yet externally anchored. Matra cannot decrypt records, but the survivor (and anyone she shares with) can still be compelled to produce them, and metadata is visible to the operator. See [docs/SECURITY_WHITEPAPER.md](docs/SECURITY_WHITEPAPER.md) and [docs/threat-model.md](docs/threat-model.md).

## Commitments

Written down so they can be held against us. Full text in [GOVERNANCE.md](GOVERNANCE.md).

- No business model, no equity, no sale of data, no advertising, no analytics or telemetry.
- Licensed under [AGPL-3.0-only](LICENSE). Every deployment must offer its users the source.
- The operator cannot read survivor records. Where the operator can still see something (metadata), we say so in the security docs.
- Attorney routing is run on a non-profit basis with no referral fees and no fee sharing ([docs/LEGAL_RESEARCH_MEMO.md](docs/LEGAL_RESEARCH_MEMO.md) section 5).
- No claims we can't back. If a document here overstates something, that is a bug. Please file it.

## Quickstart

Requires Node.js and npm.

```sh
npm install
npm run seed     # creates fictional demo accounts (synthetic data only)
npm run dev      # API on http://localhost:4000, web app on http://localhost:5173
npm test
npm run typecheck
```

Open http://localhost:5173.

Production build (the API server also serves the built web app, under a strict CSP):

```sh
npm run build
NODE_ENV=production MATRA_PEPPER=$(openssl rand -hex 32) npm start   # http://localhost:4000
npm run e2e          # browser suite against the dev stack
npm run e2e:prod     # the same suite against the production build
```

Deploying a demo instance (Docker / Render): see [docs/DEPLOY.md](docs/DEPLOY.md).

### Demo accounts (created by `npm run seed`)

| Username | Role | Passphrase |
|---|---|---|
| `jane.demo` | Survivor (no records; the demo creates them) | `demo-survivor-passphrase` |
| `attorney.nj1` | Verified attorney (NJ) | `demo-attorney-passphrase` |
| `attorney.ny1` | Verified attorney (NY) | `demo-attorney-passphrase` |
| `attorney.nj2` | Verified attorney (NJ/NY) | `demo-attorney-passphrase` |

All names and organizations are fictional and labelled "Demo —". For a guided walkthrough, see [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

### Configuration

| Variable | Purpose |
|---|---|
| `MATRA_DB_PATH` | SQLite database location (default `apps/server/data/matra.db`) |
| `MATRA_PEPPER` | Server secret for escrow HMACs, at least 32 characters. **Required in production.** In development one is generated in `apps/server/data/pepper.key` |
| `MATRA_CORS_ORIGINS` | Comma-separated allowed origins (rarely needed; the Vite dev server proxies `/api`) |
| `MATRA_DEMO_BANNER` | `1` shows a "DEMO — do not enter real information" banner on every page (production serving) |
| `MATRA_TRUST_PROXY` | Number of reverse-proxy hops to trust for client IPs (rate limiting), e.g. `1` on Render |
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
