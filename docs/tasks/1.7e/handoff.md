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
