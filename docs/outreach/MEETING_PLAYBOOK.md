# Matra: Meeting Playbook

*How to run a 20-minute first meeting with each audience. Updated 2026-10-07.*

Companion docs: [DEMO_SCRIPT.md](../DEMO_SCRIPT.md) (full 10-minute demo and setup), [FAQ_FOR_LAWYERS.md](FAQ_FOR_LAWYERS.md), [EMAIL_TEMPLATES.md](EMAIL_TEMPLATES.md).

---

## Rules for every meeting

1. **Open with the disclaimer, and mean it.** *"Everything you'll see uses invented data. Matra is a prototype. It hasn't had an independent security audit, and nothing here is legal advice."*
2. **Fictional data only.** Never demo with, discuss, or accept real survivor stories. If someone starts sharing a real case, gently stop them: *"I'd rather not hear identifying details. We aren't set up to protect them yet."*
3. **Listen more than you pitch.** Aim for 40% you, 60% them. The discovery questions matter more than the demo.
4. **Say the limits before they ask.** Experts in this space have seen many naive apps. Credibility comes from naming the weaknesses yourself.
5. **Words to never use:** "subpoena-proof," "bulletproof," "admissible," "prosecutable pattern," "tamper-proof," "mathematically impossible," "HIPAA-compliant," "the state pays our lawyers," "Police Evidentiary Brief." Use: "Incident Summary in the Survivor's Own Words"; "the operator can't decrypt content; she can still be compelled"; "a lead, not evidence."
6. **One specific ask per meeting**, sized to what they can say yes to this week.
7. **Within 24 hours:** send the thank-you (template in EMAIL_TEMPLATES.md), the promised materials, and log what you learned.

### The three standard demo moments (pick per audience below)
- **A. Intake:** skip a question; show a sensory, non-leading prompt; show the **disclosures** section; Quick Exit.
- **B. Outputs:** the Incident Summary PDF (verbatim sections, evidence inventory with hashes, ledger references, notices) and the NJ VCCO draft (9-month report rule, 5-year deadline, $275/hr up to $10k only if eligible).
- **C. Consent and control:** share to a verified demo attorney with the verbatim consent text; attorney opens it; survivor sees the access in her log; revoke; access denied.
- **D. (Only if asked, or for security and legal audiences) Matching:** two survivors name the same Instagram profile in different forms. Both still see "Sealed". `counselor.demo` sees one matched group. Frame it as a demo-only prototype following Callisto's published design (DEMO_SCRIPT step 10).

### Default 20-minute agenda (adjust per audience)
| Time | Segment |
|---|---|
| 0:00-2:00 | Thanks, disclaimer, why you're reaching out to *them* specifically |
| 2:00-5:00 | Discovery questions (their work, pain points) |
| 5:00-11:00 | Demo: the three moments for this audience |
| 11:00-16:00 | Their reactions; hard questions |
| 16:00-19:00 | The specific ask; what it would cost them in time |
| 19:00-20:00 | Agree next step and date; ask who else you should talk to |

---

## 1. Pro-bono attorney (victims' rights, family, civil)

**Goal:** a reviewer of the consent text, warnings, and summary format now; a willing partner attorney later, once the gates are met.

**Show:** B (Incident Summary + VCCO draft), C (consent/share/revoke), then A's disclosures section only.

**Discovery questions**
- What does a first meeting with a survivor-client look like now? What facts do you usually lack?
- Which matters do you take: TROs/FROs, SASPA protective orders, victims'-rights representation, VCCO claims, civil claims, Title IX advisor work?
- What in a client-prepared document would worry you (versions, wording, inconsistencies)?
- Would you prefer the client to write before or after talking to you? (Tests the attorney-first route.)
- How do you handle conflicts and secure file storage today?

**The ask:** *"Would you review three short things: the consent text a survivor reads before sharing, the warning language, and a sample Incident Summary? About 60-90 minutes, async. If it ever reaches a pilot, would you consider being one of the first listed attorneys under the MOU?"*

