# Task 5.10d plan — one open session per (teacher, student, agent)

`python3 .claude/skills/board/board.py show 5.10d`. Deferred from `docs/tasks/5.10b/plan.md`
item 3 / `docs/tasks/5.10b/handoff.md`'s "unique partial session index not added" decision (22 Oct
2026, risk: medium): `sessions.create` (`packages/db/src/repositories/sessions.ts`) inserts
unconditionally on every `startSession` call with no prior lookup, so two open sessions for one
`(teacher_id, student_id, agent_id)` triple can already exist. This task closes that gap and adds
the unique partial index 5.10b deferred.

## STOP CONDITION — read first

This plan's migration number assumes `origin/m13/9.2d-display-name` (migration
`0027_teacher_display_name`) is already on `main`. **Before any schema/migration file is touched,
check `packages/db/migrations/` for `0027_*`.** If it is not there yet, this build does not start:
leave the branch unopened, note the wait in the board, and stop at `Status: BLOCKED` with "9.2d not
on main yet" as the reason. If it is there, this task's migration is `0028_sessions_open_unique.sql`
(the next number after 0027). If some other task's migration also lands first and claims 0028, take
the next free number and say so in the handoff — don't renumber another task's file.

## Acceptance (verbatim, from the board)

> two startSession calls for one triple leave one open session; the unique partial index exists;
> web and db tests pass

**How it's shown:**
- `packages/db/test/sessions.int.test.ts`: two concurrent `repos.sessions.create(scope, input)`
  calls for the same `(teacherId, studentId, agentId)` (`Promise.all`) both resolve, both return the
  **same** session id, and exactly one row exists for that triple with `ended_at is null` after.
