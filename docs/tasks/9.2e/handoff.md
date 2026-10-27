# 9.2e handoff

## Phase 1 (apps/web only)

Status: DONE (Phase 1 only; Phase 2 — items 1, 2, 5, the `LanguageTag` re-export, and the
`searchParams.ts` half of item 7 — is still to do, after 9.3m merges).

### Summary

- `apps/web/src/discovery/rateLimit.ts` (item 6): `INCR` + conditional `PEXPIRE` is now one
  atomic `EVAL` via `redis.defineCommand`, mirroring `packages/queue/src/turnLimits.ts`'s Lua-script
  pattern (no `redis.call('TIME')`; the fixed-window algorithm is unchanged). `new Redis(url, …)`
  now also sets `connectTimeout`/`commandTimeout` (1000 ms each) so `allow()` can't hang ~10 s
  before failing open.
- `apps/web/src/discovery/rateLimit.test.ts` (item 6): replaced the two-call `incr`/`pexpire` mock
  with one that simulates the defined Lua command, asserting the TTL is set exactly once
  (including under two concurrent `increment` calls on the same key); added a case asserting
  `new Redis(...)` is called with `connectTimeout`/`commandTimeout` (mocks the `ioredis` module,
  no real connection).
- `apps/web/src/discovery/nav.ts` (item 8): added `staff: '/staff'` to `ROLE_HOME` (a literal
  path, no new `src/auth/**` export).
- `apps/web/src/discovery/nav.test.ts` (item 8, new file): four cases — anonymous → sign-in (no
  sign-out action), student/teacher/staff → their home (each with a sign-out action).
- `apps/web/app/teachers/page.tsx` (item 7, page.tsx half only): `repos.discovery.search(...)` is
  now wrapped in a narrow `.catch` that returns `{ teachers: [], hasMore: false }` only when the
  rejection is a `RepositoryError` with `kind === 'scope'` (per the 9.2a scope decision: never
  distinguishable from "not found"); any other error still propagates.
- `apps/web/app/teachers/page.test.tsx` (item 7): added a case where `repos.discovery.search`
  rejects with `RepositoryError('scope', 'discovery.search')` and the page still renders the empty
  state; the existing "propagates a repository error" case (a plain `Error`) is unchanged and
  still passes, keeping the catch narrow.

`searchParams.ts`, `packages/db/**` and everything under `apps/web/app/staff`/`app/api/staff` were
not touched, per the lead amendment and the "other builders" note.

## Gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web` — green (10/10 tasks
  successful; the three touched test files pass, 35/35 tests).
- `corepack pnpm exec prettier --check` on the changed files — green (prettier `--write` was run
  once to fix formatting on `rateLimit.ts`, `rateLimit.test.ts` and `page.test.tsx`, then
  `--check` passed clean).
- `python3 .githooks/secret-scan.py --all` — clean, no output.

## Decisions

### 26 Oct 2026 · 9.2e rate-limit timeout values · decided by builder · risk: low
- Decided: `connectTimeout` and `commandTimeout` are both 1000 ms (not the plan's illustrative
  "~10 s" ceiling, just a bound well under it).
- Why: the plan only specifies that a hang must be bounded well below ~10 s; 1 s keeps the public
  `/teachers` page responsive even during a Redis outage (the limiter fails open on any store
  error per the existing module doc), without being so short it risks spurious timeouts under
  normal load. No spec or existing convention named an exact number, so this is logged rather than
  escalated.

## Budget

Tool calls used: 24
