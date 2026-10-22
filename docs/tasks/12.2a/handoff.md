# 12.2a handoff: reports repository (12.2 Phase A, packages/db)

Status: DONE

- Branch: `m12/12.2a-reports-repo` (built locally as `work-122a`)
- Worktree: `.claude/worktrees/agent-a25770d740f8180d5` (under the repo root)

## Summary
A student files a report on an agent or teacher reply in their own session (category only, one
per student per message); staff list the open queue and review each report once, audited. No
migration, no schema change, no contracts change; `subscriptions.ts` and `publish.ts` untouched.

- `reports.file(scope, { sessionId, messageId, category })`: one INSERT…SELECT from `messages`
  joined to `sessions` with `ownSession`, `messages.role in ('agent', 'teacher')`. Not own,
  missing or a student message is `not_found` with nothing written. Row id `reportRowId(student,
  message)` (`rp_` + sha256), `on conflict do nothing`; a repeat is `{ created: false }`, checked in
  scope (the reporter and the owned message must match).
- `reports.listOpenForStaff(by)`: malformed `by` `invalid`, non-staff `scope`; open reports oldest
  first by `(created_at, id)`, capped at 50; each row has the reply (null if gone), teacher id,
  agent id, teacher slug and up to 10 cited documents (`takenDown` from an active
  `document:<id>` takedown). No reporter id, no session id, no user columns.
- `reports.review(by, reportId, { decision, note? })`: `lockRole` staff, report `FOR UPDATE` where
  open (else `not_found`), status set, `{ actor, action, note, ts }` appended to `staff_actions`,
  `report.review` audit row (target `report:<id>`, reply's teacher, note as reason, before/after
  status). Lock order in the file header: role, then report; 12.2b keeps role first, report last.

## Files
- `packages/db/src/repositories/reports.ts` (new)
- `packages/db/src/repositories/map.ts` (append: `REPORT_CATEGORIES`, `ReportCategorySchema`,
  `StaffReportRow` schema and `toStaffReportRow`; `SourceRefSchema` import)
- `packages/db/src/repositories/index.ts` (shared, append: import, `reports` entry, export block)
- `packages/db/src/repositories/README.md` ("Reports (12.2)" section)
- `packages/db/test/reports.test.ts`, `packages/db/test/reports.int.test.ts` (new)
- `packages/db/test/repositories.int.test.ts` (shared, append: 3 `CASES` entries)
- `packages/db/test/scope.test.ts` (shared, append: grid exclusion for the two `by`-first methods)

## Tests
Written first and run red (44 failing: `repos.reports` undefined), then green.

- `TEST_DATABASE_URL=… corepack pnpm vitest run test/reports.test.ts test/reports.int.test.ts` →
  `Tests  44 passed (44)`
- `… vitest run test/repositories.int.test.ts test/scope.test.ts` → `Tests  297 passed (297)`
  (the isolation grid runs `reports.file` over every pair, plus the two staff checks)
- Full gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` with the
  int tests on a disposable `pgvector/pgvector:0.8.1-pg16` container (`edmate122a-pg-test`,
  port 55722, removed afterwards) → typecheck, lint, test all pass; `@edmate/db` `Tests 1248 passed | 4 skipped (1252)`, `reports.ts` 100% lines and functions, 92.5% branches.
- `python3 .githooks/secret-scan.py --all` → clean.

Acceptance covered here: "a report reaches staff on the very next read" (file, then
`listOpenForStaff` returns it in the same test, without reporter, name or email).

## Decisions

### 22 Oct 2026 · 12.2a Student reports and the staff report queue (risky path, security-reviewer) · decided by builder · risk: high
- Decided: in `packages/db/src/repositories/reports.ts` a student files a report only on an agent or teacher message in their own session (scoped in the same INSERT…SELECT), with a category from a closed set and no free text, at most once per student per message; only a user who is staff right now can list or review reports, each review is audited (`report.review`), and the staff queue returns no reporter id, no session id and no student name, email or phone. Reviewer required: security-reviewer.
- Why: the plan's Phase A design and lead answers (Q2 category only); reports are a trust tool and must not become a way to reach another student's chat or a reporter's identity.
- risk: high

### 22 Oct 2026 · 12.2a Staff checks in reports.ts use lockRole, not a users read · decided by builder · risk: low
- Decided: `listOpenForStaff` reads the staff role with `lockRole` (share lock) inside a short read transaction instead of a plain `users` select, so `reports.ts` never names the users table and the scope test's users-read exception list stays as it was.
- Why: the plan asked for a "plain staff role check"; this is the same check with a share lock, and it keeps personal columns structurally out of the file.
- risk: low

### 22 Oct 2026 · 12.2a Report row shape for missing or unexpected messages · decided by builder · risk: low
- Decided: the queue joins only agent or teacher messages; a report whose message is gone reads with `message`, `teacherId`, `agentId` and `teacherSlug` null and no cited documents. Reviewing such a report is `integrity` (the audit row needs a teacher) and it stays open. A stored report with a category outside the closed set makes the queue read `integrity`, like every other repository read. A repeat report keeps the first category.
- Why: repositories never delete messages, so the orphan case is defensive; failing loudly beats auditing against a guessed teacher.
- risk: low

## Left to do
- Nothing for 12.2a. 12.2b adds takedowns and the retrieval filter; its `notTakenDown` helper can replace the inline `takenDown` subquery here (it qualifies `"documents"."id"` by hand because drizzle leaves a one-table select's columns bare, which would bind to `takedowns.id` inside the subquery).

Tool calls used: 34
