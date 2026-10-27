# Handoff: 6.4b

Status: DONE

## Summary

Fixed the session-end summary cost race (6.4a security MEDIUM): two concurrent `POST
/api/sessions/:id/end` calls for the same open session used to each run an unmetered
`summarizeSession` call before one write landed. Followed the plan's chosen design: split the
write into a claim (reuse `end()`'s own `WHERE ... AND ended_at IS NULL`, called with
`undefined` *before* summarising) and an additive, idempotent attach step.

- `packages/db/src/repositories/sessions.ts` — added `attachSummary(scope, sessionId, summary):
  Promise<{ attached: boolean }>`, mirroring `end()`'s structure (conditional `UPDATE ... WHERE
  ownSession(id, sc) AND isNotNull(endedAt) AND isNull(summary)`, same watermark-skip +
  `learnerProfiles` upsert block copied verbatim, same `FOR UPDATE` lock order). Added `isNotNull`
  to the `drizzle-orm` import. `end()` itself is unchanged.
- `packages/db/test/sessions.int.test.ts` — six new `attachSummary` cases (attaches once on an
  already-ended, summary-less session, including a first-ever profile row; a second call is a
  no-op; wrong scope / missing session is `not_found`; over-limit is `invalid`; not-yet-ended is a
  no-op).
- `packages/db/test/memory-reset-watermark.int.test.ts` — one new case proving the split
  `end(undefined)` → `attachSummary` flow still skips a stale summary across the `memory_reset_at`
  watermark, now that the rule lives in `attachSummary`.
- `packages/db/test/repositories.int.test.ts` — required, not originally in the plan's file list:
  `CASES` is typed `Record<RepositoryMethod, IsolationCase>`, so adding `attachSummary` to
  `Repositories['sessions']` made this file fail to compile without a matching case. Added a
  third spare per-pair session (`endable3`, already ended with no summary, seeded in `beforeAll`)
  and a `sessions.attachSummary` isolation case alongside the existing `sessions.end` one. See
  `## Decisions` below.
- `apps/web/app/api/sessions/[id]/end/route.ts` — moved the `repos.sessions.end(...)` call to run
  immediately after the existing `session.endedAt !== null` early-return, called with `undefined`
  as the claim; `if (!claim.ended) return ok()` before touching `repos.messages.history` or the
  gateway. `summarizeSession` is unchanged; on a produced summary, calls
  `repos.sessions.attachSummary(scope, id, summary)` inside its own try/catch, logging
  `sessions.end.attach_failed` (errorName only, no summary text) and swallowing, still `ok()`.
- `apps/web/app/api/sessions/[id]/end/route.test.ts` — added `attachSummary` to the `memory()`
  stub's `repos.sessions` (same no-op/attach semantics as the real repo); updated the four
  existing assertions that checked the old single `end(..., summary)` call to check `end` called
  with `undefined` plus `attachSummary` called 0 or 1 times. Added the concurrency test (two
  concurrent `h.end` calls on the same session; asserts `historyFn`/`gateway`/`attachSummary` each
  ran exactly once, both responses `{ ok: true }`, stored summary is the one call's text) and an
  `attachSummary`-failure test (RepositoryError from `attachSummary` still returns `ok()`, summary
  unstored, logged by name only).

### Red → green evidence

Concurrency test: temporarily reverted `route.ts` to the pre-fix shape (the `end()` call moved
back to the very end, called with the real `summary`, no claim-gate) and re-ran only
`-t "two concurrent end requests"`:

```
FAIL app/api/sessions/[id]/end/route.test.ts > POST: end a session > two concurrent end requests
  for one session run the summarizer once; the second answers without a model call
AssertionError: expected "vi.fn()" to be called 1 times, but got 2 times
  ❯ expect(m.historyFn).toHaveBeenCalledTimes(1);
```

Confirmed RED: `historyFn` (and so the gateway/summarizer) ran twice, because both concurrent
calls reached the summarise step before either call's `end()` (called only at the very end, after
both already passed the `endedAt !== null` check) had written anything. Restored the fix (claim
`end()` moved before summarising, gated on `claim.ended`) and re-ran the same test plus the full
`route.test.ts` suite: GREEN, 23/23 passed, `historyFn`/`gateway`/`attachSummary` each called
exactly once.

`attachSummary`'s own red state: writing the `sessions.int.test.ts`/`repositories.int.test.ts`
cases against the not-yet-existing method gave a `TypeError: ... is not a function` /
`tsc` compile error (`Property 'attachSummary' does not exist`), before the method was added.

## Decisions

### 27 Oct 2026 · 6.4b add a `sessions.attachSummary` case to `repositories.int.test.ts` · decided by builder · risk: low
- Decided: added the required `CASES['sessions.attachSummary']` entry (and a third seeded,
  already-ended, summary-less session per pair, `endable3`) to
  `packages/db/test/repositories.int.test.ts`, even though this file was not in the plan's "Files
  to create/modify" list.
- Why: `CASES` is typed `Record<RepositoryMethod, IsolationCase>` and a runtime check also
  compares `createRepositories(db)`'s own methods against `CASES` — adding `attachSummary` to
  `Repositories['sessions']` (needed per the plan's own design) makes `packages/db` itself fail to
  `tsc`/fail the runtime check without this addition. This isn't a design choice or a scope
  widening; it's the minimum edit the plan's own chosen design requires to keep `packages/db`
  compiling and its own isolation test accurate. Kept the shape identical to the adjacent
  `sessions.end` case (same owner-marker/no-leak assertions, same mismatches pattern) and used a
  freshly seeded session rather than reusing `endable`/`endable2` so it never races with those
  cases' own state.

## Gate

```
corepack pnpm --filter @edmate/db typecheck            # pass
corepack pnpm --filter @edmate/db lint                  # pass
corepack pnpm --filter @edmate/db test                  # 89 files, 1844 passed | 4 skipped
corepack pnpm --filter @edmate/db exec vitest run test/sessions.int.test.ts \
  test/memory-reset-watermark.int.test.ts test/repositories.int.test.ts
                                                          # 3 files, 212 passed (real dev Postgres)
corepack pnpm turbo run typecheck lint test --filter=...@edmate/db
                                                          # 16 tasks pass; @edmate/cli#test's
                                                          # test/chatDbRetrieval.int.test.ts failed
                                                          # under load with a Postgres "Connection
                                                          # terminated unexpectedly" (unrelated to
                                                          # this change, not a file this task
                                                          # touches); re-ran that file alone twice,
                                                          # both times it passed (1 passed | 1
                                                          # skipped) -- flaky under concurrent-suite
                                                          # load against the shared dev Postgres,
                                                          # noted per the plan's own instruction
corepack pnpm --filter @edmate/web typecheck            # pass
corepack pnpm --filter @edmate/web lint                  # pass (2 pre-existing unrelated warnings
                                                          # in test/lighthouse-a11y.test.ts)
corepack pnpm --filter @edmate/web exec vitest run -t "end a session"
                                                          # 23 passed (full route.test.ts suite,
                                                          # via -t instead of a bracketed path --
                                                          # the sandbox blocks commands containing
                                                          # a literal "[id]" path segment)
corepack pnpm exec prettier --check <all 6 changed files>
                                                          # pass (2 files needed --write first,
                                                          # both re-verified clean after)
python3 .githooks/secret-scan.py --all                   # clean, no output
```

Postgres was reachable at the default `TEST_DATABASE_URL` (127.0.0.1:55432) throughout, so the
`packages/db` int tests ran for real against it, including the three files this task changed.

## Budget

Tool calls used: 56
