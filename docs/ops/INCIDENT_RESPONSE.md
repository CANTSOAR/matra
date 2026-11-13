# Incident response plan

> **DRAFT, pending counsel.** Written 2026-11-11 by the engineering side only. Nothing here is legal advice or a
> conclusion about what any law requires. Whether and when Matra must notify anyone after an incident is open:
> **Q-055** (ciphertext-only and blinded-token exposure under NJ, NY, CA and PA breach laws), **Q-036** (which CA and PA
> privacy and breach laws apply at all), **Q-039** (demands from police or courts, and whether Matra may tell the
> survivor). Until counsel answers, this plan **assumes notice may be required even when only ciphertext leaked**, and
> prepares for it. GOVERNANCE.md §5.6 requires a *published* plan before real data; this draft does not meet that gate
> until counsel has reviewed it.

Matra holds no real survivor data today (SECURITY.md "Current status"). This plan is written now so the first real
incident is not the first time anyone thinks about it.

## 1. What could be exposed, and what it would reveal

From [PRIVACY_DATA_INVENTORY.md](../PRIVACY_DATA_INVENTORY.md). "Ciphertext-only" is not "nothing": plan for the
right-hand column.

| What leaks | Readable to the attacker without further keys | What it enables |
|---|---|---|
| App database (or a backup, or the WAL) | Usernames (may be real names), roles, account and record creation times, record sizes, share metadata (which survivor account shared with which attorney, her chosen alias, the consent statement text, times), attorney and counselor directory entries, audit rows, ledger hashes, OPRF tags, phone-token hashes, staged-release requests and answers (who asked whom, yes/no, times) | Offline guessing of weak passphrases against the stored scrypt / PBKDF2 parameters (W5); linking accounts to attorneys; tags are useless without t OPRF shares (W2) |
| App database **and** `MATRA_PHONE_HASH_KEY` | As above | Testing whether a guessed phone number verified *some* account (not which; W19) |
| t or more OPRF key shares (or `MATRA_HOLDER_TOKEN_KEY` while holders are online) | Nothing directly | Recomputing tags for guessed identifiers, so the tags in a leaked DB become testable (W2, W14) |
| Matcher database | Tags, entry times, account-creation hours, **incident and survivor states in clear** (W18) | Where reported incidents happened and where survivors live, per tag |
| `MATRA_MATCHER_KEY` | Nothing directly | Opening the routing ciphertexts in the app DB (states); impersonating the matcher's signed answers |
| Simulated attestation platform key | Nothing | Signing any measurement (W18; already true of the simulated design) |
| Counselor roster signing key | Nothing | Adding a fake counselor survivors would seal to (W15) |
| A counselor's or attorney's private key | Every bundle, seal or record ever wrapped to that key (W12) | Reading contact details and full reports released to that person |
| Served web bundle modified (W4) | Whatever survivors type after the change, including passphrases | Full compromise of every account used during the window |
| Host / edge logs | Whatever the host logs (IPs and user agents unless turned off: DEPLOY.md "Logs and IP addresses") | Linking visits to people |
| SMS provider account | Phone numbers and verification times (Q-013) | Identifying who turned on sealed matching |

## 2. Severity

- **S1:** plaintext survivor data, a private key, ≥ t OPRF shares, or a modified web bundle served to anyone.
- **S2:** a database, backup or matcher DB copied; a secret listed in §1 exposed; host logs with IPs exposed.
- **S3:** a vulnerability with no evidence of use; a single OPRF share or holder token exposed.

Treat anything uncertain as one level higher until it is understood.

## 3. Roles

Names go in a private contact sheet, never in this public file.

- **Incident lead:** one person who decides and keeps the log. Default: the steward (GOVERNANCE.md §3).
- **Counsel:** consulted before any external statement and on every notice question (Q-055, Q-036, Q-039).
- **Key-holder contacts:** one per institution holding an OPRF share or running the matcher.
- **Partner contacts:** each pilot partner and attorney/counselor organization.
- **Survivor-communication reviewer:** an advocate from the pilot partner reviews every message to survivors.

## 4. Detection sources

- Security reports (SECURITY.md).
- Key holder alerts: a holder logs at 80% of `MATRA_HOLDER_DAILY_BUDGET` and when it is spent; its append-only
  `daily_totals` table shows unusual days (W14).
