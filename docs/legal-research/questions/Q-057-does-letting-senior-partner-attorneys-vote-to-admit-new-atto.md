---
id: Q-057
title: Does letting senior partner attorneys vote to admit new attorneys to Matra's verified list create referral, endorsement or negligent-vetting exposure for Matra or the voting attorneys?
status: open
priority: P1
area: referral
jurisdiction: NJ, NY
source: Founder, 2026-11-12: attorney verification design
blocks: Attorney verification process; signed attorney directory
related: Q-001, Q-053
created: 2026-11-11
---

## Question

If Matra admits attorneys to its verified list partly on votes from attorneys already on it, does that make the list a lawyer referral or endorsement under NJ/NY RPC 7.2–7.3, and does it expose Matra or the voting attorneys to negligent-vetting liability if an admitted attorney harms a survivor?

## Context

Today an operator verifies attorneys by hand (`apps/server/src/verify-attorney.ts`), and the branch `weekend-mvp` adds a
directory of verified attorneys signed with Matra's organization key, which survivors' browsers check automatically
(threat model W3). Founder proposal (2026-11-12): existing attorneys in good standing vote on new ones; votes from
attorneys with more cases or longer tenure count more, or many mid-tier votes suffice; a voter must have handled at
least one case and been with Matra 3 months. Design concerns noted with it: counting "cases" means Matra records which
attorney took which survivor's matter; weighted votes can be gamed by a small group; factual checks (licence, good
standing, identity) come from bar records rather than votes. Related: whether the list is a referral service (Q-001)
and Matra's liability for a listed lawyer (Q-053).

## Research

<!-- Researchers only. Rules, cases, opinions, with pinpoint citations and links to primary sources.
Mark anything not checked against a primary source [VERIFY]. Arguments both ways. What is unsettled. -->

## Ask for counsel

<!-- At most 5 lines. What we propose to do, and the exact decision we need. Written so it can be answered in 5 minutes. -->

## Answer

<!-- Empty until a licensed attorney answers. Then only "Resolved (D-###)." plus a one-line public conclusion if counsel
approved one. Counsel's actual advice lives in private/DECISIONS.md (gitignored; the repo is public). -->
