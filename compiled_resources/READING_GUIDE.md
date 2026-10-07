# Reading Guide

A path through all eight folders, ordered so each stage gives you the context for the next. Budget about 6 weeks at 5–7 hours a week. Each stage lists **Core** reading (do it properly), **Skim** (know it exists and what it says), and **Check yourself** questions. If you can answer them from memory, without notes, you're ready to move on.

Paths are relative to `compiled_resources/`. Every folder's `SOURCES.md` has the citation, link, and a "why it matters" note for each file. Read that note before opening the file.

---

## Stage 0: Orientation (1 evening)

Read these three `SOURCES.md` files top sections only. They are the summaries the rest of the guide fills in:

- `06_statistics_and_landscape/SOURCES.md`: the "Stats cheat sheet" and "Commonly misquoted stats"
- `07_survivor_experience_and_barriers/SOURCES.md`: the theme-by-evidence table (your `reasons.txt` themes, graded by confidence)
- `08_legal_landscape_and_pitfalls/SOURCES.md`: "Top 15 pitfalls"

Start your glossary and your `docs/decisions.md` now (see "How to take notes" at the end).

---

## Stage 1: The scale of the problem (week 1)

**Goal:** cite the core numbers correctly, with their caveats, and know which source to use for which claim.

**Core**
- `06/cdc_nisvs_2023-2024_sexual_violence_data_brief.pdf`: the current national prevalence figures. Note the methodology change. Do not compare these with older NISVS as a trend.
- `06/cdc_nisvs_2016-2017_report_on_sexual_violence.pdf`: read the perpetrator-relationship and race/ethnicity tables. This is where "most perpetrators are known" comes from.
- `06/bjs_criminal_victimization_2024.pdf`: the rape/sexual-assault rows and the "reported to police" figure. Understand why it swings year to year (sample size).
- `06/nij_morabito_2019_sa_case_attrition.pdf`: the executive summary. This is the honest version of the "justice funnel" (reported → arrest → conviction).
- `06/evawi_false_reports_moving_beyond.pdf`: you will be asked about false reports. Know the 2–8% / 2–10% range and what it does and doesn't mean.

**Skim**
- `06/bjs_female_victims_sexual_violence_1994-2010.pdf` and `06/bjs_rape_sa_college_age_females_1995-2013.pdf`: the reasons-for-not-reporting tables
- `06/aau_campus_climate_survey_2019_report.pdf`, `06/nij_rosay_2016_violence_against_aian.pdf`, `06/cdc_nisvs_2010_findings_by_sexual_orientation.pdf`, `06/bjs_crime_against_persons_with_disabilities_2009-2019.pdf`: the disparity data
- `06/lsc_justice_gap_2022_full_report.pdf`: unmet civil legal need
- `06/rainn_*_2024capture.md` vs `_2026capture.md`: see how a widely quoted funnel changed, and why you cite primary sources instead

**Check yourself**
1. What share of women in the U.S. have experienced contact sexual violence? Which survey, which year, and why can't you call it a trend?
2. Why is there no usable NJ rape estimate in the latest NISVS, and what NJ number *can* you use?
3. Survey data vs. police data: which undercounts what, and why?
4. Someone says "only 1 in 4 rapes are reported." What do you say?

---

## Stage 2: The survivor's experience (week 1–2)

**Goal:** understand why survivors don't report, what makes it worse, and what trauma does to memory. This is the "why" behind every design decision.

**Core**
- `07/ahrens_2006_being_silenced.md`: how negative first reactions shut down disclosure
- `07/ullman_et_al_2020_reasons_for_nondisclosure_diverse_sample.md`
- `07/smith_freyd_2014_institutional_betrayal.pdf`: why institutions can harm survivors as much as the assault. Matra must not become one more such institution.
- `07/harsey_freyd_2020_darvo.pdf` + `07/aals_darvo_handout.pdf`: deny, attack, reverse victim and offender. This is the "framed as the problem" theme.
- `01/EVAWI_Neurobiology_of_Trauma_Interviewing_2023.pdf`: why memories are fragmented and non-linear
- `01/NIJ_Campbell_2012_Neurobiology_Sexual_Assault_transcript.pdf`: freeze/tonic immobility, explained for a lay audience

**Skim**
- `07/bjs_victimizations_not_reported_2006_2010.pdf`: fear of reprisal numbers
- `07/hakimi_et_al_2018_negative_reactions_black_white_survivors.md`, `07/pcar_nsvrc_poverty_and_sexual_violence_2007.pdf`: disparities
- `07/harvard_crcl_how_defamation_is_used_to_silence_survivors.md`, `07/volokh_2022_libel_and_chilling_effects.md`, `07/ap_2022_depp_heard_verdict_metoo.md`: read all three for both sides of the defamation debate
- `07/nj_upepa_2023_PL2023c155_legislative_history.pdf`: NJ's anti-SLAPP law
- `07/cdc_stop_sv_technical_package_2016.pdf`: what prevention evidence supports
- `07/paywalled_citations_and_pornography_evidence.md`: the honest state of the pornography research. Low confidence for causal claims, so keep it out of product claims.
- `01/EVA_BC_2017_Freeze_Response_Sexual_Violence.pdf`: a model of survivor-facing language

