# Matra

Encrypted documentation vault for sexual-violence survivors, with consented sharing to attorneys and Callisto-style
sealed matching opened by a Legal Options Counselor. npm workspaces: `apps/web`, `apps/server`, `packages/crypto`,
`packages/shared`. Start with [docs/README.md](docs/README.md) and [docs/MVP_STATUS.md](docs/MVP_STATUS.md).

The repo is **public** (github.com/CANTSOAR/matra). Never commit contact details, private outreach, or legal advice.

## Legal research bank

Every legal question lives in [docs/legal-research/](docs/legal-research/README.md), one file per question. Read its
README before touching it. In short:

- Check [INDEX.md](docs/legal-research/INDEX.md) for duplicates; create questions only with
  `npm run legal -- new "title" --area x --priority P0|P1|P2 --source "..."`.
- Cite primary sources with pinpoints; mark anything unchecked **[VERIFY]**; never invent a citation.
- Nothing a Claude session writes is legal advice. Only a licensed attorney's answer counts, and it goes in
  `docs/legal-research/private/DECISIONS.md` (gitignored), never in a committed file.
- Run `npm run legal -- index` after changes and `npm run legal -- check` before committing.

When a design or product decision raises a legal question, add it to the bank rather than answering it inline.
