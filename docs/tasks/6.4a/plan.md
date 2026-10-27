# Task 6.4a: session-end follow-ups from 6.4

## Goal
Acceptance (verbatim): "a graded check emits a topic-scored EvidenceEvent that reaches
CommitRecord.evidence; a real trigger ends a session with a stored summary."

6.4 built `summarizeSession` and extended `sessionsRepo.end` to store it, but left two gaps:
`CommitRecord.evidence` has a consumer (`commit.ts` already calls `profiles.applyEvidence`) but no
producer anywhere, and nothing in the real app calls `summarizeSession` + `sessions.end` — a
session only ever ends via `endOnPackageChange` or the 6.5a memory-reset watermark, never a real
"this learning session is over" event. Smallest change: thread the practice item's existing
`topicId` through to a new EvidenceEvent on a graded check, and add one explicit end-session path
in `apps/web` that calls the already-shipped `summarizeSession` + `sessions.end`.

No contracts change. `EvidenceEvent` already exists in `packages/contracts/src/memory.ts`
unchanged; `IssuedItem`/`HelpState`/`CommitRecord.evidence` are harness-internal types. No ADR
needed.

## Must not touch (per lead brief)
`packages/db/src/repositories/learner.ts` `applyMistakes` (6.3b, about to merge),
`packages/db/src/repositories/teacher-profiles.ts`, `packages/db/src/repositories/takedowns.ts`,
`apps/web/app/staff/**`, `apps/web/app/api/staff/**` (9.3g, in CI). None of the files below are in
this list. `learner.ts` is read-only context for this task (confirming `weight` is a plain
propagated column with no BKT scaling at the harness/evidence-producer side — the db adapter owns
BKT math per `packages/harness/src/testing/memoryPorts.ts`'s comment that `applyEvidence` is a
no-op on mastery there); it is not written to.

## Phase A — topic-scored evidence producer (`@edmate/harness`)

### Files touched
- `packages/harness/src/pipeline/tools.ts` — add `topicId?: string` to `IssuedItem`.
- `packages/harness/src/tools/practice.ts` — `issuedItem()` hook: resolve and pass through the
  served `PracticeItem.topicId` (already exists since 5.6) into the `IssuedItem`.
- `packages/harness/src/pedagogy/helpState.ts` — add `practiceTopicId?: string` to `HelpState`,
  parallel to the existing `practiceModuleId`; update `practiceFields()` and `copyHelp()` to carry
  it. **Risky path**: matches `packages/harness/src/pedagogy/**` → requires **code-reviewer**
  (MVP-first rule in `risk-paths.txt`; `risk: high` decision logged at handoff).
- `packages/harness/src/pipeline/runner.ts` — `withPractice()`: set `practiceTopicId: last.topicId`
  alongside `practiceModuleId`. New: before `finish()`, when the turn's skill is `practice` and
  `ctx.attempt` is `'correct'` or `'wrong'` (a graded check; `'partial'`/`'none'` do not emit
  evidence — see Open Questions), build one `EvidenceEvent` (`studentId`, `teacherId`, `topicId:
  help.practiceTopicId`, `correct: attempt === 'correct'`, `source: 'practice'`, `weight: 1`, `ts`)
  and attach it as `CommitRecord.evidence`. No topicId stored (e.g. `practiceTopicId` unset,
  defensive gap) → skip emission, no event (never throw).
- `packages/harness/src/pipeline/types.ts` — no schema change; `CommitRecord.evidence` already
  exists. Touched only if a doc comment needs updating once the producer exists.

### Tests first (red → green)
- `packages/harness/src/pipeline/steps/commit.test.ts` already has an `evidenceEvent()` fixture
  (shape: `source: 'practice'`, `weight: 1`) — extend with a case: `commit` step forwards a
  populated `record.evidence` to `profiles.applyEvidence` unchanged (this already passes; keep as
  regression anchor, do not need a new red test here).
