/**
 * The questions whose marks are switched on: those that cleared the per-question precision bar (>= 0.80) on the DEV split of
 * the eval (tools/eval/span-marker; plan 8.7). Chosen on dev only. The held-out test split's aggregate was looked at more than
 * once while the marker was being built, so that split is spent and the list has NOT been checked on data it did not influence.
 * where.area and prior.any are not listed: each produced fewer than 5 marks on dev, too few to show its precision. A question not listed here
 * never produces a mark. Regenerate with `npm run eval:marker -- --write` after any change to the
 * engine, the guards, the bank or the data; apps/web/src/ml/marker/enabled.test.ts fails if this list and the committed
 * result differ.
 */
export const ENABLED_QUESTIONS: readonly string[] = [
  'when.date',
  'when.time',
  'where.place',
  'where.address',
  'people.told',
  'people.witnesses',
  'evidence.upload',
];
