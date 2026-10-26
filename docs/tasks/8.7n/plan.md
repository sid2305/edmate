# Plan: 8.7n — 8.7l deferred items (NULL sub-select, start() batching decision, duplicate test)

## Acceptance (verbatim, from `board.py show 8.7n`)

> the NULL case has a test or a comment; the start() batching is decided and logged; one
> scorecard-null test remains; db and web green.

Title (full): `packages/db/src/repositories/publish.ts` `changedSinceLastPublish` outline
sub-select is `NULL` when the teacher has no course (coalesce or a comment that no course reads
as not changed); decide whether publish `start()` may batch its three reads
(`courses.ensureDefault` would then write before a `no_packages` or `no_style_card` failure);
merge the duplicate "No published scorecard yet" tests in
`apps/web/app/teachers/[slug]/page.test.tsx`.

Three independent items, two packages (`@edmate/db`, `@edmate/web`), no shared files with any
other running task (8.7l is merged; its own deferred-items note in
`docs/tasks/8.7l/handoff.md` names exactly these three).

## Item 1 — `packages/db`: `changedSinceLastPublish` NULL-course fix (TDD)

`packages/db/src/repositories/publish.ts`, the `changedSinceLastPublish` SQL (current lines
~827-875): the outline-change clause is
```sql
or last.published_at < (
  select courses.updated_at from courses
  where courses.teacher_id = <teacherId>
  order by courses."order" asc, courses.created_at asc, courses.id asc
  limit 1
)
```
If the teacher has zero course rows this sub-select returns `NULL`, so the comparison is `NULL`,
not `false` — unlike every other clause in the `or` chain, which uses `is distinct from` (NULL-
safe: a missing row still compares to a definite `true`/`false`). Today this is masked only by
`result.rows[0]?.changed === true` in JS, which happens to read a top-level `NULL` as `false`,
but a `NULL` inside the `or` can also silently swallow a `true` state in a way that's an SQL
accident, not a decision.

The board task settles the earlier open question (`docs/tasks/8.7l/handoff.md`'s deferred note
only floated `coalesce(..., true)` as one option): **no course reads as "not changed"** — i.e.
`false`, matching the function's own stated default ("`false` when the scope has never
published (nothing to compare)"). Fix: wrap the comparison in
`coalesce(last.published_at < (...), false)` so the SQL is explicit instead of relying on the
JS-side `=== true` coercion, and add a test that exercises it directly (stronger than a comment
alone, and the accept line allows either — a test is cheap here).