- New/extended `packages/harness/src/pipeline/runner.test.ts` (or nearest existing runner-level
  integration test file): a scripted turn sequence — serve a practice item with a known `topicId`,
  answer correctly — asserts the returned `CommitRecord.evidence` contains one `EvidenceEvent` with
  that `topicId`, `correct: true`, `source: 'practice'`, `weight: 1`. A second case: a wrong answer
  produces `correct: false`. A third case: a non-practice skill turn (e.g. `explain_check`)
  produces no evidence. Write these failing first (no producer exists yet), then implement.
- `packages/harness/src/pedagogy/helpState.test.ts`: `copyHelp`/`practiceFields` carry
  `practiceTopicId` through, same as `practiceModuleId`.

### Gate commands
```
corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...
```
(`@edmate/harness` is a leaf package with no exported-type change — `IssuedItem`/`HelpState` are
internal, not re-exported from `packages/contracts` — so no dependent package needs re-gating.
Confirm by grep before merge: `IssuedItem` and `practiceTopicId` must not appear outside
`packages/harness/src`.)

### Reviewers
code-reviewer (required, risky `pedagogy/**` path), typescript-reviewer (default).

### Budget
Phase A: 45 tool calls (1 phase, `@edmate/harness` only — 4 files, 1 package, no new guard/adapter).

## Phase B — real session-end trigger (`@edmate/web`)

