# 9.4 handoff: student chat, thin slice (Phases A-D)

- **Status:** DONE (Phases A, B, C and D done, plus the Phase A security fix round)
- **Branch:** `m9/9.4-student-chat` (Phase A on local `work-9.4a`, Phase B on `work-9.4b`, fix round and Phase C on `work-9.4c`, Phase D on `work-9.4d`)
- **Worktree:** Phase A `.claude/worktrees/agent-a6a4f425d4b399de3`; Phase B `.claude/worktrees/agent-ab5debadc399c0ca9`; fix round and Phase C `.claude/worktrees/agent-adf8336e683b6cfaf`; Phase D `.claude/worktrees/agent-ab7d987c76e052f9d`

## Phase A

### What was built
- `POST /api/sessions` (`app/api/sessions/route.ts`) and `POST /api/sessions/:id/turns`
  (`app/api/sessions/[id]/turns/route.ts`), both `withRole(['student'], …)` under the existing
  `ROUTE_POLICY` rows (`clearance: 'agent'`). route-coverage stays green.
- `src/turn/routes.ts`: `createSessionHandlers(backend)`.
  - **Start:** strict body `{ agentId }`. The student comes from the principal and the teacher from
    the live agent's owner. The subscription entitlement must be active, so a paused, ended or
    missing subscription is 403 `no_access`. The session is pinned to the live agent version and
    the entitled package version. Returns 201 `{ sessionId }`.
  - **Turn:** a strict client body: `agentId`, `kind` (`message` | `hint_request`), `text`,
    `lang: 'en'` and `clientTs`. `studentId` and `sessionId` are rejected (400). They are taken
    from the principal and the URL, then checked with `TurnInputSchema`. The session must be the
    student's own, open and for the same agent, otherwise 404. The reply streams as SSE from
    `runTurn`, and the request's abort signal is the turn's cancel.
  - **Errors:** failures are logged by error name only. A missing backend is 503 `provider_error`;
    a thrown error is 500. A failure mid-stream becomes a final `error provider_error retryable`
    event.
- `src/turn/clientInput.ts`: the client schemas and `toTurnInput`.
- `src/turn/scope.ts`: `studentTurnScope`. The scope is built only from the principal and the live
  agent's owner.
- `src/turn/deps.ts`: the per-process ports and `turnDepsFor`, mirroring the CLI's chat deps over
  the real database, queues and metered gateway router.
- `src/turn/runtime.ts`: a lazy, memoised backend. A missing `REDIS_URL` or provider key fails it
  by reason code, logged once, and the routes answer 503. `openRedis` opens two clients.
- `src/turn/fallbackReplies.ts` and `src/turn/index.ts` (the wiring).
- `src/auth/index.ts` (risky): the runtime keeps `repos`, and there is a new `serverDatabase()`
  export (see Decisions).
- `package.json`: the workspace deps `@edmate/harness` and `@edmate/gateway`.
- `test/turn-backend.ts`: a memory backend built from the two-teacher world, the real
  `defaultSteps`, memory ports, the scripted gateway and the repo's real prompt packs.

