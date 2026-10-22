# 9.0c plan: warm the database pool at web container start

## Acceptance (verbatim)
> a fresh web container's first turn logs no background failure; a test covers it.

How it will be shown: a new unit test exercises the warm-up hook (mocked DB) and proves it runs
one real round trip before any request can arrive, and never throws even when that round trip
fails. The actual "fresh container, first turn, no log line" claim is a manual/optional check via
the existing `apps/web/e2e/stack/try-it.spec.ts` stack (docs/tasks/9.0/handoff.md) — not required
to pass this task's automated gates, since timing-based assertions on a real Docker stack are
exactly the kind of flaky wall-clock check `docs/lessons.md` warns against.

## Background (read first)
- `docs/tasks/9.0/handoff.md` ("Finding for the lead", not fixed, out of scope) is the origin
  report: `web-1 | [turn] turn.background_failed task=runner error=Error turnId=...` appears only
  on the first turn after the web container starts. A temporary (reverted) patch traced it to
  `packages/harness/src/pipeline/steps/preGuard.ts:57`: `preGuard: earlier student messages
  unavailable (timeout)`.
- Read `packages/harness/src/pipeline/steps/preGuard.ts` (`recentStudentTurns`,
  `HISTORY_TIMEOUT_MS = 50`, `HISTORY_LIMIT = 12`): **this already fails safe.** On a timeout,
  malformed read or thrown error it reports (`env.report`, cause + error name only, never text)
  and returns `[]`; the distress classifier still runs on the current message, just without
  session history context. `teacherPackageNames` (same file) has the identical fail-safe shape and
  shares the same `HISTORY_TIMEOUT_MS`. **No guard is skipped; nothing here needs to change.**
