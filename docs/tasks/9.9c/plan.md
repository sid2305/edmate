# Plan: 9.9c — live deploy wiring fixes

## Acceptance (verbatim)
> docs/live-demo.md's smoke checklist passes against the real public URL, reported in the handoff
> without any key or IP.

How it will be shown: the builder has no SSH access to the `edmate-app` VM (same constraint the
task title names). This task fixes the four wiring bugs the console's own real first deploy
surfaced, verified here by code read-through, YAML/shell syntax checks and the package test
suites; the console runs the real verification (rerunning `scripts/live-deploy.sh` and the smoke
checklist) after this PR merges, and reports the result back.

## Bugs fixed (from the console's bug report, not re-derived)
1. **BLOCKER — S3 through Caddy returns 403 SignatureDoesNotMatch.** `docker/Caddyfile.live`'s
   `handle_path /s3/*` stripped the `/s3` prefix before proxying to `minio:9000`; SigV4 signs the
   full canonical path including `/s3/<bucket>/<key>`, so MinIO saw a path the signature didn't
   match.
2. **BLOCKER — `S3_REGION=us-east-1` (docs/live-demo.md's own recommended value) trips the
   placeholder guard.** `us-east-1` is also `docker/compose.yaml`'s dev-stack default, so
   `storageConfigFromEnv`'s `DEV_DEFAULTS`/`REQUIRED_IN_PRODUCTION` check (`apps/web/src/storage/
   presign.ts`, `apps/worker/src/storage/roundtrip.ts`) refuses to start storage under
   `NODE_ENV=production`, throwing `S3_REGION_placeholder`.
3. **`scripts/live-deploy.sh` fails with `corepack: command not found` over non-interactive SSH.**
   nvm only loads Node/corepack onto `PATH` in an interactive login shell.
4. **`scripts/live-deploy.sh` runs `db:migrate` before `packages/db` is built.** `db:migrate`
   needs `packages/db/dist/bin/migrate.js`, which only exists after a build.

## Design decisions (go to the task's `## Decisions`, not a human blocker)
1. **S3 moves to its own hostname (`s3.${EDMATE_PUBLIC_HOST}`), not a path fix.** The task's own
   instruction is explicit about this (a path-stripping proxy can't work with SigV4's signed
   canonical path, no matter how the prefix is handled) — serving S3 on its own Caddy site block
   with a plain `reverse_proxy minio:9000` (no `handle_path`) means MinIO sees the exact path that
   was signed. `sslip.io`-style hosts resolve any label prefix automatically, so this needs no new
   DNS record on the VM's current hostname; a custom domain would need one (documented in
   `docs/live-demo.md`). Risk: high — same flagged risk area as 9.9a's own S3-routing decision
   (a new network path for signed storage traffic).
