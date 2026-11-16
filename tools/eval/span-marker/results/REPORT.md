# Span-marker eval (rule engine v1)
Gate (plan 8.7): invented spans 0; sensitive marks 0; overall precision >= 0.9; every enabled question >= 0.8; negation false-mark rate <= 0.02; recall reported (>= 0.5 to be worth shipping).
TEST SPLIT STATUS: SPENT. Its aggregate was looked at before and after tuning, and the engine has been changed since (guards, review fixes). Its numbers below are kept for the record; they are not an independent estimate. Only dev numbers are quoted for the latest changes.
Questions enabled, chosen on dev only: evidence.upload, people.told, people.witnesses, when.date, when.time, where.address, where.place
Questions enabled in the code (apps/web/src/ml/marker/enabled.ts): when.date, when.time, where.place, where.address, people.told, people.witnesses, evidence.upload

## dev split: 85 accounts, 80 gold spans, 69 marks
all neutral questions: precision 92.8%, recall 78.8%
enabled questions (evidence.upload, people.told, people.witnesses, when.date, when.time, where.address, where.place): precision 92.2% [95% CI 84.1% to 98.4%], recall 79.5% [67.9% to 89.3%]

per question (all neutral questions, before gating)
| question | marks | gold | precision | recall |
|---|---|---|---|---|
| evidence.upload | 8 | 9 | 100.0% | 88.9% |
| people.told | 11 | 15 | 100.0% | 73.3% |
| people.witnesses | 5 | 6 | 80.0% | 66.7% |
| prior.any | 4 | 6 | 100.0% | 66.7% |
| when.date | 12 | 14 | 100.0% | 85.7% |
| when.time | 5 | 8 | 100.0% | 62.5% |
| where.address | 8 | 4 | 87.5% | 100.0% |
| where.area | 1 | 1 | 100.0% | 100.0% |
| where.place | 15 | 17 | 80.0% | 82.4% |

per group (precision and recall of what was said in that kind of account)
| group | accounts | marks | gold | precision | recall | accounts with a false mark | forbidden statements marked |
|---|---|---|---|---|---|---|---|
| plain | 18 | 33 | 36 | 97.0% | 88.9% | 1 | - |
| fragmented | 8 | 18 | 20 | 100.0% | 85.0% | 0 | - |
| spelling | 8 | 7 | 13 | 71.4% | 38.5% | 2 | - |
| negation | 16 | 3 | 3 | 100.0% | 100.0% | 0 | 0/16 |
| hypothetical | 10 | 0 | 0 | n/a | n/a | 0 | 0/11 |
| reported | 7 | 0 | 0 | n/a | n/a | 0 | 0/8 |
| other-actor | 7 | 0 | 0 | n/a | n/a | 0 | 0/8 |
| sensitive-trap | 5 | 8 | 8 | 75.0% | 75.0% | 2 | - |
| no-marks | 6 | 0 | 0 | n/a | n/a | 0 | - |

false-mark rate on statements that must not be marked
- negation: 0/16 = 0.0% (95% upper bound 19.4%)
- hypothetical: 0/11 = 0.0% (95% upper bound 25.9%)
- reported: 0/8 = 0.0% (95% upper bound 32.4%)
- other-actor: 0/8 = 0.0% (95% upper bound 32.4%)

validator drops (all neutral questions): {"ambiguous-clause":3,"over-limit":1,"negated":6,"hypothetical":4,"sensitive-group":13,"reported-speech":3,"quoted":1,"other-actor":6,"sensitive-context":3}

Gate checks on dev (no verdict: dev is what the marker was built against, so it says nothing about new accounts)
- [ok] invented spans (not an exact substring): 0 (needs 0)
- [ok] marks on a sensitive or excluded question: 0 (needs 0)
- [ok] overall precision (enabled questions): 92.2% (needs >= 90.0%)
- [ok] precision of every enabled question: evidence.upload 100.0%, people.told 100.0%, people.witnesses 80.0%, when.date 100.0%, when.time 100.0%, where.address 87.5%, where.place 80.0% (needs >= 80.0% each)
- [ok] negation false-mark rate: 0.0% (0/16, 95% upper bound 19.4%) (needs <= 2.0%) | only 16 negated statements: a pass here cannot rule out a rate near 19.4%
- [ok] recall (enabled questions), reported: 79.5% (needs >= 50.0% to be worth shipping)

