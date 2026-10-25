# 13.4 handoff

## Phase A

### What changed

Account delete and retention now exist in `packages/db`, per the plan and the brief's lead
rulings (B-59 recommendation).

- **`identity.anonymise(userId)`** (`packages/db/src/identity/store.ts`) — not
  `packages/db/src/repositories/users.ts` as the plan's file list named: `test/scope.test.ts`
  already bans any file in `repositories/` (other than `discovery.ts` and `teacher-profiles.ts`)
  from mentioning `users` at all, so `repositories/users.ts` could never have passed that test.
  `identity/store.ts` is the module that already owns the `users` table (role-lock.ts's own
  comment: "no repository source file may name the users table"), so the method lives there
  instead, exported through `IdentityStore` the same way `grantRole`/`recordAgeAnswer` are. It:
  - Locks the row (`for('update')`), requires `role = 'student'` (a teacher/staff id is `scope`,
    an unknown id is `not_found` — this is the student's own rights method, not a general
    account-closer).
  - Sets `name` to the fixed placeholder `ANONYMISED_NAME` ('`[deleted student]`'), `email` and
    `phone` to `null`.
  - Clears `text` on every row of `messages` in every session of that student's (student or
    agent/teacher authored — a teacher/agent reply inside the student's own conversation can
    still carry what the student told them, so it is cleared too; nothing outside the student's
    own sessions is touched).
  - Writes one `platform_audit_log` row (`actor: userId`, `actorRole: 'student'`,
    `action: 'account.delete'`, `subjectUserId: userId`) in the same transaction — the existing
    "a grant belongs to no teacher, so it stays out of audit_log" pattern `grantRole` already
    uses, because an account-wide delete has no single teacher either.
  - Idempotent: name/email/phone and message text are already cleared on a second call (no error,
    no further change); it still writes a second audit row (an audit trail of two delete calls,
    not a single mutation, is the correct record — see Decisions).
  - Leaves `sessions`, `safety_alerts`, `payments`/`ledger_entries`/`payouts`, `audit_log` and the
    teacher's own row completely untouched (an int test seeds one of each and asserts they are
    unchanged after `anonymise`).
