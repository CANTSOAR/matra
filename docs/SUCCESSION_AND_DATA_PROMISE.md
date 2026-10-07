# Matra: Succession and Data Promise

*Draft, 2026-10-07. Part 1 is written for survivors. Part 2 is the formal version for partners, funders, fiscal sponsors and counsel. Where the two seem to differ, Part 2 controls and the difference is a bug. Nothing here is legal advice.*

> **Status of this document.** Matra is a pre-pilot prototype that holds no real survivor data. Some of these commitments are already binding in [GOVERNANCE.md](../GOVERNANCE.md) §2. Others are **proposed** and must be adopted by the steward or board, and reviewed by licensed NJ and NY counsel, **before any real survivor data is accepted**. Each item in Part 2 is labelled **Adopted**, **Built**, or **Needs adoption**. Proposed changes to GOVERNANCE.md §2 follow the public process in GOVERNANCE.md §6.

---

## Why this exists

Callisto spent more than a decade building private, survivor-controlled tools, and Matra owes a great deal to its work. Its board announced on 22 July 2026 that it is closing, citing funding ([Callisto, 22 Jul 2026](https://www.projectcallisto.org/blog/closing)). It is planning the wind-down carefully: survivors can download their records, any move to a new home would be offered as a choice, and if no home is found data will be deleted after 30 days' notice. Two earlier moments in its history show why the details matter. In 2020 a plan to delete older campus records was reported as damaging the trust survivors had placed in it ([Stanford Daily, 16 Apr 2020](https://stanforddaily.com/2020/04/16/callisto-campus-tool-for-documenting-sexual-assault-at-colleges-discontinued/)). In April 2026 a privacy-policy update moved match follow-up from attorney counselors to advocates and warned that attorney-client privilege would no longer apply ([Callisto privacy policy, updated 17 Apr 2026](https://www.projectcallisto.org/privacy-policy)). Our research notes are in [research/callisto.md](research/callisto.md).

The lesson we take is about Matra, not about them. Any small nonprofit can run out of money. We would rather make these promises now, while it costs us nothing, than improvise them under pressure.

---

## Part 1. Our promise to you (plain language)

1. **Your account is yours.** What you write, upload or record belongs to you. We cannot read it, and we never sell, license or analyze it.
2. **We will never delete your records unless you ask us to.** No clean-ups of old or inactive accounts. No deleting things because a policy changed. The one exception is if Matra closes and you have neither moved your data nor downloaded it (see promise 5). We tell you about that exception now, before you write anything.
3. **You can always download everything.** "Download my data" on your vault page builds one file on your device with your records, evidence and a list of fingerprints (hashes). It works today. The file is **not** encrypted, so keep it somewhere safe. We will keep it working for as long as Matra runs, including during any shutdown period.
4. **We will tell you at least 90 days before anything big changes.** That includes Matra closing, a new organization taking over, or any change to who can see your information. We will tell you inside the app, and also by the safe contact method you chose, if you chose one. Messages will be neutral and will never say "sexual assault" or name Matra in a way that could put you at risk if someone else reads them.
5. **If Matra closes, nothing moves without your yes.** We are arranging a trusted partner organization to take over the software. Your encrypted data goes to them **only if you say yes**. If you say no or don't answer, nothing moves. We then destroy our copy at the end of the notice period. Even if we close, nobody, including us or the new organization, can read what you wrote without your passphrase.
6. **We will never quietly weaken your protection.** If something changes about who can see your information, or what legal protection applies (for example, if the person who contacts matched survivors changes from a lawyer to a non-lawyer advocate), we tell you **before** it applies. You can withdraw first. Anything you gave us under the old terms stays under the old terms, or stays sealed.
7. **The tools outlive us.** Matra's code is open source (AGPL-3.0), so another nonprofit can keep running it even if we cannot.
8. **We are saving money so that we can close safely if we have to.** We are keeping a reserve that pays for a full, careful shutdown, so that a shutdown is never rushed.

If anything on this page ever stops being true, we have broken a promise. Tell us, and tell the advocates and lawyers you trust.

---

## Part 2. Formal commitments

Defined terms: **Steward** and **board** as in GOVERNANCE.md §3 (until a board exists, the interim steward). **Survivor** means any account holder in the survivor role. **Material change** means any change to the following:
- who can decrypt or view any survivor data or metadata,
- the role, profession or privilege status of anyone who receives matched entries (the Legal Options Counselor model),
- the steward, the operator, or the hosting provider or jurisdiction,
- data retention,
- the software license,
- any new processor that can see survivor metadata, or
- any commitment in this document or in GOVERNANCE.md §2.

| # | Commitment | Status |
|---|---|---|
| D1 | **Ownership.** Survivor content and evidence belong to the survivor. The operator holds ciphertext as a custodian, and acquires no license to use content for any purpose. | Adopted (GOVERNANCE §2.2, §2.6). **Counsel**: reflect in terms of use |
| D2 | **No deletion without individual consent.** The operator never deletes a survivor's records except (a) at her request (crypto-shred, built), or (b) the end-of-life procedure in D6 after full notice. No inactivity purges, no retention-driven deletion, no bulk deletion of legacy records. If a court preservation order or legal hold prevents deletion she asked for, we tell her unless the law forbids it. | Needs adoption. **Counsel**: spoliation interplay (Legal Memo §2), preservation orders, the wording of the D6 exception |
| D3 | **Export, always.** A client-side "Download my data" export (a zip of records, evidence and a hash manifest, decrypted on her device, with an unencrypted-file warning) stays available while the service runs, including the whole notice period. Logins are not disabled before the notice period ends. A documented, versioned export format is published. | Export **Built** (e2e scenario 3). Format documentation: not yet written |
| D4 | **Notice.** At least **90 days'** notice before any shutdown or material change takes effect, through (a) an in-app notice shown at login until acknowledged, (b) her chosen safe contact method where she set one, (c) a public notice page, and (d) notice to partner organizations so advocates and attorneys can reach their clients. Notices use neutral wording that does not reveal the service's purpose. Longer notice applies where these terms or law require it. | 90-day notice **Adopted** (GOVERNANCE §2.9). Notification channel: **not built**. Today the server holds no survivor contact address, so this needs a design that keeps any notice address to minimal, disclosed metadata. **Board + counsel** |
| D5 | **Successor arrangement before real data.** Before accepting real survivor data, the steward signs a succession MOU with a **named** nonprofit partner or fiscal sponsor, the **Designated Successor** ([Successor organization: to be named]). The MOU lets the successor take over the code, deployment materials, domain and partner relationships. It lets the successor receive a survivor's encrypted data only with that survivor's individual opt-in. The successor must adopt this document and GOVERNANCE.md §2 unchanged. It must keep the zero-knowledge design, which means it can no more read records than we can. A fiscal sponsor's standard successor clause is not enough on its own unless it says all of this. | **Needs adoption.** No successor named yet. **Board + counsel**. A gate before real data (proposed addition to GOVERNANCE §5) |
| D6 | **End of life.** If the service closes: new sign-ups stop. Export stays available for the whole notice period (D3). Survivors who opt in are migrated to the Designated Successor. Silence or a "no" is never treated as consent to migrate. At the end of notice, all remaining ciphertext and wrapped keys are crypto-shredded. OPRF key shares and counselor private keys are destroyed, so sealed matching entries cannot be opened or tested again. Backups are destroyed on a documented schedule. A public wind-down report records what was migrated, what was destroyed, and when, in aggregate numbers only. | **Needs adoption**. Runbook in [SUSTAINABILITY_PLAN.md](SUSTAINABILITY_PLAN.md) §7 |
| D7 | **No silent confidentiality downgrade.** A material change that reduces confidentiality or legal protection applies only after D4 notice. Data and matching entries submitted under earlier terms are handled under those terms, or stay sealed, unless the survivor re-consents. Example: if matched entries were submitted on the basis that an **attorney** Legal Options Counselor would open them, they are never released to a non-attorney. If no attorney counselor is available, the entries stay sealed and she is told. She can withdraw any entry before the change applies. | **Needs adoption. Counsel**: privilege implications ([Legal Memo §7A](LEGAL_RESEARCH_MEMO.md#7a-legal-options-counselor-model-privilege-and-solicitation)) |
| D8 | **Open source.** All code stays AGPL-3.0-only, with deployment documentation, so any steward can run it. Releasing the code does **not** release any data. | Adopted (GOVERNANCE §2.4) |
| D9 | **Reserves.** Hold at least **6 months**, target **12 months**, of operating expenses before real-data launch. Separately, ring-fence a **wind-down reserve** large enough to pay for the full D4 to D6 procedure (about 120 days of minimal operations, counselor close-out and secure destruction). The wind-down reserve is never spent on anything else. | **Needs adoption** (board reserve policy). Sizing in [SUSTAINABILITY_PLAN.md](SUSTAINABILITY_PLAN.md) §4 |
| D10 | **Partner and attorney copies.** Copies that attorneys or the counselor already downloaded are governed by their MOU duties (deletion on revocation or close of matter). On shutdown the steward reminds every partner of those duties in writing. Matra cannot recall downloaded copies, and says so. | Partly adopted (MOU). **Counsel**: add an end-of-life clause to the MOU and partner terms |
| D11 | **Transparency.** Funding sources, reserve level (in months), and any trigger reached under the sustainability runbook are published in the annual report (GOVERNANCE §7). | Needs adoption (extends GOVERNANCE §7) |

### What we are honest about
- **Crypto-shred at end of life is a deletion she did not ask for at that moment.** We disclose it at signup as the one exception, and we soften it with 90 days' notice, export and an opt-in successor. The alternative, ciphertext left on an unfunded and unmaintained server, is a worse risk. Counsel should confirm that this disclosure works as informed consent.
- **Notice depends on reaching her.** A survivor who set no safe contact method and does not log in during the notice period will not see the in-app notice. Partner notice and a public notice page help, but cannot guarantee it.
- **A passphrase cannot be recovered by us or by a successor.** Migration moves ciphertext. It does not restore lost access.
- **Metadata** (account existence, timestamps, share relationships, matching-entry existence) goes with a migration only for survivors who opt in, and is destroyed for everyone else.

### Adoption checklist (before real data)
- [ ] Steward or board resolution adopting D1 to D11.
- [ ] NJ and NY counsel review of D2, D4, D6, D7 and D10, and of the signup disclosure.
- [ ] Designated Successor named and succession MOU signed (D5).
- [ ] Reserve policy adopted and the wind-down reserve funded (D9).
- [ ] Notification-channel design reviewed by an advocate and a security reviewer (D4).
- [ ] Export format documented (D3).
- [ ] GOVERNANCE.md §2.9 and §5 amended through the §6 process to reference this document.
