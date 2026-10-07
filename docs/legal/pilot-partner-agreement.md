# Pilot Partner Agreement (template)

> **Template. Not reviewed by a lawyer.** For legal clinics, advocacy coalitions, victim-services agencies and campuses that want to test or deploy Matra. Fill in [BRACKETS]. Key constraints come from [../LEGAL_RESEARCH_MEMO.md](../LEGAL_RESEARCH_MEMO.md). Counsel for both sides should review, and a partner that receives VAWA or VOCA funds needs to check those grant conditions before signing.

**Between** [STEWARD LEGAL NAME] ("**Matra**") **and** [ORGANIZATION] ("**Partner**"). **Effective date:** [DATE]. **Pilot period:** [DATES].

## 1. Purpose and phase

Partner will evaluate Matra in the following phase. The parties may move to the next phase only by a signed written addendum.

| Phase | Data | Gate |
|---|---|---|
| **A. Synthetic** | Invented data only. No real survivor information of any kind | Default and required at signing |
| **B. Supervised real use** | Real survivor data, with Partner's trained advocates | Only after every gate in [GOVERNANCE.md](../../GOVERNANCE.md) section 5 is met and published, including independent audit and counsel review |

During Phase A, neither party may enter, upload, screenshot or discuss real survivor details in Matra, in support channels or in feedback.

## 2. What Matra provides

- The software under [AGPL-3.0-only](../../LICENSE), free of charge.
- [Documentation, onboarding for staff, and a security contact.]
- A written description of what the system does and doesn't protect ([threat model](../threat-model.md)), which Partner may share with its clients.
- Prompt notice of security incidents and known vulnerabilities that affect Partner's users.

## 3. What Partner agrees to

1. **Honest explanation to survivors.** Explain that Matra is a pilot, that records may still be reachable by court order from the survivor or anyone she shares with, that there is no password recovery, and that it is for adults only. Partner will use materials Matra supplies, or its own, that are consistent with the threat model.
2. **18+ only.** Don't enroll anyone under 18. If staff learn of suspected child abuse, Partner follows its own mandatory-reporting duties (including N.J.S.A. 9:6-8.10 where applicable).
3. **Trained advocates.** Only trained staff or volunteers help survivors use Matra. They receive Matra's safety guidance (quick exit, device safety, shared-device risks).
4. **Independence from the institution.** For campuses: Partner will ensure that Matra isn't set up so that a Title IX coordinator or Campus Security Authority learns of reports through Matra, unless counsel has reviewed that design.
5. **Attorney matters.** Partner won't ask Matra to select, rank or pay attorneys, or to share fees. Attorney listings follow [attorney-partner-terms.md](attorney-partner-terms.md).
6. **No funder data.** Partner won't send individual-level data, hashes or ciphertext from Matra to funders, and will confirm its grant conditions allow its use of Matra.
7. **Feedback without stories.** Feedback will be about the product, not survivors' personal accounts, unless a survivor has given informed, written, time-limited, voluntary consent, and not as a condition of services.

## 4. No fees, no money for data

No fees are payable by Partner to Matra or by Matra to Partner under this agreement. Neither party may charge survivors, attorneys or funders for access to Matra, or sell, rent or share data about its users. If Partner wants to host its own deployment, it carries its own hosting cost and must comply with section 6.

## 5. Data and privacy

- Matra does not hold the keys that decrypt records, but it can see metadata (described in the [Security Whitepaper](../SECURITY_WHITEPAPER.md) and threat model), and survivors and attorneys can still be compelled to produce records. Before Phase B, Matra will minimize that metadata, with server logs kept [30] days and IPs truncated (not yet implemented in the MVP).
- Partner will not try to defeat the encryption or access a survivor's records except with her authorization through the normal sharing feature.
- **Legal requests.** If either party receives a subpoena, warrant or other legal request concerning a Matra user, it will tell the other party and the affected user unless legally prohibited, will object to over-broad requests where reasonable, and will produce only what the law requires. Matra will publish its guide and an annual transparency report.
- **Incidents.** Each party notifies the other within [72] hours of discovering a security incident that may affect Matra users, and will cooperate on notice to users.

## 6. If Partner hosts its own deployment

Because the code is AGPL, Partner may run its own copy. Doing so requires:

- Offering its users the source of the version they run (AGPL section 13), including any modifications.
- Not adding analytics or tracking, and not using the Matra name or logo except as permitted in [trademark-policy.md](trademark-policy.md). Modified versions must be labeled as modified.
- Keeping its own server pepper, backups, and security patching, and applying published security fixes within [14] days.
- Telling Matra about its deployment so security advisories can reach it.

## 7. Intellectual property

Each party keeps its own IP. Contributions to the code follow [CONTRIBUTING.md](../../CONTRIBUTING.md) (DCO, AGPL). Partner's staff feedback may be used by Matra without payment. Partner's name or logo is used only with its written permission, per use.

## 8. No guarantee. Limited liability

Matra is provided "as is" for a pilot. [COUNSEL: set warranty disclaimers, mutual limits of liability, and any indemnity or insurance requirements. Check that the fiscal sponsor's insurance covers the pilot. Partner will ask about breach liability.] **Matra is not legal, medical or counseling advice**, and nothing in the software creates an attorney-client or counselor-client relationship with Matra.

## 9. Term and exit

Either party may end this agreement on [30] days' written notice, or immediately for a material breach or a safety concern. On exit: Partner stops using the Matra name for its deployment if it is modified, both delete non-public information received from the other, and Matra gives users of a hosted pilot at least [30] days (90 if real data is involved) to export their records. Survivor control of their own data is unaffected.

## 10. General

Entire agreement on this subject. Changes in writing. Governing law: [STATE]. Neither party is the other's agent. This agreement doesn't create a partnership, joint venture or professional services relationship.

| | Matra | Partner |
|---|---|---|
| Name / title | | |
| Signature | | |
| Date | | |
