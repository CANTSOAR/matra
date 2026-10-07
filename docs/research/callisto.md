# Callisto: research brief (Matra)

Research date: 2026-10-07. Primary sources first; anything not confirmed against a primary or
reputable secondary source is marked **UNVERIFIED**. My own analysis (not a claim from any source)
is marked **[analysis]**.

Note on the brief's premise: the COMPASS 2018 Callisto paper's authors are **Anjana Rajan, Lucy Qin,
David W. Archer, Dan Boneh, Tancrède Lepoint, Mayank Varia**, not "Rajan, Qin, Horn, Tromer". I found
**no** paper titled "Revisiting Callisto" or "Lightweight Secure Matching" by Kamara et al. Seny Kamara
teaches a Brown course on "Crypto for Social Good" (https://cs.brown.edu/people/seny/2950v/), but I
found no Callisto-specific paper by him. The published analyses of Callisto are listed in §4.6.

---

## 0. Key sources

| # | Source | URL |
|---|---|---|
| C1 | Callisto Board, "Funding for survivors is disappearing. And (sadly) so is Callisto." (blog, **22 Jul 2026**) with Q&A | https://www.projectcallisto.org/blog/closing |
| C2 | Callisto, "We're heartbroken" (closure announcement, **25 Sep 2024**) | https://www.projectcallisto.org/blog/heartbroken |
| C3 | Callisto, "Callisto's Search for a Miracle Has Ended…" (reversal, **21 Nov 2024**) | https://www.projectcallisto.org/blog/2pudhrn3uz765ek50u95z6kbbjwg88 |
| C4 | Callisto CEO, "From Darkness to Light" (31 Dec 2024) | https://www.projectcallisto.org/blog/from-darkness-to-light |
| C5 | Callisto Vault Privacy Policy (last updated **17 Apr 2026**) | https://www.projectcallisto.org/privacy-policy |
| C6 | Callisto FAQ, Callisto Vault, About and Our Impact pages | https://www.projectcallisto.org/faq · /callistovault · /about-1 · /our-impact |
| C7 | Callisto Impact Report 2025 (2-page PDF) | https://www.projectcallisto.org/s/Impact-Report-2025.pdf |
| C8 | Callisto, "Revolutionizing Support…" (organization history) | https://www.projectcallisto.org/blog/callistoshistory |
| C9 | Callisto blog: "A Matched Survivor Speaks Out" (27 Mar 2026), "Callisto Helps Survivors Heal…Even When They Don't Match" (14 Apr 2025), "Why name-your-perpetrator sites go viral…then end badly" (30 Apr 2026) | https://www.projectcallisto.org/blog/matched-survivor-speaks · /blog/when-survivors-dont-match · /blog/name-your-perpetrator-sites |
| P1 | Rajan, Qin, Archer, Boneh, Lepoint, Varia, "Callisto: A Cryptographic Approach to Detecting Serial Perpetrators of Sexual Misconduct", ACM COMPASS 2018. Whitepaper version dated 29 Mar 2018, updated 14 Nov 2018 | https://static1.squarespace.com/static/5dafd58b3aca646be471ba55/t/61bf43f9ae1115480709395f/1639924730113/callisto-cryptographic-approach.pdf · https://par.nsf.gov/biblio/10061833 · https://dl.acm.org/doi/10.1145/3209811.3212699 |
| P2 | Little, Qin, Varia, "Secure Account Recovery for a Privacy-Preserving Web Service", USENIX Security 2024 (deployed at Callisto from Oct 2023) | https://www.usenix.org/system/files/usenixsecurity24-little.pdf · code: https://github.com/ryanjlittle/kpop-oprf |
| P3 | Kuykendall, Krawczyk, Rabin, "Cryptography for #MeToo" (WhoToo), PoPETs 2019(3) | https://petsymposium.org/popets/2019/popets-2019-0054.pdf |
| P4 | Arun, Kate, Garg, Druschel, Bhattacharjee, "Finding Safety in Numbers with Secure Allegation Escrows" (SAE/SATE), NDSS 2020 | https://arxiv.org/pdf/1810.10123 |
| P5 | Lee & Suen, "Credibility of Crime Allegations", AEJ: Micro (2020; AEA summary) | https://www.aeaweb.org/research/credibility-criminal-allegations-incentives-libelers |
| F1 | ProPublica Nonprofit Explorer, Callisto (EIN 45-4011283), 990 data FY2013 through FY ending Jun 2025 | https://projects.propublica.org/nonprofits/organizations/454011283 |
| N1 | Stanford Daily, "Callisto Campus … discontinued" (16 Apr 2020) | https://stanforddaily.com/2020/04/16/callisto-campus-tool-for-documenting-sexual-assault-at-colleges-discontinued/ |
| N2 | LA Tribune, "Callisto: A Story of Recognition … Closure & Redemption" (31 Dec 2024) | https://thelosangelestribune.com/2024/12/31/callisto-a-story-of-recognition-from-the-los-angeles-tribune-closure-redemption-to-fight-serial-sexual-assault/ |
| N3 | NY Post story via Yahoo (29 Sep 2026): Callisto closed, about 4,000 survivor accounts, CEO quotes | https://www.yahoo.com/news/us/articles/11-more-women-allegedly-abused-214153313.html |
| N4 | Tech Matters podcast with CEO Tracy DeTomasi (about 2025) | https://techmatters.org/callisto-helping-assault-survivors/ |
| N5 | Badger Herald, "UW denies implementation of Callisto…" (27 Mar 2019) | https://badgerherald.com/news/2019/03/27/uw-denies-implementation-of-callisto-sexual-assault-reporting-services-students-demand-answers/ |
| N6 | "Committed to Dialogue" (pseudonymous survivor), "How Callisto betrayed #MeToo survivors…" (Medium, 19 Apr 2020; archived) | https://web.archive.org/web/20221229045256/https://medium.com/@AngieNmnh/how-callisto-betrayed-metoo-survivors-and-wasted-everyones-time-a5e2ffa98d08 |
| N7 | VentureBeat, Callisto for tech founders (20 Mar 2018) | https://venturebeat.com/2018/03/20/callisto-to-launch-sexual-harassment-tracking-for-tech-startup-founders |
| G1 | GitHub org `project-callisto` (callisto-core AGPL-3.0; crypto-demo AGPL-3.0) | https://github.com/project-callisto |

---

## 1. Status and shutdown

**Confirmed: Callisto announced on 22 July 2026 that it is closing (C1).** This is its second closure
announcement. The first, on 25 Sep 2024 (C2), was reversed on 21 Nov 2024 (C3).

### 1.1 Timeline
| Date | Event | Source |
|---|---|---|
| 2011 | Jess Ladd founds Sexual Health Innovations (SHI). Callisto starts as one SHI product | C8, Wikipedia |
| 2015 | **Callisto Campus** launches. Schools license it. Survivors can file an electronic report to the Title IX office, plus a matching escrow | C8, N1 |
| 2016 | SHI renamed Callisto | C8 |
| Mar 2018 | **Callisto Expansion** pilot for tech founders and VC (funded in part by Greylock and First Round). Matches go to attorney "Options Counselors", not institutions | N7, P1 |
| 2019 | Pivot: ends formal college partnerships and becomes a third-party resource | C8 |
| Winter 2020 | Ladd steps down as CEO. Interim CEO Tina Robilotto | Callisto Medium post "Beginning the search for our next CEO"; N1 |
| Apr–Aug 2020 | Callisto Campus sunset. Callisto first **planned to delete records made before June 2019**, then reversed after backlash | N1; Stanford SHARE office update |
| Late 2020–2022 | Callisto Vault (Incident Log + Matching System) rolled out. Official Vault launch 2022 | C8 |
| Fall 2023 | Vault opened to anyone with an active **.edu** email at any U.S. college | C6 (Our Impact) |
| Oct 2023 | Private account-recovery protocol (K-pop OPRF) deployed | P2 |
| 25 Sep 2024 | Board announces closure. About $1M/yr budget, small remote team. New accounts and matching paused | C2, C3 |
| Oct–Nov 2024 | #SaveCallisto raises more than $250k, including **$200k from Arnold Ventures**. Board votes unanimously to stay open | N2, C3, C4 |
| 17 Apr 2026 | Privacy policy changes: matched survivors now go to **advocates from Ampersands Advocacy Resources instead of attorney LOCs**, with an explicit warning that attorney-client privilege no longer applies | C5 |
| **22 Jul 2026** | **Board announces closure.** New accounts disabled | C1 |
| 29 Sep 2026 | NY Post reports Callisto "has since closed", leaving about **4,000** survivors with accounts. CEO: "There's no money in sexual assault." | N3 |

### 1.2 What exactly ended (as of the 22 Jul 2026 Q&A, C1)
- **The organization is closing.** The board signed the announcement.
- **New accounts:** disabled ("no new accounts can be created").
- **Existing users:** can still log in to **download their Incident Log** or **delete their account**.
- **Matching:** C1 does not say explicitly whether new matching entries or match processing continue.
  With no new accounts and the organization winding down, assume matching is effectively over
  (**UNVERIFIED**). I found no statement about what happens to unprocessed matches or to the advocate
  partnership.
- **Data:** "remains encrypted while we explore our options." Callisto is "actively looking for a new
  home for our technology." If a new home is found, users can either delete their data or let it
  migrate, and will be notified and given time to decide. **If no home is found, all data will be
  deleted, with 30 days' notice to download Incident Logs.** This matches the standing privacy-policy
  promise: "In the event that Callisto ceases operation and there is no successor, we will securely
  delete any collected information" (C5).
- **Successor or acquirer:** none announced as of 7 Oct 2026 (I searched; nothing found, **UNVERIFIED** absence).
- **Whether the site and Vault are still live:** projectcallisto.org was still up on 7 Oct 2026, and its
  homepage still markets the Vault with no closure banner. Only the blog post carries the notice.

### 1.3 Stated reasons (C1, verbatim themes)
1. "A significant multi-year grant that would have allowed us to expand our reach beyond college campuses
   to serve adult survivors through professional membership organizations … did not come through as anticipated."
2. "A separate grant we had cultivated for two years came in at a fraction of what we'd planned for."
3. A structural funding gap: "Criminal justice funders see it as a mental health issue. Mental health
   funders see it as belonging to criminal justice. And most sexual assault-specific funding is already
   committed to trafficking or child sexual abuse, leaving adult survivors of sexual assault without a
   clear home in anyone's portfolio."
4. Wider context the CEO gave the press: "So many rape crisis centers are going away. So many victim
   advocacy organizations have had significant funding cuts" (N3). The 2025 blog posts describe
   federal freezes on sexual-assault funding ("SA Orgs Are Being Starved For Funding", 6 Mar 2025).

The **2024** reasons (C2) were pandemic recovery, inflation, a competitive funding landscape, and the
election season.

---

## 2. Sustainability: what went wrong, and lessons

### 2.1 IRS 990 trend (ProPublica, F1)
Dollar figures rounded. Net assets = total assets − total liabilities.

| Tax period | Revenue | of which contributions | Program-service revenue | Expenses | Net assets (end) |
|---|---|---|---|---|---|
| 2014 | $408k | $408k | $0 | $190k | $256k |
| 2015 | $614k | $570k | $44k | $484k | $310k |
| 2016 | $844k | $744k | $97k | $754k | $400k |
| 2017 | $2.09M | $1.88M | **$208k** (peak licensing) | $987k | $1.50M |
| 2018 | **$3.93M** | $3.75M | $175k | $1.38M | **$4.06M** |
| 2019 | $585k | $424k | $139k | **$2.00M** | $2.60M |
| 2020 | $670k | $584k | $80k | $1.38M | $1.90M |
| 2021 | **$148k** | $148k | $0 | $1.12M | $926k |
| 2022 | $478k | $472k | $0 | $948k | $456k |
| Jan–Jun 2023 (short year; fiscal year changed to July–June, **inferred** from period 202306) | $490k | $485k | $0 | $513k | $433k |
| FY Jul 2023–Jun 2024 | $703k | $693k | $0 | $945k | $191k |
| FY Jul 2024–Jun 2025 | $977k | $920k | $50k | $969k | $193k |

FY2024 officers: CEO Tracy DeTomasi $200k, Lead Engineer $154k, Managing Director $131k. Those three
salaries total about $485k, roughly half of all expenses. FY2025: CEO $205k, Lead Engineer (a different
person) $105k. The FY2025 Impact Report (C7) gives $969,367 raised: **66% private foundations, 29%
individual donors, 5% "program support"**.

### 2.2 Diagnosis
- **A windfall followed by a long burn.** The 2017–2018 #MeToo and VC-era surge put about $4M in the
  bank. Revenue then fell to $148k by 2021 while spending stayed near $1M or more, and reserves went from
  $4.06M to $0.19M in five years. After that, any single grant falling through was fatal, which is
  exactly what C1 describes.
- **Licensing never paid the bills.** University fees peaked at $208k (2017), about 10% of revenue.
  Reported pricing was a $5–10k setup fee plus an annual subscription (about $25k/yr at Pomona;
  secondary press, **UNVERIFIED** figures). The CEO later said the business-to-business Title IX model
  failed because universities "lacked budget and incentive to identify serial perpetrators" (N4). One
  example: UW–Madison declined a fully funded implementation, citing fit, third-party concerns, and
  that it "would direct users to submit a detailed report" (N5).
- **The pivot to a free, survivor-direct product removed earned revenue entirely.** From 2021 on,
  program revenue was $0 until a $50k line in FY2025.
- **Leadership transition, product pivot, and pandemic at the same time.** The CEO called it a
  "perfect storm" (N4): founder exit in 2020, Campus sunset, Vault rebuild, COVID.
- **Zero-knowledge design limits impact reporting.** The CEO said Callisto "cannot publish detailed
  impact data due to encryption" (N4), which hurts grant renewals. Its public metrics were soft:
  "90% feel more secure", "1 match per 40 entries", "580 campuses with accounts" (C7).
- **Narrow eligibility capped reach.** Only users with an active .edu email could sign up, so total
  accounts were about 4,000 (N3) against marketing claims of "500,000+ students across 38 campuses"
  (that figure is *access*, not users; C8). The planned expansion to adult survivors depended on the
  grant that fell through.
- **Funding category gap.** Adult sexual assault falls between criminal-justice and mental-health
  portfolios (C1).
- **Possible cost-cutting signal (UNVERIFIED inference):** the April 2026 switch from attorney LOCs to
  a partner advocacy organization (C5) may reflect the cost of running the attorney network.

### 2.3 Lessons for Matra's funding model
1. **Do not depend on institutions that have a disincentive to find serial perpetrators** (universities,
   employers) as payers. Callisto's B2B attempt failed for exactly this reason.
2. **Diversify early and match revenue to costs.** Reasonable candidates: VOCA and VAWA sub-grants
   through NJ and NY coalitions (note the VAWA confidentiality strings in Legal Memo §6); state AG and
   OVW innovation grants; law-firm pro-bono sponsorship (firms gain lawyer-hours and a CSR story);
   bar-foundation and IOLTA grants (Matra's access-to-justice framing fits these better than a
   "tech" framing); and a small individual-donor base. Target a single funder at no more than 30% of
   budget.
3. **Hold 6–12 months of operating reserve** before adding staff. Never let a windfall turn into a
   permanent cost base.
4. **Keep fixed costs low:** narrow scope (NJ/NY), volunteer or pro-bono attorneys, open-source
   cryptography, and a hosted stack that one engineer can maintain.
5. **Design privacy-preserving impact metrics from day one.** Use aggregate counters with differential
   privacy or k-anonymity, opt-in outcome surveys (Callisto used anonymous post-LOC surveys, C5), and
   attorney-partner outcome reports. Funders need numbers. Matra's PRD rightly excludes "number of
   police reports" and "number of matches" as success metrics. Replace them with access and experience
   metrics.
6. **Write a wind-down and data-succession plan now:** a successor-org MOU, a guaranteed export
   format, and a notice period. Callisto's 2020 deletion announcement was the biggest trust hit it
   ever took (N1). Its 2026 plan (export, then 30 days' notice, then delete) is the model to copy.
7. **Position in a funded category.** Frame Matra as **legal access / access to justice** (bar
   foundations, legal-aid funders) and **victim services**, not only as "tech for good". Callisto's
   "tech nonprofit" identity left it without a natural funding portfolio.

---

## 3. Product features: keep, adapt, avoid

| Feature / decision | What Callisto did | Evidence of what worked or didn't | Matra |
|---|---|---|---|
| **Timestamped encrypted record (Incident Log)** | Optional trauma-informed questionnaire. "Answer as few or as many as you feel comfortable." Encrypted so only the user can read it. Downloadable or printable. Separate from matching | Core value. Users reported healing and validation even without a match (C9). In 2019 the record form crashed partway through and was replaced with a Word template for a time (N6, critic) | **Keep** (Matra has it). Autosave drafts so survivors never re-enter traumatic content. Add a download/print path from day one |
| **Incident Log independent of matching** | Users can use either tool alone (C6) | Lowers commitment | **Keep.** Escrow must never be a prerequisite |
| **Matching on unique identifiers, not names** | Phone, email, social handles/URLs (about 12 identifier types per N4). Callisto-core validators normalize Facebook, Twitter, Instagram URLs and 10-digit phones. The match is "any component equal". The LOC can add identifiers to the vector after a match (P1 §6) | Callisto stresses that names are "not unique enough" (C9) | **Keep and adapt.** Matra matches on full name too; **drop name-only matching** or never let it alone trigger a match. Port the URL/handle normalizers (G1) |
| **Jurisdiction field** | Survivor enters the state of the incident (and campus) as "assignment data", used to route to a counselor licensed there (P1, C5) | Needed for counselor routing and privilege | **Adapt:** NJ/NY plus county, as assignment data visible only to the routing role after a match |
| **Threshold = 2, fixed** | Fixed at 2 for usability: asking a traumatized user to pick a threshold is "unreasonable" (P1 §8) | 1 match per 40 entries (C7). Cluster matches (3+) and cross-coast matches reported (C6) | **Keep t = 2** as default. Do not ask the user to choose |
| **Users never learn of a match automatically** | "Each match must first be reviewed by a confidential advocate. Once verified, each matched survivor will be contacted individually" (C6) | Blocks self-checks by perpetrators. A human filters fake or Sybil matches | **Keep** (Matra already hides matches). Add human review before any contact |
| **Legal Options Counselor (LOC)** | A third-party **attorney**, vetted and contracted by Callisto, contacts **each** matched survivor separately, explains options (criminal, civil, Title IX, restorative, or nothing), and offers to connect survivors. A Director of LOC (DLOC) sees only non-identifying assignment data and assigns a LOC. The legal theory is that data the LOC decrypts is an attorney-client communication, so it is privileged. Callisto staff never hold decryption keys, which keeps the data "not discoverable" from Callisto (P1 §3.2) | Matched survivor: the attorney "offered above-and-beyond legal aid … much-needed emotional support"; matched survivors filed a joint Title IX case (C9). In April 2026 Callisto replaced attorneys with Ampersands advocates and warned that privilege no longer applies (C5) | **Adapt (high value).** Matra's gatekeeper is the survivor's *own* attorney, who cannot reach the *other* survivor. Add a neutral **Matra-contracted counselor attorney** (NJ/NY bar) who can contact both sides with consent. Keep the attorney, not the advocate, for privilege |
| **Consent to counselor access at entry time** | Before entering matching, the user is told the advocate/LOC will be able to see their entry if a match happens (C5) | Informed-consent pattern | **Keep.** Make this a VAWA "reasonably time-limited" consent with renewal |
| **.edu email verification** | Accounts need an active .edu email. Earlier Expansion was invitation-only | Main defense against fake accounts (C5), but **the main cap on reach**. Alumni could not create accounts | **Adapt.** Verify without collecting identity: e.g., partner-issued invite codes (legal aid, rape crisis centers, attorneys), phone OTP with only a keyed hash stored, or anonymous credentials. Don't gate on a single institution type |
| **Account-holder list protected from the provider** | Email, username, phone, and security answers stored encrypted. Email-based recovery via a 2-server OPRF with rate-limiting (K-pop), so Callisto cannot list its users (P2, C5) | Deployed in production Oct 2023. Trauma-informed: a familiar "click the link" flow | **Adapt (roadmap).** Matra currently stores usernames and aliases in plaintext (whitepaper). Studying P2 is worth it if Matra adds recovery |
| **Demographics stored unlinked from account** | Anonymous demographics collected separately for aggregate stats (C5) | Lets them report reach without linkage | **Keep:** this is how to report to funders |
| **Edit and delete any time** | Entries editable. Deletion is permanent. Account deletion removes everything (C5, C6) | — | **Keep** (Matra crypto-shreds) |
| **Matching any perpetrator, any time, any place** | Perpetrator need not be on campus. No time limit (C6) | Cross-coast matches. Matches more than a year apart (C9) | **Keep.** Matra is NJ/NY only, but matching should not be limited by perpetrator location |
| **Survivor-only entry** | No entering on behalf of a friend (C6) | Reduces false entries | **Keep** |
| **Resources and education** | "Should I Report?", Definitions, Forensic Exams, Find Support, Help a Friend, Allies guide, crisis lines (Crisis Text Line 741741) | Content marketing that drives organic reach | **Adapt** for NJ/NY (Five-Year Hold kit, SART, VCCO; see brief-fields research) |
| **Campus ambassadors, toolkits, event sponsorship** | Student ambassador program and downloadable toolkits (C6, C9) | Main reach channel after the B2B model ended. IG followers +108% in FY2025 (C7) | **Adapt:** partner-org ambassadors (law-school clinics, rape crisis centers) |
| **Language: "matching", not "allegation"** | Callisto and P2 avoid "allegation escrow" because "allegation" can imply disbelief | Trauma-informed language | **Adopt:** say "sealed name" or "match", never "allegation" |
| **Callisto Campus → Title IX report submission** | The tool sent reports to the school | Schools would not adopt it (N5), and it tied Callisto to institutions with conflicts of interest | **Avoid** institutional delivery as a default |
| **Plan to delete legacy records (2020)** | Announced deletion of records made before June 2019, then reversed after backlash | "Breached the trust survivors had placed" (N1) | **Avoid.** Any data change needs long notice, export, and opt-in migration |
| **Silent switch from attorneys to advocates** | A privacy-policy update changed confidentiality protections (C5) | Weakens the privilege rationale. Users bear the change | **Avoid** downgrading confidentiality silently. Require re-consent |

**Published outcomes** (Callisto's own claims; methods mostly unpublished):
- Campus era: students with access were **5× more likely to report**, and reported in **4 months on
  average vs. 11** (cited in SATE, P4, from Callisto material). The history page says "6× increase in
  likelihood of reporting" and "3× increase in mental-health service-seeking" (C8). These figures are
  inconsistent and the methods are unpublished. Treat them as **UNVERIFIED**.
- Vault era: "for every 40 entries, a match is found"; accounts at 580 campuses (+54% in FY2025); 90%
  "feel more secure"; 75% improved wellbeing; 76% would recommend (C6, C7). 13% of users were men (N3).
  About 4,000 accounts at closure (N3).
- I found **no** published share of matched survivors who reported or took formal action after a match.

---

## 4. Cryptographic design (implementation-ready summary)

### 4.1 Evolution
1. **Callisto Campus (callisto-core, Django; G1).** Matching entries were encrypted with a key
   stretched from the **identifier itself**: Argon2 or PBKDF2 with a per-record random salt, then
   NaCl SecretBox, then a server "pepper" SecretBox. To match, the server **trial-decrypted every
   MatchReport** with each newly submitted identifier, so the server saw plaintext identifiers at
   submission. Matra's current design (client PBKDF2 plus server HMAC pepper) is roughly at this level.
2. **2018 design (P1): OPRF, key federation, and Shamir sharing.** Described below. It was built by BU
   SAIL. A demo (crypto-demo, TypeScript) replaces the OPRF with `SHA512(PerpID ‖ k_demo)`.
3. **Vault (2020–2026).** P2 says Callisto's production code is TypeScript and that account recovery
   reuses "only the cryptographic primitives already in place for Callisto's existing matching
   process". So the 2018 primitives (OPRF, symmetric and public-key encryption) carried into the Vault.
   The exact Vault matching protocol was **not published** (**UNVERIFIED** that it is identical to P1).
   The 2026 privacy policy says Callisto staff see only "non-identifying visitor ID and account ID(s),
   state, campus — only if a match occurs", and the advocate decrypts name, contact, identifiers, and
   campus (C5).

### 4.2 Roles and stored state (P1 §5)
| Party | Holds | Sees |
|---|---|---|
| User browser | Entry data, user key `kU` (shown to user as random words), perpetrator ID `P` | Only its own data |
| Key server(s) | OPRF key `ks`, **split across 2 servers** (one dedicated physical machine, one VM at a different cloud provider), each with encrypted backup, and rate limiting. Also authenticates users | Who queries and when. Not `P` |
| App/DB server | Ciphertext tuples. **No secrets** ("not a privacy root of trust") | `π` equality classes, i.e., which entries name the same perpetrator, and timing |
| DLOC (Director of LOC, an attorney) | `sk_DLOC` on a hardware-token-protected workstation | Assignment data (state, misconduct category, industry), after a match only |
| LOC (third-party attorney) | `sk_LOC` in a passphrase-protected vault on the workstation | Entry data (names, contacts, identifiers), after a match only |

### 4.3 Protocol (P1, faithful)
Notation: `E(k,m)` is AEAD (libsodium; `π` and a fixed label are used as AD). `E(pk,m)` is libsodium
public-key encryption. Field `p = 2^256 + 297` (prime; I checked with Miller-Rabin).

**Submit**
1. The client authenticates to the key server(s) and runs the OPRF on `P`, getting `P̂ = F_ks(P)`. The
   key server learns the auth token, not `P`.
2. KDF(`P̂`) → three 32-byte values `(a, k, π)`. The line is `Y = aX + k`. Let `U = H(user's unique id)`
   and the share `s = a·U + k mod p`.
3. A fresh `ke` encrypts the entry: `eEntry = E(ke, EntryData)`. Then `ce = E(k, ke)`, `cU = E(kU, ke)`,
   and `c = E(pk_LOC, (U, s, ce))`.
4. A fresh `ka` encrypts assignment data: `eAssign = E(ka, AssignmentData)`. Then `ca = E(k, ka)` and
   `cassign = E(pk_DLOC, (U, s, ca))`.
5. Send `(π, c, cassign, cU, eEntry, eAssign)` to the DB. One tuple per identifier type: `π` and `s` are
   vectors indexed by identifier type, and a match is equality on any component.

**Match.** The DB periodically looks for equal `π` values and notifies the DLOC. The DLOC assigns each
matched user their own LOC.

**Reveal.** The DLOC and LOC decrypt `cassign` and `c` to get `(U_i, s_i)`. Two shares with distinct `U`
values interpolate the line, giving `k`, which decrypts `ca` or `ce`, then `ka` or `ke`, then the data.
The same user resubmitting about the same `P` produces the identical share, so a user cannot match
themselves. **Algorithm 1** handles malicious or malformed shares: try pairs, keep the `k` that
AEAD-verifies, and report entries that cannot be decrypted.

**Edit.** The user enters `kU` to recover `ke` and re-encrypts. If `P` changes, the client re-runs the
OPRF and replaces `π, c, ca, cassign`.

**Multiple LOCs.** One ciphertext per LOC public key. To add LOC Bob, Alice decrypts and re-encrypts to
`pk_Bob`. To remove Bob, delete his ciphertexts.

### 4.4 Known attacks and limitations
| # | Attack | Source | Mitigation (Callisto's or recommended) |
|---|---|---|---|
| A1 | **Sybil / framing:** the accuser's identity isn't bound to the entry. An attacker submits fake entries naming `P` (or under another user's identity) to push past the threshold and expose a real survivor's entry to the counselor | P3 | Callisto: invitation/.edu-only accounts plus human review of matches. Better: one verified account = one share (rate-limit OPRF per verified credential), anonymous credentials, counselor checks plausibility before contact |
| A2 | **Malicious user + DB server count accusations:** query the OPRF for a target `P`, derive `π`, count rows in the DB | P3, P4 | OPRF rate limits. Keep DB access tightly controlled. **[analysis]** Also store `π' = HMAC(k_db, π)` with `k_db` in a KMS so a DB dump alone can't be probed, though the DB operator still can |
| A3 | **Key server learns who submits and when.** Timing near an assault can reveal content | P3, P4 | Unlinkable auth tokens (e.g., blind-signed tokens / Privacy Pass), batched submissions |
| A4 | **Both key-server shares compromised (or one operator controls both)** gives offline dictionary attacks over identifier space (phones are about 10^10) | P1 §6 | Two servers with different admins, OSes, and clouds. HSM/KMS for shares. Rate limiting. **[analysis]** For real independence, have a separate organization (partner legal-aid group or university lab) run key server 2 |
| A5 | **OPRF key loss** permanently breaks matching between old and new entries | P1 | Encrypted backups of each share. **[analysis]** Matra can keep the plaintext identifier in the survivor's E2E vault so the client can re-submit after a key rotation |
| A6 | **Malformed shares** cause denial of decryption | P1 | Algorithm 1 |
| A7 | **[analysis] Counselor plus OPRF access.** Because `(a,k,π)` are a deterministic function of `P̂`, anyone holding `sk_LOC` (which decrypts every `c`, matched or not) who can also query the OPRF can guess `P`, recompute `(a,k)`, check `s = aU + k`, and decrypt a **single unmatched** entry. The threshold is enforced only by the LOC's restraint plus OPRF rate limits | — | Counselors get no OPRF access. Split `sk_LOC` (P1 suggests threshold decryption). Release `c` to counselors only for matched entries (the DB holds them back). Log all decryptions |
| A8 | **Equality pattern leakage:** the DB sees how many entries share a `π` (cluster sizes) even below threshold | P4 | Inherent to clear-text matching on `π`. SAE/WhoToo-style MPC hides it at much higher cost |
| A9 | **Malicious key server** returns wrong evaluations to block matches or to tag users | **[analysis]** | Use the RFC 9497 **VOPRF** mode with published per-server public keys |
| A10 | **Client compromise / malicious JS** | P1 (out of scope) | Same as Matra whitepaper: SRI, build hashes, signed apps |
| A11 | **Incentive / credibility critique:** sealed allegations remove the "encouragement effect", so two escrowed reports may be *less* credible than two public ones in an equilibrium model | P5 | A messaging issue: present a match as a lead for counsel, not as corroboration |

Formal follow-ups that address A1–A3 with heavier machinery: **WhoToo** (P3; group signatures,
homomorphic encryption, threshold choice, traceable false accusations), **WhoToo+** (Hevia &
Mergudich-Thal, LATINCRYPT 2021), **SAE** (P4; per-allegation thresholds, constant-time MPC among
escrows, user paper trail), and **Shield** (Koti et al., WWW 2023; hides thresholds, integrity against
fake and duplicate submissions). None was deployed in a nonprofit product (**UNVERIFIED** absence). P1
explains why Callisto rejected an MPC collective: human trust "does not extend easily" to distributed
collectives, and accountability is hard to assign. No public third-party audit of Callisto Vault was
found. P1 says a "security assessment team" reviewed the design before release, but the report is not
public.

### 4.5 Matra implementation sketch (faithful to P1, using modern standard primitives)
Goal: replace `escrowIdentifierHash` (PBKDF2 with a fixed salt) plus the server HMAC pepper with a
2-server OPRF, and add counselor-only threshold decryption. Library: `@noble/curves` ≥ 2.x, which ships
**`ristretto255_oprf`** (RFC 9497 suite `ristretto255-SHA512`, with `oprf`, `voprf`, and `poprf` modes).
Not yet in Matra's dependencies (only `@noble/hashes` is installed).

**Parties:** Client (survivor browser). **KS1, KS2** (OPRF key servers, ideally different operators).
**App** (existing Express server, no secrets). **Counselor** (Matra-contracted attorney, X25519 keypair
on a separate workstation). Optional **Router** (assignment-data role).

**Setup:** each KS_i runs `voprf.generateKeyPair()` → `(k_i, pk_i)` and publishes `pk_i`. The effective
key is `k = k_1 + k_2` (additive 2-of-2). For 2-of-3, use Shamir shares of `k` with client-side
Lagrange coefficients. Back up each `k_i` encrypted, under separate custody.

**Per identifier** (`type ∈ {phone,email,instagram,…}`; `x = normalizeIdentifier(type, value)`):
```
input   = utf8("matra/escrow/v1|" + type + "|") || x          // domain separation per type
{blind, blinded} = ristretto255_oprf.oprf.blind(input)       // or .voprf.blind
Client → KS_i : { authToken, blinded }                        // KS_i rate-limits per verified account
KS_i → Client : evaluated_i = oprf.blindEvaluate(k_i, blinded) // VOPRF: also a DLEQ proof vs pk_i
E  = Point.fromBytes(evaluated_1).add(Point.fromBytes(evaluated_2)).toBytes()
y  = ristretto255_oprf.oprf.finalize(input, blind, E)          // 64 bytes; = PRF_{k1+k2}(input)
(π, a, kP) = HKDF-SHA256(ikm=y, info="matra/escrow/v1/{tag|slope|secret}")  // a, kP mod p
U  = SHA-256("matra/escrow/U" || userEscrowSecret)            // per-user random secret kept in vault, not userId
s  = (a·U + kP) mod p                                         // degree t−1 poly for threshold t; t=2 → a line
ke = random 32B;  eEntry = AES-GCM(ke, entryJSON)
ce = AES-GCM(HKDF(kP), ke, AD=π);  cU = AES-GCM(userVaultKey, ke)
c  = SealTo(pk_counselor, {U, s, ce})                         // X25519 ephemeral + HKDF + AES-GCM
Client → App : { type, π, c, cassign?, cU, eEntry, eAssign? }
```
I verified the additive combination with `@noble/curves@2.4.0`: summing the two `blindEvaluate`
outputs, then calling `finalize`, gives the same output as `evaluate(k1+k2, input)`. Use the scalar
field `p = 2^256+297` (as Callisto did) or ristretto's group order. Either works as long as every client
uses the same field.

**App server:** stores tuples. A match is ≥ t entries with equal `π` from **distinct** accounts (keep
Matra's `user_id != ?` check). Survivors always see "sealed" (keep). The ledger records only
`escrow.sealed` (keep). On match: notify the counselor **with entry IDs only**, and release the `c`
ciphertexts **only for matched entries** (A7).

**Counselor workstation:** opens each `c` → `(U_i, s_i, ce_i)`. Lagrange-interpolate at 0 → `kP`.
AEAD-verify on `ce` (Algorithm 1 for bad shares). Decrypt `ke` → entry (contact preference, identifiers,
jurisdiction). Then a **human review** step before contacting either survivor (A1). Each survivor is
contacted separately; introductions only with both consents.

**Metadata still visible to Matra:** account existence and timing (unless unlinkable tokens are used);
`π` equality classes; that an entry matched; and KS query logs. Disclose all of this in the whitepaper
and legal memo, the way Callisto's privacy policy does (C5).

**What not to copy from Callisto:** deterministic `U` from user ID (use a per-user secret);
`sk_LOC` able to open unmatched entries (gate releases at the server and split the key); a single
organization running both key servers.

---

## 5. Open-source assets (G1)

| Repo | License | Status | Worth studying |
|---|---|---|---|
| `callisto-core` (Python/Django) | **AGPL-3.0** | Last push 2023-06. Campus-era code (Django 1.11, Py 3.6). 137★ | Identifier **validators and normalizers** (`callisto_core/reporting/validators.py`: Facebook `profile.php?id=` and `/people/` forms, Twitter reserved paths, Instagram regex, 10-digit phone). The trauma-informed **wizard-builder** question flow. PDF report generation. Matching by trial decryption (instructive as an anti-pattern for scale and privacy) |
| `crypto-demo` (TypeScript/Angular, libsodium) | **AGPL-3.0** | 2019 | Clear reference for P1's share generation and interpolation (`client/app/services/crypto.service.ts`), but **OPRF replaced by SHA-512 with a constant**. Do not reuse as-is |
| `django-wizard-builder` | BSD-3 | Archived, merged into core | — |
| `kpop-oprf` (Ryan Little, Sage) | see repo | 2024 | K-pop OPRF for private account recovery (P2) |

**Licensing note for Matra:** AGPL code copied into Matra's server would force Matra to publish its
whole server source under AGPL. That may be acceptable for a nonprofit, but it's a board decision. To
stay license-clean, **reimplement from the papers** (they are not copyrighted protocols) rather than
copying code. Matra's actual production Vault code (TypeScript) was **never open-sourced** (P2 says it
is distinct from the published code).

---

## 6. Critiques (what survivors, advocates, and critics said)

**Positive**
- A matched survivor said she had a match "within months"; multiple students harmed by the same
  perpetrator found each other, filed a joint Title IX case, and received attorney and emotional
  support (C9). This is a Callisto-published testimonial, so selection bias applies.
- Survivors who never matched still valued entering ("This was done to me. And it matters.", C9).
- Academic cryptographers credit Callisto with "demonstrated real-world utility" for threshold-2
  matching (P4).
- The 2024 rescue showed strong grassroots loyalty: survivors posted publicly, and student ambassadors
  ran fundraisers (C3, C4, N2).

**Negative / critical**
- **Trust breaches around data:** the 2020 plan to delete Campus records was "poorly communicated and
  breached the trust survivors had placed" (former ASSU president). "They had trusted this entity
  because it was created by survivors and then found that all of their information had been deleted"
  (Prof. Michele Dauber) (N1).
- **Reliability:** a pseudonymous survivor-critic (N6, single source, polemical) said the record form
  crashed mid-entry in 2019, forcing survivors to re-type, and that Callisto temporarily replaced it
  with a downloadable Word template.
- **Campus politics:** administrators could cite "being on the waitlist" as cover. Only about 12–13
  schools ever joined. Joined schools did little promotion; only 9% of Stanford students knew about
  Callisto Campus (AAU survey via N1; N6). UW–Madison refused even a funded deployment (N5).
- **Institution-by-institution model** doesn't fit perpetrators who cross schools. The critic argued
  for a single national escrow (N6). Callisto later moved to nationwide .edu access, partly answering this.
- **.edu-only access** excluded non-students and alumni who lost their email (C6).
- **Cryptographic critiques:** an informal threat model; Sybil/framing; counting probes; key-server
  timing leakage (P3, P4).
- **Credibility / economics:** sealed allegations may reduce the credibility signal of multiple
  reports (P5).
- **Due-process angle:** I found no substantial published due-process critique aimed specifically at
  Callisto (**UNVERIFIED** absence). Callisto pre-empted this: unique identifiers rather than names,
  no public lists, human review, and counselors rather than institutions as recipients (C9 on
  "name-your-perpetrator" sites). P3 argues the *accused's* confidentiality and traceability of false
  accusations should be design goals.
- **April 2026 confidentiality downgrade** from attorney privilege to advocate confidentiality (C5).
  I found no public reaction (**UNVERIFIED**), but it materially changed users' legal protection.

---

## 7. Recommendations for Matra (ranked)

### Product
1. **Keep the record separate from matching.** The record is the primary value. Matching is optional
   and off by default.
2. **Drop name-only matching.** Match only on unique identifiers. Port Callisto's URL and handle
   normalizers (reimplemented, not copied).
3. **Never automate match disclosure.** Keep "sealed" for survivors and add a human review step
   before any contact.
4. **Build in export and a data-succession plan:** "download everything" in a documented format, plus
   a published wind-down policy (notice period, export window, successor-consent migration).
5. **Verify accounts without building a user list.** Use partner-issued invite codes or OTP with
   hashed storage. Study P2 before adding email recovery.
6. **Aggregate impact metrics designed for privacy,** plus anonymous post-consult surveys.

### Cryptography
1. **Before any real-data escrow:** move to an RFC 9497 **VOPRF over ristretto255 with a 2-of-2
   (or 2-of-3) split key across independently operated servers**, with OPRF rate limits tied to
   verified accounts (§4.5).
2. **Add the counselor threshold layer:** a Shamir-shared entry key per perpetrator, decryptable only
   by the counselor and only for server-released matched entries. Split the counselor key.
3. Per-user secret `U`, not user ID. A distinct-account match rule. Algorithm-1-style robust decryption.
4. Keep plaintext identifiers in the survivor's own E2E vault so entries can be re-derived after key
   rotation or loss.
5. Commission an external review of the escrow protocol (Callisto's informal model drew three
   published attacks), and publish the threat model including metadata leakage (A2, A3, A8).

### Legal Options Counselor model
1. **Add a neutral Matra counselor attorney** (NJ/NY licensed, under contract and MOU) who receives
   matches and contacts **each** matched survivor separately. Introductions only with mutual consent.
   The survivor's own attorney remains an alternative channel.
2. **Use attorneys, not advocates, as the key-holders.** Callisto's discoverability theory rested on
   attorney-client privilege (P1 §3.2). Confirm under NJ RPC 1.6 and NY law (add to Legal Memo §7);
   note the NJ victim-counselor privilege (N.J.S.A. 2A:84A-22.15) as a secondary layer.
3. Use a "DLOC"-style split: a router sees only jurisdiction and category; the counselor sees identity.
4. Budget for counselor time from the start; this is likely where Callisto's costs bit (**UNVERIFIED**).

### Funding and sustainability
1. Anchor in **access-to-justice and victim-services funding** (bar foundations, IOLTA, VOCA/VAWA
   sub-grants via NJ/NY coalitions, law-firm sponsorship), not only "tech for good" philanthropy.
2. Keep no single funder above ~30%. Hold a 6–12-month reserve. Keep fixed costs small
   (Callisto ran about $1M/yr, with half spent on three salaries).
3. Do not build on institutional licensing from universities or employers (conflict of interest).
4. Plan explicitly for a windfall: treat surges as reserves, not run-rate.
5. Consider fiscal sponsorship or an operating partnership with an established NJ/NY legal-aid or
   victim-services organization. That gives a ready successor if Matra cannot continue.

### Messaging to funders about Callisto's closure (respectful, not opportunistic)
- Lead with respect: *"Callisto spent over a decade proving that survivors want private,
  survivor-controlled ways to document harm and find out they are not alone. Its closure is a loss
  for the field."*
- Name the structural problem in Callisto's own words: adult sexual assault "without a clear home in
  anyone's portfolio" (C1). Ask funders to help fix the category gap, not just fund Matra.
- Show what Matra learned: a legal-access framing, diversified revenue, a reserve policy, a data
  succession plan, standards-based open cryptography, and a narrow regional scope.
- **Don't** claim to "replace" Callisto, solicit its users, or imply its technology failed. Offer
  to talk with Callisto's board about any technology or data-rehoming process they're running (C1:
  "actively looking for a new home"). Any user migration must be opt-in and on Callisto's terms.
- **Don't** reuse Callisto's unpublished outcome statistics (5×, 6×, 11→4 months) as evidence for
  Matra.
