# 08 — Legal landscape a survivor faces, and pitfalls for survivor-facing legal tech

Compiled 2026-10-07 for Matra (NJ-focused, zero-knowledge intake; consent-based sharing with VCCO-paid attorneys).

> Not legal advice. These are research copies collected by a non-lawyer; NJ counsel must confirm current law before anything here shapes product copy or survivor-facing statements.

**Method.** Files were downloaded with `curl -L` and a browser user agent, then checked with `file`. HTML was converted to Markdown with Python (BeautifulSoup); PDF text was checked with PyMuPDF. NJ statute text comes from the official NJ Legislature statutes database (`lis.njleg.state.nj.us`), because Justia and FindLaw returned 403. Nothing paywalled was downloaded.

**What this folder adds to existing work.** It avoids repeating `docs/LEGAL_RESEARCH_MEMO.md` and folders 01–05. The memo already covers Title IX actual knowledge, the UPL and referral structure, and VAWA confidentiality, but in summary form only. This folder adds the primary texts for those topics. It also covers gaps the memo and `docs/threat-model.md` don't address: substantive NJ sexual-offense law and consent, statutes of limitations, SASPA protective orders, rape shield, the NJ UPL opinions that apply directly to "matching" survivors with lawyers, the history of prior tools, tech-facilitated abuse research, subpoena and data-sharing precedents, and AI risk.

---

## Top 15 pitfalls for a survivor-facing legal-tech tool

