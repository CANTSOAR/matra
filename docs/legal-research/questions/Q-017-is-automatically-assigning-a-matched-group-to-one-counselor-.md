---
id: Q-017
title: Is automatically assigning a matched group to one counselor by jurisdiction and circumstance a lawyer referral?
status: open
priority: P0
area: referral
jurisdiction: NJ, NY, CA, PA
source: Callisto meeting 2026-11-10
blocks: Matcher/router design
related: Q-001, Q-018
created: 2026-11-10
---

## Question

If a separate matcher server assigns each matched group to one qualified counselor based on the survivor's jurisdiction and circumstance, is that a lawyer referral (RPC 7.2(b)-(c), 7.3) and what rules govern how the assignment is made?

## Context

Decided at the Callisto meeting 2026-11-10: the matcher should not be the lawyer. A separate server learns only 'match + routing tag' (state, category such as campus/workplace/criminal), holds no decryption keys, and assigns the group to one counselor; only that counselor's seals are released. Today every counselor on the roster with seals receives the group. Related: Q-001. Background: [SECURITY_WHITEPAPER.md §4a](../../SECURITY_WHITEPAPER.md), [LEGAL_RESEARCH_MEMO.md §5](../../LEGAL_RESEARCH_MEMO.md#5-unauthorized-practice-of-law-lawyer-referral-and-fee-sharing).

Interview 2026-11-10: the founder now wants the matcher to also judge whether reports are strong enough to open a case (see Q-022), pick a lawyer near the case or person using low-knowledge metadata, and send the bundle to that lawyer directly (see Q-021).

## Research

<!-- Researchers only. Rules, cases, opinions, with pinpoint citations and links to primary sources.
Mark anything not checked against a primary source [VERIFY]. Arguments both ways. What is unsettled. -->

## Ask for counsel

<!-- At most 5 lines. What we propose to do, and the exact decision we need. Written so it can be answered in 5 minutes. -->

## Answer

<!-- Empty until a licensed attorney answers. Then only "Resolved (D-###)." plus a one-line public conclusion if counsel
approved one. Counsel's actual advice lives in private/DECISIONS.md (gitignored; the repo is public). -->
