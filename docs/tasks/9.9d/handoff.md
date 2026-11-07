# Handoff: 9.9d — self-signed STARTTLS cert for Mailpit on the live https deploy

Status: DONE (builder side). Per the plan, the real-VM clause of the accept line (`POST
/api/auth/signin/email` → 302 `verify-request`, mail lands in Mailpit, against the real public
URL) cannot be produced from this worktree (no docker binary / VM / SSH access, same constraint as
9.9a/9.9b/9.9c/1.4d) — the lead/console reruns `scripts/live-deploy.sh` on `edmate-app` after merge
and pastes the real (redacted) result here before closeout.

## Files changed
- `docker/compose.live.yaml` — new top-level `volumes: { mailpit-tls: }`; new one-shot
  `mailpit-cert` init-container service (generates a self-signed STARTTLS cert via
  `node:22.22.3-alpine3.22` + `apk add openssl`, idempotent, `restart: 'no'`); `mailpit` gains
  `depends_on: mailpit-cert (service_completed_successfully)`, `MP_SMTP_TLS_CERT`/
  `MP_SMTP_TLS_KEY` env, read-only `mailpit-tls:/tls:ro` mount; `web` gains the same `depends_on`,
  `NODE_EXTRA_CA_CERTS: /tls/cert.pem` env, and the same read-only mount; top comment reworded.
- `apps/web/test/live-overlay-fail-closed.test.ts` — fixed the now-broken "mailpit isn't
  mentioned" assertion to the `not.toContain('ports:')` shape (same as `minio`); added a new
  `describe('live overlay: mailpit STARTTLS cert (task 9.9d)')` block with the six assertions the
  plan specifies (cert/key env + ro mount on both `mailpit` and `web`; the cert path is
  byte-for-byte identical on both sides; the `mailpit-cert` service exists, runs `openssl req
  -x509`, and mounts the volume writably, not `:ro`; the top-level `volumes:` block declares
  `mailpit-tls`; regression guard that the base `docker/compose.yaml` mailpit service never
  defines `MP_SMTP_TLS_CERT`).
- `scripts/live-deploy.sh` — one new `say` line before the "building and starting the live stack"
  line, plus a header comment noting the one-shot `mailpit-cert` container and that seeing it exit
  0 in `docker compose ps` during a deploy is expected.
- `docs/live-demo.md` — step 2 paragraph now notes the Mailpit-fallback path actually works on
  live https (STARTTLS backed by the generated cert, `web` trusts it); step 3 gets a new paragraph
  on the one-shot `mailpit-cert` container/volume and rotation; step 6 smoke checklist gets one new
  bullet on the STARTTLS failure mode and how to check `mailpit-cert`'s logs/exit code.

No files created; no files touched outside the plan's "Files to modify" list;
`apps/web/src/auth/**`, `apps/web/src/auth/mail.ts`, `docker/compose.yaml`, `docker/Caddyfile*`,
`docker/env.example`, `packages/contracts/**`, `.github/workflows/**`, `.claude/**`,
`apps/worker/**` were not touched, per the plan's "Files out of bounds".

## How verified
- `python3 -I -c "import yaml; yaml.safe_load(open('docker/compose.live.yaml'))"` → parses clean,
  no duplicate keys.
- `bash -n scripts/live-deploy.sh` → clean.
- Hand-traced the test file's `serviceBlock`/`literalValue` regexes against the actual new
  `docker/compose.live.yaml` text with a throwaway Node snippet (not committed) before trusting the
  new assertions — confirmed each of the six new assertions evaluates true against the file as
  written (cert/key env + `:ro` mounts on `mailpit` and `web`; identical cert path string; the
  `mailpit-cert` block contains `openssl req -x509` and a writable (non-`:ro`) volume line; the
  top-level `volumes:` block matches; the base file's `mailpit` has no `MP_SMTP_TLS_CERT`).
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web` → 10/10 tasks successful,
  exit code 0 (full package suite, not a single-file filter, per the plan's "Tests first" step 3
  and `docs/lessons.md`'s "Red CI from changes that passed locally" lesson).
- `python3 .githooks/secret-scan.py --all` → clean (exit 0).
- Not verified here (needs the real VM, per the plan): `docker compose -f docker/compose.yaml -f
  docker/compose.live.yaml config` merge (the plan's "How a human verifies this" step 1 gives the
  exact command and expected merged `depends_on`/`environment`/`volumes` shape — five `web`
  `depends_on` entries, `NODE_EXTRA_CA_CERTS`, `mailpit-tls:/tls:ro`, etc.); the actual
  `scripts/live-deploy.sh` run against `edmate-app`, the sign-in POST → 302 → Mailpit mail landing,
  and pasting the redacted real-host result.

## Decisions
- Decided: a true Docker named volume (`mailpit-tls`), not a `docker/data/...` host bind mount. Why: the board task specifies "via a named volume"; it also keeps the self-signed private key out of the repo checkout tree entirely. Alternatives: a host bind mount under `docker/data/`, rejected per the task's own wording and the private-key-exposure risk. Reversible: yes (swap the volume definition later if ever needed).
- Decided: a new one-shot init-container service (`mailpit-cert`), breaking 9.9a's self-imposed "every overlay service name already exists in the base file" convention. Why: the task requires either an init container or a sidecar for cert generation, which is necessarily a new service name; Compose fully supports services defined only in an overlay file. Alternatives: a long-running sidecar, rejected as unnecessary complexity for a one-time generation step. Reversible: yes.
- Decided: `node:22.22.3-alpine3.22` (already the exact base of `apps/web`'s and `apps/worker`'s own Dockerfiles) as the init container's image, with `apk add --no-cache openssl` run at container start, rather than pinning a brand-new third-party openssl-bearing image by digest. Why: introduces no new image to track; matches the inline-`apk add` idiom `apps/worker/Dockerfile`'s ffmpeg stage already uses. Alternatives: a dedicated openssl/alpine image pinned by digest, rejected as an unnecessary new third-party image to track. Reversible: yes.
- Decided: both generated files get `chmod 644` (world-readable, including the private key). Why: this cert protects nothing outside the Docker-internal sandbox mail path between `mailpit` and `web` (Mailpit has no outbound relay); `mailpit`/`web` may run as different non-root container users and both need read access regardless of UID. Alternatives: a stricter private-key mode plus matching UID/GID across services, rejected as unnecessary complexity for a cert with no value outside this container network. Reversible: yes.
- Decided: `NODE_EXTRA_CA_CERTS` is wired onto `web` only, not `worker`. Why: grepping `nodemailer`/`createTransport` across `apps/` shows only `apps/web/src/auth/mail.ts` ever opens an SMTP connection; the worker never sends mail. Alternatives: wiring it onto `worker` too for symmetry, rejected as unneeded. Reversible: yes.
- Decided: no change to `docker/env.example`. Why: both new env values (`MP_SMTP_TLS_CERT`/`MP_SMTP_TLS_KEY`/`NODE_EXTRA_CA_CERTS`) are fixed, compose-internal container paths the overlay itself sets — nothing a human ever fills into `docker/.env` by hand. Alternatives: documenting them there anyway for visibility, rejected as noise since they're never operator-set. Reversible: yes.

Risk label: `risk: high` (board's `risk: risky` label on 9.9d — live-demo critical path, human
judgment, not a `risk-paths.txt` match). Risky paths touched: none per
`.claude/skills/merge-gate/risk-paths.txt` (confirmed in the plan); required reviewers per the
plan: `code-reviewer` + `typescript-reviewer`.

## Tool calls used
~38 (well under the plan's 70-call budget).
