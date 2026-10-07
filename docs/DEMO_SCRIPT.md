# Matra: 10-Minute Live Demo Script

**Audience:** attorneys, legal-aid leaders, advocates, funders · **Presenter:** founder · **Data:** fictional only

> Say at the start and mean it: *"Everything you'll see uses invented data. Matra is a prototype. It hasn't had an independent security audit, and nothing here is legal advice."*

---

## Setup (before the meeting)
- Start the server and seed demo accounts (`npm run seed -w @matra/server`). The seed creates:
  - Survivor **`jane.demo`**, passphrase `demo-survivor-passphrase`, with no records. The demo creates them live.
  - Verified attorneys **`attorney.nj1`** (NJ), **`attorney.ny1`** (NY), and **`attorney.nj2`** (NJ/NY), all with passphrase `demo-attorney-passphrase`. Names and organizations are labelled "Demo —".
  - Legal Options Counselor **`counselor.demo`**, passphrase `demo-counselor-passphrase`, for the matching demo. *(Comes with the matching rebuild. If the seed doesn't print it yet, skip step 10 or describe it verbally.)*
  - *If the seed names have changed, use whatever the seed script prints.*
- Prepare a second survivor account for the escrow demo (for example, register `sam.demo` live, or pre-create it).
- Have a **sample photo with GPS EXIF** on the desktop (for example, one taken with a phone that has location on) and an EXIF viewer ready (`exiftool` or an online viewer used **only** with the demo photo).
- Use two browser profiles: Profile A for the survivor, Profile B for the attorney and, later, the counselor.
- Have a fictional intake narrative ready to paste (below). **Never use a real account.**

**Fictional sample data**
- Preferred name: "J." · State: NJ · County: Middlesex · Date: "around March 14, not sure of the exact day"
- Free recall: *"We were at a party at a coworker's apartment. I remember the music was too loud and the hallway smelled like cologne. He said he'd walk me to my car…"*
- Disclosure: told roommate "M." by text the next morning, and said "something bad happened last night."
- Person responsible: "R.", coworker, Instagram `@demo_handle_123`, phone `(555) 010-0199`. Matching opt-in: yes. Safe contact for the counselor: "email, weekday afternoons" (fictional).
- Second survivor (`sam.demo`): names the same Instagram profile as a URL, `https://www.instagram.com/Demo_Handle_123/`, and opts in to matching.

---

## Flow (≈10 minutes)

### 1. Why this exists (0:00-0:45)
**Talking points:** the reporting gap ([BJS 2024](https://bjs.ojp.gov/document/cv24.pdf): about a quarter of rape and sexual assault victimizations are reported); retelling and the fear of records being used against her; slow legal-aid intake. *"Matra is built around one rule: she decides, every time."*

### 2. Intake chatbot (0:45-2:30)
- Log in as `jane.demo`. Point out that the passphrase never leaves the browser.
- Walk through a few questions. **Skip one** on purpose: *"Every question is skippable. There's no progress pressure."*
- Show a sensory prompt ("What do you remember hearing?"). *"These are non-leading prompts, adapted from cognitive-interview research. We want advocates to review and own this script."*
- Show the **disclosures** section. *"In New Jersey, who she told and when can matter a lot. That's the fresh-complaint doctrine. The app isn't a fresh complaint. The people she told might be witnesses to one. We help her remember who they are."*
- After her own account, show the short **"A few more details"** part (force, pressure on the neck, alcohol or drugs). *"These closed questions only come after free recall, every one is skippable, and 'not sure' is always an answer. If she says yes or not sure to neck pressure, she gets a gentle note to tell a medical provider, because strangulation can injure without visible marks."*
- *"There's no AI. Her words are stored exactly as typed."*

### 3. Quick Exit (2:30-3:00)
- Click **Quick Exit** (or press Esc three times). The page jumps to a neutral site.
- **Talking point:** *"If someone walks in, one click. We're also honest that browser history and downloads can remain. Safety planning with an advocate still matters."*
- Log back in.

### 4. Seal and ledger (3:00-4:00)
- Finish and **seal** the record. The intake says "Sealing…" and only says sealed once the server has confirmed it. Show the ledger entry: sequence number, content hash, timestamp, previous hash.
- Open **Verify ledger** to show `ok`.
- **Talking point:** *"This is an append-only hash chain. Any change to history breaks it. Today it runs on our server and isn't yet anchored to an outside timestamp authority. That's on the roadmap. So today it shows integrity, not independent proof of time."*

### 5. Evidence with EXIF stripping (4:00-5:00)
- Show the sample photo's GPS in the EXIF viewer. Upload it.
- Show that the stored copy has its metadata stripped and has a SHA-256 hash.
- **Talking point:** *"Location is removed before the file leaves her device. That protects her, but it also means the stored copy is a derivative. We tell her to keep the original and her phone. Non-image files aren't stripped, and we warn about that."*

### 6. "Incident Summary in the Survivor's Own Words" and VCCO draft (5:00-6:00)
- Open **Incident summary** in the menu and download it (`matra-incident-summary-<date>.pdf`).
- If asked about the earlier "police brief": *"We renamed it. It's her account in her own words, prepared by her. It isn't legal work product and it isn't prepared for police."*
- Point out "Survivor answered: …" lines. Her answers to closed questions are quoted as she gave them, including "I'm not sure". Point out the verbatim "her own words" sections, the disclosures, the evidence list with hashes, the ledger references, and the "not legal advice / not a sworn statement" notices.
- Show the VCCO draft. *"It states the real rules: a police report within 9 months, filing within 5 years, and attorney reimbursement of $275 an hour up to $10,000 only if she's eligible."*
- **Talking point:** *"It's generated on her device. We never see it. And nothing is ever sent to police automatically."*

- Optional: on **Your vault**, **Download my data** produces one .zip decrypted on her device (records, evidence, manifest with hashes). It warns first that the file is not encrypted.

### 7. Share to an attorney (6:00-7:00)
- Choose **`attorney.nj1`** from the verified list. Read the consent text aloud. Select the scope (record plus evidence). Share.
- **Talking point:** *"The record key is re-encrypted to this attorney's public key. The exact consent text is hashed into the ledger. Only verified attorneys appear."*

### 8. Attorney view and access log (7:00-8:00)
- In Profile B, log in as `attorney.nj1`. Open the incoming share and decrypt. Download the photo.
- Back in Profile A, show the survivor's **audit log**: "Demo — Alex Rivera, Esq. opened your shared case file at …" and the evidence download.
- **Talking point:** *"She sees every access. That transparency is part of trust."*

### 9. Revoke (8:00-8:30)
- As the survivor, **revoke**. In Profile B, refresh: access is denied.
- **Talking point (be explicit):** *"Revocation stops future access. It can't un-download what the attorney already saved. That's why the partner MOU has deletion duties."*
- Log out of `attorney.nj1` in Profile B before step 10.

### 10. Confidential matching (8:30-9:30), **framed as a prototype**
- As `jane.demo`, opt in to matching for the Instagram handle `@demo_handle_123`. Read the consent line aloud: if someone else names the same person, a Legal Options Counselor, who is a licensed attorney, may open this entry and contact her by the method she chose. Status: *Sealed*.
- As `sam.demo`, name the same profile in a different form: `https://www.instagram.com/Demo_Handle_123/`. Her status also says **Sealed**. That is on purpose. Neither survivor ever sees a match.
- In Profile B, log in as **`counselor.demo`** (`demo-counselor-passphrase`). The counselor sees **one matched group** with two entries: the two forms normalized to the same profile. The counselor sees each survivor's chosen contact method and jurisdiction, and nothing about either survivor's account or records.
- **Talking points:**
  - *"Only unique identifiers are matched: phone, email, social handles. Never names, because names aren't unique enough. The handle and the URL are normalized to the same profile on her device before anything is sealed."*
  - *"Neither survivor sees a match. If they could, the person himself could sign up, type in his own handle, and find out he's been named."*
  - *"The counselor is an attorney, and that's deliberate. Callisto's design rested on attorney-client privilege. When Callisto moved this role to advocates in 2026, it told users privilege no longer applied. We commit never to make that kind of change without telling survivors first ([Succession and Data Promise](SUCCESSION_AND_DATA_PROMISE.md) D7). The counselor reviews the group for anything implausible, then contacts each survivor separately, by the method she chose, once, with no pressure. Introductions happen only if both say yes."*
  - *"A match is a lead, not evidence. In New Jersey other-acts evidence goes through Rule 404(b), and there's no equivalent of federal Rule 413."*
  - **Say this before anyone asks:** *"This follows the published Callisto design: an OPRF with the key split across two servers, so the server never sees the raw handle. It's demo-only. Before real use it needs an outside cryptographic review, account verification so one person can't create fake accounts to force a match, and counsel's view on privilege and on the solicitation rules for a counselor contacting survivors who opted in."*

### 11. Close and ask (9:30-10:00)
*"We're asking for three things. Attorneys willing to pilot under our MOU. Advocates to co-own the intake script. And a security auditor. We take no fees and no referral money, ever. And because survivors deserve tools that outlast the organization that built them, we've published a succession and data promise: at least 90 days' notice, export at all times, and nothing moves without her yes."*

---

## Anticipated hard questions, with honest answers

**"Can a defense attorney subpoena this?"**
They can't get content from *us*, because we can't decrypt it. We can be compelled to produce metadata: that an account exists, when it was used, and who it shared with. *She* can be ordered to produce her records, subject to a motion to quash. If she gives anything to police, it's discoverable, and inconsistencies are impeachment material. We say this to her up front.

**"Is anything she writes privileged?"**
Not by default. A personal journal isn't privileged just because it's encrypted. Communications with her lawyer for legal advice are. That's why we're building an **attorney-first** path, where her lawyer can ask her to prepare her account for counsel. Licensed counsel needs to confirm how far that goes.

**"Does this help with 'she waited too long' arguments?"**
It can corroborate. A sealed, timestamped record may rebut a claim of *recent* fabrication if it predates the alleged motive (N.J.R.E. 803(a)(2); *Tome*). It doesn't replace her testimony, and the app isn't a fresh complaint.

**"Every saved version is kept. Doesn't that create impeachment material?"**
Yes, and that's a real trade-off. Next phase: private drafts stay on her device and unsealed, sealing is a deliberate step, and warnings explain the trade-off. We want counsel's view on the right default.

**"Is your ledger admissible? Who certifies it?"**
Hashes support authentication. They don't overcome hearsay or confrontation objections. We'll need a named custodian, a documented procedure, and external timestamp anchoring before we'd suggest anyone rely on it in court.

**"Is this the unauthorized practice of law?"**
The software organizes her own words and gives information, not advice. It doesn't suggest charges, elements, or strategy. That's why the document is called "Incident Summary in the Survivor's Own Words" (formerly "Police Evidentiary Brief"), with a footer that says it was prepared by the survivor, isn't legal advice, and wasn't reviewed by an attorney unless indicated.

**"How do you make money? Do attorneys pay?"**
No. Nonprofit, grant-funded. No referral fees and no fee sharing; NJ RPC 5.4, 7.2(c), and 7.3(d) forbid it. Counsel is reviewing whether our directory needs registration under RPC 7.3(e).

**"Who verifies attorneys? What if an abuser poses as one?"**
Today, an admin verifies manually. The pilot adds bar-record checks, organizational attestation, MFA or passkeys, annual re-verification, and the MOU. Every access is visible to the survivor, and shares will expire.

**"What if she forgets her passphrase?"**
Her data is gone. That's the cost of us being unable to read it. On the roadmap: optional recovery shares held by an advocate she trusts.

**"What if her abuser has her phone or forces her to unlock it?"**
Cryptography can't stop coercion. Quick Exit, auto-lock, and safety planning help. We recommend a safe device. This is a key area where we want advocates' guidance.

**"Is it audited?"**
Not yet. An independent audit is a gate before any real survivor uses it.

**"Mandatory reporting? Minors? Campus?"**
Adults only. Registration requires "I am 18 or older". Anyone who says they're under 18 sees a kind message with Childhelp (1-800-422-4453) and RAINN (800-656-4673), and nothing is saved. It's self-attestation, not verification. New Jersey requires *anyone* to report suspected child abuse. For campuses, Matra stays independent of the school, so it never creates Title IX "actual knowledge" or Clery CSA reports. Schools would get de-identified aggregates at most.

**"What happened to Callisto, and how is Matra different?"**
Answer with respect, and keep to the facts. *"Callisto spent more than a decade proving survivors want this, and our matching design follows its published research. Its board announced in July 2026 that it's closing for lack of funding, and said adult sexual assault has no clear home in funders' portfolios. That's a loss for the field. We're not replacing it. We've tried to learn from it: adults anywhere in NJ and NY rather than .edu only, no campus licensing, diversified funding with reserves, an attorney counselor we won't silently downgrade, and a written succession promise so survivors are never stranded."* Don't comment on its users, don't use its unpublished statistics, and don't speculate about its internal decisions. Sources: [research/callisto.md](research/callisto.md).

**"What if Matra runs out of money?"**
At least 90 days' notice in the app and through her chosen safe contact, export throughout, encrypted data moves to a named successor nonprofit only if she opts in, and everything else is destroyed at the end. That's funded by a ring-fenced wind-down reserve. See [SUCCESSION_AND_DATA_PROMISE.md](SUCCESSION_AND_DATA_PROMISE.md) and [SUSTAINABILITY_PLAN.md](SUSTAINABILITY_PLAN.md).
