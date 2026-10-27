# 9.6j handoff: EXPLAIN the repositories' real SQL instead of hand-written copies

Status: DONE

## Summary

`packages/db/test/export-cursor-paging.int.test.ts`'s three hand-written-copy EXPLAIN tests now
capture and EXPLAIN the repository methods' own SQL statement + bound params instead of a
parallel hand-written SQL string, per the plan's `vi.spyOn(handle.pool, 'query')` approach.

- Added a local `captureAndExplain(pool, raw, run)` helper (spies on `handle.pool.query`, calls
  the real repository method, asserts exactly one round trip, pulls `config.text`/params from the
  one captured call, EXPLAINs that literal statement over `raw` with the same bound params,
  restores the spy).
- `messages.listForStudent: EXPLAIN on the per-session seek shows no full Sort over the
  10,000-row history` → replaced with a test that captures and EXPLAINs
  `repos.messages.listForStudent(SCOPE, { limit: 2 })`'s real full statement (sessions join +
  `cross join lateral` + outer order/limit). Asserts the lateral's inner messages index seek, the
  **new** outer-scan assertion that the sessions join stays on
  `sessions_teacher_id_student_id_created_at_id_idx` (not a seq scan that would run the lateral
  once per unrelated noise session), and the existing planned-rows bound.
- `sessions.listForStudent: a mid-range (page 2+) cursor seeks on the index, no OR Filter` →
  replaced with a version that calls
  `repos.sessions.listForStudent(SCOPE, { after: {...}, limit: 3 })` and EXPLAINs the captured
  real statement; same index/`Index Cond`/`Filter` assertions as before, plus a sanity check the
  captured text has the row-value `>` cursor compare.
- `messages.listForStudent: a mid-range (page 2+) per-session cursor seeks on the index, no OR
  Filter` → same treatment, calling `repos.messages.listForStudent(SCOPE, { after: {...}, limit:
  3 })`. Because the real statement is the same lateral join as the full-statement test (two
  Index Scans: outer sessions, inner messages), `findIndexScan` gained an optional `relation`
  filter so this test picks the inner messages scan (the one with the cursor's `created_at`
  condition), not whichever Index Scan comes first in the plan tree.
- The first (unconverted) sessions EXPLAIN test and the two non-EXPLAIN paging-correctness tests
  are untouched, as the plan specified.

No regression found: EXPLAINing the real statements confirmed the outer sessions scan already
uses the `(teacher_id, student_id, created_at, id)` index (9.6f's fix holds), so no production
code was touched.

## Decisions

### 26 Oct 2026 · 9.6j budget overrun (87 vs 30) · decided by lead · risk: low
- Decided: accept 87 harness-counted tool calls (build 40, fix round 47) against a 30-call budget (2.9x); no rework.
- Why: the build had to trace drizzle's node-postgres call path to spy on the real statements, and the fix round re-ran the db int suite against dev Postgres. The scope stayed to one test file. The fix round was needed because the first version did not pin the outer sessions seek, which was the whole point of the task.

### 26 Oct 2026 · 9.6j review LOWs wontfix (test-only cast and generic) · decided by lead · risk: low
- Decided: wontfix two typescript-reviewer findings in packages/db/test/export-cursor-paging.int.test.ts: the `as unknown as` double-cast on the spied pool.query, and the unused result generic on captureAndExplain.
- Why: both are test-only typing, with no effect on what the EXPLAIN assertions check; a follow-up task for them would cost more than the cleanup is worth.


### 26 Oct 2026 · 9.6j findIndexScan relation filter · decided by builder · risk: low
- Decided: added an optional `relation` parameter to the existing `findIndexScan` helper (matches
  `Relation Name` on the plan node) rather than writing a second helper, so the messages
  mid-range-cursor test can pick the inner per-session Index Scan instead of the outer sessions
  Index Only Scan the real lateral statement also contains.
- Why: converting to the real statement (per the plan) means this test's EXPLAIN tree now has two
  Index (Only) Scan nodes instead of one; the plan's own assertions (`Index Cond` matches
  `created_at`, `Filter` undefined) only hold for the inner one.

## Gate

- `export TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate && corepack pnpm turbo run typecheck lint test --filter=@edmate/db` → `Tasks: 8 successful, 8 total` (typecheck, lint, test all green; coverage report printed, no new gaps introduced).
- `corepack pnpm exec prettier --check packages/db/test/export-cursor-paging.int.test.ts` → initially flagged formatting; `--write` applied, re-check: "All matched files use Prettier code style!"
- `python3 .githooks/secret-scan.py --all` → clean (no output).
- `corepack pnpm --filter @edmate/db exec vitest run test/export-cursor-paging.int.test.ts` → `Test Files 1 passed (1)`, `Tests 8 passed (8)`.

## Fix round

Findings fixed (database-reviewer MEDIUM, typescript-reviewer + code-reviewer MEDIUM):

1. The outer-scan assertion in "messages.listForStudent: ... an outer scan on the sessions
   index ..." only did `expect(plan).toContain('sessions_teacher_id_student_id_created_at_id_idx')`
   on the whole stringified plan, so a plan that keeps that index but seeks on `teacher_id` only
   (pushing `student_id` to a `Filter`) would still pass. Replaced with
   `findIndexScan(top, 'sessions')` and assertions on that scan node's `Index Name` (the exact
   index), `Index Cond` (mentions both `teacher_id` and `student_id`), and `Filter` (undefined) —
   the same rigor as the two mid-range tests. Added `'Index Name'` to the local `PlanNode`
   interface for this. Also passed `'sessions'` to the existing `findIndexScan(top)` call in the
   sessions mid-range-cursor test (typescript-reviewer LOW), so it explicitly targets the sessions
   scan rather than relying on tree order.
2. `captureAndExplain`'s `spy.mockRestore()` ran after the `return`, so a throwing step (e.g. the
   `expect(spy.mock.calls).toHaveLength(1)` assertion, or the `raw.query` EXPLAIN call) left
   `pool.query` spied for later tests. Wrapped the body in `try { ... } finally { spy.mockRestore(); }`.

Also ran `prettier --write` on the test file (the edits needed re-wrapping a multi-line type
annotation); `prettier --check` now passes.

## Evidence

- `export TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate && corepack pnpm turbo run typecheck lint test --filter=@edmate/db` → `Tasks: 8 successful, 8 total` (typecheck, lint, test all green).
- `corepack pnpm --filter @edmate/db exec vitest run test/export-cursor-paging.int.test.ts` → `Test Files 1 passed (1)`, `Tests 8 passed (8)` (file ran, not skipped).
- `corepack pnpm exec prettier --check packages/db/test/export-cursor-paging.int.test.ts` → "All matched files use Prettier code style!"
- `python3 .githooks/secret-scan.py --all` → clean (no output).

## Budget

Tool calls used: 40 (harness count; the builder reported 21)
Fix round tool calls used: 47 (harness count; the fixer reported 19)
