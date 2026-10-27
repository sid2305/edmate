# 12.2f Phase A handoff

Status: DONE (Phase A)

Branch: `m13/12.2f-report-followups`
Worktree: `.claude/worktrees/agent-a12744b3866280fa0` (relative to repo root)
SHA: `fd32b5e935cf4b95687f3fc342b1ba8d4e39a62d`

## Summary of changes

1. `packages/db/src/repositories/reports.ts` — `listOpenForStaff`: each row's
   `toStaffReportRow(...)` call is now wrapped in its own `try { ... } catch { ... }`. A row whose
   stored `reason` fails `ReportCategorySchema` throws `RepositoryError('integrity', ...)` inside
   `toStaffReportRow` (map.ts's `checked` helper is its only throw site, and it only ever throws
   that one kind) — that row is now skipped (dropped from `out`), not re-thrown for the whole
   batch. Nothing is logged from this catch: it is a pure function, and the caller (the staff
   route) already logs only error names.
2. Same file — added a code comment directly above the cited-documents `.limit(...)` call stating
   the cap is batch-wide (not per report), ordered by `(createdAt, id)` ascending, and can silently
   truncate a late report's `citedDocuments` once the queue is large; acceptable at today's sizes.
   Doc-only, no behaviour change.
3. `apps/web/app/api/staff/reports/handlers.ts` / `apps/web/app/api/staff/takedowns/handlers.ts` —
   `export const MAX_NOTE_CHARS` now assigns from `@edmate/db`'s `REPORT_NOTE_MAX` /
   `TAKEDOWN_NOTE_MAX` (both `500`) instead of a duplicated local literal. Export name kept
   unchanged so `route.test.ts` in both folders needed no change.
4. `apps/web/app/staff/reports/view.test.tsx` — added two tests the 12.2g review named:
   - `'reports the reported text as plain text: a javascript: link never becomes a live link'`
     (an `<a href="javascript:...">` string in reported text renders as inert plain text via
     `getByText`, no `link` role). Already passed against the current `view.tsx` — confirmed, no
     production change (the review already said the code is safe).
   - `'a stale poll in flight when a lift succeeds does not bring the lifted takedown back'`, the
     takedowns-side sibling of the existing dismiss-side stale-poll test: a poll starts in flight
     (`loadTakedowns` held open), the takedown is lifted (confirm-free), then the stale poll
     resolves with the old (still-active) takedown row; the takedown stays gone (same
     `generationRef` staleness guard). Also already passed, no production change.
5. `packages/db/test/reports.int.test.ts` — `listOpenForStaff` describe block:
   - Renamed/rewrote the old `'a stored row with an unknown category is integrity, never
     returned'` test to `'...is skipped, not thrown for the whole batch'`, now asserting
     `listOpenForStaff` returns `[]` instead of throwing.
   - Added `'one bad row drops out of the queue; a normal row alongside it still returns'`: one
     unknown-category row plus one normal `other`-category row; asserts only the normal row comes
     back.

No change to `apps/web/app/staff/reports/report-row.tsx` / `view.tsx`, `takedowns.ts`,
`safety-alerts.ts`, or any migration, matching "Files out of bounds".

## Red-then-green evidence

**`packages/db/test/reports.int.test.ts` (listOpenForStaff, unknown-category rows), red** (production
fix temporarily reverted via a scoped `git stash`, same test file):
```
FAIL  test/reports.int.test.ts > reports on Postgres > listOpenForStaff >
  a stored row with an unknown category is skipped, not thrown for the whole batch
FAIL  test/reports.int.test.ts > reports on Postgres > listOpenForStaff >
  one bad row drops out of the queue; a normal row alongside it still returns
RepositoryError: reports.listOpenForStaff: integrity
 ❯ checked src/repositories/map.ts:28:25
 ❯ toStaffReportRow src/repositories/map.ts:508:10
```

**Green, after reapplying the fix:**
```
Test Files  1 passed (1)
     Tests  16 passed (16)
```

**`apps/web/app/staff/reports/view.test.tsx` (javascript: link + lift stale-poll tests)** — both
already passed against the current `view.tsx` on first run, confirming the review's "the code is
already safe" note; no production change made, per the plan's instruction for A.4:
```
Test Files  1 passed (1)
     Tests  38 passed (38)
```

## Decisions

### 27 Oct 2026 · 12.2f Phase A skip-row catch has no "unexpected error" branch · decided by builder · risk: low
- Decided: the `catch` around each row's `toStaffReportRow(...)` call swallows any thrown error
  unconditionally (no `instanceof RepositoryError && kind === 'integrity'` check, no re-throw
  branch), with a comment explaining why: `toStaffReportRow`'s only throw site (`map.ts`'s
  `checked` helper) only ever throws `RepositoryError('integrity', ...)`, so a conditional re-throw
  branch would be dead code that `@edmate/db`'s 100%-branch coverage threshold on
  `src/repositories/**` cannot pass without an artificial test for an unreachable path.
- Why: the plan's design text said "wrap ... and skip (don't push) a row that throws `integrity`",
  which read literally as "only skip when the kind is `integrity`, else propagate" — that version
  typechecked and matched all of this phase's tests, but its unreachable rethrow branch failed the
  package's existing coverage gate (`ERROR: Coverage for statements (99.96%) does not meet
  "src/repositories/**" threshold (100%)`), a repository-wide rule the plan did not call out and
  this task's scope does not permit relaxing. Catching unconditionally reaches the same practical
  behaviour (the plan names no other throw kind this call site can produce) while keeping the
  package green; the comment makes the "why no check" visible to the next reader.

### 27 Oct 2026 · 12.2f risky-path reviewers (Phase A) · decided by lead/plan, logged by builder · risk: high
- Decided: Phase A touches `packages/db/src/repositories/reports.ts` (risky path
  `packages/db/src/repositories/**`) and `apps/web/app/api/staff/reports/handlers.ts` /
  `apps/web/app/api/staff/takedowns/handlers.ts` (risky path `apps/web/app/api/staff/**`); both
  require **security-reviewer** (code-reviewer always required) per
  `.claude/skills/merge-gate/risk-paths.txt`, as the plan's "Risky paths touched" section already
  states.
- Why: standing rule (non-negotiable 6 / 8) — logging it here so the merge gate finds the required
  `risk: high` decision for these paths.

## Gate

- `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm --filter @edmate/db run test` —
  **84 test files, 1785 passed, 4 skipped (pre-existing, unrelated)**, no db int test skipped;
  coverage thresholds (including 100% on `src/repositories/**`) pass.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db --filter=@edmate/web` —
  typecheck and lint both pass for both packages (0 errors; 2 pre-existing warnings in an untouched
  file, `apps/web/test/lighthouse-a11y.test.ts`). The combined test run surfaced one unrelated
  flaky failure, `apps/web/src/auth/index.guard-only.test.ts` (`Test timed out in 20000ms`, a file
  this phase never touches); re-run alone it passes (`1 passed`), confirming flakiness, not a
  regression from this change. All `@edmate/web` tests besides that one timeout passed: **171 of
  172 files, 2687 of 2688 tests** in the combined run.
- `corepack pnpm exec prettier --check` on the five changed files — all pass.
- `python3 .githooks/secret-scan.py --all` — clean, no output.

## Budget

Phase A tool calls used: 58
