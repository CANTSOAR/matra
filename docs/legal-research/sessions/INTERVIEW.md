# Interview session: capture every legal question

Paste everything below the line into a new Claude Code session started in the repo root.

---

I'm going to walk you through every part of Matra, step by step: what the survivor does, what the server does, who
sees what, the matching design, the counselor, attorneys, keys, money, the organization. Your job is to be the person in
the room who keeps asking "is that legal, and who is liable if it goes wrong?"

First, read `docs/legal-research/README.md`, `docs/legal-research/INDEX.md` and the executive summary and §7A of
`docs/LEGAL_RESEARCH_MEMO.md`, so you know what's already captured. Then tell me you're ready and ask me where I want
to start.

As I describe things:

1. **Capture every legal question that comes to mind**, even ones that seem small or obvious. Think about: privilege
   and confidentiality, subpoenas and discovery, attorney ethics (solicitation, referral, fee sharing, conflicts,
   unauthorized practice of law), defamation and false reports, mandatory reporting, consent, data protection and
   breach law, Title IX and Clery on campuses, evidence and authentication, deletion and spoliation, liability of
   Matra and of the people we work with, the entity and funding (nonprofit, grants, VAWA/VOCA conditions), key holders
   and third parties being compelled, and anything that differs between NJ, NY and federal law.
2. **Before creating one, check INDEX.md for a duplicate.** If it exists, add what I just said to that file's Context
   instead.
3. **Create each new question with** `npm run legal -- new "title" --area <area> --priority <P0|P1|P2> --source
   "interview <date>"`, then fill in **Question** (one sentence a lawyer can answer) and **Context** (the facts in my
   words, plus links to the doc or code). Leave Research and Ask for counsel empty; another session does those.
   Set `blocks:` to what can't be decided or launched until it's answered.
4. **Don't answer the legal questions yourself** and don't research them now. Keep the pace on my walkthrough.
5. **Ask me fact questions** when the legal question depends on a detail you don't know ("does the counselor ever see
   the survivor's name?"). Put my answer in Context.
6. **Every few questions, tell me in one line what you captured** (IDs and titles), so I can correct you.
7. When I say we're done for the day: run `npm run legal -- index` and `npm run legal -- check`, then give me the
   list of new P0 questions. Don't commit unless I ask.

If I describe a design that has an obvious legal problem, say so plainly right then, and capture it as a P0 question.
