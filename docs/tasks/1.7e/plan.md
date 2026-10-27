# 1.7e plan — Turbopack build trial + webpack dev-mode bullmq break

## Acceptance (verbatim)
Board (`docs/board/tasks.yaml`): "Turbopack for apps/web (1.7b trial): find why Turbopack page-data
collection reaches apps/web/vitest.config.ts and the lightningcss native addon, fix it, then switch
the build script back to plain next build and re-run build-smoke." Accept: "plain next build
succeeds and build-smoke passes on the Turbopack build, or the reason to stay on --webpack is
logged."

Brief addition (this plan): acceptance must also cover the dev-mode `bullmq`/`@edmate/queue` break
at `/api/health` under `next dev --webpack` (not only `next build` and build-smoke); the stale
"restore `--webpack`" note in `apps/web/playwright.config.ts` can be resolved only once both the
build-side (Turbopack) and dev-side (webpack) bundler issues are actually diagnosed — not merely
abandoned by switching everything to Turbopack without understanding the dev-mode failure.

How it will be shown:
- Phase A: `corepack pnpm turbo run build --filter=@edmate/web` with `apps/web/package.json`'s
  `build` script as plain `next build` (no `--webpack`) succeeds, then `corepack pnpm turbo run
  build-smoke --filter=@edmate/web --force` passes against that build — OR, if Turbopack still
  can't build, a logged decision naming the exact blocking error and staying on `--webpack`.
