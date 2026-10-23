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

## Left to do
- Phase B: the student's own market from identity (`getMarket`/`studentMarket`), drop
  `EDMATE_MARKET`.
- Phase C: `/home` chat links from `subscriptions.listLiveForStudent`; `EDMATE_CHAT_AGENTS` kept
  for startable only.
- Phase D: test hygiene (coverage include for `.tsx`, playwright `--webpack`, gate test,
  devModel schemas, `deadlineSafeClock.sleep`, abort test clock, instrumentation).

Tool calls used: 36
