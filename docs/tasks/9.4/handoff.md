# 9.4 handoff: student chat, thin slice (Phases A and B)

- **Status:** PARTIAL (Phases A and B done; Phases C–D left, as planned)
- **Branch:** `m9/9.4-student-chat` (Phase A on local `work-9.4a`, Phase B on `work-9.4b`)
- **Worktree:** Phase A `.claude/worktrees/agent-a6a4f425d4b399de3`; Phase B `.claude/worktrees/agent-ab5debadc399c0ca9`

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

## Left to do
- **Phase C:** the components and the `/learn/[agentId]` page, plus the `/home` link (see
  "Notes for Phase C" above). Server facts from Phase A still hold: tokens arrive in bursts after
  the check; a `replace ''` can still come; start a session with `POST /api/sessions {agentId}`
  (201 `{sessionId}`), send turns to `/api/sessions/:id/turns` with
  `{agentId, kind, text?, lang:'en', clientTs}`.
- **Markdown library (Q1):** still open with the human; swap it in behind `renderReply` and keep
  `renderReply.test.tsx` green.
- **Phase D:** Playwright and `e2e/chat.spec.ts`, run locally only.
- **Parked, as in the plan:**
  - KaTeX maths and code highlighting.
  - Teacher answers in the thread (8.9).
  - Skill screens and the check_answer / skill_action inputs (9.5).
  - Resuming the latest session (needs a repo method).
  - Playwright in CI (9.7).
  - Embeddings for retrieval.

## Decisions

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
