# Run the live demo

By the end you will have the same three accounts as the local try-it guide (`docs/try-it.md`), but
reachable from a public `https://` URL on the `edmate-app` VM instead of your machine: a **staff**
member, the **demo teacher** and a **student**. The teacher uploads a short lesson. The student
starts a package and asks about the lesson, and the tutor streams back a reply based on it.

Sign-in mail on the live site goes out through Resend (human decision B-25; see
`docs/setup/sign-in-mail-and-proxy.md`), not the local Mailpit sandbox `docs/try-it.md` uses — so,
unlike that guide, the three accounts below need **real, deliverable addresses**, not made-up
`.test`/`.invalid` ones. See the note in step 2 about which addresses actually work without a
verified sending domain.

## 1. What you need

- SSH access to `edmate-app`. Nothing else on your own machine — no local Docker, no local Node.
- The VM already has a clean checkout of this repo, Docker, and Node 22 via nvm (see
  `docs/azure-vm.md` for how the VM itself was provisioned; that is a one-time step, not part of
  this guide). `scripts/live-deploy.sh` runs `pnpm install`/build/migrate/seed on the VM's own
  Node, not inside a container, and loads nvm itself so that works over a non-interactive SSH
  session.

## 2. Fill in `docker/.env` by hand on the VM

Every value below is filled in **by hand, on the VM, by whoever is running the demo** — never by
an agent, never pasted into a doc, a commit, a message or a log. `docker/.env` is gitignored and
never leaves the VM.

This is non-negotiable for `EDMATE_ANTHROPIC_API_KEY` in particular: it is a real, billable
Anthropic API key. Only the human running the demo holds it. No agent writes it, reads it back, or
repeats it in a message — if an agent is ever asked to, that is a mistake and the key should be
rotated.

On the VM, from the repo root:

```bash
cp docker/env.example docker/.env
openssl rand -base64 32   # use the output for AUTH_SECRET below
openssl rand -hex 16      # use the output for S3_ACCESS_KEY_ID below
openssl rand -base64 32   # use the output for S3_SECRET_ACCESS_KEY below
```

Open `docker/.env` and fill in exactly these lines (one copy-paste block — nothing else in the
file needs to change):

```
AUTH_SECRET=<the first openssl output above>
EDMATE_ANTHROPIC_API_KEY=<your Anthropic key>
S3_REGION=us-east-2
S3_ACCESS_KEY_ID=<the second openssl output above>
S3_SECRET_ACCESS_KEY=<the third openssl output above>
S3_BUCKET=edmate-live
EMAIL_SERVER=smtps://resend:<your Resend API key>@smtp.resend.com:465
EMAIL_FROM=Edmate <onboarding@resend.dev>
```

The four `S3_*` lines matter even though this stack's storage is just the `minio` container
running on the VM, not a third-party bucket: the live overlay (`docker/compose.live.yaml`)
requires real, non-default values for these — unlike the local dev stack, it refuses to start
`web`/`worker` with the dev placeholder values `docker/compose.yaml` otherwise defaults to
(`us-east-1` / `edmate-dev` / `edmate-dev-storage` / `edmate-dev`), so the live demo can never end
up running on those placeholders by accident. Pick any values that aren't the dev defaults; the
ones above are just as good as any other. MinIO itself ignores `S3_REGION` entirely — it only
needs to not equal the dev stack's own default (`us-east-1`), so `us-east-2` above is just a
convenient, clearly-non-default placeholder, not a meaningful setting.

`EMAIL_SERVER`/`EMAIL_FROM` route sign-in mail through Resend (human decision B-25) instead of the
local Mailpit sandbox `docs/try-it.md` uses. **Without a verified sending domain in Resend**,
`onboarding@resend.dev` can only deliver to the Resend account's own owner — not to arbitrary
addresses like the made-up `.test`/`.invalid` ones `docs/try-it.md` uses. Until a domain is
verified (see `docs/setup/sign-in-mail-and-proxy.md`), use the Resend account owner's own real
email address for every account you sign in as in step 5, not a made-up one. If you'd rather keep
testing with made-up addresses, leave `EMAIL_SERVER`/`EMAIL_FROM` unset instead — the stack falls
back to Mailpit, and step 4 below still applies in that case.

Never paste any of these values anywhere else. If a value ever leaks, rotate it at the source
(the Anthropic console for the API key, the Resend dashboard for the API key); deleting it from
the file isn't enough.

`EDMATE_PUBLIC_HOST` is also filled in by hand, but **not** in `docker/.env` — see step 3. Keeping
it out of this file is deliberate: it's an environment variable or script argument only, so a
stale value left over in `docker/.env` from an earlier run can never silently override the host
the script was actually just told to use.

## 3. Run the deploy script

Still on the VM, from the repo root:

```bash
export EDMATE_PUBLIC_HOST=<your-vm-hostname>
scripts/live-deploy.sh
```

(Or pass the host as an argument instead of exporting it: `scripts/live-deploy.sh <your-vm-hostname>`.)

