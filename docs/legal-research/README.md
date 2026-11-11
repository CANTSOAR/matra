# Legal research bank

Every legal question Matra needs answered, one file per question, so that time with a real lawyer is spent deciding,
not explaining. **Nothing here is legal advice.** Research in this folder is written by non-lawyers and Claude sessions
to prepare questions for licensed counsel.

| Path | What it is | Public? |
|---|---|---|
| [INDEX.md](INDEX.md) | Every question by status and priority. Generated: `npm run legal -- index` | yes |
| [questions/](questions/) | One file per question (`Q-###-slug.md`): the question, context, research, the ask | yes |
| [TEMPLATE.md](TEMPLATE.md) | Shape of a question file (`npm run legal -- new` copies it) | yes |
| [sessions/](sessions/) | Kickoff prompts for the interview and research sessions | yes |
| `private/DECISIONS.md` | What licensed counsel actually said. **Gitignored** (see below) | **no** |
| [../LEGAL_RESEARCH_MEMO.md](../LEGAL_RESEARCH_MEMO.md) | The original long-form memo (2026-10-06). Background; cite its sections | yes |
| [../../compiled_resources/](../../compiled_resources/README.md) | Source citations and local copies of statutes, cases, papers | notes only |

**Why decisions are private.** This repo is public. A lawyer's advice published on GitHub can lose privilege and can
be quoted back at us. Questions and our own research are fine to publish (the long memo already is); counsel's answers
are not. Back up `private/` somewhere private.

## A question's life

```
open → researching → memo-ready → asked → answered
                   ↘ parked (not needed now)   ↘ merged (duplicate; merged_into: Q-###)
```

- **open**: captured, not yet researched.
- **researching**: a research agent has claimed it. Only that agent edits the file.
- **memo-ready**: Research and Ask for counsel are done, citations checked, fits on two pages.
- **asked**: put to a lawyer (note who and when in the file's Context or a comment line).
- **answered**: a licensed attorney answered; `decision: D-###` points into `private/DECISIONS.md`.

Priority: **P0** blocks a design decision or the pilot · **P1** must be answered before real survivor data · **P2**
good to know.

## Rules for everyone

1. **One question per file, one sentence per question.** If it needs "and", it is probably two questions. Link related
   ones with `related: Q-###, Q-###`.
2. **Create files only with `npm run legal -- new "title" --area x --priority P1 --source "..."`.** It hands out IDs
   safely even when several sessions run at once. Then fill in the file.
3. **Context is facts, Research is law.** Context says what Matra does (link the doc or code); Research says what the
   rules are. Keep them apart so a lawyer can correct the facts.
4. **Cite primary sources with pinpoints and links.** Statute section, rule number, case and page, ethics opinion
   number. Anything not checked against the primary text is marked **[VERIFY]**. Never cite something you have not seen.
   No made-up case names, ever.
5. **Never write a conclusion as if it were advice.** "The rule appears to…", "the strongest argument is…". Only
   `private/DECISIONS.md` holds answers, and only from a licensed attorney.
6. **The Ask for counsel is at most 5 lines** and says what we propose. "We plan to X. Is X permitted under Y, and if
   not, would Z be?" beats "What should we do about Y?".
7. **Run `npm run legal -- index` after any change**, and `npm run legal -- check` before committing.
8. Do not commit anything under `private/`. Commit only when the founder asks.

## Areas

Use one of these for `area:` (add a new one if none fits): `matching` · `sybil` · `keys` · `counselor` · `referral` ·
`privilege` · `discovery` · `deletion` · `reporting` · `privacy` · `funding` · `entity` · `evidence` · `consent` ·
`campus` · `succession`.

## Free primary sources

- NJ statutes: [lis.njleg.state.nj.us](https://lis.njleg.state.nj.us) · NJ Court Rules and RPCs:
  [njcourts.gov](https://www.njcourts.gov/attorneys/rules-of-court) · NJ ACPE / CAA / UPL opinions:
  [njcourts.gov](https://www.njcourts.gov/attorneys/professional-ethics) · NJ Rules of Evidence: njcourts.gov
- NY Rules of Professional Conduct: [nycourts.gov](https://www.nycourts.gov/ad3/AGC/Forms/Rules/) · NY statutes:
  [nysenate.gov/legislation](https://www.nysenate.gov/legislation)
- Federal: [law.cornell.edu](https://www.law.cornell.edu) (U.S.C., FRE, C.F.R.), [ecfr.gov](https://www.ecfr.gov)
- Cases: [courtlistener.com](https://www.courtlistener.com), Google Scholar case law, [law.justia.com](https://law.justia.com)
- ABA Model Rules and formal opinions: americanbar.org
- Already collected: [compiled_resources/](../../compiled_resources/README.md) (`03_legal_ethics_privilege_statutes`,
  `08_legal_landscape_and_pitfalls`)

Westlaw and Lexis are not available. If a question turns on a source we cannot reach, say so in Research and mark it
**[VERIFY]**; finding it is something to ask counsel for.

## Running the sessions

- **Interview** (founder walks Claude through Matra; Claude captures every legal question):
  paste [sessions/INTERVIEW.md](sessions/INTERVIEW.md).
- **Research** (a coordinator runs agents that research and tighten open questions):
  paste [sessions/RESEARCH.md](sessions/RESEARCH.md).
- **Before a lawyer meeting**: pick 2 or 3 `memo-ready` P0 questions, read their Ask for counsel, and bring those.
