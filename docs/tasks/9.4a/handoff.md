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
GATE_LINES

## Decisions
- **`TurnRuntimeHooks` instead of widening `RuntimeHooks`.** The plan said `RuntimeHooks.redis`'s
  return type grows one field. But `apps/web/src/studio/testChat/runtime.test.ts` (out of bounds)
  satisfies `RuntimeHooks` with a two-field redis, so widening it would break typecheck there.
  I added `TurnRuntimeHooks extends RuntimeHooks` (its `redis` returns `RuntimeRedis`), used only
  by `createTurnRuntime`. `openRedis` returns the wider `RuntimeRedis`, which still fits both.
  The studio is untouched.
- **A limiter failure is 503 `provider_error`**, the same as an unbuildable backend, logged as
  `sessions.rate_limit_failed`. The plan said fail closed but didn't name the code.
- **The limiter runs after the backend loads**, since the backend owns it. It still runs before
  the agent lookup, entitlement and DB writes. A request with an invalid body is not counted. A
  start for an unknown or unentitled agent is counted, because it's an abuse guard.
- **Message text:** "You have started a lot of chats just now. Wait a few minutes and try again."
- **Redis key prefix:** `edmate:turn:sessionstart:<studentId>`.

### 9.4a Phase B: a student's market comes from identity, per turn; the EDMATE_MARKET boot check goes (risk: high)
Touches `packages/db/src/identity/**` and `packages/db/src/repositories/**`. New identity read
`getMarket` (market column only, no `IdentityUser` change) and a new
`EntitlementStoreOptions.studentMarket`, the only market source of a `subscription` resolve.
The turn runtime's production fail-closed `EDMATE_MARKET` boot check is removed: the market is
now per-row data (`users.market` is NOT NULL), and an unknown market still maps to `global`.
Callers pass the signed-in principal's id only. Reviewer: security-reviewer.

### 9.4a Phase B: studentMarket is optional and fails closed when absent
The plan said required, but the studio test chat (`apps/web/src/studio/testChat/deps.ts`) and the
worker gate (`apps/worker/src/gate/agent.ts`) build the store too and are out of bounds. Optional
keeps them untouched; a `subscription` resolve with no `studentMarket` returns `null`
(`no_access`), never the fixed `market`.

### 9.4a Phase B: EDMATE_MARKET stays in compose, as the studio test chat's market only
The plan said to drop it from the deploy surface, but the studio test chat (out of bounds) still
fails closed in production without it, so removing it would break the teacher preview on the local
stack. Compose, env.example and try-it now describe it as the preview market only. The student
runtime never reads it, and a new stack-config test pins that. Drop it when the studio preview gets
its own market source.

### 9.4a Phase B: when the market is read
`studentMarket` is asked only after a subscription and its package are found, so a refused resolve
costs no identity read. An unknown id (no row) falls back to `global`, as planned; an identity
error fails the resolve.

### 9.4a Phase B: the identity Pick widens on TurnRuntimeHooks, not RuntimeHooks
Same reason as Phase A: the studio test chat's test satisfies `RuntimeHooks` with `learnerStatus`
only.

## Left to do
- Phase C: `/home` chat links from `subscriptions.listLiveForStudent`; `EDMATE_CHAT_AGENTS` kept
  for startable only.
- Phase D: test hygiene (coverage include for `.tsx`, playwright `--webpack`, gate test,
  devModel schemas, `deadlineSafeClock.sleep`, abort test clock, instrumentation).

Tool calls used: 36
