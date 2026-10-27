# Plan: 6.2a — 6.2 review follow-ups on learner.ts

## Acceptance (verbatim from board)

> rebuild time for a long history is bounded and tested; no non-null assertions left in
> learner.ts.

Board title (context, not separately gated): "6.2 review follow-ups (6.5 also needs the index,
for evidenceEvents.list ORDER BY ts, id: make it (teacher_id, student_id, ts, id)): before any
operational rebuild trigger, cap or batch rebuildMastery's replay and add a (teacher_id,
student_id, ts) index so the profile row lock is not held over a long unbounded scan; explicit
guard instead of `locked!` in applyEvidenceMastery; doc note that a rebuild is a snapshot as of
lock acquisition; the isolation-grid case's Date.now()-based ts depends on isolation-seed's
evidence row having no explicit ts."

How this will be shown: the handoff pastes the green
`corepack pnpm turbo run typecheck lint test --filter=@edmate/db` output, quotes the new
`profile-store.int.test.ts` test name that spans multiple `REBUILD_PAGE_SIZE` pages and asserts
the folded count (not wall-clock), and confirms (one `grep -n '!\.' packages/db/src/repositories/learner.ts`
or equivalent) that no non-null assertion remains.

## Context already answered (board + 6.2 review + 13.regatea — do not re-ask)

- 6.2 review (`docs/tasks/6.2/review.md`) is the source of every item in this task except the
  `evidenceEvents.list` index reuse, which the board title adds.
- The last deferred bullet (isolation-grid's `Date.now()`-based `ts`) is background explaining an
  existing test (`packages/db/test/repositories.int.test.ts` lines ~1778-1805), not an action
  item: it already works today and batching the replay inside the same transaction changes no
  observable ordering, so that test needs no edit. Confirmed by reading it.
- 13.regatea (`docs/tasks/13.regatea/plan.md`, merged) is the exact mechanism for the new index:
  schema-only declaration + a comment-only migration file + a `POST_MIGRATE_STEPS`
  `concurrentIndex` entry in `packages/db/src/migrate.ts`, because `evidence_events` is a
  high-write table and a plain migration-file `CREATE INDEX` would hold its `ACCESS EXCLUSIVE`
  lock for the whole build.
- Next free migration number: `0039` (highest on main is `0038_eval_runs_gate_passed_index.sql`;
  builder re-confirms against `packages/db/migrations/` right before creating the file, same as
  13.regatea's lead answer).

## Design

### 1. New index: `evidence_events_teacher_id_student_id_ts_id_idx`

Covers both `rebuildMastery`'s replay (`where teacher_id = ? and student_id = ? order by ts, id`)
and `evidenceEvents.list`'s export read (same filter and order) — one index, no partial predicate
needed (both reads already filter by equality on both columns, not a subset).

- `packages/db/src/schema/learning.ts`: add to `evidenceEvents`'s `(t) => [...]` array (same style
  as the `sessions`/`messages` 0035 entries at lines ~100-103 and ~131-134):
  ```ts
  // Task 6.2a (6.2 review deferral; board title also names evidenceEvents.list's ORDER BY ts, id):
  // rebuildMastery's keyset-paged replay and evidenceEvents.list's export read share this same
  // teacher_id/student_id filter plus (ts, id) order; one index covers both. Declared here so
  // `db:generate` stays a no-op; built by the post-migrate step (migrate.ts, migration 0039) with
  // CREATE INDEX CONCURRENTLY (evidence_events is append-only but grows unbounded over a pilot).
  index('evidence_events_teacher_id_student_id_ts_id_idx').on(t.teacherId, t.studentId, t.ts, t.id),
  ```
- `packages/db/migrations/0039_evidence_events_ts_id_index.sql`: comment-only, modeled word-for-word
  on `0038_eval_runs_gate_passed_index.sql`'s style, naming this one index and this task.
- `packages/db/src/migrate.ts`: append to `POST_MIGRATE_STEPS` (after the `eval_runs...` entry):
  ```ts
  // Migration 0039 (task 6.2a, 6.2 review deferral): learnerProfiles.rebuildMastery's keyset-paged
  // replay and evidenceEvents.list's export read.
  {
    kind: 'concurrentIndex',
    indexName: 'evidence_events_teacher_id_student_id_ts_id_idx',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "evidence_events_teacher_id_student_id_ts_id_idx" ON "evidence_events" USING btree ("teacher_id","student_id","ts","id")`,
  },
  ```
  and extend the doc comment paragraph above `POST_MIGRATE_STEPS` (the one listing migrations
  0009...0038) with one more sentence for 0039, same pattern every prior entry used.
- `packages/db/test/migrate.test.ts`: append one more object to the `concurrentIndex` `toEqual`
  array (after the `eval_runs_gate_passed_agent_id_published_at_id_idx` entry, around line 254),
  same `expect.stringContaining('CREATE INDEX CONCURRENTLY IF NOT EXISTS')` shape as its plain
  (non-partial) neighbours (e.g. `sessions_created_at_idx`).

### 2. Batch `rebuildMastery`'s replay (keyset pages, same transaction/lock)

Add an exported page-size constant above `learnerProfilesRepo`:
```ts
/** Rows per page in `rebuildMastery`'s keyset-paged replay (task 6.2a, 6.2 review deferral):
 * bounds memory and per-query cost for a long evidence_events history. The whole loop still runs
 * inside rebuildMastery's one transaction, under the same profile-row lock applyEvidenceMastery/
 * appendAndFold already take for the same scope — paging bounds memory and query size, not the
 * lock's duration, which must still span the whole replay for correctness (a concurrent writer
 * must never observe a partial read, same serialisation this file's other methods already rely
 * on). */
