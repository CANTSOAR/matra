---
id: Q-038
title: Can IP and device logs kept only for rate limiting and bot detection be compelled to identify a survivor, and how short must retention be?
status: open
priority: P1
area: privacy
jurisdiction: NJ, NY, CA, PA, federal
source: interview 2026-11-11
blocks: Logging and rate-limit design; privacy policy
related: Q-013, Q-039, Q-003
created: 2026-11-11
---

## Question

Can IP addresses and device information Matra keeps only for rate limiting and bot detection be compelled (e.g. under 18 U.S.C. § 2703(c)-(d) or a civil subpoena) to identify a survivor or link her to a report, and does deleting them after a short fixed period (hours or days) avoid that?

## Context

Founder (interview 2026-11-11): "record some IP and device info but only for rate limits and standard bot catching, not really for the report itself." Retention period not decided. Reports are end-to-end encrypted and the operator holds no plaintext ([SECURITY_WHITEPAPER.md](../../SECURITY_WHITEPAPER.md)), so these logs may be the most identifying thing Matra holds.

Proposed 2026-11-11 (founder asked for a recommendation; pending counsel): never write raw IPs to disk; rate-limit on a keyed hash of the IP held in memory and discarded within 24 hours; no device fingerprint stored with any account or report.

## Research

<!-- Researchers only. Rules, cases, opinions, with pinpoint citations and links to primary sources.
Mark anything not checked against a primary source [VERIFY]. Arguments both ways. What is unsettled. -->

## Ask for counsel

<!-- At most 5 lines. What we propose to do, and the exact decision we need. Written so it can be answered in 5 minutes. -->

## Answer

<!-- Empty until a licensed attorney answers. Then only "Resolved (D-###)." plus a one-line public conclusion if counsel
approved one. Counsel's actual advice lives in private/DECISIONS.md (gitignored; the repo is public). -->
