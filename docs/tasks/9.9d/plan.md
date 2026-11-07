# Plan: 9.9d — self-signed STARTTLS cert for Mailpit on the live https deploy

## Acceptance (verbatim, from `docs/board/tasks.yaml`)
> a fresh `docker compose -f docker/compose.yaml -f docker/compose.live.yaml up` (or the equivalent
> `live-deploy.sh` run) brings up Mailpit with a working self-signed TLS cert and `web` trusting it
> via `NODE_EXTRA_CA_CERTS`, with `EMAIL_SERVER` unset; `POST /api/auth/signin/email` succeeds (302
> `verify-request`) and the mail lands in Mailpit, with no change to `apps/web/src/auth/**` behaviour
> or to the Resend path; `docs/live-demo.md` and `scripts/live-deploy.sh` describe the cert step;
> reported against the real public URL in the handoff with no key or IP.

How it will be shown: the builder has no docker binary or VM/SSH access in this worktree (same
constraint already recorded for 9.9a, 9.9b, 9.9c and 1.4d). So, same split 9.9c used:
- The compose-file shape, the cert-generation script, the depends_on wiring and the env-var
  wiring are **built and hand/test-verified here** (YAML parses, the new and updated regex checks
  in `apps/web/test/live-overlay-fail-closed.test.ts` pass, `bash -n` on the deploy script passes).
