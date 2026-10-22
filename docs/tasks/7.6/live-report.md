# 7.6 live report — not yet run

The mechanism (wiring a real agent to real suites, computing cost from token usage x the price
table, writing a report per model x suite) is proved in CI on the scripted gateway and fixtures
(task 7.6, rule 4: no real model calls in tests). The numbers below are **not fabricated** — this
file is a placeholder until a human runs the live sweep with real provider keys, per the plan's
"How it will be shown" section and 5.7's own precedent.

## The recipe (run after merge, by a human, with real keys in env vars only)

1. Re-check `packages/gateway/src/pricing/prices.yaml` against each configured model's provider
   price page (its own header comment names this task as the moment to do so); update it first if
   a price has moved. Never let a builder or planner invent a USD value.
2. Set `ANTHROPIC_API_KEY` (or `EDMATE_ANTHROPIC_API_KEY`) and `EDMATE_JUDGE_MODEL` in the shell
   environment only — never in a committed file.
3. Run:

   ```
   edmate eval evals/suites --models evals/live-models.yaml --record \
     --report-dir evals/reports/live
   ```

4. `evals/reports/live/` is gitignored; paste the per-model, per-suite pass rates and cost per
   turn below (or link the JSON files from a private location), and close the two board decisions
   this closes: "Default model mix" and "Revenue share and floor price".

## Results

Not yet run.
