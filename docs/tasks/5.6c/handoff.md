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

## Phase C

Status: DONE.

Scope: items 9 and 10 (ingest bank refusal hardening), `packages/ingest` only, no risky paths.

Changes:
- `packages/ingest/src/answerBank.ts`: title and text are folded (NFKC, then `\p{Cf}` dropped)
  before every check. `namesABankPath` compares path segments and the `.yaml`/`.yml` suffix
  case-insensitively. `hasBankShape` runs a line-anchored check (`hasBankShapeInLines`) when raw
  source text is given: a key must start its own (trimmed) line, after an optional `- ` list
  marker and an optional quote. When raw text is not available (PDF, DOCX, slides), it falls back
  to the previous word-boundary check over the parsed units' joined text. `assertNotAnswerBank`
  gains an optional third `rawText` parameter; its public contract and thrown error are unchanged.
- `packages/ingest/src/index/indexDocument.ts`: decodes the markdown source's raw bytes (stripping
  a leading BOM) and passes that text through to `assertNotAnswerBank` as `rawText`. No other
  source kind (`parsed`, `video`, pdf/docx/pptx `DocumentInput`) has raw lines available at this
  call site, so they keep the units-only fallback, as the plan allows for Q8.
- `packages/ingest/test/answerBank.test.ts`: `CONTENT_ROOT` now comes from
  `new URL('../../../content/demo-teacher/', import.meta.url)` instead of a cwd-relative string.
  Added: the real demo bank files refused under the neutral title `notes.md` (proves the shape
  rule, not just the title rule); quoted YAML keys; a space before the colon; a zero-width
  character inside a key; a fullwidth `question:`; an indented list-item key; prose mentioning
  "question:"/"answer:" mid-sentence (now passes); title case-insensitivity
  (`Question-Bank/x.md`, `RUBRIC-ANSWERS\x.md`); a `.yaml` suffix with a trailing zero-width
  character. Two tests document the remaining 8.x gaps (compact JSON-array bank, markdown-table
  bank) with an inline comment — neither is refused by design.

Deviations from plan: none. Q8 resolved as "use raw lines" (markdown's raw bytes are available at
the `indexDocument` call site with one small call-site change, as anticipated).

