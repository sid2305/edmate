# Plan: 9.4 Student chat (thin slice)

Task: 9.4, "Chat: SSE, markdown, maths and code, sources, hint button with rung, locked notice, teacher answers in the thread".
Deps: GATE, 1.3, 1.7, 9.1. The thin slice (8.1, 8.2, 9.1, 9.4) starts before GATE (decision log, 20 Oct 2026, B-28).
Builds on 9.1 (PR #82, `m9/9.1-app-shell`): AppShell, next-intl, `/sign-in`, `currentPrincipal()`, `/home`. **Start the build after 9.1 merges.**
Branch: `m9/9.4-student-chat`. English only.

## Acceptance (verbatim, from `docs/board/tasks.yaml`)

> component tests + e2e.; on replace '' the client clears shown text, skill events and sources, and drops text from a turn that never got done (3.7 and 4.5 reviews); streamed text is shown as provisional until done, and a replacement is visibly marked (4.7 safety review); the chat never renders raw model HTML (4.6b safety review)

How each part is shown:

| Accept clause | Shown by |
|---|---|
| component tests | Phase B reducer, SSE parser and renderer unit tests; Phase C RTL + axe tests for every chat component (the 9.1 jsdom harness) |
| e2e | Phase D Playwright spec `apps/web/e2e/chat.spec.ts` against `next dev` + Postgres; the server path with the scripted gateway is in the Phase A route tests |
| `replace ''` clears shown text, skill events and sources | `turnState.test.ts` "replace-empty clears text, skills and sources"; `ChatView.test.tsx` checks the DOM; e2e case `retry-after-replace` |
| drops text from a turn that never got done | `turnState.test.ts` "stream end without done drops the turn" and "error drops the turn"; `sse.test.ts` "truncated stream ends with `ended` and no done"; e2e case `cut-stream` |
| streamed text is provisional until done | `turnState.test.ts` (status `streaming` until `done`); `MessageBubble.test.tsx` (provisional style, `aria-busy="true"`, "Still checking" label, not inside the `aria-live` region); e2e checks the label goes away after done |
| a replacement is visibly marked | `turnState.test.ts` "replace after shown text sets replaced"; `MessageBubble.test.tsx` shows the "Updated" marker; e2e case `replace-with-text` |
| never renders raw model HTML | `renderReply.test.tsx` feeds `<script>`, `<img src=x onerror=...>`, `<a href="javascript:...">`, `<iframe>`, an HTML comment and a split tag across tokens, and asserts no such elements exist and the text shows literally; `no-raw-html.test.ts` scans `apps/web/src/chat/**` and `apps/web/app/learn/**` for `dangerouslySetInnerHTML`, `innerHTML` and `rehype-raw`; e2e case `html-in-tokens` |

Lead requirement (9.1 security review), also acceptance for this task:

> The chat must require `{ clearance: 'agent' }` (consent done) on its page, its server actions and its SSE route; put it in the plan with a test.

| Surface | How | Test |
|---|---|---|
| `POST /api/sessions` and `POST /api/sessions/:id/turns` | `withRole` reads ROUTE_POLICY, whose rows already say `access: ['student'], clearance: 'agent'` (no policy edit) | `routes.test.ts`: a `parent_needed` student gets 403 `forbidden` on both, no session row is made and the gateway script is never called; a `clear` student passes. `route-coverage.test.ts` (existing) proves both routes are wrapped and match the policy rows |
| `/learn/[agentId]` page | `requireRole(['student'], { clearance: 'agent' })` | `page.test.tsx`: a `parent_needed` student is redirected to the age gate path, a teacher is refused, a `clear` student renders |
| Server actions | None are planned: every write goes through the two routes. If the builder adds one, it calls `requireRole(['student'], { clearance: 'agent' })` first | `clearance-scan.test.ts`: every file under `apps/web/app/learn/**` and `apps/web/src/chat/**` that has `'use server'` or calls `requireRole` must pass `clearance: 'agent'`; fails on a bare `requireRole(['student'])` |

## Scope

In:
- The server side: a web composition root for `runTurn`, `POST /api/sessions` (start a session) and `POST /api/sessions/:id/turns` (SSE).
- The client side: a turn-state reducer, an SSE reader, a safe reply renderer, and the chat page with the thread, composer, hint button with rung label, sources, locked notice, the "sent to your teacher" notice, a minimal skill card, and teacher messages from history labelled "Your teacher".
- A link from `/home` to the chat for the student's live subscription (see Q2).
- Playwright set up in `apps/web` with one chat spec.

Parked (say so in the handoff):
- **Maths rendering**: TeX shows as plain text or inline code. KaTeX later (Q1). Board follow-up.
- **Code highlighting**: fenced blocks render as `<pre><code>` with no highlighting.
- **Teacher answers reaching the thread**: 8.9 writes them. 9.4 only renders `role: 'teacher'` messages that are already in history.
- **Skill screens**: 9.5. 9.4 shows a minimal card (skill name and a "coming soon" line), never the payload as HTML.
- **check_answer and skill_action inputs**: 9.5. The web client schema accepts only `message` and `hint_request`.
- **Resuming the latest session** without `?s=`: needs a new sessions repo method (`packages/db/src/repositories/**`, risky). Parked to a board follow-up.
- **Playwright in CI**: 9.7 ("green in CI with scripted gateway"). That keeps `.github/**` out of this task.
- **Package start and teacher choice**: 9.2 and 9.3.
- **Embeddings for retrieval**: the web uses full-text retrieval (no embedder), same as the CLI default.

## Design

### How the web reaches the runner (Phase A)

New composition root `apps/web/src/turn/`, mirroring `apps/cli/src/commands/chat/deps.ts` and `gateway.ts`:

- `runtime.ts`, `turnRuntime()`: process-wide, lazy, memoised. It holds:
  - `repos` and `identity` from `serverDatabase()` (below);
  - the locale packs (`loadLocalePacks`, `pickLocalePack` from `@edmate/content`) and the prompt pack library (`readPromptPackLibrary`);
  - the Redis connection (`REDIS_URL`, ioredis), `createTurnQueues(connection)` and `redisTurnLimits`;
  - the gateway factories (`createChatGateway`-style: `loadProviderKeys` + `envKeySource`, Anthropic key required at first turn, not at import).
- `deps.ts`, `turnDepsFor(runtime, { studentId, teacherId, market })` returns `PipelineDeps`:
  - `entitlements`: `entitlementStoreFor(repos, { market, packMarket, learnerClear: id => identity.learnerStatus(id) === 'clear' })`. This is the second line behind the route's clearance check.
  - `entitlementSource`: `'subscription'`.
  - `turnConfig`: `turnConfigStoreFor(repos, { locales })`.
  - `retrieval`: `retrievalIndexFor(repos, {})` (full text). `teacherQuestions`: `teacherQuestionStoreFor(repos, scope)`.
  - `queuedTurnPorts(queues, scope, transcriptStoreFor(repos, scope), profileStoreFor(repos, scope), alertOptions)` gives usage, transcripts, sessionState, traces, alerts, safetyEvents and profiles.
  - `limits`: `redisTurnLimits`. `gatewayFor`: `meterRouter(createRouter(spec.policy, factories), sink, spec.billing, prices)`, `metered: true`.
  - `fallbackReplies`: English copies of the CLI's `SAFE_REPLY` and distress reply (helplines from the locale pack). Decision: duplicated for now, follow-up to move them to `@edmate/content`.
  - `clock`, `ids`, `log` (a scrubbed server log; never logs message text).
- `scope.ts`, `studentTurnScope(repos, principal, agentId)`: `agents.owner({ agentId })` gives `teacherId` (null means 404 `not_found`). The scope is `studentScope({ studentId: principal.userId, teacherId })`. **The student id always comes from the session principal.**

Database handle: `apps/web/src/auth/index.ts` gets one small export, `serverDatabase()`, returning `{ repos, identity }` from the runtime `getRuntime()` already opens (today it keeps only `identity` and drops `repos`). This reuses the identity built with the market's age policy, rather than a second identity with the default policy that would weaken `learnerClear`. **Risky path** (security-reviewer). `index.test.ts` gets a case that `serverDatabase()` returns the same identity instance `withRole` uses.

### Routes (Phase A)

Both are built by `createSessionRoutes(guardDeps, runtimeFactory)` in `apps/web/src/turn/routes.ts`, so tests inject fake guard deps, memory ports (`@edmate/harness/testing`) and the scripted gateway. The `route.ts` files only export `POST = withRole(['student'], handler)`.

`POST /api/sessions` (`apps/web/app/api/sessions/route.ts`):
- Body: strict `{ agentId }`.
- Steps: owner, then entitlement resolve (no entitlement means 403 `no_access`), then `agents` live version, then `sessions.create(scope, { agentId, agentVersion, packageId, packageVersion })`.
- Returns `{ sessionId }`. Errors use the build plan shape `{ error: { code, message, retryable } }` with fixed messages.

`POST /api/sessions/:id/turns` (`apps/web/app/api/sessions/[id]/turns/route.ts`):
- Client body: `ClientTurnSchema` (`apps/web/src/turn/clientInput.ts`), strict: `{ agentId, kind: 'message' | 'hint_request', text, lang: 'en', clientTs }`. A body with `studentId` or `sessionId` fails strict parsing (400 `validation`); it is never merged.
- The server merges `studentId` from the principal and `sessionId` from the path, then parses with the contracts' `TurnInputSchema`.
- Before streaming: `sessions.get(scope, id)`. Missing, another student's, another agent's, or ended means 404 `not_found` as JSON, not SSE.
- Then `runTurn(input, { deps, steps: defaultSteps, cancel })`, where `cancel` follows `request.signal`. The response body is a `ReadableStream` of `formatSseEvent(e)` for each event. Headers: `content-type: text/event-stream; charset=utf-8`, `cache-control: no-cache, no-transform`, `x-accel-buffering: no`. The client hanging up calls `events.return()`.
- A throw from inside the stream after headers are sent becomes one final `error { code: 'provider_error', retryable: true }` event (the runner already ends with done or error; this is a last net, logged).
- Missing `REDIS_URL` or provider key: 503 JSON `{ error: { code: 'provider_error', ... } }` before streaming, logged once. No fallback to memory ports in production.

SSE event mapping: no new wire format. Each contracts `TurnEvent` becomes `event: <type>` + `data: <json>` via the harness's `formatSseEvent`. The client parses the `data` line and validates it with `TurnEventSchema`; a line that fails validation ends the turn as a stream error (dropped, never shown).

No contracts change, no ADR.

### Client turn state (Phase B, the safety core)

`apps/web/src/chat/turnState.ts`, a pure reducer over `{ turn: { status, text, skills, sources, hintRung, locked, teacherQuestion, safety, replaced, error } }`:

1. `token`: append to `text`. Status stays `streaming` (provisional).
2. `skill`: push to `skills` (provisional).
3. `sources`, `hint_rung`, `locked`, `teacher_question`, `safety`: set the field.
4. `replace { text }`: set `text` to that text. If anything was shown before (text or skills), set `replaced = true`. **`replace ''` also clears `skills` and `sources`**. A later retry then streams into a clean turn.
5. `done`: status `final`, keep `messageId`. Only now does the message join the finalised thread.
6. `error { code, retryable }`: **drop** text, skills and sources. Status `failed`, show the fixed English text for `code` (`errorText.ts`, every code in the contracts enum, exhaustive switch). This also closes 4.2b's deferred MEDIUM (the bare `guard_blocked`).
7. Stream ended with no `done` and no `error` (`ended` action from the SSE reader): same as error, with code `provider_error`.
8. Any event after `done` or `error` is ignored (test).

`apps/web/src/chat/sse.ts`: reads `fetch` `response.body`, splits on blank lines, joins `data:` lines, `JSON.parse` plus `TurnEventSchema.safeParse`, and yields events then `ended`. It is tolerant of chunk boundaries anywhere, including inside a UTF-8 character (`TextDecoder` with `stream: true`). A non-2xx response with a JSON error body becomes one `error` action.

### Rendering (Phase B renderer, Phase C components)

- `renderReply.tsx`: interface `renderReply(text): ReactNode`. **No `dangerouslySetInnerHTML` anywhere.**
  - Default (no new dependency): paragraphs with `white-space: pre-wrap`; fenced code blocks become `<pre><code>`; everything else is React text nodes, so HTML shows literally.
  - If the human picks the library (Q1): `react-markdown` + `remark-gfm`, with `skipHtml`, an `allowedElements` allowlist (p, em, strong, ul, ol, li, code, pre, blockquote, h3-h6, table parts), links unwrapped to their text, no images. The same tests must pass for either.
- Provisional text: muted style, `aria-busy="true"`, a visible "Still checking..." label, outside the `aria-live="polite"` region. A finalised message moves into the live region. If replaced, it shows a visible "Updated" marker with a tooltip/aria text "This reply was corrected".
- `MessageBubble`: roles student, agent, and teacher (labelled "Your teacher", distinct style). `[message withheld: code]` history text renders as plain text.
- `HintButton`: sends `kind: 'hint_request'`. Shows the rung from `hint_rung` (1-2 "Hint", 3 "Worked example", 4 "Full solution"; 0 shows nothing).
- `SourcesList`: title and locator as text, no links.
- `LockedNotice`: "This is part of <packageName>" or the generic text without a name.
- `TeacherQuestionNotice`: "Sent to your teacher. They'll answer in a live class or here."
- `SkillCard`: skill name and "Coming soon" (9.5).
- `Composer`: textarea plus send. Disabled while a turn is streaming. Enter sends, Shift+Enter is a newline.
- All strings are in `apps/web/messages/en.json` under `chat.*`. `NextIntlClientProvider` wraps the learn page (9.1 left it out).

### Page (Phase C)

`apps/web/app/learn/[agentId]/page.tsx` (server component):
1. `requireRole(['student'], { clearance: 'agent' })`.
2. `studentTurnScope`. A non-live agent shows `notFound()`.
3. `?s=<sessionId>`: `sessions.get(scope, id)`. If it is own, the same agent and not ended, load `messages.history(scope, id, 50)`; otherwise ignore it and start empty.
4. Render `ChatView` (client) with the initial messages, agentId and sessionId.

`ChatView`: on the first send with no session, POST `/api/sessions`, then `router.replace('?s=<id>')`, then POST the turn.

`/home` (9.1's `view.tsx`): replace the "your teacher's agent will be here soon" placeholder with a link to `/learn/<agentId>` for the student's live subscription (`subscriptions.findLive` with the scope from the subscription's agent). With none, keep the placeholder. See Q2.

## Phases

Each phase: tests first, then code. Green `typecheck lint test --filter=@edmate/web...`, one commit, and a "state after this phase" note in the handoff. A fresh builder per phase reads this plan and the previous phase's handoff. About 120 builder calls each.

### Phase A: server, routes and clearance (risky: auth/index.ts)

Tests first:
- `apps/web/src/turn/clientInput.test.ts`: strict parse. Rejects `studentId`, `sessionId`, unknown kinds (`check_answer`, `skill_action`), `lang` other than `en`, empty or oversize text (use the contracts' limit).
- `apps/web/src/turn/routes.test.ts` (fake guard deps, memory ports, scripted gateway; **no real model calls**):
  - **Clearance**: a `parent_needed` student gets 403 on both routes, with no session made and no gateway call. A `clear` student passes. A teacher gets 403. Anonymous gets 401.
  - Start: no entitlement gives 403 `no_access`. A non-live agent gives 404. Success returns `{ sessionId }`, and the row has the entitlement's package version.
  - Turn: another student's session id gives 404. An ended session gives 404. A body with `studentId` gives 400 and the principal's id is the one used (assert on the transcript port).
  - SSE: the content type and cache headers are right. The scripted stream "Hello" yields `token` events then `done`, parsed back with `TurnEventSchema`. A script that triggers a retry shows `replace ''` before the retry. A locked turn shows `locked`. The pre-guard refusal shows `error guard_blocked`.
  - Abort: cancelling the request signal stops the stream and the scripted gateway sees the cancel.
- `apps/web/src/auth/index.test.ts`: add a case that `serverDatabase()` shares the identity with the guard.

Files:
- create `apps/web/src/turn/runtime.ts`, `deps.ts`, `scope.ts`, `clientInput.ts`, `routes.ts`, `fallbackReplies.ts` (+ tests above)
- create `apps/web/app/api/sessions/route.ts`, `apps/web/app/api/sessions/[id]/turns/route.ts`
- modify `apps/web/src/auth/index.ts` (+ `index.test.ts`): `serverDatabase()` only
- modify `apps/web/package.json`: add workspace deps `@edmate/harness`, `@edmate/gateway` (workspace packages, not a tech-stack change)
- modify `apps/web/.env.example` if it exists: names only (`REDIS_URL`, the provider key name), no values

State after Phase A: both routes work end to end in tests with the scripted gateway. No UI yet. The route-coverage test is green with two new wrapped routes.

### Phase B: client core (pure, no page)

Tests first:
- `apps/web/src/chat/turnState.test.ts`: every rule 1-8 above, one test each. Plus "replace-empty, then retry tokens, then done gives only the retry text", "replace with text after tokens sets replaced", "replace before any token does not set replaced", and "events after done are ignored".
- `apps/web/src/chat/sse.test.ts`: chunk splits at every byte offset of a fixture stream (including mid-UTF-8), a multi-line `data:`, an invalid JSON or schema event ends as an error, a truncated stream ends with `ended`, and a non-2xx JSON error body.
- `apps/web/src/chat/errorText.test.ts`: every contracts error code has non-empty fixed text and none echoes server text.
- `apps/web/src/chat/renderReply.test.tsx`: the raw HTML cases from the acceptance table, fenced code becomes `<pre><code>`, and TeX stays literal.
- `apps/web/src/chat/no-raw-html.test.ts`: the source scan.

Files: create `apps/web/src/chat/turnState.ts`, `sse.ts`, `errorText.ts`, `renderReply.tsx`, `sendTurn.ts` (fetch + sse + dispatch, with an AbortController), and the tests above. If Q1 is answered yes before this phase: add `react-markdown` and `remark-gfm` to `apps/web/package.json`; otherwise use the no-dependency renderer.

State after Phase B: the safety rules of the accept line are proven in pure tests. Nothing is mounted yet.

### Phase C: components and page

Tests first (RTL + axe, the 9.1 harness):
- `MessageBubble.test.tsx`: provisional style, label and `aria-busy`; final; the "Updated" marker; teacher label; withheld text literal.
- `ChatView.test.tsx`: with a fake `sendTurn` driving events: `replace ''` clears the shown text, skill cards and sources in the DOM; a cut stream leaves no agent bubble and shows the error text; the hint button sends `hint_request` and shows the rung label; locked notice; teacher-question notice; the composer is disabled while streaming. Axe has no violations in each state.
- `HintButton.test.tsx`, `SourcesList.test.tsx`, `LockedNotice.test.tsx`: small cases.
- `apps/web/app/learn/[agentId]/page.test.tsx`: **clearance** (`parent_needed` redirects to the age gate path, teacher refused, `clear` renders); another student's `?s=` is ignored; a non-live agent gives notFound.
- `apps/web/src/chat/clearance-scan.test.ts`: the source scan from the clearance table.
- `/home` view test: a link appears with a live subscription; with none, the placeholder stays.

Files: create `apps/web/src/chat/ChatView.tsx`, `MessageBubble.tsx`, `Composer.tsx`, `HintButton.tsx`, `SourcesList.tsx`, `LockedNotice.tsx`, `TeacherQuestionNotice.tsx`, `SkillCard.tsx`, `chat.css` (plain CSS, as in 9.1), `apps/web/app/learn/[agentId]/page.tsx` (+ tests). Modify `apps/web/messages/en.json` (`chat.*`) and 9.1's `apps/web/app/home/page.tsx` / `view.tsx` (link).

State after Phase C: a seeded student can open `/learn/demo-agent` and chat (with a real key locally). All component tests are green.

### Phase D: e2e

- Add `@playwright/test` (devDependency, already in the stack) and `apps/web/playwright.config.ts` (`next dev`, Chromium only).
- `apps/web/e2e/fixtures.ts`: sign-in through a database session cookie for a seeded `demo-student-N` with a live subscription and `clear` status (the `build-smoke.test.ts` pattern). The turns response is fulfilled with `page.route` from SSE fixture files, each event checked against `TurnEventSchema` when loaded. **No test hook in production code.**
- `apps/web/e2e/chat.spec.ts` cases: `normal`, `retry-after-replace`, `replace-with-text` (the "Updated" marker is visible), `error-mid-stream`, `cut-stream` (no agent text left), `locked`, `teacher-question`, `hint-rung`, `html-in-tokens` (no `img` or `script` in the thread; the text is literal), and `parent-needed` (a `parent_needed` student is redirected to the age gate).
- `apps/web/package.json` script `e2e`. **Not wired into CI** (9.7). The handoff gives the local command.

State after Phase D: the accept line is fully shown. 9.7 adds the CI job.

## Files out of bounds

- `packages/contracts/**` (no contracts change; stop and ask if one seems needed)
- `packages/harness/**`, `packages/gateway/**`, `packages/queue/**`, `packages/db/**` (including `repositories/**`), `packages/content/**`
- `content/**` (locale packs, prompt packs, legal)
- `apps/worker/**`, `apps/cli/**`
- `.github/**`, `.claude/**`, `.githooks/**`
- `apps/web/src/auth/**` except `index.ts` and `index.test.ts`; in particular `policy.ts` and `guard.ts` stay as they are (the policy rows already exist)
- `docs/adr/**`

## Risky paths touched

Checked every planned path against `.claude/skills/merge-gate/risk-paths.txt`:
- `apps/web/src/auth/index.ts`, `apps/web/src/auth/index.test.ts` match `apps/web/src/auth/**`. Reviewer: **security-reviewer**. The handoff logs a `risk: high` decision: "9.4 adds `serverDatabase()` to the web auth runtime so the turn routes reuse the age-policy identity".
- No other matches: `apps/web/app/api/sessions/**` is not under `webhooks/**` or `auth/**`. `apps/web/src/turn/**`, `apps/web/src/chat/**`, `apps/web/app/learn/**`, `apps/web/app/home/**`, `apps/web/e2e/**`, `apps/web/messages/**` and `apps/web/package.json` are not listed. No `packages/**`, `content/**`, `.github/**` or `.claude/**` change.

Recommended extra review (not gate-required): security-reviewer on the whole PR (a new student-facing write path, session ownership, raw HTML), plus code-reviewer and typescript-reviewer.

## Open questions

- **Q1 (human, tech stack): a markdown library?** Recommendation: `react-markdown` + `remark-gfm`, with `skipHtml`, an element allowlist, no images and links unwrapped. KaTeX (`remark-math` + `rehype-katex`, `trust: false`) comes later with maths. Logged as `risk: medium` with no ADR, following 9.1's precedent for next-intl. Alternative: keep the in-house renderer. **Not blocking**: Phase B ships the no-dependency renderer behind `renderReply`, and the library can be swapped in later under the same tests.
- **Q2 (lead or human): how does a student reach a teacher's chat before 9.2/9.3?** Recommendation: `/learn/[agentId]` plus a `/home` link for the student's live subscription. Seeded demo students work today; real pilot students need 9.3 (start a package), so consider pulling 9.3 into the slice. Not blocking.

## Decisions to log (handoff `## Decisions`)

- `risk: high`: `serverDatabase()` export in `apps/web/src/auth/index.ts` (above).
- `risk: medium`: the web composition root copies the CLI's fallback replies; follow-up to move them into `@edmate/content`.
- `risk: medium`: the web uses full-text retrieval (no embedder) for the slice.
- `risk: low`: Playwright e2e runs locally only; the CI job is 9.7.
- `risk: low`: maths and code highlighting are parked; teacher answers in the thread arrive with 8.9; resuming the latest session is parked (needs a repo method).
- `risk: medium` (only if Q1 = yes): the markdown library.

Board follow-ups to file: resume the latest session (db repo method), KaTeX maths, code highlighting, unify the fallback replies, and the Playwright CI job (9.7 already).
