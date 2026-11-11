# Matra: lawyer deck (slide content)

*Content for the coordinator to turn into a deck. It goes with the live walkthrough in
[LAWYER_DEMO.md](LAWYER_DEMO.md), with about 12 minutes of slides and demo together. Each slide has a title, a
one-line message, 2 to 4 bullets and a speaker note. No real names, no contact details, no screenshots of real data.
Use screenshots from the demo stack only, where every name starts with "Demo —". Nothing in this deck is legal
advice.*

---

## Slide 1: Matra

**Message:** An encrypted place for survivors to document what happened, and share it only when they choose.

- A nonprofit, open-source prototype for adult survivors of sexual violence in New Jersey and New York
- What you'll see: her experience, what a lawyer receives, private matching, and the legal questions we need help with
- Fictional data only · not audited · not legal advice

**Speaker note:** Open with the disclaimer in full: invented data, a prototype, no independent security audit yet,
matching is demo-only, and the legal research hasn't been reviewed by licensed counsel. Say that reviewing it is the
reason for the meeting.

---

## Slide 2: The gap

**Message:** Most survivors never report, and those who come to a lawyer have often told their story many times
already.

- About a quarter of rape and sexual-assault victimizations are reported to police (BJS, 2024)
- Retelling is hard, and survivors fear how a record might be used against them
- Legal-aid intake is slow, and the details fade

**Speaker note:** Keep it to 30 seconds. Cite the source on the slide footer:
bjs.ojp.gov/document/cv24.pdf. Don't add statistics we can't source.

---

## Slide 3: One rule

**Message:** She decides, every time.

- Nothing leaves her device in readable form unless she chooses
- Nothing goes to police, a school or an employer automatically, ever
- Attorneys pay nothing, and Matra takes no referral fee, share of fees or share of any award

**Speaker note:** This slide frames everything after it. Each later slide shows one place where she makes a choice.
The no-fee commitment comes from the governance document and is meant to be binding.

---

## Slide 4: Her experience

**Message:** Start anywhere, in her own words, at her own pace.

- Type, speak, or be asked one question at a time. Every question can be skipped
- Optional topics include who she told, which helps her lawyer find the people she disclosed to
- Quick Exit, an idle lock and a gentle safety check come first

**Speaker note:** Show this live (demo section 2). Read the house line word for word: *"Nothing rewrites her words.
Voice is transcribed and suggestions are made on her device, and she confirms every one; no AI runs on any server or
third-party service."* Put that sentence on the slide as a footer. If fresh complaint comes up, the app isn't one,
because the doctrine is about disclosure to a person, but the "people you told" section helps find those people.

---

## Slide 5: Sealed, with an integrity ledger

**Message:** Sealing locks a version, and an append-only hash chain shows whether anything changed.

- Each sealed version's hash goes on the ledger. Later versions are added, and earlier ones are kept
- Verification works today. Outside timestamp anchoring isn't built yet
- It shows integrity, not independent proof of time and not truth

**Speaker note:** Name the trade-off before anyone else does: keeping every version is good for integrity and also
creates a record of every change, which could be used to impeach. She is warned before she seals. Whether the output
could be self-authenticated is an open question (Q-007).

---

## Slide 6: What you receive

**Message:** A case file she chose to share with you, which you can check yourself.

- *Incident Summary in the Survivor's Own Words* (PDF): her account verbatim, disclosures, evidence inventory with
  SHA-256 hashes, and integrity data with "how to verify" steps
- Your browser checks the record's hash against the ledger, and evidence files are withheld if their hash doesn't
  match
- Stripped photos are derivatives, so she's told to keep the original file and device

**Speaker note:** Show the PDF live (demo section 4). Say that it was renamed from "Police Evidentiary Brief": it's her
account, prepared by her, not legal work product, and not prepared for police. Hashes help with authentication. They
don't overcome hearsay or confrontation objections, and they don't show the content is true.

---

## Slide 7: Consent when she shares

**Message:** She picks the attorney, the scope and the expiry, and she sees every time you open it.

