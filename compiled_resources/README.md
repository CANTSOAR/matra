# Compiled Resources

Reading material for the domain list in the original outreach playbook ([`../docs/research/outreach-and-governance-playbook.md`](../docs/research/outreach-and-governance-playbook.md)). Each folder has a `SOURCES.md` with full citations, URLs, per-item notes, and where that playbook was wrong. Where a `SOURCES.md` says "the README", it means the original playbook text, not the current repository README. Not legal advice. For the project's conclusions, see [`../docs/LEGAL_RESEARCH_MEMO.md`](../docs/LEGAL_RESEARCH_MEMO.md) and [`../docs/SECURITY_WHITEPAPER.md`](../docs/SECURITY_WHITEPAPER.md).

**What is committed.** Only original material is in git: this README, each folder's `SOURCES.md`, and `05_advisory_board_governance/CONTACTS.md`. The downloaded third-party files listed in the tables (papers, articles, training bulletins, scraped web pages, court opinions, statutes, the FAST template) are kept locally and excluded by `.gitignore`, because many are copyrighted and the rest can be re-downloaded from the URLs in `SOURCES.md`.

## Folders

| Folder | What's in it |
|---|---|
| `01_trauma_neurobiology_interviewing/` | EVAWI neurobiology bulletin + *Effective Victim Interviewing*, CI-AT manuscript (Fisher/Hopper), Memon 2010 CI meta-analysis, Campbell NIJ 2012 transcript, freeze-response explainer |
| `02_digital_evidence_chain_of_custody/` | Full FRE (Dec 2025), LII pages for 803/901/902 with committee notes, *Lorraine v. Markel*, Grimm/Capra/Joseph 2017, NIST SP 800-86, FIPS 180-4, RFC 3161 |
| `03_legal_ethics_privilege_statutes/` | CVRA, UVCA, NJ VCCO statute + N.J.A.C. 13:75 + forms/FAQ, NJ victims' bill of rights, *Upjohn*, *Smith*, *Miller*, *Carpenter*, FRCrP 17, NJ victim-counselor privilege + *State v. J.G.*, MA *Dwyer* line, ABA 1.6 + Op. 477R |
| `04_cryptographic_escrow_privacy/` | Callisto (Rajan et al. 2018), WhoToo (2019), SAE (Arun et al. 2020), hashing-pitfalls papers, RFC 9497 (OPRF), PSI review, OWASP cheat sheets |
| `05_advisory_board_governance/` | FAST agreement (.docx; equity-based, not for Matra's use), sample advisory charters, `CONTACTS.md` (org pages only) |

## Open these in a browser (free, but blocked automated download)

- Fisher & Geiselman (2010), "The cognitive interview method of conducting police interviews: Eliciting extensive information and promoting therapeutic jurisprudence," IJLP 33:321 — SSRN abstract_id=1696130
- Möller et al. (2017), tonic immobility during sexual assault, AOGS 96(8):932 — Wiley (open access)
- Shield (Koti et al. 2023) — https://eprint.iacr.org/2023/338
- Campbell 2012 seminar video (slides only exist here) — https://www.youtube.com/watch?v=khUfN58RUo8
- Not free: Fisher & Geiselman (1992) book — library/interlibrary loan

## Playbook corrections (highest impact first)

1. **Crypto design.** Callisto does *not* salt-and-hash identifiers. Phone numbers are low-entropy; salted hashes are brute-forceable by anyone holding the salt, and per-record salts break matching. Callisto uses a server-keyed **OPRF** + Shamir secret sharing. Authors: Rajan, Qin, Archer, Boneh, Lepoint, Varia (COMPASS 2018) — not "Anson et al." Relevant to `packages/crypto`.
2. **Privilege.** NJ's victim-counselor privilege covers certified counselors at counseling centers, not a tech platform. Intake data the platform can read is likely subpoenable (*Miller*/*Smith*). Zero-knowledge + data minimization is the actual protection.
3. **Evidence rules.** Hash/timestamp proves *authenticity* (FRE 901, **902(13)/(14)** — which need a qualified person's certification + pretrial notice). FRE 803(5) is only a hearsay exception requiring the survivor to testify she made/adopted it when fresh and now lacks memory; it's read, not shown. Statements made for prosecution are likely *testimonial* (Crawford) → she must still be cross-examinable. A hash proves integrity, not *when* (need RFC 3161 timestamp), *who*, or truth. Keep her verbatim words separate from any generated/"standardized" text. FRE is federal; most cases are state (N.J.R.E.).
4. **NJ VCCO.** $275/hr is right, but claim representation is capped at 15% of award (min $500); other crime-related legal help up to $10,000 inside the $25,000 cap. Police-report window is **9 months** (good-cause exception), not 90 days. Claim filing limit is **5 years** (since Aug 2020).
5. **Interviewing.** CI-AT is real but from Quebec Provincial Police + Fisher/Hopper, not EVAWI. Fisher & Geiselman's therapeutic-jurisprudence paper is **2010**, not 2014.
6. **Advisory.** FAST vests monthly over 2 years (3-mo cliff), tiers 0.10–1.00%, option-based, and allows publicizing names during the term. It doesn't fit Matra: no equity, and a for-profit entity can't run attorney routing in NJ (Legal Memo §5). Use `docs/legal/advisor-agreement.md`. Add **NJCASA** (sexual-assault coalition) alongside NJCEDV.

## Suggested reading order (~2–3 weeks part-time)

1. **Week 1 — what you're protecting.** EVAWI neurobiology bulletin → Campbell transcript → CI-AT manuscript → EVAWI *Effective Victim Interviewing* (skim; read the question-technique chapters closely). Memon 2010 for the evidence base.
2. **Week 1–2 — the threat model.** Callisto paper → Signal contact-discovery post → Demir 2018 → SAE (Arun 2020) critique → RFC 9497 sections 1–3 only. Then OWASP cryptographic storage.
3. **Week 2 — the legal exposure.** NJ victim-counselor privilege + *State v. J.G.* → *Miller*, *Smith*, then *Carpenter* (majority only) → FRCrP 17(c) → *Upjohn* (short; it's about corporate privilege, mostly to understand why it *doesn't* save you).
4. **Week 2–3 — evidence.** FRE 902 LII page (committee notes for 902(13)/(14)) → 901 → 803(5) → Grimm/Capra/Joseph → *Lorraine* (long; read the intro + ESI authentication section). SP 800-86 and FIPS 180-4 are reference, not reading.
5. **Week 3 — money & governance.** VCCO FAQ → application instructions → N.J.A.C. 13:75-4.10 (fees) → CVRA. Then the charters and `docs/legal/advisor-agreement.md` before any outreach.

## How to take notes on this

- **Read with a design question in hand.** Each source should answer "what does this change in our code, question tree, or pitch?" Keep a running `decisions.md` (in `docs/`) with entries like: *Decision → Source (file + page) → Why → Open question for advisor.* That file becomes your advisor-meeting agenda and proof of diligence.
- **Two-pass reading for papers.** Pass 1: abstract, figures, conclusion — write 3 sentences. Pass 2 only if it affects design: the method section, noting assumptions and threat model.
- **Legal sources: brief them.** For cases: facts / question / holding / reasoning / *what it means for us*. For statutes: who it applies to, what it requires, deadlines/caps, exceptions. Copy exact quotes with pin cites (rule subsection or page) — paraphrase drifts, and lawyers will check.
- **Build a glossary** as you go (tonic immobility, testimonial, OPRF, PSI, self-authentication, recorded recollection…). Defining a term in your own words is the fastest test of whether you understand it.
- **Explain it back.** After each folder, write a one-page plain-English explainer as if for a teammate. Gaps show up immediately; bring them to advisors as specific questions — which is exactly the "technical humility" the outreach plan calls for.
- **Track contradictions.** When sources disagree with each other or with the README, log it. Those are the highest-value questions for your legal and clinical advisors.
- **Tools:** Zotero (free) handles PDF annotation + citations well; Obsidian works if you want linked notes alongside the repo. Either is fine — the `decisions.md` habit matters more than the tool.
