# Task 3.14: durable, shared message and rate counters for `admit`/`entitle`

Board: `board.py show 3.14` · M7 · deps 3.2 (done) · branch `m7/3.14-durable-counters` · planner: sonnet.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Durable, shared message and rate counters for admit (replace the in-memory windows from
3.2) before the pilot; a contracts port with ADR-0005 if needed"
Accept: "Daily message limits survive a restart and hold across web processes; tests prove it
against real Postgres or Redis."

Note: the board's "ADR-0005" is stale — ADR-0005 was taken by 3.15 (Transcriber + session help
state) after 3.14 was written onto the board. The next free number is **ADR-0008** (0006
SafetyEventSink/4.4 is in review, 0007 leakCheck/4.6 is being built). This plan's recommendation
(below) is that no ADR is needed at all; if the lead disagrees, renumber to 0008.

### How it is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| Durable across a restart | Integration test: take N slots on one `redisTurnCounter` instance/connection, close it, open a **second**, independent connection to the same Redis against the same key, and show the count (and the remaining budget) is unchanged — simulating a process restart. |
| Shared across processes | Same test, with two live connections open at once: concurrent `tryTake` calls from both see each other's takes (one global count per key, not per connection). |
| Atomic under concurrency | Integration test: fire `max + k` concurrent `tryTake` calls (same key, two separate connections) and assert exactly `max` succeed, with no double-grant race — proves the Lua `EVAL` script is atomic, not a check-then-write across two round trips. |
| Exact window semantics preserved | Same boundary cases as `limits.test.ts` (3.2), against real Redis: a take at `now − windowMs − 1 ms` doesn't count, one at `now − windowMs + 1 ms` does; a refused take is never recorded. `now` is passed into the script as an argument (not `TIME`/server clock), so the test drives it without waiting on wall-clock time. |
| Bounded memory | A key with no live takes expires from Redis (TTL set to the window on every write) — shown by checking key TTL/absence after the window, not by growth of `keys`-style introspection (the in-memory `SlidingWindow.keys`/`count()` accessors don't carry over; Redis needs no sweep). |
| Drop-in interface | `redisTurnCounter`/`redisTurnLimits` implement the existing `TurnCounter`/`TurnLimits` from `@edmate/harness` unchanged; `admit.ts`/`entitle.ts` need no code change — only the composition root's choice of adapter changes. |
| No contracts change | `packages/contracts/**` untouched; `TurnCounter`/`TurnLimits` stay harness-owned types (3.2's deliberate choice), consumed by `packages/queue` as a regular dependency on `@edmate/harness`, the same pattern `packages/content` already uses in production code (not just tests). |
| Gates | `turbo run typecheck lint test --filter=@edmate/queue...` green, including the new integration suite gated on `TEST_REDIS_URL` (fails, not skips, in CI without Redis — same convention as `apps/worker/test/commit.int.test.ts`); root secret scan clean; no real Redis calls in the package's existing unit tests (only the new, explicitly-named integration file). |

## Design

### What's already built (read only)
- `packages/harness/src/pipeline/limits.ts` (3.2): `TurnCounter` (`tryTake(key, max): boolean | Promise<boolean>`, documented as atomic — "checks and records in one call" — and that "a durable implementation may return a promise"), `TurnLimits { rate, messages }`, the in-memory `slidingWindow`/`createTurnLimits(clock)`. 3.2's own decision log entry: *"3.14 swaps the counter (the interface allows an async `tryTake`)"* — the interface was built for exactly this swap; it does not change.
- `admit.ts` calls `deps.limits.rate.tryTake(input.studentId, RATE_LIMIT_TURNS)` (10/60 s, skipped for `eval`); `entitle.ts` calls `deps.limits.messages.tryTake(`${e.studentId}:${e.packageId}`, cfg.value.pkg.dailyMessageLimit)` (rolling 24 h, subscriptions only). Neither step changes for this task.
- `packages/harness/src/pipeline/policies.ts`: `admitFailure`/`entitleFailure` already convert **any** throw or step timeout (not just a thrown `TurnRejection`) into `rate_limited`/`no_access`, both `retryable: true`. `runner.ts`'s `runWithTimeout` races the step against its 50 ms budget on the injected clock. **This means the fail-open-vs-fail-closed question is already answered by existing, tested code**: a counter that throws or doesn't resolve in time already fails the turn closed (never silently lets it through), and marks it retryable so a brief outage just means "try again in a moment." The new adapter only has to let failures propagate (not swallow them into a silent `true`); no new fail-open/fail-closed logic is needed or should be added.
- `packages/contracts/src/ports.ts`: no counter/limit port exists there today (`EntitlementStore`, `TurnConfigStore`, etc. are all resolved-value stores, not take-a-slot counters). `packages/content/src/promptPacks.ts` already depends on `@edmate/harness` as a **production** dependency (`packages/content/package.json` `dependencies`, not `devDependencies`) for its types/functions — the precedent for a non-harness package consuming a harness-owned type in real code, not just tests.
- `packages/queue` (3.8): the only package that already talks to Redis/BullMQ in production (`bullmq` dependency; `apps/worker` holds the raw `ioredis` connection and hands `ConnectionOptions` — which BullMQ accepts as a live `Redis` instance — to `createTurnQueues`). `docker/compose.yaml` already runs Redis; CI already runs a pinned Redis service and sets `TEST_REDIS_URL` for every package's `test` task (`turbo.json`'s `test.env`), the same convention `apps/worker/test/commit.int.test.ts` uses (fail, not skip, in CI; a local `compose.port.yaml`-style override for dev).
- No production composition root exists yet that wires `PipelineDeps` for real traffic (confirmed: `createTurnLimits` is only ever called from `packages/harness/src/testing/testSteps.ts` and tests). 3.8's plan flagged the same gap. So "migration" here means: build the durable adapter and document it as the one a future composition root (`apps/web`'s turn route or similar, not yet built) must choose instead of `createTurnLimits` — it does not mean editing a composition root that doesn't exist.

