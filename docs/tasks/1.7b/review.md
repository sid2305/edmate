# 1.7b review — APPROVE

Reviewers: security-reviewer (opus), typescript-reviewer (sonnet), code-reviewer (sonnet)

The fix round (ddcf930) was verified by fresh security-reviewer (opus) and typescript-reviewer (sonnet) passes.

## Findings

- [HIGH] [fixed] packages/content/src/safeRegexGuard.ts:52 — webpack inlined the build machine's worker path, so a relocated build (Docker) fell back to the in-process check with no time limit. Fixed: sibling path, then EDMATE_CONTENT_WORKER_DIR (set in the Dockerfile); a missing worker fails closed in production.
- [HIGH] [fixed] apps/web/test/build-smoke.test.ts:125 — the smoke test ran the build in place and could not catch relocation. Fixed: it copies the standalone build, hides the checkout's dist and proves the env-var path.
- [HIGH] [fixed] apps/web/test/build-smoke.test.ts:115 — no child 'error' listener; a spawn failure could crash the test process. Fixed.
- [MEDIUM] [deferred 1.7d] apps/web/test/build-smoke.test.ts:207 — the dist restore is not in a finally; a self-exited server makes afterAll time out before restoring, and a stale hidden dir breaks later runs.
- [LOW] [deferred 1.7d] apps/web/test/build-smoke.test.ts:140 — cpSync without verbatimSymlinks makes the copy's pnpm links absolute into the checkout.
- [LOW] [deferred 1.7d] apps/web/test/build-smoke.test.ts:166 — the comment cites byCwd, which no longer exists.
- [LOW] [deferred 1.7d] apps/web/test/build-smoke.test.ts — the integration test does not assert the fail-closed message (the unit test covers it).
- [LOW] [deferred 1.7d] apps/web/test/build-smoke.test.ts — the created Postgres student and session rows are never deleted.
- [LOW] [deferred 1.7d] turbo.json — the build-smoke task has no cache: false.
- [LOW] [deferred 1.7d] apps/web/src/auth/age.ts:75 — the log strip misses C1, U+0085 and U+2028/2029, and r.file is not stripped.
- [LOW] [fixed] packages/content/src/safeRegexGuard.ts:52 — the inlined build path is no longer the only path used; the env var is the deploy path.
- [LOW] [fixed] docs/tasks/1.7b/handoff.md:52 — the repro text now matches the root cause.
