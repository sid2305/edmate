Status: PARTIAL

Phases A and B are done (item model/bank/generator, and the `practice.next_item` tool/registry).
Phase C (pipeline wiring, leak proof, ADR, pack move) and Phase D (prompt-pack sign-off) remain.

## Phase A

Files:
- `packages/harness/src/tools/practiceItems.ts` — item model (`PracticeItem`, `PracticeItemKind`
  including the new `code_output`), `PracticeBank`/`PracticeScope`/`LearnerPracticeProfile`, the
  deterministic numeric/arithmetic generator (seeded hash + LCG, no `Math.random`, arithmetic
  evaluated through 5.5's `evaluateExpression` sandbox), `generatedAnswerKeyFor` (recomputes a
  generated item's key from its id alone) and `validateItem` (answer-key-in-prompt leak check,
  local to this task — not a replacement for the shared `answerKey.ts` matcher Phase C will use).
- `packages/harness/src/tools/practiceItems.test.ts` — 26 tests.
- `packages/harness/src/tools/demoPracticeBank.ts` — a small in-memory fixture `PracticeBank`
  (test/Phase-B-default fixture only, never real teacher content).
- `packages/harness/src/tools/demoPracticeBank.test.ts` — 15 tests.

No pipeline, registry or routing files were touched (`pipeline/steps/route.ts`, `src/routing/**`,
`src/testing/gatewayFixtures.ts` stayed out of scope for task 3.3). `packages/contracts` was not
touched. All imports are `@edmate/contracts`/zod/mathjs/own modules only (none added here).

Test evidence (worktree root):
```
$ corepack pnpm --filter @edmate/harness exec vitest run \
    src/tools/practiceItems.test.ts src/tools/demoPracticeBank.test.ts
 Test Files  2 passed (2)
      Tests  41 passed (41)
```
Full gate:
```
$ corepack pnpm turbo run typecheck lint test --filter=@edmate/harness --force --concurrency=1
  src/tools  practiceItems.ts  100 | 100 | 100 | 100
  src/tools  demoPracticeBank.ts  100 | 100 | 100 | 100
 Tasks: 4 successful, 4 total
```
typecheck, lint and test (100% coverage on `src/tools/**`) all pass.

### Deviations / architect conditions

Mid-build, the lead relayed an architect review of Phase A's original design and asked that it be
applied now, in Phase A's files only, before completing this task. Applied in full:

1. **Scoped reads.** Every `PracticeBank` read now takes a `PracticeScope` (`{ teacherId,
   allowedModuleIds }`, mirroring `TurnContext.entitlement`'s scope shape, but kept harness-internal
   per Decision 1 — no `@edmate/contracts` change). `pick` and `answerKeyFor` both re-check
   `moduleId` against `allowedModuleIds`; the generator fails closed (`undefined`) when
   `allowedModuleIds` is empty rather than ever picking outside scope.
2. **The bank chooses the topic, never the caller.** `PracticeBank.pick` takes an optional
   `LearnerPracticeProfile` (`{ topics: { topicId, mastery }[] }`) and picks the lowest-mastery
   topic itself (untracked topics treated as weakest); the model/caller never names a topicId.
3. **Deterministic ids, server-only answer keys.** `PracticeItem` carries no answer key field at
   all. A key is obtained only via `PracticeBank.answerKeyFor(itemId, scope)` (bank items) or
   `generatedAnswerKeyFor(itemId)` (generated items — recomputed from the deterministic
   `gen:<topicId>:<level>:<a><op><b>` id, never stored).
4. **`mcq`/`code_output` modeled, never served.** Both stay as `PracticeItemKind` values (so the
   shape is representable once a real bank serves them), but `SERVABLE_KINDS` excludes both; the
   demo bank's `pick` filters on it, and a dedicated test
   (`demoPracticeBank.test.ts` → "never serves the mcq or code_output fixture records") proves
   neither is ever handed out. A second pair of tests in `practiceItems.test.ts` proves a bare MCQ
   option-text key or an un-exempted code_output key would trip the leak gate were either kind ever
   served carelessly (`validateItem`'s mcq option-text check; the `normaliseForMatch`-based test
   showing a code_output key is still "found" by the shared, kind-unaware matcher so any other call
   site keeps catching it).

