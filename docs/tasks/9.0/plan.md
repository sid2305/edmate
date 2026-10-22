# 9.0 plan: thin-slice end-to-end run and try-it guide

Planner: planner (22 Oct 2026). Human request 22 Oct 2026: a testable product as fast as possible; the human tests tomorrow.

## Acceptance (verbatim)

> docs/try-it.md exists and a person following it from a clean clone reaches a streamed chat reply about uploaded content in under 30 minutes; every wiring fix has a test; the run is recorded in the handoff with screenshots or trimmed logs (no keys).

How it will be shown:
1. Phases A and B: each wiring fix and each dev-only switch has a unit or integration test, seen red first, then green (`corepack pnpm turbo run typecheck lint test --filter=<pkg>...`).
2. Phase C: the builder brings up the full compose stack from its own worktree, under its own project name and ports. It runs the whole flow in headless Chromium (Playwright) against Caddy, then records the trimmed logs and step timings in the handoff. The flow is: teacher sign-in through Mailpit, profile, staff verify, upload, ingest to Ready; then student sign-in, age gate, package start, and chat. The streamed reply quotes the uploaded lesson. The builder uses the dev model (below), never a real key.
3. The real-key step is the human's, following `docs/try-it.md` with their own key in a local `docker/.env`. The handoff says plainly that the builder did not run it.

## What the codebase shows today (why there are wiring fixes)

Read for this plan: `docker/compose.yaml`, `docker/env.example`, `docker/Caddyfile`, `apps/web/Dockerfile`, `apps/worker/Dockerfile`, `apps/web/src/turn/runtime.ts`, `apps/worker/src/index.ts`, `apps/worker/src/ingest/gateway.ts`, the 9.4, 8.2, 9.3, 8.1, 8.1a, 1.4 and 1.5 handoffs.

Each item below would stop the try-it flow on the compose stack, which runs the web image with `NODE_ENV=production`:

| # | Problem | Effect |
|---|---|---|
| W1 | `apps/web/Dockerfile` copies only `content/locales` and `content/legal`. The turn runtime also reads `content/prompt-packs` and `content/skills/mock_interview`. | The runtime build throws, so `POST /api/sessions` and the turn route answer 503. |
| W2 | Compose doesn't pass `EDMATE_MARKET` to `web`, and production fails closed without it (9.4 fix round). | 503 `reason=EDMATE_MARKET`. |
| W3 | Compose doesn't pass `EDMATE_ANTHROPIC_API_KEY` to `web`. | 503 `reason=provider_key`, even with the key in `docker/.env`. |
| W4 | Compose doesn't pass `EDMATE_CHAT_AGENTS`; in production an unset value means no candidates. | `/home` shows no chat link and no "start a package" link. |
| W5 | The worker's ingest needs `EDMATE_OPENAI_API_KEY` (embedder plus Whisper), and compose doesn't pass it. Without the key the ingest worker is skipped (`ingest.worker_disabled`). | Uploads sit in `processing` forever. Chat retrieval is full-text only (9.4 decision), so embeddings aren't used by the slice at all. |
| W6 | No dev or scripted model on the stack: the web runtime needs a real Anthropic key. | The builder can't run a chat turn end to end. |
| W7 (check) | The Caddyfile has `encode gzip` on everything, including `text/event-stream`. | It may buffer the SSE reply. Phase C verifies; fix only if buffered. |
| W8 (docs only) | The MinIO bucket is created only by `storage:roundtrip`. | Presigned PUTs fail with NoSuchBucket until it runs. Documented as a step, no code. |

Staff today: there is no 12.1 staff UI. A user signs in once (becoming a student), then `corepack pnpm --filter @edmate/db db:grant-role -- --email <e> --role staff --by operator`, which prints the user id. Then `db:verify-teacher -- --email <teacher> --status verified --by <that id>`. Both run from the host against Postgres published by `packages/db/test/compose.port.yaml`.

Test accounts (fictional; reserved `.test` / `.invalid` domains; Mailpit catches every address):
- **Teacher:** the seeded `demo-teacher@example.invalid`. It is the only teacher with a live agent (`demo-agent`) and live packages; the agent builder isn't built. Its seeded profile is `pending`, so onboarding shows edit mode and staff verification is a real step.
- **Staff:** `staff@example.test`.
- **Student:** `student1@example.test` in the docs. Phase C uses a fresh `student-<n>@example.test` per run (sign-in links are limited to 5 per address per hour).