`<your-vm-hostname>` is a placeholder — use whatever public hostname actually resolves to this VM.
The script pulls `main`, builds and starts the live stack, migrates and seeds the database, waits
up to four minutes for `/api/health` to answer, and prints `live at: https://<your-vm-hostname>`. It
is safe to rerun: a clean pull and `docker compose up -d --build` are both idempotent, and the
script fails loudly (not silently) if the tree is dirty, diverged, or a required var is missing.

The S3 API is served on `s3.<your-vm-hostname>` (`docker/Caddyfile.live`), not a path under the
app's own host, so that part of the stack needs that subdomain to resolve too. If
`<your-vm-hostname>` is an [sslip.io](https://sslip.io) address (the VM's own public IP with dots
swapped for dashes, e.g. `20-186-28-171.sslip.io`), this needs nothing extra — sslip.io resolves
any label prefix of the IP-based name to the same address, so `s3.20-186-28-171.sslip.io` already
works. A real custom domain instead needs its own DNS record for the `s3.` subdomain pointing at
the VM before running the script.

## 4. Read sign-in links

**If you set `EMAIL_SERVER`/`EMAIL_FROM` for Resend in step 2**: sign-in links arrive as real
email. Check the inbox of whichever real address you used to sign in (the Resend account owner's
address, per the note in step 2, unless a domain is verified).

**If you left `EMAIL_SERVER`/`EMAIL_FROM` unset**: the stack falls back to Mailpit, whose web UI
is bound to `127.0.0.1` on the VM. Read it over the tailnet with the same SSH port-forward pattern
`docs/azure-vm.md` already uses for the VM's internal services:

```bash
ssh -L 8025:127.0.0.1:8025 edmate@<your-vm-hostname>
```

Then open <http://127.0.0.1:8025> on your own machine.

## 5. Make a staff account, verify the teacher, upload, chat

Same steps as `docs/try-it.md` §4-6, with the URL swapped to `https://<your-vm-hostname>`. If
you're using Resend (step 2), sign in with the real address(es) from step 2's note instead of the
made-up `staff@example.test`/`demo-teacher@example.invalid` addresses below — those only work if
you left `EMAIL_SERVER`/`EMAIL_FROM` unset (Mailpit fallback). Read sign-in links per step 4.

1. Open `https://<your-vm-hostname>/sign-in`, sign in as `staff@example.test` (or your real
   address), grant the role with `corepack pnpm --filter @edmate/db db:grant-role -- --email
   staff@example.test --role staff --by operator` (substitute the address you actually used).
2. Sign in as `demo-teacher@example.invalid` (or your real address), fill in the profile, then
   verify it as staff with `corepack pnpm --filter @edmate/db db:verify-teacher -- --email
   demo-teacher@example.invalid --status verified --by <staff id>` (substitute the address you
   actually used).
3. Upload `docs/try-it/sample-lesson.md` from the teacher's uploads page; it should go
   **Processing** → **Ready** within a few seconds.
4. In a private window, sign in as a student, pass the age check, start a package, and ask about
   the lesson in the chat. The reply streams in.

## 6. Smoke checklist

- `https://<your-vm-hostname>/api/health` answers `200`.
- Sign-in mail for each account arrives — in the real inbox via Resend, or in Mailpit over the
  tailnet (step 4) — not over the public internet either way.
- The teacher's upload goes **Processing** → **Ready**. If it doesn't, the MinIO bucket may be
  missing — this script deliberately does not create it (see the task's Decisions); run it by hand:
  `docker compose -f docker/compose.yaml -f docker/compose.live.yaml exec worker npm run storage:roundtrip`.
- The student's chat gets a real reply with no error.

## 7. Troubleshooting

Entries carried over from `docs/try-it.md` that still apply on the live stack:

- **The chat says "Something went wrong"**: check the `web` service logs for
  `turn.runtime_unavailable reason=...`. `provider_key` means the Anthropic key in `docker/.env` is
  missing or too short.
- **`DATABASE_URL is not set`**: only relevant if you run a `db:*` or `pnpm seed` command by hand
  outside the script; the script exports it itself.
- **The upload fails with NoSuchBucket**: run the `storage:roundtrip` command from step 6.
- **`db:grant-role` says "no user has that email"**: sign in once with that address first.

New on the live stack:

- **Sign-in or CORS errors behind HTTPS**: usually an `EDMATE_PUBLIC_HOST`/`AUTH_URL` mismatch — the
  cookie and the allowed POST/PUT/PATCH/DELETE origin are both derived from the host the script was
  given. Confirm `EDMATE_PUBLIC_HOST` (or the argument passed to `scripts/live-deploy.sh`) matches
  the hostname you're actually browsing to, then rerun the script. Fixing the wiring itself, if it
  turns out to need more than this, is a follow-up task, not part of this guide.
- **`web`/`worker` fail to start with an `S3_..._missing` or `S3_..._placeholder` error**: one of
  the four `S3_*` lines in step 2 is unset or still has a dev-default value. Fill in real values
  (any value that isn't `edmate-dev`/`edmate-dev-storage`) and rerun the script — this is the live
  overlay's deliberate refusal to run on the dev stack's own placeholder values, not a bug.