- The actual "`POST /api/auth/signin/email` → 302 → mail lands in Mailpit, against the real public
  URL" clause **cannot be produced by this builder** — it needs the real VM. Per the board task's
  own wording ("reported against the real public URL in the handoff"), the builder's handoff says
  so plainly (Status: DONE (builder side), same phrasing 9.9c's handoff used) and the lead/console
  reruns `scripts/live-deploy.sh` on `edmate-app` after merge and pastes the real result (host
  redacted per the RFC 5737/sslip.io placeholder convention) into the handoff before closeout.

## Context already resolved (no need to re-derive)
- Only `apps/web/src/auth/mail.ts` (via `apps/web/src/auth/index.ts`'s `emailSignIn`) ever opens an
  SMTP connection in this repo — confirmed by grepping for `nodemailer`/`createTransport` across
  `apps/`: every other hit is either a test, a lockfile entry, or `describe-error.ts`'s comment.
  `apps/worker` sends no mail. So `NODE_EXTRA_CA_CERTS` is wired onto `web` only, never `worker`.
- `apps/web/src/auth/mail.ts` already passes `requireTLS: opts.requireTls` straight to
  `nodemailer.createTransport`, and `index.ts` already sets `requireTls: env.secureCookies` (true
  whenever `AUTH_URL` is https). Neither line changes — the fix is entirely "make the self-signed
  cert trusted," not "make TLS optional," per the task's explicit constraint.
- `docker/compose.yaml`'s base `mailpit` service (axllent/mailpit, pinned by digest) currently has
  no TLS cert, so Mailpit refuses STARTTLS and nodemailer's handshake fails
  (`[auth] sign-in mail failed` / `MailSendError`; Mailpit logs `502 5.5.1 Command not implemented`).
  Console's verified stopgap on the VM (outside the repo): a self-signed cert (CN/SAN `mailpit`)
  mounted into Mailpit via `MP_SMTP_TLS_CERT`/`MP_SMTP_TLS_KEY`, the same cert mounted read-only
  into `web` with `NODE_EXTRA_CA_CERTS` so Node's TLS verification (left ON) trusts it. This plan
  brings exactly that into the repo so it survives a fresh `live-deploy.sh` run.
- House style for `docker/compose.live.yaml` and `docker/Caddyfile.live` (read `docs/tasks/9.9a/
  plan.md`, `docs/tasks/9.9a/handoff.md`, `docs/tasks/9.9c/handoff.md` in full): minimal, heavily
  commented overlay-only `services:` entries; every base service an overlay entry doesn't mention
  keeps its base config untouched (Compose only re-merges services a file actually lists); no new
  dependency added just to make one test pass; images pinned by digest when they're a
  community/third-party build the team doesn't control the tag history of (mailpit, minio); the
  builder hand-verifies anything needing a real `docker compose config`/`up` run and flags it
  explicitly for the lead/console, rather than guessing. 9.9a's design additionally kept every
  overlay service name a subset of the base file's service names ("overlay-services ⊆
  base-services", confirmed in its handoff) — this task necessarily breaks that invariant (see
  "Design" below): the task itself specifies a one-shot init container or a sidecar, which is
  unavoidably a service name the base file doesn't have. Compose fully supports a new service
  defined only in an overlay file; noted as a deliberate, documented departure, not an oversight.

## Design: a new named volume + a new one-shot init-container service

**Why a named Docker volume, not a `./data/...` bind mount** (the base file's own convention for
postgres/redis/minio data): the board task is explicit ("share it ... via a named volume"), and it
keeps the self-signed private key out of the repo checkout's `docker/data/` tree entirely — no risk
of it ending up under a path a future change bind-mounts somewhere unintended. The volume
(`mailpit-tls`) holds exactly two files generated inside the container, never on the host
filesystem directly.

**Why a one-shot init container, not a sidecar**: a sidecar would need to stay running and would
have nothing to do after the first generation; a one-shot container that exits 0 (`restart: 'no'`,
gated by `depends_on: ... condition: service_completed_successfully`) is the simpler, more common
Compose pattern for "run this once before X starts," and needs no long-lived process.

**Why `node:22.22.3-alpine3.22` as the init container's image**: it is already the exact base image
`apps/web/Dockerfile` and `apps/worker/Dockerfile` build `FROM`, so the live-demo VM's Docker daemon
either already has it cached from building those two images, or pulls it through the same
already-trusted public registry path the stack's own images come from — no new third-party image
to track or pin by digest (unlike mailpit/minio, which are pinned because they're community builds
of someone else's server). `apk add --no-cache openssl` (same inline-install idiom
`apps/worker/Dockerfile`'s ffmpeg stage already uses, just at container run time instead of image
build time) gets the `openssl` CLI onto it.

**Idempotency** (so a rerun of `scripts/live-deploy.sh`, or of plain `docker compose up -d --build`,
never clobbers a working cert): the init container's script checks for both `/tls/cert.pem` and
`/tls/key.pem` on the shared volume first and skips generation (logs a one-line "existing cert
found, skipping" and exits 0) if both are already there. Regenerating on purpose (e.g. to rotate)
means removing the named volume (`docker volume rm <project>_mailpit-tls`, or `docker compose down
-v`) by hand — not a routine step, so not automated here; `docs/live-demo.md` says so in one line.

**Cert permissions**: `chmod 644` on both the cert and the key after generation (not nodemailer's
usual private-key-restrictive default). This cert protects nothing outside the Docker-internal
sandbox mail path between `mailpit` and `web` — real mail never leaves Mailpit (it has no outbound
relay, matching `docker/compose.yaml`'s own comment on the service) — and `mailpit`/`web` may run as
different, non-root container users, so both need to be able to read whichever file their process
needs regardless of UID. This is a fixture for an internal sandbox catcher, not a secret with any
value outside this container network.

## `docker/compose.live.yaml` changes

1. **Top-of-file comment** (lines 10-13): currently says "Every other base service (postgres,
   redis, mailpit) is untouched and not mentioned here." After this change `mailpit` *is* mentioned
   (for its STARTTLS cert only) — reword to say postgres and redis stay untouched and unmentioned,
   and mailpit's existing `127.0.0.1`-only port binding is untouched even though this overlay now
   gives it two new environment keys and a cert volume.

2. **New top-level `volumes:` key** (first one this file has needed):
   ```yaml
   volumes:
     # Holds the self-signed STARTTLS cert the mailpit-cert service below generates once and both
     # mailpit and web mount read-only. Never a host bind mount (unlike docker/compose.yaml's own
     # ./data/... convention): keeps the private key out of the repo checkout entirely.
     mailpit-tls:
   ```

3. **New service `mailpit-cert`** (a one-shot init container; see "Design" above for the full
   reasoning, repeated here only as a short code comment):
   ```yaml
   mailpit-cert:
     # One-shot, idempotent: generates mailpit's self-signed STARTTLS cert into the mailpit-tls
     # volume the first time, skips if it's already there (a live-deploy.sh rerun, or a plain
     # `docker compose up -d --build`, must never regenerate a working cert out from under a
     # running stack). node:22.22.3-alpine3.22 is already the exact base apps/web's and
     # apps/worker's own Dockerfiles build FROM -- no new third-party image to track.
     image: node:22.22.3-alpine3.22
     command:
       - /bin/sh
       - -c
       - |
         set -eu
         if [ -f /tls/cert.pem ] && [ -f /tls/key.pem ]; then
           echo 'mailpit-cert: existing cert found in the mailpit-tls volume, skipping'
         else
           apk add --no-cache openssl >/dev/null
           openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
             -subj /CN=mailpit -addext 'subjectAltName=DNS:mailpit' \
             -keyout /tls/key.pem -out /tls/cert.pem
           chmod 644 /tls/cert.pem /tls/key.pem
           echo 'mailpit-cert: generated a new self-signed cert for mailpit'
         fi
     volumes:
       - mailpit-tls:/tls
     restart: 'no'
   ```

4. **`mailpit` gains** (the base file's `mailpit` service keeps its existing image/restart/ports
   lines untouched; this overlay adds):
   ```yaml
   mailpit:
     depends_on:
       mailpit-cert:
         condition: service_completed_successfully
     environment:
       # Mailpit then logs "STARTTLS optional" instead of refusing it (Console's verified fix).
       MP_SMTP_TLS_CERT: /tls/cert.pem
       MP_SMTP_TLS_KEY: /tls/key.pem
     volumes:
       - mailpit-tls:/tls:ro
   ```

5. **`web` gains** (appended to its existing `environment:`/added `depends_on:`/`volumes:` — the
   base file's `web` has no `volumes:` key today, so this is a clean addition, not a merge):
   ```yaml
   web:
     depends_on:
       mailpit-cert:
         condition: service_completed_successfully
     environment:
       # ... existing keys unchanged ...
       # Trusts mailpit's self-signed cert for nodemailer's STARTTLS handshake (apps/web/src/auth/
       # mail.ts), without weakening certificate verification anywhere: requireTls stays exactly
       # env.secureCookies (apps/web/src/auth/index.ts, untouched by this task).
       NODE_EXTRA_CA_CERTS: /tls/cert.pem
     volumes:
       - mailpit-tls:/tls:ro
   ```
   `depends_on` is a mapping field like `environment`; Compose merges it key by key the same way
   (confirmed by reading Compose's documented merge rules, same as 9.9a's volume-merge-by-target
   read) — the base file's existing `postgres/redis/minio/mailpit: condition: service_healthy`
   entries for `web` are expected to survive, with `mailpit-cert` added alongside them, not
   replacing them. **This is exactly the kind of multi-file-merge detail 9.9a flagged as needing a
   real `docker compose config` run to be fully sure of** (no docker binary here either) — the
   "How a human verifies this" section below gives the lead/console the exact command and the
   expected merged output to check before trusting this in production.

## `apps/web/test/live-overlay-fail-closed.test.ts` changes (existing file, not new)

One existing assertion breaks under this design and must be fixed, not left red:
```ts
it('the overlay never republishes mailpit or minio ports', () => {
  expect(serviceBlock(LIVE_COMPOSE, 'mailpit')).toBe('');   // <- was "mailpit isn't mentioned at
  expect(serviceBlock(LIVE_COMPOSE, 'minio')).not.toContain('ports:');  //    all"; now it is.
});
```
Fix: change the first line to `expect(serviceBlock(LIVE_COMPOSE, 'mailpit')).not.toContain('ports:')`
(the same shape as the `minio` line already uses) — still proves clause 3 of 9.9a's own accept line
(mailpit's port binding is never republished by the overlay), just no longer assumes mailpit is
absent from the overlay altogether.

New `describe` block in the same file, `'live overlay: mailpit STARTTLS cert (task 9.9d)'`:
1. `mailpit`'s overlay block contains the literal `MP_SMTP_TLS_CERT: /tls/cert.pem` and
   `MP_SMTP_TLS_KEY: /tls/key.pem`, and a `mailpit-tls:/tls:ro` volume mount line.
2. `web`'s overlay block contains the literal `NODE_EXTRA_CA_CERTS: /tls/cert.pem` and a
   `mailpit-tls:/tls:ro` volume mount line.
3. The cert path `web`'s `NODE_EXTRA_CA_CERTS` points at is byte-for-byte the same string as the
   `MP_SMTP_TLS_CERT` path `mailpit` is given — the one assertion that actually encodes why this
   fix works at all (web must trust the exact file mailpit presents).
4. A `mailpit-cert` service block exists, its command text contains `openssl req -x509`, and it
   mounts `mailpit-tls:/tls` (writable — regex: a `mailpit-tls:/tls` volume line with no trailing
   `:ro`) distinct from `mailpit`'s and `web`'s read-only mounts of the same volume.
5. The top-level `volumes:` block (outside any `services:` entry) declares `mailpit-tls`.
6. Regression guard: `docker/compose.yaml`'s own `mailpit` service block does not already define
   `MP_SMTP_TLS_CERT` (if it ever did, the premise of "the base ships no cert" changes).

No new test file: this is the file 9.9a already built for exactly this purpose (asserting the live
overlay's shape by regex over the committed YAML, no new `js-yaml` dependency), and the task's own
instructions say to check for an existing compose-parsing test before assuming none exists — this
is it.

## `scripts/live-deploy.sh` changes

One new `say` line, placed right before the existing "building and starting the live stack" line
(no behavioural change needed: `docker compose ... up -d --build` already creates `mailpit-cert`,
waits for it to exit 0, then starts `mailpit` and `web` in order, purely from the `depends_on`
conditions above — nothing in the script itself has to orchestrate that):
```bash
say "mailpit's self-signed STARTTLS cert (mailpit-tls volume) generates on first run only; a rerun reuses it"
```
And a short comment near the top (alongside the existing header comment block) noting that the
live stack now runs a one-shot `mailpit-cert` container before `mailpit`/`web` start, so a human
reading `docker compose ps` output during a deploy and seeing `mailpit-cert` exit 0 knows that's
expected, not a crash.

## `docs/live-demo.md` changes

1. **Step 2** (the `EMAIL_SERVER`/Resend paragraph): the existing "leave `EMAIL_SERVER`/
   `EMAIL_FROM` unset instead — the stack falls back to Mailpit" sentence stays (it's the right
   advice), but gets one added clause noting that this path now actually works on the live https
   deploy — Mailpit's STARTTLS is backed by a self-signed cert the stack generates on first run,
   and `web` is told to trust it (`NODE_EXTRA_CA_CERTS`), fixing the bug this task exists for.
2. **Step 3** (right after the existing `s3.` subdomain paragraph 9.9c added): a new short
   paragraph: the first `docker compose ... up -d --build` (or `live-deploy.sh`) run also creates
   a one-shot `mailpit-cert` container that generates a self-signed cert into a Docker-managed
   volume (`mailpit-tls`), shared read-only with `mailpit` and `web`; it exits 0 once done (visible
   in `docker compose ps`) and every later run reuses the same cert — no human step needed, and no
   cert material ever appears in this repo or in `docker/.env`. One line on rotation: removing the
   `mailpit-tls` volume (not routine) forces a fresh cert on the next run.
3. **Step 6 (smoke checklist)**: add one bullet — "Sign-in mail over Mailpit (the `EMAIL_SERVER`-
   unset path) works over STARTTLS; a `MailSendError`/`sign-in mail failed` in `web`'s logs with
   Mailpit answering `502 5.5.1 Command not implemented` means the `mailpit-tls` volume or the
   `mailpit-cert` container's exit code needs checking by hand (`docker compose ... logs
   mailpit-cert`)."
4. No change to the Resend-path wording elsewhere in the doc (step 2's `EMAIL_SERVER=smtps://
   resend:...` block, step 4's "If you set `EMAIL_SERVER`/`EMAIL_FROM` for Resend" branch): the
   task's explicit constraint is that the Resend path stays completely unchanged.

## Files to create
None.

## Files to modify
- `docker/compose.live.yaml`
- `apps/web/test/live-overlay-fail-closed.test.ts`
- `scripts/live-deploy.sh`
- `docs/live-demo.md`

## Files out of bounds
`apps/web/src/auth/**` (explicit constraint — `requireTls`/certificate verification behaviour is
untouched), `apps/web/src/auth/mail.ts` specifically, `docker/compose.yaml`, `docker/Caddyfile`,
`docker/Caddyfile.live` (no Caddy change needed — Mailpit's SMTP port never goes through Caddy),
`docker/env.example` (no new env var is operator-facing here; both new values are compose-internal
container paths, not something a human fills into `docker/.env`), `packages/contracts/**`,
`.github/workflows/**`, `.claude/**`, `apps/worker/**` (worker never sends mail — confirmed by grep,
see "Context already resolved").

## Tests first
1. Fix the now-broken `mailpit` assertion in `apps/web/test/live-overlay-fail-closed.test.ts`
   (see above) before writing the compose changes, so the builder can watch it go from red (old
   assertion against the *current* file, which already fails once mailpit gains any block at all)
   to green against the new file — same TDD discipline 9.9a's own test file used.
2. Add the six new assertions (new `describe` block) above against the *not-yet-written*
   `docker/compose.live.yaml` changes — they fail first (file doesn't have the new lines yet), then
   pass once the compose changes land.
3. Run via `corepack pnpm turbo run test --filter=@edmate/web` (full package suite, not a
   single-file filter — this repo's own lesson, `docs/lessons.md` "Red CI from changes that passed
   locally", plus 9.9a's own handoff noting vitest's coverage thresholds are evaluated globally).
4. `corepack pnpm turbo run typecheck lint --filter=@edmate/web` clean (no source files change
   here, only a test file, so this should be a no-op pass-through, but confirm anyway).
5. `python3 -I -c "import yaml; yaml.safe_load(open('docker/compose.live.yaml'))"` — confirms valid
   YAML, no duplicate mapping keys, same check 9.9c ran.
6. `bash -n scripts/live-deploy.sh` — confirms the new line didn't break the script's syntax.

## How a human (lead/console) verifies this without editing anything
1. ```
   export EDMATE_PUBLIC_HOST=test.example.invalid EDMATE_TRUSTED_PROXY_RANGES='127.0.0.1/32 ::1/128' \
     S3_REGION=us-test-1 S3_ACCESS_KEY_ID=live-test-key S3_SECRET_ACCESS_KEY=live-test-secret-value \
     S3_BUCKET=live-test-bucket
   docker compose -f docker/compose.yaml -f docker/compose.live.yaml config
   ```
   Expect: no error; the merged `web` service's `depends_on` shows **five** entries (`postgres`,
   `redis`, `minio`, `mailpit` — all `condition: service_healthy` — and `mailpit-cert`:
   `condition: service_completed_successfully`), not four; `web`'s `environment` includes
   `NODE_EXTRA_CA_CERTS: /tls/cert.pem` alongside every pre-existing live-overlay key; `web`'s
   `volumes` includes `mailpit-tls:/tls:ro`; `mailpit`'s `environment` shows
   `MP_SMTP_TLS_CERT`/`MP_SMTP_TLS_KEY`; a `mailpit-cert` service is present with no published
   ports; the top-level `volumes` block lists `mailpit-tls`.
2. On the real VM (this is the part the builder cannot do):
   `scripts/live-deploy.sh <the real host>`, then `docker compose -f docker/compose.yaml -f
   docker/compose.live.yaml logs mailpit-cert` (expect the "generated a new self-signed cert"
   line on the first run, "existing cert found, skipping" on a rerun), then sign in at
   `https://<the real host>/sign-in` with `EMAIL_SERVER` unset and confirm `POST
   /api/auth/signin/email` returns a 302 to `verify-request` and the mail appears in Mailpit
   (reachable per `docs/live-demo.md` step 4's existing SSH-tunnel recipe). Paste the (redacted)
   result into the handoff.

## Risky paths touched
None (checked against `.claude/skills/merge-gate/risk-paths.txt`): every file this task touches —
`docker/compose.live.yaml`, `scripts/live-deploy.sh`, `docs/live-demo.md`,
`apps/web/test/live-overlay-fail-closed.test.ts` — falls outside every listed glob group. In
particular `apps/web/src/auth/**` (the security-reviewer group that *is* listed) is explicitly not
touched; `apps/web/test/**` is a different, unlisted path, same conclusion 9.9a already reached for
the same test file. Required reviewers: `code-reviewer` + `typescript-reviewer` (matching 9.9c, the
closest sibling task with the same risk-path shape). The board's `risk: risky` label on 9.9d is a
human-judgment label (live-demo critical path), not a risk-paths.txt match — the handoff still logs
a `risk: high` decision per that board label, same as every other 9.9-family task.

## Decisions (draft, to go in the handoff)
- Decided: a true Docker named volume (`mailpit-tls`), not a `docker/data/...` host bind mount.
  Why: the board task specifies "via a named volume"; it also keeps the self-signed private key
  out of the repo checkout tree entirely. Risk: low.
- Decided: a new one-shot init-container service (`mailpit-cert`), breaking 9.9a's self-imposed
  "every overlay service name already exists in the base file" convention. Why: the task requires
  either an init container or a sidecar for cert generation, which is necessarily a new service
  name; Compose fully supports services defined only in an overlay file. Risk: low.
- Decided: `node:22.22.3-alpine3.22` (already the exact base of `apps/web`'s and `apps/worker`'s
  own Dockerfiles) as the init container's image, with `apk add --no-cache openssl` run at
  container start, rather than pinning a brand-new third-party openssl-bearing image by digest.
  Why: introduces no new image to track; matches the inline-`apk add` idiom
  `apps/worker/Dockerfile`'s ffmpeg stage already uses. Risk: low.
- Decided: both generated files get `chmod 644` (world-readable, including the private key).
  Why: this cert protects nothing outside the Docker-internal sandbox mail path between `mailpit`
  and `web` (Mailpit has no outbound relay); `mailpit`/`web` may run as different non-root
  container users and both need read access regardless of UID. Risk: low.
- Decided: `NODE_EXTRA_CA_CERTS` is wired onto `web` only, not `worker`. Why: grepping
  `nodemailer`/`createTransport` across `apps/` shows only `apps/web/src/auth/mail.ts` ever opens
  an SMTP connection; the worker never sends mail. Risk: low.
- Decided: no change to `docker/env.example`. Why: both new env values (`MP_SMTP_TLS_CERT`/
  `MP_SMTP_TLS_KEY`/`NODE_EXTRA_CA_CERTS`) are fixed, compose-internal container paths the overlay
  itself sets — nothing a human ever fills into `docker/.env` by hand. Risk: low.

## Open questions
None. The board task's own text is prescriptive enough (it names the exact env vars, the exact
mechanism Console already proved on the VM, and the two allowed shapes — init container or
sidecar) that nothing here needs a new human decision. The one judgment call this plan makes
(init container over sidecar, and the specific base image for it) is recorded above as a low-risk
builder decision, not an open question.

## Budget
Budget: 70 tool calls (1 phase, no packages)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (test/typecheck/lint runs, `bash -n`, and the `python3 -I`
YAML-parse check only — no docker, SSH, model or payment calls)

## Exit conditions
Status: DONE once `docker/compose.live.yaml` matches the design above, `scripts/live-deploy.sh`
and `docs/live-demo.md` describe the cert step, `apps/web/test/live-overlay-fail-closed.test.ts`'s
fixed assertion and new `describe` block both pass, and `corepack pnpm turbo run typecheck lint
test --filter=@edmate/web` is clean — with the handoff stating plainly (like 9.9c's did) that the
real-VM clause of the accept line (`POST /api/auth/signin/email` → 302, mail lands in Mailpit,
against the real public URL) is verified by the lead/console after merge, not by this builder.
Status: PARTIAL past about 70 tool calls, or if the `depends_on`-merge-by-key reasoning (the one
thing flagged above as needing a real `docker compose config` run) turns out to need that real run
before the builder can be confident the design is even internally consistent — stop and hand back
rather than guessing further.