- **Migration `0031_platform_actor_role_student.sql`** — adds `'student'` to the
  `platform_actor_role` enum (previously `staff`/`operator` only), so `anonymise`'s self-actioned
  audit row is possible at all. First generated as `0030` (main was still at 0029 when this phase
  started); 12.5d's `0030_alert_queue_indexes` landed on `main` while this phase was in progress,
  so after merging `origin/main` the migration was regenerated as `0031` against the merged
  schema and renamed from the generated `0031_fearless_union_jack.sql` to a descriptive name, the
  journal tag updated to match (the repo's own convention — 0027, 0029 are renamed the same way).
- **`retentionRepo(db)`** (new `packages/db/src/repositories/retention.ts`) —
  `purgeOldSessions`, `purgeOldTraces`, `purgeOldTranscriptChunks`, each `(cutoff, dryRun = true)`
  returning `{ count, dryRun }`:
  - `purgeOldSessions`: ended sessions past `cutoff` with **no** remaining `turn_traces` or
    `safety_alerts` row referencing them (both FKs are `restrict`) — a session that still has
    either is skipped this round, not force-deleted or errored; it becomes eligible once its own
    (usually shorter) trace/alert retention has cleared it. Deletes the session's `messages`
    first, then the session, in one transaction.
  - `purgeOldTraces`: `turn_traces` past `cutoff` — a leaf table ("no keys, no names" per its own
    schema comment), nothing references it.
  - `purgeOldTranscriptChunks`: `chunks` with `kind = 'transcript'` past `cutoff` only, never
    `material`/`teacher_note`; `topic_chunks` cascades on chunk delete, so a linked transcript
    chunk is removed cleanly.
  - **Deliberately not part of `createRepositories`/`Repositories`,** so not part of
    `RepositoryMethod` or the `CASES: Record<RepositoryMethod, IsolationCase>` grid in
    `test/repositories.int.test.ts`. That grid models a signed-in teacher's or student's own
    scoped access (every `IsolationCase` is `scope: 'teacher' | 'student' | 'public'`); a
    scheduled, cross-account retention purge has no such scope and does not fit any of the three
    shapes. Forcing it in would have meant extending the isolation grid's own type for every
    future system job, a much bigger and riskier change than this phase's budget allows — flagged
    to the architect as a real gap (see Open question below), not silently worked around.
    Exported standalone from `repositories/index.ts`, the same way `ports.ts`'s factories
    (`transcriptStoreFor`, etc.) already are, and added to `openDatabase()`'s return value
    (`{ repos, identity, retention, close }`) so Phase B/C never need the raw `Db` handle.
- `packages/db/src/repositories/index.ts`, `packages/db/src/index.ts`,
  `packages/db/src/identity/index.ts` — wiring/exports for the above.
- Three existing guard tests updated for the two legitimate new deviations:
  `test/scope.test.ts` (retention.ts is now allowed to `.delete(`, alongside chunks/learner/outline),
  `test/access-audit.test.ts` (retention.ts is now allowed to name the `chunks` table — it purges
  by kind and date, never searches or reads chunk content, so it carries no leak risk), and
  `test/repositories.int.test.ts` (`openDatabase()`'s key list now includes `retention`).

Fix round (25 Oct 2026) additionally touched:
- `packages/db/src/identity/store.ts` — `anonymise` deletes `auth_sessions`/`auth_accounts`/the
  old email's `auth_verification_tokens`, and clears `sessions.summary`,
  `learner_profiles.last_summary` and `teacher_questions.text`.
- `packages/db/src/repositories/retention.ts` — each purge method takes a bounded `limit`
  (exported `RETENTION_PURGE_LIMIT = 1000`).
- `packages/db/src/schema/learning.ts`, `packages/db/src/schema/content.ts`,
  `packages/db/migrations/0032_retention_indexes.sql` (new) — `sessions_created_at_idx`,
  `turn_traces_created_at_idx`, `chunks_transcript_created_at_idx` (partial, transcript only).
- `packages/db/src/index.ts` — the `repositories/index.js` import line wrapped (prettier style).
- LOW fixes: `test/retention.int.test.ts`'s `FUTURE_CUTOFF` renamed `NOTHING_OLDER_CUTOFF` (it is
  a past date); `migrations/0031_platform_actor_role_student.sql` gets a one-line comment that no
  later migration in the same deploy may use `'student'` before it commits.

### Evidence

- `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm turbo run typecheck lint test --filter=@edmate/db`
  → `Tasks: 8 successful, 8 total`, `Test Files 80 passed (80)`, `Tests 1670 passed | 4 skipped
  (1674)` (int tests ran against the dev Postgres, not skipped; `retention.ts` and
  `src/identity/store.ts` both show 100% statement/function/line coverage, 100%/98.46% branch, in
  the run's coverage table — the one uncovered branch, store.ts:500, is `recordAgeAnswer`'s
  pre-existing under-age-with-no-email case, not touched by this round).
- `packages/db/test/identity.int.test.ts`'s `anonymise` describe block now has 5 tests: the
  original 3 (clears name/email/phone and every message's text while leaving the session, safety
  alert and teacher row untouched; idempotent; scope/not_found) plus the fix round's 2 — one
  asserting `auth_sessions`/`auth_accounts`/`auth_verification_tokens`,
  `sessions.summary`, `learner_profiles.last_summary` and `teacher_questions.text` are all
  cleared, one asserting a second student's own auth rows and learner profile are untouched.
- `packages/db/test/retention.int.test.ts` now has 8 tests: the original 6 plus the fix round's
  2 — a `limit`-of-2/5-rows test on `purgeOldSessions` (one call deletes 2, repeated calls finish
  the rest, the dry run's own count stays unlimited) and an EXPLAIN test on `purgeOldTraces`
  (20,000 seeded rows, ANALYZEd, asserting the plan names `turn_traces_created_at_idx`).
- `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0). All test fixtures use
  synthetic ids (`stu_…`, `tch_…`) and placeholder text/phone numbers, no real names or numbers.

## Decisions

### 25 Oct 2026 · 13.4 Phase B: RETENTION_PURGE_LIMIT re-exported from @edmate/db · decided by builder · risk: low
- Decided: added `RETENTION_PURGE_LIMIT` to `packages/db/src/repositories/index.ts`'s existing
  `retention.js` re-export line, alongside `retentionRepo`/`RetentionRepo`/`RetentionResult`.
- Why: the constant existed in `repositories/retention.ts` since Phase A but was never re-exported
  past that file, so `@edmate/db` (the package Phase B imports) had no way to hand it to a
  caller — the worker's live-mode loop needs it to recognise "that call may have left more
  behind" without hardcoding `1000` a second time, which would silently drift from the real limit
  if `RETENTION_PURGE_LIMIT` ever changed. Additive only (one new named export); no existing
  export's shape or behaviour changed, so `risk: low` under the fix-brief's "changes what is
  deleted or kept" test — this changes nothing about what is deleted, only what the constant is
  reachable from.

### 25 Oct 2026 · 13.4 Phase B: live-mode loop stops at "below the limit", not "zero" · decided by builder · risk: low
- Decided: `purgeTable` (`apps/worker/src/retention/workers.ts`) calls a table's purge method
  again only while the previous call's count equals (or exceeds) `purgeLimit`; a call reporting
  fewer rows than `purgeLimit` ends that table's loop for this run, even if some of today's run
  already purged some other, now-recent-enough-to-not-qualify rows.
- Why: this matches `@edmate/db`'s own contract exactly — a live call never returns more than
  `limit` rows by construction, so "count < limit" is the only correct signal that a call cleared
  everything there was to clear at that moment; checking for "count === 0" instead would do one
  extra, always-empty call per table per run forever. Capped at `MAX_ITERATIONS_PER_TABLE` (1000)
  regardless, so even a pathological backend that always returns exactly `limit` can never loop a
  single run forever — it stops, reports `maxIterationsHit: true`, and is picked up again next
  run.

### 25 Oct 2026 · 13.4 Phase B: retention queue added to apps/worker's own entrypoint, not left to a future task · decided by builder · risk: low
- Decided: wired `createRetentionWorker`/`scheduleRetention` into `apps/worker/src/index.ts`
  (queue, worker, startup schedule call, shutdown close) rather than leaving the job built but
  never started.
- Why: the plan's own Phase B description ends with "a BullMQ repeatable job" — a job that is
  never scheduled anywhere isn't one; every other scheduled job in this file (`costAlarm`,
  `weeklyInsights`) is wired the same way at the same point, so leaving retention unwired would
  have been an inconsistent, easy-to-miss gap rather than a deliberate deferral.

### 25 Oct 2026 · 13.4 an erased student's open questions are dismissed · decided by lead · risk: high
- Decided: `identity.anonymise` (`packages/db/src/identity/store.ts`) clears `teacher_questions.text`
  and, in the same statement, also sets `status = 'dismissed'` for any of this student's rows
  whose status is `'open'`; answered or already-dismissed rows of theirs keep their existing
  status, and no other student's row is ever touched (the update is scoped by `studentId = id`).
- Why: the partial unique index `teacher_questions_open_dedup_key`
  (`packages/db/src/schema/learning.ts`) is on `(teacher_id, student_id, agent_id, md5(text))
  where status = 'open'`. Clearing two of this student's open questions to the same teacher's
  agent to `text = ''` without changing status made both rows collide on `md5('')` under that
  index, throwing a unique violation and rolling back the whole account delete. A deleted student
  can never receive an answer, so dismissing the row is correct, not just a workaround for the
  index; checked `teacherQuestionsRepo` (`packages/db/src/repositories/teacher-questions.ts`)
  first — `open`'s grouping read and `listGroupsForTeacher` both filter by `status = 'open'` per
  row, never by `group_id` as a whole, and the teacher's own dismiss action already sets exactly
  `status: 'dismissed'` on a single row — so this matches existing behaviour and a group whose
  other rows belong to other students still shows them.

### 25 Oct 2026 · 13.4 fix round: anonymise also deletes auth_sessions/auth_accounts/auth_verification_tokens · decided by builder · risk: high
- Decided: `identity.anonymise` (`packages/db/src/identity/store.ts`) now deletes the student's own
  `auth_sessions` and `auth_accounts` rows, and (by the old email, captured before it is nulled)
  their `auth_verification_tokens` row, in the same transaction as the rest of the erase —
  mirroring `recordAgeAnswer`'s under-age branch exactly.
- Why: code review (fix round) found a signed-in device kept working after `anonymise` because
  its session row was left behind. The method already locks and re-selects the user row for
  `role`/`email`; adding `email` to that select (no extra query) is enough to find the token row
  the same way the under-age branch does.

### 25 Oct 2026 · 13.4 fix round: free text cleared beyond messages — sessions.summary, learner_profiles.last_summary, teacher_questions.text · decided by builder · risk: high
- Decided: `anonymise` also clears, for every row of this student: `sessions.summary` (null),
  `learner_profiles.last_summary` (null, every teacher pair), `teacher_questions.text` (empty
  string, matching how `messages.text` is cleared). `teacher_questions.moduleHint` and `.answer`,
  and `corrections`/`teacher_eval_cases` (no `student_id` column at all — teacher-owned, not
  student-owned) are left as is.
- Why: security review (fix round) found `learner_profiles.last_summary` uncleared; grepping
  every schema file for a column keyed by a `studentId` column (`grep -n "studentId()" schema/*.ts`
  then reading each table) turned up two more free-text columns besides the one named:
  `sessions.summary` (the ≤60-word end-of-session recap `sessions.ts`'s own write path upserts
  onto `learner_profiles.last_summary` — the same "can restate what the student said" risk as the
  column the review named) and `teacher_questions.text` (the student's own question to the
  teacher — the review's own "class questions a student asked" example). `moduleHint` is left: it
  is a module id/title the question was tagged with (`'module 2'`, `'mod_a1'` in its own tests),
  not student-written prose, and the teacher's own `answer` is the teacher's content, not the
  student's — clearing it would delete the teacher's answer to a question that no longer shows
  whose it was, a bigger change than this finding asked for. `evidence_events`, `usage_ledger`,
  `notifications` and the three `billing.ts` tables with a `studentId` column have no text column
  at all, so nothing there needed clearing.

### 25 Oct 2026 · 13.4 fix round: no "account closed" column added · decided by builder · risk: low
- Decided: do not add a migration or column marking an account closed. `identity.anonymise`
  (`packages/db/src/identity/store.ts`) leaves the row itself in place (role `student`, a fixed
  placeholder name, no email/phone) rather than deleting it or flagging it closed.
- Why: with the fix above, the old sessions and linked accounts are gone and the email is
  cleared, so a later sign-in with that same email (or any other) creates a new, empty account —
  no stale session can ever reach the old row again. No existing column marks an account closed,
  and the pilot has no requirement yet to block re-signup under the same identity (there is none,
  since the email is gone); adding one now would be a schema change with no reader. Revisit if a
  real pilot need for a hard block on re-signup shows up.

### 25 Oct 2026 · 13.4 fix round: retention cutoff indexes (migration 0032) · decided by builder · risk: low
- Decided: added `sessions_created_at_idx` (`sessions.created_at`), `turn_traces_created_at_idx`
  (`turn_traces.created_at`) and a partial `chunks_transcript_created_at_idx`
  (`chunks.kind, chunks.created_at` `WHERE kind = 'transcript'`) via migration
  `0032_retention_indexes.sql`, generated with `drizzle-kit generate` after adding the three
  indexes to `schema/learning.ts`/`schema/content.ts`, then renamed from the generated
  `0032_glossy_doctor_doom.sql` (the repo's own renaming convention; the journal tag updated to
  match).
- Why: database review (fix round) found none of `retentionRepo`'s three cutoff predicates had a
  supporting index — each purge would have forced a sequential scan as the tables grow. All three
  are additive (no data or behaviour change for any existing query). An EXPLAIN int test
  (`test/retention.int.test.ts`, `purgeOldTraces` describe block) seeds 20,000 rows (1,000 past
  the test's cutoff, enough for the past-cutoff slice to be selective) and ANALYZEs before
  asserting the plan names `turn_traces_created_at_idx`, not a sequential scan.

### 25 Oct 2026 · 13.4 fix round: purge methods take a bounded, exported limit · decided by builder · risk: low
- Decided: `purgeOldSessions`, `purgeOldTraces` and `purgeOldTranscriptChunks`
  (`packages/db/src/repositories/retention.ts`) now take a third argument, `limit`, defaulting to
  a new exported constant `RETENTION_PURGE_LIMIT = 1000`. A live call selects at most `limit` ids
  (oldest first, by `created_at` then `id`) and deletes only those; a dry run is unaffected — it
  still reports the true, unlimited count. `purgeOldSessions`'s in-memory id list (previously every
  eligible session, with no cap) is now bounded by the same `limit`.
- Why: database review (fix round) found all three were unbounded — one call could lock and
  delete (or, for sessions, load into memory) an arbitrarily large set. This does not change what
  is ultimately deleted or kept (Phase B's scheduled job loops, calling again until a call reports
  fewer than `limit`), only how much one call does at once, so it is `risk: low` under the
  "changes what is deleted or kept" test in the fix brief.

### 25 Oct 2026 · 13.4 anonymise lives in identity/store.ts, not repositories/users.ts · decided by builder · risk: high
- Decided: implement the account-delete method as `IdentityStore.anonymise`, not a new
  `repositories/users.ts` file.
- Why: `test/scope.test.ts`'s existing "never reads from users" check scans every file in
  `repositories/` (except `discovery.ts`/`teacher-profiles.ts`) for the word `users` and fails if
  found. A `repositories/users.ts` naming the `users` table to clear `name`/`email`/`phone` would
  have failed that test immediately; `identity/store.ts` is the one module the codebase already
  carves out for exactly this (role-lock.ts's own comment: "no repository source file may name
  the users table itself").

### 25 Oct 2026 · 13.4 personal columns cleared: name, email, phone · decided by builder · risk: high
- Decided: `anonymise` clears `users.name` (to a fixed placeholder, since it is `NOT NULL`),
  `users.email` and `users.phone` (to `null`).
- Why: these are the only personal columns on `users` (checked every schema file for
  name/email/phone/address-shaped columns); `birthYear` is a year only (never a full date of
  birth, by 1.7's own design) and is left alone, same as `ageConfirmedAt`/`ageBlockedAt`/`role`.

### 25 Oct 2026 · 13.4 message text cleared for every message in the student's own sessions, not just student-authored ones · decided by builder · risk: high
- Decided: `anonymise` clears `messages.text` for every row in every session that student took
  part in, regardless of `role` (student, agent or teacher).
- Why: an agent or teacher reply inside that conversation can restate or quote what the student
  said; clearing only `role = 'student'` rows would leave that content behind. Nothing outside
  the student's own sessions (another student's sessions with the same teacher, or any other
  table) is touched.

### 25 Oct 2026 · 13.4 excluded tables (safety_alerts, payments/ledger/payouts, audit_log, platform_audit_log, webhook_events, eval_runs/results) left untouched · decided by builder · risk: high
- Decided: none of these tables are read, written or purged by `anonymise` or by any
  `retention.*` method.
- Why: `safety_alerts` is a safety/legal record (it stores a redacted excerpt only, never a name);
  `payments`/`ledger_entries`/`payouts`/`invoices` carry their own, longer financial retention
  law; `audit_log`/`platform_audit_log` are append-only — purging them would destroy the evidence
  an account-delete's own audit trail, or a dispute, depends on; `webhook_events` and
  `eval_runs`/`eval_results` are operational/quality records with no personal data and no
  retention rule asked for them in this task.

### 25 Oct 2026 · 13.4 platform_actor_role gets a 'student' value (migration 0030) · decided by builder · risk: high
- Decided: add `'student'` to the `platform_actor_role` enum rather than reuse `'operator'` or
  add a `teacherId` surrogate to `audit_log` instead.
- Why: `audit_log.teacher_id` is `NOT NULL`, and an account-wide delete has no single teacher to
  name (the same reason `grantRole` already uses `platform_audit_log`, which has no `teacherId`
  column, for its own role-change audit row). `platform_audit_log.actor_role` was `staff`/
  `operator` only, which doesn't fit a student acting on their own account; labelling the row
  `'operator'` while `actor` holds a real student id would have made the audit trail misleading.
  Extending the enum is additive (an `ALTER TYPE … ADD VALUE`, no data change) and keeps the
  existing self-explanatory table.

### 25 Oct 2026 · 13.4 retentionRepo kept out of createRepositories/the isolation grid · decided by builder · risk: high
- Decided: `retentionRepo` is exported standalone (like `ports.ts`'s factories), not added to
  `createRepositories`'s returned object.
- Why: `test/repositories.int.test.ts`'s `CASES: Record<RepositoryMethod, IsolationCase>` requires
  every method on `createRepositories(db)` to have a case shaped `scope: 'teacher' | 'student' |
  'public'`. A scheduled, cross-account purge has none of those three scopes; forcing a fit would
  have meant extending that shared type (used by every other repository's test) for a
  `'system'`/`'scheduled'` case kind — a correct fix, but a much bigger one than Phase A's budget,
  and a decision the architect should make once (see Open question below), not one a single
  builder should make inside an unrelated phase's PR.

## Phase B

### What changed

The worker-side scheduled retention job (`apps/worker/src/retention/`), following
`src/insights/` as the shape (`config.ts` has no `insights/` counterpart; `workers.ts` plays the
role `weeklyInsights.ts` plays there — the pure core — and `schedule.ts`/`logSink.ts`/`index.ts`
mirror theirs directly):

- **`config.ts`** — `RETENTION_DAYS` (`sessions: 730`, `turnTraces: 90`, `transcriptChunks: 730`),
  each value commented `placeholder pending counsel sign-off (13.4 open question 1)`;
  `defaultRetentionConfig` (`{ days: RETENTION_DAYS, dryRun: true }`) is the job's default — dry
  run everywhere until a human flips it, the same fail-closed pattern 3.10 used for unverified
  helplines. `cutoffFor(now, days)` is the one date-math helper, unit tested directly.
- **`workers.ts`** (pure core) — `purgeTable(table, purge, cutoff, dryRun, purgeLimit)`: a dry run
  makes exactly one call (the count it reports is already unlimited, and dry runs never write, so
  looping would never change anything); a live run calls again while a call reports a count equal
  to `purgeLimit` (meaning that call may have left more behind), summing counts, until a call
  reports fewer than `purgeLimit` or the run hits `MAX_ITERATIONS_PER_TABLE` (1000) — a sane upper
  bound so one run can never loop forever; hitting it is reported back on the result
  (`maxIterationsHit: true`), not thrown, so the other tables still run and the job still
  succeeds (that table is picked up again next run).
- **`schedule.ts`** — `RETENTION_QUEUE`/`RETENTION_JOB`/`RETENTION_SCHEDULER_ID`, a daily
  `RETENTION_PATTERN` (`'0 4 * * *'` UTC — provisional, no locale timezone involved since this is
  a system-wide purge, not a per-teacher one), `scheduleRetention` (idempotent upsert, mirrors
  `scheduleWeeklyInsights`), `retentionJob(deps)` (the processor: purges `sessions`, `turnTraces`,
  `transcriptChunks` in turn, each via `purgeTable` against its own cutoff from `config.days`,
  logging each table then the run summary) and `createRetentionWorker` (mirrors
  `createWeeklyInsightsWorker` exactly: failed → dead letter, error → logged).
- **`logSink.ts`** — `logRetentionTable`/`logRetentionRun`: counts only (table name, count,
  dryRun, call count) — never a row id, never message or transcript text. `warn` when a table (or
  the run) hit the iteration cap, else `info`, same shape as `logWeeklyInsightsRun`.
- **`index.ts`** — barrel export.
- **`apps/worker/src/index.ts`** — wired the same way `weeklyInsights` is: a `retentionQueue`,
  `createRetentionWorker({ deps: { retention: db.retention, now, log } })` (Phase A's
  `openDatabase().retention`, used directly — no adapter needed; its methods' extra, unused
  `limit` parameter is structurally compatible with `RetentionBackend`'s two-argument shape),
  added to the `workers` array and `scheduleRetention(retentionQueue)` called at startup (error →
  logged, `process.exitCode = 1`, same as every other scheduled job here); `retentionQueue.close()`
  added to `shutdown`.
- **`packages/db/src/repositories/index.ts`** — one added export, `RETENTION_PURGE_LIMIT` (it was
  defined and used inside `retention.ts` but never re-exported past that file, so `@edmate/db`
  itself had no way to hand the constant to a caller despite Phase A's own handoff describing it
  as "exported from @edmate/db"). Needed so the worker job's live-mode loop can recognise "that
  call may have left more behind" without hardcoding the number a second time. Additive only — no
  behaviour or signature change to any existing export.
- Tests first, following `insights/`'s own test files: `config.test.ts`, `workers.test.ts`
  (`purgeTable` directly: one dry-run call; live mode summing across several full-limit calls then
  stopping below it; a live call that finds nothing), `logSink.test.ts`, `schedule.test.ts`
  (`scheduleRetention`'s upsert call; `retentionJob` dry run — exactly one call per table, nothing
  written; live mode looping; a table whose every call reports the limit runs the real
  `MAX_ITERATIONS_PER_TABLE` = 1000 iterations and is reported `maxIterationsHit: true`, `warn`
  logged, job still succeeds; `createRetentionWorker` built without connecting, `failed`/`error`
  events logged, same fake-Redis pattern as `insights/schedule.test.ts`) and
  `apps/worker/test/retention.int.test.ts` (dev Postgres, `TEST_DATABASE_URL` — no disposable
  container started, stopped or composed; follows `test/commit.int.test.ts`'s own throwaway-database
  pattern: creates and migrates a fresh database per run, drops it in `afterAll`). The int test
  seeds one old and one recent `turn_traces` row (with the session/teacher/student/agent rows its
  foreign key needs) and proves: a dry run reports a count and deletes nothing; live mode (with
  `turnTraces: 90` days and every other table's cutoff pushed far enough into the past that it
  purges nothing in this seed) deletes only the past-cutoff row, leaving the recent one and the
  session untouched.

### Evidence

- `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm turbo run build typecheck lint test --filter=@edmate/worker...`
  → `Tasks: 39 successful, 39 total` (int tests ran against the dev Postgres, not skipped;
  `apps/worker/src/retention` shows 96.55% statement / 81.48% branch / 87.5% function coverage —
  all comfortably above the 80% bar; the one uncovered branch in `schedule.ts` is
  `createRetentionWorker`'s default `now`/`prefix` fallback, the same shape `insights/schedule.ts`
  leaves uncovered). One unrelated, pre-existing flake seen along the way:
  `@edmate/harness`'s `forged teacher-note marker (3.11d) > runs in linear time on long hostile
  input` failed once under heavy concurrent-run resource contention and passed cleanly alone and
  on every other full-gate run — not touched by this phase.
- `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0). The int test's fixtures use
  synthetic ids (`tch_…`, `stu_…`, `agt_…`, `ses_…`, `tt_…`) only.

## Open question for the architect/lead (does not block Phase A; flag before Phase B)
The isolation grid in `test/repositories.int.test.ts` (`IsolationCase`, `CASES`) has no shape for
a scheduled/system job with no teacher or student scope. `retention.ts`'s three methods are the
first such case; Phase B's worker schedule will call them directly (via `openDatabase().retention`
or `@edmate/db/internal`'s `createDb` + `retentionRepo(db)`), same as it already would for a
migration. If more system-level jobs are planned, the grid may be worth a fourth `IsolationCase`
shape (`scope: 'system'`) rather than each one being exported standalone — a one-time decision,
not blocking this phase.

## Left to do
- **Phase C** (`apps/web`): `src/export/accountExport.ts`, `app/api/me/export/route.ts`,
  `src/account/delete.ts`, `app/api/me/route.ts` (DELETE), plus their tests — root account export
  and `DELETE /api/me` calling `identity.anonymise` for the signed-in student's own id only.
- Human sign-off still open on Open question 2 of the plan (what an account delete keeps) and
  Open question 3 (legal holds) before Phase C ships to real students — Phase A/B build and test
  against the plan's recommendation regardless, per the brief's lead rulings.

## Budget
Tool calls used: 196 (Phase B: 82) — Phase A + its two fix rounds used 114 (97, then +17 for round
2; see the per-phase notes below); Phase B's own 82 is also over its brief's 50/60 cap. Most of
Phase B's overrun was reading context to follow the shape faithfully (`insights/`'s five files,
`commit.int.test.ts`'s throwaway-database pattern, the `sessions_open_has_package` constraint
that broke the int test's first seed) plus three rounds of chasing turbo/vitest resource
contention from other concurrent sessions on this machine (a flaky `@edmate/harness` timing test
and a coverage-directory lock collision, both unrelated to this phase's own files, confirmed by
rerunning clean) before the gate was reliably green; flagging per the budget-overrun norm rather
than stopping mid-way with a broken or unverified gate.

Phase A: 90 (initial) → 97 (after fix round 1) → 114 (after fix round 2, see below).

## Fix round (25 Oct 2026)
1. [HIGH, code-reviewer] `anonymise` leaving `auth_sessions`/`auth_accounts`/the old email's
   `auth_verification_tokens` — **fixed**. `identity/store.ts`'s `anonymise` now deletes all
   three in the same transaction, mirroring `recordAgeAnswer`'s under-age branch; new int tests
   in `test/identity.int.test.ts` assert they're gone for the erased student and untouched for
   another student.
2. [HIGH, security-reviewer] `learner_profiles.last_summary` never cleared — **fixed**, plus two
   more free-text columns the grep turned up: `sessions.summary` and `teacher_questions.text`
   (see Decisions). `teacher_questions.moduleHint`/`.answer` named and left, with reasons.
3. [MEDIUM, security-reviewer] no "account closed" flag — **decision only, no migration** (see
   Decisions): the fix-1 deletes plus the already-cleared email make a stale sign-in impossible;
   a blocking flag is not needed for the pilot.
4. [HIGH, database-reviewer] no indexes behind the three cutoff predicates — **fixed**:
   migration `0032_retention_indexes.sql` adds `sessions_created_at_idx`,
   `turn_traces_created_at_idx` and a partial `chunks_transcript_created_at_idx`; a new EXPLAIN
   int test on `purgeOldTraces` (20,000 seeded rows, ANALYZEd) asserts the planner picks the
   index.
5. [HIGH, database-reviewer] all three purges unbounded — **fixed**: each now takes a `limit`
   (default `RETENTION_PURGE_LIMIT = 1000`, exported); a new int test with `limit = 2` and 5 old
   sessions asserts one call deletes 2 and repeated calls finish the rest, and that a dry run's
   count stays unlimited.
6. [LOW] `src/index.ts`'s long import wrapped; `FUTURE_CUTOFF` renamed `NOTHING_OLDER_CUTOFF`;
   `0031_platform_actor_role_student.sql` gets its one-line "no later migration" comment — all
   **fixed**.
7. [Lead addition] Dependent gate: `IdentityStore` grew the `anonymise` method in Phase A, but
   `apps/web/test/memory-identity.ts`'s `MemoryIdentity` fake (the only `IdentityStore`
   implementer under `apps/`, confirmed by `grep -rln "IdentityStore" apps/ --include=*.ts`)
   never implemented it, so `@edmate/web#typecheck` failed with `TS2741`. **Fixed** — added a
   minimal `anonymise(userId)` to the fake mirroring the real store's scope rule (not found/scope
   errors) and its auth-row deletes (`accounts`, `sessions`, `links`); the fake keeps no
   messages/sessions-table rows/learner profiles/teacher questions to clear, so there is nothing
   else for it to do. Verified standalone with `tsc --noEmit`, then with the full
   `corepack pnpm turbo run build typecheck lint test --filter=...@edmate/db` dependent gate
   (`@edmate/db`, `@edmate/web`, `@edmate/worker`) — all typecheck/lint/test green; the one build
   failure seen (`@edmate/web#build`, SIGKILL/137) was 3-package resource contention in one
   background run, not a code issue — confirmed by re-running `@edmate/web#build` alone
   (`8 successful, 8 total`, 26.5s).

Tool calls: 97

Round 2: open-question dedup collision on erase fixed (status dismissed)
Tool calls: 17