export const REBUILD_PAGE_SIZE = 1_000;
```
Replace the single `orderBy(...).` select (no `.limit`) inside `rebuildMastery`'s transaction with
a loop, folding page by page (`foldMastery` already folds sequentially onto whatever mastery is
passed in, so folding per page in increasing `(ts, id)` order gives the identical result to one
big fold — no behaviour change, just bounded page size):
```ts
let next: LearnerProfile['mastery'] = {};
let cursor: { ts: Date; id: string } | undefined;
for (;;) {
  const rows = await tx
    .select({
      topicId: evidenceEvents.topicId,
      correct: evidenceEvents.correct,
      ts: evidenceEvents.ts,
      id: evidenceEvents.id,
    })
    .from(evidenceEvents)
    .where(
      and(
        eq(evidenceEvents.teacherId, sc.teacherId),
        eq(evidenceEvents.studentId, sc.studentId),
        ...(cursor
          ? [sql`(${evidenceEvents.ts}, ${evidenceEvents.id}) > (${cursor.ts}::timestamptz, ${cursor.id}::text)`]
          : []),
      ),
    )
    .orderBy(asc(evidenceEvents.ts), asc(evidenceEvents.id))
    .limit(REBUILD_PAGE_SIZE);

  if (rows.length === 0) break;
  next = foldMastery(
    next,
    rows.map((r) => ({ topicId: r.topicId, correct: r.correct, ts: r.ts.toISOString() })),
  );
  const last = rows[rows.length - 1];
  /* v8 ignore next */
  if (!last) break; // unreachable: rows.length > 0 just checked; an explicit guard, not `!`.
  cursor = { ts: last.ts, id: last.id };
  if (rows.length < REBUILD_PAGE_SIZE) break;
}
```
Keep everything else in `rebuildMastery` (the insert-default-row, the `FOR UPDATE` lock select, the
final `UPDATE` and `return toLearnerProfile(...)`) unchanged, just using `next` from the loop
instead of one `foldMastery({}, rows.map(...))` call. If the explicit `::timestamptz`/`::text`
casts on the parameterised side of the row comparison turn out unnecessary (node-postgres may
infer them from the left-hand columns), the builder may drop them — keep whichever compiles and
passes; note the choice in the handoff if changed.

Extend `rebuildMastery`'s doc comment with the snapshot note the board title asks for, e.g.: "A
rebuild is a snapshot as of lock acquisition: it replays whatever `evidence_events` rows existed
at the moment the profile row's `FOR UPDATE` lock was taken: a concurrent `append`/`appendAndFold`
for the same scope is either fully visible (if it committed first) or not visible at all (if it is
still waiting on this lock) — never partially, same serialisation this method's existing doc
comment already argues from the other side."

### 3. `applyEvidenceMastery`: explicit guard instead of `locked!`

Line ~262 today:
```ts
const next = foldMastery(locked!.mastery, events);
```
becomes (same shape as this method's own `owned.length !== topicIds.length` check two lines above,
and as `rebuildMastery`'s own `if (!locked) throw ...` a few lines below it in this same file):
```ts
/* v8 ignore next */
if (!locked) throw new RepositoryError('scope', method);
const next = foldMastery(locked.mastery, events);
```
After this and the loop above, `grep -n '!\.' packages/db/src/repositories/learner.ts` (or `!)`)
should return nothing — confirm this in the handoff.

### 4. No other code changes

`evidenceEvents.list` and `.append`/`.appendAndFold` need no code change — they already filter and
order exactly as the new index covers; they simply get faster/cheaper once it exists.

## Files to create

- `packages/db/migrations/0039_evidence_events_ts_id_index.sql` — comment-only migration.

## Files to modify

- `packages/db/src/schema/learning.ts` — add the index to `evidenceEvents`'s index array.
- `packages/db/src/migrate.ts` — add the `POST_MIGRATE_STEPS` entry; extend its doc comment.
- `packages/db/test/migrate.test.ts` — append the new `concurrentIndex` entry.
- `packages/db/src/repositories/learner.ts` — `REBUILD_PAGE_SIZE`, the keyset-paged replay loop,
  the snapshot doc note, and the `applyEvidenceMastery` explicit guard.
- `packages/db/test/profile-store.int.test.ts` — one new `it` (see Tests first) that spans
  multiple pages; no edit to the three existing `rebuildMastery` tests (they still pass unchanged,
  since the fold result is identical, just computed in pages).

## Files out of bounds

- `packages/db/src/repositories/index.ts`, `packages/db/src/repositories/ingestSweep.ts` (new),
  `packages/db/src/repositories/reports.ts`, anything under `apps/worker`, `apps/web` — another
  builder's concurrent task.
- `packages/db/test/repositories.int.test.ts` — read-only reference (confirmed above the
  isolation-grid `rebuildMastery`/`applyEvidenceMastery` cases need no change); do not edit it.
- `packages/db/test/migrate.int.test.ts` — its own `POST_MIGRATE_STEPS` describe block only names
  the 13.4a retention indexes; this task's new entry needs no change there (13.regatea precedent).
- `packages/db/src/repositories/chunks.ts`, `outline.ts`, `map.ts` — another builder's concern
  (13.3b / 12.2f lineage); untouched here.

## Tests first

1. Confirm (no edit) that `packages/db/test/repositories.int.test.ts`'s `rebuildMastery` and
   `applyEvidenceMastery` isolation-grid cases still describe the current behaviour after reading
   them; re-run that file at the end to prove they still pass unedited.
2. `packages/db/test/migrate.test.ts`: add the new `concurrentIndex` array entry — confirm it fails
   against current `POST_MIGRATE_STEPS` (missing entry) before adding the step.
3. `packages/db/test/profile-store.int.test.ts`: add one new `it` near the existing `rebuildMastery`
   tests (after the "matches the pure fold" case, ~line 381): bulk-insert
   `2 * REBUILD_PAGE_SIZE + 37` (or similar, deliberately not a multiple of the page size, spanning
   3 pages) `evidence_events` rows for one fresh scope via one raw SQL `insert ... select ... from
   generate_series(1, N)` (fast, no per-row JS insert — model the bulk-insert shape on
   `teacher-profiles-pending-index.int.test.ts`'s `generate_series` pattern), each with a distinct
   `ts` (e.g. `now() + (gs * interval '1 millisecond')`) so `(ts, id)` ordering is well-defined;
   call `rebuildMastery`; assert the result's `mastery[topicId].n === N` and its `.p` matches
   `foldMastery({}, events)` computed from the same event list fetched back in Postgres order
   (reuse the existing test's `foldMastery`/hand-fold comparison idiom at lines ~337-355) — this
   bounds correctness by **count across page boundaries**, not wall-clock, catching an off-by-one
   at a page edge that a small fixture would miss. Confirm this test fails before the loop exists
   (times out or is simply absent) and passes after.
4. Add the schema index, migration file and `POST_MIGRATE_STEPS` entry; re-run `migrate.test.ts`
   and the new `profile-store.int.test.ts` case — green.
5. Apply the `rebuildMastery` batching loop and the `applyEvidenceMastery` guard; re-run the whole
   `profile-store.int.test.ts` and `repositories.int.test.ts` files — green, unedited elsewhere.
6. `grep -n '!\.' packages/db/src/repositories/learner.ts` (and a look for any bare `!)`/`]!`) —
   empty.
7. Full gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/db`, green. Prettier and
   the secret scan clean.

