# Plan: 8.7l — 8.7d/8.7e/8.7k review follow-ups (apps/web only)

## Acceptance (verbatim, from `board.py show 8.7l`)

> a test where enqueue and finishRun both fail shows an error view within N seconds, not
> "running"; a hung fetch surfaces as pollFailed; failure() uses safeParse.

Full task title lists more follow-ups (8.7e Promise.all merge, duplicate draft-agent test,
8.7k `/teacher` LOW, a packages/db NULL sub-select). Scope below covers the three accept items
plus the two cheapest, lowest-risk extras that fit one apps/web phase; the rest are named
follow-ups (see `## Deferred`), per the task instruction to keep this to one phase, no
packages/db changes.

### How it will be shown
- `publish.test.ts`: a new case where `latest()` is asked for a run that is still `queued`/
  `running` past a stale deadline (the enqueue-then-finishRun-both-fail scenario leaves exactly
  this row) and the GET response is `status: 'error'`, `errorCode: 'stale'`, never `'running'` or
  `'queued'`.
- `publishClient.test.ts` (new file): a fetch that never settles is aborted after the client's
  fixed timeout and resolves to a failure result (status 0) instead of hanging forever — the
  path `PublishView.refresh()` already turns into `pollFailed`/`loadFailed`, so no PublishView
  change is needed, only a client-level test that the promise actually settles.
- `publishClient.test.ts`: `failure()` is exercised with a well-formed error body, a body with an
  extra unknown field (ignored, not merged), and a malformed body (wrong types) — all handled by
  one zod `safeParse`, never a blind cast.
- `teacher/page.test.tsx`: a new case where `changedSinceLastPublish` rejects — the page still
  renders (no note shown), nothing throws, and the error is logged by name only (no message/
  stack text asserted as present).
- `teachers/[slug]/page.tsx`: no new test needed — existing tests in
  `teachers/[slug]/page.test.tsx` (offers, scorecard, scorecard-read-failure, repo-error
  propagation) must still pass unchanged after `offers` and `scorecard` move into one
  `Promise.all`; the builder runs that test file to confirm before moving on, no edits to it in
  scope here.

## Files to create or modify (all apps/web, one package)
1. `apps/web/src/studio/publish.ts` — add `now(): Date` to `PublishBackend`; in `latest()`, treat
   a `queued`/`running` run older than a fixed `STALE_QUEUE_MS` (createdAt vs `b.now()`) as
   `status: 'error'`, `errorCode: 'stale'` in the view only (no extra write, no new repo method —
   stays a read-side fix); `failedCases` is still only asked for a genuinely `'failed'` run.
2. `apps/web/src/studio/publish.test.ts` — extend `memoryBackend`/`Opts` with an optional `now`
   (ISO string, default matching the existing fixture's `createdAt` so every current test stays
   non-stale with no edits); add cases for a stale `queued` run (narrates the enqueue+finishRun-
   both-fail scenario), a stale `running` run, and a fresh `queued` run staying `queued`.
