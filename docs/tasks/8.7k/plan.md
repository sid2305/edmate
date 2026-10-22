# Plan: 8.7k "changed since last publish" note on /teacher/publish and the studio home

Status: READY.

Board: `8.7k` (M8). Deps: 8.7d (merged). Spec: 8.7 plan Q10 / lead answer Q10 ("studio shows a
'changed since last publish' note"; automatic re-gating stays board task `13.regate`).

## Acceptance (verbatim) and how it will be shown

> a teacher who edits after a publish sees the note; after a new publish it is gone. A component
> test for both, with jest-axe.

| Clause | How it is shown |
| --- | --- |
| sees the note after an edit | `PublishView.test.tsx`: given a passed run with `changedSincePublish: true`, the note renders; `jest-axe` on that state is clean. `view.test.tsx` (studio home): given `changedSincePublish` prop `true`, the note renders; `jest-axe` clean. |
| gone after a new publish | Both test files: `changedSincePublish: false` renders no note, `jest-axe` clean. `packages/db/test/publish.int.test.ts`: `changedSinceLastPublish` is `true` right after an edit (style card, outline, package or upload) and `false` again once a new `goLive` publishes that basis. |

## The signal (one read, no migration)

New teacher-scoped method `publish.changedSinceLastPublish(scope): Promise<boolean>` in
`packages/db/src/repositories/publish.ts`, one SQL round trip (a `with last as (select ... where
status = 'passed' and published_at is not null order by published_at desc limit 1)` CTE joined to
scalar subqueries for the current signals). No rows in `last` (never published) → `false`: nothing
to compare, and the publish page's own "not published yet" state already covers that teacher.
Reuses existing columns only:

- **style card:** `last.basis->>'styleCardId'` (the immutable row id stored at publish time,
  already in `PublishBasis`) vs. the teacher's current `styleCards` newest row id (new version =
  new row = new id, so an id mismatch is exact, no timestamp needed).
- **packages:** `last.basis->'packageVersions'` (already stored) vs. a current `package_id -> max
  version` map built the same way `startRun`'s `pkgRows` query is (canonical-JSON compare, reusing
  the existing `canonical()` helper).
- **uploads (create, replace or delete):** `last.basis->>'materialRevision'` (already stored) vs.
  the current `teacher_material_revisions.revision`. That counter is bumped inside the same
  transaction as every document/chunk create, replace and **delete** (`chunks.ts` `bumpRevision`,
  called from `documents.delete`), so a deleted upload counts as a change already, with no new
  code. State this explicitly in the handoff `## Decisions` (the open question the task names).
  Note for the record: a null/missing `teacher_material_revisions` row (a teacher who never
  uploaded) reads as revision `0`, matching `startRun`'s own `rev?.revision ?? 0`.
- **outline:** *not* in `PublishBasis` today (`startRun`'s own "material" change kind only compares
  `materialRevision` and `courseId`, not `courses.outlineVersion` — an existing gap in the gate's
  own scoping, out of this task). This method instead compares `last.published_at` against the
  teacher's course row's `updated_at`, which `outline.replaceOutline` already bumps
  (`courses.ts`/`outline.ts` line ~338) on every outline write. Pick the course the same way
  `firstCourse()` does (`order` asc, `created_at` asc, `id` asc, limit 1 — MVP one course). Record
  this as a `## Decisions` entry: the note's outline signal is intentionally more sensitive than
  the gate's own scope, because it is informational only, not a gate input.

Teacher-scoped: `teacherScope(scope, method)` throughout, every subquery filtered by `teacherId`
from the scope only (never a request field); a second teacher's edits never flip the first
teacher's flag (int test).

## Files

- `packages/db/src/repositories/publish.ts`: add `changedSinceLastPublish`. No new imports beyond
  what Phase A already imports (`sql`, `styleCards`, `teacherMaterialRevisions`, `courses`,
  `packages`, `packageVersions`, `canonical()`). No migration, no schema change, no new exported
  constants beyond the method itself and (if needed) a narrow return shape — plan default: a bare
  `boolean`, nothing else, so there is nothing new to leak-scrub beyond the existing guard.
- `packages/db/test/publish.int.test.ts`: add a `describe('changedSinceLastPublish', ...)` block:
  false with no published run; false right after a fresh `goLive`; true after a style-card edit,
  an outline edit, a new package version, a new upload, and a deleted upload (separately); false
  again after a second `goLive` whose basis picks up all of those; teacher B's edits never flip
  teacher A's flag; another teacher's scope id is `scope`/empty per the usual pattern.
