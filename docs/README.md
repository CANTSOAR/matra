# Matra Documentation

Matra is a survivor-controlled, zero-knowledge documentation tool with a consent-based path to verified volunteer and legal-aid attorneys. Its working tagline is *a one-touch justice pipeline*. These documents are written for lawyers, legal-aid organizations, advocates, funders, and security reviewers.

> Nothing in this folder is legal advice. All legal analysis must be reviewed by licensed New Jersey and New York counsel.

| Document | Audience | What it covers |
|---|---|---|
| [PITCH_ONE_PAGER.md](PITCH_ONE_PAGER.md) | Lawyers, funders | Problem, what the MVP does today, honest limits, pilot phases, asks |
| [LEGAL_RESEARCH_MEMO.md](LEGAL_RESEARCH_MEMO.md) | Counsel, advisors | Confrontation and hearsay, discoverability and privilege, VCCO fees ($275/hr verdict), mandatory reporting, UPL and referral rules, privacy, escrow, the Legal Options Counselor (privilege, RPC 7.3), and a table of blueprint corrections |
| [legal-research/](legal-research/README.md) | Founder, counsel | Legal question bank: one file per open question, research, and a short ask for counsel. Start at [INDEX.md](legal-research/INDEX.md) |
| [SECURITY_WHITEPAPER.md](SECURITY_WHITEPAPER.md) | Security reviewers, partners | Architecture, key hierarchy, ledger, threat model, known limitations, roadmap |
| [SUCCESSION_AND_DATA_PROMISE.md](SUCCESSION_AND_DATA_PROMISE.md) | Survivors, partners, counsel | Public commitments on data ownership, notice, export, successor migration, no silent confidentiality downgrade. Items marked for board and counsel adoption |
| [SUSTAINABILITY_PLAN.md](SUSTAINABILITY_PLAN.md) | Board, funders, fiscal sponsor | Lessons from Callisto, revenue mix (no funder above about 30%), reserves, low burn, privacy-preserving impact measurement, the "if funding fails" runbook |
| [PRD.md](PRD.md) | Team, partners | Personas, user stories, functional and non-functional requirements, out of scope, pilot metrics, open questions |
| [ATTORNEY_PARTNER_MOU_TEMPLATE.md](ATTORNEY_PARTNER_MOU_TEMPLATE.md) | Partner orgs, counsel | Draft MOU covering verification, response times, conflicts, confidentiality, no fee sharing, data handling, termination (template; counsel review required) |
| [DEMO_SCRIPT.md](DEMO_SCRIPT.md) | Presenter | 10-minute live demo with talking points and honest answers to hard questions |
| [DEPLOY.md](DEPLOY.md) | Engineering | Deploying a demo instance (Docker, Render), the DEMO banner, production CSP |
| [ops/DEPLOY_GOVERNANCE.md](ops/DEPLOY_GOVERNANCE.md) | Engineering, partner orgs | Proposed n-of-m approval for code changes and deploys (branch protection, CODEOWNERS, signed tags, published build hashes), emergency security-fix path |
| [ops/INCIDENT_RESPONSE.md](ops/INCIDENT_RESPONSE.md) | Steward, counsel | **Draft pending counsel.** What a leak would reveal, severity, containment and key rotation, notice planned as if required (Q-055) |
| [ops/HOSTING.md](ops/HOSTING.md) | Engineering | AWS Nitro vs GCP Confidential Space vs Azure for the matcher and key holders; recommendation; what the app host keeps in clear; edge-log settings |
| [ops/EXPORT_CONTROL.md](ops/EXPORT_CONTROL.md) | Counsel | Facts about the public crypto code for the open export-control question (Q-056); no conclusion |
| [design/WEEKEND_MVP.md](design/WEEKEND_MVP.md) | Engineering | Weekend MVP design: threshold OPRF, phone verify-then-forget, matcher, staged release, recovery code, metadata minimization; deviations per feature |
| [design/PER_SUBMISSION_OPRF.md](design/PER_SUBMISSION_OPRF.md) | Engineering, cryptographers | Research note: per-submission OPRF evaluation (deferred) |
| [outreach/README.md](outreach/README.md) | Founder | Outreach kit: targets, emails, meeting playbook, lawyer FAQ, grant boilerplate, pilot proposal, draft letter to Callisto |
| [MVP_STATUS.md](MVP_STATUS.md) | Founder | Build status and gap list |
| [research/callisto.md](research/callisto.md) | Everyone | Callisto's history, closure (22 Jul 2026), sustainability lessons, product and cryptographic design |
| [research/brief-fields.md](research/brief-fields.md) | Engineering, counsel | Source research behind the incident-summary PDF and NJ VCCO draft fields |
| [research/outreach-and-governance-playbook.md](research/outreach-and-governance-playbook.md) | Founder | Advisor outreach and governance |
| [threat-model.md](threat-model.md) | Engineering | Known-weakness tracker (W1 to W21); a supplement to the Security Whitepaper, which is primary |
| [PRIVACY_DATA_INVENTORY.md](PRIVACY_DATA_INVENTORY.md) | Engineering | Every field Matra stores (DB, memory, logs, holders, matcher, device), why, and for how long; no IPs or user agents (W11) |
| [legal/](legal/README.md) | Counsel, partners | Other agreement templates: advisor agreement, attorney partner terms, pilot partner agreement, trademark policy |

*Which attorney document to use:* [ATTORNEY_PARTNER_MOU_TEMPLATE.md](ATTORNEY_PARTNER_MOU_TEMPLATE.md) is the full instrument for legal-aid organizations, clinics and firms joining the partner program (verification, response times, data handling, fees). [legal/attorney-partner-terms.md](legal/attorney-partner-terms.md) is a short standard-terms version for an individual directory attorney. They cover the same duties; where they differ, the MOU controls. Counsel may merge them into one instrument before either is used.

The repository front door is the [root README](../README.md); project governance, license and security policy are in [GOVERNANCE.md](../GOVERNANCE.md), [LICENSE](../LICENSE) (AGPL-3.0-only) and [SECURITY.md](../SECURITY.md).

**Before pitching, read the "Corrections to blueprint claims" table in [LEGAL_RESEARCH_MEMO.md §8](LEGAL_RESEARCH_MEMO.md#8-corrections-to-blueprint-claims-consolidated).**

Citations and reading notes for the background sources are in [`compiled_resources/`](../compiled_resources/README.md). Third-party full texts are kept locally and not committed.
