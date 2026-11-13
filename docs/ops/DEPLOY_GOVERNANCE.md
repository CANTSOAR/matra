# Deploy governance: n-of-m approval for code that reaches survivors

*Proposed process, 2026-11-11. Not yet adopted: today Matra has one maintainer, no CI and no branch protection on
`main`. This document describes what has to be true before real data (GOVERNANCE.md §5) and how to get there. Legal
questions it raises are in the research bank and are not answered here: **Q-044** (do outside approvers become jointly
liable, and may a nonprofit board give outsiders a veto), **Q-040** (are co-administering organizations custodians that
can be served with process), **Q-041** (public universities as participants).*

## 1. Why

The OPRF key is split t-of-m across separate institutions (threat model W14), and the matcher is meant to run public
code in an attested enclave (W18). Both protections are only as strong as the process that decides which code runs:
whoever can ship code alone can ship a client that leaks her passphrase (W4), a matcher that routes differently, or an
app server that asks the key holders for guesses (W14). The rule here mirrors the keys: **no single person or
organization can put new code in front of survivors.**

What this process can and cannot bind, stated honestly:

| Surface | What enforces the rule | Gap today |
|---|---|---|
| Source on `main` | GitHub branch protection + CODEOWNERS (§3) | Not configured yet |
| Matcher code | Survivors' clients and the app server pin `MATRA_MATCHER_MEASUREMENT`; a changed matcher is refused until a new pinned web build ships | Attestation is **simulated** (W18): a modified process can report the published measurement. Real enclave attestation is HOSTING.md work |
| Matcher secrets | In a real enclave, the key service releases the matcher's key only to the published measurement (HOSTING.md §3) | Not built; today `MATRA_MATCHER_KEY` is an environment variable |
| Web app served to survivors | Published build hash (§4) that anyone can compare against the served files | The operator serves the bundle, so a hash only lets people *detect* a swap, it does not prevent one (W4). Reproducibility of the web build has not been tested |
| App server | Release tags (§4) and the deploy credential held by a deploy role (§5) | The host's deploy credential can push any image; only process, not cryptography, stops it |
| Key holders | Each institution runs its own holder and decides when to upgrade | No signed-release check in the holder yet |

## 2. Approvers

- **Approver organizations (m).** Each is a separate organization (for example a university lab, a legal-aid
  organization, a security nonprofit), named in a written agreement (Q-040, Q-044). Proposed: the same institutions that
  hold OPRF key shares, plus Matra itself, so that the approver set and the key-holder set fail in the same way.
- **Threshold (n).** Proposed **2 approvals from 2 different organizations** for any change to a protected path, at
  least one of them not employed by or paid by Matra. A change to `packages/crypto`, `apps/matcher` or the key holder
  needs **3 approvals from 3 organizations** when m ≥ 3.
- **Who is an approver.** A named person per organization, with a GitHub account that has 2FA and signs commits.
  Organizations add or remove their own person by written notice; Matra cannot remove an organization's approver on its
  own (the agreement says how an organization leaves).
- **Conflicts.** GOVERNANCE.md §4 applies: an approver discloses any interest in the change and does not count toward
  the threshold for it.

## 3. GitHub configuration (to set up)

On `main` (Settings → Branches → branch protection rule, or a ruleset):

- Require a pull request before merging; **required approvals = n**; dismiss stale approvals when new commits are
  pushed; require approval of the most recent push by someone other than its author.
- Require review from **Code Owners**.
- Require signed commits; require linear history; block force pushes and deletion.
- Require status checks: typecheck, unit tests, e2e, `scripts/audit-web-build.mjs` (needs CI, which the repository does
  not have yet).
- **Do not allow bypassing the above**, including for administrators. The repository owner keeps the technical power
  to change these settings; every change to them is listed in the transparency report (§6).

**Limit to know about [VERIFY against current GitHub documentation]:** GitHub counts approvals and requires *a* code
owner, but it does not natively require approvals from *different organizations*. Two options: put each organization's
approver in a separate GitHub team and add a required status check (a small workflow that reads the pull request's
reviews and fails unless approvals come from at least n distinct teams), or keep a signed approval file per release
(§4) and treat the GitHub settings as a convenience, not the guarantee.

Proposed `.github/CODEOWNERS` (team names are placeholders; create the teams first, then commit the file):