- Survivors' clients refusing the matcher's attestation ("This matcher isn't running the code this app trusts") or
  the OPRF key set.
- A published web-bundle hash that does not match what the site serves (DEPLOY_GOVERNANCE.md §4).
- Ledger chain verification failing (a survivor's dashboard shows it).
- Host, registry and GitHub security alerts; unexpected deploys or settings changes.

## 5. First hour

1. Open the incident log (private): time, who noticed, what is known. Write down facts, not guesses.
2. Name the incident lead. Set the severity.
3. **Preserve before changing:** snapshot affected hosts and logs where possible. Do not delete data to "clean up";
   whether something must be kept is a counsel question.
4. Contain (§6). Prefer reversible steps.
5. Tell counsel. For S1 or S2, tell key-holder and partner contacts that an incident is open (no details yet).

## 6. Containment and key rotation

Each step names the mechanism that exists in the code today. Rotation is a deploy, so the emergency path in
DEPLOY_GOVERNANCE.md §6 applies.

| Exposed | Action |
|---|---|
| Sessions or the app host | Delete every row in `sessions` (everyone signs in again); rotate host credentials |
| OPRF shares (≥ t, or unsure) | New ceremony (`oprf-ceremony`), new shares to each holder institution, rebuild the web app with the new pins, restart once with `MATRA_OPRF_ROTATE=1`. Survivors' apps re-seal on next sign-in. Old tags in any leaked DB stay testable by whoever has the old shares: that does not go away |
| Holder token key | New `MATRA_HOLDER_TOKEN_KEY`; new `MATRA_HOLDER_TOKEN_PUBKEY` on every holder |
| Matcher key | New `MATRA_MATCHER_KEY`; existing routing tags become unreadable and those groups route as "no state" until survivors re-seal. Rotate `MATRA_MATCHER_TOKEN` too |
| Attestation platform key (simulated) | New key and `MATRA_ATTESTATION_PLATFORM_PUBKEY` pin in the app server and web build |
| Phone hash key | New `MATRA_PHONE_HASH_KEY`. This resets the per-phone counts (the one-phone-two-accounts limit starts over) |
| Roster signing key | New key off the server, `MATRA_COUNSELOR_ROSTER_PUBKEY` in a new web build, re-sign the roster |
| A counselor or attorney key | Remove the person from the roster or directory; release revocations; their past access cannot be undone (W12) |
| Modified web bundle | Take the site down or serve a static notice; redeploy a signed tag; publish hashes |
| SMS provider | Rotate the provider token; review its logs for the window |
| `MATRA_PEPPER` | Changing it breaks existing escrow hashes (DEPLOY.md). Decide with engineering before rotating |

## 7. Notice: plan as if it may be required

Whether notice is legally required, to whom, how fast and in what form, is **open** (Q-055, Q-036; demands from
authorities, Q-039). The plan below prepares so that whatever counsel decides can be done quickly:

- Keep, from the first hour, the facts any notice would need: what happened, when, when it was found, what data
  categories (§1), how many accounts, what was and was not readable, what Matra has done.
- **Matra usually has no way to reach a survivor outside the app.** It stores no email or phone number (phone numbers
  are verified then forgotten, W19). Possible channels are an in-app notice at sign-in, the public website, and partner
  organizations. Whether those are acceptable notice is part of Q-055 for counsel.
- Draft, for counsel's review: a survivor notice, a partner notice, and a public summary.
- Do not promise in a privacy notice that "a ciphertext leak never needs notice". Q-055 is open.

## 8. Talking to survivors

- Plain words, short, no blame, no jargon. Say what was exposed and what was not, in her terms ("someone copied our
  database; your story stayed encrypted, and we can't read it either").
- Say what she can do and whether she needs to do anything (for example change a weak passphrase).
- Never send anything to a channel that could be seen by someone else on her device or account without her choosing it;
  remember her abuser may share the device (W8).
- Offer support resources (the hotlines already shown in the app) and a way to ask questions.
- An advocate reviews every message before it goes out.

## 9. Records and afterwards

- The incident log, every decision with its time and who made it, and copies of every notice, are kept for as long as
  counsel advises.
- Within 30 days: a blameless review (what happened, why it was possible, what changes), shared with key holders and
  partners.
- Publish an incident summary (SECURITY.md "If real data is ever exposed"; GOVERNANCE.md §7), after counsel review.
- Update the threat model and this plan with what was learned.
