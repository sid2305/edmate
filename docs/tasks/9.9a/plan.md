# Plan: 9.9a — docker/compose.live.yaml + docker/Caddyfile.live

## Acceptance (verbatim)
> `docker compose -f docker/compose.yaml -f docker/compose.live.yaml config` validates;
> `Caddyfile.live` has no `auto_https off` and sets `trusted_proxies`/`trusted_proxies_strict`;
> mailpit/minio-console ports are not published by the overlay; a test proves the production
> fail-closed checks still reject `S3_ALLOW_HTTP=true`/`AGE_NOTICE_ALLOW_UNSIGNED=true` even with
> the overlay applied.

How it will be shown: the builder has no docker binary (same constraint as `docs/tasks/1.4d` and
9.9b — "no compose access in this worktree"). So:
- Clause 1 (`config` validates) is **not run for real by the builder**. The builder hand-verifies
  by reading the merged YAML (every overlay-only key is valid under the base's existing service
  names; no duplicate mapping keys; `EDMATE_PUBLIC_HOST` uses the `${VAR:?msg}` required-var form
  so a missing value fails `config` loudly instead of silently resolving to an empty host) and
  says so in the handoff. The lead/console runs the real command before merge (see "How a human
  verifies this" below) — that is the actual proof of clause 1.
- Clause 2 (`Caddyfile.live` shape) is proven by reading the file: no `auto_https off` block,
  `trusted_proxies`/`trusted_proxies_strict` present in a `servers {}` block.
- Clause 3 (mailpit/minio-console not published) is proven because the overlay's `services:` map
  **does not mention `mailpit` or `minio`'s ports at all** — Compose only re-merges services an
  overlay file actually lists, so they keep `docker/compose.yaml`'s existing `127.0.0.1:...`
  bindings untouched. The test (below) also greps the overlay file for `mailpit:`/`minio:` port
  keys and fails if either appears.
- Clause 4 (fail-closed test) is the new automated test described under "Tests first".

## Context already resolved (no need to re-derive)
- Hosting decision (6 Nov 2026, `docs/decisions/log.md`): reuse the one-VM Caddy+compose stack on
  a new Azure VM `edmate-app`, reached via an sslip.io hostname for automatic HTTPS.
  **`EDMATE_PUBLIC_HOST`'s real value never appears in any committed file** — only as an env var
  with no literal-looking fallback.
- `docker/compose.yaml`'s `web`/`worker` services literally hardcode `S3_ALLOW_HTTP: 'true'` and
  `AGE_NOTICE_ALLOW_UNSIGNED: 'true'` (dev-only opt-outs, by design — `apps/web/src/auth/index.ts`
  comment confirms `AGE_NOTICE_ALLOW_UNSIGNED` is an exact-`'true'` check deliberately added so the
  dev stack can run with `NODE_ENV=production`). Compose merges `environment:` maps **key by key,
  last file wins** — an overlay that *omits* a key leaves the base's value in effect. So the live
  overlay must **explicitly** set both to the literal string `'false'` (not `${VAR:-false}` —
  literal, so no shell-exported `S3_ALLOW_HTTP=true` can ever leak through the live stack).
- S3 architecture for live: route the browser's signed PUT **and** the web/worker containers'
  own S3 calls through the same public host, via a `/s3` path on Caddy (`handle_path /s3/*` →
  `reverse_proxy minio:9000`, default `reverse_proxy` behaviour, which does not rewrite `Host` —
  required so MinIO's SigV4 check still passes). This makes browser uploads same-origin (MinIO's
  CORS config becomes irrelevant) and removes the need for a separate `S3_PUBLIC_ENDPOINT`. Both
  `web` and `worker` get `S3_ENDPOINT: https://${EDMATE_PUBLIC_HOST}/s3` (both apps' fail-closed
  checks apply the https-only rule to `S3_ENDPOINT` directly, not a separate public setting).
- Internal web/worker → Caddy calls use a Docker network alias (`${EDMATE_PUBLIC_HOST}` aliased on
  the `caddy` service, default network), so TLS SNI/Host match the public hostname without relying
  on the VM's real internet path or cloud hairpin NAT.
- `trusted_proxies` defaults to loopback only (`127.0.0.1/32 ::1/128`) — there is no load balancer
  or CDN in front of Caddy in this one-VM design — defaulted in `compose.live.yaml`'s own
  `${VAR:-...}`, not in Caddy's own placeholder syntax (avoids depending on Caddy's env-default
  token-splitting behaviour for a multi-value directive).
