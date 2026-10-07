# Matra: 10-Minute Live Demo Script

**Audience:** attorneys, legal-aid leaders, advocates, funders · **Presenter:** founder · **Data:** fictional only

> Say at the start and mean it: *"Everything you'll see uses invented data. Matra is a prototype. It hasn't had an independent security audit, and nothing here is legal advice."*

---

## Setup (before the meeting)
- Start the server and seed demo accounts (`npm run seed -w @shield/server`). The seed creates:
  - Survivor **`jane.demo`**, passphrase `demo-survivor-passphrase`, with no records. The demo creates them live.
  - Verified attorneys **`attorney.nj1`** (NJ), **`attorney.ny1`** (NY), and **`attorney.nj2`** (NJ/NY), all with passphrase `demo-attorney-passphrase`. Names and organizations are labelled "Demo —".
  - *If the seed names have changed, use whatever the seed script prints.*
- Prepare a second survivor account for the escrow demo (for example, register `sam.demo` live, or pre-create it).
- Have a **sample photo with GPS EXIF** on the desktop (for example, one taken with a phone that has location on) and an EXIF viewer ready (`exiftool` or an online viewer used **only** with the demo photo).
- Use two browser profiles: Profile A for the survivor, Profile B for the attorney.
- Have a fictional intake narrative ready to paste (below). **Never use a real account.**

**Fictional sample data**
- Preferred name: "J." · State: NJ · County: Middlesex · Date: "around March 14, not sure of the exact day"
- Free recall: *"We were at a party at a coworker's apartment. I remember the music was too loud and the hallway smelled like cologne. He said he'd walk me to my car…"*
- Disclosure: told roommate "M." by text the next morning, and said "something bad happened last night."
- Person responsible: "R.", coworker, Instagram `@demo_handle_123`, phone `(555) 010-0199`. Escrow opt-in: yes.

---

## Flow (≈10 minutes)

### 1. Why this exists (0:00-0:45)
**Talking points:** the reporting gap ([BJS 2024](https://bjs.ojp.gov/document/cv24.pdf): about a quarter of rape and sexual assault victimizations are reported); retelling and the fear of records being used against her; slow legal-aid intake. *"Matra is built around one rule: she decides, every time."*

### 2. Intake chatbot (0:45-2:30)
- Log in as `jane.demo`. Point out that the passphrase never leaves the browser.
- Walk through a few questions. **Skip one** on purpose: *"Every question is skippable. There's no progress pressure."*
- Show a sensory prompt ("What do you remember hearing?"). *"These are non-leading prompts, adapted from cognitive-interview research. We want advocates to review and own this script."*
- Show the **disclosures** section. *"In New Jersey, who she told and when can matter a lot. That's the fresh-complaint doctrine. The app isn't a fresh complaint. The people she told might be witnesses to one. We help her remember who they are."*
- *"There's no AI. Her words are stored exactly as typed."*

### 3. Quick Exit (2:30-3:00)
- Click **Quick Exit** (or press Esc three times). The page jumps to a neutral site.
- **Talking point:** *"If someone walks in, one click. We're also honest that browser history and downloads can remain. Safety planning with an advocate still matters."*
- Log back in.

### 4. Seal and ledger (3:00-4:00)
- Finish and **seal** the record. Show the ledger entry: sequence number, content hash, timestamp, previous hash.
- Open **Verify ledger** to show `ok`.
- **Talking point:** *"This is an append-only hash chain. Any change to history breaks it. Today it runs on our server and isn't yet anchored to an outside timestamp authority. That's on the roadmap. So today it shows integrity, not independent proof of time."*

### 5. Evidence with EXIF stripping (4:00-5:00)
- Show the sample photo's GPS in the EXIF viewer. Upload it.
- Show that the stored copy has its metadata stripped and has a SHA-256 hash.
- **Talking point:** *"Location is removed before the file leaves her device. That protects her, but it also means the stored copy is a derivative. We tell her to keep the original and her phone. Non-image files aren't stripped, and we warn about that."*

### 6. Incident Summary PDF and VCCO draft (5:00-6:00)
- Generate the PDF. Point out the verbatim "her own words" sections, the disclosures, the evidence list with hashes, the ledger references, and the "not legal advice / not a sworn statement" notices.
- Show the VCCO draft. *"It states the real rules: a police report within 9 months, filing within 5 years, and attorney reimbursement of $275 an hour up to $10,000 only if she's eligible."*
- **Talking point:** *"It's generated on her device. We never see it. And nothing is ever sent to police automatically."*

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

### 10. Escrow match (8:30-9:30), **framed as a prototype**
- As `jane.demo`, seal the Instagram handle in escrow. Status: *sealed*.
- Log in as the second survivor (`sam.demo`). Enter the same handle in a different format (`@Demo_Handle_123`). Both entries flip to **matched**.
- **Talking points:**
  - *"Neither survivor learns who the other is. The server never sees the raw handle."*
  - *"A match is a lead, not evidence. In New Jersey other-acts evidence goes through Rule 404(b), and there's no equivalent of federal Rule 413."*
  - **Say this before anyone asks:** *"This version has a known flaw. Anyone could type in a handle and learn it's been reported, including the person himself. And whoever holds our server secret could test phone numbers. Before any real use, matches go to a trained counselor, not to users, and we move to OPRF-based cryptography like Callisto's. Until then this stays demo-only."*

### 11. Close and ask (9:30-10:00)
*"We're asking for three things. Attorneys willing to pilot under our MOU. Advocates to co-own the intake script. And a security auditor. We take no fees and no referral money, ever."*

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
The software organizes her own words and gives information, not advice. It doesn't suggest charges, elements, or strategy. We're renaming "Police Evidentiary Brief" to an incident summary in her own words for that reason.

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
Adults only. New Jersey requires *anyone* to report suspected child abuse. For campuses, Matra stays independent of the school, so it never creates Title IX "actual knowledge" or Clery CSA reports. Schools would get de-identified aggregates at most.

**"How is this different from Callisto?"**
Callisto pioneered encrypted matching with lawyer counselors and stronger cryptography (OPRF with key splitting), mostly for campuses. Our focus is the documentation-to-attorney pipeline in NJ and NY. Our matching is behind theirs and stays demo-only until it catches up.