This was a substantial rework from the plan's original single-struct `PracticeItem` (answer key
inline) design — the split cost two full rewrites of `practiceItems.ts`/`.test.ts` and
`demoPracticeBank.ts`/`.test.ts`, all still inside Phase A's file scope.

A related, self-found fix: the subtraction generator template can produce `a - b === b` (answer
equal to an operand) for about half of seeds; this is nudged once, deterministically
(`if (a - b === b) a += 1`), proven never to overflow `template.max` — no retry loop, no
uncoverable defensive branch.

## Decisions

- `keyInPrompt` (practiceItems.ts) is a narrow, local, boundary-aware "is this key a whole
  word/number in this prompt" check, built for self-validating one freshly generated or authored
  item. It is deliberately not the shared `answerKey.ts` matcher (`revealsAnswerKey`): that matcher's
  arithmetic-grounding feature produces false positives on "What is 2 + 2?"-style numeric prompts
  evaluated against their own numeric answer. Phase C's full-turn leak proof still uses the shared
  matcher over model-visible context; this check only guards the item's own prompt at creation time.
- `validateItem`'s empty-answerKey-form check now rejects on `normaliseForMatch(k) === ''` OR
  `k.trim() === ''` (not just the former): this keeps `keyInPrompt`'s own blank-key case truly
  unreachable (so it is not an untested, unguarded branch) rather than relying on the two checks
  always agreeing for every possible Unicode input.
- `demoPracticeBank.ts`'s `chooseTopic` takes `readonly [string, ...string[]]` (a non-empty tuple)
  rather than a defensive runtime throw on empty input: `pick()` already guarantees non-emptiness
  before calling it, so the empty case is now a type-level impossibility, not a dead runtime branch.
- `generatedAnswerKeyFor` no longer wraps `evaluateExpression` in a try/catch: `GEN_ID` only ever
  matches plain digit operands and one of `+ - *`, so evaluation can never throw there; the try/catch
  was unreachable defensive code failing the 100% coverage gate.

## Phase B

Status: DONE.