- `packages/db/test/repositories.int.test.ts`: one line, the isolation `CASES` entry for
  `publish.changedSinceLastPublish` (tsc-enforced list; `leak.test.ts`'s is separate).
- `packages/db/test/leak.test.ts`: one line, the scrub-check entry for the new method.
- `apps/web/src/studio/publish.ts`: widen `PublishBackend['repos']['publish']`'s `Pick` to add
  `'changedSinceLastPublish'`; add `changedSincePublish: boolean` to `PublishRunView`; the `latest`
  handler calls it once (after reading `latestRun`, same `scope`) and sets the field. Returns
  `false` when there is no run at all (nothing published, nothing to compare) same as the repo.
- `apps/web/src/studio/publish.test.ts`: add the fixture method (`async () => <value>`) to every
  fake `repos.publish` object already in the file (so TS compiles) and assert the field round-trips
  on `GET`.
- `apps/web/src/studio/publishRuntime.test.ts`: add the same fixture method to its fake repos (type
  compile only; `publishRuntime.ts` itself needs no change — it passes `serverDatabase().repos`
  through untouched).
- `apps/web/src/studio/publishClient.ts`: add `changedSincePublish: z.boolean()` to `RunSchema`.
- `apps/web/app/teacher/publish/PublishView.tsx`: render the note (own `<p role="status">`, a new
  `publish.changedNote` string) whenever `run !== null && run.changedSincePublish`, in addition to
  (never replacing) the existing status line.
- `apps/web/app/teacher/publish/PublishView.test.tsx`: the note shown/not-shown cases above, each
  with `jest-axe`.
- `apps/web/app/teacher/view.tsx`: `TeacherView` takes a new optional prop
  `{ changedSincePublish?: boolean }` (default `false`, so every existing call site and test keeps
  compiling unchanged) and renders the same note string, reusing the `publish` translations
  already loaded there for the nav link.
- `apps/web/app/teacher/view.test.tsx`: add the note shown/not-shown cases, each with `jest-axe`.
- `apps/web/app/teacher/page.tsx`: after `requireRole`, read
  `serverDatabase().repos.publish.changedSinceLastPublish({ teacherId: principal.userId })` and
  pass it to `<TeacherView changedSincePublish={...} />` (same `serverDatabase()`/`requireRole`
  pattern as `insights/page.tsx`).
- `apps/web/app/teacher/page.test.tsx` (new, small, following `insights/page.test.tsx`'s shape):
  stubs `requireRole` and `serverDatabase`, asserts the teacher-scoped call and that the flag
  reaches `TeacherView`.
- `apps/web/messages/en.json`: one new key, `publish.changedNote` (plain English, no new
  namespace — `PublishView` already loads the whole `publish` bundle via
  `NextIntlClientProvider`, and `view.tsx` already calls `getTranslations('publish')` for the nav
  link, so no new wiring is needed to reach either page).

## Files out of bounds

`packages/contracts/**`, `docs/adr/**`, `packages/evals/**`, `apps/worker/**`, `packages/queue/**`,
`apps/web/src/auth/**`, `apps/web/app/api/studio/packages/**`, `packages/db/src/repositories/
{agents,teacher-profiles,discovery,ports}.ts`, `packages/db/migrations/**` (no migration is
needed; a needed schema change stops this task at PARTIAL), `.claude/**`, `.github/**`.

## Shared files (other builders in flight)

- `apps/web/messages/en.json` is also touched by `9.6c`/`9.6g` (export/notes keys) and other
  parallel builders generally. This task adds exactly one key (`publish.changedNote`) under the
  existing `publish` object; merge main before pushing, re-add the key if a rebase drops it.
- `11.3a` (packages/db: new insights repository, appends to
  `packages/db/src/repositories/index.ts` and `test/repositories.int.test.ts`) and `9.6c`/`9.6g`
  (apps/web) are in flight in other packages/files; this task does not touch
  `packages/db/src/repositories/index.ts` at all (the new method needs no new wiring there — it is
  already exported via `publish: guardAll('publish', publishRepo(db))`) and its one line in
  `test/repositories.int.test.ts` is additive, so a conflict there is a trivial re-add, not a
  logic clash.

## Risky paths touched

Checked every planned path against `.claude/skills/merge-gate/risk-paths.txt`:
- `packages/db/src/repositories/publish.ts` matches `packages/db/src/repositories/**` →
  reviewers: **security-reviewer** (plus code-reviewer, which reviews every PR). No migration, so
  database-reviewer is not required (same reasoning 8.7a used: additive read only, no new column,
  no drop/delete). Handoff logs a `risk: high` decision for this (teacher-scoped read touching the
  risky-path repository file), per rule 6.
- All `apps/web/**` files in this plan: none (checked; `apps/web/src/auth/**` and
  `apps/web/app/api/webhooks/**` etc. are deliberately untouched).

## Tests first

- `packages/db/test/publish.int.test.ts` — red first, per the cases listed under Files above.
- `apps/web/src/studio/publish.test.ts`, `publishRuntime.test.ts` — fixture + field round-trip.
- `apps/web/app/teacher/publish/PublishView.test.tsx`, `apps/web/app/teacher/view.test.tsx`,
  `apps/web/app/teacher/page.test.tsx` — RTL + jest-axe, per the acceptance table above.

Gates: `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` (plus the db int
suite) and `--filter=@edmate/web...` (full suite, snapshots included). Secret scan clean. Commit
green.

## Open questions

None blocking. One judgement call, recorded as a `## Decisions` entry in the handoff rather than
asked up front: the outline signal compares `courses.updated_at` to the last publish's time
(timestamp), while the other three signals compare stored basis values/version ids (exact) — a
deliberate asymmetry because `PublishBasis` has no outline/`courseId`-version field to compare
against, and adding one would need a migration this task avoids.

## Budget

Budget: 70 tool calls (1 phase, packages/db + apps/web)

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (pnpm install/typecheck/lint/test via corepack, db int tests
against the local Postgres, git on the task branch, `python3 .githooks/secret-scan.py --all`). No
network calls to model providers; no `gh pr merge`.

## Exit conditions

- `Status: DONE`: tests written first and green, the filtered turbo runs (typecheck, lint, test,
  snapshots) green for `@edmate/db` and `@edmate/web`, secret scan clean, one green commit, handoff
  with `Tool calls used:`, `## Decisions` (including the `risk: high` entry for the publish
  repository change and the outline-signal asymmetry note above).
- `Status: PARTIAL`: past ~70 tool calls; a file out of bounds needs changes (in particular, if the
  one-read design turns out to need a migration); or a dependency/shared-file conflict can't be
  resolved by a clean re-add. Stop, commit what is green, report what is left.
