# Matra Outreach Kit

*Updated 2026-10-07 (Callisto lessons, succession and sustainability). This kit is for recruiting advocate reviewers, pro-bono attorneys, legal-aid partners, a fiscal sponsor, a security auditor, and funders. The sources of truth are the [one-pager](../PITCH_ONE_PAGER.md), the [Legal Research Memo](../LEGAL_RESEARCH_MEMO.md) (especially the §8 corrections table), the [Security Whitepaper](../SECURITY_WHITEPAPER.md), the [PRD](../PRD.md), the [demo script](../DEMO_SCRIPT.md), the [Succession and Data Promise](../SUCCESSION_AND_DATA_PROMISE.md), the [Sustainability Plan](../SUSTAINABILITY_PLAN.md), and [GOVERNANCE.md](../../GOVERNANCE.md). If this kit ever conflicts with them, they win.*

| File | Use it for |
|---|---|
| [PEOPLE.md](PEOPLE.md) | **Named people** (2026-10-07): top 16 first contacts, published work emails, why each one fits, legislators, press, fellowships |
| [PERSONALIZED_EMAILS.md](PERSONALIZED_EMAILS.md) | Ready-to-edit first emails for the top 12 named contacts, plus the pitch at three lengths |
| [TARGETS.md](TARGETS.md) | Who to contact, why, what to ask, and the public route to reach them (organization level) |
| [EMAIL_TEMPLATES.md](EMAIL_TEMPLATES.md) | Cold emails per audience, LinkedIn notes, follow-ups, and thank-yous |
| [MEETING_PLAYBOOK.md](MEETING_PLAYBOOK.md) | A 20-minute agenda per audience: demo moments, discovery questions, the ask, and hard questions |
| [FAQ_FOR_LAWYERS.md](FAQ_FOR_LAWYERS.md) | Q&A to send to legal audiences |
| [GRANT_BOILERPLATE.md](GRANT_BOILERPLATE.md) | Need statement, objectives, evaluation, safeguards, sustainability, and a budget with assumptions |
| [PILOT_PROPOSAL.md](PILOT_PROPOSAL.md) | A two-page proposal for one pilot partner |
| [LETTER_TO_CALLISTO.md](LETTER_TO_CALLISTO.md) | **Draft only.** A short note of thanks and an offer to listen, for Callisto's board and team. The founder decides whether and when to send it |
| [../SUCCESSION_AND_DATA_PROMISE.md](../SUCCESSION_AND_DATA_PROMISE.md) · [../SUSTAINABILITY_PLAN.md](../SUSTAINABILITY_PLAN.md) | Answers to "what if you disappear?" Share them with fiscal sponsors, funders, and legal-aid directors |

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
- Sharing **only with her explicit, revocable consent**: an encrypted, scoped copy goes to a **verified volunteer or legal-aid attorney** she chooses. She sees every access.

**Since 2026-10-07: what Callisto's closure changes.** Callisto, the closest precedent, announced on 22 Jul 2026 that it is closing because of funding. It was the second closure announcement, after a 2024 reprieve. Revenue fell from $3.93M (2018) to about $0.7–1M, university licensing never exceeded about $208k a year, and its board said adult survivors are left "without a clear home in anyone's portfolio". A 2020 plan to delete older records hurt trust. An April 2026 policy change moved match follow-up from attorney counselors to advocates and removed privilege. (Sources: `docs/research/callisto.md`.) Matra now leads with:
- **Durability.** A [Succession and Data Promise](../SUCCESSION_AND_DATA_PROMISE.md): no deletion without her consent, at least 90 days' notice in-app and through her chosen safe contact, export always, opt-in-only migration to a named successor, and no silent confidentiality downgrade.
- **Sustainability.** A [Sustainability Plan](../SUSTAINABILITY_PLAN.md): access-to-justice and victim-services framing, no funder above about 30%, a 6–12-month reserve plus a ring-fenced wind-down fund before real data, no campus licensing, adults everywhere rather than .edu-only, and impact measured without surveillance.
- **An attorney Legal Options Counselor** for matching, never quietly swapped for a non-attorney.
- **Tone.** Always respectful about Callisto. Never opportunistic, never "we replace Callisto", never solicit its users, never quote its unpublished statistics. See the FAQ and the meeting playbook for the approved answer.