### Test first (`packages/db/test/publish.int.test.ts`, inside the existing
`describe('changedSinceLastPublish', ...)` block, new `it`)
- A teacher with a prior published run but **no course row** (the schema has no course-delete
  path today, so this is a synthetic/defensive state — comment the test that way, matching the
  file's existing house style for corrupted-row defensiveness, e.g. the
  `'a corrupted stored row is integrity, never returned'` case at line ~1109). Build it either by:
  (a) deleting the teacher's `modules` row then its `courses` row via `raw.query` for an already-
  `makeTeacher()` + `publish()`-ed teacher, or (b) constructing the teacher and its published
  `eval_runs` row by hand without ever inserting a `courses` row (check which is simpler given
  `modules.course_id`'s FK — (a) must delete `modules` first or the FK blocks the delete).
- Assert `changedSinceLastPublish(scope(t))` resolves to `false` (not a thrown error, not
  `undefined`), with every other basis signal unchanged (style card, packages, material revision
  all match the last run's basis) — isolates the course-NULL path specifically.
- Keep the existing combined test (line ~1148) exactly as is; this is a new, separate `it`.

### Source change
`packages/db/src/repositories/publish.ts`: wrap only the outline-comparison clause in
`coalesce(..., false)`. No other clause changes (the `is distinct from` ones are already
NULL-safe). One-line SQL template change; add a short comment above it recording the "no course
yet reads as not changed" decision so a future reader doesn't have to re-derive it.

## Item 2 — `apps/web`: `start()` batching — decision, not a behaviour change

`apps/web/src/studio/publish.ts`, `start()` (current lines ~121-142) calls, in order:
1. `b.repos.packages.listForTeacher(scope)` → returns `no_packages` (409) if empty, **before**
2. `b.repos.styleCards.latest(scope)` → returns `style_card_required` (409) if null, **before**
3. `b.repos.courses.ensureDefault(scope)` — this one **writes** (creates a default course row if
   the teacher has none) and is called last, only after both failure checks have passed.

Batching 1-3 with `Promise.all` would let `ensureDefault`'s write race ahead of (or complete
before) the `no_packages`/`style_card_required` checks, creating a default course even when the
request is about to fail for an unrelated reason — a side effect that happens today only on the
success path. That's the exact risk the board title names.

**Decision (to log, not a human question — this is what the board line already points at):
keep the three reads sequential.** The code already does this (it's not calling `Promise.all`
today); the task is to confirm there is no accidental regression opportunity here, document why,
and close the open question from `docs/tasks/8.7l/handoff.md`'s "Left to do". No batching is
"clearly safe" because one of the three is a write with an observable side effect gated on the
other two succeeding first — that gating is the whole point of the current order.

### Change
- Add a short comment directly above the three calls in `start()` recording this: sequential by
  design, `ensureDefault`'s write must stay gated behind the `no_packages`/`style_card_required`
  checks, batching was considered and rejected (cites this task).
- No behaviour change, so no new test is required for this item. Run the existing
  `apps/web/src/studio/publish.test.ts` unedited to confirm nothing regresses (it shouldn't,
  since nothing executable changes).
- Log the decision in the handoff's `## Decisions` section (risk: low — it's a "don't do X"
  decision with no code-behaviour change) so `board.py set 8.7n done` and the digest pick it up.

## Item 3 — `apps/web`: merge the duplicate scorecard-null test

`apps/web/app/teachers/[slug]/page.test.tsx`:
- Line ~164-169: `'shows the "no published scorecard yet" panel when publicScorecard returns
  null'` — relies on the `beforeEach`'s default `state.publicScorecard.mockResolvedValue(null)`
  (line 104); asserts `publicScorecard` was called with `{ agentId: 'agent-1' }`, the "Teaching
  scorecard" heading, and the "No published scorecard yet." text.
- Line ~180-186: `'never renders a scorecard for a draft (not live) agent -- publicScorecard
  returns null'` — redundantly re-sets the same `mockResolvedValue(null)` and asserts only the
  "No published scorecard yet." text, with a comment explaining `publicScorecard` itself filters
  on `agents.status = 'live'` so a draft agent's run never qualifies.

Same mock state, same assertion value, nothing exercised differently. Merge into one test: keep
the first test's name and its `publicScorecard` call-arguments assertion (the more complete
check), fold in the second test's draft-agent comment (it's the better explanation of *why*
`null` is the right default to assert against), and drop the second `it` block entirely. Net:
one scorecard-null test, matching the accept line ("one scorecard-null test remains").

### Test change
- No new behaviour, no TDD red step — this is a pure test-file cleanup. Run the file after the
  edit (`vitest run app/teachers/[slug]/page.test.tsx` or the full `--filter=@edmate/web test`)
  to confirm the suite is still green and test count dropped by exactly one.

## Files touched
- `packages/db/src/repositories/publish.ts` (edit: one `coalesce(..., false)` wrap + comment)
- `packages/db/test/publish.int.test.ts` (edit: one new `it` in the `changedSinceLastPublish`
  block)
- `apps/web/src/studio/publish.ts` (edit: comment only, no logic change)
- `apps/web/app/teachers/[slug]/page.test.tsx` (edit: merge two `it` blocks into one)

No new files. No migration. No contracts change. No docker compose (the `packages/db` suite
uses the existing Postgres test harness per `packages/db/test/pg.ts`, started the same way
`publish.int.test.ts` already starts it — `postgresUp`).

## Files out of bounds
- `apps/web/src/studio/publish.test.ts`, `publishClient.ts/.test.ts`, `publishRuntime.ts` — not
  touched; item 2 only adds a comment to the already-sequential code, no behaviour change to
  verify there.
