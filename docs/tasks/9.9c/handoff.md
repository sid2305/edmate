# Handoff: 9.9c — live deploy wiring fixes

Status: DONE (builder side). The real verification — rerunning `scripts/live-deploy.sh` on
`edmate-app` and the `docs/live-demo.md` smoke checklist against the real public URL — needs SSH
access this builder doesn't have; the console does that after this PR merges and reports back.

## Files changed
- `docker/Caddyfile.live`
- `docker/compose.live.yaml`
- `docs/live-demo.md`
- `scripts/live-deploy.sh`
- `docs/tasks/9.9c/plan.md`, `docs/tasks/9.9c/handoff.md` (this file)

Nothing else touched. `apps/web/src/storage/presign.ts`, `apps/worker/src/storage/roundtrip.ts`,
`docker/compose.yaml`, `docker/Caddyfile`, `docker/env.example` were read for reference, never
edited.

## The four bugs, and the fix for each

1. **BLOCKER — S3 through Caddy, 403 SignatureDoesNotMatch.** `docker/Caddyfile.live`'s
   `handle_path /s3/*` stripped the `/s3` prefix before proxying to `minio:9000`; SigV4 signs the
   full canonical path (`/s3/<bucket>/<key>`), so MinIO saw a path that no longer matched the
   signature. Fixed by serving S3 on its own hostname instead of a path:
   - `docker/Caddyfile.live`: removed `handle_path /s3/*` from the main `{$EDMATE_PUBLIC_HOST}`
     site block; added a second site block `s3.{$EDMATE_PUBLIC_HOST} { reverse_proxy minio:9000 }`
     with no path rewriting and no `header_up Host` (same reasoning as before: default
     `reverse_proxy` doesn't rewrite Host, so MinIO sees exactly the Host it was signed for).
     Caddy auto-issues this block its own cert the same as the main one; sslip.io resolves any
     label prefix of an IP-based hostname, so an `EDMATE_PUBLIC_HOST` like
     `203-0-113-10.sslip.io` needs no extra DNS work for `s3.203-0-113-10.sslip.io` to resolve.
   - `docker/compose.live.yaml`: `web`/`worker`'s `S3_ENDPOINT` changed from
     `https://${EDMATE_PUBLIC_HOST}/s3` to `https://s3.${EDMATE_PUBLIC_HOST}`.
   - `caddy`'s `networks.default.aliases` gained a second entry, `s3.${EDMATE_PUBLIC_HOST}`,
     alongside the existing `${EDMATE_PUBLIC_HOST}` one, so internal `web`/`worker` calls to the
     new S3 hostname resolve to the `caddy` container directly (hairpin), not out to the real
     internet and back.
   - `minio`'s `MINIO_API_CORS_ALLOW_ORIGIN` is now set explicitly to
     `https://${EDMATE_PUBLIC_HOST}` in the overlay. S3 being same-origin with the app was exactly
     what made 9.9a's original design not need a CORS override; now that the browser's presigned
     PUT is cross-origin (app origin vs. `s3.` origin) for the first time, MinIO's own CORS check
     needs to allow it. The base file's existing CORS default
     (`${AUTH_URL:-http://localhost:8080},http://localhost:3000`) doesn't do this in the live
     stack even though it looks like it should: Compose interpolates `${AUTH_URL}` there from the
     *host shell's* environment at parse time (normally unset), not from `web`'s own computed
     `AUTH_URL` — so without this explicit override, MinIO would have kept allowing only
     `http://localhost:8080`.
   - `docs/live-demo.md`: added a short paragraph under step 3 explaining the new `s3.` subdomain,
     the sslip.io case (works automatically) and the custom-domain case (needs its own DNS
     record).

2. **BLOCKER — `S3_REGION=us-east-1` trips the placeholder guard.** `docs/live-demo.md` itself
   recommended `us-east-1`, which is also `docker/compose.yaml`'s dev-stack default
   (`${S3_REGION:-us-east-1}`) and `DEV_DEFAULTS.S3_REGION` in both `apps/web/src/storage/
   presign.ts` and `apps/worker/src/storage/roundtrip.ts` — so `storageConfigFromEnv` under
   `NODE_ENV=production` throws `S3_REGION_placeholder` even though the value is a perfectly real
   value, just one that happens to collide with the dev default. Fixed in the doc only, not the
   app code: `docs/live-demo.md`'s recommended `S3_REGION` is now `us-east-2` (the value the
   console already proved works by hand), with a sentence explaining MinIO ignores region
   entirely so any non-placeholder string works. Left the `DEV_DEFAULTS`/`REQUIRED_IN_PRODUCTION`
   check itself untouched: it's a second, independent layer (B-69, 9.9a) behind
   `docker/compose.live.yaml`'s own bare-`${VAR}` requirement, specifically tested in
   `apps/web/test/live-overlay-fail-closed.test.ts`, and weakening it for one of the four keys
   wasn't worth it when the doc fix alone removes the collision.

