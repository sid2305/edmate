# Plan: 6.4b — session-end summary cost race

## Task (from board)

> Session-end summary cost race (6.4a security MEDIUM): concurrent POSTs to
> `apps/web/app/api/sessions/[id]/end` can each run an unmetered summarize before one write
> lands; add a per-session in-flight lock or claim (or a rate limit) so only one summarize runs
> per session

Deps: 6.4a (done). Board `risk: risky`.

## Acceptance (verbatim)

> two concurrent end requests for one session run the summarizer once; the second answers
> without a model call; web tests green.

**How it will be shown:** a new test in `apps/web/app/api/sessions/[id]/end/route.test.ts` that
fires two concurrent `POST /end` calls for the same open session and asserts the scripted
gateway's `generateObject` is invoked exactly once, both responses are `{ ok: true }`, and the
new `attachSummary` repo call happens exactly once. A matching set of `packages/db` int tests
proves the same claim is atomic at the database layer, not just in the in-memory test double.

## Design: reuse `sessions.end()`'s existing atomic claim, add one additive conditional update

**Chosen:** split the write in two, both already-idiomatic conditional `UPDATE ... WHERE`
statements, no migration:

1. **Claim** — the route calls the existing, *unchanged* `repos.sessions.end(scope, id,
   undefined)` *before* loading history or building the gateway (today it's called once, at the
   very end, with the final summary). `end()`'s own `WHERE ... AND ended_at IS NULL` is already
   the atomic, cross-instance-safe race-resolution point (6.4a/6.5a's existing contract): exactly
   one of two concurrent callers gets `{ ended: true }`; the other gets `{ ended: false }`
   immediately, with no row written. The route treats `{ ended: false }` as "someone else is
   already ending this session" and returns `ok()` **before summarizing** — this is the actual
   fix, not a new lock.
2. **Attach** — only the claim's winner loads history, calls `summarizeSession`, and — only if it
   produced a summary — calls one new, additive method, `sessionsRepo.attachSummary(scope, id,
   summary)`, a second conditional update: `WHERE <scope> AND ended_at IS NOT NULL AND summary IS
   NULL`, idempotent and scoped so a retried or duplicate call is a safe no-op. This absorbs the
   `memory_reset_at` watermark check and `learner_profiles` upsert that today live inside `end()`'s
   `summary !== undefined` branch (same lock order: the session row's own `UPDATE`, then
   `learner_profiles ... FOR UPDATE`, unchanged from `end()`'s existing order — see the deadlock
   lesson in `docs/lessons.md`).

**Why not an in-process lock:** it doesn't serialise across instances/containers, which the task
itself calls out as the thing to avoid.

**Why not a new migration/column:** `end()`'s own `ended_at IS NULL` condition already gives an
atomic, single-winner claim for free; the only genuinely new state needed is "has the summary
been attached yet", and `summary IS NULL` on the already-ended row is exactly that — no new
column, no `database-reviewer` trigger (no migration touched).

**Why not hold a DB transaction open across the model call:** that would need the whole
`summarize()` await to run inside one `db.transaction()` (to hold a Postgres advisory lock for
its duration), pinning a pool connection for the length of an LLM call — worse than the row
`WHERE` claim, not simpler.

**Consequence accepted:** the session now ends (claim) *before* summarization is attempted,
instead of after. Final state is unchanged (`sessionSummary.ts`'s "don't block ending on a model
failure" rule already meant a failed/slow summarize left `summary: null`); only the order of the
two writes flips. `end()`'s own signature, behaviour and existing tests (`sessions.int.test.ts`,
`memory-reset*.int.test.ts`, `repositories.int.test.ts`) are untouched.

**Decision folded into the plan (not left open):** `attachSummary`'s call in the route is wrapped
in the same try/catch/log-and-swallow pattern the route already uses for `summarizeSession`
failures — never a 400/500 once the claim succeeded (the session is already ended at that point;
surfacing an error there would wrongly tell the client the end failed).

## Files to create/modify

1. `packages/db/src/repositories/sessions.ts` — new `attachSummary(scope, sessionId, summary:
   string): Promise<{ attached: boolean }>`, mirroring `end()`'s structure: `studentScope`,
   `parseArg(IdSchema, ...)`, the same `countWords > LIMITS.lastSummaryMaxWords` → `invalid`
   check, one `db.transaction`, the conditional `UPDATE ... WHERE ownSession(id, sc) AND
   isNotNull(endedAt) AND isNull(summary)`, the same stale-watermark-skip + `learnerProfiles`
   upsert block `end()` already has (moved, not duplicated-and-diverged — copy it verbatim with
   `attached[0].createdAt` in place of `closed[0].createdAt`), else a plain `ownSession` select to
   distinguish `not_found` from "nothing to do" (`{ attached: false }`). Add `isNotNull` to the
   existing `drizzle-orm` import. `end()` itself is **not modified**.
2. `packages/db/test/sessions.int.test.ts` — new cases for `attachSummary`: attaches once on an
   already-ended, summary-less session (profile upsert happens, same assertion shape as the
   existing `end(..., summary)` cases just above); a second call is a no-op (`{attached:false}`,
   stored summary unchanged); wrong scope / missing session is `not_found`; over
   `LIMITS.lastSummaryMaxWords` is `invalid`; called on a session that isn't ended yet is a no-op
   (`{attached:false}`, defensive — shouldn't happen via the route, but matches `end()`'s own
   defensiveness).
3. `packages/db/test/memory-reset-watermark.int.test.ts` — one new case: `end(sc, id, undefined)`
   then `attachSummary(sc, id, summary)` after the pair's `memory_reset_at` has moved past the
   session's `createdAt` — the summary is skipped, `lastSummary` untouched — proving the 6.5a
   watermark rule still holds now that it lives in `attachSummary` instead of `end()`.
4. `apps/web/app/api/sessions/[id]/end/route.ts` — move the `repos.sessions.end(...)` call to
   immediately after the existing `session.endedAt !== null` early-return, called with
   `undefined`; if `!claim.ended`, `return ok()` before touching `repos.messages.history` or the
   gateway; keep `summarizeSession` exactly as is; if it returns a `summary`, call
   `repos.sessions.attachSummary(scope, path.data.id, summary)` inside its own try/catch (log
   `sessions.end.attach_failed`, swallow, still `return ok()`).
5. `apps/web/app/api/sessions/[id]/end/route.test.ts` — add `attachSummary` to the `memory()`
   stub's `repos.sessions` (same no-op/attach semantics as the real repo, for test-only); update
   the handful of existing assertions that currently check the final summary via a single `end`
   call (the "ends an open session... stores the summary", "already-ended no-op", "empty
   transcript", and "gateway/schema failure" cases) to check `end` called once with `undefined`
   plus `attachSummary` called 0 or 1 times, matching the new two-step shape — behaviour
   (response codes, stored row, logged fields) is unchanged, only which mock function the
   assertion targets. Add the new concurrency test: `Promise.all` two `h.end(post(VALID), ctx())`
   calls on the same fresh session; assert `gateway` (the drafter builder) and `summarizeSession`'s
   effect (`historyFn`/`generateObject`) each ran once, `attachSummary` ran once, both responses
   are `{ ok: true }`, and the stored session's summary is the one summarize call's text. Add one
   case for an `attachSummary` failure (e.g. the word-limit `RepositoryError`) still returning
   `ok()` with the summary unstored and the failure logged by name only — same shape as the
   existing `gatewayFails` case.

## Files out of bounds

- Everything in 6.4c's scope: `packages/harness/src/pipeline/runner.ts` telemetry on a
  topic-less `evidenceFor` skip, a `SessionSummarySchema`-failure test in this same
  `route.test.ts`, a `'limit'` case in the route's `RepositoryError` switch, and
  `packages/harness/src/tools/practice.ts`'s `topicMap`/`pickItem`. None of these are touched here
  even though the route file overlaps — 6.4c's builder reads this task's diff, not the other way
  around.
- `end()`'s signature and behaviour in `packages/db/src/repositories/sessions.ts` — unchanged, to
  keep `sessions.int.test.ts`, `memory-reset.int.test.ts`, `memory-reset-watermark.int.test.ts`
  and `repositories.int.test.ts` green with no edits beyond the one new case each in (2) and (3).
- No migration, no new column, no `database-reviewer` trigger.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- `packages/db/src/repositories/sessions.ts` matches `packages/db/src/repositories/**` →
  reviewers: **security-reviewer** (plus the always-on `code-reviewer`, `typescript-reviewer`).
- `apps/web/app/api/sessions/[id]/end/route.ts` is **not** on any risk-paths group (it's under
  `apps/web/app/api/sessions/**`, not `auth/**`, `webhooks/**`, `auth/**` or `staff/**`).
- The board already tags 6.4b `risk: risky` (it's a deferred security MEDIUM); log a `risk: high`
  decision at merge regardless of the single-group reviewer list, per the non-negotiable rule.

## Tests first (red → green)

1. `packages/db/test/sessions.int.test.ts` — write the five `attachSummary` cases against the
   not-yet-existing method first (red: `TypeError`/compile error), then implement it (green).
2. `packages/db/test/memory-reset-watermark.int.test.ts` — the split-flow watermark case, same
   red-then-green.
3. `apps/web/.../route.test.ts` — write the concurrency test and the `attachSummary`-failure test
   against the current (unreordered) route first (red: the concurrency test would currently show
   `generateObject` called twice), then make the route.ts change (green). Update the pre-existing
   assertions in the same pass since they encode the old single-call shape.

## Gate

```
corepack pnpm --filter @edmate/db typecheck lint test
corepack pnpm turbo run typecheck lint test --filter=...@edmate/db   # dependents form: catches @edmate/web (and harness/worker/cli if any) breaking on the new exported Repositories member
corepack pnpm --filter @edmate/web typecheck lint test
python3 .githooks/secret-scan.py --all
```
`packages/db` int tests need a reachable Postgres (`TEST_DATABASE_URL` / the repo's own dev
Postgres); if none is reachable they skip (existing pattern in `pg.ts`'s `postgresUp()`) — not a
blocker for this task, but try to run them for real once if a dev Postgres is up, since this
touches a risky repository file.

## Risks & mitigations

- **Risk:** splitting `end()`'s write could silently diverge the two copies of the
  watermark/profile-upsert logic over time. **Mitigation:** copy the block verbatim in this PR
  (same variable names, same comment) and the new `memory-reset-watermark.int.test.ts` case pins
  it; a future change to one without the other fails that test.
- **Risk:** the concurrency test in `route.test.ts` is only deterministic because the mock
  repo/gateway have no real async delay — it doesn't prove cross-instance (multi-Postgres-client)
  correctness. **Mitigation:** that proof lives in the `packages/db` int tests instead, where
  `attachSummary`'s own `WHERE` clause is exercised directly against real Postgres; the route test
  only proves the *route* calls things in the new order.

## Budget

Budget: 90 tool calls (1 phase, 2 packages: @edmate/db, @edmate/web)

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (typecheck/lint/test/gate commands and the secret scan only).

## Exit conditions

Status: DONE when all five files are green on the gate above (leaf form for each package plus the
`...@edmate/db` dependents form), the new concurrency test and the five `attachSummary` int-test
cases pass, and the pre-existing route.test.ts assertions are updated and passing with no
behaviour change to response codes/logged fields. Status: PARTIAL past ~90 tool calls, or if a
file outside this plan's list turns out to need changes (e.g. another package besides
`@edmate/web` imports `Repositories['sessions']` in a way that breaks) — stop and hand off rather
than widening scope.

## Open questions

None — the one real design choice (claim ordering vs. in-process lock vs. advisory lock) is
decided above with its reasoning.