- A new `packages/db/test/sessions-open-unique-migration.int.test.ts` (modelled on
  `teacher-question-dedup-migration.int.test.ts` and `migrate.int.test.ts`'s
  `sessions_open_teacher_id_student_id_idx` coverage): seeds two pre-existing duplicate open
  sessions for one triple against the pre-0028 schema, runs the full migration
  (`migrateDatabase`/`runPostMigrateSteps`), and asserts (a) exactly one is still open, the other is
  ended, (b) the new unique index exists and is valid, (c) a fresh `INSERT` of a second open session
  on the same triple is rejected once the index is built.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db` and
  `--filter=@edmate/web` both green; `python3 .githooks/secret-scan.py --all` clean.

## Design decisions (made here, not left to the builder)

### 1. Reuse, not end-and-recreate
`startSession` reuses an existing open session for the triple instead of ending it and opening a
new one. Reasons: it matches the one existing precedent for this exact shape — migration 0011's
`teacherQuestions.open`, "insert-or-return-existing" on a partial unique key (`docs/decisions/log.md`,
"19 Oct 2026 · 3.17 TeacherQuestion open-dedup…") — and it preserves `help_state` (the hint ladder,
ADR-0005) across a page refresh or a second tab, which end-and-recreate would silently wipe. A
reused session may carry a stale `agentVersion`/`packageVersion` pin if the student's entitlement
changed since it opened; that is **already** today's behaviour for any long-lived open session (3.16:
`TurnConfigStore.load` ends a stale-pinned session on the next turn, not at start time) — reuse adds
no new staleness, it only stops a redundant insert.

### 2. Race-safety: `ON CONFLICT` on the new unique partial index, inside one transaction
`sessions.create` becomes, inside one `db.transaction`:
1. The existing ownership-checked `insertSelect` (unchanged FROM/WHERE — agent/package/version must
   still resolve, or the row count is 0 for that reason), with
   `ON CONFLICT (teacher_id, student_id, agent_id) WHERE ended_at IS NULL DO NOTHING` appended (raw
   SQL, like `teacher-questions.ts`'s `open()` — drizzle's `onConflictDoNothing()` can't infer a
   partial-index target, see that file's comment on `42P10`/`42601`).
2. If `written(result) === 1`: return the new row's id (created).
3. If `written(result) === 0`: `SELECT id FROM sessions WHERE teacher_id = :t AND student_id = :s
   AND agent_id = :a AND ended_at IS NULL LIMIT 1` inside the **same transaction**. A row found is
   the conflict case — return its id (reused). No row found means the original `FROM`/`WHERE` matched
   nothing (bad agent/package/version/teacher combo) — throw `not_found`, as today.
Doing both steps in one transaction removes the gap where another request could end the session
between the conflict and the fallback read (Postgres's own `ON CONFLICT` blocks a second concurrent
inserter until the first's transaction commits, so by the time step 3 runs the winning row is already
committed and visible).
**Open question (recommended default): same status code both ways.** `startSession` keeps
returning `201` with the session id whether `create` created or reused — don't thread a
`reused: boolean` through the route for a status-code distinction the acceptance line doesn't ask
for. Flag in the handoff if the lead wants `200` on reuse; low cost to add later.

### 3. The index itself: `CREATE UNIQUE INDEX CONCURRENTLY`, via the post-migrate step, like `sessions`'s other two indexes — not a plain migration-file index
`sessions` is the one table in this codebase `migrate.ts` already calls out as needing this (its
docstring on `sessions_package_id_package_version_idx`/`sessions_open_teacher_id_student_id_idx`,
and 0011's own comment: "teacher_questions is small and low-write (unlike `sessions`), so a plain
migration is proportionate" — the inverse holds here). So:
- `packages/db/src/schema/learning.ts`: a new **schema-only** declaration next to
  `sessions_open_teacher_id_student_id_idx` —
  `uniqueIndex('sessions_open_teacher_student_agent_key').on(t.teacherId, t.studentId,
  t.agentId).where(sql\`${t.endedAt} is null\`)` — with the same comment pattern ("declared here so
  `db:generate` stays a no-op; built by the post-migrate step with `CREATE UNIQUE INDEX
  CONCURRENTLY`, not by SQL in a migration file").
- `packages/db/src/migrate.ts`: **append** (don't edit past entries, per that file's own rule) one
  `PostMigrateStep` of kind `concurrentIndex` to `POST_MIGRATE_STEPS`, `sql: CREATE UNIQUE INDEX
  CONCURRENTLY IF NOT EXISTS "sessions_open_teacher_student_agent_key" ON "sessions" USING btree
  ("teacher_id","student_id","agent_id") WHERE "sessions"."ended_at" is null`. `runPostMigrateSteps`'s
  existing invalid-index drop-and-rebuild logic (`isIndexInvalid`) covers this step for free — no
  code change needed there.

### 4. Existing duplicates in a dev (or any already-running) database: closed, not deleted, inside the migration's own transaction, before the post-migrate step ever runs
`0028_sessions_open_unique.sql` (a normal, transactional migration file — this part is a data
UPDATE, not an index build, so it does not need `CONCURRENTLY` or NOT VALID staging) runs first:
```sql
-- keep the newest open session per (teacher_id, student_id, agent_id); end the rest, same way
-- 6.4's own "end a session" path does (ended_at = now()), never delete (append-only data).
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY teacher_id, student_id, agent_id
    ORDER BY created_at DESC, id DESC
  ) AS rn
  FROM sessions WHERE ended_at IS NULL
)
UPDATE sessions SET ended_at = now()
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
```
**Open question (recommended default): keep the newest open session, not the oldest.** 0011 kept
the oldest `teacher_question` (first-asked wins). For sessions, recommend the opposite: keep the
**newest**, because the student's most recent session is the one most likely to hold the live,
useful `help_state` (today's open session they're mid-conversation in); the older one(s) are more
likely abandoned tabs or a stale session a refresh never closed. Flag this in the handoff; it's a
one-line `ORDER BY` change if the lead disagrees, no other design impact.

This UPDATE runs and commits inside drizzle's migration transaction (same connection, same
`migrateDatabase()` call) strictly before `runPostMigrateSteps` builds the unique index, so the
`CREATE UNIQUE INDEX CONCURRENTLY` step never sees a duplicate — it cannot fail on one. State this
in the migration file's own comment, same as 0011's.

## Files

**Create**
- `packages/db/migrations/0028_sessions_open_unique.sql` (pending the stop condition above —
  renumber if 0028 is taken) + `packages/db/migrations/meta/_journal.json`,
  `packages/db/migrations/meta/0028_snapshot.json` (generated by `drizzle-kit generate`, then
  checked that the generated SQL is empty/schema-only for the new index, per the existing pattern —
  the index itself must not appear in the generated migration file; only the dedup UPDATE is
  hand-written there).
- `packages/db/test/sessions-open-unique-migration.int.test.ts` (new, see Acceptance above).

**Modify**
- `packages/db/src/schema/learning.ts`: the new schema-only `uniqueIndex`.
- `packages/db/src/migrate.ts`: one appended `POST_MIGRATE_STEPS` entry; update its docstring's
  running list of what's declared schema-only (same sentence pattern as the 0009/0010/0023/0024
  list already there).