### Redis vs Postgres — recommend Redis, no ADR
- **Redis** is already deployed, already a dependency of the one package (`packages/queue`) that talks to it, and gives O(1) atomic primitives (`EVAL`/Lua, or `ZADD`/`ZREMRANGEBYSCORE`/`ZCARD` wrapped in one script) that match the existing sliding-window-log semantics exactly, with a server round trip well under the 50 ms step budget.
- **Postgres** would need a row per key with either advisory locks or `SELECT ... FOR UPDATE` plus window math on every single admitted turn and every subscription message — extra write/lock load on the primary OLTP database for a purely operational counter, competing with real student/teacher data, and a bigger, harder-to-make-atomic implementation (sliding window in SQL is a real query, not one round trip) for no durability benefit Redis doesn't already give (Redis here runs `appendonly yes`, so it already persists across restarts — see `docker/compose.yaml`). Recommend against it; call out as the one explicit design choice if the lead wants Postgres instead for operational reasons (e.g. one fewer moving part to operate) — reversible either way since both sit behind `TurnCounter`.
- **Port shape / ADR**: recommend **no ADR and no contracts change**. `TurnCounter`/`TurnLimits` are harness-owned types (3.2's explicit decision not to add a contracts port), and `packages/queue` can depend on `@edmate/harness` as a regular (non-dev) dependency to import them, exactly as `packages/content` already does. Rule 2 (contracts/ADR) only bites when `packages/contracts/**` or the tech stack changes; neither does here. This is the one quasi-architectural call in this task — flagged below as an open question with this recommendation, in case the lead would rather promote it to a contracts port now (e.g. so `packages/db` could also implement it without a harness dependency).

### The adapter
- New file `packages/queue/src/turnLimits.ts`, exported from `src/index.ts`: `redisTurnCounter(redis: Redis, opts: { windowMs: number; prefix?: string }): TurnCounter` and `redisTurnLimits(redis: Redis, opts?: { prefix?: string }): TurnLimits` (builds `rate` on `RATE_LIMIT_WINDOW_MS` and `messages` on `MESSAGE_WINDOW_MS`, both from `@edmate/harness`).
- One Lua script (`redis.defineCommand`), run as a single `EVAL`, taking `key`, `windowMs`, `max`, `now` (passed by the caller, not `redis.call('TIME')` — keeps the adapter testable with an injected/fake `now` the same way `slidingWindow` takes `clock.now()`, and keeps every Redis node's count comparable regardless of clock skew): `ZREMRANGEBYSCORE key -inf (now-windowMs)`; `ZCARD key`; if `< max`, `ZADD key now member` (member unique per take, e.g. `${now}-${random}`, since two takes can share the same millisecond) and `PEXPIRE key windowMs`, return 1; else return 0. One round trip, atomic (Redis runs Lua single-threaded), matches `tryTake`'s documented "checks and records in one call" contract exactly.
- Keys are namespaced (`${prefix ?? 'edmate:turnlimit'}:${key}`) so they can't collide with BullMQ's own keyspace on the same Redis instance, and so tests can isolate with a `prefix` the way `createTurnQueues` already does.
- `packages/queue/package.json` gains a direct `ioredis` dependency (version-pinned to match `apps/worker`'s `6.0.0`) — today it only depends on `bullmq`, which bundles `ioredis` transitively; importing it directly needs it declared.

### Timezone — already resolved by the spec, not an open question
`PackageConfig.dailyMessageLimit` is documented in both the build plan (`rolling 24-hour window; default 20`) and `entitle.ts`'s own comment as a **rolling** 24 h window, not a calendar day reset at local midnight — this is unchanged by 3.14 and matches the current in-memory implementation (a sliding log keyed off epoch milliseconds, not a day boundary). `LocalePack.timezone` (IANA zone) exists in contracts but is not and should not become an input here: there is no "midnight in the student's timezone" concept to get right, so no timezone handling is needed in the Redis adapter either. Flagging this explicitly so it isn't mistaken for an open gap.

### Migration from the in-memory windows
- `createTurnLimits(clock)` stays: it remains the default for `testDeps()`/`testSteps()` (harness and dependent-package unit tests) and any non-pilot caller (CLI dev usage, evals) that doesn't need cross-process sharing. No behavioural change to `packages/harness`.
- `packages/harness/README.md`'s "Limits" paragraph (task 3.2) gets one line pointing at `@edmate/queue`'s `redisTurnLimits` as the durable option, replacing "task 3.14 makes the daily count durable" with what actually shipped.
- No composition-root file changes: as under "What's already built," no app wires real `PipelineDeps` yet. Out of bounds (see below).

## Files

Create:
- `packages/queue/src/turnLimits.ts` (`redisTurnCounter`, `redisTurnLimits`, the Lua script)
- `packages/queue/test/turnLimits.int.test.ts` (real Redis, gated on `TEST_REDIS_URL`; atomicity, durability-across-connections, window-boundary, TTL/cleanup cases)
- `packages/queue/test/turnLimits.test.ts` only if there's unit-testable logic that doesn't need a live Redis (e.g. key-prefix construction, option validation mirroring `slidingWindow`'s `windowMs` guard); the core take/atomicity logic is proven by the integration suite, matching how this repo already proves SQL-heavy logic only against a real Postgres (`packages/db`'s `*.int.test.ts`), not a mock.

Modify:
- `packages/queue/src/index.ts` (export the new adapter)
- `packages/queue/package.json` (add `ioredis` dependency)
- `packages/harness/README.md` ("Limits" paragraph, task 3.2 section)
- `docs/decisions/log.md` (new entries on merge)

Out of bounds:
- `packages/contracts/**`, `docs/adr/**` — no port/ADR change (see recommendation above).
- `packages/harness/**` — `TurnCounter`/`TurnLimits`/`admit.ts`/`entitle.ts` are unchanged; this task only adds a second implementation of an existing interface.
- `packages/db/**` — no Postgres path built (Redis recommended instead); no migration.
- `apps/web/**`, `apps/cli/**` — no composition root exists yet to inject the new adapter into real `PipelineDeps` (same gap 3.8 and 3.13 flagged); wiring it up is for whichever task first stands up a real web/CLI composition root.
- Strikes / `safety_events` (4.4, B-12) — untouched; `TurnCounter` stays a generic `tryTake(key, max)` so a future strikes counter could reuse it, but this task does not build one.

## Tests first (tdd-guide order)
1. `packages/queue/test/turnLimits.int.test.ts`: start from the exact 3.2 boundary cases (`limits.test.ts`) re-expressed against real Redis with an injected `now`, then add the concurrency (atomicity) and durability-across-connections cases, then TTL/cleanup, then write `turnLimits.ts` to pass them.
2. Any small option-validation unit test (if applicable), then the corresponding guard in `turnLimits.ts`.
3. `packages/harness/README.md` update (doc-only, no test).
4. Full gate: `turbo run typecheck lint test --filter=@edmate/queue...`.

## Risky paths touched
None (checked against `.claude/skills/merge-gate/risk-paths.txt`): this plan touches only `packages/queue/**`, which is not listed, and explicitly avoids `packages/contracts/**`, `docs/adr/**`, `packages/db/src/repositories/**`, `packages/harness/src/{guardrails,access,pedagogy}/**`, and `.claude/**`/`.github/**`/`.githooks/**`.
If the lead instead decides this needs a contracts port (see Open Q1), that flips `packages/contracts/**` and `docs/adr/**` risky, requiring **architect, security-reviewer, typescript-reviewer** named in `review.md` and a `risk: high` decision in the handoff, per rule 2/6.

Recommended reviewers even though no path is mandatory here (this is explicitly "before the pilot" anti-abuse/cost-control infra): **typescript-reviewer** (async `TurnCounter` parity, `ioredis` typing) and **code-reviewer**/**silent-failure-hunter** (must confirm a Redis error truly propagates to fail the turn closed, never resolves `true`/`false` on a swallowed catch). Not mandated by `merge_gate.py`, but worth asking for given the stakes.

## Open questions (recommendations)

- **Q1 Contracts port now, or keep it harness-owned?** Recommend **keep it harness-owned** (no ADR): `TurnCounter` was deliberately left out of contracts at 3.2, the interface already supports an async durable implementation, and `packages/content`'s existing production dependency on `@edmate/harness` is direct precedent for `packages/queue` doing the same. Promoting it to a contracts port would only matter if a second, non-harness-dependent package (e.g. `packages/db`) needed to implement `TurnCounter` too — nothing in this task needs that. Risk if wrong: low and reversible (an interface move, no data/schema implication).
- **Q2 Redis vs Postgres.** Recommend **Redis** (see Design) — already deployed, already a `packages/queue` dependency, atomic Lua script matches the exact sliding-window-log semantics with one round trip, and `appendonly yes` already gives it restart durability. Postgres is the fallback if the lead wants one fewer piece of infrastructure in play, but it adds OLTP write load and a harder-to-get-right atomic sliding window for no durability gain here.
- **Q3 Exact sliding log vs an approximate fixed-bucket counter.** Recommend keeping the **exact** sliding-window-log (ZSET) algorithm 3.2 already ships and tests, rather than switching to a cheaper approximate "two fixed buckets" counter — correctness parity with existing tests matters more here than the (small) extra Redis memory of up to `max` entries per key.

Everything else in this task (key naming, Lua script shape, test file names) is an implementation detail for the builder, not a decision needing the human.
