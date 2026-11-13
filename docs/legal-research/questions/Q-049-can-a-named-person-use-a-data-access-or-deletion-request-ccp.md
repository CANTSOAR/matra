---
id: Q-049
title: Can a named person use a data-access or deletion request (CCPA, NJDPA) to learn whether he was reported, or to erase identifiers about him?
status: open
priority: P0
area: privacy
jurisdiction: NJ, NY, CA, PA
source: interview 2026-11-11
blocks: Which identifiers about a named person Matra collects; privacy policy; data-request handling
related: Q-030, Q-015, Q-037
created: 2026-11-11
---

## Question

If a named person sends Matra a consumer data-access or deletion request under the CCPA/CPRA or NJ Data Privacy Act, must Matra confirm whether it holds identifiers about him or delete them, and do the nonprofit exemptions or thresholds take Matra out of these laws?

## Context

Founder (interview 2026-11-11): survivors should enter "as many identifiers as possible" about the named person (e.g. phone, email, social handles, school or workplace). Matching entries hold these as OPRF-blinded values, not plaintext. Survivors never see match results precisely so the named person cannot probe whether he was reported ([LEGAL_RESEARCH_MEMO.md §7](../../LEGAL_RESEARCH_MEMO.md#7-blind-escrow-legal-status-of-a-match)); a data-access request would be another probe. The memo (§6) says the NJDPA has no nonprofit exemption but its thresholds would not be met in a pilot.

Founder (2026-11-11) wants a design where Matra "genuinely cannot tell": the matcher sees only that two blinded values are equal, not what they are. Under the OPRF design Matra cannot check whether it holds a given person's identifiers without the key holders' cooperation (n-of-m). The question for counsel includes whether a privacy law could require Matra to run that check.

## Research

<!-- Researchers only. Rules, cases, opinions, with pinpoint citations and links to primary sources.
Mark anything not checked against a primary source [VERIFY]. Arguments both ways. What is unsettled. -->

## Ask for counsel

<!-- At most 5 lines. What we propose to do, and the exact decision we need. Written so it can be answered in 5 minutes. -->

## Answer

<!-- Empty until a licensed attorney answers. Then only "Resolved (D-###)." plus a one-line public conclusion if counsel
approved one. Counsel's actual advice lives in private/DECISIONS.md (gitignored; the repo is public). -->
