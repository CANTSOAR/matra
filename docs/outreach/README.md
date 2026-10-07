# Matra Outreach Kit

*Updated 2026-10-06. This kit is for recruiting advocate reviewers, pro-bono attorneys, legal-aid partners, a fiscal sponsor, a security auditor, and funders. The sources of truth are the [one-pager](../PITCH_ONE_PAGER.md), the [Legal Research Memo](../LEGAL_RESEARCH_MEMO.md) (especially the §8 corrections table), the [Security Whitepaper](../SECURITY_WHITEPAPER.md), the [PRD](../PRD.md), the [demo script](../DEMO_SCRIPT.md), and [GOVERNANCE.md](../../GOVERNANCE.md). If this kit ever conflicts with them, they win.*

| File | Use it for |
|---|---|
| [TARGETS.md](TARGETS.md) | Who to contact, why, what to ask, and the public route to reach them |
| [EMAIL_TEMPLATES.md](EMAIL_TEMPLATES.md) | Cold emails per audience, LinkedIn notes, follow-ups, and thank-yous |
| [MEETING_PLAYBOOK.md](MEETING_PLAYBOOK.md) | A 20-minute agenda per audience: demo moments, discovery questions, the ask, and hard questions |
| [FAQ_FOR_LAWYERS.md](FAQ_FOR_LAWYERS.md) | Q&A to send to legal audiences |
| [GRANT_BOILERPLATE.md](GRANT_BOILERPLATE.md) | Need statement, objectives, evaluation, safeguards, sustainability, and a budget with assumptions |
| [PILOT_PROPOSAL.md](PILOT_PROPOSAL.md) | A two-page proposal for one pilot partner |

## Recommended sequence

