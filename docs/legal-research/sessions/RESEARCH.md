# Research session: coordinate agents that research the open questions

Paste everything below the line into a new Claude Code session started in the repo root. Say "use a workflow" (or
similar) in your own message if you want it to run a multi-agent workflow; otherwise it will use individual agents.

---

You are coordinating research on Matra's legal question bank. Read `docs/legal-research/README.md` (the rules) and
`docs/legal-research/INDEX.md` first. The goal is to turn `open` questions into `memo-ready` ones a licensed lawyer can
answer in five minutes each. You are not producing legal advice.

**Pick the batch.** Take `open` questions in priority order (P0 first), up to the number I give you (default 4; each question uses two agents). Before
starting, look for duplicates and overlaps among them and across INDEX.md: merge duplicates (`status: merged`,
`merged_into: Q-###`, fold the context into the surviving file) and split any question that is really two (create the
new one with `npm run legal -- new`). Tell me the batch and any merges or splits before launching agents.

**Claim.** Set each chosen question to `status: researching` and run `npm run legal -- index`.

**Research, one agent per question.** Give each agent: the question file path, the README rules, the relevant section
of `docs/LEGAL_RESEARCH_MEMO.md` if there is one, and `compiled_resources/` as a starting point. Each agent:
- edits **only its own question file**, and only the Research and Ask for counsel sections (it may correct Context if
  a fact is wrong, and must say so in its report);
- uses primary sources with pinpoint citations and links, marks anything unverified **[VERIFY]**, and never cites
  something it has not read;
- gives the arguments both ways and says what is unsettled, without presenting a conclusion as advice;
- writes an Ask for counsel of at most 5 lines that states what Matra proposes and the exact decision needed;
- reports back: what it found, what it could not reach, and any new questions it thinks should exist (it does not
  create them).

**Verify, one fresh agent per researched question.** It has not seen the researcher's reasoning. It opens every cited
source and checks the citation exists, says what the file claims, and is current (amended rules, renumbered sections,
reversed cases). It fixes or marks **[VERIFY]**, and flags any claim stated more strongly than the source supports. If
the file is longer than about two pages, it tightens it.

**Finish.** For each question that passed verification, set `status: memo-ready`; otherwise put it back to `open` with
a note at the top of Research on what's missing. Create any new questions the agents suggested (dedupe first). Run
`npm run legal -- index` and `npm run legal -- check`. Then give me:
- the memo-ready questions, P0 first, each with its one-line Ask;
- the 2 or 3 you'd bring to the next lawyer meeting, and why;
- anything the agents couldn't reach that we should ask the lawyer to point us to.

Don't set any question to `answered` and don't write to `docs/legal-research/private/`. Don't commit unless I ask.
