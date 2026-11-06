# Run the live demo

By the end you will have the same three accounts as the local try-it guide (`docs/try-it.md`), but
reachable from a public `https://` URL on the `edmate-app` VM instead of your machine: a **staff**
member, the **demo teacher** and a **student**. The teacher uploads a short lesson. The student
starts a package and asks about the lesson, and the tutor streams back a reply based on it.

Every address in this guide is made up (`.test` and `.invalid` domains). Sign-in mail goes to
Mailpit, the same local mail catcher `docs/try-it.md` uses — it never sends real email, and its web
UI is reachable only over the tailnet, never the public internet.

## 1. What you need

- SSH access to `edmate-app`. Nothing else — no local Docker, no local Node.
- The VM already has a clean checkout of this repo and Docker running (see `docs/azure-vm.md` for
  how the VM itself was provisioned; that is a one-time step, not part of this guide).

## 2. Fill in `docker/.env` by hand on the VM

On the VM, from the repo root:

```bash
cp docker/env.example docker/.env
openssl rand -base64 32
```

Open `docker/.env` and fill in only these two lines:

```
AUTH_SECRET=<the output of openssl rand -base64 32>
EDMATE_ANTHROPIC_API_KEY=<your Anthropic key>
```

Leave `EMAIL_SERVER` and `EMAIL_FROM` unset. The live demo keeps using Mailpit until a real mail
provider exists (human decision; see `docs/setup/sign-in-mail-and-proxy.md`). Mailpit's own web UI
stays bound to `127.0.0.1` on the VM, never public — see step 4 for how to reach it anyway.

`docker/.env` is gitignored and never leaves the VM. Never paste a key anywhere else. If a key ever
leaks, rotate it at the provider; deleting it from the file isn't enough.

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

## 4. Reach Mailpit to read sign-in links

Mailpit's web UI is bound to `127.0.0.1` on the VM, so read it over the tailnet with the same
SSH port-forward pattern `docs/azure-vm.md` already uses for the VM's internal services:

```bash
ssh -L 8025:127.0.0.1:8025 edmate@<your-vm-hostname>
```

Then open <http://127.0.0.1:8025> on your own machine.

## 5. Make a staff account, verify the teacher, upload, chat

Same steps as `docs/try-it.md` §4-6, with the URL swapped to `https://<your-vm-hostname>` and
sign-in mail read from the tailnet-forwarded Mailpit (step 4) instead of a local one:

1. Open `https://<your-vm-hostname>/sign-in`, sign in as `staff@example.test`, grant the role with
   `corepack pnpm --filter @edmate/db db:grant-role -- --email staff@example.test --role staff --by operator`.
2. Sign in as `demo-teacher@example.invalid`, fill in the profile, then verify it as staff with
   `corepack pnpm --filter @edmate/db db:verify-teacher -- --email demo-teacher@example.invalid --status verified --by <staff id>`.
3. Upload `docs/try-it/sample-lesson.md` from the teacher's uploads page; it should go
   **Processing** → **Ready** within a few seconds.
4. In a private window, sign in as a student, pass the age check, start a package, and ask about
   the lesson in the chat. The reply streams in.

## 6. Smoke checklist

- `https://<your-vm-hostname>/api/health` answers `200`.
- Sign-in mail for each account arrives in Mailpit, read over the tailnet (step 4) — not over the
  public internet.
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
