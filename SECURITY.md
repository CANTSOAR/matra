# Security policy

## Reporting a vulnerability

Please report privately, not in a public issue.

- Email: [SECURITY CONTACT. Set up a dedicated address before publishing this repo.]
- Include: what you found, how to reproduce it, and what you think the impact is.
- Encrypted reports are welcome. Our PGP key will be published at [KEY LOCATION].

We commit to:

- Acknowledge within 3 business days.
- Give you an assessment within 10 business days.
- Keep you informed until the issue is fixed.
- Credit you in the advisory if you want it.
- **Not pursue legal action against good-faith research** that avoids harming other people's data, stays within your own test accounts, and gives us reasonable time (90 days by default) to fix before disclosure. We can't speak for third parties such as hosting providers.

## Scope

In scope: this repository and any deployment run by the project. Out of scope: social engineering of people, physical attacks, denial-of-service, and third-party services.

**Please never test with real survivor data, and never access another person's records.** Use your own accounts.

## Current status

This is an MVP prototype with no independent audit. Don't use it for real survivor data. The [Security Whitepaper](docs/SECURITY_WHITEPAPER.md) and [threat model](docs/threat-model.md) list the weaknesses we already know about.

## If real data is ever exposed

We will notify affected users and partner organizations promptly, tell them what was and was not exposed (the server holds ciphertext and metadata, not plaintext), and publish an incident summary.