Gate:
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/ingest...` → 14/14 tasks green;
  `@edmate/ingest:test` 18 files, 307 tests passed; coverage `answerBank.ts` 100/92.85/100/100,
  `indexDocument.ts` 100/92.85/100/100 (all above the package's 80% gate; the few uncovered
  branches are defensive fallbacks already exercised by other tests at the file level).
- `python3 .githooks/secret-scan.py --all` → clean.

Left to do: none for Phase C.

## Phase B
Status: DONE (practice keys out of the prompt, the carried key, the `assemble` allow-list, expectNoLeak widening; risky paths `packages/harness/src/pedagogy/**` and `docs/adr/**`).
Built by tdd-guide in its own auto worktree (branch `work-5.6cB`, pushed to `m5/5.6c-practice-followups`).

### Acceptance evidence
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...` → `Tasks: 10 successful, 10 total`; harness `Test Files 108 passed (108)`, `Tests 4840 passed (4840)`.
- Coverage: `pedagogy/helpState.ts`, `pedagogy/policy.ts`, `pedagogy/compose.ts`, `pipeline/assemble.ts` 100%. `pipeline/runner.ts` uncovered lines 324 and 1204 are untouched code; `steps/buildContext.ts` 71-72 as before.
- `python3 docs/adr/check-headings.py docs/adr` → clean. `python3 .githooks/secret-scan.py --all` → clean.
- **No practice key in any model request** (`runner.practiceAnswerKey.test.ts`, "acceptance: no request on any tier (main, fallback, small) holds the key"): a later turn with a loaded practice key, the real `decide` (fixture packs), the real route (its small-tier intent model), a failed primary and a fallback attempt, and grounding's judge. No captured request holds the key, and none has a `[[DO-NOT-SAY]]` section. A control test shows the same turn with a non-practice key still renders it (so the turn really teaches). When the scripted model writes the key, the reply is the safe hint.
- **Skipped item** ("a skipped item key is carried one turn"): turn 1 loads A and issues B. It saves `answerKey: [B]` and `practiceCarriedKey: [A]`, and `classifyAttempt` grades B correct and A wrong. Turn 2 (real decide): writing A gives the safe hint, the main requests hold neither key, and the saved state has no carried key.
- **expectNoLeak (7)**: it takes every issued key (saved `answerKey` plus every attempt's generate keys) and scans the skill events and the trace. On turns where the model never writes the key, it scans every request on every tier, including the fake judges and route's `generateObject` requests. The echo test stays main-tier only, with a comment (ADR-0011 §5).
- **assemble (8)** (`pipeline/assemble.test.ts`): the allow-list equals `TurnContextSchema`'s keys. A BuiltContext with every optional field set assembles to the real context, and `helpState`, `helpStateUnreadable` and `answerKeyDropped` never enter it. Through the runner, an unreadable help state gets the real context (its history, trace `buildContext: ok`) with `retrieved: []`, holds the whole reply (one token event) and saves no state.

### Changes
- `docs/adr/0011-practice-keys-out-of-the-prompt.md` (new): the draft text word for word. `docs/adr/0010-practice-items-from-tool.md`: Status "Proposed. Amended by ADR-0011."; its do-not-say Consequences bullet now points to ADR-0011.
- `pedagogy/helpState.ts`: optional `practiceCarriedKey` (at most `PRACTICE_CARRIED_MAX = 64`). `parseSessionHelp` and `copyHelp` keep it; `practiceFields` and `holdsPracticeKey` ignore it.
- `pedagogy/policy.ts`: `PolicyResult.promptKeys`. One helper, `keysFor`, serves `finish` and both `fallbackPolicy` branches. `mustNotReveal` = `answerKey` (dropped only by a released solution) ∪ the carried key, which is never released. `promptKeys` is empty while a practice key or any carried key is held; otherwise it is a copy of `mustNotReveal`.
- `pedagogy/compose.ts`: the do-not-say block renders `promptKeys` only. `decide.ts` is unchanged: it still copies the full `mustNotReveal`.
- `pipeline/runner.ts`: `withPractice` sets `practiceCarriedKey` only on an issuing turn whose loaded state `holdsPracticeKey`: the loaded `answerKey` minus this turn's keys, left out when empty. It removes the field explicitly from every other saved state, including the issuing branch's `...base.help` and the no-issue branch. `assemble` moved to the new `pipeline/assemble.ts`.
- `pipeline/assemble.ts` (new): `TURN_CONTEXT_KEYS` from `TurnContextSchema.shape`, plus a compile-time check that Entitled, BuiltContext, `intent` or `attempt` supplies every TurnContext key. An unreadable help state forces `retrieved: []`.
- `pipeline/steps/buildContext.ts`: the one line the lead allowed. Chunk dropping reads `answerKey` plus `practiceCarriedKey`.
- Tests: `helpState.test.ts`, `policy.test.ts`, `compose.test.ts` (its `policy()` helper defaults `promptKeys` to `mustNotReveal`), `buildContext.test.ts` (a carried key drops a chunk; a short-number carried key keeps the exemption), `runner.practiceAnswerKey.test.ts`, `assemble.test.ts`, and a comment in `runner.answerKeyContext.test.ts`.

### Deviations
- ADR-0011 (word for word) and the lead's note both say ADR-0010 "Consequences bullet 1". In ADR-0010 the do-not-say text is the **second** bullet; the first is about topics with no item. I put the ADR-0011 pointer on the do-not-say bullet and left the ADR-0011 text unchanged. The architect may want to fix "bullet 1" in ADR-0011.
- `assemble` also forces `retrieved: []` when `helpStateUnreadable` is set. The real buildContext already does this; the extra check also covers a step that does not (see Decisions).
- `assemble` moved out of `runner.ts` into `pipeline/assemble.ts`, so it can be unit-tested.
- Route's `generateObject` requests are not recorded by the spy gateway. The acceptance test wraps the real route step's gateway to capture them (test-only).
- The handoff Phase C pushed had replaced Phase A's section and decisions. I put them back from the Phase A commit. Phase C's text is unchanged.

### Open points
- ADR-0011 is `Proposed` and needs architect, security-reviewer and typescript-reviewer, plus code-reviewer for `pedagogy/**`. Fix "bullet 1" if the architect agrees.
- Out of scope, as the ADR says: the small-tier rewrite of a draft in which the model wrote the key (a `guardrails/**` change).

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

### 20 Oct 2026 · 5.6c Ingest bank refusal folds title and text, matches more key forms, raw-line shape check · decided by tdd-guide
Decided: `assertNotAnswerBank` NFKC-folds and strips zero-width/format characters from the title
and the checked text before every check; the title rule matches path segments and the YAML suffix
case-insensitively; the shape rule runs on raw source lines (key must start its own line) when the
caller has them, with a fallback to the looser word-boundary check over parsed units when it does
not (PDF, DOCX, slides). `indexDocument` passes a markdown source's decoded raw bytes through so
the line-anchored rule applies there; other source kinds keep the fallback.
Why: 5.6a's security review found the title and shape checks could be slipped by case, a
fullwidth letter or an embedded zero-width character, and the word-boundary shape check falsely
refused ordinary prose mentioning "question:"/"answer:" mid-sentence.
risk: medium

### 20 Oct 2026 · 5.6c Practice keys stay out of the prompt; a skipped item's key is guarded one more turn (ADR-0011) · decided by tdd-guide · risk: high
Decided: ADR-0011 is written to docs/adr word for word. The composer renders the do-not-say block from `PolicyResult.promptKeys`, which is empty while a practice key or a carried key is held. `mustNotReveal` keeps every key, so the stream gate, postGuard and the tool checks are unchanged. A skipped item's key is saved as `practiceCarriedKey` on the issuing turn only, is guarded on every move (a solution never releases it), is never prompted or graded, and is removed from every other saved state. buildContext drops chunks that hold it. Non-practice keys keep the 3.6 behaviour. No contracts, pack or set change.
Why: a key in the prompt can be spelled or written in roman numerals by an injected model, and the matcher can miss those forms (5.6 security-reviewer MEDIUM). A skipped item's answer was not guarded on the next turn (5.6 LOW).
risk: high

### 20 Oct 2026 · 5.6c assemble builds TurnContext from an allow-list; an unreadable help state gets the real context with no material · decided by tdd-guide
Decided: `assemble` (now `pipeline/assemble.ts`) copies only `TurnContextSchema`'s keys. A compile-time check fails the typecheck if a TurnContext key has no source. An unreadable help state no longer falls back to `fallbackContext`: it gets the real context with `retrieved: []` (forced in `assemble` too, as defence in depth) and a held reply, and saves no state.
Why: 5.6a typescript-review MEDIUM. A new runner-only BuiltContext field would have silently sent every turn to the fallback context. The lead accepted Q7.
risk: medium

### 20 Oct 2026 · 5.6c expectNoLeak scans every issued key, skill events and every tier · decided by tdd-guide
Decided: the practice runner tests check every key issued in the turn (the saved state plus every attempt's generate keys). They scan the trace and the skill events too. On turns where the model never writes the key, they scan every request on every tier, including the judges and route's intent model. Echo tests stay main-tier only (ADR-0011 §5).
Why: 5.6 review LOW. The old helper checked one key, main tier only.
risk: low