2. **MinIO's CORS allow-origin is now set explicitly in the live overlay** (`MINIO_API_CORS_ALLOW_
   ORIGIN: https://${EDMATE_PUBLIC_HOST}`), overriding the base file's value. The base file's
   default (`${AUTH_URL:-http://localhost:8080},http://localhost:3000`) resolves `AUTH_URL` from
   the *host shell's* environment at Compose-parse time, not from `web`'s own computed `AUTH_URL`
   — so without this override MinIO's CORS check would not actually allow the live app's real
   origin now that the browser's presigned PUT is cross-origin (different host than the app, for
   the first time). Risk: medium (storage-path correctness, not a new category of exposure — the
   allowed origin is still exactly the app's own host, not `*`).
3. **`docker/compose.live.yaml`'s `caddy` service gets a second network alias**
   (`s3.${EDMATE_PUBLIC_HOST}`), alongside the existing `${EDMATE_PUBLIC_HOST}` one, so `web`/
   `worker`'s own internal calls to the new S3 hostname resolve to the `caddy` container instead
   of needing a real round-trip out to the internet and back. Risk: low (same mechanism as the
   existing alias, 9.9a).
4. **`docs/live-demo.md`'s recommended `S3_REGION` value changes from `us-east-1` to
   `us-east-2`.** Fixing the app-level `DEV_DEFAULTS` check instead (dropping `S3_REGION` from it)
   would weaken a guard `apps/web/test/live-overlay-fail-closed.test.ts` specifically added and
   tested in 9.9a (B-69: the overlay must not rely on the app-level placeholder guard alone, but
   the guard itself is still a second, independent layer worth keeping for the other three
   credentials, and region is cheap to just not collide with). MinIO ignores `S3_REGION` entirely,
   so any non-placeholder string works; `us-east-2` is the value the console already proved works
   by hand. Risk: low (docs only; no code or test behaviour changes).
5. **`scripts/live-deploy.sh` sources `~/.nvm/nvm.sh` if present, right after `set -euo pipefail`,
   before anything that calls `corepack`/`pnpm`.** Matches the convention named in the bug report
   (`source ~/.nvm/nvm.sh && corepack pnpm ...`, also used by the repo's own command docs);
   guarded by a file-exists check so it's a no-op if nvm isn't installed, rather than failing.
   Risk: low.
6. **The new `corepack pnpm turbo run build --filter=@edmate/db...` step goes right after `pnpm
   install` and before the main `docker compose ... up -d --build` line**, not just before
   migrate/seed — the task instruction says "right after pnpm install", and there's no reason to
   delay it past the docker build (the two are independent). `--filter=@edmate/db...` also builds
   `@edmate/db`'s own dependencies (`@edmate/contracts`, `@edmate/harness`, `@edmate/content`),
   confirmed from `packages/db/package.json`. Risk: low.
7. **The script's header comment and `docs/live-demo.md`'s "What you need" section are corrected
   to state the VM needs Node (it already has it, via nvm, per `docs/azure-vm.md`'s cloud-init),
   not that nothing needs it** — `install`/`build`/`migrate`/`seed` all run on the VM's own Node,
   not inside a container. The "no local Node" line for the *operator's own machine* stays (still
   true), but is now clearly scoped to that, not the VM. Risk: low (docs only).

## Files changed
- `docker/Caddyfile.live` — S3 moves from `handle_path /s3/*` on the main site block to its own
  `s3.{$EDMATE_PUBLIC_HOST}` site block.
- `docker/compose.live.yaml` — `web`/`worker`'s `S3_ENDPOINT` becomes `https://s3.${EDMATE_PUBLIC_
  HOST}`; `minio`'s `MINIO_API_CORS_ALLOW_ORIGIN` is set explicitly; `caddy` gets the second
  network alias.
- `docs/live-demo.md` — `S3_REGION` recommendation changes to `us-east-2`; a new paragraph on the
  `s3.` subdomain (sslip.io vs. a custom domain); "What you need" corrected on Node.
- `scripts/live-deploy.sh` — sources `~/.nvm/nvm.sh` if present; adds the `@edmate/db` build step;
  corrects the header comment.

## Files out of bounds
Everything not listed above. In particular `apps/web/src/storage/presign.ts` and `apps/worker/src/
storage/roundtrip.ts`'s `DEV_DEFAULTS`/`REQUIRED_IN_PRODUCTION` logic is read for reference only,
not changed (decision 4 above): the fix for bug 2 is the doc's recommended value, not the guard.

## Tests first
No existing test asserts the literal `S3_ENDPOINT` value in `docker/compose.live.yaml` (checked:
`apps/web/test/live-overlay-fail-closed.test.ts` only asserts `S3_ALLOW_HTTP`/`AGE_NOTICE_ALLOW_
UNSIGNED`/the four credential keys, never `S3_ENDPOINT`), so no test needed updating for the
hostname change. No new test file: this task is wiring fixes to shell/Caddy/Compose config the
existing fail-closed test already covers at the layer it can (Compose structure, not a live
Caddy/MinIO round-trip, which needs the real VM — 9.9b's own precedent for no bash test
convention applies here too). Verification is: `python3 -I -c "import yaml; ..."` on the changed
compose file, `bash -n scripts/live-deploy.sh`, and the full `@edmate/web`/`@edmate/db` package
gates (typecheck/lint/test), to prove nothing else broke.

## Risky paths touched
None of `docker/**`, `scripts/**`, `docs/**` appear in `.claude/skills/merge-gate/risk-paths.txt`.
The board still marks this task `risk: risky` at the task level (live S3/network wiring); logged
as `risk: high` in the handoff's Decisions per the same precedent as 9.9a's own S3-routing
decision, so it reaches the human's skim list even though no reviewer group is mechanically
required by path.

## Open questions
None — the bug report is prescriptive enough (option chosen for bug 2 is one of the two the report
itself offers) that nothing here needs a human decision beyond the risk-level flag above.

## Budget
Budget: 30 tool calls (single phase, no new packages).

## Allowed tools
Read, Grep, Glob, Write, Edit, Bash (yaml/syntax checks, package test/typecheck/lint gates — no
docker, SSH, model or payment calls).

## Exit conditions
Status: DONE once all four bugs are fixed, the compose file parses, `bash -n` passes, and
`@edmate/web`/`@edmate/db` gates are green. Status: PARTIAL if a gate fails for a reason unrelated
to these changes and can't be resolved without touching files out of bounds above.
