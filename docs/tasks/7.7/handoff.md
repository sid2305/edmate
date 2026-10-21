# Task 7.7 — Turn traces and health metrics

Status: PARTIAL (Phase A done; Phase B left)

## Files
- `packages/harness/src/pipeline/trace.ts` — `TraceBuilder.markElapsed('firstToken', ms)`
  (idempotent: first call wins), appended to `build()`'s `steps` array after the spec-order list.
- `packages/harness/src/pipeline/trace.test.ts` — new/updated tests for `markElapsed` presence,
  idempotency, omission when no token streamed, and the extended exact-step-list assertions.
- `packages/harness/src/pipeline/runner.ts` — `Turn.startedAtMs` set at the top of `run()`;
  `emitter()` calls `trace.markElapsed('firstToken', ...)` once, on the first `token` event only
  (not `skill`).
- `packages/harness/src/pipeline/runner.test.ts` — extended exact-step-list assertion
  (`records one schema-valid trace with every executed step in spec order`).
- `packages/harness/src/pipeline/policies.test.ts` — the `commit` describe block's `.at(-1)`
  assertion changed to `.find((s) => s.name === 'commit')`, since `firstToken` (when present) now
  sorts after `commit` in `steps`.
- `packages/harness/src/metrics/health.ts` (new) — `computeHealthMetrics`, `HealthMetrics`,
  `LatencyStats`. Pure; imports only `@edmate/contracts` types.
- `packages/harness/src/metrics/health.test.ts` (new) — empty-array zeroing, 20-value nearest-rank
  percentile case, per-step-name stats including `firstToken`, turn-level error rate with
  per-step breakdown, turn-level guard rate with per-guard-name breakdown.
- `packages/harness/src/metrics/index.ts` (new) — barrel.
- `packages/harness/src/index.ts` — exports `./metrics/index.js`.

No `packages/contracts` change (`TurnTraceSchema.steps[].name` is already `z.string()`). No
`packages/db` change (Phase B).

## Tests
- `corepack pnpm --filter @edmate/harness exec vitest run src/pipeline` — 54 files, 1164 tests,
  all green.
- `corepack pnpm --filter @edmate/harness exec vitest run src/metrics` — 1 file, 5 tests, green.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...` — 10/10 tasks green
  (harness + dependents apps/cli, apps/worker, apps/web). `src/metrics/health.ts` at 100% line/
  function/statement coverage, 95% branch (one unreachable `?? 0` fallback on an always-in-bounds
  percentile index).
- `python3 .githooks/secret-scan.py --all` — clean.

## Left to do (Phase B, packages/db)
1. `packages/db/src/repositories/turn-traces.ts`: add
   `listForTeacherSince(scope: TeacherScope, since: string, limit = TEACHER_TRACES_MAX_LIMIT)`,
   modelled on `usageLedgerRepo.sumForTeacherSince`, joining `turnTraces` → `sessions` on
   `sessions.teacherId = scope.teacherId`, ordered oldest-first.
2. `packages/db/test/repositories.int.test.ts`: new `'turnTraces.listForTeacherSince'` CASE
   (teacher scope, isolation check modelled on `'turnTraces.listForSession'`).
3. `packages/db/test/trace-sink.int.test.ts`: time-window bound + row-cap tests, plus a test that
   pipes `listForTeacherSince`'s output into `computeHealthMetrics` (imports the new
   `@edmate/harness` export) to show the two layers compose.
4. Needs `database-reviewer` alongside `security-reviewer` on the PR (risky path:
   `packages/db/src/repositories/**`); handoff needs a `risk: high` decision entry.
5. `TEACHER_TRACES_MAX_LIMIT`'s exact value and whether a `turn_traces` index is needed are open,
   logged decisions (see plan's Decisions 3-4), not blockers.

## Decisions

### 21 Oct 2026 · 7.7 first-token capture point · decided by tdd-guide · risk: low
- Decided: `firstToken` is marked in `Turn.emitter()` on the first `token`-type event only (not
  `skill`), using elapsed ms from `startedAtMs` (set at the very first line of `run()`) to
  `deps.clock.now()` at emit time; `TraceBuilder.markElapsed` is idempotent (first call wins), so a
  cleared-and-retried stream doesn't double-count or get overwritten by a later attempt's first
  token.
- Why: matches the plan's design exactly (PRD S5 "first words of a reply"); the idempotent map
  keeps the number meaningful as an operational SLA (time until the student saw *anything*) even
  across a retry.
- risk: low — additive, no existing step budget or behaviour changed; only a new derived entry
  appended to `trace.steps`, which the schema already allows as a plain string.

### 21 Oct 2026 · 7.7 collateral exact-step-list fixes · decided by tdd-guide · risk: low
- Decided: beyond the plan's named files (`runner.test.ts` ~L119, `trace.test.ts` ~L42/L64), also
  fixed `policies.test.ts`'s `commit` describe block, which asserted `steps.at(-1)` (position-
  dependent) rather than `.find(name === 'commit')`; `firstToken` now sorts after `commit` in the
  array when both are present, which broke that one assertion. Changed it to a name-based lookup
  to match the convention used everywhere else in that file.
- Why: the plan's audit found only `.find()`/`.map(name).toEqual(exact list)` patterns per the
  grep, but this one `.at(-1)` position lookup slipped through that search; fixing it the same way
  (name-based, not position-based) keeps the test meaningful without depending on `steps` array
  ordering, which is an implementation detail.
- risk: low — test-only change, no production behaviour affected.