**What's built.** A working MVP that uses **fictional data only**: intake, vault, EXIF stripping, a hash-chain ledger (self-hosted and not externally anchored), PDFs, share and revoke with an access log, crypto-shred deletion, share expiry and renewal, attorney key-fingerprint check, an 18+ gate, a "download my data" export (client-side zip), and a **demo-only** matching feature. Matching is being rebuilt to Callisto-style OPRF with a Legal Options Counselor (`counselor.demo`), and the story-first intake with on-device voice is in progress. Automated browser tests cover the full demo flow, and Docker/Render deploy configs exist for a demo instance (see `docs/DEPLOY.md`).

**What's true and what's not.**
- **Operator access.** The operator can't decrypt content, but it *can* produce metadata. **She** can be compelled to produce her records, and anything given to police is discoverable. Never say "subpoena-proof", "bulletproof", "admissible", "tamper-proof", or "prosecutable pattern".
- **Evidence value.** A record can't replace her testimony, because it would be testimonial. An app entry isn't a NJ "fresh complaint". Matra helps identify the people she told. Every sealed version is kept, which is a risk for impeachment.
- **Matching.** Survivors **never** see matches. In the rebuild, a Legal Options Counselor, who is a licensed attorney, sees the matched group and contacts each survivor who opted in, separately, by her chosen method. Only unique identifiers are matched, never names. A match is a lead, not evidence. Privilege and RPC 7.3 questions are open for counsel (Memo §7A). Matching stays disabled in any pilot.
- **VCCO.** It pays $275/hr up to $10k, within the $25k cap, and **only for eligible victims**, which means a police report within 9 months. That work is not pro bono, and Matra takes **none** of the money.
- **Audit status.** **Not audited.** No real survivor data until the governance gates are met: an audit, counsel review in NJ and NY, a signed pilot partner with trained advocates, and published legal-request and incident-response policies.

**The asks:**
- Advocates to review and co-own the intake script (about 2 hours a month).
- Pro-bono attorneys and clinics to review the consent and warning language and the RPC 7.3(e) structure, and later to join as listed partners.
- A 501(c)(3) fiscal sponsor.
- A security auditor or an audit-funding route.
- A **successor partner**: an established NJ or NY nonprofit willing to be named in the succession plan.
- Pilot-readiness funding of roughly $155k at full scope, including a $10k first tranche of the wind-down reserve ($144k without it), or about $40–60k in a lean version (see the budget assumptions).

**Constraints:**
- Nonprofit only. **No referral fees, no fee sharing, no money from attorneys or cases** (NJ RPC 5.4(a), 7.2(c), 7.3(d); ACPE 732).
- The survivor chooses her attorney; Matra never assigns one.
- 18+ only, because NJ has universal child-abuse reporting.
- Independent of any campus Title IX or Clery reporting structure.
- VAWA confidentiality: no individual-level data goes to funders.
- No telemetry.
- No real survivor stories in outreach.
- Contacts go through public organizational routes, or the published professional email of a named person in their work role (see PEOPLE.md). Never personal addresses or survivor hotlines.
- Founder: Aryan Malik.

**Materials to share or adapt:**
- Pitch deck (14 slides, with live app screenshots): https://claude.ai/artifact/B7FPP3QVS7ewswx2Aoa5PB (private until shared from its Share menu; exports to PowerPoint/PDF).
- In this repo: `docs/PITCH_ONE_PAGER.md`, `docs/LEGAL_RESEARCH_MEMO.md`, `docs/SECURITY_WHITEPAPER.md`, `docs/DEMO_SCRIPT.md`, `docs/ATTORNEY_PARTNER_MOU_TEMPLATE.md`, and this folder (targets, email templates, meeting playbook, lawyer FAQ, grant boilerplate, pilot proposal).
- Live demo: `npm install && npm run seed && npm run dev`, then http://localhost:5173 (survivor `jane.demo` / `demo-survivor-passphrase`; attorney `attorney.nj1` / `demo-attorney-passphrase`; counselor `counselor.demo` / `demo-counselor-passphrase` once the matching rebuild lands).
