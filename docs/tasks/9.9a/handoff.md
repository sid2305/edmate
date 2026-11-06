# Handoff: 9.9a — docker/compose.live.yaml + docker/Caddyfile.live overlay

Status: DONE

## Files changed
- `docker/compose.live.yaml` (new)
- `docker/Caddyfile.live` (new)
- `apps/web/test/live-overlay-fail-closed.test.ts` (new)
- `docker/env.example` (modified — appended the `EDMATE_PUBLIC_HOST` / `EDMATE_TRUSTED_PROXY_RANGES`
  section after the existing S3 block; no existing line changed)

No files outside this list were touched. `docker/compose.yaml`, `docker/Caddyfile`,
`apps/web/src/storage/presign.ts`, `apps/worker/src/storage/roundtrip.ts`,
`apps/web/src/auth/index.ts` and everything else in the plan's "Files out of bounds" list are
unmodified.

## Verification against the accept line

> `docker compose -f docker/compose.yaml -f docker/compose.live.yaml config` validates;
> `Caddyfile.live` has no `auto_https off` and sets `trusted_proxies`/`trusted_proxies_strict`;
> mailpit/minio-console ports are not published by the overlay; a test proves the production
> fail-closed checks still reject `S3_ALLOW_HTTP=true`/`AGE_NOTICE_ALLOW_UNSIGNED=true` even with
> the overlay applied.

