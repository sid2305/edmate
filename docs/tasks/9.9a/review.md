# Review: 9.9a — APPROVE

Reviewers: code-reviewer, typescript-reviewer

## Summary
Reviewed the full diff against `main` in throwaway worktrees. No risk-paths.txt group is touched by
this task's files (`docker/compose.live.yaml`, `docker/Caddyfile.live`,
`apps/web/test/live-overlay-fail-closed.test.ts`, `docker/env.example` are all outside every group in
`.claude/skills/merge-gate/risk-paths.txt`), so only the two always-required reviewers apply; no
`risk: high` decision entry is required.

`docker/compose.live.yaml`/`docker/Caddyfile.live` logic confirmed correct: literal `'false'` (not
defaulted) for `S3_ALLOW_HTTP`/`AGE_NOTICE_ALLOW_UNSIGNED`, bare `${VAR}` S3 credentials with no
default on both web and worker, `/s3` `handle_path` to `minio:9000` with no `Host` header rewrite (so
SigV4 signing still validates), `auto_https` left on, `trusted_proxies`/`trusted_proxies_strict`
present, no leaked real credentials or hostnames. `docker/env.example`'s additions are clean doc-only
changes.

## Findings

- [CRITICAL] [fixed] apps/web/vitest.config.ts — the new `apps/web/test/live-overlay-fail-closed.test.ts`
  (this task's B-69 fail-closed-on-missing-S3-credentials guarantee) was never included in vitest's
  `test.include` array, so it silently never ran under `vitest run` or the turbo `test` task.
  Confirmed directly (pre-fix): `npx vitest run test/live-overlay-fail-closed.test.ts` inside
  `apps/web` printed "No test files found, exiting with code 1" — despite the handoff's claim of
  "new, automated, passing" coverage, which in fact came from the pre-existing
  `src/storage/presign.test.ts`. Net effect pre-fix: B-69's fail-closed guarantee had zero automated
  coverage, contradicting the plan's own exit condition. Fixed in commit `06ca9e073d5e9ed4c50b
  f42031af69e32dcd368a`: added `'test/live-overlay-fail-closed.test.ts'` to the `include` array
  (same style as the existing `test/turn-backend.test.ts` entry). Re-verified post-fix: the file now
  resolves and all 9 tests pass; full `corepack pnpm turbo run typecheck lint test
  --filter=@edmate/web...` passes clean (34/34 tasks, exit 0).

- [LOW] [fixed] apps/web/test/live-overlay-fail-closed.test.ts:62-76 — `literalValue()` returns
  `string | undefined`; if its regex ever failed to match (returning `undefined`), the
  `S3_ALLOW_HTTP !== 'true'` branch in `storageConfigFromEnv` would still resolve to the fail-closed
  (https-only) path and this `it` would pass vacuously, masking a parsing regression rather than
  catching it. Fixed in commit `b44f1d9a`: added `expect(liveAllowHttp).toBeDefined()` before the
  value is used, so a future regex-parsing break now fails loudly instead of passing vacuously.
  Re-verified: `npx vitest run test/live-overlay-fail-closed.test.ts` still 9/9 passed.

## Gate reproduction
- `npx vitest run test/live-overlay-fail-closed.test.ts` (apps/web): 9/9 passed, post-fix.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...`: 34/34 tasks, exit 0.
- No real credentials, hostnames, or IPs in the diff (visual check + existing repo secret scan
  conventions).
