# Review: 9.9d — self-signed STARTTLS cert for Mailpit on the live https deploy

Branch: `m9/9.9d-mailpit-tls`. Risk label: `risk: high` (live-demo critical path). No `risk-paths.txt`
match; required reviewers per plan: `code-reviewer` + `typescript-reviewer`.

## code-reviewer — PASS
- [LOW] fixed none needed — no findings. Diff matches plan exactly: only `docker/compose.live.yaml`,
  `apps/web/test/live-overlay-fail-closed.test.ts`, `scripts/live-deploy.sh`, `docs/live-demo.md`
  touched; no scope creep into `apps/web/src/auth/**`, `docker/compose.yaml`, `docker/env.example`,
  `.github/workflows/**`.
- Confirmed: `mailpit-cert` init container is idempotent (`restart: 'no'` + checks both `cert.pem`/
  `key.pem` before regenerating); safe to rerun via `live-deploy.sh`.
- Confirmed: `chmod 644` reasoning holds — `mailpit-tls` volume has no host bind mount and no
  published port anywhere in the compose files, so world-readable perms don't expose the key beyond
  the already-trusted Docker-internal network.
- Confirmed: the six new test assertions are substantive (cert/key env + `:ro` mounts on both
  services, byte-identical cert path, writable mount on the init container, top-level `volumes:`
  block, base-file regression guard), not tautological.
- Confirmed: no secrets, real hostnames, or real IPs in the diff.
- Non-blocking note (not a defect): the merged `web.depends_on` (five entries across base+overlay)
  still needs a real `docker compose config` run on the VM to confirm — plan already defers this to
  post-merge verification by the lead/Console, same as 9.9a/9.9b/9.9c/1.4d.

## typescript-reviewer — PASS
- [LOW] open — `apps/web/test/live-overlay-fail-closed.test.ts:188`: `expect(mailpitCertPath).toBeDefined()`
  doesn't type-narrow `string | undefined` for Vitest; harmless at runtime (both sides share the same
  type), not blocking. Deferred, not worth a fix round.
- Verified directly: `tsc --noEmit` clean, `eslint` clean, `vitest run` on the changed test file →
  15/15 pass. No `any`, no unsafe casts, no non-null assertions in the diff.
- Regex boundary logic in `serviceBlock`/the new `mailpit-tls` volumes-block matcher manually traced
  against the actual diff — confirmed accurate, no false-matching between `mailpit` and `mailpit-cert`.
- No async/lifecycle issues.

## Verdict
No CRITICAL/HIGH findings from either required reviewer. One LOW left open (deferred, non-blocking
per typescript-reviewer's own assessment) and one non-blocking VM-verification note already covered
by the plan's known deferred-verification clause. Clear to merge.
