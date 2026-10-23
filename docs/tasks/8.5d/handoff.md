# 8.5d — preview ports and small fixes deferred from 8.5b review

**Status:** DONE

## What changed

Five fixes deferred from the 8.5b review:

1. **MEDIUM — preview turns write no student state.** `apps/web/src/studio/testChat/deps.ts`:
   `testChatDepsFor` now wires `entitlementSource: 'teacher_preview'` deps with a no-op
   `profiles` (`ProfileStore`) and `teacherQuestions` (`TeacherQuestionStore`) in place of the
   real `@edmate/db`-backed ones. `previewProfileStore()` always returns a fresh, unmoved
   profile and never calls `applyEvidence` on any repository; `previewTeacherQuestionStore()`
   fabricates an in-memory `open`ed question (`tq_preview_<uuid>` id) and `findSimilar` always
   returns `[]`. A preview turn's `ask_teacher` or grounding escalation now completes normally
   for the teacher but writes no `teacher_questions` row and no learner-profile/evidence row.
2. **LOW — shared `readJson`/`TOO_LARGE`.** `apps/web/src/turn/routes.ts` now exports
   `readJson` and the `TOO_LARGE` symbol (previously module-private); `testChat/routes.ts`
   imports both instead of keeping its own copy. No behaviour change in `turn/routes.ts`.
3. **LOW — route-level usage-ledger-source test.** `testChat/deps.test.ts` has a test that
   calls `testChatDepsFor` over memory repos, captures the BullMQ job `usage.add` sends, and
   asserts `source: 'teacher_preview'`.
4. **LOW — `teacherScope()` helper.** `postCorrection` now builds its scope with
   `teacherScope({ teacherId: principal.userId }, 'postCorrection')` instead of a bare object
   literal.
5. **LOW — `CorrectionSchema` field max.** Each text field (`question`, `badAnswer`,
   `correctedAnswer`) now has `.max(LIMITS.turnTextMaxLength)`, matching the existing
   server-side `TEACHER_NOTE_PART_MAX` bound (`packages/harness/src/pipeline/teacherNote.ts`).
   A boundary test in `routes.test.ts` checks exactly-at-bound (201) vs one-over (400, no write).

### `configuredMarket` — not exported from `turn/runtime.ts` (deviation, see Decisions)

Item 2 of the brief asked for `readJson`/`configuredMarket` to be exported "from
`apps/web/src/turn` (its index or the module that owns them)". `readJson`/`TOO_LARGE` moved
cleanly (they already lived in `turn/routes.ts`). `configuredMarket` could not move into
`turn/runtime.ts`: that file has a dedicated safety-invariant test
(`src/deploy/stack-config.test.ts`) asserting its *source text* never contains the string
`EDMATE_MARKET`, so that no student turn can ever read a market from the environment (9.4a —
each student's market comes from `users.market`, never an env var). Adding `configuredMarket`
there broke that test. Instead `configuredMarket` now lives in a new file,
`apps/web/src/turn/previewMarket.ts` (still inside `apps/web/src/turn/**`, so inside the
brief's allowed path), and `testChat/runtime.ts` imports it from there. See Decisions.

## Evidence

```
$ corepack pnpm turbo run typecheck lint test --filter=@edmate/web --force
 Tasks:    10 successful, 10 total
Cached:    0 cached, 10 total
  Time:    1m35.897s
 Test Files  146 passed | 4 skipped (150)
      Tests  2222 passed | 26 skipped (2248)
```

(An earlier run of the same gate showed 4 flaky test-file timeouts under parallel load —
`src/auth/age.test.ts`, `src/auth/index.test.ts`, `src/auth/route-coverage.test.ts`,
`src/turn/runtime.test.ts` — unrelated to this task's files; re-running those four files in
isolation passed 101/101, and the full gate above is clean.)

```
$ python3 .githooks/secret-scan.py --all
(no output — clean)
```

Narrow runs during development, for reference:
- `src/studio/testChat/deps.test.ts` — 7 passed
- `src/studio/testChat` directory — 76 passed
- `src/turn` directory typecheck — clean after the `previewMarket.ts` fix

## Left to do

None for this task's scope. Board follow-ups only (not blocking this task):
- None identified beyond the existing 8.5b follow-ups already tracked on the board.

## Decisions

### 23 Oct 2026 · `configuredMarket` moved to a new `turn/previewMarket.ts`, not `turn/runtime.ts` · decided by builder · risk: low
- Decided: export `configuredMarket` from a new file `apps/web/src/turn/previewMarket.ts`
  (still under the brief's allowed `apps/web/src/turn/**` path) instead of adding it to
  `apps/web/src/turn/runtime.ts` as the brief's wording suggested.
- Why: `turn/runtime.ts` has a 9.4a safety-invariant test
  (`src/deploy/stack-config.test.ts`) that textually scans the file and fails if the string
  `EDMATE_MARKET` ever appears in it, so that the student turn runtime can never read a market
  from the environment by accident — only `users.market` picks a student's market. Adding
  `configuredMarket` (which reads `env.EDMATE_MARKET`) to that file broke the test. A new,
  clearly-commented file keeps the invariant intact while still only touching `apps/web/src/turn/**`.
- risk: low — no behaviour change; `testChat/runtime.ts`'s import path changed, no other caller existed.

### 23 Oct 2026 · usage-ledger-source test is a unit test on `testChatDepsFor`, not a full HTTP route test · decided by builder · risk: low
- Decided: implement brief item 3 as a focused test in `deps.test.ts` that calls
  `testChatDepsFor` directly and exercises `.usage.record()`, rather than a full
  `postTestTurn` HTTP-route integration test.
- Why: a true route-level test needs a `Repositories` double providing
  `transcriptStoreFor`/`turnConfigStoreFor`/`retrievalIndexFor`'s DB-backed inputs; no
  in-memory `Repositories` double exists anywhere in the codebase today, and building one was
  out of scope for this task's budget. The unit test still proves the exact thing the brief
  asked for: a preview turn's usage job carries `source: 'teacher_preview'`.
- risk: low — test-only; does not change what ships.

Tool calls used: 82
