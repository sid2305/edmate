# Task 7.7 — Turn traces and health metrics

**Status:** DONE

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

## Phase B — packages/db (teacher-scoped trace reads)

### Files
- `packages/db/src/repositories/turn-traces.ts` — new `listForTeacherSince(scope: TeacherScope,
  since: string, limit = TEACHER_TRACES_MAX_LIMIT): Promise<TurnTraceRow[]>`, modelled exactly on
  `usageLedgerRepo.sumForTeacherSince`: joins `turnTraces` → `sessions` on
  `sessions.teacherId = scope.teacherId`, filters `turnTraces.createdAt >= since` (`z.iso.datetime
  ({ offset: true })`, same `Since` pattern as `usage-ledger.ts`), orders oldest-first
  (`asc(createdAt), asc(id)`), capped at `limit` (`z.int().min(1).max(TEACHER_TRACES_MAX_LIMIT)`).
  New exported constant `TEACHER_TRACES_MAX_LIMIT = 200` (same value as `AUDIT_MAX_LIMIT`/
  `NOTIFICATIONS_MAX_LIMIT`/`QUESTIONS_MAX_LIMIT`).
- `packages/db/src/repositories/index.ts` — exports `TEACHER_TRACES_MAX_LIMIT` alongside the
  existing `TurnTraceRow` export.
- `packages/db/test/repositories.int.test.ts` — new `'turnTraces.listForTeacherSince'` CASE
  (`scope: 'teacher'`, `targeted: false`), modelled on `'usageLedger.sumForTeacherSince'`; `owners`
  extracts `[pair]` markers from `steps[].name` (the existing convention, same as
  `'turnTraces.listForSession'`) and maps each pair marker (for example `1A`) to its teacher letter
  (`p.slice(-1)`) since `Pair = ${Student}${Teacher}` — the isolation grid's `owners` must return
  the acting teacher's own key (`A`), not the student x teacher pair key.
- `packages/db/test/trace-sink.int.test.ts` — two new tests:
  1. time-window bound + row cap + isolation: inserts two extra traces on teacher A's two
     sessions, back-dates one via `raw.query(update ... set created_at = ...)` to before the
     window, asserts the windowed read excludes it, includes the in-window one, every row's
     `sessionId` belongs to teacher A (never B's seeded `1B`/`2B` sessions), and a `limit: 1` call
     returns exactly one row.
  2. compose test: pipes `listForTeacherSince`'s output straight into `@edmate/harness`'s
     `computeHealthMetrics` and asserts a sane `HealthMetrics` shape (`turns` equals the row
     count, `errorRate`/`guardRate` in `[0, 1]`, `stepLatencyMs` non-empty) — the closest thing to
     an end-to-end demonstration of the accept line without a CLI.

No `packages/contracts` change. No migration: `turn_traces` already has every column needed
(`session_id`, `created_at`); no new index added (see Decisions below — logged as a follow-up, not
a blocker, per the plan).

## Tests (Phase B)
- `corepack pnpm --filter @edmate/db exec vitest run test/trace-sink.int.test.ts` — 1 file, 8
  tests (6 existing + 2 new), all green, against a real Postgres 16 + pgvector (started with
  `docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres`).
- `corepack pnpm --filter @edmate/db exec vitest run test/repositories.int.test.ts` — 1 file, 87
  tests (86 existing + 1 new isolation CASE), all green, including the `'has a case for exactly
  the methods createRepositories returns'` guard (confirms `CASES` matches
  `createRepositories(db)`'s real method set with no gaps) and the new CASE's own isolation-grid
  assertions and 20 random-id leak probes.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` — 26/26 tasks green (db +
  everything that imports it, including `@edmate/harness` built first so the db int test's
  `import { computeHealthMetrics } from '@edmate/harness'` resolves). Full db suite: 51 test files,
  862 tests passed, 4 skipped (unrelated, pre-existing `.skipIf(!up)` guards not hit once Postgres
  was started). `turn-traces.ts` at 100% line/branch/function coverage.
- `python3 .githooks/secret-scan.py --all` — clean.

## Decisions (Phase B)

### 21 Oct 2026 · 7.7 `TEACHER_TRACES_MAX_LIMIT` value · decided by tdd-guide · risk: low
- Decided: `200`, matching `AUDIT_MAX_LIMIT`, `NOTIFICATIONS_MAX_LIMIT` and `QUESTIONS_MAX_LIMIT` —
  the repo's existing convention for a page-sized read limit, with no stated reason to pick
  differently for traces.
- Why: the plan flagged this value as a decision, not a spec requirement; reusing the existing
  convention keeps every `*_MAX_LIMIT` constant mentally interchangeable and avoids inventing a
  new number with no data behind it.
- risk: low — a read-size cap, not a correctness or isolation boundary; raising it later needs no
  migration.

### 21 Oct 2026 · 7.7 no new `turn_traces` index · decided by tdd-guide · risk: low
- Decided: no migration, no new index for this task. The query joins `turn_traces.session_id` to
  `sessions` (already indexed: `turn_traces_session_id_idx`) and filters
  `sessions.teacher_id = scope.teacherId` (already indexed via
  `sessions_teacher_id_student_id_idx`) plus `turn_traces.created_at >= since` (not separately
  indexed). At pilot scale (a handful of teachers, each with a bounded number of sessions and
  traces per session) this is fine; a composite index joining through `sessions` isn't a plain
  column index Drizzle/Postgres can declare directly on `turn_traces` without duplicating
  `teacher_id` onto that table, which is a schema change out of this task's scope.
- Why: the plan explicitly flagged this as optional, "note as a follow-up if query plans in the
  int test look slow" — the int test (seed scale: 2 teachers x 2 students x a handful of traces
  each, plus a few more inserted in the new tests) runs in well under a second; no slowness
  observed to act on.
- risk: low — follow-up only; recommend a board task once real traffic volume is known (same
  recommendation as the plan's Decision 4), to be paired with whether `turn_traces` should also
  carry a denormalised `teacher_id` column (would change the schema, needs its own task/ADR
  discussion, not decided here).
- risk: high — **isolation**: `packages/db/src/repositories/**` is a risky path
  (`.claude/skills/merge-gate/risk-paths.txt`); `listForTeacherSince` is a new cross-session SQL
  read. The isolation CASE (`'turnTraces.listForTeacherSince'` in `repositories.int.test.ts`) and
  the dedicated `trace-sink.int.test.ts` test both prove another teacher's traces never appear
  (grid: every actor teacher reads only its own marker; 20 random-id probes return `[]`; the
  window test asserts every returned row's `sessionId` belongs to teacher A's own two seeded
  sessions, never teacher B's `1B`/`2B`). `review.md` for the PR must name **security-reviewer**
  and **database-reviewer** per the plan's lead answer ("Phase B adds database-reviewer next to
  security-reviewer").

## Left to do
None for 7.7 itself. Follow-ups noted above (not blocking): a CLI/staff-facing report surface
(lead said this is a separate board task, added on merge), and revisiting the `turn_traces` index
question once real traffic volume is known.
