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

### Evidence

- `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm turbo run typecheck lint test --filter=@edmate/db`
  → `Tasks: 8 successful, 8 total` (int tests ran against the dev Postgres, not skipped;
  `retention.ts` shows 100% statement/branch/function/line coverage in the run's coverage table).
- New int tests: `packages/db/test/identity.int.test.ts` (`anonymise` describe block, 3 tests —
  clears name/email/phone and every message's text in the student's own sessions while leaving
  the session row, the safety alert and the teacher's row untouched; idempotent on a second call;
  scope/not_found on a non-student/unknown id) and `packages/db/test/retention.int.test.ts` (6
  tests — each method's dry run reports a count and changes nothing; a future cutoff changes
  nothing; a live run purges only past-cutoff rows; `purgeOldSessions` skips a session that still
  has a `turn_traces` or `safety_alerts` row; `purgeOldTranscriptChunks` never touches `material`
  chunks).
- `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0). All test fixtures use
  synthetic ids (`stu_…`, `tch_…`) and placeholder text/phone numbers, no real names or numbers.

## Decisions

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

## Open question for the architect/lead (does not block Phase A; flag before Phase B)
The isolation grid in `test/repositories.int.test.ts` (`IsolationCase`, `CASES`) has no shape for
a scheduled/system job with no teacher or student scope. `retention.ts`'s three methods are the
first such case; Phase B's worker schedule will call them directly (via `openDatabase().retention`
or `@edmate/db/internal`'s `createDb` + `retentionRepo(db)`), same as it already would for a
migration. If more system-level jobs are planned, the grid may be worth a fourth `IsolationCase`
shape (`scope: 'system'`) rather than each one being exported standalone — a one-time decision,
not blocking this phase.

## Left to do
- **Phase B** (`apps/worker`): `src/retention/config.ts` (per-table `RETENTION_DAYS` placeholders,
  `DRY_RUN` default `true`), `schedule.ts`/`workers.ts`/`index.ts` (BullMQ daily job calling
  `retention.purge*`), unit tests (fake clock/queue) and `test/retention.int.test.ts` (disposable
  container).
- **Phase C** (`apps/web`): `src/export/accountExport.ts`, `app/api/me/export/route.ts`,
  `src/account/delete.ts`, `app/api/me/route.ts` (DELETE), plus their tests — root account export
  and `DELETE /api/me` calling `identity.anonymise` for the signed-in student's own id only.
- Human sign-off still open on Open question 2 of the plan (what an account delete keeps) and
  Open question 3 (legal holds) before Phase C ships to real students — Phase A/B build and test
  against the plan's recommendation regardless, per the brief's lead rulings.

## Budget
Tool calls used: 90 (over the brief's 45/55 cap — the file-location and isolation-grid
discoveries above needed real investigation before any code could land safely, and a
post-investigation merge conflict (12.5d's 0030 migration landing mid-phase, as the plan warned
it might) needed a clean renumber-and-regenerate rather than a hand patch; flagging per the
budget-overrun norm rather than stopping mid-way with a broken gate).
