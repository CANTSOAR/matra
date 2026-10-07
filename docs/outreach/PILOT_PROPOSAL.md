# Pilot Proposal: Matra × [Partner Organization]

*Draft for discussion · [Date] · Prepared by Aryan Malik, founder, Matra ([fiscal sponsor name / pending]) · Not legal advice*

> **Summary.** We propose a 12-month, two-phase pilot with [Partner], a [legal-aid organization / campus-independent sexual-violence advocacy program] in [County/City], NJ. **Phase A uses invented data only.** **Phase B**, supervised use with real adult survivors referred by [Partner]'s trained advocates, starts **only if** every safety gate below is met and both parties sign a written addendum. Matra is free to [Partner]. No money moves between the parties, and none comes from attorneys or cases.

## 1. What Matra is

Matra is a nonprofit, open-source (AGPL-3.0) web tool for adult (18+) sexual-assault survivors:
- **Trauma-informed intake.** She can start anywhere, typing or speaking, or answer one question at a time. Nothing rewrites her words. Voice is transcribed and suggestions are made on her device, and she confirms every one; no AI runs on any server or third-party service. She can skip any question. Prompts are non-leading and sensory. Her words are stored verbatim. Quick Exit is always available.
- **Zero-knowledge vault.** Content is encrypted on her device. The operator stores only ciphertext and **cannot read it**. The operator can see metadata (account existence, timing, sizes, share relationships).
- **Outputs generated on her device:** an **Incident Summary in the Survivor's Own Words**, an **evidence inventory** (photo location data stripped, SHA-256 hashes), and an **NJ VCCO application draft** that states the eligibility rules accurately.
- **Consent-based sharing.** Only if she chooses, she shares a scoped, re-encrypted copy with a verified attorney she picks. She can revoke at any time, and she sees every time the attorney opens it.
- **Never:** automatic sending to police, schools, or employers; legal advice from software; fees of any kind.

**Honest status:** a working prototype that uses invented data only. **No independent security audit yet.** The legal analysis has not yet been reviewed by licensed counsel.

## 2. Why [Partner]

[One or two sentences specific to the partner: e.g., "[Partner]'s advocates already help survivors decide whether and how to seek legal help, and [Partner]'s attorneys handle SVPO, victims'-rights, and VCCO matters." Mention their existing confidentiality practices and VAWA/VOCA experience.]

## 3. Scope

| | **Phase A: Co-design on synthetic data** (Months 0-3) | **Phase B: Supervised real use** (Months 3-9, *conditional*) |
|---|---|---|
| Data | Invented only. No real survivor details anywhere: not in the app, support channels, or feedback | Adult survivors referred by [Partner] advocates, with informed consent |
| Users | [Partner] advocates and [2-4] attorneys test with fictional personas | Up to [15-30] survivors; [Partner]'s verified attorneys plus up to [5] outside pro-bono attorneys under the MOU |
| Features | Intake, vault, summary, VCCO draft, share/revoke | Same, plus share expiry, attorney-first option, 18+ gate, private drafts. **Escrow (matching) disabled.** |
| Partner role | Review the intake script, consent text, and warnings; usability sessions | Advocates introduce the tool and support survivors; attorneys respond to shares |

**Months 9-12:** evaluation, a joint report (aggregate only), and a decision to renew, change, or exit.

## 4. Safety gates before Phase B (all required, all published)
1. **Independent security audit** of the crypto library, server, and web client, with findings fixed or disclosed.
2. **Outside cryptographer review** of the threat model.
3. **Licensed NJ counsel review** of open questions: directory vs. referral service vs. legal service plan (RPC 7.3(e)); privilege design for attorney-directed accounts; deletion and spoliation warnings; VAWA/VOCA conditions.
4. **Advocate sign-off** on the intake script by [Partner] reviewers.
5. **Known blockers resolved:** share expiry (VAWA "reasonably time-limited" consent), enforced 18+ age gate with a referral path for minors, escrow disabled, an attorney key-fingerprint check, MFA or passkeys for attorneys.
6. **Published** law-enforcement request guide, incident-response plan, and survivor-facing privacy notice.
7. **Fiscal sponsor or nonprofit entity in place**, with cyber liability coverage confirmed.

If any gate isn't met, Phase B doesn't start. The pilot continues in Phase A or ends.

## 5. Safeguards during the pilot
- **Survivor control.** She decides what to write, seal, share, and revoke. Nothing is sent anywhere automatically.
- **Honest disclosures before she writes, seals, shares, or deletes:** Matra can't read her records, but a court can order *her* to produce them; anything given to police is shared with the defense; every sealed version is kept; a lost passphrase can't be recovered; revocation can't recall copies an attorney already downloaded.
- **Adults only.** [Partner] follows its own mandatory-reporting duties (e.g., N.J.S.A. 9:6-8.10). Matra has no role in those decisions and cannot read content.
- **No individual-level data** to funders, to [Partner]'s leadership beyond normal case files, or to anyone else. Aggregate metrics are reported with small-cell suppression (n<10).
- **Safety planning.** Advocates cover device safety, shared devices, and Quick Exit limits (browser history and downloads can remain).
- **Feedback without stories.** Feedback covers the product, never survivors' accounts.
- **Pause rule.** Any security incident involving plaintext, any unauthorized share, or any partner safety concern pauses the pilot immediately, with notification within 72 hours.

