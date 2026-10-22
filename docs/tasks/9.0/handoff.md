# 9.0 handoff: thin-slice end-to-end run and try-it guide (Phase C)

- **Status:** DONE
- **Branch:** `m9/9.0-try-it` (built on local `work-90c`)
- **Worktree:** `.claude/worktrees/agent-a926ddfdf88dd41f8`
- **Tool calls used:** 99 (harness count; budget: 120 for Phase C)
- Phases A and B are in `docs/tasks/9.0a/handoff.md` and `docs/tasks/9.0b/handoff.md`.
- **The real-key chat was not run by the builder.** No real model key was used at any point. The
  human runs that step by following `docs/try-it.md` with their own key in `docker/.env`.

## What changed

- `apps/web/src/turn/devModel.ts` (run-found fix, with tests). The post-guard judges (grounding
  4.7 and advice 4.8) ask for their strict JSON verdict as streamed text, not through
  `generateObject`.
  - Before: the dev model answered them with its tutor text. Grounding read that as "not grounded"
    and replaced every reply with the ask-teacher text, plus a teacher question.
  - Now: the stream answers those two exact rubrics (`GROUNDING_JUDGE_SYSTEM`,
    `ADVICE_JUDGE_SYSTEM`, imported from `@edmate/harness`) with the all-clear verdict, the same as
    the classifiers. Any other system prompt still gets the tutor reply.
- Tests for that fix:
  - `apps/web/src/turn/devModel.test.ts`: 3 new cases (grounding verdict, advice verdict, a
    near-miss rubric still gets the tutor reply).
  - `apps/web/src/turn/routes.test.ts`: the real `defaultSteps` dev-model turn now also asserts
    that there is no `replace` and no `teacher_question` event. The old test checked only the
    pre-replace tokens, which is why Phase A missed this.
- `apps/web/playwright.stack.config.ts` (new). It reads `testDir: ./e2e/stack`, with no
  webServer and no globalSetup. `baseURL` comes from `EDMATE_STACK_URL` and is refused unless the
  host is local.
- `apps/web/e2e/stack/try-it.spec.ts` (new): the whole flow in one test, with 5 screenshots.
  - Staff sign-in happens only when `grant-role` doesn't yet know the address, so reruns save sign-in links.
  - Teacher: edit the profile, verify through the CLI, check the "verified" banner.
  - Upload `sample-lesson.md` and wait for one more Ready row.
  - A fresh student: age gate (US, 1990), the Full course package, then a chat question.
  - Dev mode asserts `[dev model]` and the lesson's fact. `EDMATE_STACK_EXPECT=real` asserts only
    a final reply with no error.
- `apps/web/e2e/stack/mail.ts` (new): the local-URL check, the Mailpit sign-in link reader, and
  the built `@edmate/db` CLI runner. The runner needs `EDMATE_STACK_DATABASE_URL` on a local host.
  Links and tokens are never printed.