1. **Fiscal sponsor first** (weeks 0–6). Grants, partner agreements, and advisors' institutions all need a legal home. Apply to Superbloom and Code for Science & Society, and contact Hopewell. Keep Community Partners (next deadline Nov 1) or Social Good Fund as a fallback.
2. **Advocate reviewers of the intake script** (weeks 0–8), working in parallel. Start with county CSVA programs (SAVE of Essex, healingSPACE in Bergen, Middlesex Center for Empowerment) and NJCASA. Their sign-off shapes everything else and gives the project credibility with lawyers.
3. **A law-school clinic** (the Rutgers RBG Women's Rights & Gender Justice Clinic in Newark, which takes matters only through partner referral, or the Seton Hall Center for Social Justice), timed to its semester intake. A clinic can take on the open legal questions (RPC 7.3(e) status, privilege design, spoliation warnings), terms of use, and help forming the entity.
4. **Victims'-rights attorneys and national experts** to review the consent text, warnings, and the Incident Summary: NJ Crime Victims' Law Center for the Incident Summary and VCCO draft, VRLC national TA, and NCVLI/NAVRA. NAVRA's pro-bono portal is also the main attorney-recruitment channel.
5. **Security audit route** once a sponsor is in place: OSTIF intake, a request to OTF Security Lab if the project fits its mission, and a quote from Least Authority. Ask NNEDV Safety Net for a tech-safety review.
6. **Legal-aid pilot partners** only once you have advocate sign-off, counsel input, and an audit plan to show them. In NJ, approach Partners (formerly Partners for Women and Justice), which has a volunteer-attorney program, and the LSNJ DV Representation Project. In NY, approach Sanctuary for Families and NYLAG.
7. **Funders** after the sponsor is confirmed. Near-term money is Craig Newmark Philanthropies (rolling), the GitHub Secure Open Source Fund, and in-kind credits (Project Galileo, Microsoft, DigitalOcean). Federal money is **not** near-term: the FY26 OVC Technology and OVW LAV windows have closed. Plan to join an FY27 application **as a tech partner or subrecipient** of an NJ county SV program or an LAV grantee. VOCA money goes **through partners**. See [TARGETS.md §E](TARGETS.md#e-funders).

## Top 10 first contacts

*Updated 2026-10-06 after verification. Use only the public routes in [TARGETS.md](TARGETS.md).*

1. **Superbloom** (fiscal sponsor). Apply first; it reviews applications quarterly. **Code for Science & Society** is the parallel application.
2. **SAVE of Essex County** (CSVA program). Intake-script review; first pilot candidate.
3. **NJCASA**. Introductions to the county programs and intake-script review.
4. **healingSPACE (Bergen)** or the **Middlesex Center for Empowerment**. A second advocate reviewer.
5. **NNEDV Safety Net**. Tech-safety and threat-model review through its TA Request Form.
6. **NJ Crime Victims' Law Center**. Review of the Incident Summary and VCCO draft.
7. **Rutgers RBG Clinic** (Newark) or the **Seton Hall Center for Social Justice**. A clinic project on RPC 7.3(e) and privilege design.
8. **Partners (NJ)**. Pilot and pro-bono pathway, once advocate sign-off is in hand.
9. **NAVRA / NCVLI**. Victims'-rights attorney recruitment and review of the discoverability analysis.
10. **Craig Newmark Philanthropies**. First funder application (rolling), submitted through the fiscal sponsor. Add the **GitHub Secure Open Source Fund** for audit money.

*Phase 3 (NY), after NJ: The Alliance Against Sexual Violence (never use nyscasa.org), Sanctuary for Families, and NYLAG.*

---

## Handoff brief (paste into a fresh chat)

**What Matra is.** A nonprofit, open-source (AGPL-3.0) web app for **adult (18+)** sexual-assault survivors in **New Jersey and New York**. It has four parts:
- A scripted, trauma-informed intake. It uses **no AI**, every question can be skipped, her words are stored verbatim, and Quick Exit is always available.
- A **zero-knowledge vault**. Content is encrypted on her device and the server stores only ciphertext.
- Outputs generated on her device: an **Incident Summary in the Survivor's Own Words** (renamed from "Police Evidentiary Brief"; never use the old name), an **evidence inventory** (photo location data stripped, SHA-256 hashes), and an **NJ VCCO compensation application draft**.
- Sharing **only with her explicit, revocable consent**: an encrypted, scoped copy goes to a **verified pro-bono attorney** she chooses. She sees every access.

**What's built.** A working MVP that uses **fictional data only**: intake, vault, EXIF stripping, a hash-chain ledger (self-hosted and not externally anchored), PDFs, share and revoke with an access log, crypto-shred deletion, and a **demo-only** matching "escrow".

**What's true and what's not.**
- **Operator access.** The operator can't decrypt content, but it *can* produce metadata. **She** can be compelled to produce her records, and anything given to police is discoverable. Never say "subpoena-proof", "bulletproof", "admissible", "tamper-proof", or "prosecutable pattern".
- **Evidence value.** A record can't replace her testimony, because it would be testimonial. An app entry isn't a NJ "fresh complaint". Matra helps identify the people she told. Every sealed version is kept, which is a risk for impeachment.
- **Escrow.** Survivors **never** see matches. Only the verified attorney with an *active* share sees a **count**. A match is a lead, not evidence. Escrow stays disabled in any pilot.
- **VCCO.** It pays $275/hr up to $10k, within the $25k cap, and **only for eligible victims**, which means a police report within 9 months. That work is not pro bono, and Matra takes **none** of the money.
- **Audit status.** **Not audited.** No real survivor data until the governance gates are met: an audit, counsel review in NJ and NY, a signed pilot partner with trained advocates, share expiry, 18+ enforcement, and published legal-request and incident-response policies.

**The asks:**
- Advocates to review and co-own the intake script (about 2 hours a month).
- Pro-bono attorneys and clinics to review the consent and warning language and the RPC 7.3(e) structure, and later to join as listed partners.
- A 501(c)(3) fiscal sponsor.
- A security auditor or an audit-funding route.
- Pilot-readiness funding of roughly $144k at full scope, or about $40–60k in a lean version (see the budget assumptions).

**Constraints:**
- Nonprofit only. **No referral fees, no fee sharing, no money from attorneys or cases** (NJ RPC 5.4(a), 7.2(c), 7.3(d); ACPE 732).
- The survivor chooses her attorney; Matra never assigns one.
- 18+ only, because NJ has universal child-abuse reporting.
- Independent of any campus Title IX or Clery reporting structure.
- VAWA confidentiality: no individual-level data goes to funders.
- No telemetry.
- No real survivor stories in outreach.
- Contacts go through public organizational routes only.
- Founder: Aryan Malik.