### Files touched
- `apps/web/app/api/sessions/[id]/end/route.ts` (new) — `POST`: resolves the session, loads recent
  transcript via `transcripts.history(sessionId, limit)` (`TranscriptStore` port, already available
  per-scope through `depsFor(scope)`), calls `summarizeSession`, then `sessions.end(sessionId,
  summary)` (6.4/6.5a's existing method — no repository change). No path here matches
  `risk-paths.txt` (not under `app/api/auth/**`, `app/api/webhooks/**`, `app/api/staff/**`,
  `app/staff/**`, `src/auth/**`, or `packages/db/src/repositories/**`, since no repository file is
  edited). Gateway use for the summary call follows the `styleCardRuntime.ts` precedent — a bare,
  unmetered `Pick<ModelGateway,'generateObject'>` hook outside the turn-billing pipeline (see Open
  Questions).
- `apps/web/src/turn/routes.ts` — widen the `TurnBackend` interface to include `sessions.end` (the
  real runtime object, `apps/web/src/turn/runtime.ts`, already carries the full `sessionsRepo`
  including `.end`; this is a type-only widening, not a behavior change).
- `apps/web/src/chat/EndSessionButton.tsx` (new) — small component, same size/pattern as the
  existing `apps/web/src/chat/ReportButton.tsx`: a button that calls the new route, then lets the
  existing `loadChat.ts` reload path handle the ended session (it already treats `endedAt !==
  null` as a fresh/empty chat load — no new client-side "ended" state needed).
- `apps/web/src/chat/ChatView.tsx` — wire `EndSessionButton` next to `ReportButton` (same mount
  point, ~line 319-358 per 6.4's reading of this file).

### Tests first (red → green)
- New `apps/web/app/api/sessions/[id]/end/route.test.ts`: scripted gateway + fixture transcript —
  POST ends the session and the stored summary matches `summarizeSession`'s output (write failing
  first: no route exists yet).
- `apps/web/src/chat/EndSessionButton.test.tsx`: renders, calls the route on click, no PII in any
  rendered text.
- Existing `apps/web/src/turn/routes.test.ts` (if present) or an equivalent: `TurnBackend`'s wider
  interface still satisfies every existing caller (type-level, caught by typecheck).

### Gate commands
```
corepack pnpm turbo run typecheck lint test --filter=@edmate/web...
```

### Reviewers
code-reviewer, typescript-reviewer (default; no risky path matched in Phase B).

### Budget
Phase B: 50 tool calls (1 phase, `@edmate/web` only — 4 files, 1 package, one new route +
one new UI hook, under the 8-file/2-package phase-split threshold on its own).

## Combined

## Budget
Budget: 95 tool calls (2 phases, @edmate/harness + @edmate/web)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (typecheck/lint/test and secret scan only)

## Exit conditions
Status: DONE when both phases' gate commands pass green and both test files added in "Tests
first" exist and pass. Status: PARTIAL if either phase passes ~60 tool calls without reaching
green, or if a file outside this plan (e.g. `learner.ts`, `teacher-profiles.ts`, `takedowns.ts`,
any `app/staff/**` or `app/api/staff/**` path) turns out to need changes — stop and hand back
rather than touch it.

## Open questions (with recommendation)

1. **Which `Attempt` values emit evidence?** `'correct'` and `'wrong'` only, or also `'partial'`?
   Recommendation: `'correct'`/`'wrong'` only. `classifyAttempt`'s `'partial'` is a steering signal
   mid-ladder, not a settled graded outcome; including it risks noisy mastery updates. Revisit once
   an eval shows it matters.
2. **Does evidence cover only the `practice` skill, or also `explain_check`?**
   Recommendation: practice only (`source: 'practice'`) for 6.4a. `explain_check`'s grading is a
   comprehension nudge, not a topic-mastery check; `source: 'check'`/`'rubric'` evidence is a
   separate, larger task (feedback/rubric topic tagging doesn't exist yet) — defer.
3. **Fixed `weight: 1` vs. BKT-aware weighting per event?**
   Recommendation: fixed `weight: 1` now. Confirmed via `memoryPorts.ts`'s comment and
   `learner.ts`'s plain propagation of `weight` through `append`/fold queries that BKT math is the
   db adapter's responsibility, not the producer's — the harness side should stay a dumb, honest
   signal.
4. **Session-end summarization: unmetered bare gateway (styleCardRuntime precedent) or billed
   through `gatewayFor`/entitlement?**
   Recommendation: unmetered bare gateway, same shape as `styleCardRuntime.gateway()`. Ending a
   session is a housekeeping action, not a teaching turn; billing it through the turn-entitlement
   path would need an entitlement lookup with no natural turn to attach it to.
5. **Is the Phase B "End session" UI button in scope now, or cut to a tiny follow-up (6.4b) if
   Phase B runs over budget?**
   Recommendation: keep it in scope (it's the acceptance line's only user-visible proof the trigger
   is "real"), but it's the first thing to cut to PARTIAL/6.4b if Phase B is over ~50 calls with
   the route/tests not yet green — the API route alone still satisfies "a real trigger ends a
   session with a stored summary" for a manual/ops trigger.

## Lead answers (27 Oct 2026)

- **Q1–Q3:** as recommended (correct/wrong only; practice only; fixed weight 1).
- **Q4:** unmetered for the pilot, as recommended. Cap the transcript passed to `summarizeSession` with a fixed `limit` constant, so one call per session stays small.
- **Q5:** keep the button in scope; it is the first cut if Phase B runs over.
- **Phase B, authorisation (required):** the end route follows the pattern of `apps/web/app/api/sessions/[id]/reports/` for the signed-in user and the session-owner check: only the student who owns the session can end it. Anyone else, or a missing session, gets the same 404. Ending an already-ended session is a no-op success (it does not re-summarise or overwrite the stored summary). Tests cover owner, non-owner, unknown id, and a second end. Add security-reviewer to Phase B's reviewers.
- **Phase B, failure:** if `summarizeSession` fails, do not end the session silently without a summary unless 6.4's code already defines that fallback; follow whatever 6.4 did and say which in the handoff.
- Phases run as separate builders on one branch, `m13/6.4a-session-end`: Phase A now; Phase B after Phase A is pushed. Never rebase; `git merge --no-edit origin/main` if needed.
- Gate dependents: Phase A runs `--filter=...@edmate/harness` (the dependents form), not just the leaf.
