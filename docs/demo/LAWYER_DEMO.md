# Matra: lawyer demo (about 12 minutes)

**Audience:** a partner attorney, a legal-aid lawyer or a law-school clinic (faculty and students) · **Presenter:** the
coordinator or founder · **Data:** fictional only · **Slides:** [LAWYER_SLIDES.md](LAWYER_SLIDES.md)

> **Say this first, and mean it:** *"Everything you'll see uses invented data. Matra is a prototype. It hasn't had an
> independent security audit, the matching part is demo-only, and nothing here is legal advice. The legal research
> behind it was written by non-lawyers and hasn't been reviewed by licensed counsel. Reviewing it is what we're here
> to ask you for."*

This is the lawyer's version of the live demo. It uses the same stack, accounts and fictional story as
[DEMO_SCRIPT.md](../DEMO_SCRIPT.md), but it spends less time on how the cryptography works and more on what a lawyer
receives, where she consents, and the legal questions the design raises. Every legal question named here is **open
or under research** in the [legal research bank](../legal-research/INDEX.md). Present each one as a question for the
lawyers in the room, and never as Matra's answer.

---

## Before the meeting

- Start the demo stack with `npm run demo` (use `npm run demo:reset` first for a fresh seed). Open the app at
  http://localhost:5173. The setup, the accounts and the fictional sample story are in
  [DEMO_SCRIPT.md, Setup](../DEMO_SCRIPT.md#setup-before-the-meeting). The accounts used here:
  - Survivors `jane.demo` (empty; you write her story live), `sam.demo` and `morgan.demo` (each has already sealed a
    match on the same fictional profile), `taylor.demo` (named the same profile but said **no** to matching),
    `riley.demo` (already shared her story with `attorney.nj1`).
  - Attorney `attorney.nj1`. Counselors `counselor.ny` and `counselor.nj`.
- Use two browser profiles: **A** for the survivor and **B** for the attorney and the counselor.
- Have a sample PDF downloaded in advance (from `riley.demo`'s share as `attorney.nj1`) in case the live download is
  slow.
- Say what is simulated if anyone asks: the SMS provider is a mock that texts no one, the matcher's "attestation" is
  signed by a demo key on this laptop rather than secure hardware, and every key sits on one machine. A real deployment
  would never run that way.
- **Never** use a real name, a real account, a real phone number or a real case.

---

## The walkthrough

### 1. Why it exists, and the one rule (0:00 to 1:00)

- About a quarter of rape and sexual-assault victimizations are reported to police
  ([BJS 2024](https://bjs.ojp.gov/document/cv24.pdf)). Survivors who come to you have often told their story several
  times already, and they worry about where the record will end up.
- *"Matra is an encrypted place for her to document what happened, at her own pace. She can share it with a lawyer
  she chooses, and if she wants, she can find out privately whether someone else named the same person. It's built
  around one rule: she decides, every time."*
- *"It's a nonprofit and open source. Attorneys pay nothing, and Matra takes no referral fee, no share of fees and no
  share of any award, ever."*

### 2. Her experience (1:00 to 3:00)

Profile A, sign in as `jane.demo`. Open **My story**.

- The first screen asks gently whether she is somewhere safe right now. Answer **Yes**. *"'No' or 'Not sure' brings up
  emergency and hotline numbers first, and she can still keep going."*
- **Start anywhere.** Paste the fictional free-recall text. *"There is no form and no order. A sentence is enough, and
  every question is optional. She can type, speak, or ask to be taken one question at a time."*
- **"Here's what I picked up."** Show the date and the person it found, each with the words it came from. Tap **Keep**
  on one and **Not right** on another. *"Nothing is kept unless she says so. These suggestions only fill in the
  structured parts. Her account itself is stored word for word."*
- Say the house line exactly as written:
  > *"Nothing rewrites her words. Voice is transcribed and suggestions are made on her device, and she confirms every
  > one; no AI runs on any server or third-party service."*
- Open **People you told** and add the roommate. *"In New Jersey, the people she told can matter. The app itself
  isn't a fresh complaint, because that doctrine is about disclosure to a person. But this section helps her and her
  lawyer find the people she did tell."*
- Click **Quick Exit** once to show the page jump to a neutral site, then sign back in. *"We're honest that browser
  history and downloads can remain. Safety planning with an advocate still matters."*

**Consent at this stage:** none is needed, because nothing leaves her device in readable form. Her story is encrypted
in the browser before it is saved.

### 3. Sealing and the integrity ledger (3:00 to 4:00)

- Tap **Look it over**, then **Seal my account**. *"Sealing locks this version. Nothing is sent to anyone, and she can
  keep adding. A later change becomes a new sealed version, and the old one is kept."*
- Show the ledger entry (sequence number, content hash, time, previous hash) and **Verify ledger**.
- *"This is an append-only hash chain, so a change to the history breaks it. Today it runs on our own server and isn't
  anchored to an outside timestamp service. It shows integrity, not independent proof of time, and we'll say that to
  any court-facing audience."*
- *"Keeping every version is a real trade-off. It's good for integrity, and it also creates a record of every change.
  She's told that before she seals."*

### 4. What the lawyer receives (4:00 to 6:30)

**Share.** Still as Jane, choose **`attorney.nj1`** from the verified list.

- Show the scope choices (the sealed account, evidence files, the summary), the expiry (90 days by default; she can
  choose 30 days to a year and renew), and *"Verified by Matra: this key belongs to Demo — Alex Rivera, Esq."* *"Her app
  checked the attorney's key against a list Matra signs offline when it verifies an attorney. She doesn't have to call
  you to compare codes, which also means she doesn't have to tell an attorney she hasn't chosen yet that she's involved
  in anything."* The fingerprint is still there under *Check it yourself (optional)*, and it's in the consent text.
- Read the consent text aloud, under **"Your consent, word for word"**. *"That exact text is stored with the share,
  and its hash goes into the ledger. Only verified attorneys appear in the list."*

**Open.** Profile B, sign in as `attorney.nj1` and open the incoming share (Jane's, or Riley's, which is already there).

- The case file is decrypted in the attorney's browser. Point out the **Verification** panel, in plain words: *"This
  account has not changed since it was sealed on …"*, *"Ledger chain intact through entry N"*. The browser re-hashed
  the account itself and recomputed the ledger chain; nobody has to run a command. **Technical details** under each
  line show the hashes for anyone who wants them.
- Evidence: **Check all 3 evidence files** (Riley's share has three fictional text files). The line turns to *"3 of 3
  evidence files match"*. A file whose hash doesn't match is named in red and its download is withheld.

**The PDF.** Click **Download incident summary (PDF)**. Walk through it:

| Part of the PDF | What to say |
|---|---|
| Title: *Incident Summary in the Survivor's Own Words* | *"It used to be called the 'Police Evidentiary Brief'. We renamed it. It's her account, prepared by her. It isn't legal work product and it isn't prepared for police."* |
| *About This Document* | Not legal advice, not a sworn statement, not reviewed by an attorney unless indicated. |
| *Account, in the Survivor's Own Words* | Verbatim. Software adds labels and structure only. Anything she spoke rather than typed is marked *"Spoken, transcribed on her device, and reviewed by her before saving."* |
| *Force, Strangulation & Substances, as Reported by the Survivor* | Her answers are quoted as given, including "I'm not sure". |
| *Disclosures (Outcry Witnesses)* | Who she told, when, how, and what was said. |
| *Evidence Inventory* | Each file with its SHA-256 hash. Images had location data stripped on her device, so the stored copy is a derivative. She is told to keep the original file and device. |
| *Integrity & Chain of Custody* | Record ID, ciphertext hash, ledger sequence number, entry hash and previous hash. *How to verify* now starts with *"Open <app>/verify and drop this PDF and the evidence files in"*; the manual method (`shasum -a 256`, the entry-hash formula) is a short appendix for experts. |
| *Survivor Attestation* | A declaration ("true to the best of my recollection") with signature lines, unsigned unless she signs it, and a "Received by (agency use)" block. Ask the room whether that block belongs in a document that isn't prepared for police. |

- **Check a file.** Back on *Shared with you*, click **Check a file** and drop in the PDF and the three files you just
  downloaded. *"This is what a clerk, opposing counsel or the client can do with the PDF and files you send them: no
  account, nothing uploaded. The browser reads the record hash out of the PDF, asks our ledger for that one entry, and
  checks the files and the chain itself."* Then drop an edited copy of one file: it is named in red. Be plain about the
  limit: the checker can't read the account, so it can't check the PDF's printed words; the attorney portal does that.
- *"The hashes support authentication and integrity. They don't get anything past a hearsay or confrontation
  objection, and they don't show that the content is true. Before anyone relies on the ledger in court, it needs
  outside timestamp anchoring, a written procedure and a named custodian."*

**The access log, then revoke.** Back in Profile A, open Jane's activity log: *"Demo — Alex Rivera, Esq. opened your
shared case file at …"*. Then **revoke** the share and refresh Profile B to show access denied.

- *"She sees every time you open or download it. Revoking stops future access. It can't take back what you already
  downloaded, which is why the partner MOU has deletion duties."*
- Sign out of `attorney.nj1`.

### 5. The sealed match and the counselor-first staged release (6:30 to 9:30)

Frame it first: *"This is a prototype of repeat-perpetrator matching, following Callisto's published design. It's
demo-only."*

**Her opt-in (Profile A, `jane.demo`).**
- **Home → sealed match**: confirm a phone number. The demo code appears on screen. *"The number is checked once and
  then forgotten. Only a keyed hash and a count are kept, so one phone can't create a crowd of fake survivors."*
- In **The person**, add the fictional Instagram handle. Turn on **Sealed match** and read the explanation aloud.
  Choose **Text message** as her safe contact method and **NY** as where it happened. Seal.
- *"Only unique identifiers are matched: a phone number, an email, a social profile. Names are never matched. And she
  will never see a match in the app. It always says 'Sealed', so the person responsible can't sign up, type in his own
  handle and find out he's been named."* Sam and Morgan named the same profile earlier, and their apps say *Sealed*
  too. Taylor named it but said no to matching, so nothing about it left her vault.

**Who gets the group (Profile B).**
- Sign in as `counselor.nj`: *"No matches right now."* Then as `counselor.ny`: **Match 1 · 3 people**, *"Assigned to
  you because this happened in New York, where you're licensed."*
- *"The counselor is a licensed attorney under contract, a Legal Options Counselor, and not a litigator taking the
  case. A separate matcher assigns each group to one counselor: licensed where it happened if possible, otherwise
  where a survivor lives. The matcher only matches and routes. It never judges whether a case is strong."*

**Stage 1: what matched, then a conflict check.**
- **Open with my private key.** The counselor sees the identifier and, for each person, where it happened, where
  they live and how they prefer to be reached. **No names, numbers or emails yet.**
- Record the conflict check: **"I have no conflict."** Only then do the contact details appear, one card per person,
  never mixed together. *"If the counselor has a conflict, the group goes to another counselor and never comes back to
  them. The check is recorded on the ledger."*
- Be honest: *"This gate is enforced by our server. It isn't cryptographic, so a counselor who colluded with the
  operator could skip it."*

**Stage 2: a full report only with each survivor's yes.**
- For Jane and Morgan, tick *"I've spoken with this person and they expect this request"*, then **Ask for their full
  report**. *"The request never comes out of the blue. The counselor talks to her first."*
- Profile A as `jane.demo`: Home shows *"A legal options counselor has asked to see your report"*. Show who is asking
  (name, organization, key fingerprint checked against the signed counselor roster), what would be shared (evidence unticked by default), and the plain-language
  lines. Tap **Yes, share my report**.
- Sign in as `morgan.demo` and tap **No, don't share**. *"A no is final in Matra for this sealed match. She never has to
  give a reason."*
- Back as `counselor.ny`: Jane's report opens on the counselor's device. Morgan's card says only that she decided not
  to share. *"Nothing about one survivor is ever shown to another. The counselor has no 'share' or 'combine' button.
  Morgan's report was never decrypted by anyone."*

- *"A match is a lead, not evidence. In New Jersey, other-acts evidence goes through Rule 404(b), and there's no
  counterpart to federal Rule 413. That's our research reading, and we'd like yours."*

### 6. What Matra can and cannot see (9:30 to 10:15)

| Matra **cannot** read | Matra **can** see (and could be compelled to produce) |
|---|---|
| Her story, in any version | That an account exists, its alias, when it was created and used |
| Her evidence files | Record counts, sizes and ledger hashes |
| The incident summary PDF (made on her device) | Which account shared with which attorney or counselor, when, and the consent text |
| The identifier she sealed for matching, in readable form | That entries share a matching tag (not what the identifier is) |
| Her phone number after verification (a keyed hash and a count are kept) | Her access log and the ledger |
| Her contact details for the counselor (sealed to the counselor) | Routing states, which only the separate matcher can read |
| Her passphrase or recovery code | Rate-limit keys that are hashed and expire daily. No IP addresses are stored. |

- *"So 'subpoena-proof' is wrong, and we never say it. Matra, as the operator, can't produce her content because it
  can't decrypt it. She can be ordered to produce it, and so can anyone she shares with. Anything she gives police is
  discoverable. We tell her that in plain words before she starts, before she seals, and before she shares."*
- *"Two honest limits. First, this assumes the web code we serve hasn't been tampered with. Second, in this test
  version the people who run Matra could check whether a particular identifier was sealed. Before real use, the key
  that makes that possible has to be split between separate organizations. Her consent screen says so today."*

### 7. Where we need your help (10:15 to 12:00)

*"Every design choice you saw raises a legal question. We've researched them, but none of it has been reviewed by a
licensed attorney. These are the ones we'd most like your view on."* Pick three or four for the room, and leave the
rest as a handout.

**Matching and the counselor**
- Is a counselor contacting a survivor who opted in to that contact, after a match, outside the solicitation rules
  (NJ RPC 7.3, NY Rule 7.3)? What consent and contact protocol makes that clear? ([Q-010](../legal-research/questions/Q-010-is-a-counselor-contacting-an-opted-in-matched-survivor-outsi.md))
- Is a sealed entry, written before any attorney is identified and later opened by the counselor, a privileged
  prospective-client communication? ([Q-011](../legal-research/questions/Q-011-is-a-sealed-matching-entry-opened-by-a-counselor-protected-b.md))
- Is having a matcher assign a group to one counselor by state a lawyer referral? Would letting her choose from a list
  change that? ([Q-017](../legal-research/questions/Q-017-is-automatically-assigning-a-matched-group-to-one-counselor-.md))
- Is the conflict check you saw in the right place? Should contact *methods* also wait until after it, and may the
  counselor enter the identifier in a firm's conflicts database? ([Q-018](../legal-research/questions/Q-018-how-can-an-assigned-counselor-run-a-conflict-check-before-se.md))
- Which state's licence does the counselor need: where it happened, where she lives, or both? The demo routes to the
  incident state first. ([Q-035](../legal-research/questions/Q-035-which-state-s-law-governs-a-report-where-the-survivor-lives-.md))
- If several survivors match and only some consent, may the counselor tell the consenting ones that others exist?
  ([Q-052](../legal-research/questions/Q-052-can-a-matched-survivor-who-has-not-consented-have-her-report.md))
- What must she be told when she opts in, for a later release to a counselor she didn't pick to be valid consent?
  Must the counselor be named at that point? ([Q-023](../legal-research/questions/Q-023-what-consent-must-a-survivor-give-for-her-report-to-be-relea.md))
- Can a nonprofit run by nonlawyers employ or pay the counselor, or does the counselor need to sit in a legal-services
  or partner organization? ([Q-051](../legal-research/questions/Q-051-can-matra-a-nonprofit-run-by-nonlawyers-employ-attorneys-to-.md),
  [Q-022](../legal-research/questions/Q-022-is-matra-s-automated-judgment-that-reports-are-strong-enough.md))

**Sharing with attorneys**
- Is Matra's verified-attorney list a directory, a nonprofit lawyer referral service, or a legal service plan that must
  register? ([Q-001](../legal-research/questions/Q-001-is-matra-a-directory-a-nonprofit-lawyer-referral-service-or-.md))
- If she withdraws after a counselor or lawyer has read her report, can she require them to destroy their copy?
  ([Q-050](../legal-research/questions/Q-050-once-a-report-is-released-to-a-counselor-or-lawyer-can-the-s.md))

**Privilege, discovery and evidence**
- If she writes her account at an attorney's direction, inside Matra, is it privileged or work product?
  ([Q-002](../legal-research/questions/Q-002-are-narratives-a-survivor-writes-in-matra-at-an-attorney-s-d.md))
- What standard applies in New Jersey to a defense subpoena for her non-privileged writings?
  ([Q-003](../legal-research/questions/Q-003-what-standard-applies-in-nj-to-a-defense-subpoena-for-a-surv.md))
- Is a guided report her statement or Matra's for hearsay purposes, and does a transcript of her voice that she reviewed
  count as her own words? ([Q-025](../legal-research/questions/Q-025-if-matra-s-guided-flow-composes-the-report-is-it-the-survivo.md),
  [Q-028](../legal-research/questions/Q-028-does-ai-prompted-gap-filling-in-a-survivor-s-report-create-c.md))
- Can the ledger output be self-authenticated under N.J.R.E. 902, or does it need a witness?
  ([Q-007](../legal-research/questions/Q-007-can-matra-s-ledger-output-be-self-authenticated-under-n-j-r-.md))
- What deletion warning does she need so that deleting her account doesn't create a spoliation problem?
  ([Q-004](../legal-research/questions/Q-004-what-deletion-warning-do-survivors-need-to-avoid-spoliation-.md))

**What we can honestly promise her**
- Can her civil claim go forward without her being a named party, being deposed or testifying? Can a prosecution?
  ([Q-019](../legal-research/questions/Q-019-can-a-survivor-s-civil-claim-be-brought-without-her-being-a-.md),
  [Q-020](../legal-research/questions/Q-020-can-a-criminal-prosecution-proceed-on-a-survivor-s-matra-rep.md))
- If phone verification is required for matching, what records of it could be compelled?
  ([Q-013](../legal-research/questions/Q-013-if-matching-requires-phone-id-or-edu-verification-what-recor.md))

**Close:** *"We're asking for three things: review of the consent text, the warnings and the PDF format; your view on
two or three of these questions; and, if it fits your practice, piloting under our partner MOU once the safety gates
are met. No real survivor uses this until there's been an independent audit, review by licensed counsel in New Jersey
and New York, and a pilot partner with trained advocates."*

---

## Consent at each stage (one-page summary)

| Stage | What happens | Her consent | What she's told |
|---|---|---|---|
| Writing | Encrypted on her device and saved | None needed: nothing readable leaves the device | Matra can't read it, but a court can order **her** to hand it over |
| Sealing | This version is locked, and its hash goes on the ledger | She taps **Seal** | Every sealed version is kept |
| Sharing with an attorney | The record key is re-encrypted to one verified attorney she picks | Scope, expiry, key fingerprint and consent text, word for word | She sees every access. Revoking stops future access but can't recall downloads |
| Sealed match | Her identifier is sealed. A routing state is sealed to the matcher | A separate opt-in, plus a safe contact method | She'll never see a match. A counselor, a licensed attorney, may contact her once |
| Counselor, stage 1 | The counselor sees the identifier, states and contact methods, then contact details after a conflict check | Covered by her opt-in | The counselor reaches out once, privately, by the method she chose |
| Counselor, stage 2 | Her full report goes to that counselor only | A new, separate **yes** for each request, after the counselor has spoken with her | Not shared with anyone else who named the same person. A no is final for this match |
| Deletion | Her ciphertext and wrapped keys are deleted from the live database; ledger hashes remain. Not a crypto-shred: a server backup made earlier still opens with her passphrase | Typed confirmation and her passphrase | Talk to a lawyer before deleting if a case is possible. Copies already downloaded can't be recalled |

Each of these stages raises at least one open question listed in section 7. None of the consent wording has been
reviewed by counsel or by advocates yet.

---

## Hard questions you may get

Short honest answers are in [DEMO_SCRIPT.md, Anticipated hard questions](../DEMO_SCRIPT.md#anticipated-hard-questions-with-honest-answers)
and in [FAQ_FOR_LAWYERS.md](../outreach/FAQ_FOR_LAWYERS.md). For a legal question, answer with what the research
found and its question ID, and say it's open. **Don't** give an opinion on anyone's real case, and don't describe
anything here as legal advice.

## What not to say

- "Subpoena-proof," "admissible," "court-ready," or "replaces her testimony."
- "AI writes her report" or "AI summarizes." Use the house line in section 2 instead.
- "The match proves a pattern." A match is a lead, not evidence.
- Anything about a real person, a real case, or Callisto's users. If Callisto comes up, use the respectful wording in
  [DEMO_SCRIPT.md](../DEMO_SCRIPT.md#anticipated-hard-questions-with-honest-answers).

*Matra is a pre-pilot prototype. Nothing here is legal advice.*