- She chooses from verified attorneys only; her app checks your key against Matra's signed attorney directory, so she never has to call you to compare codes
- The consent text is stored word for word, and its hash goes on the ledger
- Shares expire after 90 days by default. Revoking stops future access but can't recall what you downloaded

**Speaker note:** Read the consent text aloud in the demo. Mention that the partner MOU covers deletion when a share is
revoked or declined. Whether she can require destruction after you've read it is open (Q-050), and so is whether the
verified-attorney list is a referral service (Q-001).

---

## Slide 8: Sealed matching

**Message:** If someone else names the same person, a counselor who is a licensed attorney may contact her privately.
No one else learns of it.

- It's opt-in and matches only unique identifiers (phone, email, social profile), never names
- No survivor ever sees a match. The app always says "Sealed", so the person responsible can't check whether he's been
  named
- A match is a lead, not evidence

**Speaker note:** Say "prototype" and "demo-only" first. The design follows Callisto's published research. Before
matching, she confirms a phone number once, and the number is then forgotten (a keyed hash and a count remain). In
this test version the operators could check whether a particular identifier was sealed. Her consent screen says so,
and real use needs the key split across separate organizations. What could be compelled about verification is Q-013.

---

## Slide 9: Counselor first, then her yes

**Message:** The counselor learns only what's needed to reach her, and sees a full report only after she agrees.

- A separate matcher assigns each group to one counselor, licensed where it happened if possible, otherwise where a
  survivor lives
- Stage 1: the identifier, states and contact methods, then a conflict check, and only then contact details
- Stage 2: a full report only with each survivor's own yes, opened only by that counselor. A no is final, and nothing
  about one survivor is shown to another

**Speaker note:** Show it live (demo section 5): Jane says yes and Morgan says no. Be honest that the conflict-check
gate is enforced by the server rather than by cryptography, and that the matcher's attestation is simulated in the
demo. The counselor gives options counseling. They don't take the case, and the software never judges case strength.

---

## Slide 10: What Matra can and cannot see

**Message:** We can't read her content, but we aren't subpoena-proof, and we never claim to be.

- Matra can't read her story, evidence, PDF, sealed identifier, phone number or passphrase
- Matra can see account existence, times, sizes, who shared with whom, the consent text, the access log and the ledger
- She, and anyone she shares with, can be ordered to produce records. Anything given to police is discoverable

**Speaker note:** Use the table in demo section 6. Two limits to say aloud: this all assumes the web code served to her
hasn't been tampered with, and no IP addresses are stored, but the hosting provider's own logs still need to be
configured to match. She's told about compelled production before she starts, before she seals and before she shares.

---

## Slide 11: Where we need your help

**Message:** Every design choice raises a legal question. We've researched them, and none has been reviewed by
counsel.

- Is the counselor's contact outside the solicitation rules, and is what the counselor opens privileged? (Q-010, Q-011)
- Is assigning a group to one counselor, or listing verified attorneys, a lawyer referral? (Q-017, Q-001)
- Is the conflict check in the right place, which state's licence is needed, and what can consenting survivors be told
  about others? (Q-018, Q-035, Q-052)
- What consent makes a later release valid, and what can we honestly promise her about testifying? (Q-023, Q-019,
  Q-020)

**Speaker note:** Choose three or four questions that fit the room. A clinic may want privilege and discovery (Q-002,
Q-003, Q-025, Q-007) or deletion and spoliation (Q-004). A practitioner may want referral, solicitation and conflicts.
The full list with links is in demo section 7 and in docs/legal-research/INDEX.md. Present each item as a question,
never as our answer.

---

## Slide 12: What we're asking

**Message:** Review it now, and pilot it once the safety gates are met.

- Review the consent text, the warnings and the PDF format
- Take two or three open questions, as a clinic project or an informal read
- Pilot under the partner MOU once the gates are met: an independent audit, licensed counsel in NJ and NY, and a
  partner with trained advocates

**Speaker note:** Close on the commitments: no fees and no referral money, ever, and a succession promise (at least 90
days' notice, export at all times, nothing moves without her yes). Don't put contact details on the slide. The
coordinator adds them separately for each meeting.
