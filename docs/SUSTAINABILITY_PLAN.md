# Matra: Sustainability Plan

*Draft, 2026-10-07. For the steward or board, the fiscal sponsor, funders and partners. Every dollar figure here is a **planning assumption**, not a quote. Sections that need a board decision are marked **[Board]**. This plan goes with the [Succession and Data Promise](SUCCESSION_AND_DATA_PROMISE.md): this document is about staying alive, and that one is about what happens if we can't.*

---

## 1. What Callisto's closure teaches

Callisto's board announced its closure on 22 July 2026. It was the organization's second closure announcement, after a 2024 announcement was reversed by an emergency campaign ([C1](https://www.projectcallisto.org/blog/closing), [C2](https://www.projectcallisto.org/blog/heartbroken), [C3](https://www.projectcallisto.org/blog/2pudhrn3uz765ek50u95z6kbbjwg88)). We say this with respect. Callisto proved that survivors want private, survivor-controlled tools, and Matra is built on its published research. The figures below come from public filings and Callisto's own statements. Full sourcing is in [research/callisto.md](research/callisto.md) §2.

| What happened | Evidence | What Matra does about it |
|---|---|---|
| **A windfall became a cost base.** Revenue peaked at $3.93M in 2018 and fell to $148k by 2021. In later years it ran at about $0.5M to $1M. Spending stayed near $1M or more, and net assets fell from $4.06M (2018) to $0.19M (FY2024) | IRS 990 data via [ProPublica](https://projects.propublica.org/nonprofits/organizations/454011283) | Windfall rule (§4): surges go to reserves and multi-year drawdown, never straight into run-rate |
| **Licensing never paid the bills.** University program revenue peaked at about $208k (2017), roughly 10% of revenue. The CEO later said universities "lacked budget and incentive to identify serial perpetrators" | 990 data; [Tech Matters podcast](https://techmatters.org/callisto-helping-assault-survivors/) | No campus or employer licensing, ever (§3) |
| **No home in a funding portfolio.** In the board's words: "Criminal justice funders see it as a mental health issue. Mental health funders see it as belonging to criminal justice," and most sexual-assault funding is committed to trafficking or child sexual abuse, so adult survivors are left "without a clear home in anyone's portfolio" | [C1](https://www.projectcallisto.org/blog/closing) | Position Matra in **access to justice** and **victim services**, which are funded categories (§3) |
| **One or two grants decided its fate.** A multi-year grant "did not come through as anticipated", and another came in "at a fraction" of plan | C1 | No single funder above about 30% (§3). 6 to 12 months of reserve before real data (§4) |
| **Reach was capped by eligibility.** Accounts required an active .edu email. About 4,000 accounts existed at closure | [C6](https://www.projectcallisto.org/faq); [NY Post via Yahoo, 29 Sep 2026](https://www.yahoo.com/news/us/articles/11-more-women-allegedly-abused-214153313.html) | Adults everywhere in NJ and NY are eligible, with partner-issued invites rather than a single institution type (§5) |
| **Zero knowledge made impact hard to show.** The CEO said Callisto "cannot publish detailed impact data due to encryption" | [Tech Matters](https://techmatters.org/callisto-helping-assault-survivors/) | Privacy-preserving impact measurement designed in from the start (§6) |
| **Cost pressure may have changed the model.** In April 2026, match follow-up moved from attorney counselors to partner advocates, and privilege no longer applied. That cost was the reason is our **unverified inference** | [Privacy policy](https://www.projectcallisto.org/privacy-policy) | Budget counselor time from day one. Never downgrade confidentiality silently ([Promise D7](SUCCESSION_AND_DATA_PROMISE.md)) |

*We do not use Callisto's unpublished outcome statistics as evidence for Matra, and we do not claim to replace Callisto.*

---

## 2. Principles

1. **Small on purpose.** NJ and NY only. One maintainable stack. Open-source cryptography from standards (RFC 9497), not proprietary code.
2. **Mission first, money second.** No revenue from survivors, attorneys, cases, data, or institutions with a conflict of interest (GOVERNANCE §2).
3. **Diversified from the first dollar.** No single source above about 30% of the annual budget once we are past the first year.
4. **Reserve before scale.** No real data without a reserve and a funded wind-down.
5. **Measure without watching.** Impact data must never weaken the zero-knowledge design.
6. **Plan the ending.** A written, funded runbook (§7) that delivers the Succession and Data Promise.

---

## 3. Revenue model **[Board]**

### 3.1 Target mix (steady state, Year 3 onward)

| Source | Target share | Examples (fit to be confirmed) | Notes and constraints |
|---|---|---|---|
| **Access-to-justice funders** | 20–30% | IOLTA Fund of the Bar of New Jersey; IOLA Fund of the State of New York; state bar foundations; legal-aid innovation funds | Matra's attorney-access framing fits these better than a "tech" framing. Eligibility for a non-legal-aid organization is **UNVERIFIED**, and the money may need to flow through a legal-aid partner |
| **Victim-services funding through partners** | 15–30% | VOCA (NJ: OAG/VIVA; NY: OVS) and OVW Legal Assistance for Victims, with Matra as a **subrecipient or tech partner** of a county sexual-violence program or LAV grantee | Federal windows are annual, and FY26 is closed (outreach/README). VAWA and VOCA confidentiality conditions apply (Legal Memo §6) |
| **Tech-safety and public-interest-tech funders** | 15–25% | Craig Newmark Philanthropies; GitHub Secure Open Source Fund; Open Technology Fund (Security Lab, in kind) | Good for audits and security work. Do not let this become the main identity |
| **Individual donors** | 15–25% | Small recurring gifts, a giving page through the fiscal sponsor, a yearly appeal | The most stable, unrestricted money. Survivor stories are never used in appeals |
| **In-kind credits and services** | Not counted in the cap; tracked | Cloud and nonprofit credits (e.g., DigitalOcean, Microsoft), Project Galileo, pro-bono audit and counsel, volunteer engineering | Lowers burn. Never accept an in-kind gift that gives the giver access to metadata |
| **General foundation support** | 10–20% | Gender-justice and civil-rights foundations | Prefer multi-year, unrestricted grants |

**Never accepted:** university or employer licensing (they have a disincentive to identify serial perpetrators); payments from attorneys or firms that receive shares or matches through Matra; anything tied to a case, referral or outcome (RPC 5.4(a), 7.2(c), 7.3(d); ACPE 732). **Counsel**: whether a firm that is *not* a listed partner may sponsor without creating a referral-payment appearance.

**Concentration rule:** if any one source is projected above 30% of next year's budget, the board must either plan replacements or treat the excess as reserve. In Year 1, while a single seed grant may dominate, the board records the exception and the plan to fix it.

### 3.2 Positioning
Lead with **legal access for adult survivors** and **victim-services intake efficiency**, not "tech for good". Ask funders to help close the category gap Callisto named, not only to fund Matra.

---

## 4. Reserves and the windfall rule **[Board]**

- **Operating reserve:** at least **6 months** of budgeted operating expenses in unrestricted cash before any real survivor data, with a **12-month** target by the end of the first real-data year.
- **Wind-down reserve (ring-fenced):** enough to deliver the Succession and Data Promise end to end. Planning assumption: about 120 days of minimal operations, which comes to roughly **$25,000–40,000**: hosting for both key servers, a 0.25 FTE coordinator for notices and partner liaison, counselor close-out time, secure destruction, and the wind-down report. It is held separately and is never counted as operating reserve.
- **Windfall rule:** any unrestricted gift above 25% of the annual budget goes into reserve first. After the reserve targets are met, the rest is drawn down over at least three years. A surge in attention, the way #MeToo was for Callisto, is never treated as run-rate.
- **Hiring rule:** no new permanent position unless its first 12 months are covered by committed funds and the operating reserve stays at or above 6 months afterwards.

---

## 5. Low burn by design

| Choice | Effect |
|---|---|
| Open source (AGPL) and standard cryptography | No licensing cost. Outside review is easier. The code outlives us |
| A small hosted stack one engineer can maintain | Hosting stays in the low thousands of dollars a year. Key server 2 can be run by a partner organization for real independence (security research A4) |
| **Legal Options Counselor time through partner organizations** | A contract or MOU with a legal-aid partner or a pro-bono panel, paid hourly or as a stipend, instead of an in-house attorney network. Counselor hours are a budgeted line. If the budget runs out, matched entries **stay sealed** and nobody is contacted until funding resumes. Survivors are told this when they consent to matching |
| Volunteer and pro-bono attorneys for representation | Survivors choose their own attorney. Matra pays no representation costs |
| **Adults everywhere in NJ and NY, not .edu-gated** | Eligibility is not tied to an institution. Partner-issued invite codes (legal aid, county programs, attorneys) help with account verification without a single gatekeeper type |
| No campus licensing dependency | No B2B sales cycle, and no conflicted payer |

**Illustrative steady-state budget (assumptions, Year 2+):** hosting, two key servers and backups, $5k · 0.5 FTE coordinator $40k · contract maintainer and security work $40k · counselor time through a partner $15–30k · annual re-audit $15–25k · insurance $5k · advocate and survivor-voice honoraria $8k · legal $5k · sponsor fee about 8%. That totals roughly **$145–170k a year**. For scale, Callisto reported a budget of about $1M a year at its 2024 announcement (C2).

---

## 6. Measuring impact without breaking zero knowledge

Funders need numbers, and survivors need to never be watched. The design has five layers. **No layer adds client-side analytics or telemetry** (GOVERNANCE §2.3).

### Layer 1: operational counts the server already holds
The server already sees some metadata: accounts created, records sealed, shares created and revoked, time from share to first attorney open, matching entries lodged, matched groups, and counselor contacts logged. We publish only:
- **quarterly** totals, never daily or weekly,
- rounded to the nearest 5,
- with any cell under **10 suppressed**,
- with no breakdown by county, date or attorney that could single anyone out.

No new data is collected for this. The counts are computed by a published SQL script, so anyone can check what is counted.

### Layer 2: an opt-in, unlinkable survivor survey
- **When:** offered at three moments: after she seals her first record, 14 days after a share, and after a counselor contact. Each offer can be dismissed forever with one tap. The offer never blocks anything.
- **What:** 4 to 6 fixed multiple-choice questions, with **no free text by default**, because free text can identify her or her incident. Core items:
  1. "I felt in control of what happened to my information" (5-point scale).
  2. "Matra saved me from telling my story again" (yes / somewhat / no / not relevant).
  3. "I connected with a lawyer" (yes / not yet / didn't want to).
  4. "I would recommend Matra to a friend" (yes / unsure / no).
- **How it stays unlinkable:**
  - Answers go to a separate endpoint with no session cookie, no account ID and no IP retention.
  - The client holds each response locally and sends it after a random delay of 1 to 7 days, mixed into a batch, so the time a response arrives can't be matched to her activity.
  - Sensitive yes/no items, such as "I took a legal step", use **randomized response** (local differential privacy). Her device answers truthfully with probability 0.75 and otherwise answers at random. The aggregate is corrected with the standard estimator, so no single answer can be trusted to be true.
  - Results are reported only when n ≥ 20 for that item and period.
- **Ballot stuffing:** in the pilot, accept the risk and cross-check against partner-administered paper surveys. Roadmap: one blind-signed token per account per survey wave (Privacy Pass style), so a response is limited to one per account without being linked to it.

### Layer 3: partner-reported outcomes
Attorney partners and the Legal Options Counselor report **aggregate** outcomes from their own case management: matters opened by type, time saved at intake compared with their baseline, and response times. This happens under their own confidentiality duties and the MOU. Matra never receives individual-level outcomes.

### Layer 4: optional demographics, stored apart
An optional, coarse demographics form (age band, county group, language) is submitted to a separate store with no link to the account, following Callisto's published practice of collecting anonymous demographics separately from accounts (C5). It is suppressed below n = 20.

### Layer 5: qualitative evidence
Structured debriefs with advocates and attorneys, and a compensated survivor-voice panel that reviews the product. Survivors' stories are never collected for reporting.

**What we report to funders:** the safety gates (0 plaintext incidents, 100% verbatim consent), "felt in control", time saved at intake, attorney response time, and the number of partners and verified attorneys. **What we never report as success:** police reports filed, or matches found. Matched-group counts may appear in Layer 1 as an operational figure, labelled as not a success measure (PRD §9).

The methodology is published, and an evaluation advisor (for example, from a university violence-research center) reviews the instruments. **[Board]** appoints.

---

## 7. If funding fails: runbook **[Board]**

The runbook delivers the [Succession and Data Promise](SUCCESSION_AND_DATA_PROMISE.md). It is paid for by the wind-down reserve, so the notice period can never be cut short for lack of money.

### 7.1 Triggers (reviewed monthly by the treasurer or steward and reported to the board quarterly)

| Level | Condition | Actions |
|---|---|---|
| **Green** | Operating reserve ≥ 6 months, and next year ≥ 60% committed | Normal operations |
| **Amber** | Reserve 3–6 months, **or** a funder over 30% has not renewed 6 months before its grant ends | Freeze new hires and new features. Cut discretionary spend. Brief the Designated Successor. Start a donor appeal and reach out to funders. Board meets monthly |
| **Red** | Reserve < 3 months with no committed replacement, **or** a board vote to close or transfer | Start wind-down (§7.2) within 14 days. The board may instead approve a transfer of the whole service to the Designated Successor under the same notice rules |

An emergency campaign, like Callisto's in 2024, can move the level back up. The board then re-checks against these thresholds before it reverses a wind-down, and tells survivors plainly if the reprieve is short.

### 7.2 Wind-down timeline (minimum 90 days of notice)

| Day | Step | Promise |
|---|---|---|
| 0 | Board resolution. Wind-down reserve released. Notify the fiscal sponsor, the Designated Successor, counsel and the counselor partner | D5, D9 |
| 0–3 | Stop new sign-ups. **Do not** disable logins, export, revocation or deletion | D3 |
| 0–7 | Neutral notices: in-app banner at login, her chosen safe contact method where set, public notice page, written notice to partner organizations and attorneys (including a reminder of their deletion duties) | D4, D10 |
| 0–30 | Matching: no new entries accepted. Matched groups already pending are worked by the **same class** of counselor (an attorney) under the terms the survivor consented to. If that cannot happen, entries stay sealed and are destroyed at the end | D7 |
| 7–80 | Successor opt-in open. Each survivor chooses "move my encrypted data to [Successor]", "download and delete now", or "do nothing" (do nothing means destroy at the end). Reminders go out at day 30, 60 and 80 | D2, D6 |
| 90+ | Migrate opted-in accounts (ciphertext and the minimum metadata they need). Crypto-shred everything else. Destroy OPRF key shares, counselor private keys and backups on a documented schedule | D6 |
| 90–120 | Publish a wind-down report (aggregate counts only). Archive the repository with deployment docs. Transfer the domain to the successor, or hold it so it cannot be squatted | D6, D8, D11 |

### 7.3 Things we will not do in a wind-down
Delete without notice. Treat silence as consent to migrate. Sell or transfer data to anyone who has not adopted these commitments. Hand matched entries to a less-protected class of reviewer. Contact survivors in a way that reveals the service's purpose.

---

## 8. Governance and review
- The board reviews this plan and the trigger level every year, and after any change of more than 20% in projected revenue.
- The annual report publishes funding sources and amounts, the reserve in months, and the current trigger level (GOVERNANCE §7, Promise D11).
- Counsel reviews §6 Layer 2 (survey consent) and §7 (notice and destruction) before real data.