| # | Pitfall | Why it bites | Source (this folder) |
|---|---|---|---|
| 1 | **Acting as the company that "matches" a survivor to a lawyer.** | NJ UPL Op. 58 / ACPE 740 (2021) holds that a non-law company that contracts with a customer and "matches" her with a lawyer is engaged in UPL. That holds *even if it says it only forwards cases*. The lawyers who take the work violate RPC 5.5(a)(2), 5.4(a) and 7.3(e). Matra's routing must not look like a service contract between Matra and the survivor for legal help. | `NJ_UPL58_ACPE740_2021_...pdf` |
| 2 | **Any payment from attorneys tied to referrals, or an unregistered "plan".** | ACPE 732 (2017) barred NJ lawyers from Avvo Legal Services (fee-sharing and referral fees) and from LegalZoom and Rocket Lawyer plans (not registered under RPC 7.3(e)(4)(vii)). A for-profit wrapper or "attorney subscription" would put partner attorneys at risk of discipline. | `NJ_ACPE732_CAA44_UPL54_2017_...pdf` |
| 3 | **Giving individualized legal advice through software or volunteers.** | *Upsolve v. James* (2d Cir. 2025) held that UPL statutes applied to nonlawyer advice get only intermediate scrutiny. The Supreme Court denied cert on 2026-03-30. A "free speech" defense for advice features is weak. Keep Matra to transcribing the survivor's own words, giving general information, and routing to a lawyer. | `Upsolve_v_James_2dCir_2025-09-09_opinion.pdf` |
| 4 | **Telling survivors the wrong deadline.** | NJ has **no** criminal limitations period for sexual assault or aggravated sexual assault (2C:14-2). **Criminal sexual contact (2C:14-3) against an adult falls under the general 5-year period** (2C:1-6(b)(1)). For adults, civil claims must be filed within **7 years of reasonable discovery** (2A:14-2a(b)(1)). The 2019–2021 revival window (2A:14-2b) **has closed**. Generic "no time limit" copy would be wrong. | `NJSA_2C1-6_...md`, `NJSA_2A14-2a_2A14-2b_...md`, `PL2019_c120_...pdf` |
| 5 | **Mis-stating what counts as sexual assault, or which version of the statute applies.** | *M.T.S.* (1992) set NJ's "affirmative and freely-given permission" standard. The current text of 2C:14-2 now states it expressly. The law in force on the **date of the offense** governs, and the database's amendment note does not identify which law added this wording [VERIFY]. Do not let the app classify incidents legally. | `NJSA_2C14-1_2C14-2_...md`, `State_in_Interest_of_MTS_...md` |
| 6 | **Ignoring civil remedies that don't need a police report.** | SASPA (2C:14-13 et seq., amended 2023) gives non-domestic-violence survivors protective orders without a criminal case. The app should mention it alongside VCCO, which requires a police report. | `NJSA_2C14-13_to_-17_SASPA_current.md`, `PL2015_c147_...pdf` |
| 7 | **Collecting what the defense will later try to use.** | Rape shield (2C:14-7, FRE 412) limits evidence of sexual history and, in NJ, **manner of dress**. It does not stop discovery of the survivor's own written account. Prompts should not invite sexual-history or clothing detail that isn't needed, and the app must not promise that rape shield protects what she writes. | `NJSA_2C14-7_rape_shield.md`, `FRE_412_...md` |
| 8 | **Hashing or encrypting does not take data out of VAWA scope.** | 34 U.S.C. 12291(b)(2) bars grantees from releasing personally identifying information "regardless of whether the information has been encoded, encrypted, hashed". Consent must be **written and reasonably time-limited**. Funders may receive only aggregate, non-identifying data. This applies if Matra or any partner is OVW- or VOCA-funded. (Threat-model item W6, open-ended shares, conflicts with this.) | `VAWA_34USC12291_...md`, `OVW_VAWA_Confidentiality_FAQ_2017.pdf` |
| 9 | **Campus deployment pulls in Title IX and institutional reporting.** | The 2020 rule is formally back in the CFR (published 2026-09-29), and further rulemaking on OCR procedures is signaled. Callisto's first version sent reports to Title IX coordinators and later moved away from that model. Keep Matra independent of institutions. | `TitleIX_HollandKnight_...md`, `TitleIX_NixonPeabody_...pdf`, `Callisto_history_Wikipedia.md` |
| 10 | **Designing for an outsider attacker when the threat is an insider with the password.** | Freed et al. show that IPV attackers are often "UI-bound": they own or know the passwords to the victim's devices and accounts, so encryption alone does not help. Disguise, quick exit, no notification leakage and session hygiene matter more. | `Freed_et_al_CHI2018_...pdf`, `Havron_et_al_USENIX2019_...pdf` |
| 11 | **Not building with advocates, or building a feature that alerts the abuser.** | NNEDV's developer guidance asks: can users find each other, do notifications or emails reveal app use, how is data stored and deleted, and were survivor experts involved? Many safety apps failed these questions. | `NNEDV_SafetyNet_app_developer_guidance.md`, `NNEDV_SafetyNet_choosing_apps_...md` |
| 12 | **Third-party SDKs and analytics leaking sensitive data.** | The FTC Flo Health order (2021) followed sharing of health events with Facebook and Google through SDKs, despite privacy promises. Matra's front end should have no third-party analytics, pixels or crash reporters that can see content or metadata. | `FTC_Flo_Health_final_order_2021-06-22.md` |
| 13 | **Plaintext held by any intermediary gets subpoenaed.** | In the Nebraska Burgess case, Facebook messages that were not end-to-end encrypted were produced under a warrant and anchored the prosecution. Anything Matra, an attorney's email or a notification service holds in plaintext can be compelled. | `Nebraska_Burgess_AP_2023-07-21_...md`, `Nebraska_Burgess_AP_2023-09-22_...md` |
| 14 | **Putting an LLM in the intake or "brief" path.** | *Mata v. Avianca* (sanctions, 2023-06-22) arose from AI-fabricated citations. ABA Formal Op. 512 (2024) says lawyers need informed client consent before entering client information into self-learning AI tools, and must verify outputs. An AI interviewer (Spot) also raises suggestibility and memory-contamination questions. Keep AI away from survivor content, as the memo already recommends. | `Mata_v_Avianca_...pdf`, `ABA_Formal_Opinion_512_...pdf`, `Spot_AI_interviewer_*.md` |
| 15 | **Mission-critical tool dependent on fragile funding; legal-sounding gimmicks.** | Callisto said in ~Sept 2024 that it would close within a week without new funding. Survivors' stored records depend on the operator surviving, so Matra needs export, a data-continuity plan and an escrow of keys or code. LegalFling ("legally binding" consent on a blockchain) shows the reputational cost of legal claims that don't hold up. | `Callisto_2024_funding_crisis_Sentinel_oped.md`, `LegalFling_...md` |