**Check yourself**
1. Name three of the most common reasons survivors give for not reporting.
2. What is institutional betrayal, and name two ways a reporting app could commit it.
3. Why does a fragmented, out-of-order account *not* mean someone is lying?
4. What does the evidence say, and with what confidence, about each theme in your `reasons.txt`?

---

## Stage 3: Interviewing without harm (week 2)

**Goal:** be able to judge whether an intake question is leading, re-traumatizing, or useful.

**Core**
- `01/Fisher_Hopper_CI-AT_Adapting_Cognitive_Interview_Sexual_Assault.pdf`: the 6-phase protocol. This is the closest thing to a spec for your question tree.
- `01/EVAWI_Effective_Victim_Interviewing_2023.pdf`: read the chapters on question types and sensory prompts. Skim the rest.

**Skim**
- `01/Memon_2010_Cognitive_Interview_meta-analysis.pdf`: the evidence that cognitive interviewing works
- `08/Spot_AI_interviewer_*.md`: a prior attempt at bot-based cognitive interviewing
- Browser-only: Fisher & Geiselman 2010 (SSRN 1696130), Möller 2017 (Wiley)

**Exercise:** open `apps/web/src/screens/Story.tsx` and grade every question in the intake against the CI-AT phases. Log each change you'd make in `decisions.md`.

---

## Stage 4: The law a survivor faces (week 3)

**Goal:** know the legal map in NJ: what counts as a crime, what deadlines apply, what protections and remedies exist, and where Matra can and can't operate.

**Core**
- `08/NJSA_2C14-1_2C14-2_sexual_assault_definitions.md` + `08/State_in_Interest_of_MTS_129NJ422_1992.md`: NJ's definition of consent ("affirmative and freely-given permission")
- `08/NJSA_2C1-6_criminal_statute_of_limitations.md`, `08/NJSA_2A14-2a_2A14-2b_civil_SOL_and_lookback.md`: deadlines. Any deadline text in the product must match these.
- `08/NJSA_2C14-13_to_-17_SASPA_current.md`: protective orders outside domestic violence
- `03/NJSA_52-4B_*` + `03/NJAC_13-75_VCCO_regulations.md` (§4.10 fees) + `03/NJ_VCCO_FAQ_2025.pdf`: compensation, deadlines, attorney fees
- `08/NJ_UPL58_ACPE740_2021_nonlegal_companies_matching_lawyers.pdf` + `08/NJ_ACPE732_*`: **the most important legal risk to Matra's model.** Read these alongside `docs/LEGAL_RESEARCH_MEMO.md` §5.
- `08/VAWA_34USC12291_confidentiality_excerpt_LII.md` + `08/OVW_VAWA_Confidentiality_FAQ_2017.pdf`: binding if you take or partner with VAWA/VOCA money

**Skim**
- `03/18USC3771_CVRA.md`, `03/NJSA_52-4B-34_to_38_Crime_Victims_Bill_of_Rights.md`, `03/NJ_Constitution_Art_I_incl_para22.md`: victims' rights
- `08/NJSA_2C14-7_rape_shield.md`, `08/FRE_412_*`: rape shield
- `08/TitleIX_*`: the current campus rules (2020 rule restored as of 2026-09-29; may change again)
- `08/Upsolve_v_James_2dCir_2025-09-09_opinion.pdf`: free speech vs. unauthorized practice of law for non-lawyer helpers
- `06/nj_vcco_annual_report_fy2020.pdf`: how much VCCO actually pays in attorney fees. Note: its $200/hr / $3,000 figures predate the current $275/hr and $10,000 rules in N.J.A.C. 13:75. Confirm with VCCO which apply now.

**Check yourself**
1. Is there a criminal deadline for sexual assault in NJ? For criminal sexual contact? For a civil suit by an adult?
2. Why can't Matra "match" a survivor to a lawyer for a fee, and what structure avoids that?
3. What does VAWA require before a funded program shares survivor information, and does encryption exempt it?
4. What can VCCO pay a lawyer, and for what work?

---

## Stage 5: Privacy, subpoenas, and evidence (week 4)

**Goal:** understand who can force Matra to hand over data, and what makes a record usable in court.

