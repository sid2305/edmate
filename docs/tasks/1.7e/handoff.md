# 1.7e handoff — Phase A

## Status: DONE (Phase A)

## Summary
Reproduced 1.7b's Turbopack build trial (`next build`, no `--webpack`) against today's `main`
(Next 16.4.2). The lightningcss/`apps/web/vitest.config.ts` ESM-chunk error 1.7b hit no longer
reproduces: `next build` compiles successfully (exit 0), finishes page-data collection and static
generation, and prints only 47 pre-existing "Node.js API used ... not supported in the Edge
Runtime" warnings (the same ones `--webpack` also prints for the same files, e.g.
`apps/web/src/auth/index.ts:77` using `process.cwd()`, `packages/db/dist/client.js:56` using
`process.stderr`) — not build failures. No narrow fix was needed; the upstream Next.js/Turbopack
bug this plan expected to work around appears to have already been fixed between 1.7b and today's
`next`/`turbopack` versions.

Root cause found: none remaining — the bug 1.7b logged is gone upstream. (First repro attempt via
bare `pnpm --filter @edmate/web exec next build` failed with `Can't resolve '@edmate/queue'` etc.;
that was this worktree's workspace packages not yet built, not a Turbopack bug — resolved by
building through `turbo run build --filter=@edmate/web...` once, which builds dependencies first.)

Changed `apps/web/package.json`'s `build` script from `next build --webpack` to plain `next build`
(Turbopack). Rewrote `apps/web/next.config.ts`'s header comment to state the real, current outcome
(was: "kept on --webpack for 1.7b"; now: Turbopack builds clean as of 1.7e, with the full history
kept for context).

Evidence (`corepack pnpm --filter @edmate/web exec next build`, after dependencies built):
```
▲ Next.js 16.4.2 (Turbopack)
✓ Compiled successfully in 1382ms
  Finished TypeScript in 2.5s ...
✓ Generating static pages using 7 workers (3/3) in 74ms
Turbopack build encountered 47 warnings:
... (all "A Node.js API is used ... not supported in the Edge Runtime", none fatal)
```
Exit code: 0. No `lightningcss` or `vitest.config.ts` mention anywhere in the log.

`build-smoke` (`corepack pnpm turbo run build-smoke --filter=@edmate/web --force`) **runs** (not
skipped — its TCP-reachability check finds something listening on the default
`TEST_DATABASE_URL` host/port) but **fails** with `Error: SASL: SCRAM-SERVER-FIRST-MESSAGE: client
password must be a string` from `pg`'s auth handshake. This is a local Postgres
credentials/environment issue in this worktree, not a bundler regression: I reproduced the
*identical* failure with the build script reverted to `next build --webpack` (confirmed, then
restored to plain `next build`), so the build-smoke failure predates and is orthogonal to this
task's change. CI's own Postgres service (`.github/workflows/ci.yml`, `TEST_DATABASE_URL:
postgres://edmate:edmate-ci@localhost:5432/edmate`) supplies real credentials that this local
worktree doesn't have (`docker/compose.yaml`'s Postgres service also has no published host port by
default, so there is no documented way to point a local build-smoke run at a real dev stack from
inside a worktree without starting docker, which this task's brief disallows). I did not attempt to
fix this — it is out of this plan's scope (no file in the plan's list touches test/DB
infrastructure) and the brief forbids running `docker`/`docker compose` from this worktree.

## Decisions

### 26 Oct 2026 · 1.7e Turbopack build already fixed upstream · decided by builder · risk: low
- Decided: Switch `apps/web/package.json`'s `build` script to plain `next build` (Turbopack,
  no `--webpack`), since the lightningcss/`vitest.config.ts` error 1.7b logged as the reason to
  stay on `--webpack` no longer reproduces against today's `main`/Next 16.4.2. No new workaround
  was added; the old one was simply removed, matching Q1's recommendation (not a tech-stack
  change, no ADR needed).
- Why: the board's acceptance explicitly allows this branch ("plain next build succeeds and
  build-smoke passes" vs. "the reason to stay on --webpack is logged"); build succeeds cleanly and
  build-smoke's one local failure is proven environment-only (identical on both bundlers), so there
  is no bundler-specific reason left to stay on `--webpack` for the build.

### 26 Oct 2026 · 1.7e build-smoke local Postgres gap not fixed · decided by builder · risk: low
- Decided: Leave the local build-smoke Postgres/SASL failure unfixed and logged, rather than
  starting docker or guessing at credentials, since fixing it isn't in this plan's files-to-modify
  list and the brief bars `docker`/`docker compose` from this worktree.
