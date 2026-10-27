# Handoff: 6.4a

Status: DONE

## Phase A

Topic-scored evidence producer (`@edmate/harness`), test first, per `docs/tasks/6.4a/plan.md`.

- `packages/harness/src/pipeline/tools.ts` — `IssuedItem` gets an optional `topicId?: string`.
- `packages/harness/src/tools/practice.ts` — a new `topicIdFor(itemId, scope)` helper (parallel to
  `answerKeyFor`: the bank's own `topicId` first, else the generator's parsed id) resolves the
  topic the model never sees; `issuedItem()` attaches it to the `IssuedItem` it returns.
- `packages/harness/src/pedagogy/helpState.ts` — `HelpState` gets an optional `practiceTopicId`,
  parallel to `practiceModuleId`; `practiceFields()` carries it over on every saved state. A blob
  saved before 6.4a still parses (no `practiceTopicId`).
- `packages/harness/src/pipeline/runner.ts` — `withPractice()` sets `practiceTopicId: last.topicId`
  alongside `practiceModuleId` when an item went out. A new `private turnSkill` field records
  decide's skill for the turn; a new `private evidenceFor(e, ctx)` method builds one
  `EvidenceEvent` (`studentId`/`teacherId` from `e.entitlement`, `topicId` from the *loaded* help
  state — the item the student is grading this turn — `correct: ctx.attempt === 'correct'`,
  `source: 'practice'`, `weight: 1`, `ts`) when the turn's skill is `practice` and `ctx.attempt` is
  `'correct'` or `'wrong'`; `finish()` attaches it to `CommitRecord.evidence`. No context, no
  practice skill, an unsettled attempt (`'none'`/`'partial'`), or no stored `practiceTopicId` (the
  defensive gap) all mean no event; the method never throws.

### Tests first (red → green)
- `packages/harness/src/pipeline/runner.evidence.test.ts` (new): 6 cases — a correct practice
  answer emits one `EvidenceEvent` with the held topic; a wrong one emits `correct: false`; a
  non-practice skill, an unsettled attempt (`'partial'`, `'none'`), and a held item with no stored
  topic all emit none. Verified red first: with the `evidence` wiring in `finish()` temporarily
  reverted, the "correct" and "wrong" cases failed (`expected [...] + Received: undefined`); with
  it restored, all 6 pass.
- `packages/harness/src/pedagogy/helpState.test.ts`: extended `PRACTICE` with `practiceTopicId`
  and added a case for a pre-6.4a blob with `practiceModuleId` but no topic; `copyHelp` and
  `practiceFields` assertions updated to cover it.
- `packages/harness/src/tools/practice.test.ts`: the two existing `issuedItem()` equality
  assertions (a bank item, a generated item) extended with the new `topicId` field they now return
  (`'fractions'`, `'module-arithmetic:practice'`).