**Core**
- `03/NJ_Victim_Counselor_Privilege_*` + `03/State_v_JG_261NJSuper409_1993_victim_counselor.md`: what is privileged, and why Matra isn't
- `03/US_v_Miller_*`, `03/Smith_v_Maryland_*`, then `03/Carpenter_*` (majority opinion only): the third-party doctrine
- `03/FRCrP_Rule17_Subpoena.md`: 17(c)(3), defense subpoenas for victim records
- `08/Nebraska_Burgess_AP_*`, `08/FTC_Flo_Health_final_order_2021-06-22.md`: real cases where sensitive app data was obtained or shared
- `02/FRE_Rule_902_self_authentication_LII.md`: 902(13)/(14) and their committee notes on hashes
- `02/FRE_Rule_803_hearsay_exceptions_LII.md`: 803(5), and why it is narrower than the playbook claimed
- `02/Grimm_Capra_Joseph_2017_Authenticating_Digital_Evidence_Baylor.pdf`

**Skim**
- `02/FRE_Rule_901_*`, `02/Lorraine_v_Markel_*` (intro + ESI section), `03/Upjohn_*` (to see why it doesn't protect Matra), `03/Commonwealth_v_Dwyer_*` (another state's approach)
- Reference only: `02/NIST_SP_800-86_*`, `02/NIST_FIPS_180-4_SHA-2.pdf`, `02/RFC3161_trusted_timestamping.txt`

**Check yourself**
1. If a defense attorney subpoenas Matra, what could Matra hand over today? Answer from the code, not the pitch.
2. What does a hash prove, and what does it *not* prove (when, who, truth)?
3. Why does a survivor still need to testify even with a perfect timestamped statement?

---

## Stage 6: Security design and prior tools (week 5)

**Goal:** know the threat model well enough to defend `packages/crypto` to a skeptical expert, and learn from tools that came before.

**Core**
- `04/callisto_rajan2018_compass.pdf` → `04/signal2017_private_contact_discovery.md` → `04/sae_arun2020_ndss.pdf` (the critique)
- `08/Freed_et_al_CHI2018_A_Stalkers_Paradise.pdf`: abusers are usually insiders with the survivor's passwords or device. Compare with `docs/threat-model.md`, which currently leaves this out.
- `07/chen_et_al_2022_trauma_informed_computing_chi.pdf`: trauma-informed design principles for software
- `08/NNEDV_SafetyNet_app_developer_guidance.md`: the field's own checklist for survivor apps
- `08/Callisto_history_Wikipedia.md` + `08/Callisto_2024_funding_crisis_Sentinel_oped.md` + `08/Callisto_Ladd_EEOC_written_testimony.md`: the most similar tool and its sustainability problems

**Skim**
- `04/demir2018_*`, `04/hagen2021_*`: why hashed phone numbers are reversible
- `04/metoo_kuykendall2019_popets.pdf`, `04/rfc9497_oprf.txt` §1–3, `04/morales2023_psi_systematic_review.pdf`, `04/OWASP_*`
- `08/Havron_et_al_USENIX2019_*`, `08/LegalFling_*`, `07/nnedv_safetynet_*`
- `08/ABA_Formal_Opinion_512_2024_Generative_AI.pdf`, `08/Mata_v_Avianca_*`: if any AI touches intake or briefs

**Check yourself**
1. Why does Callisto use an OPRF instead of salted hashes, and what does the OPRF server still learn?
2. Name three ways an abusive partner could defeat Matra's encryption without breaking any cryptography.
3. Why did Callisto struggle, and what does that mean for Matra's funding model?

---

## Stage 7: Governance and outreach (week 6)

**Core:** `05/sample_advisory_charters_university.md`, `docs/legal/advisor-agreement.md`, `05/CONTACTS.md`, then `docs/outreach/`.
**Skim:** `05/FI_FAST_Agreement.docx` (to see why it doesn't fit).

**Final test:** write the one-page answer to "Why should a survivor trust Matra, and why should a lawyer?" citing at least one source from each stage. If you can't, go back to the stage you couldn't cite.

---

## How to take notes

- **One `docs/decisions.md`.** Each entry: *Decision → Source (file + page) → Why → Open question for an advisor.* This becomes your advisor-meeting agenda.
- **Stats file with caveats.** Copy each number you might quote into a `docs/stats.md` with source, year, page, and the caveat in one line. Never quote a number from memory in outreach.
- **Brief every legal source.** Cases: facts / question / holding / reasoning / *what it means for Matra*. Statutes: who it covers, what it requires, deadlines and caps, exceptions. Quote exactly, with the subsection.
- **Two passes for papers.** First pass: abstract, figures, conclusion, then 3 sentences in your own words. Second pass only if it changes a design decision.
- **Glossary.** Define each new term in your own words (tonic immobility, DARVO, testimonial, OPRF, UPL, SASPA…).
- **Teach it back.** After each stage, write a one-page explainer for a teammate. Whatever you can't explain becomes a question for an advisor.
- **Log contradictions.** When sources disagree with each other, with the playbook, or with the code, write it down. Those are your best advisor questions.
- **Tools:** Zotero for PDFs and citations; Obsidian if you want linked notes. The habits matter more than the tool.
