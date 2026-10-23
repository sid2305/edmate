# 9.4a handoff — Phase A (per-student session-start rate limit)

**Status:** DONE (Phase A of 4)
**Branch:** `m13/9.4a-turn-followups` (built on local `work-94a-A`)
**Worktree:** `.claude/worktrees/agent-ae16cd769a85b7288`

## Summary
Phase A of 4. `POST /api/sessions` now takes one hit on a per-student fixed-window limiter
(20 starts per 10 minutes, the lead's answer) right after body validation and backend load,
before any agent lookup, entitlement or DB work. Over the limit is `429 rate_limited`
(retryable, `cache-control: no-store`), with no session row written. A limiter that can't
answer (Redis down) fails closed: `503 provider_error`, logged as `sessions.rate_limit_failed`
by error name only. The limiter is keyed by the signed-in principal's id, never the body. Turns
(`postTurn`) are not counted. The limiter mirrors `src/studio/linkRateLimit.ts` (one Lua
`INCR`+`PEXPIRE` round trip) in its own file, and runs on the same fail-fast Redis client the
turn limits already use (no third connection).

## Files
- `apps/web/src/turn/sessionRateLimit.ts` (new): `SESSION_START_LIMIT = 20`,
  `SESSION_START_WINDOW_MS = 600_000`, `redisSessionRateLimiter`, `fakeSessionRateLimiter`,
  `failingSessionRateLimiter`.
- `apps/web/src/turn/sessionRateLimit.test.ts` (new): 12 tests (window, per-student, reset,
  defaults, script wiring, fail-closed reject).
- `apps/web/src/turn/routes.ts`: `TurnBackend.sessionRateLimit`; the check in `startSession`;
  `MSG.tooManySessions`.
- `apps/web/src/turn/runtime.ts`: `RuntimeRedis` (queues, limits, sessionRateLimit), the new
  `TurnRuntimeHooks`; `openRedis` builds the limiter on the limits client; `build()` wires it
  from the hook.
- `apps/web/test/turn-backend.ts`: `MemoryBackendOptions.sessionRateLimit`, allowing every start
  by default.
- `apps/web/src/turn/routes.test.ts`: 7 new cases: 429 with no row and no entitlement call,
  window reset, per-student isolation, keyed by principal, invalid body not counted, fail closed
  503, turns unaffected.
- `apps/web/src/turn/runtime.test.ts`: the backend's limiter is the hook's object; `openRedis`
  defines the script on the limits client and opens only 2 clients.

## Tests (acceptance evidence)
- `corepack pnpm vitest run src/turn/sessionRateLimit.test.ts` → red first (no module), then
  `Tests  12 passed (12)`.
- `corepack pnpm vitest run src/turn/routes.test.ts` → red first (`6 failed | 30 passed`), then
  `Tests  36 passed (36)`.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web` →
  `Test Files  143 passed | 5 skipped (148)`, `Tests  2169 passed | 29 skipped (2198)`,
  `Tasks:    10 successful, 10 total`.
- Coverage (clover): `sessionRateLimit.ts` 27/27 statements, 21/21 branches; `routes.ts` 108/108
  statements.
- `python3 .githooks/secret-scan.py --all` → exit 0, no findings.

## Phase B (the student's own market, from identity, per turn)

**Status:** DONE. Local branch `work-94a-B`, worktree `.claude/worktrees/agent-a41d9d0cab32c9d21`.

### Summary
A student's turns now run in that student's own market (`users.market`: `global` from sign-up,
the age-gate answer after), read fresh on every `subscription` resolve. No env var picks it. The
identity store gains `getMarket(id)`, which reads only the `market` column (`null` for an unknown
id). `EntitlementStoreOptions` gains `studentMarket(studentId)`, the only market source of the
`subscription` branch; it is asked only once an entitlement is found, and left out the branch
fails closed (`null`, so `no_access`). The fixed `market` option stays for `teacher_preview` and
`eval`. The turn runtime wires `studentMarket` from `identity.getMarket` (unknown id falls back
to `global`; an identity error fails the resolve) and no longer reads `EDMATE_MARKET`, so the
production `TurnUnavailableError('EDMATE_MARKET')` boot check for student turns is gone. A market
with no locale pack still runs as `global` (`packMarket`, unchanged).

### Files
- `packages/db/src/identity/store.ts`, `README.md`: `getMarket`.
- `packages/db/src/repositories/ports.ts`: `EntitlementStoreOptions.studentMarket`; the
  `subscription` branch reads it.
- `apps/web/src/turn/deps.ts`: `ProcessPortOptions.studentMarket` replaces `market`.
- `apps/web/src/turn/runtime.ts`: `configuredMarket` and the `EDMATE_MARKET` read removed;
  `TurnRuntimeHooks.database()`'s identity is `Pick<IdentityStore, 'learnerStatus' | 'getMarket'>`.
- `apps/web/test/memory-identity.ts`: the in-memory identity gains `getMarket`.
- Tests: `packages/db/test/identity.int.test.ts` (getMarket), `entitlement-store.int.test.ts` (5
  new studentMarket cases), `access-seed.ts` (shared `studentMarket`), and the five db
  integration tests that resolve subscriptions; `apps/web/src/turn/runtime.test.ts` (the three
  `EDMATE_MARKET` tests replaced by one "not read" test and four per-student cases with a fake
  `getMarket`), `deps.test.ts`, `src/deploy/stack-config.test.ts` (new: the student turn runtime
  source never names `EDMATE_MARKET`).
- `docker/compose.yaml`, `docker/env.example`, `docs/try-it.md`: `EDMATE_MARKET` re-described as
  the studio test chat's market only (see Decisions).

### Gate
`corepack pnpm turbo run typecheck lint test --filter=@edmate/web --filter=@edmate/db`:
`@edmate/web` Test Files 143 passed | 5 skipped (148), Tests 2182 passed | 29 skipped (2211);
`@edmate/db` Test Files 27 passed | 47 skipped (74), Tests 680 passed | 771 skipped (1451) (no
Postgres at `TEST_DATABASE_URL`, so the db integration tests were skipped, not run). Tasks: 13
successful, 13 total. `python3 .githooks/secret-scan.py --all` → exit 0, no findings.

## Phase C (/home chat links from the student's own subscriptions)

**Status:** DONE. Local branch `work-94a-C`, worktree `.claude/worktrees/agent-aab66ffd3ef0a3475`.

### Summary
`/home`'s chat and paused links (and the teacher ids its live-classes block uses) now come from
one query over the signed-in student's own subscriptions across every teacher:
`subscriptionsRepo.listLiveForStudent(studentId)` joins `subscriptions -> package_versions ->
packages -> agents`, keeps live agents only, leaves out `ended`, orders by agent id. No env var
picks a student's chat links any more. **`EDMATE_CHAT_AGENTS` stays for the startable bucket
only** (lead answer 2): the configured candidates (or `demo-agent` outside production) give the
"start a package" links, minus any agent already in the student's live list, and minus a
draft/suspended/unknown agent (`agents.owner`, as before). A failure anywhere shows no links and
logs the error name only, as before. The method takes a bare student id (no packages/db type for
"the signed-in user's own id across teachers" exists), parsed like a scope id, so a malformed or
`undefined` id is `scope` before any SQL. The `/api/live-classes/[id]/questions` route still uses
`chatAgentCandidates` for its own candidate list; it is outside Phase C and unchanged.

### Files
- `packages/db/src/repositories/subscriptions.ts`: `listLiveForStudent`, with the scope-exception
  comment.
- `packages/db/test/repositories.int.test.ts`: an isolation-grid case (each seeded student sees
  exactly its own two pairs; 20 random ids see nothing; malformed ids fail closed) and a fixture
  test (live agent active/paused/past_due kept; suspended, draft and ended left out; another
  student's subscription never listed). Written first, red (3 failed), then green.
- `packages/db/test/scope.test.ts`: the bad-scope grid skips this method (a plain id string is a
  valid id for it, like the staff-id methods); its own malformed-id test replaces that.
- `apps/web/src/chat/liveChats.ts`, `liveChats.test.ts`: `homeCandidateScan` removed;
  `LiveChatDeps.subscriptions.listLiveForStudent`; `classifyHomeLinks(live)` returns
  chats/paused; `homeLinks` builds startable from the candidates. Tests written first (red).
- `apps/web/app/home/page.tsx`, `page.test.tsx`: comments and one test name (wiring unchanged:
  `serverDatabase().repos` already has the new method).

### Gate
`corepack pnpm turbo run typecheck lint test --filter=@edmate/web --filter=@edmate/db`:
After merging origin/main (it brought `packages/db` changes), each package's gate on its own is
green: `corepack pnpm turbo run test --filter=@edmate/db` → `Test Files 74 passed (74)`, 0
skipped (Postgres on 127.0.0.1:55432, so the integration tests ran), `Tasks: 6 successful, 6
total`; `corepack pnpm turbo run typecheck lint test --filter=@edmate/web` → `Test Files 144
passed | 4 skipped (148)`, `Tasks: 10 successful, 10 total`. The combined two-package run is
not green on this loaded machine, and the failures are timing only: in the post-merge run,
`src/auth/route-coverage.test.ts` `/api/sessions/x/reports` hit vitest's 5 s timeout
(`Test Files 1 failed | 142 passed | 5 skipped (148)`), and the file passes alone along with
`src/chat` and `app/home` (`Tests 310 passed (310)`). Before the merge, the combined runs showed
`@edmate/web` 143 passed | 5 skipped (148) and `@edmate/db` `Test Files 1 failed | 73 passed (74)`,
`Tasks: 12 successful, 13 total`. The failing db file was
`packages/db/test/retrieval-leak.int.test.ts`, a wall-clock timing case (the cold-build timeout or
the p95 SLO case, a different one on different runs) under machine load (load average about 20,
other builders running). It is the known flake already on the board (the PR #98 SLO flake and
the 22 Oct timing-flake task); this phase does not touch retrieval, and the file alone passes:
`corepack pnpm vitest run test/retrieval-leak.int.test.ts` → `Tests 25 passed (25)`. Every other
db file, including `repositories.int.test.ts` (`subscriptions.listLiveForStudent public read
cases=27 leaks=0`) and `scope.test.ts`, passed. Typecheck and lint green for both packages.
`python3 .githooks/secret-scan.py --all` → exit 0, no findings.

## Decisions

### 22 Oct 2026 · TurnRuntimeHooks instead of widening RuntimeHooks · decided by builder · risk: low
- Decided: Add `TurnRuntimeHooks extends RuntimeHooks` (its `redis` returns `RuntimeRedis`), used
  only by `createTurnRuntime`. `openRedis` returns the wider `RuntimeRedis`, which still fits both.
  The studio is untouched.
- Why: The plan said `RuntimeHooks.redis`'s return type grows one field. But
  `apps/web/src/studio/testChat/runtime.test.ts` (out of bounds) satisfies `RuntimeHooks` with a
  two-field redis, so widening it would break typecheck there.
- risk: low

### 22 Oct 2026 · a limiter failure is 503 provider_error · decided by builder · risk: low
- Decided: A limiter failure is 503 `provider_error`, the same as an unbuildable backend, logged
  as `sessions.rate_limit_failed`.
- Why: The plan said fail closed but didn't name the code.
- risk: low

### 22 Oct 2026 · the limiter runs after the backend loads · decided by builder · risk: low
- Decided: The limiter runs after the backend loads, since the backend owns it. It still runs
  before the agent lookup, entitlement and DB writes. A request with an invalid body is not
  counted. A start for an unknown or unentitled agent is counted, because it's an abuse guard.
- Why: The backend owns the limiter and must be loaded first; counting unknown/unentitled starts
  keeps the guard effective against abuse even when the agent lookup later fails.
- risk: low

### 22 Oct 2026 · rate-limit message text and Redis key prefix · decided by builder · risk: low
- Decided: Message text: "You have started a lot of chats just now. Wait a few minutes and try
  again." Redis key prefix: `edmate:turn:sessionstart:<studentId>`.
- Why: The plan left the exact wording and key naming to the builder.
- risk: low

### 22 Oct 2026 · 9.4a Phase B: student market read from identity · decided by builder · risk: high
- Decided: `packages/db/src/identity/store.ts` gains `getMarket(id)`, a new identity read of the
  `market` column only (`null` for an unknown id, no `IdentityUser` change).
  `packages/db/src/repositories/ports.ts` gains `EntitlementStoreOptions.studentMarket`, the only
  market source of the `subscription` resolve branch; it is optional, and a `subscription`
  resolve with no `studentMarket` fails closed (`null`, so `no_access`), never the fixed `market`.
  The turn runtime's production fail-closed `EDMATE_MARKET` boot check is removed: the market is
  now per-row data (`users.market` is NOT NULL), and an unknown market still maps to `global`.
  Callers pass the signed-in principal's id only.
- Why: A student's turns must run in that student's own market, read fresh on every resolve, not
  from a single env var shared by every student. Making `studentMarket` optional (the plan said
  required) keeps the studio test chat (`apps/web/src/studio/testChat/deps.ts`) and the worker
  gate (`apps/worker/src/gate/agent.ts`) untouched, since both build the store too and are out of
  bounds for this task; failing closed when it is absent, rather than falling back to the fixed
  `market`, keeps a misconfigured caller from granting access it should not.
- risk: high

### 22 Oct 2026 · EDMATE_MARKET stays in compose, as the studio test chat's market only · decided by builder · risk: low
- Decided: Compose, env.example and try-it now describe `EDMATE_MARKET` as the studio preview
  market only. The student runtime never reads it, and a new stack-config test pins that.
- Why: The plan said to drop it from the deploy surface, but the studio test chat (out of bounds)
  still fails closed in production without it, so removing it would break the teacher preview on
  the local stack. Drop it when the studio preview gets its own market source.
- risk: low

### 22 Oct 2026 · when the market is read · decided by builder · risk: low
- Decided: `studentMarket` is asked only after a subscription and its package are found.
- Why: A refused resolve then costs no identity read. An unknown id (no row) falls back to
  `global`, as planned; an identity error fails the resolve.
- risk: low

### 22 Oct 2026 · the identity Pick widens on TurnRuntimeHooks, not RuntimeHooks · decided by builder · risk: low
- Decided: `TurnRuntimeHooks.database()`'s identity type is narrowed via the same
  `TurnRuntimeHooks extends RuntimeHooks` pattern as Phase A, not a change to `RuntimeHooks`.
- Why: Same reason as Phase A: the studio test chat's test satisfies `RuntimeHooks` with
  `learnerStatus` only.
- risk: low

### 22 Oct 2026 · 9.4a Phase C: listLiveForStudent takes the signed-in student's own id · decided by builder · risk: high
- Decided: `packages/db/src/repositories/subscriptions.ts` gains `listLiveForStudent(studentId)`,
  which takes a bare student id, not a `StudentScope`: the one deliberate exception to "student
  data is always per student x teacher", because it lists the student's own subscriptions across
  every teacher. packages/db has no branded "own id" or self-scope type, so per lead answer 3 it
  is a bare id with a comment saying it may only be called with the signed-in principal's own id.
  The id is parsed with the scope id schema (`scope` error on anything malformed or `undefined`,
  before any SQL). The only caller is `/home` (`homeLinks`), which passes `principal.userId`.
- Why: /home must list the student's own chats from their subscriptions, not an env var, in one
  query instead of a per-candidate loop; a student x teacher scope cannot express "all my
  teachers". The security reviewer checks the call sites at review.
- risk: high

### 22 Oct 2026 · startable candidates are still checked for a live agent · decided by builder · risk: low
- Decided: A configured candidate is startable only if `agents.owner` finds it live (as before)
  and it is not already in the student's live list. Only candidates not already live are looked
  up. The teacher ids for live classes come from the live list only.
- Why: The plan said to filter out agents already live; keeping the live-agent check keeps a
  draft or suspended configured agent from showing a dead "start" link, which was today's
  behaviour.
- risk: low

### 22 Oct 2026 · the bad-scope unit grid skips listLiveForStudent · decided by builder · risk: low
- Decided: `packages/db/test/scope.test.ts`'s every-method bad-scope grid skips this method (as it
  does the staff-id methods) and a dedicated test checks its malformed ids fail `scope` before SQL.
- Why: The grid's plain string `'tch_a'` is a well-formed id for a bare-id method, so it would
  reach the database instead of failing as a scope.
- risk: low

## Left to do
- Phase D: test hygiene (coverage include for `.tsx`, playwright `--webpack`, gate test,
  devModel schemas, `deadlineSafeClock.sleep`, abort test clock, instrumentation).

Tool calls used: 36
