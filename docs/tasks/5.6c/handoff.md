# 5.6c handoff: practice review follow-ups

Branch: `m5/5.6c-practice-followups`. Each phase writes its own section; decisions go under the single `## Decisions` heading at the end.

## Phase A
Status: DONE (bank and item checks, harness tools; no risky paths).
Built by tdd-guide in its own auto worktree (branch `work-5.6cA`, pushed to `m5/5.6c-practice-followups`).

### Acceptance evidence
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...` → `Tasks: 10 successful, 10 total`; harness `Test Files 107 passed (107)`, `Tests 4804 passed (4804)`.
- Coverage: `tools/practice.ts`, `tools/practiceItems.ts`, `tools/demoPracticeBank.ts`, `pipeline/generate/answerKeyContext.ts` all 100% statements and branches. `pipeline/steps/buildContext.ts` lines 71-72 (`mergeByScore`'s unscored-chunk branches) are uncovered as before; that logic was not touched.
- `python3 .githooks/secret-scan.py --all` → clean (no output).
- Acceptance 1 (other teacher, same module):
  - `demoPracticeBank.test.ts` "a pick for another teacher with the same module id returns nothing" and "answerKeyFor returns nothing for another teacher with the same module id";
  - `practiceItems.test.ts` "never serves another teacher's bank item with the same module id; the generator steps in" (a stub bank that ignores teacherId);
  - `practice.test.ts` "issuedItem: undefined for a bank id under another teacher's scope" and "run under another teacher with the same module never serves the bank item".

### Changes
- `packages/harness/src/tools/practiceItems.ts`
  - `PracticeItem.teacherId` (harness-internal; `toOutput` never copies it).
  - `servable` checks `item.teacherId === scope.teacherId`.
  - The generator sets `teacherId` from the scope.
  - New `parseGeneratedId`: one bounded parser (length cap, operands 1–999 with no leading zero, the level's own op, a non-empty `<moduleId>:practice` topic). `generatedAnswerKeyFor` uses it, and its comment now matches what the code guarantees.
  - `validateItem` rejects a key in any option (every kind) and a key in the id (short digit-only numbers exempt).
- `packages/harness/src/tools/practice.ts`
  - `GENERATED_TOPIC`/`generatedItemModuleId` are gone; the tool uses `parseGeneratedId(id)?.moduleId`.
  - `issuedItem` requires exactly one allowed module (deduplicated) to resolve the id.
  - The cap counts `heldKeys ∪ issuedKeys ∪ new key`.
  - The context helpers are imported from the new module.
- `packages/harness/src/tools/demoPracticeBank.ts`: `DEMO_PRACTICE_TEACHER_ID = 'tch_test_01'` on every record; `pick` and `answerKeyFor` check the teacher.
- `packages/harness/src/pipeline/generate/answerKeyContext.ts` (new): `contextAnswerKeys` and `chunkLeaks`, moved verbatim, with the short-number regex hoisted to a module constant (`SHORT_NUMBER`).
- `packages/harness/src/pipeline/steps/buildContext.ts`: imports the helpers and re-exports them for its own tests. No logic change.
- Tests:
  - `practiceItems.test.ts`, `practice.test.ts`, `demoPracticeBank.test.ts`: the new cases listed in the plan, plus the `teacherId` fixture fields.
  - `practice.test.ts`: the `target!`/`answerKey[0]!` non-null assertions are replaced with narrowing. The existing cap test now uses a one-module context, because a bank that resolves every id would now resolve it in both of `two`'s modules.
  - `runner.practiceAnswerKey.test.ts` and `runner.answerKeyContext.test.ts`: `RECORDS` gain `teacherId: 'tch_test_01'`.

### Deviations
- The id check exempts only a short whole number **written in digits**, not the matching number word. The plan's test list needs both `bank:one:a` with `['1','one']` rejected and `demo:fractions:1:a` with `['1','one']` accepted. 5.6a's `contextAnswerKeys` also exempts "one", so using it unchanged would accept `bank:one:a`. See Decisions.
- `parseGeneratedId` also rejects an empty module id (`gen::practice:1:3+4`). The plan did not list this case. The generator never makes such an id.
- The helpers' unit tests stay in `buildContext.test.ts` (through the re-export). The plan allowed this.

### Open points
- None for Phase A. Phase B's architect notes (carried key in buildContext's chunk drop, and so on) are in the plan and are not part of this phase.

## Decisions

### 20 Oct 2026 · 5.6c Practice items are teacher-scoped; demo bank teacher is tch_test_01 · decided by tdd-guide
Decided: `PracticeItem` carries a harness-internal `teacherId`. The demo bank's records all use `DEMO_PRACTICE_TEACHER_ID = 'tch_test_01'`, the contracts fixture teacher. The bank's `pick`/`answerKeyFor`, `pickItem`'s runtime check and the tool's `issuedItem` all refuse an item from another teacher, even when the module id is the same. Generated items take the scope's teacher.
Why: two teachers can use the same module id. Before this change, only the module was checked (5.6 review MEDIUM).
risk: low

### 20 Oct 2026 · 5.6c validateItem checks options and the id; only digit-written short numbers are exempt in the id · decided by tdd-guide
Decided: for every kind, an item is rejected when a key appears in any option, or in its id. The id check skips a key only when it is digits alone and 5.6a's short-number rule exempts it. Number words such as "one" are still checked against the id.
Why: the plan's tests need `bank:one:a` rejected and `demo:fractions:1:a` accepted, both with key `['1','one']`. Ids contain level digits and operands, so a digit check would refuse good items. A key written in words inside an id is a real leak.
risk: low

### 20 Oct 2026 · 5.6c One bounded generated-id parser; exactly one module; the cap counts held keys · decided by tdd-guide
Decided: `parseGeneratedId` is now the only reader of generated ids. It enforces the length cap, operands 1–999 with no leading zero, the level's own op, and a non-empty `<moduleId>:practice` topic. `issuedItem` fails closed unless exactly one allowed module resolves the id (duplicate allowed modules are folded first). The HelpState cap counts held, issued and new keys together.
Why: 5.6 review findings (unbounded operands, two parsers, the first-match module pick). The cap leaves room for Phase B's carried key.
risk: low

### 20 Oct 2026 · 5.6c Context helpers move to pipeline/generate/answerKeyContext.ts · decided by tdd-guide
Decided: `contextAnswerKeys` and `chunkLeaks` now live in `pipeline/generate/answerKeyContext.ts`, so tools no longer import a pipeline step. `buildContext.ts` imports and re-exports them, with no logic change. The short-number regex is a module constant.
Why: 5.6a typescript-review LOWs.
risk: low