Confirmed by grep (plan's dependents check): `IssuedItem` and `practiceTopicId` do not appear
outside `packages/harness/src`, so `@edmate/harness`'s exported surface is unchanged and no
dependent package needed re-gating beyond the gate command below.

## Phase B

A real "end session" trigger in `apps/web`, test first, per `docs/tasks/6.4a/plan.md` Phase B.

- `apps/web/app/api/sessions/[id]/end/route.ts` (new) — `POST /api/sessions/:id/end`. Follows the
  reports route's pattern (`app/api/sessions/[id]/reports/route.ts`): the session id is the URL
  param, the body names only `agentId` so `studentTurnScope` can build the scope. Only the
  student who owns the session can end it; anyone else, or a missing session, gets the same 404
  (lead answer, 27 Oct 2026). An already-ended session's `end` is a no-op success (never
  re-summarised, per `sessionsRepo.end`'s existing contract). Loads up to
  `SUMMARY_HISTORY_LIMIT` (50) messages via `repos().messages.history`, calls
  `summarizeSession` from `@edmate/harness` over a bare, unmetered `generateObject` built lazily
  (Anthropic, or the dev model's fixed summary candidate under `EDMATE_DEV_MODEL=scripted`) —
  mirrors `apps/web/src/studio/styleCardRuntime.ts`'s drafter pattern (there is no natural turn or
  entitlement to bill this call to, lead answer Q4). A gateway or schema failure is logged and
  swallowed, never blocking `sessions.end` (per `sessionSummary.ts`'s own doc comment rule, "don't
  block ending a session on a model failure"). No `ROUTE_POLICY` edit needed: the existing
  `/api/sessions/**` POST wildcard already covers it (confirmed via `apps/web/src/auth/
  route-coverage.test.ts`, unedited).
- `apps/web/app/api/sessions/[id]/end/route.test.ts` (new) — a memory agents+sessions+messages
  backend (no database) and a scripted gateway stub (no real model call), per rule 4. Cases:
  happy path ends the session and stores the summary; another student's / another teacher's /
  a mismatched-agent session all read as the same 404; an already-ended session is a no-op
  (summary untouched, `end` never re-called with a new summary); an empty transcript never builds
  or calls the gateway; a gateway failure and a schema failure both still end the session with no
  summary, logging the failure name only; oversized/invalid bodies are 400/413; an unexpected
  throw (`Error` and a non-`Error` value) is 500, logging only the error's name
  (`errorName()` → `'Error'` / `'string'`, never the message); the default logger writes to
  `console.error`; routed through the real guard and `ROUTE_POLICY` end to end. Verified red
  first: with the route's body temporarily stubbed to always 404, every happy-path and no-op case
  failed; restored, all pass.
- `apps/web/src/chat/EndSessionButton.tsx` (new) — same size/pattern as `ReportButton.tsx`
  (12.2c). Closed shows one "End chat" button; clicking asks for a plain confirm (no destructive
  action without one) before `endSession()` POSTs. On success, `onEnded` defaults to
  `window.location.reload()` — `loadChat.ts`'s existing rule already treats a reopened, ended
  session's `?s=` as a fresh empty chat, so no new client-side "ended" state was needed. A
  failure shows fixed text (never the server's own message) and returns to the confirm step to
  retry.
- `apps/web/src/chat/EndSessionButton.test.tsx` (new) — renders nothing without an open session;
  opens the confirm step, a11y clean closed and open; sends on confirm, disables both buttons
  while busy, calls `onEnded` on success; cancel returns to closed without sending; a failure
  shows fixed text and stays on the confirm step; the `endSession()` fetch layer: posts the
  session+agent id with no body text and returns `ok: true` on 200, a non-2xx is `ok: false` and
  never throws, a network failure is `ok: false` and never throws, the session id is
  URL-encoded. Verified red first (component and fetch layer both absent), then green.
- `apps/web/src/chat/ChatView.tsx` — mounts `<EndSessionButton agentId={agentId}
  sessionId={reportSessionId} />` next to the existing `<HintButton />`, reusing the pre-existing
  `reportSessionId` variable; no new props threaded through `ChatView`.
- `apps/web/messages/en.json` — new `endSession` namespace (button/confirm/ending/cancel/failed
  strings) alongside the existing `report` namespace.

### Deviation from the plan's file list
The plan suggested widening `TurnBackend`/using `turn/depsFor` to reach the transcript and
session row. I used `serverDatabase().repos.messages.history` / `.repos.sessions` directly
instead (the same reader `loadChat.ts` already uses for a reopened chat) — see Decisions below.

## Decisions

### 27 Oct 2026 · 6.4a end route reads repos directly, not TurnBackend · decided by builder · risk: low
- Decided: `apps/web/app/api/sessions/[id]/end/route.ts` reads the transcript and session row via
  `serverDatabase().repos.messages.history` / `.repos.sessions`, not by widening
  `TurnBackend`/`turn/depsFor` as the plan's Phase B file list suggested.
- Why: ending a session is housekeeping, not a teaching turn — `depsFor` wires Redis and queue
  machinery for the turn pipeline that this route has no need of. `runtime.test.ts` confirms
  production `TurnBackend.sessions` is literally `repos.sessions`, so the result is behaviourally
  the same object, just without the unrelated dependency. `turn/routes.ts` was not edited.

### 27 Oct 2026 · 6.4a endSession strings added to en.json · decided by builder · risk: low
- Decided: added an `endSession` namespace to `apps/web/messages/en.json` (not in the plan's
  literal Phase B file list).
- Why: `EndSessionButton.tsx` needs real button/confirm/error text and the test harness
  (`renderIntl`) renders against the real `en.json`; every other button on this page
  (`ReportButton`, `HintButton`) follows the same pattern of owning its own namespace there.

### 27 Oct 2026 · 6.4a helpState.ts practiceTopicId · decided by builder · risk: high
- Decided: add `practiceTopicId?: string` to `HelpState` (`packages/harness/src/pedagogy/
  helpState.ts`), parallel to `practiceModuleId`, carried by `practiceFields()`/`copyHelp()`; a
  blob saved before this task still parses (the field is simply absent).
- Why: the plan calls for it directly and flags `packages/harness/src/pedagogy/**` as a risky path
  under the MVP-first rule in `risk-paths.txt` — logged `risk: high` per that rule, not because the
  change itself is risky (it is a narrow, additive, optional string field with no behavior change
  to existing saved state).

### 27 Oct 2026 · 6.4a evidence topic source · decided by builder · risk: low
- Decided: the `EvidenceEvent`'s `topicId` comes from the *loaded* help state
  (`this.loadedHelp?.help.practiceTopicId`, i.e. the item the student held before this turn and is
  now grading), not from any item issued during this same turn.
- Why: `ctx.attempt` is computed by classifying the student's text against the loaded
  `answerKey` (the item they are answering); a freshly issued item this turn has no graded attempt
  yet. The plan's runner.ts bullet names `help.practiceTopicId` without saying which help state,
  and this is the only one `finish()` has in scope that matches the already-computed `attempt`.

### 27 Oct 2026 · 6.4a decide's skill routed through a new `turnSkill` field · decided by builder · risk: low
- Decided: added a private `turnSkill: Skill | null` field, set from `decided.skill` right after
  decide, and read inside `finish()`'s new `evidenceFor` helper, instead of threading `skill`
  through `CommitRecord`/`rec`.
- Why: `decided.skill` is local to `main()`; `finish()` is the one place every outcome path (error,
  blocked, escalated, replied) funnels through to build `CommitRecord`, and the field avoids
  widening `CommitRecord` or every `finish()` call site for a value only this new producer reads.

## Gate

```
corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness   (dependents form, lead answer)
corepack pnpm --filter @edmate/harness typecheck lint test                 (leaf, run alone)
```
- `@edmate/harness` typecheck: pass.
- `@edmate/harness` lint (`corepack pnpm --filter @edmate/harness lint`): pass, no findings.
- `@edmate/harness` tests run alone (`corepack pnpm --filter @edmate/harness test`, no other
  workspace package competing for CPU): **128 files / 5681 tests passed**, including the new
  `runner.evidence.test.ts` (6/6) and the extended `helpState.test.ts` / `practice.test.ts`.
- The dependents-form gate (`--filter=...@edmate/harness`, every workspace package building/
  testing together) was run twice on this machine; both times it failed on the same **two
  pre-existing, unrelated timing tests** once everything else (evals' 630+ seeded safety cases,
  content, web, cli, worker) was running in parallel and starving the harness test workers'
  wall-clock budget: `src/pedagogy/modelRequest.test.ts`'s "runs in linear time on long hostile
  input" (a `ratio < 64` performance assertion; observed 82–161 under contention) and
  `src/pipeline/runner.test.ts`'s "a soft hit never escalates..." (a hardcoded 2000ms test
  timeout). Neither test touches anything this task changed (6.4a added no new regex, loop or
  distress-check code). Re-run alone, `modelRequest.test.ts` passed 86/86. I could not get a
  single all-green run of the full dependents-form command on this machine inside this phase's
  budget; the leaf-alone result above is what I'm standing behind as green. Left to do for a
  future pass (or Phase B's builder, who also must gate `...@edmate/harness`): either accept this
  machine's contention as a known flake (not caused by 6.4a) or re-run the dependents form on a
  quieter window.
- `corepack pnpm exec prettier --check` on every file this phase touched: pass (after one
  `--write` on the new test file to match the repo's formatting).
- `python3 .githooks/secret-scan.py --all`: clean.

### Phase B

```
corepack pnpm turbo run typecheck lint test --filter=@edmate/web...
corepack pnpm --filter @edmate/web typecheck
corepack pnpm --filter @edmate/web lint
corepack pnpm exec vitest run -- end/route.test.ts EndSessionButton.test.tsx ChatView.test.tsx
```
- The dependents-form gate (`--filter=@edmate/web...`) ran `@edmate/web`'s own typecheck/lint/
  test tasks clean (no `@edmate/web` failure anywhere in the run), but the combined run failed
  overall on **`@edmate/harness#test`** — 3 pre-existing timing-sensitive tests under this
  machine's contention when every workspace package builds/tests together: the same two tests
  already flagged as known flakes in the Phase A section above
  (`src/pedagogy/modelRequest.test.ts`'s linear-time ratio check,
  `src/pipeline/runner.test.ts`'s hardcoded-timeout soft-hit case), plus one more of the same
  kind in `src/pipeline/steps/preGuard.test.ts`. None of Phase B's files touch
  `packages/harness` pedagogy/pipeline code.
- Leaf-alone, run separately to confirm `@edmate/web` itself is clean of that contention:
  `@edmate/web` typecheck — pass. `@edmate/web` lint — pass, 0 errors (2 pre-existing warnings in
  `test/lighthouse-a11y.test.ts`, unrelated to this phase). The three new/edited test files plus
  the full `@edmate/web` suite around them: **170 files / 2716 tests passed, 31 skipped** (the
  4 skipped int-test files need `TEST_DATABASE_URL`, unrelated), 0 failed.
- Typecheck first caught the mock gateway in `route.test.ts`: `generateObject<T>` is generic
  over the caller's schema, so the stub had to call `schema.parse(...)` rather than return a
  fixed object, to type-check against `ModelGateway`'s real signature. Fixed in both call sites.
- `corepack pnpm exec prettier --check` on every file this phase touched: `route.ts` and
  `route.test.ts` needed one `--write` (new files, not yet formatted); the fix to
  `EndSessionButton.test.tsx` triggered a reformat too; `ChatView.tsx`'s only diff after
  `--write` was whitespace on the two newly added lines (confirmed via `git diff --stat`,
  2 insertions only). `EndSessionButton.tsx`, `en.json` already matched.
- `python3 .githooks/secret-scan.py --all`: clean.

## Budget

Phase A tool calls used: 68 (over the ~45 planned; most of the overrun was waiting on this
machine's contended, serialized dependents-form gate run — see Gate above)

Phase B tool calls used: ~95 (over the ~50 planned; a session compaction mid-phase, a round of
typecheck fixes on the mock gateway's `generateObject` signature, and re-running the gate to
separate `@edmate/web`'s own clean result from the unrelated `@edmate/harness` contention flake
accounted for most of the overrun)
