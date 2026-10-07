> **Superseded in parts.** This is the original outreach playbook, corrected inline on 2026-10-06. Where it conflicts with [GOVERNANCE.md](../../GOVERNANCE.md), [../LEGAL_RESEARCH_MEMO.md](../LEGAL_RESEARCH_MEMO.md) or [../legal/](../legal/README.md), those win. Known problems: the equity/PBC option for advisors is **not allowed** (for-profit attorney routing is barred in NJ and the project takes no equity); "within 90 days" is outdated (VCCO requires a police report within 9 months); the "80% less administrative burden" and "mathematically" claims are unsupported; use the agreements in `docs/legal/` instead of the FAST template; and don't promise "state funds cover counsel", since VCCO-paid work isn't pro bono and Matra takes no share.

## Part 1: The Essential Domain Reading List

To build an intake engine and digital evidence pipeline that can stand up to legal scrutiny without harming survivors, master four core areas (corrected citations and reading notes are in `compiled_resources/*/SOURCES.md`):

### 1. Trauma Neurobiology & Cognitive Interviewing

* **EVAWI Training Bulletins (End Violence Against Women International):** Read *Understanding the Neurobiology of Trauma and Implications for Interviewing Victims* (Wilson, Lonsway, & Archambault) and *Effective Victim Interviewing*. The *Cognitive Interview Adapted to Trauma (CI-AT)* is a separate protocol by the Sûreté du Québec with Fisher and Hopper, not an EVAWI guide. These explain why trauma impairs linear chronological memory while locking in intense sensory details (auditory, tactile, olfactory).
* **Fisher & Geiselman's Cognitive Interview Framework:** Study *Memory-Enhancing Techniques for Investigative Interviewing* (1992) and their 2010 paper on *Therapeutic Jurisprudence* (IJLP 33:321). Learn the difference between leading questions (which defense counsel will use to invalidate statements) and non-suggestive sensory prompts.
* **National Institute of Justice (NIJ) / Dr. Rebecca Campbell:** Review Dr. Campbell’s published lectures and research briefs on the neurobiology of sexual assault and the physiology of the freeze/tonic immobility response.

### 2. Forensic Digital Evidence & Chain of Custody

