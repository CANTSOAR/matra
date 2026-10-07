# Matra: Outreach Email and Message Templates

*Updated 2026-10-06. Replace every [bracketed] placeholder. Keep emails under ~200 words. Send to public contact routes listed in [TARGETS.md](TARGETS.md), or to a person who has publicly invited contact for this kind of request.*

## Before you send

- **Personalize one line.** Name something specific they do (a clinic, a report, a program). Generic emails get ignored.
- **One ask, small and specific.** A 20-minute call or a 60-minute async review is easier to say yes to than "join our board."
- **State the stage honestly** in every first message: prototype, invented data only, not audited, not legal advice.
- **Never include** survivor stories, real case details, or claims from the "never say" list in [MEETING_PLAYBOOK.md](MEETING_PLAYBOOK.md) (e.g. "subpoena-proof," "admissible," "bulletproof").
- **Use the current name:** "Incident Summary in the Survivor's Own Words" (not "Police Evidentiary Brief").
- **Attach or link at most two things:** the [one-pager](../PITCH_ONE_PAGER.md) and the doc most relevant to them (FAQ for lawyers, Whitepaper for security, budget for funders).
- **Follow up once after 7-10 business days, then once more after another 2 weeks, then stop.**
- Signature block: `Aryan Malik, Founder, Matra (open-source, nonprofit project; fiscal sponsor [pending / Name]) · [email] · [demo link] · [repo link]`

---

## 1. Pro-bono attorney (victims' rights / family / civil)

**Subject:** Request for a 60-minute review: consent and warning language for a survivor documentation tool

Dear [Mr./Ms./Mx. Last name],

