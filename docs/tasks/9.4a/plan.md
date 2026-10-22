# 9.4a plan — session-start rate limit; per-student market; scoped /home chat links; test hygiene

## Acceptance (verbatim)
> no env var picks a student's market or chat links in production; session starts are
> rate-limited per student.

How it's shown:
- `apps/web/src/deploy/stack-config.test.ts`: the `EDMATE_MARKET`/`EDMATE_CHAT_AGENTS` assertions
  are removed (the env vars are removed from `docker/compose.yaml`/`docker/env.example`); a new
  assertion (or the absence of any `passed(web, 'EDMATE_MARKET'|'EDMATE_CHAT_AGENTS')` call) proves
  neither var is wired to `web` any more.
- `apps/web/src/turn/runtime.test.ts`: production builds with no `EDMATE_MARKET` set and no
  `EDMATE_CHAT_AGENTS` set (both deleted from `ENV`), and the backend's market/chat-link reads come
  from fakes keyed by student id, not `process.env`.
- `apps/web/src/turn/routes.test.ts` (Phase A): the Nth+1 `startSession` call for the same student
  inside the window is `429 rate_limited`; a different student, or the same student after the
  window, still succeeds.

## Context already on main (reuse, don't duplicate)
- `users.market` (`packages/db/src/schema/users.ts`) already exists, `NOT NULL`, set to `'global'`
  at signup and to the learner's real answer by `identity.recordAgeAnswer` (1.7). **No migration
  needed** for Phase B — this sidesteps the "say so plainly, then wait for 5.10b/11.1d" instruction
  entirely.
- `apps/web/src/discovery/rateLimit.ts` and `apps/web/src/studio/linkRateLimit.ts` are the two
  existing Redis fixed-window limiter shapes (fail-open for page views, fail-closed one-script
  INCR+PEXPIRE for a real write/resource guard). Phase A mirrors `linkRateLimit.ts`'s fail-closed
  shape, scoped to its own file — it does not import either.
- `packages/queue/src/turnLimits.ts` (sliding window, `TurnLimits.rate`/`.messages`) is the
  **per-message, inside a session** limit already wired into the pipeline. It is a different
  concern from "how often can this student start a brand-new session" and is left untouched.