---

## A. The NJ and federal legal map a survivor faces

### 1. NJ sexual-offense statutes and the consent standard
| File | Citation / URL |
|---|---|
| `NJSA_2C14-1_2C14-2_sexual_assault_definitions.md` | N.J.S.A. 2C:14-1, 2C:14-2. NJ Legislature statutes database, https://lis.njleg.state.nj.us/nxt/gateway.dll?f=templates&fn=default.htm&vid=Publish:10.1048/Enu |
| `State_in_Interest_of_MTS_129NJ422_1992.md` | *State in Interest of M.T.S.*, 129 N.J. 422, 609 A.2d 1266 (1992). Caselaw Access Project, https://static.case.law/nj/129/cases/0422-01.json |

**Note.** 2C:14-1 defines sexual penetration, sexual contact and coercion. 2C:14-2 sets out aggravated sexual assault (first degree) and sexual assault (second degree). *M.T.S.* held that "physical force" is satisfied by penetration without "affirmative and freely-given permission". The current database text of 2C:14-2(a)(5)-(6) and (c)(1) now uses that phrase in place of "physical force". The amendment note in the database lists amendments only through P.L.2019, c.474, so **which law made this change, and when it took effect, is unverified [VERIFY]**.
**Implication for Matra.** Copy can say NJ law focuses on whether there was affirmative, freely given permission. The app must not tell a survivor whether her experience "counts" or which degree of crime it is. Applying the law to her facts is the lawyer's job and is UPL risk (items 6–7). Older incidents may fall under earlier statutory wording.

### 2. Statutes of limitations (criminal and civil)
| File | Citation / URL |
|---|---|
| `NJSA_2C1-6_criminal_statute_of_limitations.md` | N.J.S.A. 2C:1-6 (same database) |
| `NJSA_2A14-2a_2A14-2b_civil_SOL_and_lookback.md` | N.J.S.A. 2A:14-2a, 2A:14-2b (same database) |
| `PL2019_c120_S477_civil_SOL_as_enacted.pdf` | P.L.2019, c.120 (S477), https://pub.njleg.gov/bills/2018/PL19/120_.PDF |

**Note.** Prosecution of 2C:14-2 offenses "may be commenced at any time". Other crimes, including criminal sexual contact against an adult, generally have a 5-year limit. The clock is tolled while DNA or fingerprint evidence that identifies the actor is not yet in hand. For adults, civil actions must be brought within 7 years of reasonable discovery of the injury and its cause. For minors the period runs to age 55 or 7 years from discovery. Section 2A:14-2b opened a two-year revival window from the Act's effective date (Dec. 1, 2019), so it ran to about Nov. 30, 2021. **That window is closed** [effective date per P.L.2019 c.120; VERIFY exact window dates with counsel].
**Implication for Matra.** Deadline copy must separate penetration from contact offenses and criminal from civil. It should say "talk to a lawyer about your deadlines" rather than "there's no time limit". Timestamped records may help show *when she discovered the injury* for civil purposes, but that is for counsel to argue.

### 3. Sexual Assault Survivor Protection Act (SASPA)
| File | Citation / URL |
|---|---|
| `NJSA_2C14-13_to_-17_SASPA_current.md` | N.J.S.A. 2C:14-13 to -17, current text (amended by P.L.2023, c.127) |
| `PL2015_c147_SASPA_as_enacted.pdf` | P.L.2015, c.147, https://pub.njleg.gov/bills/2014/PL15/147_.PDF |

**Note.** Victims of nonconsensual sexual contact, penetration or lewdness, and attempts at them, who cannot get a domestic-violence restraining order may apply to Superior Court for temporary and final protective orders. Those orders can include no-contact provisions. An application does not depend on a criminal complaint. If a related criminal complaint has been filed, testimony given in the SASPA proceeding generally may not be used in the criminal case (2C:14-14; check the exceptions). Sections 18–21 were not captured, and the substance of the 2023 amendment was not analysed [VERIFY].
**Implication for Matra.** This is a remedy that does not depend on police. Partner attorneys and advocates should be able to use a survivor's Matra record to prepare a SASPA application. Mention it in options content, alongside VCCO, which requires a police report within 9 months.