## test split: 79 accounts, 71 gold spans, 50 marks
all neutral questions: precision 80.0%, recall 54.9%
enabled questions (evidence.upload, people.told, people.witnesses, when.date, when.time, where.address, where.place): precision 78.7% [95% CI 63.9% to 91.5%], recall 58.1% [44.6% to 71.2%]

per question (all neutral questions, before gating)
| question | marks | gold | precision | recall |
|---|---|---|---|---|
| evidence.upload | 6 | 7 | 83.3% | 71.4% |
| people.told | 11 | 14 | 100.0% | 78.6% |
| people.witnesses | 1 | 7 | 100.0% | 14.3% |
| prior.any | 2 | 6 | 100.0% | 33.3% |
| when.date | 13 | 11 | 61.5% | 63.6% |
| when.time | 3 | 6 | 100.0% | 50.0% |
| where.address | 5 | 5 | 100.0% | 100.0% |
| where.area | 1 | 3 | 100.0% | 33.3% |
| where.place | 8 | 12 | 50.0% | 33.3% |

per group (precision and recall of what was said in that kind of account)
| group | accounts | marks | gold | precision | recall | accounts with a false mark | forbidden statements marked |
|---|---|---|---|---|---|---|---|
| plain | 17 | 22 | 30 | 90.9% | 63.3% | 2 | - |
| fragmented | 8 | 13 | 18 | 92.3% | 66.7% | 1 | - |
| spelling | 8 | 3 | 13 | 66.7% | 15.4% | 1 | - |
| negation | 15 | 3 | 3 | 100.0% | 100.0% | 0 | 0/15 |
| hypothetical | 8 | 0 | 0 | n/a | n/a | 0 | 0/9 |
| reported | 6 | 1 | 0 | 0.0% | n/a | 1 | 1/9 |
| other-actor | 6 | 3 | 0 | 0.0% | n/a | 2 | 1/6 |
| sensitive-trap | 5 | 5 | 7 | 60.0% | 42.9% | 1 | - |
| no-marks | 6 | 0 | 0 | n/a | n/a | 0 | - |

false-mark rate on statements that must not be marked
- negation: 0/15 = 0.0% (95% upper bound 20.4%)
- hypothetical: 0/9 = 0.0% (95% upper bound 29.9%)
- reported: 1/9 = 11.1% (95% upper bound 43.5%)
- other-actor: 1/6 = 16.7% (95% upper bound 56.4%)

validator drops (all neutral questions): {"sensitive-group":12,"ambiguous-clause":12,"negated":6,"hypothetical":4,"quoted":1,"other-actor":2,"sensitive-context":4}

GATE CHECKS (a subset of plan 8.7) with the question list chosen on dev: FAIL
NOT CHECKED by this harness, so even "all pass" would not mean the plan's gates passed: per-question kappa >= 0.6 (needs two annotators), the device budgets of 8.9 (cold load, 10 s on 2,000 words, 300 MB), results by length bucket and language, WASM vs WebGPU agreement, an advocate read of a sample of marks, and a held-out split nobody has looked at.
- [ok] invented spans (not an exact substring): 0 (needs 0)
- [ok] marks on a sensitive or excluded question: 0 (needs 0)
- [FAIL] overall precision (enabled questions): 78.7% (needs >= 90.0%)
- [FAIL] precision of every enabled question: evidence.upload 83.3%, people.told 100.0%, people.witnesses 100.0%, when.date 61.5%, when.time 100.0%, where.address 100.0%, where.place 50.0% (needs >= 80.0% each)
- [ok] negation false-mark rate: 0.0% (0/15, 95% upper bound 20.4%) (needs <= 2.0%) | only 15 negated statements: a pass here cannot rule out a rate near 20.4%
- [ok] recall (enabled questions), reported: 58.1% (needs >= 50.0% to be worth shipping)