- `packages/db/src/repositories/sessions.ts`: `create()` rewritten per Design 2.
- `packages/db/test/sessions.int.test.ts`: the concurrency test (Design 2) plus a same-triple
  sequential-reuse test (second `create()` call, no concurrency, returns the first id and leaves one
  row) and a not-found-stays-not-found test (bad agent id still throws `not_found`, not swallowed by
  the new fallback read).
- `packages/db/README.md` (or wherever the repositories doc for `sessions` lives — check first):
  one line documenting reuse-on-create and the new index, same style as 5.10b's README note.
- `docs/tasks/5.10d/handoff.md` (the two open questions' chosen defaults, confirmed or overridden).

**Not touched**: `apps/web/src/turn/routes.ts` — `startSession` already just calls
`b.sessions.create(...)` and returns its `id`; Design 2 keeps that return shape (`{ id }`), so no
caller change is needed. Confirm this at the start of the build (re-read `routes.ts`'s `startSession`)
before assuming it — if the route needs a change after all (e.g. for the open status-code question),
say so and keep it minimal.

## Files out of bounds (other builders are in these)
- `packages/harness/**`
- `apps/web/src/auth/**`, `apps/web/app/api/auth/**`
- `apps/web/app/teacher/onboarding/**`
- `packages/db/src/repositories/teacher-profiles.ts`
- Any other milestone's in-flight migration file/number (check the stop condition first).

## Tests first
1. `packages/db/test/sessions.int.test.ts`'s new cases (concurrency, sequential reuse, not-found)
   written and red against the current `create()` before touching it.
2. `packages/db/test/sessions-open-unique-migration.int.test.ts` written and red (no such index,
   duplicates untouched) against the pre-0028 migration folder (the
   `foldersBefore0011`-style helper, pinned to this migration's tag) before the migration file and
   `migrate.ts` entry exist.

## Risky paths touched (`.claude/skills/merge-gate/risk-paths.txt`)
- `packages/db/src/repositories/**` (`sessions.ts`) — reviewers: **security-reviewer**.
- The migration (data UPDATE ending open sessions) and the new unique-index post-migrate step —
  not itself a `risk-paths.txt` glob, but per this task's own instruction: **database-reviewer**
  always reviews the migration and `migrate.ts` change.
- No `packages/contracts` change (session shape returned to the route is unchanged) — no ADR, no
  architect/typescript-reviewer requirement beyond normal review.
- The handoff logs a `risk: high` decision for the migration (ends real session rows, even though
  additive/no-delete) naming database-reviewer and security-reviewer, per this task's own
  instructions.

## Open questions (recommended default given; not blocking)
1. **Reuse status code.** Recommend: always `201`, whether created or reused (Design 2). Flag if the
   lead wants `200` on reuse.
2. **Which duplicate session survives the cleanup.** Recommend: the newest (`created_at DESC`), the
   opposite of 0011's "oldest wins" (Design 4's reasoning). Flag if the lead wants "oldest" for
   consistency with 0011 instead.

## Budget: 60 tool calls (1 phase, packages/db only)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (pnpm typecheck/lint/test for `@edmate/db` and the secret scan
only — builders never run docker compose; Postgres is already up at `127.0.0.1:55432`).

## Exit conditions
`Status: DONE` once: the stop condition cleared (0027 was on main before this started), the new
migration + post-migrate step + schema declaration exist, `sessions.create` reuses race-safely, all
four new/changed test files are green, `@edmate/db` package gate (`typecheck lint test`) is green,
and the secret scan is clean. `Status: PARTIAL` if the builder is past about 55 tool calls, if 9.2d
turns out not to be on main (stop at the top, no files touched, say so), or if a file outside this
plan's list (an out-of-bounds path, or another task's claimed migration number) turns out to need
changing — hand back rather than widening scope.

## Lead answers (23 Oct 2026)
1. Created or reused: the same 201 status code and body shape; no new field.
2. Duplicates in a dev database: keep the newest open session, close the older ones (ended_at = now()), never delete.
3. Starts only after 9.2d (migration 0027) is merged on main; the stop condition stays.
4. One Sonnet builder, budget 60 calls, PARTIAL past 75. Reviewers: database-reviewer, security-reviewer, code-reviewer, typescript-reviewer.