3. **`scripts/live-deploy.sh` fails with `corepack: command not found` over SSH.** nvm only loads
   Node/corepack onto `PATH` in an interactive login shell, and the script runs non-interactively.
   Fixed by sourcing `~/.nvm/nvm.sh` (if present) right after `set -euo pipefail`, before anything
   that calls `corepack`/`pnpm` — same pattern `scripts/claude-backup.sh` doesn't itself need
   (it's normally launched interactively) but the convention named in the bug report
   (`source ~/.nvm/nvm.sh && corepack pnpm ...`) matches every command in this repo's own docs.
   Also fixed the misleading claim that the deploy needs no Node anywhere: the script's header
   comment now says plainly that install/build/migrate/seed run on the VM's own Node (via nvm),
   not inside a container; `docs/live-demo.md`'s "What you need" section got the same correction
   (the "no local Node" bullet is still true, but now scoped explicitly to the operator's own
   machine, not the VM).

4. **`db:migrate` runs before `packages/db` is built.** Fixed by adding
   `corepack pnpm turbo run build --filter=@edmate/db...` right after `corepack pnpm install` and
   before the main `docker compose ... up -d --build` line (and well before `db:migrate`/
   `pnpm seed`). `--filter=@edmate/db...` also builds `@edmate/db`'s own dependencies —
   `@edmate/content`, `@edmate/contracts`, `@edmate/harness` (confirmed from
   `packages/db/package.json`) — matching the convention already used elsewhere in this repo
   (`docs/try-it.md`, several task plans).

## How I verified

No SSH access to `edmate-app`, so nothing above was run against the real VM; that's 9.9c's whole
premise and the console's job after this merges. What I did run:

- `python3 -I -c "import yaml; yaml.safe_load(open('docker/compose.live.yaml'))"` — parses clean;
  printed the merged `web`/`worker` `S3_ENDPOINT` (`https://s3.${EDMATE_PUBLIC_HOST}` for both),
  `minio`'s new `MINIO_API_CORS_ALLOW_ORIGIN`, and `caddy`'s two network aliases, confirming each
  matches what's described above.
- `bash -n scripts/live-deploy.sh` — passes.
- Read-through of `docker/Caddyfile.live` confirming no leftover `handle_path`/`/s3` routing and
  that the new `s3.{$EDMATE_PUBLIC_HOST}` block has no `header_up Host` override.
- Grepped the whole repo for `/s3` and `handle_path` to confirm no other file (app code, other
  docs) still assumes the old path-based S3 routing; the only remaining `/s3` hits are inside
  explanatory comments describing *why the old design broke*, in `docker/compose.live.yaml` and
  `docker/Caddyfile.live` themselves, and historical task docs under `docs/tasks/9.9a/` (plan,
  review, handoff — left alone; they're a record of what 9.9a actually built at the time, not
  live documentation).
- `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/web
  --filter=@edmate/db...`: **31/31 tasks successful, exit code 0.** `apps/web/src/storage/
  presign.ts` still shows 100/100/100/100 line/branch/function/statement coverage (unchanged by
  this task — no app code was touched). Confirms nothing in the `S3_ENDPOINT`/`S3_REGION` doc and
  compose-file changes broke `apps/web/test/live-overlay-fail-closed.test.ts` or any other test:
  that file never asserts the literal `S3_ENDPOINT` value, so the hostname change didn't need a
  test update, and it still asserts `S3_REGION_placeholder` the same way regardless of what
  `docs/live-demo.md` now recommends.

## Decisions

### 6 Nov 2026 · 9.9c S3 moves to its own hostname, not a smarter path rewrite · decided by builder · risk: high
Decided: S3 traffic now goes through its own Caddy site block (`s3.${EDMATE_PUBLIC_HOST}`, plain `reverse_proxy minio:9000`, no path rewriting), replacing the shared-path approach 9.9a shipped.
Why: Caddy's `handle_path /s3/*` strips the prefix before proxying, but SigV4 signs the full canonical path including it, so MinIO saw a path that no longer matched what was signed (403 SignatureDoesNotMatch). The bug report's own fix instruction specifies the subdomain move; recorded here too because it reopens 9.9a's own flagged risk area (a new network path for signed storage traffic) and changes the overlay's CORS story.
Alternatives: A smarter path-stripping rewrite that re-signs or passes the original path through (rejected: more moving parts than just giving S3 its own hostname, which sslip.io resolves for free).
Reversible: Yes, overlay/Caddyfile only.

### 6 Nov 2026 · 9.9c S3_REGION's doc collision fixed in the doc, not in storageConfigFromEnv's placeholder check · decided by builder · risk: low
Decided: `docs/live-demo.md`'s recommended `S3_REGION` value changed to `us-east-2`; the app-level placeholder guard in `storageConfigFromEnv` (B-69) was left untouched.
Why: MinIO ignores the region value entirely, so any non-placeholder string works; the collision was specific to one recommended doc value matching the dev default, not a problem with the guard's design.
Alternatives: Weaken or special-case the placeholder check (rejected: would erode the B-69 fail-closed guarantee for no reason).
Reversible: Yes, doc-only.

### 6 Nov 2026 · 9.9c MinIO's CORS allow-origin is an explicit literal in the overlay · decided by builder · risk: medium
Decided: `MINIO_API_CORS_ALLOW_ORIGIN` is now set as an explicit literal (`https://${EDMATE_PUBLIC_HOST}`) in the live overlay, not inherited from the base file's `${AUTH_URL:-...}` default.
Why: That default resolves `${AUTH_URL}` from the host shell's environment at Compose-parse time, not from `web`'s own computed `AUTH_URL`, so it silently fell back to the literal default rather than tracking the real app origin; the browser's presigned PUT also signs a `content-type` header, making the request genuinely cross-origin now that S3 has its own subdomain.
Alternatives: Fix the base file's inheritance generally (rejected: broader change than this task's bug-fix scope; the allowed origin is still exactly the app's own host, never `*`).
Reversible: Yes, overlay only.

### 6 Nov 2026 · 9.9c no new test file for the deploy-script/Caddy fixes · decided by builder · risk: low
Decided: No new bash test file added for `scripts/live-deploy.sh`'s nvm/build-order fixes or the Caddyfile/overlay changes.
Why: Same precedent as 9.9a/9.9b: no bash test convention in this repo; `apps/web/test/live-overlay-fail-closed.test.ts` already covers the Compose-structure layer this task touches and needed no changes; a real Caddy/MinIO SigV4 round-trip needs the actual VM, which this task can't reach.
Alternatives: Add a bash test harness (rejected: repo-wide convention change, out of scope).
Reversible: Yes.

## Open questions

None. The bug report's four items were prescriptive enough (including naming the two options for
bug 2 and picking neither code path without checking the dev default first) that nothing here
needed a new human decision beyond the risk flags above.
