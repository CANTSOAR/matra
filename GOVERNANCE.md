# Governance

Matra is public-interest infrastructure. This document is the project's promise to survivors, advocates, attorneys and clinics. If a future steward wants to break one of these commitments, they must first change this file in public, and the change requires the process in section 6.

## 1. Mission

Reduce the burden on survivors of violence by letting them record an account once, keep control of it, and share it only with people they choose.

## 2. Binding commitments

1. **Non-profit.** The project is held by a 501(c)(3) public charity, or by a fiscal sponsor that is one, once one exists. No individual or company owns equity in it or profits from it.
2. **No monetization.** No sale, licensing, rental or analysis of user data. No advertising. No payment from attorneys, insurers, schools, employers or funders that depends on a user's case, referral or data.
3. **No telemetry.** The software contains no analytics, tracking, crash-reporting or third-party call-home. Adding any requires a public change to this document.
4. **Open source.** All code is licensed [AGPL-3.0-only](LICENSE). Hosted deployments must offer their users the source of the version they run.
5. **No fees from fee flows.** The project takes no share of attorney fees, victim-compensation awards, or court awards. The project receives only grants and donations that are not tied to individual cases.
6. **Survivor control.** A survivor can permanently delete everything she stored (crypto-shredding; built) and export it (built: a client-side "Download my data" zip; status corrected 2026-10-07 as a factual fix, not a change to the commitment). Sharing needs her explicit consent, and she can revoke it. Revocation stops future access; it cannot recall copies an attorney already downloaded.
7. **Honest claims.** We describe what the system does, including its limits and what the operator can still see. Marketing language that overstates protection is treated as a bug.
8. **Synthetic data until cleared.** No real survivor data is stored in any deployment until the gates in section 5 are met.
9. **If we shut down,** we give users and partners at least 90 days' notice and a way to export their data, and we release the operator-side deployment materials so another steward can run it. Because the server cannot read records, shutdown must never strand users or expose them.
   *Proposed amendment (open for comment under §6 from 2026-10-07; not yet adopted):* replace this item with a reference to [docs/SUCCESSION_AND_DATA_PROMISE.md](docs/SUCCESSION_AND_DATA_PROMISE.md) D1–D11. That adds no deletion without individual consent except at her request or after full end-of-life notice, notice through her chosen safe contact method, opt-in-only migration to a named successor, no silent confidentiality downgrade, and a ring-fenced wind-down reserve.

## 3. Roles

- **Steward.** The legal entity that holds the project's name, domain, accounts and funds. Until a non-profit or fiscal sponsor exists, the founder (Aryan Malik) is the interim steward and holds these in trust for the mission described here.
- **Maintainers.** People with commit access. Appointed and removed by the steward on the advice of the advisory council. Must sign off commits under the [DCO](CONTRIBUTING.md).
- **Advisory council.** Unpaid domain experts (legal, clinical, advocacy). Advises. Does not direct operations and has no authority over finances. Defined in [docs/legal/advisor-agreement.md](docs/legal/advisor-agreement.md).
- **Survivor voice.** At least one council seat, or a standing review panel, is held by a person with lived experience or by a survivor-led organization, compensated for their time when funds allow.

## 4. Conflicts of interest

- Anyone with a decision role (steward, maintainer, council member) discloses in writing any financial interest in a vendor, funder, law firm or competing product connected to Matra, and recuses from related decisions.
- No attorney or firm on the platform may have a say in the vetting rules that govern their own listing.
- Funders get no access to individual-level data and no vote on product decisions.

## 5. Gates before real data

Real survivor data is not accepted until all of these are done and published:

1. Independent cryptographic and application security audit, with findings fixed or disclosed.
2. Written threat model reviewed by an outside cryptographer (see [docs/SECURITY_WHITEPAPER.md](docs/SECURITY_WHITEPAPER.md) and [docs/threat-model.md](docs/threat-model.md)).
3. Review by licensed counsel in each launch jurisdiction, covering the open questions in [docs/LEGAL_RESEARCH_MEMO.md](docs/LEGAL_RESEARCH_MEMO.md) section 9.
4. A signed pilot agreement with an organization that has trained advocates.
5. Resolution of the known blockers in the [Security Whitepaper](docs/SECURITY_WHITEPAPER.md) section 6 and [threat model](docs/threat-model.md): escrow redesign (survivor-facing match probing is already closed; operator-side identifier testing is not), open-ended shares, 18+ enforcement, attorney-verification procedure, client-code integrity.
6. A published law-enforcement request guide and incident-response plan.
7. *Proposed (open for comment under §6 from 2026-10-07; not yet adopted):* a named Designated Successor under a signed succession MOU, an adopted reserve policy (at least 6 months operating, plus a funded wind-down reserve), and counsel review of the Succession and Data Promise. See [docs/SUSTAINABILITY_PLAN.md](docs/SUSTAINABILITY_PLAN.md).

## 6. Changing this document

Changes to sections 2 or 5 need: a public proposal open for at least 30 days, written advice from the advisory council, and the steward's approval. Section 2.1 to 2.5 may not be changed to permit profit-taking or data monetization at all. If a future steward attempts that, the AGPL lets anyone fork, and this document is the benchmark for whether a fork or the original is the faithful continuation.

## 7. Transparency

Publish annually: funding sources and amounts, number and type of legal requests received (and how we responded), security incidents, and audit results. *(Proposed addition, §6 process: the operating reserve in months and the current sustainability trigger level.)*
