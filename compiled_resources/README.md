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
| `06_statistics_and_landscape/` | CDC NISVS (2023/24 brief, 2016/17 report, sexual orientation), BJS victimization + non-reporting reports, AAU 2019, NIJ case-attrition study, EVAWI false reports, LSC Justice Gap, NJSP crime data, NJ VCCO FY2020 report, RAINN page captures. `SOURCES.md` has a stats cheat sheet and commonly misquoted stats |
| `07_survivor_experience_and_barriers/` | Why survivors don't report (Ahrens, Ullman, BJS), institutional betrayal, DARVO, defamation and anti-SLAPP (NJ UPEPA), disparities, CDC STOP SV prevention, pornography evidence (citations), trauma-informed computing, NNEDV Safety Net |
| `08_legal_landscape_and_pitfalls/` | NJ sexual offense law + *M.T.S.*, statutes of limitations, SASPA, rape shield, Title IX status, NJ UPL/referral opinions, VAWA confidentiality, Callisto history, Spot/LegalFling, tech-facilitated abuse (CHI/USENIX), Flo + Nebraska data cases, ABA Op. 512 + *Mata*. `SOURCES.md` has the top 15 pitfalls |

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

## How to read this

See [`READING_GUIDE.md`](READING_GUIDE.md): a staged path through all eight folders (about 6 weeks part-time), with core vs. skim reading, self-check questions, and note-taking methods.