I came across your work on [specific: e.g., protective-order representation for survivors in Essex County / your article on victims' rights in NJ courts]. I'm building Matra, a nonprofit, open-source tool that lets adult sexual-assault survivors in NJ and NY document what happened in their own words, encrypted so that we, the operator, can't read it. If and only if she chooses, she can share it with a verified pro-bono attorney.

It's a prototype that runs on invented data only. It hasn't been audited, and nobody has reviewed our legal analysis yet. That's why I'm writing. Would you be willing to spend about an hour reviewing three short items: the consent text a survivor reads before sharing, our warnings about subpoenas and version history, and a sample Incident Summary? A 20-minute call to walk through them would also work.

We take no fees or referral money of any kind (RPC 5.4, 7.2(c), 7.3(d)). Our one-pager is attached, and our research memo lists the questions we haven't answered.

With thanks,
[Signature]

---

## 2. Legal-aid director / pro-bono program manager

**Subject:** Seeking your critique (not a sales pitch): survivor intake tool, NJ/NY

Dear [Name],

[Organization]'s work on [specific program, e.g., its survivor legal services project] is the reason I'm writing. I'm the founder of Matra, a nonprofit, open-source prototype for adult sexual-assault survivors. It offers scripted, trauma-informed intake with her words stored verbatim, a zero-knowledge vault, and an NJ VCCO application draft. A survivor can choose to share her account, encrypted, with a verified attorney, and she can revoke that sharing at any time.

We are deliberately early. The demo uses invented data, there has been no security audit yet, and we won't touch real survivor data until an audit, review by licensed counsel, and a signed partnership with trained advocates are all in place. Before going further, I would value 20-30 minutes of your critique, or a colleague's. I'd especially like to know whether a tool like this could fit within VAWA and VOCA confidentiality conditions, and what would make your organization say no.

Our one-pager and a short FAQ for lawyers are attached.

Respectfully,
[Signature]

---

## 3. Advocate / SANE-SAFE nurse / trauma-informed interviewer (script reviewer)

**Subject:** Would you review a trauma-informed intake script? (about 2 hours, honorarium once funded)

Dear [Name],

I'm building Matra, a nonprofit tool that helps adult survivors of sexual assault document what happened at their own pace. Every question can be skipped. The prompts are non-leading and sensory, there's no AI, her words are kept exactly as typed, and a Quick Exit button is always available. Nothing is ever sent to police or anyone else unless she chooses.

I'm not an advocate, and I don't want to ship a script that advocates haven't shaped. Would you be willing to review the intake questions (about 2 hours) and tell me what is leading, retraumatizing, or missing, especially around safety and shared devices? If it's useful to you, I'd also welcome you joining a small reviewer group, at about 2 hours a month. We'll offer an honorarium once funded and will credit you only with your permission.

It's a prototype that uses invented data only, so no survivor information is involved. A 15-minute call first is fine too.

With gratitude,
[Signature]

---

## 4. Law-school clinic (faculty director)

**Subject:** Possible clinic project for [term]: RPC 7.3 status of a nonprofit survivor-to-attorney directory

Dear Professor [Last name],

I'm writing about a possible scoped project for the [Clinic name]. I'm the founder of Matra, a nonprofit, open-source prototype. It helps adult sexual-assault survivors in NJ and NY document their experiences in their own words, encrypted so the operator can't read them, and lets them choose to share with a verified pro-bono attorney.

A non-lawyer research memo (attached) identifies open questions that need supervised legal analysis before any real use. Examples: whether a survivor-chooses attorney directory run by a nonprofit is a referral service or a legal service plan under RPC 7.3(e); how to document attorney-directed preparation for privilege; deletion warnings and spoliation; and VAWA/VOCA confidentiality. Any one of these could be a semester project. We also need help with entity formation and survivor-facing terms of use.

The prototype uses invented data only and takes no fees of any kind. Would a 20-minute call be possible to see whether anything fits your clinic's calendar?

Respectfully,
[Signature]

---

## 5. Fiscal sponsor

**Subject:** Fiscal sponsorship inquiry: open-source privacy tool for sexual-assault survivors

Dear [Program / Intake team],

I'd like to ask about fiscal sponsorship for Matra. Matra is an open-source (AGPL-3.0) software project for adult sexual-assault survivors in NJ and NY. It provides scripted, trauma-informed documentation in her own words, encrypted on her device so the operator can't read it, and optional consent-based sharing with a verified pro-bono attorney.

A few facts relevant to your review:
- It's a prototype. It holds no real survivor data and will hold none until an independent security audit and counsel review are complete.
- It has no revenue model and never will: no fees from attorneys, no share of legal fees or victim-compensation awards, and no data monetization. Funding is grants and donations only.
- Our public governance document sets out these commitments.
- Year-one needs: a security audit, advocate and legal review, hosting, and insurance. A draft budget is ready.

Could you tell me whether software projects of this kind fit your program, what model and fee apply, and how to apply? I'd be glad to schedule a call.

Thank you,
[Signature]

---

## 6. Security auditor / audit-funding program

**Subject:** Audit scoping request: WebCrypto zero-knowledge vault for sexual-assault survivors (open source)

Hello [Name / team],

Matra is an open-source (AGPL-3.0) web app for adult sexual-assault survivors. Survivors encrypt their records client-side with WebCrypto: PBKDF2-600k into HKDF, AES-256-GCM per object, and RSA-OAEP-3072 for sharing with an attorney. A Node/SQLite server stores only ciphertext, and an append-only hash-chain ledger records each sealed item. There is also a demo-only identifier-matching "escrow" (PBKDF2 plus a server HMAC pepper) that we know needs to move to an OPRF.

We have not been audited. We will not accept real survivor data until an independent audit is done and its findings are fixed or disclosed. We will publish the results. Our whitepaper lists the known weaknesses: web E2EE malicious-update and key-substitution risk, the pepper holder's ability to test identifiers, ciphertext not being key-committed, an unanchored ledger, and metadata exposure.

Could you help us scope an audit of the crypto package, server, and web client? Alternatively, could you point us to a pro-bono or public-interest program we should apply through? The whitepaper and threat model are linked below.

Thank you,
[Signature] · [repo] · [whitepaper link]

---

## 7. Funder (foundation or government program)

**Subject:** Letter of inquiry request: pilot-readiness grant for a survivor-controlled documentation tool (NJ/NY)

Dear [Program Officer name],

Your [program/priority, e.g., "gender justice" or "trustworthy technology"] focus led me to write. Fewer than a third of rapes and sexual assaults are reported to police: BJS estimates 24% for 2024, and RAINN's multi-year estimate is about 31%. Survivors who do seek legal help retell their stories again and again, and they rightly fear that what they write will be used against them.

Matra is a nonprofit, open-source prototype for adults in NJ and NY. It offers trauma-informed documentation in her own words, encryption that keeps the operator from reading anything, an NJ victim-compensation draft, and sharing with a verified pro-bono attorney only with her explicit, revocable consent. We take no fees from attorneys or cases.

We are seeking [$amount] for a 12-month pilot-readiness phase. That covers an independent security audit, advocate co-design of the intake script, licensed-counsel review, and a synthetic-data pilot with [partner, if confirmed]. Real survivor data comes only after those safety gates are met. Would you be open to a letter of inquiry or a brief call?

Respectfully,
[Signature] · Fiscal sponsor: [Name / pending]

---

## 8. LinkedIn connection notes (300-character limit)

- **Attorney:** "Hi [Name], I'm building a nonprofit, zero-knowledge documentation tool for adult SA survivors in NJ/NY, with consent-based sharing to pro-bono attorneys. It's a prototype on invented data. I'd value your critique of our consent language. Open to connecting?"
- **Advocate:** "Hi [Name], I'm building a trauma-informed, skip-anything documentation tool for adult survivors (no AI, her words verbatim). I want advocates to shape the intake script before anyone uses it. Would you be open to connecting?"
- **Clinic faculty:** "Hi Prof. [Name], our nonprofit survivor-to-attorney tool has open NJ RPC 7.3/privilege questions that might suit a clinic project. Prototype only, no fees. May I connect and send a short note?"
- **Security:** "Hi [Name], open-source WebCrypto E2EE vault for SA survivors, unaudited, and we want it audited before any real data. Could I ask your advice on scoping?"
- **Funder:** "Hi [Name], I'm founder of Matra, a nonprofit, survivor-controlled documentation tool (NJ/NY). Pre-pilot, with safety gates before real data. Could I ask whether it fits your portfolio?"

---

## 9. Follow-up (7-10 business days after the first email)

**Subject:** Re: [original subject]

Dear [Name],

I wanted to follow up briefly on my note below. I know your time is in high demand, so here is a smaller version of the ask: [15 minutes on a call / a quick look at the one-page consent text attached / the name of a colleague who might be better placed].

If this isn't a fit, a one-line reply saying so is completely fine, and I won't follow up again.

With thanks,
[Signature]

**Second and final follow-up (two weeks later):**
"Just closing the loop: I won't write again on this. If timing changes, the project materials are at [link]. Thank you for the work you do."

---

## 10. Post-meeting thank-you (within 24 hours)

**Subject:** Thank you, and what I took away

Dear [Name],

Thank you for your time [today/yesterday] and for your candor. Three things I took away:
1. [Specific thing they taught you, e.g., "Sealing should be opt-in, not the default."]
2. [Specific risk or correction they raised and what you'll do about it.]
3. [Something about their work you'll carry forward.]

As promised, here is [material: script / consent text / whitepaper / budget]. We agreed that [next step] by [date]; I'll [your action] by [date].

If it would be helpful, I'm glad to credit your input, but only with your explicit permission and in the form you prefer. Until then I won't name you or your organization anywhere.

With gratitude,
[Signature]

---

## 11. Warm-introduction request (to someone who already knows you)

"Would you be comfortable introducing me to [Name] at [Org]? Here's a two-sentence blurb you can forward: *Aryan Malik is building Matra, a nonprofit, open-source tool that helps adult sexual-assault survivors document what happened in their own words and choose whether to share it, encrypted, with a pro-bono attorney. It's a prototype on invented data, and he's looking for [advocate / attorney / security] review before any real use.*"