- `apps/web/app/teacher/page.tsx` / `page.test.tsx` (the singular `/teacher` page) — that's a
  different file from `teachers/[slug]/page.tsx`; already covered in 8.7l, out of scope here.
- Any `packages/db` migration file — this is a query-logic fix, not a schema change.
- `.claude/**`, `.github/**`, `docs/adr/**`, `packages/contracts/**` — not needed.

## Tests first
1. Item 1: write the new `changedSinceLastPublish` no-course `it` in
   `packages/db/test/publish.int.test.ts` first, confirm it fails red against the unpatched SQL
   (today's code would either throw on the synthetic setup or — more likely — already read as
   `false` by accident via the JS `=== true` coercion, so the red step may need to assert against
   the *explicit* SQL path instead: temporarily check `result.rows[0]?.changed` is `null` pre-fix
   if the top-level JS coercion already masks it, then switch to asserting `false` post-fix).
   Note this nuance in the test's own comment so a future reader isn't confused about why the
   test wasn't trivially red/green.
2. Then apply the `coalesce(..., false)` source change; confirm green.
3. Item 2: no test to write (no behaviour change) — add the comment, run the existing
   `publish.test.ts` suite to confirm unchanged/green.
4. Item 3: merge the two `it` blocks, run the file, confirm test count is one fewer and the
   merged test still passes.

## Risky paths touched
Checked against `.claude/skills/merge-gate/risk-paths.txt`:
- `packages/db/src/repositories/publish.ts` and `packages/db/test/publish.int.test.ts` match
  `packages/db/src/repositories/**`'s containing group (file line 40, reviewers group header line
  31: `# reviewers: security-reviewer`). **Required reviewer: `security-reviewer`.** (The test
  file itself isn't under `src/repositories/**`, but the source file is, so the group's reviewer
  requirement applies to this PR.) Recommend also asking `database-reviewer` to look at the raw
  SQL change (it's a hand-written `sql\`...\`` template, not drizzle query-builder code) even
  though risk-paths.txt doesn't mandate it for this group — `database-reviewer` isn't
  gate-enforced here, but it's the right second pair of eyes on raw SQL semantics.
- `apps/web/src/studio/publish.ts`, `apps/web/app/teachers/[slug]/page.test.tsx`: neither matches
  any `apps/web`-adjacent risk group (`apps/web/app/api/webhooks/**`, `apps/web/src/auth/**`,
  `apps/web/app/api/auth/**`, `apps/web/app/api/staff/**`). No reviewer requirement from
  risk-paths.txt for these two files.
- This PR is `risk: high` per the board task's own `risk: high` field — log a `risk: high`
  decision in the handoff regardless of the above (per CLAUDE.md rule 6), naming
  `security-reviewer` as the required reviewer for the `packages/db` group.

## Open questions
None blocking. Two judgement calls the plan already makes explicitly (so the builder doesn't
re-litigate them):
- NULL-course semantics: "not changed" (`false`), per the board task title, settling 8.7l's
  open-ended note.
- `start()` batching: keep sequential, document why, no code behaviour change.

## Gate commands
```bash
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/db
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/web
python3 .githooks/secret-scan.py --all
```

## Budget: 25 tool calls (1 phase, two packages: @edmate/db, @edmate/web)

## Allowed tools
Read, Grep, Glob, Edit (no new files needed — all three items are edits to existing files),
Bash (gate commands above, Postgres test harness via existing `pg.ts` helpers, secret scan only;
no docker compose, no migrations).

## Exit conditions
`Status: DONE` when: the new `changedSinceLastPublish` no-course test passes against the
`coalesce(..., false)` fix; the `start()` comment is in and `apps/web/src/studio/publish.test.ts`
is unchanged-green; the duplicate scorecard-null test is merged to one with the suite green; both
gate commands above are green; secret scan is clean. `Status: PARTIAL` past ~25 tool calls, or if
fixing item 1 turns out to need a `packages/db` migration or schema change (stop and hand back —
that's a bigger change than this task's scope), or if the synthetic no-course test setup hits an
FK constraint that needs a schema-level workaround rather than a test-data workaround.
