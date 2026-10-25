# Task 7.7a — handoff

**Status:** DONE

## What changed
- `packages/db/src/cli.ts`: new `runHealthReportCli`, `OpenHealthReport`, `openHealthReport`,
  `parseHrArgs`. `db:health-report -- --teacher <id> --since <iso> [--limit <n>]` pipes
  `turnTraces.listForTeacherSince`'s rows through `@edmate/harness`'s `computeHealthMetrics` and
  prints turn count; per-step `p50=.. p95=.. n=..` (including `firstToken`); `errorRate` with
  `errorsByStep`; `guardRate` with `guardsByName`. Prints only the redacted target
  (`redactTarget`), never the raw `DATABASE_URL` or driver text on failure (`redact`); always
  closes the handle in `finally`.
- `packages/db/src/bin/health-report.ts` (new): 6-line entry point, same shape as
  `bin/verify-teacher.ts`.
- `packages/db/package.json`: new `db:health-report` script.
- `packages/db/src/schema/learning.ts`: new `turn_traces_session_id_created_at_idx` composite
  index on `turnTraces(sessionId, createdAt)`, alongside the existing single-column index.
- `packages/db/migrations/0029_turn_traces_created_at_index.sql` (renamed from drizzle-kit's
  generated name) + `migrations/meta/0029_snapshot.json` + `_journal.json` entry: plain
  `CREATE INDEX` (no `CONCURRENTLY`), matching migration 0008's precedent.
- `packages/db/test/health-report-cli.test.ts` (new): 10 unit tests, fake-injected repo, no real
  db.
- `packages/db/test/trace-sink.int.test.ts`: two new negative-path tests for
  `listForTeacherSince` (out-of-range `limit`, malformed `since`), using the file's existing
  `kind()` helper.

## Evidence
- `health-report-cli.test.ts` — 10/10 green, e.g. "prints turn count, per-step p50/p95/n, error
  rate (by step) and guard rate (by guard)" and "never prints the raw connection string on
  failure, and always closes the handle".
- `trace-sink.int.test.ts` — 11/11 green (ran against Postgres, not skipped), including the two
  new tests: "listForTeacherSince rejects an out-of-range limit" and "listForTeacherSince rejects
  a malformed since (not RFC 3339 with an offset)".
- Full gate:
  `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate TEST_REDIS_URL=redis://127.0.0.1:56379 corepack pnpm turbo run typecheck lint test --filter=@edmate/db --force --concurrency=1`
  → `Tasks: 8 successful, 8 total`; `@edmate/db:test: Test Files 77 passed (77)`,
  `Tests 1632 passed | 4 skipped (1636)` (the 4 skipped are pre-existing, unrelated to this
  task); `typecheck`/`lint` both clean.
- `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0).

## Decisions

### 24 Oct 2026 · 7.7a repository-adjacent negative-path tests and CLI reading through turnTraces · decided by builder · risk: high
- Decided: added two negative-path tests directly exercising `turn-traces.ts`'s scope-checking
  path (`listForTeacherSince` with an invalid `limit`/`since`), and a new CLI command
  (`runHealthReportCli`) that reads through the same teacher-scoped repository method. No change
  to the repository method itself (it already fails closed per task 7.7).
- Why: matches the plan's "Risky paths touched" call for `packages/db/src/repositories/**`
  (teacher/student data-isolation group); the lead's plan answer named security-reviewer as a
  required reviewer for this PR.

### 24 Oct 2026 · 7.7a CLI location and index style · decided by builder · risk: low
- Decided: built the CLI in `packages/db/src/cli.ts` + `src/bin/health-report.ts` (not
  `apps/cli`), and used a plain `CREATE INDEX` (not `CONCURRENTLY`).
- Why: matches the existing `db:*` operator-CLI convention and avoids a new `apps/cli` →
  `@edmate/db` dependency edge; the table is pilot-scale with no measured slowness. Both already
  approved in the plan's "Lead answers" (Q1, Q2).

## Budget
Tool calls used: 32