- Phase B: `next dev --webpack -p <port>` (the same invocation 9.4a's trial used) starts and
  `GET /api/health` returns 200, quoted in the handoff — OR a logged decision naming the exact
  blocking error if it still can't be fixed. Either way, `apps/web/playwright.config.ts`'s
  `webServer.command` and its stale comment are updated to match the real, current state (not left
  describing a bug that may no longer be accurate after Phase A/B).

## Source context read
- `docs/tasks/1.7b/plan.md`, `docs/tasks/1.7b/handoff.md` — the original worker-path bug
  (`new URL(<literal>, import.meta.url)` misparsed as a bundler "URL asset"), its production
  fail-closed fix round, and the Turbopack trial that found the *separate* lightningcss/
  `vitest.config.ts` issue this task owns.
- `docs/tasks/9.4f/plan.md` (item 1) and `apps/web/playwright.config.ts`'s own comment (lines
  34-44) — the dev-mode bug this task also owns: webpack's dev compile of `instrumentation.ts`/the
  health route pulls `@edmate/queue` -> `bullmq` in via `apps/web/src/auth/rate-limit.ts`, and fails
  with `Module not found: Can't resolve 'crypto'` (bullmq's `bun-redis-client.js`) plus pg-native/
  valkey-glide optional-dependency resolution. 9.4f (branch `m13/9.4f-followups`, not yet merged)
  logs a wontfix pointing here rather than duplicating it; its `handoff.md` on that branch was not
  fetched locally, but the plan.md's disposition text (already on `main`) states the same finding.
- `apps/web/next.config.ts` — current `serverExternalPackages: ['@edmate/content']` +
  `outputFileTracingIncludes` precedent for working around a pnpm-workspace package webpack
  insists on bundling; the likely shape of this task's dev-mode fix.
- `apps/web/app/api/health/route.ts`, `apps/web/instrumentation.ts`,
  `apps/web/src/auth/rate-limit.ts` (imports `@edmate/queue`'s `redisTurnCounter` statically) —
  the actual import chain the dev-mode bug runs through.
- `apps/web/vitest.config.ts`, `apps/web/package.json`, `packages/queue/package.json` — build/dev
  scripts and the `bullmq`/`ioredis` dependency this task's fix routes around, not removes.

## Design
Two independent bundler-configuration bugs, same app, same `next.config.ts`/package.json area;
split into two phases so each gets its own red-then-green proof and can land (or stay logged as
"can't fix yet") without blocking the other.

**Phase A — Turbopack build.** Reproduce the exact Turbopack error from 1.7b's trial (`next build`,
no `--webpack`) against today's `main`, confirm it's still the lightningcss/`vitest.config.ts`
ESM-chunk-placement error (not something new). Try the narrowest fix first: excluding
`vitest.config.ts` (and anything else Turbopack's page-data collection reaches that it shouldn't)
from whatever causes Next to reach it at all — most likely Next's own output-file tracing or
Turbopack's workspace-root detection pulling in a dev-only config file it was never meant to trace,
not an app-code import. If a clean, narrow fix exists, flip `apps/web/package.json`'s `build` script
to plain `next build` and re-run build-smoke. If not, log the exact error and keep `--webpack`,
per the board's own "or the reason to stay on --webpack is logged" acceptance branch.

**Phase B — webpack dev-mode bullmq break.** Reproduce 9.4a's finding (`next dev --webpack -p
<port>`, `GET /api/health` fails) against today's `main`. Try the next.config.ts precedent first:
add `@edmate/queue` (and/or `bullmq`, `ioredis` directly — builder's call, narrowest that works) to
`serverExternalPackages`, matching the existing `@edmate/content` entry's role (stop webpack from
parsing a package's internals at all, let Node's own `require`/`import` resolve it at runtime
instead). Verify with the same dev-mode repro. If fixed, update `playwright.config.ts`'s
`webServer.command` and comment to reflect the real state — restore `--webpack` only if it now
genuinely works end-to-end (health route AND the e2e suite's own scripted-turn specs, since those
also exercise server code paths); otherwise explicitly keep Turbopack for dev and rewrite the
comment to say why (Question 2 below). If the dev-mode bug can't be cleanly fixed, log the exact
error and leave Turbopack as the dev default, with an updated (not stale) comment.

Neither phase touches `apps/web/src/auth/rate-limit.ts` by default (see Question 4); if
`serverExternalPackages` alone doesn't clear Phase B, stop and raise it rather than editing that
risky-path file without the lead's sign-off.

## Files to create/modify
### Phase A
- `apps/web/next.config.ts` — comment rewrite either way (states the real Turbopack-build outcome,
  not 1.7b's "kept on --webpack for 1.7b" framing); a config change only if a narrow fix is found.
- `apps/web/package.json` — `build` script, only if Phase A's fix is clean.
- `apps/web/test/build-smoke.test.ts` — only if switching bundlers changes which artifact path it
  must check (builder confirms first; the test targets `.next/standalone/apps/web/server.js`
  either way, which should be bundler-agnostic).
- `docs/tasks/1.7e/handoff.md` (new, this phase's half).

### Phase B
- `apps/web/next.config.ts` — `serverExternalPackages` addition + comment.
- `apps/web/playwright.config.ts` — `webServer.command` and its comment (lines 33-44).
- `docs/tasks/1.7e/handoff.md` (continued).

No new files expected beyond the handoff; no `packages/queue/**`, `packages/content/**`,
`packages/contracts/**`, or `packages/db/**` changes anticipated in either phase.

## Files out of bounds
- `apps/web/src/auth/rate-limit.ts` and everything else under `apps/web/src/auth/**` — risky path;
  touch only after raising it (Question 4).
- `apps/web/src/auth/age.ts`, `packages/content/src/safeRegexGuard.ts` — 1.7b/1.7 territory, no
  reason to touch here.
- `packages/queue/**`, `packages/db/**`, `packages/contracts/**`, `content/**` — untouched.
- `.github/workflows/ci.yml` — no CI change expected (the `node` job already runs `build-smoke`
  after `build`; the `e2e` job already runs against the real `build` output per its own comment,
  lines 156-159). If the builder finds a CI edit is actually needed, that's a new risky-path touch
  (security-reviewer) and should be raised, not made silently.
- `turbo.json` — no new task expected; both `build` and `build-smoke` tasks already exist from 1.7b.

## Tests first (TDD)
1. Phase A: before any fix, run `corepack pnpm --filter @edmate/web exec next build` (no
   `--webpack`) and quote the exact failure in the handoff (red, confirms 1.7b's finding still
   holds). After the fix attempt, re-run; if green, run `build-smoke --force` against that build
   (also quoted). If still red, that failure plus the "stay on --webpack" decision is the proof for
   this phase's acceptance branch — no code change needed to call Phase A done.
2. Phase B: before any fix, start `next dev --webpack -p <port>` and `curl`/fetch `/api/health`,
   quote the exact error (red). After the fix attempt, re-run the same two commands, quote the 200
   (green). If a permanent automated check is added (Question 3), it must fail red against
   unfixed `main` and pass green after the fix, same red-then-green discipline as 1.7b's
   build-smoke test.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- None of this plan's files-to-create/modify list matches a risk-paths.txt glob:
  `apps/web/next.config.ts`, `apps/web/playwright.config.ts`, `apps/web/package.json`,
  `apps/web/test/build-smoke.test.ts`, `turbo.json` are all unlisted (same conclusion 1.7b's plan
  reached for these same files).
- `apps/web/src/auth/**` (→ reviewers: security-reviewer) is explicitly out of bounds (Question 4);
  it only becomes risky if the builder has to touch `rate-limit.ts`, which this plan does not
  expect and gates on raising first.
- `.github/**` (→ reviewers: security-reviewer) is explicitly out of bounds; see above.
- Net today: no risky path touched. A `risk: high` decision is still planned for the handoff only
  if either phase ends up touching `apps/web/src/auth/**` or `.github/**` after all; otherwise this
  task logs its decisions at normal risk.

## Questions
1. If Phase A's fix is clean and `apps/web/package.json`'s `build` script moves from `next build
   --webpack` to plain `next build`, does that count as a "tech stack change" needing an ADR under
   CLAUDE.md rule 2? **Recommend: no** — same precedent as 1.7b's own open question and the lead's
   answer there (reverting a previously-introduced workaround flag, not adopting a new tool or
   dependency; Next.js ships both bundlers today). Flag for the lead's sign-off before merge either
   way, as 1.7b did.
2. What does "the Playwright `--webpack` flag can be dropped" mean once both phases work: actually
   add `--webpack` to `playwright.config.ts`'s `webServer.command` (restoring the parity the
   existing comment describes wanting), or delete the stale "restore `--webpack` once fixed" note
   because the build has also moved to Turbopack (Phase A), so nothing in `apps/web` needs webpack
   anymore? **Recommend:** if Phase A moves the build to Turbopack, there's no remaining reason to
   add `--webpack` back to the dev server — drop the aspiration, not add the flag, and rewrite the
   comment to say dev-mode webpack was diagnosed and fixed (Phase B) but Turbopack is kept for dev
   because nothing else in the app still needs webpack. If Phase A instead has to stay on
   `--webpack` for the build (Turbopack still broken), recommend restoring `--webpack` in
   Playwright's command too, for consistency with the build, now that Phase B has fixed the
   dev-mode crash.
3. Does the dev-mode bullmq fix (Phase B) need a new permanent, CI-enforced regression test, or is
   a one-time manual verification (quoted in the handoff) enough, given `next dev` never ships to
   production (the build-smoke test already covers what does)? **Recommend:** manual verification
   quoted in the handoff is enough unless the fix is cheap to also cover automatically (e.g., a
   short-lived `next dev --webpack` spawn-and-curl check parallel to `build-smoke.test.ts`'s
   pattern) — builder's call, not worth adding CI minutes for a dev-only path if it's not cheap.
4. If `serverExternalPackages` alone doesn't clear the Phase B dev-mode crash, should the builder
   widen scope into `apps/web/src/auth/rate-limit.ts` (risky path, needs security-reviewer) to
   change how `@edmate/queue` is imported (e.g., a dynamic import, mirroring `instrumentation.ts`'s
   existing avoidance of a static `@edmate/harness`/`@edmate/gateway`/`@edmate/queue` import)?
   **Recommend: no** — stop and raise it as a blocker instead; this plan's budget and reviewer scope
   assume no risky-path touch, and widening into `rate-limit.ts` can be a fast follow-up task with
   its own plan if `next.config.ts` alone isn't enough.

## Budget
Budget: 85 tool calls (2 phases, apps/web)
- Phase A: 45 tool calls
- Phase B: 40 tool calls

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (pnpm build/dev/build-smoke/typecheck/lint/test, `next build`/
`next dev` trial runs, curl/fetch against a local dev server, Playwright, and the secret scan only).

## Exit conditions
**Phase A — `Status: DONE`** once either (a) plain `next build` succeeds and `build-smoke` passes
against it, with `apps/web/package.json`'s `build` script switched and `next.config.ts`'s comment
updated, or (b) the exact blocking Turbopack error is quoted and a `## Decisions` entry logs staying
on `--webpack` with that reason. Commit green either way before handing off to Phase B.
**Phase A — `Status: PARTIAL`** past ~45 tool calls, or if the fix needs touching a file outside
this plan's list (e.g. `apps/web/src/auth/**`).

**Phase B — `Status: DONE`** once either (a) `next dev --webpack`'s `/api/health` crash is fixed and
verified, with `playwright.config.ts`'s command/comment updated per Question 2's outcome, or (b) the
exact blocking error is quoted and logged, with the comment rewritten to state the current, real
status (not a stale one). **Phase B — `Status: PARTIAL`** past ~40 tool calls, or if
`apps/web/src/auth/rate-limit.ts` turns out to need changing (Question 4) without the lead's
sign-off first.

READY

## Lead answers (26 Oct 2026)
- Q1: no ADR; reverting a workaround flag is not a tech-stack change. The lead logs a decision before merge.
- Q2: as recommended. If the build moves to Turbopack, don't add `--webpack` to Playwright; rewrite the comment. If the build has to stay on `--webpack`, add it to Playwright's command too.
- Q3: as recommended (the builder's call; a manual check quoted in the handoff is enough if automating it is not cheap).
- Q4: as recommended. Don't widen into `apps/web/src/auth/rate-limit.ts`; stop with PARTIAL and say why, and the lead plans a follow-up.