- `caddy` already `depends_on: web: condition: service_healthy` in the base file. Nothing may add
  `web: depends_on: caddy` (circular dependency — would make `config` **fail** clause 1 outright).
  `web` builds its S3 client lazily on first studio request (by the time a human clicks "upload",
  Caddy is already serving the page, so it's already up); `worker` builds its client eagerly at
  process start but makes no network call until a job runs — no explicit `depends_on: caddy`
  needed for either.

## Finding to flag to the lead (not a blocker for this task — see "Open questions")
Reading `apps/web/src/storage/presign.ts`, `apps/worker/src/storage/roundtrip.ts` and
`docker/compose.yaml` together: `NODE_ENV=production` is hardcoded in `x-app-env`, and
`S3_REGION`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`/`S3_BUCKET` all default to *exactly* the
same literal strings as each file's own `DEV_DEFAULTS` (`us-east-1`, `edmate-dev`,
`edmate-dev-storage`, `edmate-dev`). Both files' unconditional `REQUIRED_IN_PRODUCTION` loop throws
`<NAME>_placeholder` the moment any of those four equal their dev default — which, by this reading,
is exactly the base dev stack's own out-of-the-box values. That appears to contradict
`docs/try-it.md`'s measured, working `storage:roundtrip`/upload flow with zero S3 overrides. This
is in files `9.9a` is explicitly barred from touching (`presign.ts`, `roundtrip.ts`,
`docker/compose.yaml`), so it is **not fixed here** — flagging it in the handoff for the lead to
triage (possibly a regression since try-it.md's 22 Oct 2026 measurement). `9.9a`'s own design below
sidesteps it regardless (see next section), so it does not block this task.

## Design: docker/compose.live.yaml
Overlay-only `services:` entries (every other base service — `postgres`, `redis`, `mailpit` — is
untouched and not mentioned):
- **`web.environment`**: `AUTH_URL: https://${EDMATE_PUBLIC_HOST:?EDMATE_PUBLIC_HOST must be set}`,
  `S3_ENDPOINT: https://${EDMATE_PUBLIC_HOST}/s3`, `S3_ALLOW_HTTP: 'false'` (literal),
  `AGE_NOTICE_ALLOW_UNSIGNED: 'false'` (literal), and — to sidestep the flagged finding regardless
  of its root cause — `S3_REGION`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`/`S3_BUCKET` each as a
  bare `${VAR}` (no default), required in `docker/.env` alongside `AUTH_SECRET` and
  `EDMATE_ANTHROPIC_API_KEY` (same "secret filled by hand on the VM" convention 9.9b already
  documents). `S3_PUBLIC_ENDPOINT` is not set (unset beats stale — same host serves both).
- **`worker.environment`**: the same `S3_ENDPOINT`/`S3_REGION`/`S3_ACCESS_KEY_ID`/
  `S3_SECRET_ACCESS_KEY`/`S3_BUCKET` four lines (worker has no `S3_ALLOW_HTTP`/age-notice vars to
  override).
- **`minio.environment`**: `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` from the same
  `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` vars (MinIO's root user doubles as the access key pair,
  same as the base file), so the live bucket's credentials are never the dev placeholders either.
- **`caddy`**: `ports: ['80:80', '443:443']` (additive — Compose unions `ports` lists across `-f`
  files, so the base's `127.0.0.1:8080:80` loopback mapping also still works, harmlessly);
  `environment: EDMATE_PUBLIC_HOST, EDMATE_TRUSTED_PROXY_RANGES: ${EDMATE_TRUSTED_PROXY_RANGES:-127.0.0.1/32 ::1/128}`;
  `volumes: ['./Caddyfile.live:/etc/caddy/Caddyfile:ro']` (Compose merges `volumes` by container
  target, so this entry replaces the base's `./Caddyfile:...` mount at the same target — **the
  builder confirms this by reading Compose's documented merge rule, and the lead re-confirms with
  the real `config` run**, since the builder can't run it); `networks: default: aliases:
  ['${EDMATE_PUBLIC_HOST}']` (no top-level `networks:` key needed — the base file uses the
  implicit default network, and this just adds an alias to it).

## Design: docker/Caddyfile.live
```
{
	servers {
		trusted_proxies static {$EDMATE_TRUSTED_PROXY_RANGES}
		trusted_proxies_strict
	}
}

{$EDMATE_PUBLIC_HOST} {
	encode gzip

	# Same origin as the app itself, so the browser's signed PUT is same-origin (MinIO's CORS
	# config is irrelevant) and SigV4 still validates: default reverse_proxy does NOT rewrite
	# Host, so MinIO sees the same Host it was signed for. Do not add header_up Host here.
	handle_path /s3/* {
		reverse_proxy minio:9000
	}

	reverse_proxy web:3000 {
		header_up X-Forwarded-For {client_ip}
	}
}
```
No `auto_https off`; Caddy's automatic HTTPS is the whole point of this file.

## docker/env.example addition
A new section (after the existing S3 block) documenting `EDMATE_PUBLIC_HOST` (no default; the
live overlay only — never set on the local stack) and `EDMATE_TRUSTED_PROXY_RANGES` (defaults to
loopback-only; only matters with the live overlay), each with one line making clear neither is a
secret but `EDMATE_PUBLIC_HOST`'s *real* value must never be committed anywhere else either.

## Files to create
- `docker/compose.live.yaml`
- `docker/Caddyfile.live`
- `apps/web/test/live-overlay-fail-closed.test.ts` (new — see below)

## Files to modify
- `docker/env.example` (append the two new var docs; no existing line changed)

## Files out of bounds
`docker/compose.yaml`, `docker/Caddyfile` (base files — not touched; see the flagged finding
above for why touching `docker/compose.yaml`'s S3 defaults might look tempting, and why it isn't
done here), `apps/web/src/storage/presign.ts`, `apps/worker/src/storage/roundtrip.ts`,
`apps/web/src/auth/index.ts`, `packages/contracts/**`, `.github/workflows/**`,
`packages/harness/src/guardrails/**`, `scripts/live-deploy.sh`, `docs/live-demo.md` (9.9b's files).

## Tests first
New file `apps/web/test/live-overlay-fail-closed.test.ts` (plain text/regex checks against the two
overlay files, plus the real `storageConfigFromEnv`/age-gate logic — **no new dependency**: earlier
drafts of this plan considered a `js-yaml`-based real compose-merge simulation, dropped to avoid a
new devDependency + lockfile edit for a single-pass build):
1. Read `docker/compose.yaml` and `docker/compose.live.yaml` as text.
2. Extract, by line-scanning each file's `web:`/`worker:` service block, the literal value
   assigned to `S3_ALLOW_HTTP` and `AGE_NOTICE_ALLOW_UNSIGNED`. Assert the **base** file has
   `'true'` for both (regression guard: if this ever stops being true the premise of this test
   changes) and the **overlay** file has the literal string `'false'` for both, written as a bare
   literal (not `${...}` interpolation) — proves a shell-exported `S3_ALLOW_HTTP=true` cannot
   override the live stack.
3. Grep both overlay-file service blocks for `mailpit:`/`minio:` port-publishing keys (a bare
   `ports:` key under either service name) and assert there are none — proves clause 3 by
   construction, not just by omission.
4. Feed the literal `'false'` values from step 2, plus `NODE_ENV: 'production'` and a non-placeholder
   `S3_ENDPOINT`/region/credentials/bucket (simulating the merged container env), into the real,
   imported `storageConfigFromEnv` (`apps/web/src/storage/presign.ts`) and assert it returns
   normally (no `S3_ENDPOINT_not_https`). Then flip just `S3_ALLOW_HTTP` to `'true'` in that same
   object (simulating what would happen if the overlay's override were ever weakened back to a
   defaulted `${S3_ALLOW_HTTP:-false}`) with a plain-http `S3_ENDPOINT` and assert it now resolves
   without throwing — i.e. the test documents, in one assertion, exactly why step 2's "literal, not
   defaulted" check matters: `S3_ALLOW_HTTP=true` is accepted by the app whenever it's true, so the
   overlay itself is the only thing standing between a careless `docker/.env` and plain http.
5. Same shape for `AGE_NOTICE_ALLOW_UNSIGNED`, calling the exact check in
   `apps/web/src/auth/index.ts` (`process.env.AGE_NOTICE_ALLOW_UNSIGNED === 'true'`) — reimplemented
   as a one-line equality in the test (not imported; `getAgeContent` isn't exported for this), since
   the file comment itself states the exact-string rule being tested.
Run via `corepack pnpm turbo run test --filter=@edmate/web`.

## How a human verifies this without a real VM
1. `export EDMATE_PUBLIC_HOST=test.example.invalid EDMATE_TRUSTED_PROXY_RANGES='127.0.0.1/32 ::1/128' S3_REGION=us-test-1 S3_ACCESS_KEY_ID=live-test-key S3_SECRET_ACCESS_KEY=live-test-secret-value S3_BUCKET=live-test-bucket`
   then `docker compose -f docker/compose.yaml -f docker/compose.live.yaml config`. Expect: no
   error; the printed `web`/`worker` services show `S3_ENDPOINT: https://test.example.invalid/s3`,
   `S3_ALLOW_HTTP: "false"`, `AGE_NOTICE_ALLOW_UNSIGNED: "false"`, `AUTH_URL:
   https://test.example.invalid`; `caddy` shows `ports: ["80:80","443:443", ...]` and a mounted
   `Caddyfile.live`; `mailpit`/`minio` show only their existing `127.0.0.1:...` port lines.
2. Unset `EDMATE_PUBLIC_HOST` and rerun `config` — expect a non-zero exit naming
   `EDMATE_PUBLIC_HOST must be set` (proves the required-var guard actually fails loudly).
3. `grep -c 'auto_https off' docker/Caddyfile.live` → `0`; `grep -c trusted_proxies
   docker/Caddyfile.live` → `2`.

## Risky paths touched
None (checked against `.claude/skills/merge-gate/risk-paths.txt`): `docker/**`, `docs/**` and
`apps/web/test/**` are not in any listed group. (The board itself tags the 9.9 family
`risk: risky` at the task level per the 6 Nov 2026 hosting decision — that is reflected in the
handoff's `## Decisions` entry below as `risk: high`, independent of the risk-paths.txt groups.)

## Decisions (draft, to go in the handoff)
- Decided: route both the browser's upload PUT and web/worker's own S3 traffic through the same
  public host via a `/s3` path on Caddy, overriding `S3_ENDPOINT` itself (not a separate
  `S3_PUBLIC_ENDPOINT`). Why: both apps' fail-closed checks apply the https-only rule to
  `S3_ENDPOINT` directly; same-origin removes any MinIO CORS dependency. Risk: high (new network
  path for signed storage traffic — the 6 Nov 2026 hosting decision's own flagged risk area).
- Decided: `docker/compose.live.yaml` requires `S3_REGION`/`S3_ACCESS_KEY_ID`/
  `S3_SECRET_ACCESS_KEY`/`S3_BUCKET` from `docker/.env` with no default, even though the task
  title doesn't name them. Why: sidesteps the flagged `_placeholder` finding above regardless of
  its root cause, and a live deploy should never reuse the dev MinIO credentials anyway.

## Open questions
One finding, not a blocker (see "Finding to flag to the lead" above): whether the base dev stack's
own `REQUIRED_IN_PRODUCTION` placeholder check already contradicts `docs/try-it.md`'s measured
working flow. 9.9a's own design avoids depending on the answer either way, so this does not block
planning or building 9.9a — surfaced for the lead to triage separately (possibly a new task).

## Budget
Budget: 80 tool calls (1 phase, no packages)

## Allowed tools
Read, Grep, Glob, Write, Edit, Bash (test/typecheck/lint runs only — no docker, SSH, model or
payment calls)

## Exit conditions
Status: DONE once both overlay files exist and match the designs above, `docker/env.example` has
the two new var sections, the new test passes via `corepack pnpm turbo run test --filter=@edmate/web`
(and `lint`/`typecheck` for that package are clean), and every accept-line clause has either an
automated check or a documented manual-verification step for the lead. Status: PARTIAL past about
80 tool calls, or if Compose's volume-merge-by-target behaviour (the `Caddyfile.live` mount
replacing the base's `Caddyfile` mount) turns out to need a real `docker compose config` run to
confirm before the builder can be confident — stop and hand back rather than guessing further.
