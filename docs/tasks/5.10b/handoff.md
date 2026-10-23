# Task 5.10b handoff: teacher-questions locking and index follow-ups

## Summary

Fixed all four review follow-ups from `docs/tasks/5.10/review.md`, entirely in `packages/db`:

1. `teacherQuestions.answer` now takes the agent lock (`for('no key update')`, the same order
   `open` uses) before locking the group's open member rows, and locks that whole group in one
   statement, ordered ascending by id (`WHERE id = ANY(memberIds) ORDER BY id FOR UPDATE`), instead
   of the old single-row-then-unordered-group lock that could deadlock two concurrent `answer()`
   calls on different members of one group (40P01).
2. The stored answer is now the exact same trimmed string (`i.answer.trim()`) in both
   `teacher_questions.answer` and the thread message's `messages.text` — previously the thread
   message kept the raw, untrimmed `i.answer`.
3. Migration `0025_teacher_questions_grouping_index.sql` (additive, `CREATE INDEX`, no
   `CONCURRENTLY` — matches this package's other migrations) adds
   `teacher_questions_teacher_id_agent_id_status_created_at_idx` on
   `(teacher_id, agent_id, status, created_at)`, which `open`'s grouping read filters and sorts by
   exactly (fix round: corrected from an earlier, wrong claim that this index also serves
   `listGroupsForTeacher` — that read has no `agent_id` predicate, so it can't use this index's
   prefix). The other half of this item — a unique partial index on open sessions per
   `(teacher, student, agent)` — was **not added**: see Decisions below.
4. `bestGroup` (`question-similarity.ts`) now tokenises the incoming question once per call
   (`queryTerms(text)` into a `Set`) instead of once per candidate inside the old
   `questionSimilarity`/`sharedTermCount` pair; behaviour (score, tie-breaks, `MIN_SHARED_TERMS`,
   `QUESTION_GROUP_MIN`) is unchanged and the existing `question-similarity.test.ts` suite stays
   green.

## Files

- `packages/db/src/repositories/teacher-questions.ts` — `answer()` rewritten (lock order, trimmed
  answer, two new defensive `not_found` guards with `/* v8 ignore next */` justifications for
  races too narrow to force deterministically in a test).
- `packages/db/src/repositories/question-similarity.ts` — `bestGroup` tokenises once.
- `packages/db/src/schema/learning.ts` — new grouping index on `teacherQuestions`.
- `packages/db/migrations/0025_teacher_questions_grouping_index.sql`,
  `packages/db/migrations/meta/_journal.json`, `packages/db/migrations/meta/0025_snapshot.json` —
  the additive migration.
- `packages/db/src/repositories/README.md` — documents the new lock order, the new index, and why
  the unique session index was not added (append-only edit inside the existing § Ask the teacher
  section, shared file).
- `packages/db/test/teacher-question-answer.int.test.ts` — three new tests (deadlock, race,
  trim/no-newline) plus one covering two of one student's own questions in a group, appended to
  the existing `describe('answer')` block (shared file, append-only).

## Tests

- Item 1 (deadlock): `"two concurrent answers to different members of one group finish without a
  40P01 deadlock, and both groups end up fully answered"` — opens two similar questions for
  different students (one group), runs `Promise.allSettled` on both `answer()` calls, asserts no
  rejection's message or `.cause` matches `/40P01|deadlock/i`, any rejection is `RepositoryError`
  kind `not_found`, and both questions end up `answered`. I could not make this fail reliably
  against the pre-fix code either (deadlocks are timing-dependent on this machine's scheduler) — I
  verified the fix by code reading (agent lock fully serializes concurrent `answer()`s for one
  agent, and the ordered group lock is defence in depth beyond that) rather than a repeatable
  red-before-fix run.
- Also for item 1 (the race the lead's decision calls out specifically): `"a question opened
  during an answer doesn't stay open after its group is answered"` — runs `answer()` on one member
  concurrently with `open()` of a new similar question from a second student; asserts the first
  question is `answered` and the newly opened one is either `answered` (if it landed in the same
  group before the lock) or `open` (if it formed/joined after) — never left open while its group
  is fully answered.
- Item 2 (trim): `"the stored answer is the same trimmed text in the thread message and
  teacher_questions.answer, with no trailing newline"` — answers with a trailing-newline string,
  checks both the `teacher_questions.answer` column and the latest `messages.text` row equal the
  trimmed text and neither ends in `\n`.
- Item 3 (migration, additive): `python3 .claude/skills/board/board.py` acceptance is covered by
  running the full db integration suite (including `migrate.int.test.ts`) against a fresh database
  — the new migration applies cleanly from scratch and on an existing database.
- Item 4 (`bestGroup`): existing `test/question-similarity.test.ts` (44 tests) stays green
  unchanged.
- New: `"two of the same student's own questions in one group count as one student, one message,
  one notification"` — closes a pre-existing branch-coverage gap in the (unchanged) `byStudent`
  dedup loop that no prior test exercised.
- Full package gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` — green.
  `corepack pnpm run test` (db package, full coverage) — 74 test files passed, 1443 passed / 4
  skipped, `src/repositories/**` aggregate: 100% statements/functions/lines, 98.24% branches
  (threshold 90%). `python3 .githooks/secret-scan.py --all` — clean.

## Left to do

- The unique partial index on open sessions per `(teacher, student, agent)` (item 3, second half)
  is not added — see Decisions. A follow-up task in `apps/web` (making `startSession` reuse or
  close an existing open session before opening a new one) would need to land first.
- Two `/* v8 ignore next */` guards in `teacherQuestions.answer` (the `owner` not-found check and
  the final `members.some` not-found check) defend against races that are real but too narrow
  (sub-millisecond, cross-transaction) to force deterministically in this test suite; a future
  task with manual two-connection lock-stepping could replace them with real tests if that's ever
  worth the cost.

## Fix round (22 Oct 2026)

One fix round against `510b-cr.md`, `510b-ts.md`, `510b-db.md` and `510b-sec.md`'s findings.
Scope: `packages/db/src/repositories/teacher-questions.ts`, `question-similarity.ts`,
`packages/db/test/teacher-question-answer.int.test.ts`, this handoff and the repositories
`README.md`. No migration changes; no real network or model calls.

1. **HIGH (AB-BA deadlock, item 1).** `open`'s `callerSimilarIds` lock (`FOR KEY SHARE`, previously
   unordered) now adds `.orderBy(teacherQuestions.id)`, the same ascending order `answer`'s group
   lock (`FOR UPDATE`) already used — the two multi-row locks on this table were taken in
   different orders, exactly the deadlock class `docs/lessons.md`'s "Two writers that lock the
   same rows in different orders deadlock" entry names for this file. Checked every other
   multi-row read in the file: the `candidates` and `groupRows` reads are unlocked (no ordering
   needed); `answer`'s `members` lock already had `.orderBy(teacherQuestions.id)`.
2. **HIGH (test determinism, item 2).** Rewrote `describe('5.10b review follow-ups', ...)` in
   `teacher-question-answer.int.test.ts` using `publish.int.test.ts`'s raw-connection pattern
   (a second `pg.Client` holding a row lock, a `lockWaiters` helper polling `pg_stat_activity`
   until the other side is actually blocked, then releasing) instead of `Promise.allSettled`/
   `Promise.all` races that never forced the interleaving they claimed to test:
   - `"a question opened during an answer doesn't stay open after its group is answered (forced
     interleaving)"` — replaces the old same-named test; a raw connection holds the agent row
     lock so both a real `answer()` and a real `open()` queue behind it in a chosen order, proven
     via `lockWaiters(1)`/`lockWaiters(2)` before releasing.
   - `"a multi-row teacher_questions lock taken in descending id order deadlocks against
     answer()'s ascending group lock; the same ascending order never does (forced, two
     connections)"` — replaces the old, non-deterministic `"two concurrent answers ... finish
     without a 40P01 deadlock"` test. Part A: a raw connection locks a group's higher id first,
     then a real `answer()` (lower id's group, ascending) is started and, once it's waiting
     (`lockWaiters(1)`), the raw connection locks the lower id too, closing an AB-BA cycle;
     asserts exactly one side gets a 40P01/deadlock error. Part B: the same shape but the raw
     connection locks the lower id *first* (the same ascending order `answer` uses) — asserts no
     deadlock and both rows end up `'answered'`.
   - **Red-without-fix proof**: ran Part A once with item 1's `.orderBy(teacherQuestions.id)`
     removed from `open`'s lock. It did not actually change Part A's own result — Part A drives
     both sides through a raw connection plus `answer`'s existing (already-ordered) group lock, so
     it was never going to exercise `open`'s ordering directly; `open`'s `FOR KEY SHARE` lock
     mode structurally can't build a live, provable AB-BA cycle against `answer`'s `FOR UPDATE`
     lock through the real `open()` call without winning an unwinnable sub-millisecond race, and
     Postgres's small unordered `IN (...)` row order isn't something a test can force from the
     outside. Part A proves the *deadlock shape* (two multi-row locks on the same table, taken in
     opposite order, deadlock) and Part B proves that the *ascending* order `answer` and (after
     this fix) `open` both use does not — together they are the closest deterministic proof of
     item 1's reasoning this suite can force; they do not, and cannot, toggle on `open`'s own
     `.orderBy` line specifically. Said here plainly rather than claimed otherwise.
3. **LOW (stale JSDoc + formatting, item 3).** `answer`'s JSDoc step 1 now describes the current
   order (unlocked peek → agent row `FOR NO KEY UPDATE` → group members locked ascending by id in
   one statement), not the old single-row-then-group description. Ran `prettier --write` on
   `teacher-questions.ts` and `question-similarity.ts` for the two unformatted lines the reviewers
   flagged; prettier also reformatted a couple of nearby lines (wrapping some multi-line
   statements) — unrelated behaviour change, purely formatting.
4. **LOW (unreachable ternary, item 4).** `question-similarity.ts`'s `bestGroup` no longer branches
   on a zero-set case for its `score` denominator: `shared >= MIN_SHARED_TERMS` (2) already implies
   `ta` and `tb` are both non-empty, so the union can never be zero. Removed the dead branch,
   replaced with a comment saying why.
5. **LOW (index wording, item 5).** Corrected the `README.md` and this handoff's `**Index (task
   5.10b)**` wording and Decision 2: the new index serves only `open`'s grouping read
   (`(teacher_id, agent_id, status = 'open')` + `created_at` order); `listGroupsForTeacher` has no
   `agent_id` predicate in its own scan, so it can't use this index's prefix and was never served
   by it — the original handoff's claim that it also sped up `listGroupsForTeacher` was wrong.

**Coverage note (not one of the 5 items, found while gating).** Prettier's reformat of the
`if (!members.some(...)) throw ...;` guard (item 3) split it from one line to two, which broke
the pre-existing `/* v8 ignore next */` directive sized for exactly one line; and removing the old,
luck-timed `"two concurrent answers ... without a 40P01 deadlock"` test (item 2) stopped
coincidentally covering the `!memberIds.includes(peek.id)` not-found guard (a few lines above),
which the deterministic rewrite no longer happens to hit by design. Fixed by widening the first
ignore directive to `v8 ignore next 2` and adding a new, equally-honest `/* v8 ignore next */`
directive on the second guard explaining why it's a real but sub-millisecond, scheduler-dependent
race that the item 2 rewrite deliberately no longer forces. `src/repositories/**` aggregate is back
to 100% statements/functions/lines, 98.32% branches (threshold 90%).

Status: DONE

Tool calls used: ~55 (this continuation) + prior session (see earlier handoff notes); counted from
this agent's own log, approximate given the conversation was resumed from a summary.

## Decisions

### 22 Oct 2026 · 5.10b teacherQuestions.answer lock order and trimmed answer · decided by builder · risk: high
- Decided: `answer()` takes the agent lock (`for('no key update')`, same order as `open`) before
  locking the group's open members in one statement ordered ascending by id
  (`WHERE id = ANY(memberIds) ORDER BY id FOR UPDATE`); both the thread message and
  `teacher_questions.answer` store the same trimmed text.
- Why: two concurrent `answer()` calls on different members of one group could deadlock (40P01)
  under the old single-row-then-unordered-group lock; a consistent lock order removes the AB-BA
  cycle, and the agent lock closes the narrower "opened mid-answer" race the 5.10 review flagged.
  Storing the trimmed text in both places keeps the thread message and the answer record
  byte-identical.
- risk: high (touches `packages/db/src/repositories/**`). Needs `database-reviewer` and
  `security-reviewer`.

### 22 Oct 2026 · 5.10b additive migration for teacher-questions grouping index · decided by builder · risk: low
- Decided: migration `0025_teacher_questions_grouping_index.sql` adds
  `teacher_questions_teacher_id_agent_id_status_created_at_idx` on
  `(teacher_id, agent_id, status, created_at)`, additive only (`CREATE INDEX`).
- Why: `open`'s grouping read filters on exactly this `(teacher, agent, open)` triple and sorts by
  recency; this index covers that read instead of falling back to the existing
  `(teacher_id, status)` index plus a filter on `agent_id`. (Fix round: corrected — this index does
  not serve `listGroupsForTeacher`, which has no `agent_id` predicate and so can't use this index's
  prefix.)
- risk: low (additive index, no behaviour change). Needs `database-reviewer`.

### 22 Oct 2026 · 5.10b unique partial session index not added · decided by builder · risk: medium
- Decided: did not add the unique partial index on open sessions per `(teacher, student, agent)`
  that the plan's item 3 asked for.
- Why: `sessions.create` (`packages/db/src/repositories/sessions.ts`) has no check for an existing
  open session before inserting, and its only caller, `apps/web/src/turn/routes.ts`'s
  `startSession` handler, calls it unconditionally on every request with no prior lookup. Two open
  sessions for one `(teacher, student, agent)` triple can exist today, so a unique index on that
  triple would make some existing, currently-successful `startSession` calls fail with a
  constraint violation. The lead's own instruction for this item was to stop and say exactly where
  rather than add the index; fixing `apps/web`'s session-opening logic first is out of this task's
  bounds (no `apps/*` edits).
- risk: medium (a deferred safety net, not a behaviour change — but it means two open sessions for
  one triple remain possible until a follow-up task closes `startSession`'s gap). Needs
  `database-reviewer` to confirm before any follow-up task adds the index.