### 4. Title IX: current operative regulations
| File | Citation / URL |
|---|---|
| `TitleIX_HollandKnight_2026-09-29_2024_rule_repealed.md` | Holland & Knight alert, Sept. 2026, https://www.hklaw.com/en/insights/publications/2026/09/education-department-formally-repeals-2024-title-ix-rule |
| `TitleIX_NixonPeabody_2026-09_recodification_alert.pdf` | Nixon Peabody Higher Education Alert, Sept. 29, 2026, https://www.nixonpeabody.com/-/media/files/alerts/2026/09/title_ix_recodification_alert.pdf |

**Note (status as of 2026-10-07).** The 2024 rule was vacated nationwide in *Tennessee v. Cardona*, 762 F. Supp. 3d 615 (E.D. Ky. Jan. 9, 2025), and in *Carroll ISD* (N.D. Tex. 2025). ED has enforced the 2020 rule since January 2025. On **Sept. 29, 2026** ED published a final rule that removes the 2024 text and recodifies the 2020 rule with four "minor" changes. One of them drops the 106.45(b)(6)(i) sentence that *VRLC v. Cardona* (D. Mass. 2021) had partly vacated. ED has signaled further rulemaking on the definition of "sex" and on OCR procedures, so this area **may change again soon**. An ED primary source (the Federal Register notice) was not downloaded; the two law-firm alerts are secondary sources.
**Implication for Matra.** This confirms the memo's §4 analysis (actual knowledge under 106.30). Re-check before any campus pilot.

### 5. Rape shield (NJ and federal)
| File | Citation / URL |
|---|---|
| `NJSA_2C14-7_rape_shield.md` | N.J.S.A. 2C:14-7 (same database; last amended 2013) |
| `FRE_412_sex_offense_victim_behavior_LII.md` | Fed. R. Evid. 412, https://www.law.cornell.edu/rules/fre/rule_412 |

**Note.** 2C:14-7 bars evidence of the victim's previous sexual conduct unless, after an application and an in-camera hearing, the court finds it "relevant and highly material" and that its probative value substantially outweighs prejudice and invasion of privacy. It also bars evidence of the victim's **manner of dress**, and defines "sexual conduct" broadly to include contraceptive use, gynecological records, living arrangement and lifestyle. FRE 412 has criminal exceptions (source of semen or injury, conduct with the accused, constitutional necessity) and a reverse-balancing test in civil cases. It requires a sealed motion and hearing.
**Implication for Matra.** These rules restrict admissibility, not discovery. Intake prompts should not invite sexual-history or clothing detail beyond what the survivor wants to record. Do not tell survivors that rape shield keeps their record private.

### 6. Unauthorized practice of law, referral and legal-tech
| File | Citation / URL |
|---|---|
| `NJ_UPL58_ACPE740_2021_nonlegal_companies_matching_lawyers.pdf` | UPL Op. 58 / ACPE Op. 740 (June 21, 2021), https://www.njcourts.gov/sites/default/files/notices/2021/06/n210624j.pdf |
| `NJ_ACPE732_CAA44_UPL54_2017_Avvo_LegalZoom_RocketLawyer.pdf` | ACPE 732 / CAA 44 / UPL 54 (June 21, 2017), 223 N.J.L.J. 1940. NJ State Library, https://dspace.njstatelib.org/items/1bef7ed0-73e3-45dc-b127-53ee7894be22 |
| `Upsolve_v_James_2dCir_2025-09-09_opinion.pdf` | *Upsolve, Inc. v. James*, No. 22-1345 (2d Cir. Sept. 9, 2025), extracted from cert. petition App. A–B. https://www.supremecourt.gov/DocketPDF/25/25-948/395644/20260206111635719_2%20-%20Appendix.pdf. Cert. denied Mar. 30, 2026 (No. 25-948). |

