# Matra Documentation

Matra is a survivor-controlled, zero-knowledge documentation tool with a consent-based path to pro-bono attorneys. Its working tagline is *a one-touch justice pipeline*. These documents are written for lawyers, legal-aid organizations, advocates, funders, and security reviewers.

> Nothing in this folder is legal advice. All legal analysis must be reviewed by licensed New Jersey and New York counsel.

| Document | Audience | What it covers |
|---|---|---|
| [PITCH_ONE_PAGER.md](PITCH_ONE_PAGER.md) | Lawyers, funders | Problem, what the MVP does today, honest limits, pilot phases, asks |
| [LEGAL_RESEARCH_MEMO.md](LEGAL_RESEARCH_MEMO.md) | Counsel, advisors | Confrontation and hearsay, discoverability and privilege, VCCO fees ($275/hr verdict), mandatory reporting, UPL and referral rules, privacy, escrow, and a table of blueprint corrections |
| [SECURITY_WHITEPAPER.md](SECURITY_WHITEPAPER.md) | Security reviewers, partners | Architecture, key hierarchy, ledger, threat model, known limitations, roadmap |
| [PRD.md](PRD.md) | Team, partners | Personas, user stories, functional and non-functional requirements, out of scope, pilot metrics, open questions |
| [ATTORNEY_PARTNER_MOU_TEMPLATE.md](ATTORNEY_PARTNER_MOU_TEMPLATE.md) | Partner orgs, counsel | Draft MOU covering verification, response times, conflicts, confidentiality, no fee sharing, data handling, termination (template; counsel review required) |
| [DEMO_SCRIPT.md](DEMO_SCRIPT.md) | Presenter | 10-minute live demo with talking points and honest answers to hard questions |
| [research/brief-fields.md](research/brief-fields.md) | Engineering, counsel | Source research behind the incident-summary PDF and NJ VCCO draft fields |
| [research/outreach-and-governance-playbook.md](research/outreach-and-governance-playbook.md) | Founder | Advisor outreach and governance |
| [threat-model.md](threat-model.md) | Engineering | Known-weakness tracker (W1 to W12); a supplement to the Security Whitepaper, which is primary |
| [legal/](legal/README.md) | Counsel, partners | Other agreement templates: advisor agreement, attorney partner terms, pilot partner agreement, trademark policy |

*Which attorney document to use:* [ATTORNEY_PARTNER_MOU_TEMPLATE.md](ATTORNEY_PARTNER_MOU_TEMPLATE.md) is the full instrument for legal-aid organizations, clinics and firms joining the partner program (verification, response times, data handling, fees). [legal/attorney-partner-terms.md](legal/attorney-partner-terms.md) is a short standard-terms version for an individual directory attorney. They cover the same duties; where they differ, the MOU controls. Counsel may merge them into one instrument before either is used.

The repository front door is the [root README](../README.md); project governance, license and security policy are in [GOVERNANCE.md](../GOVERNANCE.md), [LICENSE](../LICENSE) (AGPL-3.0-only) and [SECURITY.md](../SECURITY.md).

**Before pitching, read the "Corrections to blueprint claims" table in [LEGAL_RESEARCH_MEMO.md §8](LEGAL_RESEARCH_MEMO.md#8-corrections-to-blueprint-claims-consolidated).**

Citations and reading notes for the background sources are in [`compiled_resources/`](../compiled_resources/README.md). Third-party full texts are kept locally and not committed.
