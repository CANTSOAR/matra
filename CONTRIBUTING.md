# Contributing

Thanks for helping. This project handles safety-critical data, so the bar for changes is high.

## Rules that never bend

- No analytics, tracking or telemetry. No third-party network calls from the client or server without a documented reason and a [GOVERNANCE.md](GOVERNANCE.md) change.
- No real survivor data in tests, fixtures, screenshots, issues or logs. Use synthetic data.
- No crypto changes without tests and an update to [docs/SECURITY_WHITEPAPER.md](docs/SECURITY_WHITEPAPER.md) and [docs/threat-model.md](docs/threat-model.md). Don't invent primitives. Use WebCrypto and well-reviewed constructions.
- No product copy that overstates protection. See [docs/LEGAL_RESEARCH_MEMO.md](docs/LEGAL_RESEARCH_MEMO.md) section 8 for wording to avoid (for example "subpoena-proof", "bulletproof", "admissible", "mathematically impossible").

## Licensing and sign-off (DCO)

Contributions are accepted under [AGPL-3.0-only](LICENSE). You keep your copyright. We don't ask for a copyright assignment or a CLA, so nobody, including the project's steward, can relicense the code under terms that permit commercial closure.

Sign every commit with `git commit -s`, which certifies the [Developer Certificate of Origin](https://developercertificate.org/): you wrote it or have the right to submit it under this license. Commits without a `Signed-off-by` line won't be merged.

## Workflow

1. Open an issue first for anything beyond a small fix.
2. Branch, make the change, run `npm test` and `npm run typecheck`.
3. Open a PR describing what changed and why. Security-relevant changes get a second maintainer review.

## Vulnerabilities

Don't file them as issues. See [SECURITY.md](SECURITY.md).

## Conduct

Be respectful. People here may have lived experience of violence. Don't ask contributors or partners to share their stories, and don't share anyone else's.