**Note.** UPL 58 concerns a traffic-ticket company that "matches" paying customers with lawyers. It confirms UPL Op. 25: a company that contracts to provide legal services and refers the matter to a lawyer engages in UPL "even when the company expressly states that it does not engage in the practice of law". ACPE 732 is the main NJ opinion on online platforms: per-service marketing fees count as fee-sharing and referral fees, and unregistered plans are barred. *Upsolve* vacated a First Amendment injunction that had let trained nonlawyers advise on debt-collection answer forms, holding that UPL rules are content-neutral and subject to intermediate scrutiny. It is a New York case, but it is persuasive authority on how far "advice" by nonlawyers can go.
**Implication for Matra.** The survivor must contract with the attorney, not with Matra. Matra takes no money tied to cases and does not choose the lawyer for her. The memo's open question on RPC 7.3(e) registration (memo §9 Q1) should be answered with UPL 58 and ACPE 732 in hand. No feature should tell a survivor what claims she has or what to do.

### 7. VAWA confidentiality
| File | Citation / URL |
|---|---|
| `VAWA_34USC12291_confidentiality_excerpt_LII.md` | 34 U.S.C. 12291(a) (PII definition) and (b)(2)-(3), https://www.law.cornell.edu/uscode/text/34/12291 |
| `OVW_VAWA_Confidentiality_FAQ_2017.pdf` | DOJ Office on Violence Against Women, *FAQs on the VAWA Confidentiality Provision* (Oct. 2017), https://www.justice.gov/ovw/page/file/1006896/download |

**Note.** Grantees and subgrantees may not disclose personally identifying or individual client information, "regardless of whether the information has been encoded, encrypted, hashed, or otherwise protected". Release requires informed, written, reasonably time-limited consent, or a statutory or court mandate followed by notice to the victim. Survivors may not be required to consent as a condition of service. Reporting to funders is aggregate only. The OVW FAQ (2017) predates the 2022 VAWA reauthorization [VERIFY whether OVW has updated it].
**Implication for Matra.** If Matra, a fiscal sponsor or a partner program receives OVW or VOCA money, shares need expiry dates (threat model W6), consent records must be written and specific, and grant reports must exclude individual-level data. Hashed escrow identifiers still count as personally identifying information.

---

## B. Pitfalls of prior tools and tech-facilitated abuse

### 8. Callisto history, consent apps and AI reporting tools
| File | Citation / URL |
|---|---|
| `Callisto_history_Wikipedia.md` | "Callisto (project)", Wikipedia, https://en.wikipedia.org/wiki/Callisto_(project) (tertiary source; use for orientation only) |
| `Callisto_Ladd_EEOC_written_testimony.md` | Jess Ladd, written testimony to the EEOC, https://www.eeoc.gov/written-testimony-jess-ladd-founder-ceo (the page is undated; its content refers to plans for "late 2018", so it is probably from 2018 [VERIFY]) |
| `Callisto_2024_funding_crisis_Sentinel_oped.md` | C. Raibman, "Callisto Faces Closure Amid Funding Crisis", student op-ed republished by *The Sentinel* (~Sept 30 2024), https://www.thesentinel.com/communities/callisto-faces-closure-amid-funding-crisis-a-lifeline-for-sexual-assault-survivors-at-risk/article_2d79a182-7f9c-11ef-a751-67fb7a09c081.html |
| `LegalFling_consent_app_critique_TheRegister_2018-01-11.md` | *The Register*, Jan. 11 2018, https://www.theregister.com/2018/01/11/app_consent_blockchain_techbro/ |
| `Spot_AI_interviewer_Shaw_TheConversation_2018-03-19.md` | J. Shaw et al., *The Conversation*, Mar. 19 2018, https://theconversation.com/in-the-metoo-era-a-chatbot-can-help-people-report-workplace-harassment-92565 |
| `Spot_AI_interviewer_Smithsonian_2018-02-13.md` | *Smithsonian*, Feb. 13 2018, https://www.smithsonianmag.com/innovation/ai-bot-fights-workplace-harassment-180968143/ |