- Why: the failure reproduces identically on `--webpack` and plain `next build`, so it is not a
  Turbopack regression this task needs to fix; CI already runs build-smoke against a real Postgres
  service with the right credentials, so the pilot's real gate (CI) is unaffected by this local gap.

## Gate
- `corepack pnpm turbo run typecheck lint test build --filter=@edmate/web` — **PASS**, 11/11 tasks
  successful.
- `corepack pnpm turbo run build-smoke --filter=@edmate/web --force` — runs (not skipped), **fails**
  on a local-only Postgres SASL/credentials error, reproduced as pre-existing/bundler-independent
  (see Summary). Not part of the brief's required gate command list; run as the plan's own
  acceptance evidence.
- `corepack pnpm exec prettier --check apps/web/package.json apps/web/next.config.ts` — **PASS**,
  "All matched files use Prettier code style!".
- `python3 .githooks/secret-scan.py --all` — **PASS**, no output (clean).

## Budget
Phase A tool calls used: 21

## Phase B

Status: PARTIAL

Dev-mode bug not fixed: the fix this plan expected to try (`serverExternalPackages`) was tried and
confirmed not to clear it, as the plan's own exit condition (b) anticipates. Calling this `DONE`
would be accurate per the letter of exit condition (b) (exact error quoted, comment rewritten, not
left stale), but the result is the same crash as before with no code change that fixes it, so
`PARTIAL` with the full finding below gives the lead the clearer signal that the dev-mode bug
itself is still open for a follow-up task (see Decisions).

### Setup note
First re-ran Phase A's `build-smoke` with `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate`
set (brief step), since Phase A's handoff reported a local SASL/credentials failure. With that
variable correctly exported, `corepack pnpm turbo run build-smoke --filter=@edmate/web --force`
**runs (not skipped) and passes**: `3 passed (3)` across `test/build-smoke.test.ts` and
`test/lighthouse-a11y.test.ts`. Phase A's reported SASL failure was this worktree's shell not
having `TEST_DATABASE_URL` exported when it ran that command, not a real Postgres/credentials gap
or a bundler regression — the local Postgres at that address was reachable and correct all along.

