# Try Edmate on your machine

By the end you will have three accounts on a local Edmate: a **staff** member, the **demo
teacher** and a **student**. The teacher uploads a short lesson. The student starts a package and
asks about the lesson, and the tutor streams back a reply based on it.

It takes about 30 minutes. Most of that is the first image build.

Everything runs on your machine. Sign-in mail goes to Mailpit, a local mail catcher that never
sends real email. Every address in this guide is made up (`.test` and `.invalid` domains).

## 1. What you need

- Docker Desktop, running.
- Node 22 from nvm. From the repo root:

  ```bash
  source ~/.nvm/nvm.sh
  corepack pnpm install
  ```

- Free local ports 8080, 8025, 9000, 9001 and 55432. If another Edmate stack already uses them,
  stop it first with `docker compose -f docker/compose.yaml down`.
- An Anthropic API key, for real replies only. Use a plan that doesn't train on your inputs. You
  can do the whole guide without a key first; see [Dry run without a key](#7-optional-dry-run-without-a-key).

## 2. Make `docker/.env`

```bash
cp docker/env.example docker/.env
openssl rand -base64 32
```

Open `docker/.env` and fill in only these two lines:

```
AUTH_SECRET=<the output of openssl rand -base64 32>
EDMATE_ANTHROPIC_API_KEY=<your Anthropic key>
```

Leave everything else as it is. Compose reads `docker/.env` by itself.

- `docker/.env` is gitignored, and the secret scan blocks keys at commit. Never paste the key
  anywhere else in the repo.
- If the key ever leaks, rotate it in the Anthropic console. Deleting it from the file isn't
  enough.

## 3. Start the stack

From the repo root:

```bash
docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d --build
```

The first build takes a few minutes (see [Timings](#timings)). The second file publishes
Postgres on `127.0.0.1:55432`, so the next commands can reach it from your machine.

Then create the tables, seed the demo teacher, and create the upload bucket:

```bash
export DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate
corepack pnpm --filter @edmate/db db:migrate
corepack pnpm seed
docker compose -f docker/compose.yaml exec worker npm run storage:roundtrip
```

You should see:

- `db:migrate: migrations applied`
- `seed: inserted 55 rows` (or `seed: already seeded` on a second run)
- `[storage:roundtrip] ok: ... (bucket created; object deleted)`

Check that the app is up: open <http://localhost:8080/api/health>. It should answer `200`.

Keep `DATABASE_URL` exported in this terminal. Steps 4 and 5 need it.

## 4. Make a staff account

Everyone signs in as a student first, and staff is granted from the command line.

1. Open <http://localhost:8080/sign-in> and click **Sign in with email instead**.
2. Enter `staff@example.test` and click **Sign in with Email**.
3. Open Mailpit at <http://127.0.0.1:8025>, open the newest mail and click its sign-in link.
4. Grant the role:

   ```bash
   corepack pnpm --filter @edmate/db db:grant-role -- --email staff@example.test --role staff --by operator
   ```

   It prints `db:grant-role: user <id> is now staff`. Copy that id for step 5.

## 5. Teacher: profile, verification, upload

Use the seeded demo teacher. A brand-new teacher can sign up and fill in a profile, but can't
get an agent until the agent builder ships, so no student could chat with them yet.

1. Sign out (top right), then sign in the same way as `demo-teacher@example.invalid`.
2. Open <http://localhost:8080/teacher/onboarding>. The banner says the profile is pending
   review. Change the **Bio** and click **Save changes**.
3. Verify the teacher as staff, with the id from step 4:

   ```bash
   corepack pnpm --filter @edmate/db db:verify-teacher -- --email demo-teacher@example.invalid --status verified --by <staff id>
   ```

   It prints `db:verify-teacher: teacher demo-teacher is now verified`. Reload the page, and the
   banner says **Your profile is verified.**
4. Open <http://localhost:8080/teacher/uploads>. Click **Upload a file** and choose
   `docs/try-it/sample-lesson.md` from the repo. Its status goes from **Processing** to **Ready**
   within a few seconds. The page checks every 4 seconds.

## 6. Student: age check, package, chat

1. Open a private window, so the teacher stays signed in. Sign in as `student1@example.test`.
2. The age check asks where you live. Choose **United States**, click **Next**, enter `1990` as
   your birth year and click **Continue**. If you don't land on it, open
   <http://localhost:8080/welcome/age>.
3. Open <http://localhost:8080/home>, click **Start a package**, then **Start** under
   **Full course**. Payments aren't built yet, so a paid package starts with no payment.
4. You land on the chat. Ask:

   > What is the tamarind counter rule?

   The reply streams in. It should explain the made-up rule from the lesson: the counter starts at
   7 and goes up by 3. With a real model the wording changes on every run.

That's the whole flow.

## 7. Optional: dry run without a key

To check the wiring without spending anything, use the scripted dev model.

- Leave `EDMATE_ANTHROPIC_API_KEY` empty and add `EDMATE_DEV_MODEL=scripted` to `docker/.env`.
- Then run `docker compose -f docker/compose.yaml up -d web` to restart the web app.

Replies then start with `[dev model]` and quote the uploaded lesson. Every safety check answers
"all clear", so this mode is only for checking the wiring, never for judging the tutor. It works
only when `AUTH_URL` is `http://localhost...`.

Remove that line and restart `web` again before you chat with the real model.

## 8. Optional: the automated run

The same flow runs headless in Chromium (Playwright), against the running stack:

```bash
corepack pnpm --filter @edmate/web exec playwright install chromium   # once
EDMATE_STACK_URL=http://localhost:8080 \
EDMATE_STACK_MAIL_URL=http://127.0.0.1:8025 \
EDMATE_STACK_DATABASE_URL=$DATABASE_URL \
corepack pnpm --filter @edmate/web e2e:stack
```

- With the dev model, it checks that the reply quotes the lesson.
- With a real key, add `EDMATE_STACK_EXPECT=real`. It then checks only for a final reply with no
  error.
- Each run signs in a new `student-<n>@example.test`.
- Screenshots go to `apps/web/test-results/`.

## Troubleshooting

- **The chat says "Something went wrong"**: run `docker compose -f docker/compose.yaml logs web`
  and look for `turn.runtime_unavailable reason=...`.
  - `provider_key`: the key is missing or too short. Check `docker/.env`, then restart `web`.
  - `EDMATE_MARKET`: the market is unset. Leave it at its default, `US`.
  - `EDMATE_DEV_MODEL`: the dev model is on, but `AUTH_URL` isn't localhost.
- **Use `localhost`, not `127.0.0.1`**, for the app. Sign-in and every form check that the page
  came from `http://localhost:8080`. Mailpit is fine on either.
- **Sign-in error page**: each address gets 5 sign-in links an hour. Wait, or use another
  `@example.test` address.
- **The upload stays on Processing**: run `docker compose -f docker/compose.yaml logs worker`.
  It should show `ingest.embeddings_off` at start-up.
  - The local stack indexes uploads for text search only, so audio and video fail as
    unsupported. Upload Markdown, PDF, Word or PowerPoint instead.
- **The upload fails with NoSuchBucket**: run the `storage:roundtrip` command from step 3.
- **`db:grant-role` says "no user has that email"**: sign in once with that address first.
- **`DATABASE_URL is not set`**: export it again (step 3), in the terminal where you run the
  command.

## Finish

```bash
docker compose -f docker/compose.yaml down
```

Then delete the `EDMATE_ANTHROPIC_API_KEY` line from `docker/.env`. Your data stays in
`docker/data/` (gitignored). Delete that folder to start fresh next time.

## Timings

Measured on 22 Oct 2026 on the builder's Mac, with the dev model and Docker's layer cache already
warm. A cold first build (empty cache) takes longer; that wasn't measured.

| Step | Time |
|---|---|
| `up -d --build` (all images, warm cache) | 2 min 48 s |
| `up -d --build` again (nothing changed, fresh data) | 1 min 16 s |
| Rebuild only `web` after a code change | about 1 min |
| `db:migrate` | 1 s |
| `corepack pnpm seed` (builds `@edmate/db` first) | 7 s |
| `storage:roundtrip` | 1 s |
| Upload to Ready (`sample-lesson.md`) | under 10 s |
| The whole browser flow, automated | 12 s |