**Note.** Callisto went from "Callisto Campus" (2015, which sent reports to campus Title IX coordinators) to "Callisto Expansion" (tech and VC industries, with lawyers as match counselors) to "Callisto Vault". Vault is free to anyone with a .edu email and has no institutional reporting pipeline. Ladd's testimony explains why: low trust in institutions, and settings with no institution that has jurisdiction. In ~Sept 2024 Callisto publicly said it would close within a week after "suddenly losing a significant amount of funding". Its site is still live as of 2026-10-07. LegalFling sold a blockchain "legally binding" consent record; lawyers and advocates said it was legally meaningless and conflicted with the fact that consent is ongoing and can be withdrawn. Spot uses an NLP chatbot built on cognitive-interview techniques, and was designed by a memory scientist to reduce leading questions. Its reports can go to employers. The Spot sources are the founders' own account and positive press; **no independent evaluation was found**. JDoe and Vesta coverage was **not** collected (the memo already covers JDoe; Vesta's current status is unknown [VERIFY]).
**Implication for Matra.** (a) Stay institution-independent. (b) Funding fragility is a risk to survivors, so commit to data export, deletion and a continuity plan. (c) Never imply that a record is "legally binding" or "court-proof". (d) If any guided interviewing is automated, it must be scripted, non-suggestive and reviewed by a trauma expert, not generative.

### 9. Safety-app research and NNEDV criteria
| File | Citation / URL |
|---|---|
| `NNEDV_SafetyNet_app_developer_guidance.md` | NNEDV Safety Net, "Considerations for App Developers" plus the 2017 "So You Wanna Build an App" series: https://www.techsafety.org/considerations-app-developers ; https://www.techsafety.org/blog/2017/8/16/so-you-wanna-build-an-app-what-to-consider-before-developing-an-app ; https://www.techsafety.org/blog/2017/8/30/so-you-wanna-build-an-app-safety-first ; https://www.techsafety.org/blog/2017/9/6/so-you-wanna-build-an-app-app-security |
| `NNEDV_SafetyNet_choosing_apps_documentation_reporting.md` | https://www.techsafety.org/choosingapps ; https://www.techsafety.org/documentationtips ; https://www.techsafety.org/blog/2024/2/2/safety-incident-reporting-options-matter-for-survivors |

**Note.** NNEDV's criteria are grouped as: maximize safety, prioritize privacy, provide education, and work with experts. They cover discoverability of accounts, notifications, location, data retention and deletion, security, and accurate safety information. The original 2015 "App Safety Center" URL now returns 404; these pages replace it. **Eterovic-Soric et al. 2017, "Stalking the stalkers…"** (reported as *Computers & Security* [VERIFY venue]) is paywalled and **was not downloaded**. Only a 2019 thesis record by the same author came up, and its page returned 404.
**Implication for Matra.** Use the NNEDV checklist as a pre-launch review with a NJ coalition advocate (threat model W8). Its documentation tips also suggest content for helping survivors preserve evidence outside Matra.

### 10. Tech-facilitated abuse and device compromise
| File | Citation / URL |
|---|---|
| `Freed_et_al_CHI2018_A_Stalkers_Paradise.pdf` | D. Freed, J. Palmer, D. Minchala, K. Levy, T. Ristenpart, N. Dell, "A Stalker's Paradise: How Intimate Partner Abusers Exploit Technology", CHI 2018, https://rist.tech.cornell.edu/papers/stalkers-paradise-intimate.pdf |
| `Havron_et_al_USENIX2019_Clinical_Computer_Security_IPV.pdf` | S. Havron, D. Freed, R. Chatterjee, D. McCoy, N. Dell, T. Ristenpart, "Clinical Computer Security for Victims of Intimate Partner Violence", USENIX Security 2019, https://www.usenix.org/system/files/sec19-havron.pdf |

**Note.** Freed et al. interviewed 89 survivors and professionals. Most attacks were technically simple and carried out by a "UI-bound adversary", an authenticated insider using the normal interface, or through off-the-shelf spyware. Those attacks fall outside standard threat models. Havron et al. built and field-tested, with 44 survivors, a clinical consultation protocol (TAQ, technograph, the ISDi spyware scanner) that found account compromise, exploitable misconfigurations and possible spyware.
**Implication for Matra.** Matra's threat model lists device access (W8) but scopes out "malware on her device" and "coercion". These papers show those are the *main* threats. Add a link to a tech-safety clinic or advocate, and avoid relying on email or SMS that the abuser may control. Never show "you have a record" signals on a shared device.

### 11. Data-sharing and subpoena precedents for sensitive apps
| File | Citation / URL |
|---|---|
| `FTC_Flo_Health_final_order_2021-06-22.md` | FTC press release, June 22 2021, https://www.ftc.gov/news-events/news/press-releases/2021/06/ftc-finalizes-order-flo-health-fertility-tracking-app-shared-sensitive-health-data-facebook-google |
| `Nebraska_Burgess_AP_2023-07-21_daughter_sentenced.md` | AP via KCTV5, July 21 2023, https://www.kctv5.com/2023/07/21/18-year-old-woman-sentenced-90-days-jail-burning-fetus-after-abortion/ |
| `Nebraska_Burgess_AP_2023-09-22_mother_sentenced.md` | AP via NewsChannel 9, Sept. 22 2023 (URL in file header) |

**Note.** Flo promised privacy but sent users' health events to Facebook, Google and analytics firms through SDKs. The FTC order requires affirmative consent before sharing, notice to users and an independent review. A later private class action against Flo and Meta reportedly went to a jury verdict against Meta in 2025 [VERIFY; not collected]. In Nebraska, police got a warrant for Facebook Messenger content between a mother and daughter. The messages were not end-to-end encrypted, Meta produced them, and both were convicted (the warrant predated *Dobbs*). Primary court filings were not collected; the AP reports are secondary sources.
**Implication for Matra.** Any third-party script is a disclosure channel. Plaintext anywhere (notification emails, attorney inboxes, support tickets) can be produced under a warrant or subpoena. Encrypted content should stay end-to-end through to the attorney, and the attorney's own storage practices should be set out in the partner MOU.

### 12. AI and LLMs in legal intake
| File | Citation / URL |
|---|---|
| `Mata_v_Avianca_SDNY_2023-06-22_sanctions_opinion.pdf` | *Mata v. Avianca, Inc.*, No. 22-cv-1461 (PKC), ECF 54 (S.D.N.Y. June 22, 2023), https://storage.courtlistener.com/recap/gov.uscourts.nysd.575368/gov.uscourts.nysd.575368.54.0.pdf |
| `ABA_Formal_Opinion_512_2024_Generative_AI.pdf` | ABA Standing Comm. on Ethics & Prof. Resp., Formal Op. 512 (July 29, 2024). The ABA site returned 403, so this copy is a verbatim reproduction hosted by MCLE: https://www.mcle.org/ePrograms/2250081P01/1--aba-formal-opinion-512.pdf (canonical: https://www.americanbar.org/content/dam/aba/administrative/professional_responsibility/ethics-opinions/aba-formal-opinion-512.pdf) |

**Note.** Judge Castel sanctioned attorneys $5,000 under Rule 11 for submitting ChatGPT-fabricated cases and then standing by them. Op. 512 covers competence, confidentiality (informed consent before entering client information into self-learning tools), communication, candor, supervision and fees for generative-AI use. NJ has its own court guidance on AI (a "Notice on AI" is linked from njcourts.gov), which was **not collected** [VERIFY current NJ guidance].
**Implication for Matra.** Keep the memo's "no AI on survivor content" commitment. If partner attorneys run Matra records through AI tools, Op. 512 puts consent and confidentiality duties on them. Address this in the partner MOU.

---

## Could not verify or not collected
- Which NJ public law inserted "affirmative and freely-given permission" into 2C:14-2, and its effective date.
- The substance of the P.L.2023, c.127 amendments to SASPA; SASPA §§ 18–21.
- Whether the OVW VAWA confidentiality FAQ (2017) has been updated since VAWA 2022.
- Eterovic-Soric et al. (2017): paywalled, not downloaded.
- Current status of JDoe and Vesta; any independent evaluation of Spot.
- The 2025 Flo/Meta jury verdict and NJ judiciary AI guidance: mentioned, not collected.
- The Callisto funding-crisis date is inferred from the article URL and metadata (around Sept 30 2024). Callisto's current funding status is unknown.
- The NJ statutes database is unofficial and may lag recent enactments. Check each section against the latest P.L. before citing it.
