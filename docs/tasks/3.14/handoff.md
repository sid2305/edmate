# Task 3.14 handoff: durable, shared message and rate counters for `admit`/`entitle`

Status: **DONE**
Branch: `m7/3.14-durable-counters`
Worktree: this task's `.claude/worktrees/` checkout of `edmate` (agent worktree)

Board note: the board's "ADR-0005" reference (task 3.14's title line) is stale — ADR-0005 was
taken by 3.15 (Transcriber + session help state) after 3.14 was written. Per the lead's answer, no
ADR is used at all for this task (see Decisions below).

## What shipped

- `packages/queue/src/turnLimits.ts`: `redisTurnCounter(redis, { windowMs, prefix?, now? })` and
  `redisTurnLimits(redis, { prefix?, now? })`, implementing `@edmate/harness`'s existing
  `TurnCounter`/`TurnLimits` interfaces (task 3.2) unchanged. One Lua script (`ZREMRANGEBYSCORE` +
  `ZCARD` + conditional `ZADD`/`PEXPIRE`), run as a single atomic `EVAL` via `redis.defineCommand`;
  `now` is passed in by the caller (never `redis.call('TIME')`), so tests drive the window without
  waiting on real time, and every Redis node's count is comparable regardless of clock skew. Keys
  are namespaced `${prefix ?? 'edmate:turnlimit'}:${key}`; `redisTurnLimits` gives `rate` and
  `messages` their own sub-namespace (`${prefix}:rate` / `${prefix}:messages`) so the two counters'
  keys can never collide even if a caller reused the same raw key for both (see Decisions).
