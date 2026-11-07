# 9.9d review — APPROVE
Reviewers: code-reviewer, typescript-reviewer

## Findings
- [LOW] [open] apps/web/test/live-overlay-fail-closed.test.ts:188 — `expect(mailpitCertPath).toBeDefined()` does not type-narrow `string | undefined` for Vitest; harmless at runtime (both sides share the same type). typescript-reviewer: not blocking, no fix round needed.
- [LOW] [deferred 9.9d] docker/compose.live.yaml — merged `web.depends_on` (five entries across base+overlay) still needs a real `docker compose config` run on the VM to confirm the merge is correct; already covered by the plan's own deferred-verification clause (same pattern as 9.9a/9.9b/9.9c/1.4d), to be pasted into the handoff post-merge by the lead/Console.

No CRITICAL or HIGH findings from either required reviewer. code-reviewer confirmed: diff matches plan exactly (only `docker/compose.live.yaml`, `apps/web/test/live-overlay-fail-closed.test.ts`, `scripts/live-deploy.sh`, `docs/live-demo.md` touched, no scope creep into `apps/web/src/auth/**`/`docker/compose.yaml`/`docker/env.example`/`.github/workflows/**`); `mailpit-cert` init container is idempotent and safe to rerun; `chmod 644` on the generated key is safe (no host bind mount, no published port, Docker-internal network only); the six new test assertions are substantive, not tautological; no secrets/real hostnames/IPs in the diff. typescript-reviewer confirmed: `tsc --noEmit` clean, `eslint` clean, `vitest run` on the changed file 15/15 pass, no `any`/unsafe casts, no lifecycle issues.
