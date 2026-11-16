/**
 * Span-marker eval: runs the marker over the synthetic set and applies the plan's gate (section 8.7).
 *
 *   npm run eval:marker                   report on dev and test; exit 1 if the gate fails on the held-out test split
 *   npm run eval:marker -- --split dev    one split only
 *   npm run eval:marker -- --write        also write results/report.json and results/REPORT.md (commit them with a change)
 *   npm run eval:marker -- --no-fail      always exit 0 (what the non-blocking CI job uses)
 *
 * Which questions are enabled is decided on dev, then applied unchanged to test. Nothing is tuned on the test split.
 *
 * Protocol (read before changing the engine, the guards, the bank or the data):
 *   - dev may be used freely while building. test is held out: look at its aggregate gate, never at which accounts fail.
 *   - once a split's per-account results have been looked at, or a change was made after seeing its numbers, it is spent:
 *     write a fresh held-out split (new accounts, by someone who has not seen the engine's output) before the next gate.
 *   - the committed results/report.json is checked by ml/marker/eval.test.ts, so a change to the engine cannot go unrecorded.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonl, type EvalItem } from './dataset';
import { applyGate, bootstrap, enabledQuestions, evaluate, GATE, pct, precision, recall, restrictTo, type Gate, type Report } from './metrics';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, '../data');
const RESULTS = path.resolve(HERE, 'results');
const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const NO_FAIL = argv.includes('--no-fail');
const only = argv.includes('--split') ? argv[argv.indexOf('--split') + 1] : undefined;
/** Fixed reference date so relative dates ("last friday") resolve the same way on every run. */
const NOW = new Date('2026-10-07T15:00:00Z');

// The intake script reads a build-time global; the eval runs under Node with no bundler.
(globalThis as Record<string, unknown>).__MATRA_MATCHING__ = false;
const { INTAKE_MARK_BANK } = await import('../../../apps/web/src/ml/marker/intakeBank');
const { markWithStats } = await import('../../../apps/web/src/ml/marker/index');
const { ENABLED_QUESTIONS } = await import('../../../apps/web/src/ml/marker/enabled');
const { groupOf } = await import('../../../apps/web/src/ml/marker/bank');

const load = (split: 'dev' | 'test'): EvalItem[] => parseJsonl(fs.readFileSync(path.join(DATA, `span-marker.${split}.jsonl`), 'utf8'), split);
const isNeutral = (q: string) => groupOf(q) === 'neutral';
/** `enabled: null` = every neutral question, so each one is measured on its own. */
const predict = (text: string) => {
  const r = markWithStats(text, INTAKE_MARK_BANK, { now: NOW, enabled: null });
  return { marks: r.marks, droppedByReason: r.droppedByReason as Record<string, number> };
};

const dev = load('dev');
const test = load('test');
const devReport = evaluate(dev, predict, isNeutral, 'dev');
const testReport = evaluate(test, predict, isNeutral, 'test');
const enabledFromDev = enabledQuestions(devReport);

const lines: string[] = [];
const out = (s = '') => {
  lines.push(s);
  console.log(s);
};