3. `apps/web/src/studio/publishRuntime.ts` — the real backend's `build()` returns `now: () => new
   Date()` alongside the existing fields; no behaviour change to existing tests (they don't do an
   exact-shape equality check on the built backend).
4. `apps/web/src/studio/publishClient.ts` — add a module `FETCH_TIMEOUT_MS` constant and wrap the
   `fetch` call in `call()` with an `AbortController` that aborts after that many ms (the catch
   block already turns any `fetch` rejection, abort included, into `{ ok: false, status: 0, code:
   'provider_error' }`); replace `failure()`'s manual cast with a small zod schema (`error.code`
   optional string, `reason` optional string) and `safeParse`, defaulting to `'provider_error'`
   exactly as today on a parse failure.
5. `apps/web/src/studio/publishClient.test.ts` (new) — mock `global.fetch`; cover: (a) a normal
   success round-trip for `loadLatestRun`/`startPublish` (schema parses), (b) a fetch that hangs
   until its `AbortSignal` fires, using `vi.useFakeTimers()` to advance past `FETCH_TIMEOUT_MS`
   and assert the promise still resolves to a status-0 failure, (c) `failure()` via well-formed,
   extra-field and malformed error bodies.
6. `apps/web/app/teacher/page.tsx` — wrap the `changedSinceLastPublish` read in try/catch; on
   failure, log the error name only (`console.error` or the existing server log convention this
   file already uses — check `insights/page.tsx` for the house style) and default the flag to
   `false` so the page still renders.
7. `apps/web/app/teacher/page.test.tsx` — add the rejection case described above.
8. `apps/web/app/teachers/[slug]/page.tsx` — combine the `offers` `Promise.all(...)` and the
   `teacherScorecard(...)` call into one `Promise.all([offersPromise, scorecardPromise])`; keep
   `teacherScorecard`'s own try/catch exactly as is (it must keep swallowing its own failure, so
   it never makes the combined `Promise.all` reject on a scorecard-read failure).

## Deferred (named board follow-ups, not in this build)
- **DB change — do not do here:** `packages/db/src/repositories/publish.ts`,
  `changedSinceLastPublish`'s outline sub-select (`last.published_at < (select courses.updated_at
  ...)`) returns `NULL` when the teacher has no course row, silently making the whole `changed`
  expression `NULL` (read back as `false`). Needs a `coalesce(..., true)` (or a comment recording
  that "no course yet" deliberately reads as "not changed") plus a `database-reviewer` pass
  (`packages/db/src/repositories/**` is a risk-paths.txt path, reviewers: security-reviewer per
  that file's own group — confirm current group list at build time). File a follow-up task.
- **Batch independent reads in `start()`:** `packages.listForTeacher`, `styleCards.latest` and
  `courses.ensureDefault` are independent of each other today but run sequentially. Batching them
  changes behaviour: `courses.ensureDefault` can write a default course even when the teacher has
  no packages or style card yet (today it short-circuits before that write). Needs a product call
  on whether that write-before-fail is acceptable; file a follow-up task rather than deciding it
  here.
- **8.7k LOW, duplicate test:** `apps/web/app/teachers/[slug]/page.test.tsx` has two tests that
  both set `state.publicScorecard.mockResolvedValue(null)` and assert "No published scorecard
  yet." (lines ~164 and ~180 today) — the second only adds a draft-agent comment. Merge into one
  test (keep the draft-agent comment) or rename the second to assert something it doesn't yet
  cover. Left out here to keep this build to 8 files; file a follow-up task (or fold into the
  next `teachers/[slug]` touch).

## Files out of bounds
- `packages/db/**` (including migrations) — no DB changes this task (see Deferred).
- `apps/web/e2e/a11y.spec.ts` — another builder is editing this file concurrently; do not touch.
- Anything else under `apps/web/e2e/**` not already listed above.
- `.claude/**`, `.github/**`, `docs/adr/**`, `packages/contracts/**` — not needed for this task.

## Tests first
Write/extend the five test files above (items 2, 5, 7, plus confirming 8's existing suite still
passes) before the corresponding source changes in 1, 4, 6, 8 — standard red-green-refactor; the
new `publishClient.test.ts` is written fully before `publishClient.ts` changes since the file has
no tests today.

## Risky paths touched
None (checked against `.claude/skills/merge-gate/risk-paths.txt`): every touched path is under
`apps/web/src/studio/**`, `apps/web/app/teacher/**` or `apps/web/app/teachers/**`, none of which
match `apps/web/app/api/webhooks/**`, `apps/web/src/auth/**`, `apps/web/app/api/auth/**`,
`apps/web/app/api/staff/**` or `packages/db/src/repositories/**` (the only `apps/web`-adjacent
risk groups). No contracts, ADR, `.claude/`, `.github/` or `.githooks/` paths touched.

## Open questions
- `STALE_QUEUE_MS` value: picking 2 minutes (worker should claim a queued gate run almost at
  once) as a reasonable default; not a spec'd number. Flag in the handoff as a judgement call,
  not a human decision — low risk, easy to retune later.
- House style for the `/teacher` page's error log (`console.error` vs a shared `ServerLog`): the
  builder should match whatever `apps/web/app/teacher/insights/page.tsx` already does for its own
  repo-read-failure case, for consistency, rather than inventing a new convention.

## Budget: 42 tool calls (1 phase, apps/web only)

## Allowed tools
Read, Grep, Glob, Edit, Write (new test file only), Bash (pnpm typecheck/lint/test --filter=web
only; no git push beyond the normal commit/PR flow; secret scan).

## Exit conditions
`Status: DONE` when all three accept-criteria behaviours have a passing test, items 6-8 are
in and their tests (existing + new) are green, and `typecheck`/`lint`/`test` are green for
`apps/web`. `Status: PARTIAL` if past ~42 tool calls, or if a fix touches
`apps/web/e2e/a11y.spec.ts` or anything under `packages/db/**` (stop and hand back instead —
those are out of bounds for this task).