### Summary
Reproduced 9.4a's finding against today's `main` (after Phase A's Turbopack-build switch):
`next dev --webpack -p <port>` with the same env Playwright's `webServer` sets, then `GET
/api/health`, returns **500**, `Module not found: Can't resolve 'crypto'` from
`bullmq/dist/esm/classes/bun-redis-client.js`, reached via `instrumentation.ts -> src/auth/index.ts
-> src/auth/rate-limit.ts -> @edmate/queue -> bullmq` (red, matches 9.4a and the plan).

Tried the plan's first fix: added `@edmate/queue`, `bullmq`, `ioredis` to
`apps/web/next.config.ts`'s `serverExternalPackages`. Re-ran the same repro: the `crypto` error on
bullmq was gone, but `/api/health` still 500'd, now on `Module not found: Can't resolve 'fs'` from
`pg-connection-string` (`packages/db` -> `pg` -> `pg-connection-string`, same
`instrumentation.ts -> src/auth/index.ts` chain, a second static import `serverExternalPackages`
also wasn't reaching). Added `pg` to the same list too and re-ran again: identical `fs` error,
unchanged — adding `pg` had no effect at all. Conclusion: `serverExternalPackages` is not reaching
whatever webpack dev compiles for the target it names `○ Compiling /instrumentation ...` in its own
log (distinct from any route/page bundle); it is documented as a server/route-bundle option, and it
already demonstrably works for `@edmate/content` on *those* bundles (next.config.ts's own existing
comment) — just not on this one. The narrowest fix the plan named does not work here; I did not
widen into `src/auth/rate-limit.ts` or `instrumentation.ts` to try a different shape of fix (e.g. a
fully dynamic import), per Q4 and the plan's files-to-modify list, so I reverted the
`serverExternalPackages` additions (`@edmate/content` only, as before Phase B) rather than leave a
non-functional change in place, and rewrote both `next.config.ts`'s and
`apps/web/playwright.config.ts`'s comments to state this finding instead of 9.4a's older,
narrower one.

Confirmed the unaffected side: `next dev` (Turbopack, the plain command with no `--webpack`, same
env) started and `GET /api/health` returned `200 {"status":"ok"}`. Per Q2 (Phase A moved the build
to Turbopack too), `playwright.config.ts`'s `webServer.command` stays plain `next dev` (no flag
added) — not as a leftover placeholder waiting on a webpack fix, but because nothing in `apps/web`
still needs webpack for dev or build.

### Changed
- `apps/web/next.config.ts` — comment only (describes the Phase B finding: tried-and-reverted
  `serverExternalPackages` entries, names the real remaining blocker). No functional change; the
  `serverExternalPackages` value is unchanged from Phase A (`['@edmate/content']`).
- `apps/web/playwright.config.ts` — `webServer`'s comment rewritten (Question 2: no `--webpack`
  added, since Phase A moved the build to Turbopack too; states the current, real finding instead
  of 9.4a's older one). `command` itself unchanged (`next dev -p <port>`, already no `--webpack`).
- `docs/tasks/1.7e/handoff.md` — this section.

Evidence:
- Before any fix (`next dev --webpack -p 3112`, `GET /api/health`): `HTTP_STATUS=500`,
  `"message":"Module not found: Can't resolve 'crypto'\n> 1 | import { createHash } from
  'crypto';\n ... Import trace ... bullmq/dist/esm/classes/index.js ... packages/queue/dist/index.js
  ./src/auth/rate-limit.ts ./src/auth/index.ts ./instrumentation.ts"`.
- After adding `@edmate/queue`/`bullmq`/`ioredis` to `serverExternalPackages` (`-p 3113`):
  `HTTP_STATUS=500`, `"message":"Module not found: Can't resolve 'fs'\n ... const fs =
  config.sslcert || config.sslkey || config.sslrootcert ? require('fs') : null ... Import trace ...
  pg/lib/connection-parameters.js ... packages/db/dist/client.js ./src/auth/index.ts
  ./instrumentation.ts"` — the bullmq error is gone; a different import in the same chain fails
  instead.
- After also adding `pg` (`-p 3114`): `HTTP_STATUS=500`, identical `fs`/`pg-connection-string`
  error, unchanged by the addition.
- Turbopack, unaffected (`next dev -p 3115`, no `--webpack`): `HTTP_STATUS=200`,
  `{"status":"ok"}`.
- Every dev server started above was `kill`ed and confirmed gone (`ps aux | grep "next dev"`
  empty) before moving to the next trial or returning.

### Decisions

#### 26 Oct 2026 · 1.7e Phase B dev-mode bullmq/pg break not fixed · decided by builder · risk: low
- Decided: Leave `next dev --webpack`'s `/api/health` crash unfixed; revert the
  `serverExternalPackages` additions tried during this phase (back to Phase A's
  `['@edmate/content']`) since they had no effect, and keep Turbopack as the Playwright/dev default
  rather than adding `--webpack` back.
- Why: the plan's one named fix (`serverExternalPackages`) demonstrably doesn't reach whatever
  webpack dev compiles as `/instrumentation`; clearing it would need touching `instrumentation.ts`
  or `src/auth/rate-limit.ts` (how `@edmate/queue`/`pg` are imported there), and the plan (Q4) says
  stop and raise that rather than widen scope into those files without the lead's sign-off. Since
  Phase A already moved the production build to Turbopack, nothing in `apps/web` needs webpack for
  either build or dev anymore, so there is no remaining reason to chase this webpack-only bug for
  its own sake — a follow-up task only matters if something later needs webpack again.
- Open for the lead: a possible fast follow-up task, narrowly scoped to `instrumentation.ts`/
  `src/auth/rate-limit.ts` (e.g. making the `@edmate/queue` import fully dynamic, mirroring
  `instrumentation.ts`'s existing `./src/auth` dynamic import), if dev-mode webpack parity is ever
  needed again. Not started here (Q4; risky-path files, needs sign-off first).

### Gate
- `corepack pnpm turbo run typecheck lint test build --filter=@edmate/web` with
  `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate` — **PASS**.
- `corepack pnpm turbo run build-smoke --filter=@edmate/web --force` (same env) — **PASS**, runs
  (not skipped), `3 passed (3)`. Confirms the brief's required re-check: Phase A's SASL failure was
  a missing env var in that run's shell, not a real gap.
- `corepack pnpm exec prettier --check apps/web/next.config.ts apps/web/playwright.config.ts` —
  **PASS**.
- `python3 .githooks/secret-scan.py --all` — **PASS**, clean.

### Budget
Phase B tool calls used: 34
