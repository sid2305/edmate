# 8.7k handoff

## Summary

Adds `publish.changedSinceLastPublish(scope)`, a teacher-scoped boolean read: true when
anything has changed since the scope's last published (passed, published) gate run, false
when the scope has never published. One SQL round trip (a CTE) comparing the last run's
`basis` against the current state of four signals:

- style card: newest card's id vs `basis.styleCardId`
- packages: a `package id -> max version` map (newest version per package) vs
  `basis.packageVersions`, relying on Postgres jsonb's own key-order-independent equality
  instead of the JS `canonical()` helper
- uploads: the teacher's material revision counter (bumped on every create, replace *and
  delete* -- so a deleted upload counts as a change too) vs `basis.materialRevision`
  (coalesced to 0 when no row exists yet)
- outline: the course's `updated_at` against the run's `published_at` -- more sensitive than
  the gate's own `material` change kind (see Decisions)

Surfaced as a dismissive-free status note ("You've made changes since your last publish.")
on `/teacher` (home) and `/teacher/publish` (run detail), both reading the signal from the
signed-in teacher's own scope, never a request field.

## Files

- `packages/db/src/repositories/publish.ts` -- new method (risky path, see Decisions)
- `packages/db/test/leak.test.ts` -- one call added to the leak-scrub grid
- `packages/db/test/repositories.int.test.ts` -- `seedChangedSincePublish` helper + one
  isolation-grid CASES entry (append only)
- `packages/db/test/publish.int.test.ts` -- new `describe('changedSinceLastPublish', ...)`:
  false with no run, true after each basis signal changes independently, false again once a
  republish picks them all up, false for another teacher's own (unpublished) scope, `scope`-kind
  failures on a malformed id
- `apps/web/src/studio/publish.ts` -- `latest` handler reads the flag once and includes it as
  `changedSincePublish: boolean` on the run view
- `apps/web/src/studio/publish.test.ts`, `publishRuntime.test.ts` -- fixtures + a round-trip test
- `apps/web/src/studio/publishClient.ts` -- `RunSchema.changedSincePublish: z.boolean()`
- `apps/web/app/teacher/publish/PublishView.tsx`, `.test.tsx` -- shows the note when true (axe
  clean both ways)
- `apps/web/app/teacher/view.tsx`, `.test.tsx` -- same note, optional `changedSincePublish` prop
  (default `false`)
- `apps/web/app/teacher/page.tsx` (new), `page.test.tsx` (new) -- reads the signed-in teacher's
  own flag via `serverDatabase()` after `requireRole(['teacher'])`, and renders `TeacherView`
  by awaiting it directly (same pattern as `ageGateView`) rather than as async JSX, since
  React Testing Library/jsdom doesn't support async Server Components as JSX children
- `apps/web/messages/en.json` -- `publish.changedNote` (one new key, appended)

No migration, no schema edit: everything the signal needs (style cards, packages/versions,
`teacher_material_revisions`, `courses.updated_at`, `eval_runs.basis`/`published_at`) already
exists.

## Tests

- `packages/db` -- 26/26 turbo tasks (typecheck, lint, test with coverage), full suite against
  a disposable `pgvector/pgvector:0.8.1-pg16` container I started and removed myself (name
  `pg-87k-test`, port 55491); 100% coverage on `src/repositories/**`
- `apps/web` -- 34/34 turbo tasks (typecheck, lint, test with coverage), full suite including
  snapshots
- `python3 .githooks/secret-scan.py --all` -- clean

## How it is shown

A plain `role="status"` paragraph, no dismiss control, shown only when the flag is true; both
`/teacher` and `/teacher/publish` read it from the same repository method.

## Decisions

### 22 Oct 2026 · 8.7k changed-since-publish teacher-scoped read · decided by builder · risk: high
- Decided: `publish.changedSinceLastPublish` lives in the risky path
  `packages/db/src/repositories/publish.ts`. It takes a `TeacherScope`, goes through
  `teacherScope(scope, method)` like every other method in the file, and returns only a
  boolean -- never another teacher's row, id or text. The query's five SELECTs (style card,
  material revision, packages, outline, and the `last` CTE itself) are all filtered by the
  same resolved `teacherId`.
- Why: any new read on `publish.ts` needs the same scrutiny as the rest of the file (e.g.
  `latestRun`, `failedCases`) that could leak cross-teacher data if a filter were dropped.
  `security-reviewer` should confirm each of the five sub-selects is teacher-filtered and
  that the leak-scrub test (`leak.test.ts`) covers this call.
- risk: high

### 22 Oct 2026 · 8.7k outline signal uses course updated_at, not a stored basis field · decided by builder · risk: medium
- Decided: the outline ("material") signal compares `courses.updated_at` (the earliest course
  by `order`/`createdAt`/id, matching `latestRun`'s own tie-break) against the last run's
  `published_at`, rather than against a value stored in `PublishBasis`.
- Why: `PublishBasis` (packages/contracts) has no outline/course-version field today, and
  adding one needs a migration-free schema change to the basis shape plus an ADR-level look at
  every writer of `basis` -- out of scope for this task's "no migration, no schema edit" rule.
  The timestamp comparison is intentionally *more* sensitive than the gate's own `material`
  change-kind check (which only looks at upload/package changes): an outline edit with no
  upload or package change still flips this flag, even though the gate itself might not call
  that a `material` change. This is a deliberate asymmetry -- the note is informational ("you
  might want to republish"), not a claim that the *gate* would re-flag the run as changed.
- risk: medium

### 22 Oct 2026 · 8.7k material revision counts deletes · decided by builder · risk: low
- Decided: the uploads signal reuses `teacher_material_revisions.revision`, the same counter
  `chunks.ts`'s `bumpRevision` increments on every create, replace, *and delete* of a teacher's
  material.
- Why: a delete with no replacement upload is still a content change the teacher should know
  about before republishing; reusing the existing counter avoids a second signal column and
  keeps the query to one round trip.
- risk: low

## Left to do

Nothing outstanding for this task's scope.

Status: DONE
Tool calls used: 112