- 9.0d (done) already fixed the `routes.test.ts` "streams SSE with the right headers" CI flake (PR
  #126/#127) via `deadlineSafeClock`'s `now()`-jump cap in `apps/web/test/turn-backend.ts`. **9.4a's
  title repeats this item almost verbatim — it is already fixed on main. Dropped from Phase D.**
- `packages/gateway/src/pricing/load.ts`/`prices.generated.ts` (fix round 9.4e, already on main)
  embeds `prices.yaml` statically instead of `readFileSync(new URL(..., import.meta.url))`, which
  is exactly the blocker `apps/web/playwright.config.ts`'s comment names for why `--webpack` was
  dropped. Confirmed fixed — Phase D restores `--webpack`.
- 9.2a's public discovery repository is on main, but this plan does **not** wire it into `/home`
  (see Open questions — out of scope here, kept to the one item the task names).

## Phases
Four phases, each a fresh builder reading this plan plus the previous phase's handoff.
Budget: 290 tool calls (4 phases: A 65, B 85, C 70, D 70)

### Phase A — per-student rate limit on session starts
**Design.** A new fixed-window limiter, modeled on `apps/web/src/studio/linkRateLimit.ts` (one Lua
`INCR`+`PEXPIRE` round trip, fails **closed** — this guards real session-row creation and
downstream agent calls, the same category as the studio link guard, not a page view). Default
`SESSION_START_LIMIT = 20` per `SESSION_START_WINDOW_MS = 10 * 60_000` (20 new sessions / 10 min /
student) — **open question, see below**, lead can tune the two constants with no design change.

**Files**
- `apps/web/src/turn/sessionRateLimit.ts` (new) + `sessionRateLimit.test.ts` (new): limiter +
  in-memory fake (tests) + a fail-closed fake, mirroring `linkRateLimit.ts`'s three exports.
- `apps/web/src/turn/routes.ts`: `TurnBackend` gains `sessionRateLimit: { take(studentId: string):
  Promise<boolean> }`; `startSession` calls it right after body validation (before any DB/entitlement
  work) and returns `apiError('rate_limited', MSG.tooManySessions, 429)` on refusal. `postTurn` is
  untouched (the task names *session starts*, not turns).
- `apps/web/src/turn/runtime.ts`: `openRedis` (or a sibling function) builds the limiter on the
  same Redis connection `limits` already uses (no third connection); `RuntimeHooks.redis`'s return
  type grows one field.
- `apps/web/test/turn-backend.ts`: `memoryBackend` gets a default-allow `sessionRateLimit` stub
  (and an option to inject a refusing one, for the one 429 test if it's easier to assert end to end
  here than through the real limiter's own unit tests).
- `apps/web/src/turn/routes.test.ts`: refusal case (429, retryable, no session row written), window
  reset, per-student isolation (`stu_1` capped, `stu_2` unaffected), `postTurn` unaffected.
- `apps/web/src/turn/runtime.test.ts`: the built backend's `sessionRateLimit` is wired from
  `hooks.redis(...)`'s new field, not hand-built inside `build()`.

**Tests first**: write `sessionRateLimit.test.ts` (fake clock, no real Redis — rule 4) and the
`routes.test.ts` 429/window/isolation cases before wiring `routes.ts`.

### Phase B — the student's own market, read from identity, per turn
**Design.** `EntitlementStoreOptions.market` (fixed string, `packages/db/src/repositories/ports.ts`)
stays for `teacher_preview`/`eval` (there is no "the student" in either — preview is the teacher's
own id, eval is pinned by the runner). A new required `studentMarket(studentId): Promise<string>`
is added to the same options and is the **only** market source the `source === 'subscription'`
branch reads (replacing `opts.market` there). `identity/store.ts` gains one narrow new method,
`getMarket(userId): Promise<string | null>` (select `market` only — not a `getUser` field change,
so every existing `IdentityUser`/NextAuth-adapter consumer is untouched). `apps/web/src/turn/
runtime.ts` wires `studentMarket` from `identity.getMarket`, falling back to `'global'` on `null`
(unknown id — unreachable in practice, the route already resolved the principal). The production
fail-closed `TurnUnavailableError('EDMATE_MARKET')` boot check is removed: `users.market` is
`NOT NULL`, so a market is never missing; `packMarket` already falls back an unrecognised market to
`'global'` (existing, unchanged behaviour), so the risk the old check guarded against (an operator
forgetting to set the env var) no longer exists once the source is per-row DB data, not a deploy
setting.

**Files**
- `packages/db/src/identity/store.ts` (+ its test, `packages/db/test/identity.int.test.ts` or
  wherever unit tests for this store live — check first): new `getMarket`.
- `packages/db/src/repositories/ports.ts` (+ `packages/db/test/...`): `EntitlementStoreOptions`
  gains `studentMarket`; the `subscription` branch of `entitlementStoreFor.resolve` uses it instead
  of `opts.market`.
- `apps/web/src/turn/deps.ts` (`ProcessPortOptions`/`processPorts`): forwards `studentMarket`.
- `apps/web/src/turn/runtime.ts`: drop `configuredMarket`/`EDMATE_MARKET` read for the turn routes;
  wire `studentMarket` from `identity.getMarket`; widen `RuntimeHooks.database()`'s identity `Pick`
  to include `getMarket`.
- `apps/web/src/turn/runtime.test.ts`: remove/replace the five `EDMATE_MARKET`-keyed tests (unset,
  unknown, known, dev-model-with-EDMATE_MARKET, outside-production-default) with per-student cases
  (fake `getMarket` returning e.g. `'IN'`/`'US'`/unknown → packs mapping, including a market with no
  pack falling back to `'global'`).
- `apps/web/src/deploy/stack-config.test.ts`, `docker/compose.yaml`, `docker/env.example`,
  `docs/try-it.md`: drop the `EDMATE_MARKET` env var and its test/doc lines entirely (not just the
  web test — the var disappears from the deploy surface).
- **Out of bounds, explicitly**: `apps/web/src/studio/testChat/runtime.ts`/`.test.ts` (teacher
  preview chat keeps its own `EDMATE_MARKET`-style read — there is no student there) and
  `apps/worker/src/gate/**` (ingest content-gating against a locale pack, unrelated to picking a
  *student's* market). Neither is touched.

**Tests first**: write the new `identity/store.test` and `ports.ts` test (subscription branch calls
`studentMarket`, preview/eval still use `market`) before touching `runtime.ts`.

### Phase C — `/home` chat links from the student's own subscriptions (drop `EDMATE_CHAT_AGENTS`)
**Design.** New `subscriptionsRepo.listLiveForStudent(studentId): Promise<Array<{ agentId: string;
teacherId: string; status: Entitlement['status'] }>>` (`packages/db/src/repositories/
subscriptions.ts`): one join `subscriptions -> packageVersions -> packages -> agents` (`agents.status
= 'live'`), filtered `studentId = :id and status <> 'ended'` — mirrors what `agents.owner` +
`subscriptions.findLive` already compute per candidate today, in one query, with no per-candidate
loop. No new migration (`subscriptions_student_id_idx` already exists).

**Decision needed on scope** (flagged below, not blocking): this method takes a bare `studentId`,
not a `StudentScope` — a deliberate, narrow exception to `scope.ts`'s "student data is always per
student x teacher" rule, because the caller is always the signed-in principal reading their *own*
list across every teacher they have, never a client-supplied id. Document this as a comment on the
method and in the handoff `## Decisions` (risk: high — repositories path).

`apps/web/src/chat/liveChats.ts`: `homeCandidateScan` is replaced by a direct call to
`subscriptions.listLiveForStudent(principal.userId)` for the **chats**/**paused** buckets (no more
`agents.owner` loop for these two). The **startable** bucket (never subscribed — a "start a
package" link, not a chat link, so the accept line's "chat links" wording doesn't require moving
it) keeps today's `chatAgentCandidates(env)`/`EDMATE_CHAT_AGENTS` candidate list, filtered to drop
any `agentId` already present in the live list (so a configured demo agent the student already
chats with never double-lists as "startable"). `classifyHomeLinks` is simplified to take the live
list directly; `teacherIds` is still the dedup of the live list only (today's behaviour — startable
candidates were never part of the live-classes teacher set).

**Files**
- `packages/db/src/repositories/subscriptions.ts` (+ `packages/db/test/repositories.int.test.ts`):
  new `listLiveForStudent`.
- `apps/web/src/chat/liveChats.ts`, `liveChats.test.ts`: as above.
- `apps/web/app/home/page.tsx`, `page.test.tsx`: wiring only (the new `LiveChatDeps` shape).
- **Left unchanged**: `apps/web/src/deploy/stack-config.test.ts`'s `EDMATE_CHAT_AGENTS` assertion,
  `docker/compose.yaml`'s `EDMATE_CHAT_AGENTS` line, `docs/try-it.md` — all still correct, since
  `startable` still reads it (see decision above). If the lead instead wants `EDMATE_CHAT_AGENTS`
  gone entirely, `startable` goes empty outside a wired discovery page — flag, don't guess.

**Tests first**: `packages/db` integration test for `listLiveForStudent` (ended excluded, a
draft/suspended agent excluded, cross-teacher rows all returned) before touching `liveChats.ts`.

### Phase D — test hygiene (no risky paths)
1. `apps/web/vitest.config.ts`: coverage `include` adds `app/**/*.tsx` and `src/**/*.tsx`
   (`exclude` already has `**/*.test.ts` — add `**/*.test.tsx`); run coverage once to confirm no
   existing `.tsx` file drops the global 80% thresholds (fix or note any gap).
2. `apps/web/playwright.config.ts`: `command` regains `--webpack` (now that `loadBundledPrices` is
   static, fix round 9.4e); update/drop the stale comment; run `e2e/chat.spec.ts` locally once.
3. `apps/worker/src/gate/*.test.ts` (the gateway test the 9.0b review named): assert the transcriber
   is defined before the call that uses it.
4. `apps/web/src/turn/devModel.test.ts`: swap the hand-copied `generateObject` shapes for the real
   harness schemas.
5. `apps/web/test/turn-backend.ts`'s `deadlineSafeClock.sleep`: a bounded real fallback timer (not
   an unbounded real wait) for the no-cancel branch, a doc note that a test needing a deadline to
   fire should inject its own clock instead, and a unit test for both `sleep` branches (cancel /
   no-cancel).
6. `apps/web/src/turn/routes.test.ts`'s abort test (PR #166, "expected 10330 to be less than 3000"):
   a fake/injected clock or a looser, operation-counted bound — per `docs/lessons.md`'s "Wall-clock
   bounds fail on shared CI runners" entry, count work, don't time it.
7. `apps/web/instrumentation.test.ts`: assert `register()` returns `undefined` (pins it non-async).

**Dropped** (already fixed by 9.0d, confirmed on main): the "streams SSE with the right headers"
flake (PR #126/#127) in `routes.test.ts`.

## Files out of bounds
- `packages/db/src/schema/**` (no migration in any phase — see Context above).
- `packages/contracts/**` (no port signature the caller sees changes; `EntitlementStoreOptions` is
  a `packages/db`-local options type, not a contracts port).
- `packages/harness/**`, `content/**`, `evals/**` (no guardrail/pedagogy/locale-pack change).
- `apps/web/src/studio/**`, `apps/worker/src/gate/**` (market), `5.10b`/`11.1d`'s migration files
  and `teacher-questions`/`live-classes` tables, `10.1b`'s `packages/payments/**`,
  `3.11g`'s `packages/harness/src/pedagogy/modelRequest.test.ts` — all in flight elsewhere, untouched.

## Risky paths touched (`.claude/skills/merge-gate/risk-paths.txt`)
- `packages/db/src/repositories/**` (Phase B: `ports.ts`; Phase C: `subscriptions.ts`) —
  reviewers: **security-reviewer**.
- `packages/db/src/identity/**` (Phase B: `store.ts`) — reviewers: **security-reviewer**.
- Phases A and D touch no risky paths (`apps/web/src/turn/**`, `apps/web/test/**`,
  `apps/worker/src/gate/*.test.ts`, config files are not on the list).
- No contracts change in any phase → no ADR, no architect/typescript-reviewer requirement beyond
  the normal PR review.
- Each risky phase's handoff logs a `risk: high` decision (Phase B: removing the `EDMATE_MARKET`
  fail-closed boot check; the new `getMarket`/`studentMarket` read path. Phase C: the bare-`studentId`
  exception to the student-scope rule).

## Open questions (recommendation given; not blocking)
1. **Session-start limit numbers.** Recommend 20 starts / 10 min / student, fail closed. The lead
   can change the two constants with no design change — flagged, not blocking Phase A.
2. **Does `EDMATE_CHAT_AGENTS` disappear entirely, or only for `chats`/`paused`?** Recommend keeping
   it for `startable` only (a "start a package" link, not a "chat" link — the accept line's own
   wording), until a discovery-backed `/home` "browse more agents" replaces it (separate task, not
   9.4a). If the lead wants it gone outright, `startable` goes empty in production until that task
   lands — say so in Phase C's handoff either way.

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (pnpm typecheck/lint/test and the secret scan only; no git
push/merge from inside a builder beyond the normal workflow).

## Exit conditions
Each phase: `Status: DONE` once its own files' tests pass, the full `@edmate/web`/`@edmate/db`
gate is green (or failures are confirmed pre-existing/unrelated, named explicitly), and the secret
scan is clean. A phase stops at `Status: PARTIAL` past roughly its own budget (A 65, B 85, C 70, D
70) or if it discovers a file outside this plan needs changing (e.g., a risky path not listed
above) — it hands back rather than widening scope.

## Lead answers (22 Oct 2026)
1. Accepted: 20 session starts per 10 minutes per student, fail closed.
2. Accepted: `EDMATE_CHAT_AGENTS` stays for the **startable** bucket only, until a discovery-backed "browse more agents" task replaces it. Phase C's handoff says so.
3. Phase C's bare `studentId`: if packages/db already has a type for "the signed-in user's own id across teachers" (a branded id or a scope type), use it; otherwise take the bare id with the comment as planned. The security reviewer checks the call sites at review.
