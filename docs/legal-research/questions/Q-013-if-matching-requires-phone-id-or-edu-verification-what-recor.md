---
id: Q-013
title: If matching requires phone, ID or .edu verification, what records can be compelled, and can we verify then forget?
status: open
priority: P0
area: sybil
jurisdiction: NJ, NY, CA, PA, federal
source: Callisto meeting 2026-11-10
blocks: Choice of account verification for sealed matching (W13 Sybil resistance)
related: Q-014
created: 2026-11-10
---

## Question

If Matra requires phone, ID or .edu-email verification before a survivor can lodge a matching entry, what records of that verification can be subpoenaed or must be kept, and does an anonymous-credential design (verify once, receive an unlinkable token, keep no link to the account) change that?

## Context

Decided at the Callisto meeting 2026-11-10: add login friction to stop fake accounts forcing matches. Proposal: friction only on sealed matching, not the vault. Options: phone with carrier lookup (no VoIP), .edu email for campus pilots, partner-advocate invite codes, government ID. 'Verify then forget' would use blind-signed tokens (Privacy Pass style) so the matching server cannot link a token back to the verification. Risk: a verification record ties a real person to 'reported someone'. Background: [threat-model.md](../../threat-model.md) W13, W15.

Founder (interview 2026-11-11): verification should make creating an account "hard enough that bad actors can't make a bunch but easy enough that it doesn't deter people". An MCP/agent interface (Q-048) would make bulk accounts easier. Age checking may share this step (Q-046).

Founder (2026-11-11): sign-up collects phone number, email and username; verify the phone first, add ID verification only if phone proves too weak. Open design point: whether the phone and email are stored or verified then forgotten. SMS verification also leaves a record with the SMS provider.

## Research

<!-- Researchers only. Rules, cases, opinions, with pinpoint citations and links to primary sources.
Mark anything not checked against a primary source [VERIFY]. Arguments both ways. What is unsettled. -->

## Ask for counsel

<!-- At most 5 lines. What we propose to do, and the exact decision we need. Written so it can be answered in 5 minutes. -->

## Answer

<!-- Empty until a licensed attorney answers. Then only "Resolved (D-###)." plus a one-line public conclusion if counsel
approved one. Counsel's actual advice lives in private/DECISIONS.md (gitignored; the repo is public). -->