Files:
- `packages/harness/src/tools/practice.ts` (new) — `practiceNextItemTool(bank, opts?)`: a
  `RegisteredTool` named `practice.next_item`, skill `practice`. Input is strict
  `{ level?: 1|2|3 }` — no topic, no item id. Output is exactly `{ id, kind, level, prompt,
  options? }`, never `answerKey`: the field isn't in the output schema at all, so a model never
  sees it, by construction (not a strip-after-the-fact). `run` builds its `PracticeScope` only
  from `ctx.entitlement` (`teacherId`, `allowedModuleIds`), narrows it to one preferred module —
  this turn's top retrieved chunk, else an injectable `activeModuleId(ctx)` hook, else the first
  allowed module — then calls Phase A's `pickItem`. `present()` returns `{skill:'practice',
  payload: output}` (nothing to strip; the output never had the key). `answerKeyFor(itemId,
  scope)` is the architect's required server-side hook: bank items go through
  `bank.answerKeyFor`; generated items recover their module from the id's `<moduleId>:practice`
  topic slot (the shape `practiceItems.ts`'s `generateItem` always produces), re-check it against
  `scope`, then call `generatedAnswerKeyFor`. Returns `undefined` (fail closed) for any id outside
  scope or one neither source produced.
- `packages/harness/src/tools/practice.test.ts` (new) — 29 tests: strict-input table, the output
  schema's own rejection of an `answerKey` field, a 20-iteration-per-level loop asserting no
  serialized tool output or `present()` payload ever contains its own key (bank and generated
  items), `answerKeyFor` scope checks (in scope, wrong teacher/module, unknown id, bank item,
  generated item once the bank is empty), and a scope describe block proving the module-fallback
  order (top chunk → `activeModuleId` hook → first allowed) and that an out-of-scope chunk/hook
  module is never used.
- `packages/harness/src/tools/registry.ts` — `defaultToolRegistry(bank = demoPracticeBank(),
  practiceOpts?)` now lists `[calculatorTool, practiceNextItemTool(bank, practiceOpts)]`.
- `packages/harness/src/tools/registry.test.ts` — updated for two tools; added a "no coach or
  practice" entitlement case and a preview (no practice skill) case.
- `packages/harness/src/tools/index.ts` — re-exports `practice.ts` and `practiceItems.ts`'s public
  surface.

No `pipeline/**`, `pedagogy/**` or `packages/contracts` file touched. All imports stay
`@edmate/contracts`/zod/own modules.

Test evidence (worktree root):
```
$ corepack pnpm --filter @edmate/harness exec vitest run src/tools/practice.test.ts src/tools/registry.test.ts
 Test Files  2 passed (2)
      Tests  33 passed (33)
```
Full gate:
```
$ corepack pnpm turbo run typecheck lint test --filter=@edmate/harness... --force --concurrency=1
 Tasks: 10 successful, 10 total
  src/tools  calculator.ts / demoPracticeBank.ts / practice.ts / practiceItems.ts / registry.ts / sandbox.ts   100 | 100 | 100 | 100
```
typecheck, lint and test (global coverage gate, 100% on `src/tools/**`) all pass.
`python3 .githooks/secret-scan.py --all` is clean.

### Deviations

1. **No `topicId` in the model-visible output or input**, and no module/topic parameter on
   `preferredModule`'s inputs beyond `ctx`/`scope` — the plan's Phase B section (written before
   the architect review) had the model choosing/echoing a `topicId`; the task brief's "Must hold"
   list (quoting the architect's accepted review) overrides that: scope and module selection are
   entirely server-side, and the tool exposes neither.
2. **The "active item's module" fallback tier is a hook, not a real lookup.** `TurnContext`
   carries no active-item field today (HelpState, which Phase C will teach to record one, isn't
   part of `TurnContext` and isn't passed to a tool's `run`). Implementing this tier for real needs
   Phase C's HelpState change first. Phase B adds `PracticeToolOptions.activeModuleId?(ctx):
   string | undefined` as the seam Phase C wires up once that state exists; until then it is
   `undefined` by default, and `preferredModule` falls through to "first allowed module" — a
   documented gap, not a silent one, and every fallback tier is tested in that order.
3. **`exclude` is always `[]` in Phase B's `run`.** Per-session "don't repeat this item" tracking
   needs an item-id history, which (like the active-item hook) lives in HelpState — Phase C's
   concern. `pickItem`'s `exclude` parameter is already wired through so Phase C only has to supply
   the list.
4. **Default level is a fixed `1`** when the model omits `level` (tool input allows it to). Nothing
   in scope today (ctx, HelpState) suggests a better default; flagged for Phase C/pedagogy-author
   to revisit once a real level-progression signal exists.

### Decisions

- `answerKeyFor`'s generated-item branch recovers `moduleId` by reading back the `<moduleId>:practice`
  shape `practiceItems.ts`'s `generateItem` always builds its topicId from, rather than exporting a
  new helper from `practiceItems.ts` (Phase A's file, out of Phase B's file list). This is read-only
  parsing of an existing, already-tested id convention — it never recomputes or duplicates the key
  logic, which stays in `generatedAnswerKeyFor` alone. risk: low (local to this file, covered by
  tests asserting a wrong/foreign-looking id returns `undefined`).
- `defaultToolRegistry`'s new parameters (`bank`, `practiceOpts`) are both optional with the same
  defaults the plan specified (`demoPracticeBank()`), so every existing caller (3.9's CLI, any
  future composition root) keeps working unchanged — this is additive, not `risk: high` on its own,
  but is called out because `registry.ts` is a shared seam other tasks (5.7/5.8) will also touch.

## Left to do (Phases C-D)

- Phase C: `pipeline/types.ts`/`results.ts`'s `GenerateResult.practiceAnswerKey`, `generate.ts`'s
  capture via this task's `answerKeyFor` hook, `runner.ts`'s `next.help.answerKey` write (every
  outcome where the item event went out, per the architect's MEDIUM condition), the practice-cap
  enforcement while a key is held (Q-B), the full-turn leak proof
  (`runner.practiceAnswerKey.test.ts`), the ADR file (`docs/adr/0010-practice-items-from-tool.md`)
  and moving the pack to `content/prompt-packs/practice@1.1.0.md`. Phase C should also wire
  `PracticeToolOptions.activeModuleId` to the real HelpState active-item id once it exists, so
  Phase B's documented gap (Deviation 2) closes instead of staying a permanent no-op.
- Phase D: pedagogy-author's pack draft (already at
  `docs/tasks/5.6/practice@1.1.0.draft.md`) plus the named human's sign-off (B-26).