```
# Every file needs one approver; the threshold is enforced by required approvals + the distinct-org check.
*                               `matra/maintainers`
/packages/crypto/               `matra/crypto-reviewers` `org-a/matra-approvers` `org-b/matra-approvers`
/apps/matcher/                  `matra/crypto-reviewers` `org-a/matra-approvers` `org-b/matra-approvers`
/apps/server/src/oprf*.ts       `matra/crypto-reviewers` `org-a/matra-approvers` `org-b/matra-approvers`
/apps/server/src/holder*.ts     `matra/crypto-reviewers` `org-a/matra-approvers` `org-b/matra-approvers`
/apps/server/src/privacy.ts     `matra/maintainers` `org-a/matra-approvers`
/apps/web/vite.config.ts        `matra/crypto-reviewers` `org-a/matra-approvers`
/package-lock.json              `matra/crypto-reviewers` `org-a/matra-approvers`
/docs/threat-model.md           `matra/crypto-reviewers`
/docs/SECURITY_WHITEPAPER.md    `matra/crypto-reviewers`
/.github/                       `matra/maintainers` `org-a/matra-approvers` `org-b/matra-approvers`
```

(Backticks are only to keep this Markdown from mentioning real accounts; the real file has bare `@org/team` entries.)
`package-lock.json` is protected because the matcher measurement covers it and it pins every third-party dependency.

## 4. Releases: signed tags and published hashes

A release is a signed tag on `main`, never a branch head.

1. After the merge, a maintainer creates `git tag -s vYYYY.MM.DD -m "…"` (SSH or GPG signing key registered in the
   repository's list of release keys, which lives in this file once there are keys to list).
2. Build from a clean checkout of the tag, with the pinned key set (DEPLOY.md "Sealed matching"):
   - **Matcher measurement:** `npm run -w @matra/matcher measure` prints the source measurement (sorted SHA-256 over
     `apps/matcher/src`, `packages/crypto/src`, `packages/shared/src`, the three `package.json` files and
     `package-lock.json`). With a real enclave, also the platform measurement of the image built from that tag (Nitro
     PCR0, Confidential Space image digest, Azure CCE policy hash; HOSTING.md §2).
   - **Web bundle hash:** SHA-256 of every file in `apps/web/dist`, sorted by path, and one hash over that list.
     *Not yet reproducible-verified:* a second builder must get the same hashes before we call it a reproducible build
     (W4). Until then, publish the hashes as "what we served", not as "what anyone can rebuild".
3. **Each approver organization rebuilds independently** and signs a short statement: tag, commit, the measurements
   and hashes they got. The release is published only when n statements agree.
4. Publish in the release notes (and the transparency report): tag, commit, matcher source measurement, platform
   measurement (when real), web bundle hash, the approvers' signed statements.
5. Pin: `MATRA_MATCHER_MEASUREMENT` (and `MATRA_ATTESTATION_PLATFORM_PUBKEY`) on the app server and as web build args
   in the same release; a mismatch makes every survivor's client refuse to seal ("This matcher isn't running the code
   this app trusts"), which is the intended failure.

## 5. Deploying

- The production deploy credential (host API token, image registry push) is held by a deploy role, not by every
  maintainer. It deploys **only signed tags** whose hashes were published (§4).
- Key holders and the matcher are deployed by the institution that runs them, from the same signed tag; each checks the
  tag signature and its own rebuild before upgrading.
- Configuration changes that weaken a protection (unsetting a pin, `MATRA_DEMO_MODE=1` on a real-data instance,
  `MATRA_OPRF_ROTATE=1`, switching the matcher to in-process) need the same n-of-m approval as code, recorded as a
  pull request against a deployment-config record (not secrets: names and non-secret values only).

## 6. Emergency security fix

When a vulnerability is being exploited or is public, waiting for n organizations may cause more harm than shipping.

- **Who:** any one maintainer *with* the incident lead's agreement (INCIDENT_RESPONSE.md §3). If they are the same
  person, any one approver from another organization must be told before deploying (a message, not an approval).
- **What may ship:** the smallest change that closes the hole. It may **not** weaken any protection: no change to key
  material, pins, attestation checks, the consent flows, logging (W11) or the release gates. A matcher change still
  changes the measurement and still needs a new pinned web build.
- **How:** a signed tag marked `-security`, deployed with the deploy credential; the bypass of branch protection, if
  needed, is done by the repository owner and noted.
- **After-the-fact review within 3 days:** the normal n approvers review the change. If they do not approve, it is
  reverted or replaced through the normal path.
- **Log:** an entry in the incident log (date, who shipped, who was told, tag, why the normal path could not wait, the
  review outcome), and a line in the transparency report (GOVERNANCE.md §7). Exploit details may wait until a fix is
  deployed.
- If the emergency path is used more than twice in a quarter, approvers review whether the normal path is too slow.

## 7. Before real data, minimum

- [ ] Approver organizations named and agreements signed (counsel reviews; Q-040, Q-044)
- [ ] Branch protection and CODEOWNERS configured; distinct-organization check in CI
- [ ] CI running typecheck, unit tests, e2e and the web-build audit
- [ ] Release signing keys listed here; first release with published measurements and approver statements
- [ ] Web build shown reproducible by a second builder (W4)
- [ ] Real enclave attestation for the matcher (HOSTING.md) so the measurement pin means something (W18)