- `apps/web/playwright.config.ts`: `testIgnore: ['stack/**']`, so `pnpm e2e` is unchanged.
- `apps/web/package.json`: the `e2e:stack` script.
- `.gitignore`: `test-results/` and `playwright-report/` (Playwright output and screenshots).
- `docs/try-it.md` (new): the guide, with measured times.
- `docs/try-it/sample-lesson.md` (new): a fictional lesson with one made-up fact (the "tamarind
  counter rule") and the question to ask.
- `docker/Caddyfile`: no change. W7 showed no buffering (see Evidence).

## Evidence

All runs used compose project `edmate90` with its own ports:

- `EDMATE_HTTP_PORT=18080`, `AUTH_URL=http://localhost:18080`
- `EDMATE_S3_PORT=19000`, `EDMATE_S3_CONSOLE_PORT=19001`
- `EDMATE_MAIL_UI_PORT=18025`, `EDMATE_PG_TEST_PORT=55442`
- `EDMATE_DEV_MODEL=scripted`, and `AUTH_SECRET` from `openssl rand -base64 32` in the shell only

The other session's `edmate-*` containers were never touched; 4 of them were still running at
the end.

### Timed bring-up (final clean run: `down -v`, `docker/data` deleted)

```
[timed] rc=0 secs=168 :: dc up -d --build          (first build in this worktree; Docker layer cache warm from other sessions)
[timed] rc=0 secs=76  :: dc up -d --build          (clean data, images cached)
[timed] rc=0 secs=1   :: corepack pnpm --filter @edmate/db db:migrate     -> db:migrate: migrations applied
[timed] rc=0 secs=7   :: corepack pnpm seed  -> seed: inserted 55 rows; users=21 teacherProfiles=1 courses=1 modules=5 ... packages=2 subscriptions=20
[timed] rc=0 secs=1   :: dc exec -T worker npm run storage:roundtrip
  [storage:roundtrip] ok: 50 bytes to http://minio:9000 edmate-dev/roundtrip/<uuid>.txt (bucket created; object deleted)
GET /api/health 200
[timed] rc=0 secs=54..65 :: dc up -d --build web   (web-only rebuild after the devModel fix)
```

On cache state: Docker's layer cache was already warm, from other sessions' builds of the same
Dockerfiles. A truly cold build was not measured, and the guide says so. Even if a cold build took
10 minutes, the total stays under 30 (3 min bring-up, under 1 min of CLI steps and about 10 min
of clicking).

### `e2e:stack` (list reporter), on the clean stack

```
--- e2e:stack
  ✓  1 [chromium] › e2e/stack/try-it.spec.ts:23:1 › try it: teacher uploads a lesson, a student chats about it (11.8s)
  1 passed (13.3s)
--- rerun (spec is rerunnable)
  ✓  1 [chromium] › e2e/stack/try-it.spec.ts:23:1 › try it: teacher uploads a lesson, a student chats about it (8.4s)
  1 passed (8.7s)
```

The reply goes through Caddy and quotes the uploaded lesson: the thread contains `[dev model]`
and "starts at 7 and goes up by 3".

### The pnpm CLI form used in the guide (run against the same stack)

```
db:grant-role: user <uuid> is now staff
db:verify-teacher: teacher demo-teacher is now verified
db:grant-role: no user has that email (they must sign in once first)
```

### W7 (does Caddy gzip buffer SSE?): no

A Node fetch through Caddy on `:18080`, with a DB session cookie for seeded `demo-student-06` and
`accept-encoding: gzip`:

```
turns 200 text/event-stream; charset=utf-8 enc= null
+129ms "event: token\ndata: {\"type\":\"token\",\"text\":\"[dev model] From your \"}..."
+131ms "event: token ... short, made-up lesson ..."
+132ms ... +138ms   (one chunk per token event)
+143ms "event: replace ..."   <- the bug fixed above, seen before the fix
+151ms "event: teacher_question ... event: done ..."
```

- Caddy didn't compress `text/event-stream` (no `content-encoding`).
- Events arrived as separate chunks, not as one buffer at the end.
- No Caddyfile change was needed.
- The same output showed the run-found bug: grounding replaced the quoted reply.

### Red, then green, for the run-found fix

- Before: `vitest run src/turn/devModel.test.ts src/turn/routes.test.ts` gave `Tests 3 failed | 47 passed (50)`.
  - × answers the grounding judge with the strict grounded verdict
  - × answers the advice judge with the strict no-personal-advice verdict
  - × the dev model (9.0) runs a real defaultSteps turn to done, quoting the material
- After: `Tests 50 passed (50)`.

### Gates

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web... --concurrency=2`: `Tasks: 34 successful, 34 total`
- `python3 .githooks/secret-scan.py --all`: clean, no output.
- Stack: `docker compose -p edmate90 ... down -v` was run and `docker/data` deleted in this
  worktree. No `edmate90` containers are left.

## Finding for the lead (not fixed; out of scope)

Logs: `web-1 | [turn] turn.background_failed task=runner error=Error turnId=...`.

- It appears on the first turn after the web container starts, and only that turn. The rerun's
  turn didn't log it.
- To find the message, a temporary local patch (reverted, never committed) logged it:
  `preGuard: earlier student messages unavailable (timeout)` (`packages/harness/src/pipeline/steps/preGuard.ts:57`).
  The history read for the distress classifier times out, most likely on a cold DB pool.
- It is best effort by design: the classifier still sees the message and the reply isn't
  affected.
- It is still worth a board item: either warm the pool, or check `HISTORY_TIMEOUT_MS` against a
  cold production store. With real classifiers, the first turn loses its distress context.

## Deviations

- The builder ran the guide's flow with the port overrides above, not the default ports, because
  another session's stack holds 8080 and 8025. The guide uses the defaults.
- `docker/.env` was not written: hooks block `.env` files. The builder exported the same
  variables in its shell, which compose reads the same way.
- These guide steps were not run by hand:
  - the real-key chat (left to the human);
  - "Sign out" between accounts (the spec used separate browser contexts);
  - `playwright install chromium` (the browser was already there);
  - the dev-model restart, `up -d web` (the stack started with the flag set).
- No screenshots were committed. The spec saves 5 under the gitignored `apps/web/test-results/`.
- Images are tagged `edmate-web:dev` and `edmate-worker:dev` by `compose.yaml`, which other
  projects share. Building here moved those tags. The other session's running containers keep
  their image, but its next `up` without `--build` would use this build.

## Decisions

### 22 Oct 2026 · 9.0 Demo teacher, not a fresh one, in the try-it flow · decided by builder · risk: low
- Decided: the plan's D1. The guide and the spec use the seeded `demo-teacher@example.invalid`, which has the only live agent and packages. The guide says in one line that a brand-new teacher can't get an agent until the agent builder (8.x) ships.
- Why: a fresh teacher has no agent, so no student could chat with them.
- risk: low

### 22 Oct 2026 · 9.0 The dev model answers the post-guard judges "all clear" · decided by builder · risk: medium
- Decided: under the plan's D2, the dev model's stream answers the grounding judge's and advice judge's exact fixed rubrics with `{"grounded": true}` and `{"personalAdvice": false}`. It matches on exact string equality with the constants exported from `@edmate/harness`. Every other prompt still gets the tutor reply.
- Why: without this, grounding replaced every dev-model reply with the ask-teacher text and raised a teacher question, so the stack run could never show a quoted reply. The classifiers already got all-clear verdicts under D2, and this extends the same thing to the two judges that use text calls. Nothing changes when the flag is off. The guard is still local-only and exact-value.
- risk: medium. It widens what the dev model stands in for (two more guards). A `security-reviewer` read of `devModel.ts` is recommended, as for Phase A.

### 22 Oct 2026 · 9.0 The stack spec runs only on demand · decided by builder · risk: low
- Decided: the plan's D5. `e2e:stack` has its own Playwright config. It is local only (it refuses non-local URLs and DB hosts) and is not in CI. `pnpm e2e` ignores `e2e/stack/**`.
- Why: it needs a running, seeded compose stack.
- risk: low

### 22 Oct 2026 · 9.0 Compose defaults and ingest without embeddings, as used by the run · decided by builder · risk: low
- Decided: the plan's D3 and D4 (built in 9.0a and 9.0b) were used as built, with no change. The guide asks the human for only `AUTH_SECRET` and the Anthropic key, and relies on the defaults: market `US`, `demo-agent`, embeddings `off`.
- Why: the run showed they're enough. The upload reached Ready with no OpenAI key, and chat retrieval found it by full text.
- risk: low

### 22 Oct 2026 · 9.0 The stack spec signs staff in only when needed · decided by builder · risk: low
- Decided: the spec runs `grant-role` first and signs the staff address in only if the CLI fails ("no user has that email"). Each run signs in a fresh `student-<ms>@example.test`.
- Why: each address gets 5 sign-in links an hour. A rerun hit that limit on the staff address during the build.
- risk: low

### 22 Oct 2026 · 9.0 Playwright output is gitignored · decided by builder · risk: low
- Decided: `.gitignore` adds `test-results/` and `playwright-report/`.
- Why: the plan wants screenshots in a gitignored output dir, and that dir wasn't ignored. Screenshots of a run could otherwise be committed by accident.
- risk: low