## Decisions this plan makes (builder logs them in the handoff `## Decisions`)

- **D1 · Demo teacher, not a fresh one** (risk: low). A fresh teacher can sign up and fill the profile, but has no agent until 8.x, so no student could chat with them. `docs/try-it.md` says so in one line.
- **D2 · Dev model `EDMATE_DEV_MODEL=scripted`** (risk: medium; recommend `security-reviewer` reads `runtime.ts` and `devModel.ts` even though the path isn't on the risky list, because it stands in for the safety classifiers).
  - **Where it works:** only on a local stack. The compose image runs `NODE_ENV=production`, so the guard can't depend on `NODE_ENV`. The switch is honoured only when `AUTH_URL` parses as `http:` with host `localhost`, `127.0.0.1` or `[::1]`. Any other `AUTH_URL`, an unset one, or any value other than exactly `scripted` makes the runtime fail closed: `TurnUnavailableError('EDMATE_DEV_MODEL')`, the routes answer 503, and the log carries the reason code only.
  - **What the adapter does:** it replaces only the provider adapter (`factories.anthropic`), so the metered router, guards, pricing and commit stay real.
  - **Replies:** every reply starts with `[dev model]` and quotes the first retrieved teacher-material text found in the request, or says none was found. `generateObject` returns the first fixed "all clear" candidate the given schema accepts and throws on any schema it can't satisfy (the turn then fails closed). `embed` throws.
  - **Logging and defaults:** one `turn.dev_model_on` log line when it builds. Compose passes `EDMATE_DEV_MODEL: ${EDMATE_DEV_MODEL:-}`, so it is off unless set.
- **D3 · `EDMATE_INGEST_EMBEDDINGS=off`** (risk: medium). The worker indexes documents for full text only: no embedder, no transcriber, no key read. Audio and video then fail as `failed/unsupported`. Unset, or `openai`, keeps today's behaviour (the key is required). Any other value is a config error (`ingest.worker_disabled` with the reason). Compose defaults it to `off` for the local stack, with a comment: chat retrieval is full-text today (9.4), so this costs the slice nothing and the human needs only one key. It is explicit, never a silent fallback when a key is missing.
- **D4 · Compose defaults for the local stack** (risk: low):
  - `EDMATE_MARKET: ${EDMATE_MARKET:-US}` (US is the first region);
  - `EDMATE_CHAT_AGENTS: ${EDMATE_CHAT_AGENTS:-demo-agent}`;
  - `EDMATE_ANTHROPIC_API_KEY: ${EDMATE_ANTHROPIC_API_KEY:-}` on `web`;
  - `EDMATE_OPENAI_API_KEY: ${EDMATE_OPENAI_API_KEY:-}` and `EDMATE_INGEST_EMBEDDINGS` on `worker`.
- **D5 · The stack spec runs only on demand** (risk: low). The Playwright stack run is local and opt-in. It is not in CI, because it needs a running stack.

## Files

### Phase A: web runtime, image and compose wiring (W1-W4, W6)
Modify:
- `apps/web/Dockerfile`: also `COPY` `content/prompt-packs` and `content/skills` (W1).
- `docker/compose.yaml`: the env lines in D2, D3 and D4, for both `web` and `worker`, each with a one-line comment.
- `docker/env.example`: document `EDMATE_MARKET`, `EDMATE_CHAT_AGENTS`, `EDMATE_DEV_MODEL` (local only, what it does, never a substitute for review) and `EDMATE_INGEST_EMBEDDINGS`.
- `apps/web/src/turn/runtime.ts`: choose `devFactories()` when the D2 guard passes; otherwise behave as today.
- `apps/web/src/turn/runtime.test.ts`: add the tests listed below.
- `apps/web/test/turn-backend.ts` (test helper): optional `gateway` override, so a route test can run the dev adapter through real `defaultSteps`.

Create:
- `apps/web/src/turn/devModel.ts` and `devModel.test.ts`.
- `apps/web/src/deploy/stack-config.test.ts`. It goes under `src/` because vitest only includes `app/**` and `src/**`. It does text checks over `apps/web/Dockerfile` and `docker/compose.yaml`; no new dependency.

### Phase B: worker ingest without embeddings (W5)
Modify: `apps/worker/src/ingest/gateway.ts` (+ `gateway.test.ts`), `apps/worker/src/ingest/processor.ts` (+ `processor.test.ts`), `apps/worker/src/index.ts` (one `ingest.embeddings_off` info log), `apps/worker/test/ingest.int.test.ts` (one case).

Phase A owns the compose lines for the worker, so A and B have no file in common. **The lead may run A and B in parallel** on separate work branches and merge both into `m9/9.0-try-it` before C.

### Phase C: the stack run, the try-it guide, run-found fixes
Create:
- `apps/web/playwright.stack.config.ts`: `testDir: './e2e/stack'`, no `webServer`, no `globalSetup`. `baseURL` comes from `EDMATE_STACK_URL` (default `http://localhost:8080`) and is refused unless the host is local, like `sandbox-magic-link.mjs`. Screenshots go to the gitignored Playwright output dir.
- `apps/web/e2e/stack/try-it.spec.ts` (+ `mail.ts` helper): the whole flow (below).
- `docs/try-it.md`: the guide (outline below).
- `docs/try-it/sample-lesson.md`: a short, fictional, open lesson to upload. It holds one distinctive made-up fact plus the question to ask, so the reply visibly comes from the upload.

Modify:
- `apps/web/playwright.config.ts`: `testIgnore: ['stack/**']`, so `pnpm e2e` is unchanged.
- `apps/web/package.json`: script `"e2e:stack": "playwright test -c playwright.stack.config.ts"`.
- `docker/Caddyfile`, only if W7 shows buffering: skip `encode` for `text/event-stream`. Its test goes into `stack-config.test.ts`.
- `docs/tasks/9.0/handoff.md`.
- Any other run-found fix: smallest change plus a test (see Exit conditions).

### Out of bounds (all phases)
- `packages/contracts/**`, `docs/adr/**`, `packages/harness/**` (read only), `content/**` (read only), migrations, `.claude/**`, `.github/**`, `.githooks/**`.
- `packages/db/src/repositories/**`, `packages/db/src/identity/**`, `apps/web/src/auth/**`: see the exit conditions for the one exception.
- Any `.env` file: hooks block it, and the builder exports variables in its shell instead.

## Tests first

### Phase A
- `runtime.test.ts`:
  - The flag with `AUTH_URL=http://localhost:8080` builds the backend with no provider key, logs `turn.dev_model_on`, and never calls `loadProviderKeys`.
  - The flag with `AUTH_URL=https://edmate.example`, with `http://10.0.0.5:8080`, or with `AUTH_URL` unset, rejects with reason `EDMATE_DEV_MODEL`; the routes answer 503; the log has the code only.
  - `EDMATE_DEV_MODEL=yes` or `Scripted` rejects (exact value only).
  - With the flag unset, today's behaviour holds: no key gives `provider_key`.
- `devModel.test.ts`:
  - The stream starts with `[dev model]` and quotes material placed in the request the way the composer renders it. Read `packages/harness/src/pedagogy/compose.ts` to find how; don't change it.
  - With no material, the stream gives the fixed "no material" text and then a usage step.
  - `generateObject` passes each real classifier and judge schema the turn uses (moderation, distress, jailbreak, grounding judge, advice judge, plus any other the turn hits; list them from harness) and throws on an unknown schema.
  - `embed` throws.
- Route level (`src/turn/routes.test.ts` or `devModel.test.ts` via `memoryBackend({ gateway })`): one real `defaultSteps` turn with the dev adapter ends in `done`, with `[dev model]` text and no `error` event.
- `stack-config.test.ts`:
  - The Dockerfile copies every content dir the web reads at run time: `locales`, `legal`, `prompt-packs`, `skills`.
  - Compose `web` passes `EDMATE_MARKET` with a default that has a pack in `content/locales/`, `EDMATE_CHAT_AGENTS` with the default `demo-agent`, `EDMATE_ANTHROPIC_API_KEY`, and `EDMATE_DEV_MODEL` with an empty default.
  - Compose `worker` passes `EDMATE_OPENAI_API_KEY` and `EDMATE_INGEST_EMBEDDINGS`.
  - Each check is proven to catch its fault on a mutated copy of the text.

### Phase B
- `gateway.test.ts`:
  - `off` gives no embedder and no transcriber and reads no key, even when no key is set.
  - Unset or `openai` with no key throws as today.
  - `bogus` throws a config error that names the variable, not its value.
- `processor.test.ts`:
  - With no embedder, markdown reaches `ready` with chunks and no `embed` call.
  - Audio or video with no transcriber ends `failed/unsupported` as a permanent job error, with nothing written.
- `ingest.int.test.ts` (real Postgres and Redis): an enqueued markdown file with no embedder reaches `ready`, and `retrievalRepo.search` finds it by full text.

### Phase C
- `try-it.spec.ts` is itself the test of the run.
- Each run-found fix gets its own unit test before the fix.
- If W7 is fixed, add a Caddyfile check to `stack-config.test.ts`.

## Phase C: the run

Compose project `-p edmate90` with its own ports, so it never touches other sessions' `edmate` containers (1.4's pattern): `EDMATE_HTTP_PORT=18080`, `AUTH_URL=http://localhost:18080`, `EDMATE_S3_PORT=19000`, `EDMATE_S3_CONSOLE_PORT=19001`, `EDMATE_MAIL_UI_PORT=18025`, `EDMATE_PG_TEST_PORT=55442`. Also set `AUTH_SECRET` from `openssl rand -base64 32`, in the shell only, and `EDMATE_DEV_MODEL=scripted`.