## Risky paths checked (`.claude/skills/merge-gate/risk-paths.txt`)

- `packages/db/src/repositories/learner.ts` matches `packages/db/src/repositories/**` (the "access
  filter / money / sign-in / data isolation" group) → **security-reviewer** required.
  code-reviewer is required on every PR regardless. Following the established precedent for
  repository lock/scope changes on this same risk path (6.5a, 8.5a, 8.6b, 8.3a reviews), this plan
  also asks for **database-reviewer** (lock behaviour and the new index) and **typescript-reviewer**
  (the keyset cursor typing and the removed non-null assertion), so `review.md`'s `Reviewers:` line
  should read: code-reviewer, security-reviewer, database-reviewer, typescript-reviewer.
- `packages/db/src/schema/learning.ts`, `packages/db/src/migrate.ts`,
  `packages/db/migrations/0039_evidence_events_ts_id_index.sql`,
  `packages/db/test/migrate.test.ts`, `packages/db/test/profile-store.int.test.ts` — none match any
  listed glob (same conclusion 13.regatea reached for the equivalent files); the migrations note
  ("migrations that drop or delete data are risky") doesn't apply — this migration is comment-only
  and additive.
- Because `packages/db/src/repositories/**` is touched, this task plans a `risk: high` decision
  entry at merge (per the lead's standing merge policy), naming the four reviewers above.

## Open questions

None — the board, the 6.2 review and 13.regatea's merged precedent answer every design choice
(index shape and build mechanism, batching vs. capping, lock order, reviewer set). The only
implementation-level judgment call (explicit `::timestamptz`/`::text` casts on the keyset
comparison's parameter side) is left to the builder with an explicit fallback above, not a
decision that needs the human.

## Budget

Budget: 50 tool calls (1 phase, packages/db only)

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (pnpm typecheck/lint/test for @edmate/db, prettier --check,
secret-scan.py --all; no other shell use needed)

## Exit conditions

- **DONE**: the index (schema + migration + post-migrate step), `rebuildMastery`'s keyset-paged
  loop, `applyEvidenceMastery`'s explicit guard and the snapshot doc note all land; the new
  multi-page `profile-store.int.test.ts` case and the updated `migrate.test.ts` are green; the
  existing `repositories.int.test.ts` isolation-grid cases pass unedited; `grep -n '!\.'
  packages/db/src/repositories/learner.ts` is empty; the full `@edmate/db`
  `typecheck`/`lint`/`test` gate is green; prettier and the secret scan are clean; the handoff logs
  a `risk: high` decision naming the four reviewers.
- **PARTIAL**: past ~50 tool calls with the index/migration/step done but the multi-page test still
  flaky or failing after two attempts at the keyset comparison's typing; or any file outside this
  plan's list (e.g. `repositories.int.test.ts` or `migrate.int.test.ts`) turns out to need a change
  — stop and hand back rather than touching it.

## Lead answers (27 Oct 2026)
- No open questions; the plan stands. Migration 0039 is the next free number (0038 is 13.regatea's); check again before writing it and take the next free number if main moved.
- Reviewers at review: security-reviewer, code-reviewer, database-reviewer, typescript-reviewer; the lead logs risk: high for packages/db/src/repositories/learner.ts.
- Gate dependents: `corepack pnpm turbo run typecheck lint test --filter=...@edmate/db` (db and every package that depends on it).