* **NIST SP 800-86:** *Guide to Integrating Forensic Techniques into Incident Response*. An organizational incident-response guide (2006) covering hashing and data preservation. It is not a court admissibility standard; pair it with FIPS 180-4 and RFC 3161.
* **Federal Rules of Evidence (FRE):**
* **Rule 803(5) (Recorded Recollection):** A hearsay exception that applies only if the survivor testifies that she made or adopted the record while fresh and now cannot recall. It is read into evidence, and it does not avoid the Confrontation Clause (see the Legal Memo §1).
* **Rule 901 & Rule 902 (Authentication and Self-Authentication):** How hashes support showing that an electronic file has not been altered since it was hashed (902(13)/(14) need a qualified person's certification and pretrial notice). A hash does not prove when, who, or truth.



### 3. Legal Ethics, Privilege, and Statutory Frameworks

* **The Crime Victims' Rights Act (18 U.S.C. § 3771) & Uniform Victims of Crime Act:** Federal standards governing the right to protection, proceedings, and insulation from the accused.
* **State Victims Compensation Statutes (e.g., N.J.S.A. 52:4B-1 et seq.):** Study New Jersey’s Victims of Crime Compensation Office (VCCO) regulations. Learn the exact conditions: VCCO pays attorneys $275/hr, up to $10,000 for legal assistance inside the $25,000 award cap, only for an otherwise eligible victim (police report within 9 months; claim filed within 5 years). See the Legal Memo §3.
* **Third-Party Record Doctrine & Attorney-Client Privilege:** Research *Upjohn Co. v. United States* and legal tech casework on whether data entered into a non-attorney platform waives confidentiality or can be subpoenaed by a criminal defense attorney.

### 4. Cryptographic Escrow & Privacy Tech

* **Callisto Academic Whitepapers:** Read *Callisto: A Cryptographic Approach to Detecting Serial Perpetrators of Sexual Misconduct* (Rajan, Qin, Archer, Boneh, Lepoint, Varia, COMPASS 2018). Note that Callisto does **not** salt-and-hash identifiers: phone numbers are low-entropy, so a salted or peppered hash can be reversed by whoever holds the secret. Callisto uses an OPRF with key federation and Shamir secret sharing.

---

## 2. Advisory Board Recruitment & Governance Plan

An advisory board for this product must provide institutional credibility, legal review, and clinical safety.

### The Ideal 3-Member Advisory Profile

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CORE ADVISORY COUNCIL                           │
├────────────────────┬────────────────────┬──────────────────────────────┤
│ 1. Legal & Courts  │ 2. Clinical Trauma │ 3. Campus / Grassroots       │
│ • Victims' rights  │ • Forensic psych   │ • Title IX administrator     │
│   attorney or      │   or certified     │   or survivor coalition      │
│   former SVU DA    │   cognitive lead   │   policy director            │
└────────────────────┴────────────────────┴──────────────────────────────┘

```

1. **The Legal Voice (Victims’ Rights / Criminal Law):**
* *Profile:* A practicing victims' rights attorney, a clinical law professor specializing in domestic/sexual violence, or a former special victims prosecutor.
* *Role:* Reviews the evidentiary brief template, flags outputs that could waive privilege or raise evidentiary problems, and advises on VCCO eligibility.


2. **The Clinical Voice (Trauma & Forensic Interviewing):**
* *Profile:* A licensed trauma psychologist, a certified Forensic Experiential Interviewing (FETI) practitioner, or an EVAWI-aligned researcher.
* *Role:* Reviews the intake question tree, screens prompts for re-traumatization risks, and confirms questions follow non-leading cognitive interview protocols.


3. **The Institutional Gatekeeper (Title IX / Survivor Advocacy):**
* *Profile:* A university Title IX coordinator, an executive director from a state coalition against sexual assault (e.g., NJ Coalition Against Sexual Assault (NJCASA) or NJ Coalition to End Domestic Violence), or a campus safety director.
* *Role:* Provides ground-level insight into institutional barriers, reporting fears, and pilot deployment pathways.



---

## 3. Where to Find Them

* **Local Clinical Law Programs:** Reach out to directors of Domestic Violence, Women's Rights, or Criminal Justice legal clinics at nearby law schools (e.g., Rutgers Law in Newark/Camden, Seton Hall Law, or NYU School of Law). Clinical professors are often receptive to mission-driven civic technology.
* **State Coalitions & Non-Profits:** Target policy directors and legal liaisons at organizations like the New Jersey Coalition to End Domestic Violence (NJCEDV) or county victims' advocacy centers (e.g., Morris County, Somerset County, or Middlesex County).
* **Forensic Psychology Faculty:** Look for researchers in university psychology or criminal justice departments who specifically publish on memory recall, trauma neurobiology, or witness testimony.

---

## 4. How to Pitch and Convince Them

Domain experts in this space are frequently pitched by well-meaning developers whose apps are naive, legally hazardous, or exploitative. To earn their attention, demonstrate technical humility and deep awareness of the legal pitfalls:

1. **Acknowledge the Third-Party Subpoena Risk Immediately:** Show them you know that unprivileged intake databases can be subpoenaed by defense attorneys. Explain the zero-knowledge model and its limit: Matra cannot decrypt records, but the survivor (and anyone she shares with) can still be compelled, and metadata is producible.
2. **Present a Working Artifact, Not an Idea:** Bring a working intake prototype and a sample PDF export of the generated evidentiary brief. Ask for their critique of the artifact.
3. **Keep the Commitment Light:** Request 1 hour per month or a quarterly review session. Do not ask for a heavy operational burden.

### Cold Outreach Email Template

> **Subject:** Civic tech inquiry: trauma-informed evidentiary compiler & zero-knowledge architecture
> Dear [Professor / Director Last Name],
> I am developing an early-stage civic tech project designed to reduce the administrative and trauma burden on survivors reporting sexual violence.
> Many digital tools either push reports directly into institutional systems or create readable databases that can be subpoenaed. We have built an open-source, non-profit prototype in which a survivor records her account once through a non-leading intake, keeps it encrypted so we cannot read it, and chooses whether to share it with a verified attorney. It has not been audited and holds only synthetic data.
> Because intake workflows must strictly align with non-leading cognitive interviewing protocols and trauma neurobiology, we are forming a small unpaid advisory council to review our question tree and legal assumptions.
> I have a functional intake prototype and sample evidentiary brief ready. Would you be open to a 20-minute introductory call so I can show you the architecture and get your critical feedback on our evidentiary structure?
> Respectfully,
> Aryan Malik
> [Contact / GitHub / Portfolio Link]

---

## 5. Structuring the Advisory Relationship

* **Advisory Agreement:** Use [docs/legal/advisor-agreement.md](../legal/advisor-agreement.md) (unpaid, no equity), not the Founder Institute FAST template, which is an equity agreement for for-profit companies.
* **Commitment Terms:**
* Time: 1–2 hours per month (asynchronous document review + one quarterly 45-minute sync).
* Scope: Review intake prompts for non-leading phrasing, advise on evidence admissibility under local state court rules, and review data security practices.


* **Compensation:**
* For pre-funded civic tech or non-profit structures, advisory roles for university faculty and non-profit directors are often pro-bono (or honorarium-based once grants land) to avoid conflicts of interest with their universities or organizations.
* ~~If organized as a public-benefit corporation (PBC), advisors typically receive equity.~~ **Not applicable.** Matra has no equity, and a for-profit entity cannot run attorney routing in NJ (Legal Memo §5). Honoraria only, from grants, as in the advisor agreement.


* **Public Association:** Specify in the agreement that their name and title can be listed under an "Advisory Board / Technical Review Council" on your pitch decks and documentation only after they agree in writing to the specific wording, and without implying endorsement or certification (advisor agreement §8).