1. Time each step (wall clock) for the guide:
   - `docker compose -p edmate90 -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d --build`;
   - migrate and seed from the host against `127.0.0.1:55442`;
   - `exec worker npm run storage:roundtrip` (creates the bucket).
2. Check W7 with `curl -N` on a turn: events must arrive spread over time, not all at the end.
3. `corepack pnpm --filter @edmate/web e2e:stack` with `EDMATE_STACK_URL=http://localhost:18080`, `EDMATE_STACK_MAIL_URL=http://127.0.0.1:18025` and `EDMATE_STACK_DATABASE_URL` set. The spec does the following.
   - **Staff:** sign in as staff (request the link through the Auth.js email form, read it from Mailpit's API, open it). Then run the built `@edmate/db` grant-role CLI as a child process (as `e2e/global-setup.ts` does) and read the printed id.
   - **Teacher:** sign in as the demo teacher, then on `/teacher/onboarding` edit the bio and save. Run the verify-teacher CLI, then reload and check that the banner says verified.
   - **Upload:** on `/teacher/uploads`, upload `docs/try-it/sample-lesson.md` with `setInputFiles` and wait for Ready (the page polls every 4 s, so allow up to 90 s).
   - **Student:** sign in a fresh student in a new browser context. On `/welcome/age`, choose United States and birth year 1990. Then go `/home`, "Start a package", the paid package (all modules; no payment until M10), Start, `/learn/demo-agent`.
   - **Chat:** ask the lesson's question. Wait for the final (non-provisional) reply, then assert that it contains `[dev model]` and the lesson's made-up fact.
   - **Mode switch:** `EDMATE_STACK_EXPECT=real` relaxes the final assertion to "a final reply, no error banner", so the human can rerun the spec with a real key.
   - **Reruns:** if the student already has the package, go straight to `/learn`.
   - **Screenshots:** take one at each of the 5 milestones.
4. Write `docs/try-it.md` from what actually worked, with the measured times.
5. Record in the handoff: the trimmed command output and the spec's list reporter. Optionally add up to 4 screenshots under `docs/tasks/9.0/` (PNG, each ≤ 300 KB, fictional data only). Nothing in it may show a key, `AUTH_SECRET`, a sign-in link token or a cookie.
6. `docker compose -p edmate90 down`. Leave no containers running.

### `docs/try-it.md` outline
- What you'll have: teacher, staff and student, and a streamed reply about your upload. About 30 minutes, most of it the first image build.
- **Prerequisites:** Docker running, Node 22 via nvm, `corepack pnpm install`. No home-directory paths.
- **`docker/.env`:**
  - Copy it from `docker/env.example` and fill in only `AUTH_SECRET` (`openssl rand -base64 32`) and `EDMATE_ANTHROPIC_API_KEY=<your key>`. Use placeholders only; never write a real-looking key prefix.
  - The file is gitignored, and the secret scan blocks keys at commit.
  - Use a provider tier that doesn't train on inputs. If a key leaks, rotate it at the provider.
- **Bring up the stack:** compose up with the port override; migrate; `corepack pnpm seed`; `storage:roundtrip`.
- **Staff account:** sign in at `http://localhost:8080` as `staff@example.test`, with the link from Mailpit at `http://127.0.0.1:8025`. Then run `db:grant-role` and note the printed id.
- **Teacher:** sign in as `demo-teacher@example.invalid`, then go to Onboarding, edit, and save. Run `db:verify-teacher` with the staff id, then upload `docs/try-it/sample-lesson.md` and wait for Ready.
- **Student:** in a private window, sign in as `student1@example.test`. Choose United States and 1990, start the paid package, and ask the lesson's question to get a streamed reply.
- **Optional:** a no-key dry run with `EDMATE_DEV_MODEL=scripted`; the automated run with `e2e:stack`.
- **Troubleshooting:**
  - 503 on chat: `docker compose logs web` shows `turn.runtime_unavailable reason=…`, with `provider_key` or `EDMATE_MARKET`.
  - Use `localhost`, not `127.0.0.1` (the Origin check).
  - 5 sign-in links per address per hour.
  - Upload stuck in Processing: check `docker compose logs worker`.
  - NoSuchBucket: run `storage:roundtrip`.
- **Teardown:** compose down; remove the key from `docker/.env`.
- **Note:** a brand-new teacher can sign up and fill a profile, but needs the agent builder (8.x) to get an agent (D1).

## Risky paths touched

None (checked against `.claude/skills/merge-gate/risk-paths.txt`). Every planned path is outside the listed globs:
- `docker/**`
- `apps/web/Dockerfile`, `apps/web/src/turn/**`, `apps/web/src/deploy/**`, `apps/web/test/**`, `apps/web/e2e/**`, `apps/web/playwright*.ts`, `apps/web/package.json`
- `apps/worker/src/ingest/**`, `apps/worker/src/index.ts`, `apps/worker/test/**`
- `docs/try-it*`, `docs/tasks/9.0/**`

Not `apps/worker/src/alerts/**`, not `content/**`, not `apps/web/src/auth/**`. If Phase C needs a fix on a risky path (see Exit conditions), the builder names it and its reviewer group (`security-reviewer` for `apps/web/src/auth/**`, `packages/db/src/repositories/**` and `identity/**`) and adds a `risk: high` decision for the handoff. Recommended anyway: `security-reviewer` on Phase A (D2's guard), plus `code-reviewer` and `typescript-reviewer`.

## Open questions

None blocking. D1-D5 are the planner's recommendations; the lead may overrule any of them before the build.

## Budget

Budget: 220 tool calls (3 phases, apps/web + apps/worker + docker)

- Phase A: 60 calls.
- Phase B: 40 calls.
- Phase C: 120 calls. This includes two image builds, the Playwright spec, the guide and up to about 3 small run-found fixes.

## Allowed tools

- **Phases A and B:** Read, Grep, Glob, Edit, Write, Bash. Bash is for pnpm tests, typecheck, lint and build; `docker compose` for Postgres and Redis only, with the port overrides; and the secret scan.
- **Phase C:** the same, plus:
  - Bash for `docker compose -p edmate90 …` (build, up, exec, logs, down);
  - `curl` against localhost only;
  - `corepack pnpm --filter @edmate/web e2e:stack`;
  - `openssl rand`;
  - `playwright install chromium`, only if the browser is missing.

No real model, payment or email provider key, ever. No `.env` file writes. No pushes before a clean secret scan.

## Exit conditions

### Phase A
- **DONE:** all tests above are seen red, then green. `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` passes. `python3 .githooks/secret-scan.py --all` is clean. The state note is added.
- **PARTIAL:** past ~60 calls; or the dev adapter can't satisfy a classifier schema without changing `packages/harness`.

### Phase B
- **DONE:** tests are green, including `ingest.int.test.ts` on real Postgres and Redis, and the `--filter=@edmate/worker...` gates pass.
- **PARTIAL:** past ~40 calls; or `packages/ingest` or `packages/queue` would need a change.

### Phase C
- **DONE:** `e2e:stack` passes on the `edmate90` stack with the dev model, and the reply quotes the uploaded lesson through Caddy. `docs/try-it.md` is written with measured times, and the stack's cold-build total plus the steps fit within 30 minutes on this machine (state the cache state). Every fix has a test. The handoff holds trimmed logs with no secrets, and the stack is down.
- **PARTIAL:** past ~120 calls. Or a fix needs `packages/contracts`, a migration, or more than about 20 lines in a risky path; then stop, describe the bug and the proposed fix, and leave it for the lead. Or the flow is blocked by something only the human can supply.
- **Always:** the handoff states that the real-key chat step is left for the human.

### State after each phase
- **After A:** the image ships every content dir; compose wires the market, chat agents, key passthrough and dev-model flag; `EDMATE_DEV_MODEL=scripted` works on localhost only.
- **After B:** `EDMATE_INGEST_EMBEDDINGS=off` lets uploads reach Ready with no OpenAI key.
- **After C:** a verified run and a guide the human can follow tomorrow.
