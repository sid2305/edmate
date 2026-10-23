# 9.4d handoff: 9.4a review MEDIUMs (live-class ask, limits Redis timeout, studentMarket)

**Status:** DONE
**Branch:** m13/9.4d-review-mediums (local `work-94d`)
**Worktree:** .claude/worktrees/agent-a63186b626bb027ad

## What changed

1. **Live-class questions route picks teachers from the student's own subscriptions.**
   `apps/web/app/api/live-classes/[id]/questions/handlers.ts`: `AskQuestionBackend` drops
   `agents` + `candidateAgentIds()` (EDMATE_CHAT_AGENTS) for
   `subscriptions.listLiveForStudent`, called with `ctx.principal.userId` only. That is the same
   query `/home` uses. The distinct teachers of the not-ended rows (paused included, as on /home)
   are tried in turn with the per-teacher `studentScope`. The error mapping is unchanged:
   repo `not_found` moves on to the next teacher, no match gives 404, any other error (including a
   failed lookup) gives 500 with no raw text. `route.ts` wires it to
   `serverDatabase().repos.subscriptions`.
   - Other student routes /home links to: `/learn/[agentId]`, `/learn/[agentId]/plan` and
     `/packages/[agentId]`. None of them reads `EDMATE_CHAT_AGENTS` (`grep` over `apps/web/app` and
     `apps/web/src`: the only remaining reader is `chatAgentCandidates`, which feeds /home's
     *startable* list on purpose, lead answer 2 in 9.4a). Nothing else needs fixing.
2. **Limits Redis client is bounded.** `apps/web/src/turn/runtime.ts` exports
   `LIMITS_REDIS_OPTIONS = { maxRetriesPerRequest: 1, commandTimeout: 2_000, connectTimeout: 5_000 }`
   for the fail-fast limits client (turn limits + session-start limit). As a backstop,
   `apps/web/src/turn/routes.ts` puts a 3 s route-level deadline (`SESSION_LIMIT_DEADLINE_MS`)
   around `sessionRateLimit.take`. A limiter that never settles gives 503 `provider_error`,
   logged as `sessions.rate_limit_failed error=SessionLimitTimeoutError`, and the timer is always
   cleared.
3. **Missing `studentMarket` fails loudly.** `packages/db/src/repositories/ports.ts`: a
   `subscription` resolve for a clear learner with no `studentMarket` now throws
   `RepositoryError('integrity', 'entitlementStore.resolve')` instead of returning `null`. The
   check sits after the `learnerClear` gate, so the studio preview store (`learnerClear: async () =>
   false`, out of bounds for this task) still gets `null`. The option stays optional for
   preview/eval roots.

Tests:
- `route.test.ts`: a live subscription to a teacher not in EDMATE_CHAT_AGENTS (env set to another
  agent) can ask (200). Also covered: a paused subscription still resolves; no subscription gives
  404 with nothing written; another student's principal gives 404 and only that student's own list
  is read; an ended row is skipped; each distinct teacher is tried once; a lookup failure gives 500
  with no raw text.
- `routes.test.ts`: a hung `take()` (a promise that never settles) under fake timers is still
  pending at deadline−1 ms and gives 503 at the deadline, with no session row and the log by
  error name only. A limiter that answers in time leaves no timer behind.
- `limitsRedis.test.ts` (new): the real ioredis client with `LIMITS_REDIS_OPTIONS`, pointed at a
  local TCP socket that accepts and never replies (not a real Redis), rejects `take()` with
  "timed out" (`commandTimeout` 200 ms for speed; a loose 4 s gross-regression bound only).
- `runtime.test.ts`: the limits client is opened with the new options.
- `entitlement-store.int.test.ts`: with `studentMarket` left out, a subscription resolve throws
  `RepositoryError` kind `integrity`, even for a student with no subscription. Preview with it left
  out still works.

## Evidence

- `TEST_DATABASE_URL=postgres://…@127.0.0.1:55432/edmate corepack pnpm turbo run typecheck lint test --filter=@edmate/db --force`
  → `Test Files 75 passed (75)`, `Tests 1476 passed | 4 skipped (1480)` (the 4 are in-file skips,
  as on main; no test file skipped), `Tasks: 8 successful, 8 total`.
- `TEST_DATABASE_URL=… corepack pnpm turbo run typecheck lint test --filter=@edmate/web --force`
  → `Test Files 150 passed (150)`, `Tests 2231 passed (2231)`, `Tasks: 10 successful, 10 total`.
  Without `TEST_DATABASE_URL` the four staff `route.int.test.ts` files skip, so the gate was run
  with it set.
- `python3 .githooks/secret-scan.py --all` → clean (exit 0).

## Deviations

- Item 2 adds a route-level deadline as well as the client `commandTimeout`, so the 503 holds
  for any limiter, not just ioredis.
- Item 3: the throw sits after `learnerClear`, not at the top of the branch. Otherwise the studio
  preview store's test (out of bounds) would break.

## Left to do

None for this task. (The board already has the other 9.4a LOW follow-ups.)

## Decisions

### 22 Oct 2026 · 9.4d: missing studentMarket fails loudly in packages/db/src/repositories/ports.ts · decided by builder · risk: high
- Decided: a `subscription` resolve for a learner who passes `learnerClear` but has no `studentMarket` option throws `RepositoryError('integrity')` instead of returning `null`. The option stays optional (preview/eval roots), and a root whose `learnerClear` is always false (studio preview) still gets `null`.
- Why: a silent `null` turned a wiring mistake into "You need a live package" for every student, with no log line. Throwing is still fail-closed (no entitlement), but it is loud. Checking after `learnerClear` keeps the studio preview store, which is out of bounds here, unchanged.
- risk: high (the entitlement store, a risky path; behaviour changes only for a misconfigured root).

### 22 Oct 2026 · 9.4d: live-class questions resolve teachers from the student's own live subscriptions · decided by builder · risk: low
- Decided: the ask route uses `subscriptions.listLiveForStudent(principal.userId)` (not-ended rows, paused included) for its candidate teachers and no longer reads `EDMATE_CHAT_AGENTS` or `agents.owner`.
- Why: the route then matches the source /home lists live classes from, so every class /home shows can be asked. The student id comes only from the session.
- risk: low

### 22 Oct 2026 · 9.4d: session-start limiter bounded twice (client commandTimeout 2 s, route deadline 3 s) · decided by builder · risk: low
- Decided: the limits Redis client gets `commandTimeout: 2000` and `connectTimeout: 5000`, and `POST /api/sessions` races `take()` against a 3 s deadline, failing closed with 503.
- Why: a black-holed Redis would otherwise hang every session start. The route deadline also covers any future limiter implementation.
- risk: low

Tool calls used: 32