**Hard questions and honest answers**
- *"Can the defense subpoena this?"* Not content from us; we can't decrypt it. We can be compelled to produce metadata. She can be compelled, subject to a motion to quash. Anything given to police is discoverable under R. 3:13-3.
- *"Is any of it privileged?"* Not by default. Communications to counsel for legal advice are. That's why we're building an attorney-first route. We want your view on how to document "prepared at counsel's request."
- *"Every version is kept: impeachment."* Yes, a real trade-off. Plan: unsealed local drafts, deliberate sealing, warnings. What default would you choose?
- *"Does this replace her testimony?"* No. It would be testimonial (*Crawford*/*Davis*). The app isn't a fresh complaint; it helps find who she told.
- *"How do you make money? Do I pay?"* Nonprofit, grants and donations only. No fees, no referral money, no share of VCCO or any fee (RPC 5.4, 7.2(c), 7.3(d)).
- *"VCCO pays $275 an hour?"* Only for VCCO-eligible victims (police report within 9 months, or an RO/SVPO filing per the VCCO FAQ), up to $10k inside the $25k cap. That work isn't pro bono and Matra gets none of it.
- *"What's my liability? What if an abuser poses as a client?"* Your normal duties for matters you accept. Matra verifies attorneys, not clients; screen as you would any prospective client. With escrow, be alert to a "client" whose named person looks like himself.

---

## 2. Legal-aid director / pro-bono program manager

**Goal:** advice on fit and structure; later, a pilot conversation. Never pitch them a finished solution.

**Show:** C (consent/control and access log), B (summary), then a slide or verbal summary of the pilot phases and safeguards.

**Discovery questions**
- Where does intake for survivors bottleneck: screening, fact-gathering, conflicts, follow-up?
- What does your pro-bono pipeline look like for SA survivors? Where do matters drop?
- What do funders (VOCA, OVW LAV, IOLTA) require you to report, and what can't you share?
- What would make your board or general counsel say no to a tool like this?
- Who on your team would need to sign off: IT, ethics counsel, program director?

**The ask:** *"Could you or someone you designate give us a 45-minute structured critique, especially on VAWA/VOCA confidentiality and how this would sit with your grant conditions? If it ever made sense, we'd want to discuss a synthetic-data pilot first (no real data until audit and counsel review)."*

**Hard questions and honest answers**
- *"VAWA confidentiality?"* PII is protected even if encrypted or hashed; consent must be time-limited. Shares are currently open-ended until revoked, which is a known blocker; share expiry is on the pre-pilot list. Funders never get individual-level data.
- *"Is it audited?"* No. An independent audit is a gate before any real data.
- *"Who's behind this? Is there an entity?"* A founder-led open-source project. We're securing a 501(c)(3) fiscal sponsor before any partnership agreement. Governance commitments are public (GOVERNANCE.md).
- *"Sustainability: what if you disappear?"* We've written it down. See the [Succession and Data Promise](../SUCCESSION_AND_DATA_PROMISE.md): no deletion without her consent; at least 90 days' notice in the app and through her chosen safe contact; export always; encrypted data moves to a pre-arranged successor nonprofit only if she opts in; no silent confidentiality downgrade; and a ring-fenced wind-down reserve to pay for all of it. The code is AGPL, so a partner could self-host. *Then ask:* "Would your organization ever consider being named as a successor?"
- *"Is your directory a referral service under RPC 7.3?"* Open question; we're seeking counsel. Survivor chooses; no assignment; no fees. We'd register if required.
- *"Our staff are already stretched."* Agreed, and that's why Phase A is synthetic and asks for a few hours of review, not operations.

---

## 3. Advocate / SANE-SAFE nurse / trauma-informed interviewer (intake-script reviewer)

**Goal:** a reviewer and ideally co-owner of the intake script. This is the first outreach priority.

**Show:** A (intake: skip, sensory prompt, disclosures, Quick Exit), then the safety and device-residue limits. Show C only briefly.

**Discovery questions**
- What do survivors you work with most want to document, and what do they fear writing down?
- Which of these prompts would you change or remove? Which are leading or retraumatizing?
- What's missing for safety planning (shared devices, abusers with phone access)?
- When should a survivor be steered to talk to an advocate or lawyer before writing at all?
- How should we handle someone under 18 who arrives anyway?
- Would working on this affect your confidentiality role or privilege? (Listen carefully.)

**The ask:** *"Would you review the full intake script (about 2 hours), and if it's useful, join a small reviewer group at about 2 hours a month? We'll pay an honorarium once funded, and we'll credit you only with your permission."*

**Hard questions and honest answers**
- *"What if her abuser controls her phone?"* Cryptography can't stop coercion or stalkerware. Quick Exit replaces the page, but browser history, downloads, and an unexpired session can remain. Auto-lock and clearing local storage are on the roadmap. Safety planning with an advocate still matters. This is where we need your guidance.
- *"Does sealing a statement hurt her later?"* It can: versions are kept and can be used to impeach. That's why drafts will stay private and sealing will be deliberate, with warnings.
- *"Will this make me a mandatory reporter or break my privilege?"* Matra doesn't change your obligations. Matra itself has no counselors, so the victim-counselor privilege doesn't attach to Matra. Whether your communications through it could be covered is a question for counsel. We'd never make you an institutional reporter.
- *"Forgotten passphrase?"* Data is gone; nobody can recover it. Optional recovery shares held by a trusted advocate are on the roadmap, with the risk that a share-holder could be subpoenaed.
- *"Is it in Spanish?"* Not yet. Native-speaking advocates would need to review any translation (PRD N13).
- *"Do you use AI?"* Nothing rewrites her words. Voice is transcribed and suggestions are made on her device, and she confirms every one; no AI runs on any server or third-party service. Both are optional. The one-question-at-a-time mode is a fixed script. *Ask them:* would they want the voice option on or off by default?

---

## 4. Law-school clinic (faculty director)

**Goal:** a supervised student project: counsel review of open legal questions (Memo §9), drafting of terms of use and privacy notice, or nonprofit formation help.

**Show:** B (summary + VCCO draft), C (consent), and the Memo §9 open-questions list.

**Discovery questions**
- Does your clinic take on organizational clients or research projects, or only individual representation?
- What's your semester calendar and intake window for projects?
- Which of the open questions fits your clinic best (RPC 7.3 status; privilege design; spoliation warning language; VAWA/VOCA conditions)?
- Are there conflicts with clinic work for county prosecutors or schools?

**The ask:** *"Would the clinic consider one scoped project next semester: a memo on whether our directory is a referral service or legal service plan under RPC 7.3(e), or a review of our survivor-facing consent and warnings? We'd also value a nonprofit/transactional clinic's help with entity formation."*

**Hard questions and honest answers**
- *"Is this a client relationship with the clinic?"* That's for the clinic to decide; we'd sign a standard engagement letter. Until a fiscal sponsor is in place, the client would be the founder as interim steward.
- *"Students can't sign off on legal advice."* Understood; faculty supervision and your normal disclaimers apply.
- *"Has a lawyer reviewed the memo?"* No. That's exactly the gap.
- The full Memo §8 corrections table is good to share: it shows what we've already corrected.

---

## 5. Fiscal sponsor

**Goal:** acceptance as a sponsored project (comprehensive model preferred, so insurance, payroll, and grant administration are covered).

**Show:** a short overview (no long demo): A and C, plus GOVERNANCE.md commitments.

**Discovery questions**
- Do you sponsor software projects? Projects that handle sensitive personal data?
- Which model: comprehensive (Model A) or pre-approved grant relationship (Model C)? Fee?
- What insurance comes with sponsorship (general liability, D&O, cyber)? Does cyber cover a breach of sensitive data?
- Can the project sign agreements (MOUs with legal-aid orgs) under your name? Who signs?
- Are you comfortable with an AGPL-3.0 open-source project and our governance commitments (no telemetry, no data monetization, 90-day shutdown notice)?
- How do government grants (OVC/OVW pass-through) work under your sponsorship?

**The ask:** *"We'd like to apply for fiscal sponsorship. What do you need from us to start?"*

**Hard questions and honest answers**
- *"Does any money come from lawyers or cases?"* No, and governance forbids it: no referral fees, no fee sharing, no share of VCCO or court awards (RPC 5.4(a), 7.2(c), 7.3(d)).
- *"What's your risk profile?"* No real survivor data until an independent audit, counsel review, and a signed pilot agreement. The operator can't decrypt content but holds metadata, and a breach of metadata is still a risk. We'll need cyber coverage and an incident-response plan.
- *"Who's on your board/advisory council?"* Forming. Advisors are unpaid; one seat is reserved for a survivor-led organization or person with lived experience.
- *"Budget?"* See GRANT_BOILERPLATE.md; draft 12-month pilot budget with assumptions labelled.

---

## 6. Security auditor (firm, pro-bono program, or audit-funding program)

**Goal:** a scoped audit (crypto library, server, web client) or a funded path to one.

**Show:** the Whitepaper key hierarchy and threat model rather than the user demo. If they want the product, show D (escrow) and C (share key wrapping).

**Discovery questions**
- What scope would you recommend for a first audit of this size? (Crypto package, server API, web client, deployment.)
- Do you have a pro-bono, discounted, or public-interest program? What's the queue?
- Would you prefer a design review first (escrow redesign to OPRF; web E2EE malicious-update risk) before a code audit?
- What would you need from us: frozen commit, threat model, test environment, point of contact?
- Will the report be publishable? (Governance commits us to publish findings fixed or disclosed.)

**The ask:** *"Could you scope an audit of our crypto package, server, and web client, or tell us which program you'd route us through? We will publish results."*

**Known weaknesses to state up front (from Whitepaper §5-6)**
- Web-based E2EE: a malicious or compromised server can serve modified JavaScript or substitute an attorney's public key. Planned: build hashes, SRI, strict CSP, key-fingerprint UI, later a packaged client.
- Matching: being rebuilt from HMAC+pepper (where the pepper holder could test phone numbers) to RFC 9497 OPRF with a 2-of-2 split key, plus a counselor threshold layer modelled on Callisto (COMPASS 2018). Open issues: Sybil and framing entries, key-server independence, counselor-key misuse, and metadata (π equality classes). Ask for a design review before code audit. Demo-only until then.
- AES-GCM isn't key-committing; ledger hashes cover ciphertext. Planned: plaintext commitments or a key-committing AEAD.
- Ledger isn't externally anchored (operator controls clock).
- Metadata exposure in a database leak: usernames, sizes, timestamps, share relationships, plaintext alias, escrow status.
- In-memory rate limits; no backup strategy yet; no password recovery by design.

---

## 7. Funder (foundation program officer or government grants contact)

**Goal:** permission to submit (LOI, invitation, or fit confirmation) and advice on framing.

**Show:** C (consent and control) and B (summary), briefly. Spend more time on the pilot plan, safeguards, and metrics.

**Discovery questions**
- Does this fit your current priorities: gender-based violence, access to justice, privacy/security, public-interest tech?
- Do you fund pre-pilot work like security audits and expert review, or only pilots with partners?
- Do you fund through fiscal sponsors?
- What evaluation would you expect? What would a successful year look like to you?
- Are there grantees you'd suggest we learn from or partner with?

**The ask:** *"Would you be open to a letter of inquiry for a 12-month pilot-readiness grant covering an independent security audit, advocate review, and legal review?"*

**Hard questions and honest answers**
- *"What's your traction?"* A working prototype, research memo, whitepaper, and draft agreements. No users yet, deliberately: no real data until the safety gates are met.
- *"How will you measure success?"* Safety gates first (0 plaintext incidents, 100% verbatim consent on shares, advocate sign-off), then survivor-reported control (≥80% "felt in control"), attorney response time (≤3 business days median), and intake time saved. Police reports filed and escrow matches are **deliberately not** success metrics.
- *"Sustainability?"* See the [Sustainability Plan](../SUSTAINABILITY_PLAN.md). Access-to-justice and victim-services framing. No funder above about 30%. A 6–12-month reserve before real data. Low burn: open source, counselor time through partner organizations, no campus licensing. No revenue from attorneys, cases, or data. A funded runbook if money fails.
- *"Will we get data?"* Aggregate, de-identified metrics only, with small-cell suppression. Survivor-experience numbers come from an opt-in, unlinkable survey. No individual-level data, ever (plan §6).
- *"Callisto just closed. Why would you survive?"* Use the respectful answer below, then the plan. Never suggest Callisto did something wrong.

---

## "What happened to Callisto, and how is Matra different?" (all audiences)

**Rules.** Be respectful and factual. Never be opportunistic. Never say "we replace Callisto." Never offer to take its users, and never imply its technology failed. Never quote its unpublished outcome statistics (the 5×, 6×, and 11→4-month reporting figures) as evidence for anything. Don't speculate about its internal decisions. If someone shares inside information, don't repeat it. Sources: [research/callisto.md](../research/callisto.md).

**Say (about 45 seconds):**
> "Callisto spent more than a decade proving that survivors want private, survivor-controlled ways to document what happened and to find out they're not alone, and our matching design follows its published research. In July its board announced it's closing because of funding. In their words, adult survivors are left 'without a clear home in anyone's portfolio.' That's a loss for everyone in this field.
> We've tried to learn from its experience rather than compete with it. We serve adults anywhere in NJ and NY, not only people with a .edu address. We don't depend on campus licensing. We frame the work as legal access and victim services, cap any one funder at about 30%, and hold reserves before real data. Our counselor stays an attorney, and we've promised never to change that without telling survivors first. And we've published a succession promise: at least 90 days' notice, export always, and her data moves to a successor only if she says yes."

**If asked "Would you take over Callisto's users or technology?"**
> "That's entirely Callisto's decision and its users' choice. We'd be glad to listen if they ever wanted to talk, but we're not approaching their users and we won't."

**If asked "Isn't Matra just going to close too?"**
> "It might. Any small nonprofit can. That's why we wrote down what happens if we do, and set aside the money to do it properly." Then point to the Succession and Data Promise and the runbook in the Sustainability Plan §7.

---

## Hard-question bank (all audiences)

| Topic | Honest answer (short) | Source |
|---|---|---|
| Subpoena / compelled production | Operator holds ciphertext + metadata only; she can be compelled; police material is discoverable (R. 3:13-3, *Brady*/*Giglio*). | Memo §2 |
| Confrontation Clause | A structured account is likely testimonial; cannot replace testimony. | Memo §1 |
| Fresh complaint | App entry is not one; disclosures section helps find who she told. | Memo §1 |
| Impeachment via versions | Every sealed version is kept; planned private drafts + deliberate sealing + warnings. | Memo §2; PRD N5 |
| Privilege | Not by default; attorney-first route under design. | Memo §2; PRD N1 |
| UPL | Scrivener only; no charges, elements, strategy, or eligibility advice. | Memo §5 |
| Referral fees / fee sharing | None, ever (RPC 5.4(a), 7.2(c), 7.3(d); ACPE 732). Directory status under RPC 7.3(e) is an open question. | Memo §5 |
| VCCO | $275/hr up to $10k in $25k cap, only if eligible (report within 9 months); not pro bono; Matra takes none. | Memo §3 |
| Mandatory reporting | 18+ only; NJ universal child-abuse reporting; partners follow own duties; campus independence. | Memo §4 |
| VAWA confidentiality | Encrypted/hashed PII still covered; time-limited consent needed (share expiry is a blocker). | Memo §6 |
| Matching abuse | Survivors never see matches. An attorney Legal Options Counselor reviews matched groups and contacts each opted-in survivor separately. Sybil, key-server and metadata risks remain. Demo-only. | Memo §7, §7A; Whitepaper §5 |
| Counselor privilege / solicitation | Attorney, not advocate, to preserve privilege. The contact is opt-in and fee-free, so probably not RPC 7.3 solicitation. Counsel to confirm. | Memo §7A |
| Callisto | Respectful, factual. We learned from it, we don't replace it, and we don't approach its users. | This playbook, section above; research/callisto.md |
| Ledger | Integrity, not independent proof of time, until external anchoring. | Whitepaper §4 |
| Audit status | None yet; required before real data. | Whitepaper status line |
| Coercion / device access | Can't be defended cryptographically; Quick Exit has residue limits. | Whitepaper §5 |
| Lost passphrase | Unrecoverable by design; advocate-held recovery shares on roadmap. | Whitepaper §3, §6 |
| Sustainability | Diversified (no funder above about 30%), 6–12-month reserve, low burn, funded wind-down runbook. AGPL. | SUSTAINABILITY_PLAN.md |
| "What if you shut down?" | No deletion without her consent, at least 90 days' notice, export always, opt-in-only successor migration, no silent downgrade. | SUCCESSION_AND_DATA_PROMISE.md |

---

## After each meeting: log template

```
Date / org / person's role (no personal contact details in the repo):
Audience type:
What they do today (pain points heard):
Reactions to demo (verbatim where possible):
Hard questions asked + our answer + whether it satisfied them:
Corrections or risks they raised (file as issues; update Memo/Whitepaper if needed):
Ask made / their answer:
Next step + date:
Who else they suggested:
```

Keep contact logs outside the public repository; this is an open-source repo.
