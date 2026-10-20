Status: PARTIAL

Phases B (registry/tool wiring), C (full-turn leak proof) and D (prompt-pack change) remain. This
task delivers Phase A only: pure logic, no pipeline wiring, per the plan.

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

## Left to do (Phases B-D)

- Phase B: wire a `PracticeBank`-backed tool into the registry/tool loop (likely a thin
  `RegisteredTool` wrapper around `pickItem`/`validateItem`), default to `demoPracticeBank()`.
- Phase C: the full-turn leak proof using the shared `answerKey.ts` matcher over model-visible
  turn context (not just the item's own prompt).
- Phase D: the prompt-pack change the plan's Decision 2 flags as a blocker (how/when the model is
  told to call the practice tool and told never to say the key) — needs an ADR-adjacent product
  decision before Phase D starts, per the plan.