## 6. Success metrics
**Safety gates (any failure pauses the pilot):** 0 plaintext-exposure incidents · 0 unauthorized shares · 100% of shares with verbatim, ledgered consent · 100% of revocations effective immediately.

**Survivor experience** (optional, anonymous survey): ≥80% "felt in control" · ≥70% "would recommend to a friend" · ≥60% of started intakes reach a saved record (completion at her own pace; we track no timing pressure).

**Partner and attorney:** median ≤3 business days from share to first attorney contact · attorney-reported intake time saved versus [Partner]'s baseline (target ≥30%) · attorney satisfaction ≥4/5 · count of matters opened, by type, in aggregate.

**Explicitly not success metrics:** number of police reports filed, and number of escrow matches. Neither will be incentivized or reported as success.

## 7. Timeline
| Month | Milestone |
|---|---|
| 0 | Sign pilot agreement (Phase A); name points of contact; set baseline intake-time measure |
| 1-2 | Script and consent review sessions; usability testing with fictional personas; revisions |
| 2-3 | Audit fieldwork and fixes; counsel memo; gate review meeting |
| 3 | **Go / no-go for Phase B** (joint, written) |
| 3-9 | Supervised real use; monthly check-ins; quarterly safety review |
| 9-12 | Evaluation, joint aggregate report, renewal or exit |

## 8. What [Partner] commits to
- A named **pilot lead** and **advocate reviewer(s)**: about **[4-6] hours/month** in Phase A, and **[2-4] hours/month** of coordination in Phase B.
- Review and sign-off (or documented objections) on the intake script, consent text, and warnings.
- Only **trained** staff and volunteers introduce Matra. Enroll adults only. Explain the honest disclosures in §5.
- [Partner] attorneys sign the attorney MOU and aim to acknowledge shares within [3] business days.
- Confirm that [Partner]'s grant conditions (VAWA/VOCA/other) allow participation. Send no individual-level data to funders.
- Provide aggregate feedback and take part in the evaluation.

## 9. What Matra commits to
- Software, hosting, onboarding, and a security contact, **free of charge**.
- Prompt notice of incidents and vulnerabilities. Publish audit results.
- No fees, no referral payments, no share of any legal fee or VCCO award, and no sale or analysis of data.
- No use of [Partner]'s name or logo without written permission for each use.

## 10. Exit and data-deletion plan
- **Either party may exit** on [30] days' written notice, or immediately for a safety concern.
- **Survivors keep control.** Each survivor can export her data and crypto-shred her account at any time. On pilot end, survivors receive at least **90 days' notice** and step-by-step help (from advocates) to export and delete. Matra never decrypts content, because it can't. Encrypted data moves to another organization only if Matra itself closes, and then only to the Designated Successor and only with that survivor's individual opt-in. Silence is never consent ([Succession and Data Promise](../SUCCESSION_AND_DATA_PROMISE.md)).
- **After the notice period**, remaining accounts are crypto-shredded: ciphertext and keys are destroyed. **Ledger entries (hashes only, no content) remain** by design, and the ledger will show that records existed and were deleted. Advocates should tell survivors with pending or anticipated litigation to speak with a lawyer **before** deleting (spoliation risk).
- **Attorneys** handle downloaded copies under the MOU: delete within [10] days if no attorney-client relationship formed, otherwise follow the engagement and retention rules.
- **Server logs** are kept at most [30] days with truncated IPs, then deleted. Backups are deleted on the same schedule.
- **Continuity option.** Because the code is AGPL, [Partner] may self-host its own deployment under the pilot agreement's self-hosting terms.
- **Written confirmation.** Matra gives [Partner] written confirmation of deletion and a short exit report (aggregate only).

## 11. Costs and funding
No fees in either direction. Matra's pilot costs (audit, hosting, insurance, advocate honoraria) are funded by grants and donations through [fiscal sponsor]. If [Partner] wishes, Matra can be described as an intake-efficiency tool within [Partner]'s VOCA or OVW LAV project, subject to those grant conditions.

**Governing documents:** the Pilot Partner Agreement template (`docs/legal/pilot-partner-agreement.md`), the Attorney Partner MOU (`docs/ATTORNEY_PARTNER_MOU_TEMPLATE.md`), and GOVERNANCE.md. All are drafts pending counsel review.

*Contact:* Aryan Malik · [email] · [phone] · [demo link]