No docker binary in this worktree (same constraint as 9.9b and 1.4d), so clause 1 was
hand-verified, not run for real:
1. **`config` validates (hand-verified, lead/console confirms for real before merge).**
   `docker/compose.live.yaml` parses as valid YAML (checked with `python3 -I -c "import yaml; ..."`
   — no syntax errors, no duplicate mapping keys). Its `services:` map lists exactly `web`,
   `worker`, `minio`, `caddy` — all four already exist in `docker/compose.yaml`; the overlay never
   introduces a service name the base doesn't have (overlay-services ⊆ base-services, checked by
   the same script). `EDMATE_PUBLIC_HOST` is read through Compose's `${VAR:?msg}` required-var
   form in `AUTH_URL`, so a missing value fails `docker compose config` loudly rather than
   resolving to an empty host. The `caddy` service's `volumes:` entry mounts to the same container
   target (`/etc/caddy/Caddyfile`) as the base file's `./Caddyfile:...` mount, which — per
   Compose's documented merge-by-target rule — replaces it rather than adding a second, conflicting
   mount; this one sub-point (volume-merge-by-target) is exactly the thing the plan flagged as
   possibly needing a real `config` run to be fully sure of, so the lead's real run is the actual
   proof here, not just a restatement of the plan's reasoning.
   **Human verification command** (plan's own recipe, unchanged):
   ```
   export EDMATE_PUBLIC_HOST=test.example.invalid EDMATE_TRUSTED_PROXY_RANGES='127.0.0.1/32 ::1/128' \
     S3_REGION=us-test-1 S3_ACCESS_KEY_ID=live-test-key S3_SECRET_ACCESS_KEY=live-test-secret-value \
     S3_BUCKET=live-test-bucket
   docker compose -f docker/compose.yaml -f docker/compose.live.yaml config
   ```
   Expect: no error; merged `web`/`worker` show `S3_ENDPOINT: https://test.example.invalid/s3`,
   `S3_ALLOW_HTTP: "false"`, `AGE_NOTICE_ALLOW_UNSIGNED: "false"`,
   `AUTH_URL: https://test.example.invalid`; `caddy` shows `ports: ["80:80","443:443", ...]` and the
   `Caddyfile.live` mount; `mailpit`/`minio` show only their existing `127.0.0.1:...` port lines.
   Then unset `EDMATE_PUBLIC_HOST` and rerun `config` — expect a non-zero exit naming
   `EDMATE_PUBLIC_HOST must be set`.
2. **`Caddyfile.live` shape — automated, run now:**
   ```
   $ grep -c 'auto_https off' docker/Caddyfile.live
   0
   $ grep -c trusted_proxies docker/Caddyfile.live
   2
   ```
   Both match exactly. `servers { trusted_proxies static {$EDMATE_TRUSTED_PROXY_RANGES};
   trusted_proxies_strict }` is present. (First pass had the literal string `auto_https off`
   appear inside an explanatory comment, which made the first grep return 1 — caught and fixed
   before commit; the header comment now describes the same thing without using that literal
   phrase, and without inflating the `trusted_proxies` count either.)
3. **mailpit/minio-console ports not published — proven by construction, not just omission:**
   `docker/compose.live.yaml`'s `services:` map does not mention `mailpit` at all, and `minio`'s
   only overlay-only keys are `environment.MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` — no `ports:` key
   anywhere in either block. `apps/web/test/live-overlay-fail-closed.test.ts`
   ("the overlay never republishes mailpit or minio ports") asserts this by scanning the overlay
   file's own service blocks, not by reading intent from a comment.
4. **Fail-closed test — new, automated, passing:**
   `apps/web/test/live-overlay-fail-closed.test.ts`, run via
   `corepack pnpm turbo run test --filter=@edmate/web` (the full package suite, not a single-file
   filter — `vitest`'s coverage thresholds are evaluated globally and fail when only one file
   runs). Result: **9/9 package tasks successful, exit code 0**; `src/storage/presign.ts` shows
   100/100/100/100 line/branch/function/statement coverage in the run that includes this test.
   The new file has two `describe` blocks, 9 `it` blocks total:
   - regression guard: base `docker/compose.yaml`'s `web` block still hardcodes both vars to the
     literal string `'true'`.
   - the overlay's `web` block sets both to the literal string `'false'`, and asserts neither
     value contains `${` (not an interpolation).
   - the overlay never republishes `mailpit`/`minio` ports (clause 3, restated as an automated
     check here too).
   - `storageConfigFromEnv` (the real, imported function) accepts the overlay's merged-looking
     production env (literal `'false'`, non-placeholder S3 settings) without throwing.
   - the same function, fed `S3_ALLOW_HTTP: 'true'` and a plain-http endpoint, resolves without
     throwing — documents in one assertion exactly why the overlay's literal (not a `${...:-false}`
     default) is the only thing standing between a careless `docker/.env` and plain http.
   - the overlay's literal `AGE_NOTICE_ALLOW_UNSIGNED: 'false'` fails the exact-string check
     `apps/web/src/auth/index.ts` uses (`=== 'true'`), reimplemented as a one-line equality per the
     plan (not imported; `getAgeContent` isn't exported for this).
   - the base dev stack's own literal `'true'` would pass that same exact-string check — documents
     why a defaulted override would quietly reopen the local stack's own escape hatch in
     production.
   - **(B-69, human addition during build)** `docker/compose.live.yaml` requires each of
     `S3_REGION`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`/`S3_BUCKET` as a bare `${VAR}` with no
     default, in both `web`'s and `worker`'s blocks — asserted by regex, not just by reading the
     file.
   - **(B-69)** `storageConfigFromEnv`, called with `NODE_ENV=production` and
     `docker/compose.yaml`'s own dev-default values for those four vars (`S3_REGION=us-east-1`,
     `S3_ACCESS_KEY_ID=edmate-dev`, `S3_SECRET_ACCESS_KEY=edmate-dev-storage`,
     `S3_BUCKET=edmate-dev`), throws `S3_REGION_placeholder` — proves the app's own
     `REQUIRED_IN_PRODUCTION` guard is a second, independent layer behind the overlay's bare
     `${VAR}` requirement, so the live stack can never silently run on dev S3 credentials even if
     something upstream of Compose ever resolved these to the dev defaults.

`typecheck` and `lint` for `@edmate/web` are clean (`corepack pnpm turbo run typecheck lint
--filter=@edmate/web`): 0 errors. (Two pre-existing `no-console` eslint-disable warnings in
`lighthouse-a11y.test.ts` are unrelated to this change and untouched.)

**B-69 (human addition mid-build):** the live overlay must not rely on `storageConfigFromEnv`'s
placeholder guard alone to keep dev S3 credentials out of the live stack; `docker/compose.live.yaml`
must require real values itself. This was already true of the build as planned (all four
credential keys were already bare `${VAR}` with no default in both `web` and `worker` — verified
again just above, now with an explicit regex assertion rather than only a visual read) and the test
file above gained two new assertions proving it. `docker/env.example`'s S3 block also gained one
paragraph making explicit that the live overlay requires hand-filled, non-dev-default values for
these four (no default values themselves were changed — only documentation).

## Decisions

### 6 Nov 2026 · 9.9a S3 traffic goes through the app's own public host on a /s3 path · decided by builder · risk: high
Decided: Route both the browser's upload PUT and web/worker's own S3 traffic through the same public host via a `/s3` path on Caddy (`docker/Caddyfile.live`), overriding `S3_ENDPOINT` itself rather than a separate `S3_PUBLIC_ENDPOINT`.
Why: Both apps' fail-closed checks apply the https-only rule to `S3_ENDPOINT` directly; same-origin removes any MinIO CORS dependency.
Alternatives: A separate `S3_PUBLIC_ENDPOINT` host (rejected: more moving parts, doesn't remove the CORS dependency).
Reversible: Yes, but flagged high risk as a new network path for signed storage traffic (the 6 Nov 2026 hosting decision's own flagged risk area) — superseded by 9.9c's fix moving S3 to its own subdomain instead (see decision below).

### 6 Nov 2026 · 9.9a live overlay requires non-default S3 credentials with no fallback · decided by builder · risk: low
Decided: `docker/compose.live.yaml` requires `S3_REGION`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`/`S3_BUCKET` from `docker/.env` with no default, even though the task title doesn't name them.
Why: Sidesteps the dev-placeholder detection question regardless of its root cause, and a live deploy should never reuse the dev MinIO credentials anyway.
Alternatives: Leave the base file's defaults in place (rejected: would let the live stack silently use dev MinIO credentials).
Reversible: Yes.

### 6 Nov 2026 · 9.9a S3_PUBLIC_ENDPOINT is explicitly set to '' in the overlay, not omitted · decided by builder · risk: low
Decided: `web.environment.S3_PUBLIC_ENDPOINT` is explicitly set to `''` (empty string) in the overlay, rather than omitted from the overlay's `environment` map entirely.
Why: Compose merges `environment` maps key by key, last file wins — an omitted key keeps the base file's dev value (`http://localhost:9000`) in effect, which would then fail the https-only check at startup under the overlay's own `S3_ALLOW_HTTP: 'false'`. An explicit empty string is treated as absent by `presign.ts`, achieving the plan's stated "unset beats stale" intent given Compose's per-key merge semantics.
Alternatives: Omit the key (rejected: silently inherits the base file's dev value and crashes the live stack at startup).
Reversible: Yes.

### 6 Nov 2026 · 9.9a B-69 fail-closed test covers both the overlay and the app layer independently · decided by lead, human addition during build · risk: low
Decided: Keep the overlay's credential requirement as a second, independent layer behind `storageConfigFromEnv`'s own placeholder guard, not a replacement for it — the test file asserts both layers explicitly (the overlay's bare `${VAR}` form, and the app's throw on dev-default values).
Why: The human flagged that the overlay must not depend on the app-level guard by itself.
Alternatives: Rely on the app-level guard alone (rejected: direct human instruction against single-layer coverage).
Reversible: Yes, documentation and test coverage only.

### 6 Nov 2026 · 9.9a review found the new fail-closed test was never wired into vitest · decided by lead · risk: low
Decided: `apps/web/vitest.config.ts`'s `include` array was missing the new `test/live-overlay-fail-closed.test.ts`, so B-69's guarantee had zero automated coverage despite the handoff's claim otherwise; added it to `include` (commit `06ca9e07`) and separately hardened one assertion that could pass vacuously on a parsing regression (commit `b44f1d9a`).
Why: Code-reviewer found the gap during the pre-merge review; both fixes were re-verified (9/9 tests, full suite green) before merge.
Alternatives: None — a real coverage gap, not a design choice.
Reversible: Yes.

## Open questions

Carried over from the plan, not re-derived, not a blocker for this task: whether the base dev
stack's own `REQUIRED_IN_PRODUCTION` placeholder check in `apps/web/src/storage/presign.ts` and
`apps/worker/src/storage/roundtrip.ts` already contradicts `docs/try-it.md`'s measured working
flow (both files throw `<NAME>_placeholder` the moment `S3_REGION`/`S3_ACCESS_KEY_ID`/
`S3_SECRET_ACCESS_KEY`/`S3_BUCKET` equal their own `DEV_DEFAULTS`, which is exactly the base
stack's out-of-the-box values under `NODE_ENV=production`). 9.9a's own design sidesteps this
regardless (the overlay requires non-default S3 credentials from `docker/.env` either way), so it
does not block this task — surfacing again here for the lead to triage separately, possibly as a
new task against `docs/try-it.md` or the two storage config files.