function printReport(r: Report, items: EvalItem[], enabled: readonly string[], gated: boolean): Gate {
  const all = r.overall;
  const on = restrictTo(r, enabled);
  const ci = bootstrap(r, items, enabled);
  out(`\n## ${r.split} split: ${r.items} accounts, ${all.gold} gold spans, ${all.marks} marks`);
  out(`all neutral questions: precision ${pct(precision(all))}, recall ${pct(recall(all))}`);
  out(`enabled questions (${enabled.join(', ') || 'none'}): precision ${pct(precision(on))} [95% CI ${pct(ci.precision[0])} to ${pct(ci.precision[1])}], recall ${pct(recall(on))} [${pct(ci.recall[0])} to ${pct(ci.recall[1])}]`);
  out('\nper question (all neutral questions, before gating)');
  out('| question | marks | gold | precision | recall |');
  out('|---|---|---|---|---|');
  for (const [q, c] of Object.entries(r.byQuestion).sort()) out(`| ${q} | ${c.marks} | ${c.gold} | ${pct(precision(c))} | ${pct(recall(c))} |`);
  out('\nper group (precision and recall of what was said in that kind of account)');
  out('| group | accounts | marks | gold | precision | recall | accounts with a false mark | forbidden statements marked |');
  out('|---|---|---|---|---|---|---|---|');
  for (const [g, c] of Object.entries(r.byCategory)) out(`| ${g} | ${c.items} | ${c.marks} | ${c.gold} | ${pct(precision(c))} | ${pct(recall(c))} | ${c.itemsWithFalseMarks} | ${c.forbid ? `${c.forbidHits}/${c.forbid}` : '-'} |`);
  out('\nfalse-mark rate on statements that must not be marked');
  for (const [g, f] of Object.entries(r.falseMarkRate)) out(`- ${g}: ${f.hits}/${f.forbid} = ${pct(f.rate)} (95% upper bound ${pct(f.upper95)})`);
  out(`\nvalidator drops (all neutral questions): ${JSON.stringify(r.droppedByReason)}`);
  const gate = applyGate(r, enabled);
  out(
    gated
      ? `\nGATE CHECKS (a subset of plan 8.7) with the question list chosen on dev: ${gate.pass ? 'all pass' : 'FAIL'}`
      : '\nGate checks on dev (no verdict: dev is what the marker was built against, so it says nothing about new accounts)',
  );
  if (gated)
    out(
      'NOT CHECKED by this harness, so even "all pass" would not mean the plan\'s gates passed: per-question kappa >= 0.6 (needs two annotators), the device budgets of 8.9 (cold load, 10 s on 2,000 words, 300 MB), results by length bucket and language, WASM vs WebGPU agreement, an advocate read of a sample of marks, and a held-out split nobody has looked at.',
    );
  for (const c of gate.checks) out(`- [${c.ok ? 'ok' : 'FAIL'}] ${c.name}: ${c.value} (needs ${c.threshold})${c.note ? ` | ${c.note}` : ''}`);
  const worst = r.perItem.filter((p) => p.falseMarks.length || p.missed.length || p.forbidHits.length);
  if (worst.length && process.env.MATRA_EVAL_VERBOSE) {
    out('\nitems with a false mark, a miss or a forbidden hit');
    for (const w of worst) {
      const it = items.find((i) => i.id === w.id)!;
      out(`- ${w.id}: ${JSON.stringify(it.text)}`);
      for (const m of w.falseMarks) out(`    false mark ${m.questionId}: ${JSON.stringify(m.exactSpan)}`);
      for (const m of w.missed) out(`    missed ${m.q}: ${JSON.stringify(it.text.slice(m.start, m.end))}`);
    }
  }
  return gate;
}

out('# Span-marker eval (rule engine v1)');
out(`Gate (plan 8.7): invented spans 0; sensitive marks 0; overall precision >= ${GATE.overallPrecision}; every enabled question >= ${GATE.perQuestionPrecision}; negation false-mark rate <= ${GATE.negationFalseMark}; recall reported (>= ${GATE.recallFloor} to be worth shipping).`);
out('TEST SPLIT STATUS: SPENT. Its aggregate was looked at before and after tuning, and the engine has been changed since (guards, review fixes). Its numbers below are kept for the record; they are not an independent estimate. Only dev numbers are quoted for the latest changes.');
out(`Questions enabled, chosen on dev only: ${enabledFromDev.join(', ') || 'none'}`);
out(`Questions enabled in the code (apps/web/src/ml/marker/enabled.ts): ${ENABLED_QUESTIONS.join(', ')}`);
if (enabledFromDev.join() !== [...ENABLED_QUESTIONS].sort().join()) out('NOTE: the list in enabled.ts differs from the one the dev split selects. Update enabled.ts, then re-run.');

let testGate: Gate | undefined;
if (!only || only === 'dev') printReport(devReport, dev, enabledFromDev, false);
if (!only || only === 'test') testGate = printReport(testReport, test, enabledFromDev, true);

if (WRITE) {
  fs.mkdirSync(RESULTS, { recursive: true });
  const strip = (r: Report) => ({ ...r, perItem: undefined });
  fs.writeFileSync(
    path.join(RESULTS, 'report.json'),
    JSON.stringify({ engine: 'understand-rules', enabledFromDev, enabledInCode: [...ENABLED_QUESTIONS].sort(), gate: GATE, testGate, dev: strip(devReport), test: strip(testReport) }, null, 2) + '\n',
  );
  fs.writeFileSync(path.join(RESULTS, 'REPORT.md'), lines.join('\n') + '\n');
  console.log(`\nwrote ${path.relative(process.cwd(), RESULTS)}/report.json and REPORT.md`);
}
if (testGate && !testGate.pass && !NO_FAIL) process.exit(1);
