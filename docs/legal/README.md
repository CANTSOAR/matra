# Legal documents: what's here and what you still need

**Every document in this folder is a template drafted by a non-lawyer. None has been reviewed by an attorney.** Have a nonprofit and/or open-source attorney review them before anyone signs. Many offer discounted or pro bono help. Start with law-school clinics (for example, Rutgers or Seton Hall) or the fiscal sponsor's legal network. Text in [BRACKETS] must be filled in or decided.

## Documents

| File | Who signs | Purpose |
|---|---|---|
| [advisor-agreement.md](advisor-agreement.md) | Each advisor and the steward | Unpaid advisory role, confidentiality limited to survivor data and unpatched vulnerabilities, no conflicts, no authority to bind, public listing permission |
| [pilot-partner-agreement.md](pilot-partner-agreement.md) | A clinic, coalition or campus and the steward | Terms for an organization that pilots or deploys Matra: synthetic data first, advocate duties, no fees, incident handling, exit |
| [attorney-partner-terms.md](attorney-partner-terms.md) | Each attorney or legal aid office on the platform | Vetting, no referral fees, survivor chooses, attorney's own ethics duties |
| [../ATTORNEY_PARTNER_MOU_TEMPLATE.md](../ATTORNEY_PARTNER_MOU_TEMPLATE.md) | A legal-aid organization, clinic or firm joining the attorney partner program | The fuller attorney instrument: verification, response times, conflicts, data handling, no fee sharing, VCCO disclosure. **Use this for organizations; use the short terms above for individual directory attorneys. Where they differ, the MOU controls.** |
| [trademark-policy.md](trademark-policy.md) | Published, not signed | Stops impostor deployments that could harm survivors while keeping the code open |
| [../../CONTRIBUTING.md](../../CONTRIBUTING.md) | Contributors, via DCO sign-off | Inbound = outbound AGPL, no copyright assignment |

## Sequence

1. **Now (no lawyer needed):** LICENSE, GOVERNANCE, SECURITY, security whitepaper and threat model, synthetic-data demo.
2. **Before advisor outreach:** get a lawyer to review the advisor agreement, and secure a fiscal sponsor (the advisors' institutions will ask who they are advising).
3. **Before any pilot:** a lawyer reviews the pilot and attorney terms. Resolve the legal blockers in [../LEGAL_RESEARCH_MEMO.md](../LEGAL_RESEARCH_MEMO.md) section 9 (directory vs. referral service vs. legal service plan; privilege design).
4. **Before real data:** every gate in [GOVERNANCE.md](../../GOVERNANCE.md) section 5.

## What you still need (not drafted here)

- **A legal entity.** Fiscal sponsorship first, then your own 501(c)(3) if it grows. Sponsors also bring liability coverage and bookkeeping. Compare sponsors on fees (commonly 5–15%), whether they accept software projects, and whether they allow an AGPL project with these governance commitments.
- **Terms of use and a privacy notice for survivors.** Plain language, candid about subpoenas, metadata, no recovery of lost passphrases, and 18+ only. Counsel must draft these. Model on Callisto's candor.
- **Law-enforcement request guide and transparency-report process.**
- **Insurance.** Cyber liability and D&O or professional liability through the sponsor. Ask what is covered for a security incident involving sensitive data.
- **Funder agreements.** Check VAWA and VOCA confidentiality conditions before accepting any grant that touches survivor data. Funders should receive no individual-level data.
- **Data processing terms with the hosting provider.** Choose one that supports your threat model, and confirm what it logs.
- **Employment or volunteer agreements** if anyone besides you contributes regularly. Have contractors assign or license their work under the AGPL, and keep a record of authorship.
- **Copyright housekeeping.** Today you hold the copyright. DCO contributors keep theirs. You may transfer your copyright to the nonprofit once it exists. Do not put a CLA that allows proprietary relicensing in front of contributors, since it contradicts the governance promise.

## Things the agreements deliberately do not do

- No equity, options or revenue share for anyone. (The memo explains why: for-profit referral and fee sharing is barred in New Jersey, and a for-profit entity can't run attorney routing.)
- No NDA over the code or the project's plans. It's open source. Confidentiality is limited to survivor information and unpatched vulnerabilities.
- No promise of results to survivors, partners or funders.
