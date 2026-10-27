# 9.6f plan — 9.6a/9.6c/9.6g review follow-ups

## Task (verbatim)

id: 9.6f, milestone M13, risk: high, deps: 9.6a.

Title: 9.6a review follow-ups: an additive index migration so messages.listForStudent and
sessions.listForStudent page by (created_at, id) without sorting the whole pair history each page
(e.g. sessions (teacher_id, student_id, created_at, id), and a messages path that seeks by the
cursor across the pair's sessions), checked with EXPLAIN on a seeded large pair; messages.listForStudent
tests gain the malformed-cursor, exact-boundary next = null and return-key-set cases that the
sessions test has; a comment on ExportCursorSchema's Z-only datetime; 9.6g review LOW: answeredPairs
in apps/web/src/export/notes.ts shares one used set across the exact-timestamp and fallback
branches, so a teacher message matched exactly is not reused by a later fallback; 9.6c review LOWs:
pause and cancel as one UPDATE ... RETURNING, a type guard for LIVE_FOR_STUDENT_WRITE.includes, a
comment that StatusSnapshot is deliberately non-strict.

Accept (verbatim): EXPLAIN on a pair with 10,000 messages shows an index scan with no full Sort
per page; the new messages test cases pass; the migration is additive.

How shown: a seeded pair (10,000 messages across several sessions) + an `EXPLAIN (FORMAT JSON)`
assertion in a new int test that fails on the current code (full Sort) and passes after the fix;
`corepack pnpm turbo run typecheck lint test --filter=...@edmate/db` (and `--filter=...@edmate/web`
for Phase B) green; `python3 .githooks/secret-scan.py --all` clean.

## Scope conflict found while planning (read first)

Every existing test for `messages.listForStudent`, `sessions.listForStudent` and
`subscriptions.pause/cancel/resume` lives in `packages/db/test/repositories.int.test.ts`, which is
out of bounds (another builder owns it). Decision: this plan never edits that file.
- The "missing listForStudent tests" (malformed-cursor, exact-boundary `next = null`, return-key-set)
  go into a **new** file, `packages/db/test/export-cursor-paging.int.test.ts`, instead of being
  added next to the sessions cases they mirror. Same assertions, same intent, different file —
  noted as a `## Decisions` line in the handoff.
- The subscriptions.ts LOWs (9.6c) are a behavior-preserving refactor and a comment: no new
  assertions needed, and the existing `repositories.int.test.ts` coverage (already green, not
  edited) still exercises pause/cancel/resume and must stay green through the gate.
- If `repositories.int.test.ts` frees up before this merges, a later task can move the new cases
  next to the sessions ones; not done here.

## Precedent read

- `packages/db/migrations/0034_agents_created_at_id_index.sql`: a plain, non-concurrent
  `CREATE INDEX` in the migration file — used for `agents`, a table with no documented
  high-write/CONCURRENTLY precedent.
- `packages/db/src/schema/learning.ts` (sessions table) and `packages/db/src/migrate.ts`
  (`POST_MIGRATE_STEPS`): every index added to `sessions` *after* its initial migration
  (0009, 0010, 0028, 0032) is declared schema-only in `learning.ts` (so `db:generate` is a no-op)
  and built by `runPostMigrateSteps` with `CREATE INDEX CONCURRENTLY IF NOT EXISTS`, because
  `sessions` is "big and high-write" (migrate.ts's own comment). `messages` is written to once per
  chat turn too, so the new index on it follows the same CONCURRENTLY pattern, not a plain
  migration-file `CREATE INDEX`.
- Decision for this plan: migration 0035 adds no index via plain SQL. It is a near-empty migration
  file (or a comment-only one, matching 0010/0028/0032's style) whose two new indexes —
  `sessions_teacher_id_student_id_created_at_id_idx` on `sessions (teacher_id, student_id,
  created_at, id)` and `messages_session_id_created_at_id_idx` on `messages (session_id,
  created_at, id)` — are declared schema-only in `learning.ts` and built by two new
  `POST_MIGRATE_STEPS` entries, appended (not edited) after the 0033 entry, with `migrate.ts`'s doc
  comment extended one more sentence for "Migration 0035 (task 9.6f)". This is still additive: no
  existing index is dropped or replaced.

## The query-side fix (messages.listForStudent)

`messages` carries no `teacher_id`/`student_id` (by design, per `sessions.ts`'s `ownSession`
comment); the pair filter only reaches `messages` through the `sessions` join. A single composite
index can't make Postgres produce the full `(createdAt, id)` global order with no Sort node when
the WHERE is really on `sessions`'s columns. The fix is a two-step, bounded-candidate rewrite
inside `messagesRepo.listForStudent`, using both new indexes:
1. Look up the pair's session ids (cheap: `sessions_teacher_id_student_id_idx` already exists).
2. For each session id, seek at most `limit + 1` candidate messages at or after the cursor using
   the new `messages (session_id, created_at, id)` index (a lateral/per-session bounded query, not
   one unbounded join).
3. Merge the (small, bounded) candidate set — at most `sessionCount * (limit + 1)` rows, not the
   pair's whole history — sort that small set, take the first `limit + 1`.

`sessions.listForStudent` needs no query change: the new `sessions (teacher_id, student_id,
created_at, id)` index alone lets Postgres satisfy the existing single-table filter + order with
an index scan, no code change to `sessions.ts` beyond the `ExportCursorSchema` comment (9.6a LOW).

Exact SQL/drizzle shape (lateral subquery vs. per-session `UNION ALL`) is the builder's call;
the acceptance test is EXPLAIN-based, not implementation-based.

## Phase A — the migration and the two listForStudent query paths

Files to create:
- `packages/db/migrations/0035_sessions_messages_export_cursor_index.sql`
- `packages/db/migrations/meta/0035_snapshot.json`
- `packages/db/test/export-cursor-paging.int.test.ts`

Files to modify:
- `packages/db/migrations/meta/_journal.json` (append the 0035 entry)
- `packages/db/src/schema/learning.ts` (two new schema-only indexes, with a comment like the
  existing ones pointing at `migrate.ts`)
- `packages/db/src/migrate.ts` (two new `POST_MIGRATE_STEPS` entries + one more doc-comment sentence)
- `packages/db/src/repositories/messages.ts` (`listForStudent` bounded-candidate rewrite)
- `packages/db/src/repositories/sessions.ts` (`ExportCursorSchema` comment only: why `z.iso.datetime()`
  accepts only a `Z`-suffixed instant, not an offset form)

Tests first (`packages/db/test/export-cursor-paging.int.test.ts`):
1. Seed one pair with ~12 sessions and 10,000 messages spread across them (reuse `isolation-seed.ts`/
   `access-seed.ts` helpers if they fit; otherwise a small local seed in the test).
2. `EXPLAIN (FORMAT JSON)` on `sessions.listForStudent`'s underlying query: assert no `Sort` node
   with the pair's full row count as input (red before the index, green after).
3. Same for `messages.listForStudent`: assert no `Sort` node over the full 10,000-row history (a
   small bounded `Sort` over the per-session candidate set is fine — the accept line says "no full
   Sort", not "no Sort").
4. The malformed-cursor, exact-boundary `next = null`, and return-key-set cases for
   `messages.listForStudent`, mirroring the existing `sessions.listForStudent` cases in
   `repositories.int.test.ts` (read, don't copy verbatim — adapt to this file's seed).
5. A small regression: `messages.listForStudent` and `sessions.listForStudent` still return the
   same rows, same order, as before the rewrite (property: page-by-page concatenation equals one
   big unpaginated read, oldest first) — catches an off-by-one in the bounded-merge rewrite.

Risky paths touched (Phase A):
- `packages/db/src/repositories/messages.ts`, `packages/db/src/repositories/sessions.ts` match
  `packages/db/src/repositories/**` → reviewers: security-reviewer.
- Migration + schema/migrate.ts changes aren't a path match in risk-paths.txt (additive, no
  drop/delete), but given the precedent in 9.6a/9.6c's own reviews and the CONCURRENTLY mechanics,
  this plan also asks for database-reviewer.
- Required reviewers for Phase A: security-reviewer, database-reviewer, typescript-reviewer
  (also as code-reviewer), lead.

## Phase B — the two independent LOW cleanups

Files to modify:
- `apps/web/src/export/notes.ts` (`answeredPairs`: the exact-timestamp branch must add its match
  to the shared `used` set too, so a later question's fallback search can't reuse it)
- `apps/web/src/export/notes.test.ts` (new case: two teacher messages with a duplicate timestamp,
  one matched exactly by question A; question B's fallback must not reuse it)
- `packages/db/src/repositories/subscriptions.ts`:
  - `pause` and `cancel`: combine `SELECT ... FOR UPDATE` + `UPDATE` into one
    `UPDATE ... WHERE ... RETURNING` (behavior-preserving; no new test)
  - replace the repeated `live.status as (typeof LIVE_FOR_STUDENT_WRITE)[number]` cast with a
    small `isLiveForStudentWrite(status): status is ...` type guard, used at both `pause` and
    `changePackage` call sites
  - a comment on `StatusSnapshot` noting it is deliberately non-strict (and why)

No new test file: existing `repositories.int.test.ts` coverage (not edited) must stay green for
`subscriptions.pause/cancel/resume/changePackage` and `notes.test.ts`'s existing cases must stay
green.

Risky paths touched (Phase B):
- `packages/db/src/repositories/subscriptions.ts` matches `packages/db/src/repositories/**` →
  reviewers: security-reviewer.
- `apps/web/src/export/notes.ts` is not a risk-paths.txt match.
- Required reviewers for Phase B: security-reviewer, typescript-reviewer (also as code-reviewer),
  lead.

## Out of bounds (not touched by either phase)

`packages/db/src/index.ts`, `packages/db/src/repositories/audit.ts`,
`packages/db/src/repositories/redact-json.ts`, `packages/db/src/repositories/teacher-profiles.ts`,
`packages/db/test/repositories.int.test.ts` — owned by other builders right now.

## Open questions

- None blocking. One design call already made above (new test file instead of
  `repositories.int.test.ts`) — logged as a `## Decisions` line in each phase's handoff, not a
  human blocker.

## Decisions (for the handoff to carry forward)

- Decided: the new messages.listForStudent test cases live in a new file,
  `packages/db/test/export-cursor-paging.int.test.ts`, not next to the sessions cases in the
  out-of-bounds `repositories.int.test.ts`.
- Decided: migration 0035's two new indexes are built CONCURRENTLY by `POST_MIGRATE_STEPS`
  (schema-only in `learning.ts`), following the `sessions`-table precedent (0010/0028/0032), not
  as a plain `CREATE INDEX` in the migration file like 0034's `agents` index.

## Budget

Budget: 125 tool calls (2 phases, @edmate/db + apps/web)

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (migration generation, `EXPLAIN` runs, tests, secret scan only)

## Exit conditions

Phase A: Status: DONE when the EXPLAIN test is green pre-rewrite-red/post-rewrite-green, the three
new messages cases pass, `--filter=...@edmate/db` is green, and the secret scan is clean. Stop at
Status: PARTIAL past ~90 tool calls, or if the EXPLAIN assertion can't be made reliable across CI
runners (flag it, don't loosen it silently — see lessons.md "Wall-clock bounds fail on shared CI
runners": count plan-tree shape, not timing).

Phase B: Status: DONE when both fixes land, `notes.test.ts`'s new case passes, the existing
`repositories.int.test.ts` subscriptions and notes coverage stays green (run it, don't skip it),
`--filter=...@edmate/db` and `--filter=...@edmate/web` are green, and the secret scan is clean.
Stop at Status: PARTIAL past ~35 tool calls, or if a subscriptions.ts fix turns out to need a new
assertion only `repositories.int.test.ts` can host (say so, don't edit that file).

## Lead amendment (26 Oct 2026)
- Phase A starts only after 1.7a (PR #327) merges, because both edit `packages/db/src/migrate.ts`'s
  POST_MIGRATE_STEPS. Phase A's builder branches from main after that merge, appends its steps
  after 1.7a's two, and updates the count in `packages/db/test/migrate.test.ts` to whatever main
  has plus its own.
- Phase A budget: 90 tool calls; stop with `Status: PARTIAL` past 110 (commit and push first). If
  the messages seek-and-merge rewrite grows past about 40 calls on its own, stop and hand it back.
  The index and the sessions path can merge without it.
- Reviewers: code-reviewer and typescript-reviewer both run (one doesn't stand in for the other),
  plus security-reviewer, and database-reviewer for Phase A.
