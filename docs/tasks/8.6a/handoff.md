# 8.6a handoff: Phase A, model-mix table, Sonnet 5 price, per-turn cost

Status: DONE
Branch: m8/8.6a-model-mix (built locally as work-86a)
Worktree: .claude/worktrees/agent-a994e262c700a2a17
Tool calls used: 27

## What changed (exports for Phase C)

All exported from the `@edmate/gateway` package root:

- `MODEL_MIX: Readonly<Record<PackageMixTier, ModelPolicy>>`: frozen all the way down. `free` and `paid`
  both use `small = anthropic/claude-haiku-4-5` and `main = anthropic/claude-sonnet-5` (B-42).
- `type PackageMixTier = 'free' | 'paid'`
- `DEFAULT_MODEL_POLICY`, which is now `MODEL_MIX.paid` (the same object, so `===` holds).
- `turnCostMicroUsd(policy: ModelPolicy, prices: PriceTable, assumptions?: TurnTokenAssumptions): number`
  returns one turn's cost in integer micro-USD: one main call plus `smallCallsPerTurn` small calls, each
  priced with `computeCostMicroUsd` (rounded half up per call). It throws `UnpricedModelError` for an
  unpriced main or small model (even when there are 0 small calls). It throws `RangeError` for a
  missing main or small tier, a bad `smallCallsPerTurn` or token count, or a total above
  `MAX_SAFE_INTEGER`.
- `UnpricedModelError` (`name`, `model`; message `no price for model <id>`).
- `TURN_TOKEN_ASSUMPTIONS` (frozen, PROVISIONAL per Q3) and `type TurnTokenAssumptions`, with the fields
  `mainInputTokens 5000`, `mainOutputTokens 500`, `smallCallsPerTurn 4`, `smallInputTokensPerCall 1200`
  and `smallOutputTokensPerCall 60`.
- With the bundled prices, a paid-mix turn costs 21,000 micro-USD ($0.021).

Files:
- `packages/gateway/src/router/default-policy.ts`: MODEL_MIX, with a header citing B-42.
- `packages/gateway/src/router/index.ts`
- `packages/gateway/src/pricing/estimate.ts` (new)
- `packages/gateway/src/pricing/index.ts`
- `packages/gateway/src/pricing/prices.yaml`: `claude-sonnet-5` at $2 in and $10 out. Cache prices are
  in a comment. `claude-sonnet-4-5` is kept.
- `packages/gateway/src/pricing/prices.generated.ts`: regenerated with `generate:prices`.
- `packages/gateway/test/router/default-policy.test.ts` (new) and `test/pricing/estimate.test.ts` (new).
- `packages/gateway/test/keys/exports.test.ts`: the export list now includes the 4 new runtime exports.

## Evidence

- `corepack pnpm vitest run test/router/default-policy.test.ts test/pricing/estimate.test.ts` failed first
  (red, because the modules were missing). They pass after the change.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/gateway...` → `Tasks: 14 successful, 14 total`.
  Gateway: `Test Files 27 passed`, `Tests 432 passed`. The coverage thresholds (100% on `src/router/**`
  and `src/pricing/**`) hold.
- `corepack pnpm turbo run typecheck test --filter=...@edmate/gateway --concurrency=1` (the dependents:
  db, cli, worker, web) → `Tasks: 18 successful, 18 total`. One earlier parallel run failed 3 web test
  files (auth age gate, auth wiring, UploadsView). The same 3 files pass when run alone (56/56) and in the
  serial run, so this is load flakiness and unrelated to this change.
- `python3 .githooks/secret-scan.py --all` → clean (no output).
- `git merge origin/main` fast-forwarded (8.4a style-card work, nothing under gateway); the gates above
  were re-run after the merge.

## Deviations

- The plan put the new tests under `packages/gateway/src/...`. They live under `packages/gateway/test/...`
  because the gateway's vitest config only picks up `test/**/*.test.ts`.
- No dependent-package test needed changing: nothing outside the gateway asserts the default policy's
  main model id.

## Decisions

### 22 Oct 2026 · 8.6a Sonnet 5 cache prices kept as a comment only · decided by builder · risk: low
- Decided: `prices.yaml` records `claude-sonnet-5` input $2 and output $10 per million. The cache-read
  ($0.20) and 5-minute cache-write ($2.50) prices are a comment next to it, not fields.
- Why: the price schema is strict (input and output only), and metering does not count cache tokens yet.
  Adding fields would change the schema and metering, which is outside Phase A.
- risk: low

### 22 Oct 2026 · 8.6a An unpriced model throws even when its tier makes no calls · decided by builder · risk: low
- Decided: `turnCostMicroUsd` prices both the main and the small model before multiplying, so an
  unpriced small model throws `UnpricedModelError` even when `smallCallsPerTurn` is 0.
- Why: a mix with an unpriced model is a config error whatever the assumptions say. Failing loudly
  matches lessons.md ("a check that silently skips looks like a pass").
- risk: low

### 22 Oct 2026 · 8.6a Phase A tests live under test/, not src/ · decided by builder · risk: low
- Decided: `default-policy.test.ts` and `estimate.test.ts` are in `packages/gateway/test/router/` and
  `test/pricing/`.
- Why: the gateway's vitest config only runs `test/**/*.test.ts`, so tests under `src/` would never run.
- risk: low