### Test results
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` gives
  `Tasks: 34 successful, 34 total` and `@edmate/web: Tests 428 passed (428)`.
- Web coverage: All files 98.35% statements, 98.67% branches, 95.83% functions and 98.77% lines.
  `src/turn` is 93.9 / 91.7 / 88.1 / 95.9. `src/auth/**` is at 100% (fully covered, so it is not
  listed in the table), which meets its floor.
- `python3 .githooks/secret-scan.py --all` is clean.
- Clearance evidence (`src/turn/routes.test.ts`): a `parent_needed` student gets 403 on both
  routes, with no session created, no entitlement call, no scope and no model stream. An
  `age_needed` student, a teacher and an anonymous caller are refused too.

### Deviations
- **The retry test.** The harness holds a reply until it has been checked. A failed provider
  stream's "Partial" therefore never reaches the client, and no `replace ''` comes before the
  retry. The test checks that the student sees only the retry's text, after any blank replace,
  and that the turn ends in `done`.
- **The abort test.** For the same reason, the abort fires during the stream (500 ms in), not
  after the first token. It checks that the stream ends in well under 3 s against a 10 s script,
  that no `done` arrives, and that the gateway's iterator is closed early.
- **No `.env.example`.** `apps/web/.env.example` does not exist, so it was not created. The names
  are `REDIS_URL`, `EDMATE_ANTHROPIC_API_KEY`, and optionally `EDMATE_MARKET` and
  `EDMATE_CONTENT_DIR`.

## Phase B

### What was built (all pure, nothing mounted)
- `src/chat/turnState.ts`: `initialTurn()` and `reduceTurn(state, item)` over `StreamItem`
  (`{kind:'event', event}` | `{kind:'ended'}`). Rules 1-8 of the plan: tokens and skill cards stay
  `streaming` (provisional) until `done`; `replace` sets the text and marks `replaced` only if text
  or a skill card was already shown; `replace ''` also clears skills and sources; `error` and
  `ended` without `done` drop text, skills and sources (status `failed`, fixed English text);
  anything after `done` or `error` returns the same state object.
- `src/chat/errorText.ts`: exhaustive switch over the contracts `ErrorCode` enum, fixed English
  text; `guard_blocked` reads as a student message (closes 4.2b's deferred MEDIUM).
- `src/chat/sse.ts`: `readTurnStream(response)`. Streaming `TextDecoder`, LF/CRLF, comments,
  multi-line `data:`; every event is JSON-parsed and checked with `TurnEventSchema`. An invalid
  event is never yielded: one `error provider_error retryable` is yielded and reading stops. A
  half-received event at the end is dropped, then `ended`. A read failure gives `ended`. One event
  over `MAX_EVENT_CHARS` (1,000,000) is refused as an error. A non-2xx gives one `error`: the JSON
  body's code if it is a known code, otherwise from the status (400/401/403/404/429/else); the
  server's `message` is never used.
- `src/chat/sendTurn.ts`: `sendTurn({sessionId, body, onItem, fetch?})` returns
  `{ abort(), done }`; a network failure or abort gives `ended`. `startSession(agentId, fetch?)`
  returns `{ok:true, sessionId}` or `{ok:false, code, retryable}`.
- `src/chat/renderReply.tsx`: no-dependency renderer. Paragraphs (`white-space: pre-wrap`), fenced
  code as `<pre><code>` (an unclosed fence while streaming shows as code), inline `` `code` ``.
  Only React text nodes: no links, no images, no raw HTML; TeX stays literal.
- Tests: `turnState.test.ts` (19), `sse.test.ts` (25, incl. a split at every byte offset of a
  fixture with emoji and Devanagari, one byte at a time), `sendTurn.test.ts` (10),
  `errorText.test.ts` (15), `renderReply.test.tsx` (19: script, img onerror, javascript: link,
  iframe, HTML comment, svg onload, style, markdown image, a tag split across tokens, HTML in a
  fence), `no-raw-html.test.ts` (3: scans `src/chat/**` and `app/learn/**`, and proves the scan
  catches each pattern).

### Test results
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` gives
  `Tasks: 34 successful, 34 total` and `@edmate/web: Tests 515 passed | 4 skipped (519)`.
- Coverage: web All files 98.53 / 98.7 / 96.2 / 99.01; `src/chat` 99.34 / 98.87 / 100 / 100
  (`turnState.ts`, `errorText.ts`, `sendTurn.ts` 100%; `sse.ts` 98.86% statements).
- `python3 .githooks/secret-scan.py --all` is clean.
- No Phase A server code changed; no new dependency; no contracts change.

### Notes for Phase C
- Drive a turn with `useReducer(reduceTurn, undefined, initialTurn)` and pass `dispatch` as
  `onItem`. Show the turn in the finalised thread only when `status === 'final'`; while
  `streaming`, show it provisional (outside the live region); on `failed`, show `error.text` and
  a retry button when `error.retryable`.
- `replaced` drives the "Updated" marker. It is sticky within a turn (a retry after a shown
  `replace ''` stays marked).
- `renderReply(text)` returns block elements (`<p>`, `<pre>`): wrap it in a `<div>`, not a `<p>`.
- `errorText.ts` holds the English strings; Phase C can move them to `messages/en.json` under
  `chat.*` and keep the switch as the key map.
- Abort the handle on unmount; the reducer then drops the turn.

## Fix round (security, Phase A)

Two MEDIUM findings from the security review, tests first (both seen red, then green).
- **Unbounded body** (`src/turn/routes.ts`). `readJson` now refuses a declared `content-length`
  over `MAX_BODY_BYTES` (64 KB) before reading, and reads the body through a stream reader that
  stops (and cancels the stream) as soon as more than 64 KB has arrived, so a missing or false
  `content-length` can't bypass it. Both routes answer 413 `input_too_large` before the backend
  is loaded. A body that fails mid-read is a 400. Tests in `routes.test.ts`
  ("request body cap (64 KB) on both routes", 5 cases: declared too large on both routes, a
  1 MB streamed body with no content-length is cut off after a few chunks, a false small
  content-length, a streamed body under the cap, a read failure).
- **Silent market default** (`src/turn/runtime.ts`). `configuredMarket(env, packs)`: with
  `NODE_ENV=production`, an unset or unknown `EDMATE_MARKET` (no locale pack for it) throws
  `TurnUnavailableError('EDMATE_MARKET')`, so the runtime fails closed, logs only
  `turn.runtime_unavailable reason=EDMATE_MARKET`, and both routes answer 503. Dev and test keep
  the `global` default. Tests in `runtime.test.ts` (unset, blank, unknown, known markets in
  production; unset outside production).

## Phase C

### What was built
- `src/chat/ChatView.tsx` (client): `useReducer(chatTurn, undefined, initialTurn)`, where
  `chatTurn` is `reduceTurn` plus a `reset` action; `sendTurn`'s `onItem` dispatches into it.
  - A streaming turn renders outside the `aria-live="polite"` thread (`.chat-provisional`), with
    `aria-busy="true"` and "Still checking…". On `done` it renders inside the live thread; on the
    next send it becomes an ordinary thread entry.
  - `failed` shows the fixed text in a `role="alert"` box, with "Try again" when retryable. The
    retry resends the last request (new `clientTs`) and does not repeat the student's message.
  - Each turn gets a sequence number. Items for an older turn are dropped, and unmount bumps the
    sequence and aborts the handle.
  - With no session, the first send calls `startSession`, writes `?s=<id>` with
    `history.replaceState` (no server re-render), then sends. A failed start shows its error.
  - The composer and the hint button are disabled while a reply streams.
  - `send`, `start` and `now` are injectable for tests.
- `MessageBubble.tsx`: roles student, agent and teacher ("Your teacher", own style). It has the
  provisional style and label, the "Updated" marker (`title` plus visually hidden "This reply was
  corrected"), agent and teacher text through `renderReply`, and student text as plain text.
- `HintButton.tsx` (rungs 1–2 "Hint", 3 "Worked example", 4 "Full solution", else nothing),
  `SourcesList.tsx` (text only, no links), `LockedNotice.tsx`, `TeacherQuestionNotice.tsx`,
  `SkillCard.tsx` (name and "Coming soon", never the payload), `Composer.tsx` (Enter sends,
  Shift+Enter is a new line, blank is never sent, `maxLength` is the contracts limit), and
  `chat.css`.
- `src/chat/loadChat.ts`: the page's loader. It runs the guard first, so nothing opens the
  database before the guard passes. A malformed or non-live agent gives `notFound()`, and `?s=` is
  used only when it is the student's own open session with this agent. It loads the newest 50
  messages.
- `app/learn/[agentId]/page.tsx`: `requireRole(['student'], { clearance: 'agent' })` →
  `loadChat` → `AppShell` → `NextIntlClientProvider` (only the `chat` messages) → `ChatView`.
- `/home`: `HomeView({ chats })` shows one link per agent id to `/learn/<id>`, or the placeholder
  when there are none. `app/home/page.tsx` gets the ids from `src/chat/liveChats.ts` (see
  Decisions). A database failure there shows the placeholder and logs only the error name.
- `messages/en.json` `chat.*` holds every chat string, including `chat.errors.*`.
  `errorText.ts` now reads its text from there and keeps the exhaustive switch as the key map, so
  the Phase B tests are unchanged and green.
- `test/intl.tsx`: renders under the real `NextIntlClientProvider` with the real `en.json`.

### Tests
- `MessageBubble.test.tsx` (6), `parts.test.tsx` (21: HintButton, SourcesList, LockedNotice,
  TeacherQuestionNotice, SkillCard, Composer), `ChatView.test.tsx` (14: history, provisional
  outside the live region then final inside it, `replace ''` clearing text, skill cards and
  sources in the DOM, replace with text, a cut stream with retry, a non-retryable error, hint,
  locked and teacher question, two turns, session start and URL, failed start, late items,
  abort on unmount). Axe finds no violations in the idle, streaming, final, updated and failed
  states and on the notices.
- `app/learn/[agentId]/page.test.tsx` (6) runs the real `createGuard` with fake deps. A
  `parent_needed` student is redirected to `/welcome/age` with no database opened. A teacher gets
  notFound, anonymous goes to `/sign-in`, and a `clear` student gets the chat with history (axe
  clean). Another student's `?s=` is ignored, and a non-live agent gives notFound.
- `loadChat.test.ts` (13), `liveChats.test.ts` (10), `clearance-scan.test.ts` (2: the scan and
  proof that it catches a bare `requireRole`, a wrong clearance and an unguarded server action),
  and `app/home/view.test.tsx` (+2: link with a live subscription, placeholder without).
- `corepack pnpm turbo run typecheck lint test build --filter=@edmate/web...` →
  `Tasks: 35 successful, 35 total`; `@edmate/web: Tests 596 passed (596)`; web coverage All files
  98.32 / 98.43 / 95.94 / 99.08, `src/chat` 99.46 / 99.12 / 100 / 100. (The coverage `include` is
  `src/**/*.ts`, so the `.tsx` components are tested but not counted; unchanged from 9.1.)
- `python3 .githooks/secret-scan.py --all` is clean.
- There is no new dependency, no `packages/contracts` change and no `src/auth/**` edit.

### Deviations
- `HintButton`, `SourcesList` and `LockedNotice` share one test file, `parts.test.tsx`, instead of
  three.
- `ChatView` records the new session with `window.history.replaceState`, not
  `router.replace`. That avoids a server re-render mid-turn, and Next's app router supports it.

## Phase D

### What was built
- `apps/web/e2e/global-setup.ts`: migrates and seeds `TEST_DATABASE_URL` once, by spawning the
  built `@edmate/db` CLI (`dist/bin/migrate.js`/`seed.js`) as a child process — apps never import
  `@edmate/db/internal`, so this runs it the same way a human would. Idempotent.
- `apps/web/e2e/fixtures.ts`: `signInAsStudent`/`signInAsParentNeeded` set a real database-backed
  session cookie (`identity.createSession`, the `build-smoke.test.ts` pattern — no OAuth, no test
  hook in production code). `sseBody(events)` builds SSE fixture bytes from `TurnEvent[]`, each one
  checked against `TurnEventSchema` by `formatSseEvent` as it is built, so a bad fixture fails
  loudly. `mockTurns(page, bodies)` routes `**/api/sessions/*/turns` to the next fixture in order
  (`page.route`); the real route is never reached, so no real model call.
- `apps/web/e2e/chat.spec.ts`: the plan's ten cases (normal, retry-after-replace,
  replace-with-text, error-mid-stream, cut-stream, locked, teacher-question, hint-rung,
  html-in-tokens, parent-needed), each against a real `next dev` and a real Postgres;
  `POST /api/sessions` is the real route, the turns route is always the `page.route` fixture.
- `apps/web/playwright.config.ts`: Chromium only, serial (`workers: 1`), `globalSetup`, a
  `webServer` that starts `next dev` on a fixed port with a throwaway `AUTH_SECRET` and a
  deliberately unreachable `REDIS_URL` (session start never touches queues or turn limits; only a
  real turn does, and the turn route is always intercepted here).
- `apps/web/package.json`: `@playwright/test` (devDependency) and the `e2e` script
  (`playwright test`).

### Test results
- `corepack pnpm --filter @edmate/web e2e` (local, against
  `docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres
  redis`): `10 passed`.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...`:
  `Tasks: 34 successful, 34 total`; web coverage unchanged from Phase C (98.32 / 98.43 / 95.94 /
  99.08 — `e2e/**` is not part of the vitest coverage run).
- `python3 .githooks/secret-scan.py --all` is clean.
- Not wired into CI (9.7 adds that job); `.github/workflows/**` untouched.

### Deviations
- **`next dev` runs without `--webpack`.** `next build` keeps `--webpack` (`next.config.ts`,
  task 1.7b), but `@edmate/gateway`'s `loadBundledPrices()` reads its bundled `prices.yaml` with
  `readFileSync(new URL('./prices.yaml', import.meta.url), 'utf8')`; under `next dev --webpack`'s
  bundling of the session route, `import.meta.url` is rewritten into something `readFileSync`
  rejects (`TypeError: ... Received an instance of URL`), so `POST /api/sessions` always 503s on
  the very first call. The default `next dev` (Turbopack) does not hit this — `playwright.config.ts`
  uses it. This is a latent bug in `@edmate/gateway`, out of this task's file scope
  (`apps/web/e2e/**`, `playwright.config.ts`, `package.json`); it only surfaces when a real
  `next build --webpack` or `next dev --webpack` server actually calls `loadBundledPrices()`
  (nothing did, before 9.4). Flagged in `.claude/blockers.md` and below; not fixed here.
- **`getByRole('alert')` needs scoping.** Next.js's own route announcer
  (`#__next-route-announcer__`) is also `role="alert"` and always present (empty), so
  `error-mid-stream` and `cut-stream` assert on `.chat-error` instead of the role alone.

## Left to do
none

## Follow-ups (not Phase D's job)
- **`@edmate/gateway`'s `loadBundledPrices()` 503s `next build --webpack`/`next dev --webpack`**
  (see Deviations above). This affects production, not just e2e — worth a board task to swap the
  `new URL(..., import.meta.url)` read for the `fileURLToPath` + `path.join` pattern
  `safeRegexGuard.ts` already uses (task 1.7b), so both bundlers can read it.
- **A repo method that lists a student's live subscriptions** (`packages/db/src/repositories/**`,
  risky). With it, `/home` can drop `EDMATE_CHAT_AGENTS`. Board follow-up.
- **Markdown library (Q1):** still open with the human; swap it in behind `renderReply` and keep
  `renderReply.test.tsx` green.
- **Parked, as in the plan:**
  - KaTeX maths and code highlighting.
  - Teacher answers in the thread (8.9).
  - Skill screens and the check_answer / skill_action inputs (9.5).
  - Resuming the latest session (needs a repo method).
  - Playwright in CI (9.7).
  - Embeddings for retrieval.

## Decisions

### 20 Oct 2026 · Phase D e2e: Turbopack dev server, `.chat-error` over bare `role=alert` · decided by tdd-guide
Decided: `playwright.config.ts`'s `webServer` runs plain `next dev` (Turbopack), not
`next dev --webpack`, and `chat.spec.ts` asserts the chat error banner by `.chat-error`, not
`getByRole('alert')` alone.
Why: `next dev --webpack` makes `@edmate/gateway`'s `loadBundledPrices()` throw (`import.meta.url`
rewritten in a way `readFileSync` rejects), 503-ing every `POST /api/sessions`; Turbopack does not
hit this. Separately, Next's own `#__next-route-announcer__` is also `role="alert"` and always
present, so two tests needed a more specific locator. Neither is a fix to the underlying
`@edmate/gateway` bug (out of this task's file scope) — see handoff "Follow-ups".
risk: medium (a real, if latent, production bug under `--webpack`; flagged, not fixed, here).

### 20 Oct 2026 · `apps/web/src/auth/**` touched: `serverDatabase()` export · decided by tdd-guide · risk: high
Decided: `src/auth/index.ts`'s runtime now keeps the `repos` that `openDatabase` already returned.
A new export, `serverDatabase()`, returns `{ repos, identity }` from the same memoised runtime.
Why: the turn routes need the repositories and the same age-policy identity (`learnerStatus`) the
guard uses, without opening a second database pool. No guard, age-gate, cookie or session setting
changed. A new test checks that the instances are shared and that only one database is opened.
The `src/auth/**` coverage floor holds at 100%.
risk: high. Needs security-reviewer; the lead finalises.

### 20 Oct 2026 · Turns run in one configured market (`EDMATE_MARKET`, default `global`) · decided by tdd-guide
Decided: the entitlement's market comes from `EDMATE_MARKET`, falling back to `global`.
Why: the identity store has no API that reads a student's market. Follow-up: expose the
student's market and use it per turn.
risk: medium.

### 20 Oct 2026 · The web copies the CLI's fallback replies · decided by tdd-guide
Decided: `src/turn/fallbackReplies.ts` holds English copies of the CLI's safe and distress replies.
Why: this follows the plan. Follow-up: move them into `@edmate/content`.
risk: medium.

### 20 Oct 2026 · Full-text retrieval for the slice · decided by tdd-guide
Decided: `retrievalIndexFor(repos, {})` is used with no embedder, the same as the CLI default.
risk: medium.

### 20 Oct 2026 · Small route choices · decided by tdd-guide
Decided:
- A paused subscription gets 403 `no_access` at session start.
- Start answers 201.
- A hint request may omit `text`.
- Redis uses two clients: the queues get no retry cap (BullMQ needs that), and the limits fail
  fast with one retry.
- `TurnUnavailableError` carries a fixed `reason` code, which is the only part logged.
- The route-test backend uses the repo's real `content/prompt-packs`, because the world's agents
  pin set 1.0.0.

risk: low.

### 20 Oct 2026 · Phase B client choices · decided by tdd-guide
Decided:
- An invalid SSE event (bad JSON or failing `TurnEventSchema`) ends the turn as a retryable
  `provider_error` and the reader stops; nothing after it is read.
- A non-2xx without a known JSON code maps by status: 400 `validation`, 401 `unauthorized`,
  403 `forbidden`, 404 `not_found`, 429 `rate_limited` (retryable), else `provider_error`
  (retryable).
- One SSE event is capped at 1,000,000 characters; bigger ends the turn as an error.
- A network failure or an abort of `sendTurn` yields `ended`, which drops the turn.
- `replaced` is sticky within a turn, and an `error` resets it (the turn is dropped).
- The renderer supports paragraphs, fenced and inline code only; no links or images, TeX literal.
- The error strings live in `src/chat/errorText.ts` for now (Phase C may move them to en.json).

risk: low.

### 20 Oct 2026 · Fix round: turn request bodies capped at 64 KB · decided by tdd-guide
Decided: both turn routes refuse a body over 64 KB with 413 `input_too_large`. A declared
content-length over the cap is refused before reading, and the bytes read are capped as well.
Why: this fixes the security review's MEDIUM finding. 64 KB is far above the contracts' turn text
limit and a strict JSON body.
risk: medium.

### 20 Oct 2026 · Fix round: in production the turn market fails closed · decided by tdd-guide
Decided: with `NODE_ENV=production`, an unset `EDMATE_MARKET`, or one that has no locale pack,
makes the turn runtime unavailable. The routes answer 503, and the log says only
`reason=EDMATE_MARKET`. Dev and test keep the `global` default.
Why: the market picks the locale pack, so the distress helplines. A silent `global` in production
could show the wrong helplines. This supersedes the production half of the earlier
`EDMATE_MARKET` decision. A per-student market is still a follow-up.
risk: medium.

### 20 Oct 2026 · /home chat links come from configured candidate agents · decided by tdd-guide
Decided: `/home` checks the agents named in `EDMATE_CHAT_AGENTS` (a comma list). Outside
production the seeded `demo-agent` is checked when the variable is unset; in production, none
is. Each candidate gets a link only if the agent is live and `subscriptions.findLive` with its
teacher returns a status other than paused or ended.
Why: no repository method lists a student's subscriptions, and adding one is a risky
`packages/db` change outside this phase. Follow-up: add that method and drop the variable.
Open for the lead (plan Q2): is this good enough for the pilot, or should 9.3 come in?
risk: medium.

### 20 Oct 2026 · Phase C client choices · decided by tdd-guide
Decided:
- The chat strings, including the error texts, are in `messages/en.json` under `chat.*`.
  `errorText.ts` reads them through its exhaustive switch.
- The page gives `NextIntlClientProvider` only the `chat` messages, with locale `en` (English-only
  pilot).
- A new session is written to the URL with `history.replaceState`, not `router.replace`.
- A retry resends the last request with a new `clientTs`. The student's message is not repeated.
- The hint button shows the rung of the current turn only. A hint request shows "Can I have a
  hint?" as the student's message.
- The `safety` event has no UI in this slice.
- The page loads the newest 50 history messages.

risk: low.

## Fix round (bundled prices)

Status: DONE.

Bug: `loadBundledPrices()` (`packages/gateway/src/pricing/load.ts`) did
`readFileSync(new URL('./prices.yaml', import.meta.url))`. Under `next build --webpack`
(`apps/web`'s own `build` script) the module is bundled into a server chunk and `prices.yaml`
never ships as a sibling file, so the read throws and every `POST /api/sessions` answers 503.
Phase D's Playwright config already names this and runs Turbopack to dodge it
(`apps/web/playwright.config.ts`); it is a different failure from, but the same root cause as,
1.7b's safe-regex worker bug (`docs/decisions/log.md`).

Fix: `prices.yaml` stays the source of truth, but `loadBundledPrices` no longer reads a file at
runtime. `packages/gateway/scripts/generate-prices.mjs` embeds its raw text as a template literal
in a checked-in, statically imported TS module, `packages/gateway/src/pricing/prices.generated.ts`
(`PRICES_YAML`); `load.ts` calls `parsePriceTable(PRICES_YAML)`. `parsePriceTable`'s validation is
unchanged. `test/pricing/generated.test.ts` reads `prices.yaml` and asserts it is byte-identical to
`PRICES_YAML`, so an edit to `prices.yaml` without regenerating fails CI. The `build` script no
longer copies `prices.yaml` into `dist/` (nothing reads it there anymore); a new
`generate:prices` script runs the generator.

Verification:
- `corepack pnpm --filter @edmate/gateway build && corepack pnpm --filter @edmate/web exec next build --webpack` succeeds (one pre-existing, unrelated warning: `@valkey/valkey-glide` optional dep for `bullmq`/`@edmate/queue`).
- `grep -rl "Model prices in plain USD" apps/web/.next/server` finds the embedded YAML text baked into the bundled server chunk — proof the price table is now a static value, not a runtime file read.
- `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm --filter @edmate/web build-smoke` passes against the relocated standalone build (same shape as `apps/web/Dockerfile`), proving the webpack-bundled server starts and serves real requests.
- `node -e "import('./packages/gateway/dist/index.js').then(m => console.log(m.loadBundledPrices().models()))"` prints `['claude-haiku-4-5','claude-sonnet-4-5']` from the compiled `dist` output.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/gateway... --filter=@edmate/web...` — 34/34 tasks pass; `src/pricing` is at 100% coverage.
- `python3 .githooks/secret-scan.py --all` — clean.

Follow-up for apps/web (not done here, out of file scope): `apps/web/playwright.config.ts`'s
`webServer.command` can drop its `next dev` (Turbopack) workaround comment and run
`next dev --webpack` once this fix lands, matching production more closely; not changed in this
round since another builder owns `apps/web`.

### Decisions

- **20 Oct 2026 · Bundled prices.yaml shipped as a generated TS module, not read from disk at runtime · decided by build-error-resolver**
  Decided: `loadBundledPrices()` parses `PRICES_YAML`, a string constant in the checked-in,
  generated `packages/gateway/src/pricing/prices.generated.ts`, instead of
  `readFileSync(new URL('./prices.yaml', import.meta.url))`. `prices.yaml` remains the source a
  human edits; `node scripts/generate-prices.mjs` regenerates the TS module, and
  `test/pricing/generated.test.ts` fails if the two drift apart. The gateway's `build` script no
  longer copies `prices.yaml` into `dist/`.
  Why: webpack bundles `@edmate/gateway` into `apps/web`'s own server chunk when it builds with
  `--webpack` (the app's own `build` script), and `prices.yaml` never ships as a sibling file next
  to the bundled module, so the old runtime read threw and every `POST /api/sessions` answered 503
  in production — the same class of bug as 1.7b's safe-regex worker, but for a different file and
  package. A statically imported TS module needs no file lookup at runtime, so it is bundler-safe
  under webpack, Turbopack, and plain Node alike.
  risk: medium (fixes a production-blocking 503 on every chat session; no contracts or
  prompt-pack change).