- `packages/db/src/client.ts`: `createDb` builds a `pg.Pool`; node-postgres connects lazily, on the
  first query, not at `new Pool()`. `apps/web/src/turn/runtime.ts` (`build()`) is deliberately
  lazy too (comment: "built once, lazily, on the first session or turn request, so `next build`
  and `/api/health` need no Redis or provider key"). `apps/web/src/auth/index.ts`'s
  module-singleton `getRuntime()` opens the **one shared pool** used by both sign-in and (via
  `serverDatabase()`, passed as `hooks.database` in `apps/web/src/turn/index.ts`) every turn's
  `preGuard` history read. So the first real chat turn after a cold start is very likely the pool's
  first-ever query: a fresh TCP connect + Postgres auth handshake, competing against
  `HISTORY_TIMEOUT_MS = 50`.

## Recommendation: warm the pool at container start, not widen the timeout
Add `apps/web/instrumentation.ts`, a Next.js convention file whose exported `register()` runs
once when the server process starts (supported, stable, no flag needed on Next 16.4.2 — confirmed:
no `experimental.instrumentationHook` in `apps/web/next.config.ts`). In `register()`:
- Call the existing, unmodified `serverDatabase()` export (`apps/web/src/auth/index.ts`) to reach
  the one shared pool.
- Issue one cheap, already-public, existing read on the returned `identity`/`repos` (no new
  capability, no raw pool exposure — `@edmate/db`'s public entry intentionally has "no raw
  database handle"; keep it that way) to force a real round trip before any request can be routed
  to a turn.
- Fire-and-forget (do not `await` before `register()` returns): a DB outage at boot must never
  delay or block server startup or `/api/health`. Wrap in `try`/`catch`/`.catch()`; log the error
  name only (never a message that could quote a connection string); never rethrow.

Why this over widening `HISTORY_TIMEOUT_MS`:
- `HISTORY_TIMEOUT_MS` (50 ms) is a deliberate, small slice inside the 300 ms `PRE_GUARD_SLICE_MS`
  budget ("must not eat the guards' budget" — preGuard.ts comment). Raising it to cover a cold
  TCP+auth handshake would blunt that budget for every turn, forever, to paper over a cost that
  only exists on the very first query after a cold start. It also wouldn't actually remove the
  log line, just make it rarer/less likely, and would still fire again any time the pool reconnects
  (e.g. after `DATABASE_IDLE_TIMEOUT_MS`, default 30 s, during a quiet period).
- Warming the real connection once at startup fixes the actual cause named in the 9.0 finding (a
  cold pool) without touching guard behaviour, budgets, or the fail-safe fallback, which is correct
  already and must not change (`docs/lessons.md` "A guard that can't run must fail closed, not
  open" and "A check that silently skips looks like a pass" both apply to *preserving*, not
  loosening, that fallback).
- `packages/harness` imports only `contracts`, `zod`, `mathjs` and its own modules — the fix must
  live in `apps/web` (or `@edmate/db`'s existing public surface), never in the harness.

## Files touched
- `apps/web/instrumentation.ts` (new) — `register()`: fire-and-forget warm-up query through
  `serverDatabase()`, catch-and-log only.
- `apps/web/instrumentation.test.ts` (new) — the red test below.

No other file changes. In particular: no change to `packages/harness/src/pipeline/steps/preGuard.ts`,
no change to `apps/web/src/auth/index.ts`, no change to `packages/db/**`. If the builder finds the
existing `identity`/`repos` surface from `serverDatabase()` has no sufficiently cheap read to reuse
as a warm-up ping, it may add one new, narrowly-scoped method (e.g. a trivial `SELECT 1`-style ping)
to `packages/db/src/client.ts` or `packages/db/src/index.ts` (not `identity/**` or
`repositories/**`, which are the risky DB globs) — but must not add a raw-pool escape hatch, and
must not need to touch `apps/web/src/auth/index.ts`'s exported shape to do it. Prefer reusing an
existing call; only add new surface if nothing cheap already exists.

## Files out of bounds
- `packages/harness/**` (purity rule; the fail-safe logic there is correct and out of scope)
- `packages/db/src/identity/**`, `packages/db/src/repositories/**` (risky; not needed for this fix)
- `apps/web/src/auth/**` (risky; not needed — `serverDatabase()` is used as-is, unmodified)
- `apps/web/src/turn/**` (not needed — the pool is already shared via `serverDatabase()`)
- `docs/board/tasks.yaml`, `docs/decisions/log.md` (lead's job at merge)

## Test first (red, then green)
Red: `apps/web/instrumentation.test.ts` does not exist yet / imports `../instrumentation`, which
does not exist before the fix — the test fails on a module-not-found error.
Green, once `apps/web/instrumentation.ts` exists, assert (with `serverDatabase` mocked, no real
DB, consistent with "no real model or payment calls in tests" and the DB equivalent — this task
uses a mocked DB client, never a live one):
1. Calling `register()` triggers exactly one warm-up read through the mocked `serverDatabase()`
   return value.
2. `register()` resolves (or returns) without throwing even when the mocked warm-up read rejects
   — i.e. a DB outage at boot cannot crash or hang server start.
3. `register()` does not await the warm-up to completion before returning (so startup/health are
   never blocked) — assert via a controllable (not-yet-resolved) promise from the mock, checking
   `register()` has already returned.

## Risky paths touched
None (checked against `.claude/skills/merge-gate/risk-paths.txt`): `apps/web/instrumentation.ts`
and its test match no glob there (not `apps/web/src/auth/**`, not `apps/web/app/api/webhooks/**`,
not `apps/web/app/api/staff/**`, not any `packages/harness`, `packages/db/src/identity|repositories`,
`packages/contracts`, `packages/payments`, `content/**`, or `.claude|.github|.githooks`). No ADR
needed (no contracts, tech-stack, or prompt-pack-behaviour change). No `risk: high` decision entry
is required by the risk-paths rule, but the lead may still want to log the "warm vs. widen timeout"
choice itself as a normal (not risky-path) decision, since 9.0 flagged it as a finding for the lead.

## Shared files
None of the two new files are touched by any other in-flight task as far as this plan can tell
(new files, not edits to a file another builder is mid-edit on). No coordination needed.

## Open questions
None blocking. One judgement call for the builder, stated above as a fallback only: which existing
read to reuse for the warm-up ping. Default to reuse; only add new `@edmate/db` surface if nothing
existing is cheap/safe enough, and if so keep it to a fixed, parameterless, schema-free statement
(no new "unscoped" query path).

## Budget
Budget: 50 tool calls (1 phase, apps/web)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (tests only: `corepack pnpm turbo run typecheck lint test
--filter=@edmate/web...`, and the secret scan)

## Exit conditions
Status: DONE once `apps/web/instrumentation.ts` + its test exist, the new test is red-then-green,
`corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` and
`python3 .githooks/secret-scan.py --all` are clean, and the handoff names the board's 9.0 finding
as resolved (with the reasoning above, or the builder's own if it differs). Status: PARTIAL if past
~50 tool calls, or if a cheap existing read turns out not to exist and the builder is unsure whether
a new `@edmate/db` ping method is in scope — stop and hand back rather than guessing on DB package
surface.

## Lead answers (22 Oct 2026)
- `register()` warms only when `process.env.NEXT_RUNTIME === 'nodejs'`, and imports `serverDatabase` with a dynamic `await import(...)` inside that branch, so the Edge bundle never pulls in pg. Add a test that the Edge (or unset) runtime does no read.
- With no database configured (for example a build step), the warm-up logs one line by error name and returns; it never throws.
- The "fresh container's first turn logs no background failure" check is manual: say in the handoff's Left to do that it runs in the pilot try-it run. Never touch the running edmate-* containers.