- `packages/queue/test/turnLimits.int.test.ts`: 14 tests against real Redis (gated on
  `TEST_REDIS_URL`, fails — not skips — when `CI=true` and Redis is unreachable, same convention as
  `apps/worker/test/commit.int.test.ts`). Covers: the exact `limits.test.ts` (3.2) boundary cases
  re-expressed with an injected `now`; durability across a closed-then-reopened connection
  (simulated restart); two live connections sharing one global count; a `max + k` concurrent race
  that grants exactly `max`; TTL/key-expiry (bounded memory); a refused take never recorded;
  `redisTurnLimits`'s rate/messages windows and sub-namespacing; and the construction/default-value
  guards. Explicit per-test timeout of 5 000 ms on every test (the plan's floor).
- `packages/queue/vitest.config.ts`: detects Redis reachability the same way `packages/db`'s config
  detects Postgres (`integrationRuns()`); without Redis locally, `turnLimits.ts` is excluded from
  the coverage thresholds instead of failing the package's 100% gate; CI always has Redis and
  enforces it.
- `packages/queue/package.json`: `@edmate/harness` moved from `devDependencies` to `dependencies`
  (the same pattern `packages/content` already uses for the same reason — depending on a
  harness-owned type/function in production code, not just tests); `ioredis` added at `6.0.0`,
  pinned to match `apps/worker`'s version (today bundled transitively through `bullmq`).
- `packages/queue/src/index.ts`: exports `redisTurnCounter`, `redisTurnLimits`,
  `RedisTurnCounterOptions`.
- `packages/harness/README.md`: the "Limits" paragraph (task 3.2 section) now points at
  `@edmate/queue`'s `redisTurnCounter`/`redisTurnLimits` as the durable option a pilot composition
  root wires in, instead of the stale "task 3.14 makes the daily count durable" forward-reference.
- No change to `packages/contracts/**`, `docs/adr/**`, `packages/harness/src/**` (other than the
  README paragraph), `packages/db/**`, `apps/web/**` or `apps/cli/**` — all out of bounds per the
  plan; no composition root exists yet to wire a real `PipelineDeps.limits`.

## Acceptance evidence

| Item (plan's table) | Evidence |
|---|---|
| Durable across a restart | `packages/queue/test/turnLimits.int.test.ts` → `durable across a restart: a second, independent connection sees the same count` — takes 3/3 on one connection, `quit()`s it, opens a second independent connection to the same key, and a 4th take still returns `false`. **Passed** (`Tests  40 passed (40)`, full suite run below). |
| Shared across processes | Same file → `shared across processes: two live connections see the same, global count for one key` — two live connections racing/alternating see each other's takes (one global count per key). **Passed.** |
| Atomic under concurrency | Same file → `atomic under concurrency: max + k concurrent takes on two connections grant exactly max` — `max=5`, `extra=7`, 12 concurrent `tryTake` calls split across 2 connections; `results.filter(Boolean)` has length exactly 5, `results.filter(r => !r)` has length exactly 7. **Passed.** |
| Exact window semantics preserved | Same file → the three tests re-expressing `limits.test.ts`'s boundary cases (`allows max takes...`, `slides: each take expires...`, `a take at now-windowMs-1 does not count; one at now-windowMs+1 does`), all driven by an injected `now` (no real time elapses). **Passed.** |
| Bounded memory | Same file → `bounded memory: a key with no live takes expires from Redis (TTL set on every write)` — asserts `PTTL` is set (`> 0`, `<= windowMs`) right after a take, then `EXISTS` is `0` once the real window has elapsed (a 200 ms window, since `PEXPIRE` runs on Redis's own clock, not the injected `now`). **Passed.** |
| Drop-in interface | `turbo run typecheck --filter=...@edmate/queue` is clean: `redisTurnCounter`/`redisTurnLimits` type-check as `TurnCounter`/`TurnLimits` with no cast; `admit.ts`/`entitle.ts` are untouched (`git diff --stat` shows no `packages/harness/src/pipeline/{admit,entitle}.ts` changes). |
| No contracts change | `git diff --stat` (below) — `packages/contracts/**` does not appear. |
| Gates | `turbo run typecheck lint test --filter=...@edmate/queue --filter=...@edmate/harness --force` → `Tasks: 34 successful, 34 total` (includes `@edmate/queue`, `@edmate/harness`, `@edmate/db`, `@edmate/worker`, `@edmate/content`, `@edmate/gateway`, `@edmate/cli` — every dependent). Root secret scan: `python3 .githooks/secret-scan.py --all` → no output, exit 0. No real Redis calls in the package's existing unit tests — only `turnLimits.int.test.ts` opens a connection (`grep -L ioredis packages/queue/test/*.test.ts` confirms `adapters.test.ts`, `queues.test.ts`, `latency.test.ts` have no `ioredis` import). |

### Commands run (trimmed output)

```
$ docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml \
    -f apps/worker/test/compose.port.yaml up -d postgres redis
 Container edmate-redis-1 Started
 Container edmate-postgres-1 Started

$ TEST_REDIS_URL=redis://127.0.0.1:56379 pnpm --filter=@edmate/queue exec vitest run --coverage
 ✓ test/queues.test.ts (2 tests)
 ✓ test/adapters.test.ts (23 tests)
 ✓ test/latency.test.ts (1 test)
 ✓ test/turnLimits.int.test.ts (14 tests)
 Test Files  4 passed (4)
      Tests  40 passed (40)
 All files          |     100 |      100 |     100 |     100 |
  turnLimits.ts     |     100 |      100 |     100 |     100 |

# Redis unreachable, CI unset: skips (not fails), coverage excludes turnLimits.ts, still green
$ docker compose ... stop redis && pnpm turbo run test --filter=@edmate/queue --force
 [@edmate/queue] turnLimits integration SKIPPED: no Redis at TEST_REDIS_URL ...
 Tests  26 passed | 14 skipped (40)
 All files          |     100 |      100 |     100 |     100 |   (turnLimits.ts excluded)

# Redis unreachable, CI=true: fails (not skips) — the required convention
$ CI=true pnpm --filter=@edmate/queue exec vitest run test/turnLimits.int.test.ts
 Error: CI=true but Redis (TEST_REDIS_URL) is unreachable
 Test Files  1 failed (1)

$ docker compose ... up -d postgres redis   # back up for the full gate
$ TEST_REDIS_URL=redis://127.0.0.1:56379 TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate \
    pnpm turbo run typecheck lint test --filter=...@edmate/queue --filter=...@edmate/harness --force
 Tasks:    34 successful, 34 total

$ python3 .githooks/secret-scan.py --all
 (no output, exit 0)

$ git diff --stat
 packages/harness/README.md      |  2 +-
 packages/queue/package.json     |  3 ++-
 packages/queue/src/index.ts     |  1 +
 packages/queue/vitest.config.ts | 52 ++++++++++++++++++++++++++++++++++-------
 pnpm-lock.yaml                  |  9 ++++---
 5 files changed, 53 insertions(+), 14 deletions(-)
 (plus new files: packages/queue/src/turnLimits.ts, packages/queue/test/turnLimits.int.test.ts)
```

## Deviations from the plan

- The plan's key-naming sketch was a single namespace (`${prefix ?? 'edmate:turnlimit'}:${key}`)
  shared by both counters; `redisTurnLimits` instead gives `rate` and `messages` their own
  sub-namespace. Flagged as a Decision below (low risk, implementation detail per the plan's own
  "everything else ... is an implementation detail for the builder").
- `packages/queue/vitest.config.ts` went from a static config object to the async,
  Redis-reachability-detecting shape `packages/db`'s config already uses for Postgres, so the
  package's 100% coverage gate still passes locally without Docker. Not called out in the plan's
  "Files" list by name, but required to keep `turbo run test --filter=@edmate/queue` green without
  a live Redis, matching the `packages/db` precedent the plan itself points at ("this repo already
  proves SQL-heavy logic only against a real Postgres ... not a mock").
- No other deviation: `admit.ts`/`entitle.ts`/`packages/harness/src/**` untouched,
  `packages/contracts/**` untouched, no ADR added, no composition root touched.

## Decisions

### 19 Oct 2026 · 3.14 No ADR; Redis over Postgres; harness-owned `TurnCounter` · decided by lead (plan's Q1–Q3) · risk: low
- Decided: `TurnCounter`/`TurnLimits` stay harness-owned types (no contracts port, no ADR);
  `packages/queue` depends on `@edmate/harness` as a production dependency to consume them,
  exactly as `packages/content` already does; the durable adapter is built on Redis with an exact
  sliding-window-log (ZSET), not Postgres or an approximate bucket counter.
- Why: Redis is already deployed and already a `packages/queue` dependency; one atomic Lua `EVAL`
  matches the existing sliding-window-log semantics with a single round trip well under the 50 ms
  step budget; `appendonly yes` (see `docker/compose.yaml`) already gives restart durability.
  Promoting `TurnCounter` to a contracts port would only matter if a second, non-harness-dependent
  package needed to implement it — nothing today does.
- Alternatives: a contracts port (ADR-0008); Postgres with row locks/`SELECT ... FOR UPDATE`; an
  approximate fixed-bucket counter instead of the exact log.
- Reversible: yes — both the port-vs-type question and Redis-vs-Postgres sit behind the unchanged
  `TurnCounter` interface; swapping either later needs no `admit.ts`/`entitle.ts` change.

### 19 Oct 2026 · 3.14 Stale board "ADR-0005" reference · decided by builder (flagged by plan) · risk: low
- Decided: the board's task 3.14 title line's "ADR-0005" mention is stale (ADR-0005 belongs to
  3.15); no ADR is created for 3.14.
- Why: ADR-0005 was assigned to 3.15 (Transcriber + session help state) after 3.14 was written onto
  the board; the lead's answer confirms no ADR is needed here regardless of numbering.
- Alternatives: renumber and use ADR-0008 for this task (the plan's fallback if the lead preferred
  a contracts port); not taken, since the lead agreed no ADR is needed at all.
- Reversible: yes — a future task can still add a contracts port with its own ADR if a second
  package ever needs to implement `TurnCounter` without a harness dependency.

### 19 Oct 2026 · 3.14 Separate key sub-namespace for rate vs. messages · decided by builder · risk: low
- Decided: `redisTurnLimits` gives its `rate` and `messages` counters distinct key sub-namespaces
  (`${prefix}:rate:*`, `${prefix}:messages:*`) instead of one shared namespace.
- Why: `admit`'s rate key (`studentId`) and `entitle`'s message key (`studentId:packageId`) are
  unlikely to collide by convention alone, but the plan's own spec doesn't rule out a caller or
  future use reusing the same raw string for both; a cheap, explicit sub-namespace removes the
  possibility entirely rather than relying on callers to always differ.
- Alternatives: the plan's literal single-prefix sketch (`${prefix}:${key}` for both); not taken,
  since it leaves an avoidable (if currently unlikely) collision path.
- Reversible: yes — an internal key-naming detail behind `TurnCounter`/`TurnLimits`; no external
  contract depends on the exact Redis key shape.
