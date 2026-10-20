Status: DONE

Phases A, B and C are done. Branch `m5/5.6-practice-skill` (built in worktree
`.claude/worktrees/agent-a0dfc7f1f5312916b` as local branch `work-5.6c`). The pack
`practice@1.1.0` and `set@1.1.0` are on disk with `reviewed_by: pending`: they need the named
human's sign-off (B-26) before merge, and see the open question on restated sums (Phase C,
"Open question for the lead") below.

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

### Phase A decisions

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

### Phase B decisions

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

## Phase C

Pipeline wiring, the full-turn leak proof, the ADR and the pack (ADR-0010; the architect review
of 20 Oct 2026 as accepted by the lead). No `packages/contracts` change; the harness imports only
contracts, zod, mathjs and its own modules.

### Acceptance evidence

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness... --filter=@edmate/evals... --filter=@edmate/content --filter=@edmate/db --force --concurrency=1`
  → harness 106 files / 4702 tests passed, coverage thresholds met (100% for pedagogy, guardrails,
  access, tools); evals 17 files passed; content 19 files passed; db 37 files passed; lint 0
  errors (1 pre-existing warning in `route.accuracy.test.ts`, not touched).
- Leak and locked eval suites: `vitest run src/leakFixtures.test.ts src/lockedFixtures.test.ts`
  (packages/evals) → 2 files, 123 tests passed.
- `python3 .githooks/secret-scan.py --all` → clean (no output).
- `python3 docs/adr/check-headings.py docs/adr` → rc 0.

Must-hold, each with its test:
1. Same-turn gating: `toolLoop.ts` calls the tool's `issuedItem` hook (server-side key lookup by
   item id) right after a checked output; `steps/generate.ts` adds the key to the live
   `mustNotReveal` list, the stream gate (`StreamGate.addKeys`) and `practiceAnswerKey` (the
   union); `runner.ts` adds every issued key to postGuard's decision. Tests:
   `streamGate.test.ts` (addKeys), `toolLoop.test.ts` (issued items),
   `runner.practiceAnswerKey.test.ts` (`practiceAnswerKey` is `[key]`).
2. Saved on every outcome: the runner collects issued items through `onPracticeItem` and writes
   `next.help` (answerKey = union, rung 0, stuckTurns 0, attemptLogged false, pendingCheck false,
   practiceItemId, practiceModuleId, practiceServed) on ok, error, retry and postGuard escalate.
   Tests: "saved on every outcome" block.
3. Practice cap: `ladder.ts` uses the practice ceiling whenever `holdsPracticeKey(help)`;
   `policy.ts` also keeps the key in `mustNotReveal` for a solution move then (defence in depth).
   Test: `policy.test.ts` "a practice item: a forced solution move is capped at the worked
   example, key held" (coach skill, finalAnswers allowed, rung 3 → worked_example, at_ceiling).
4. Full-turn leak test (`runner.practiceAnswerKey.test.ts`, 12 tests, scripted gateway): for a
   bank item and a generated item the key is in no main-tier model request (the item prompt
   stripped), no token event, not the reply and not the trace; the model echoing the key on the
   issuing turn is held by the gate and the reply is the safe hint; a retry guards the earlier
   attempt's key from its first word.
5. ADR and pack: `docs/adr/0010-practice-items-from-tool.md` (0010 was free on main; 0009 is
   3.11d's, in review); `content/prompt-packs/practice@1.1.0.md` (copied from the draft,
   `reviewed_by: pending`); `content/prompt-packs/set@1.1.0.yaml` (practice 1.1.0, everything
   else unchanged, `reviewed_by: pending`); `set@1.0.0.yaml` untouched; seed
   `PROMPT_PACK_VERSION` → 1.1.0 (+ `packages/db/test/seed.test.ts`); content snapshot test moved
   to set 1.1.0 (only the practice pack text changed in the snapshot).
   Pending packs: the loaders (content `readPromptPackLibrary`, harness `resolvePromptPackSet`)
   accept any non-empty `reviewed_by`, so `pending` validates and loads. No other pack on disk is
   pending today, so there was no precedent of failing validation; nothing blocks a pending pack
   from being used. Reported here rather than changed (the sign-off gate is the merge gate/B-26).
6. No contracts change (`git diff origin/main -- packages/contracts` is empty).

### Changes (packages/harness/src unless noted)

- `pedagogy/helpState.ts`: optional `practiceItemId`, `practiceModuleId`, `practiceServed`
  (max 20 ids, 200 chars each); `holdsPracticeKey`, `practiceFields`; `copyHelp` copies the list.
  An old blob parses unchanged.
- `pedagogy/ladder.ts`, `pedagogy/policy.ts`: practice cap while a key is held.
- `pipeline/tools.ts`: harness-internal `RegisteredTool.forSession` and `issuedItem`,
  `ToolSessionState`, `IssuedItem` (exported from `pipeline/index.ts`).
- `tools/practice.ts`: `exclude` option, `forSession`, `issuedItem` (module = the allowed module
  the id resolves in; no or empty key → undefined, so the call fails closed).
- `pipeline/generate/streamGate.ts`: `addKeys` on the answer-leak gate; a gate with no keys yet
  but able to grow shows text as it comes.
- `pipeline/generate/toolLoop.ts`: `no_answer_key` fail reason; `mustNotReveal` read live.
- `pipeline/steps/generate.ts`, `pipeline/types.ts`, `pipeline/results.ts`:
  `GenerateResult.practiceAnswerKey`; `practice`, `issuedKeys`, `onPracticeItem` inputs; a live
  served list so a second call or a retry serves a new item.
- `pipeline/runner.ts`: issued-item collection, postGuard keys, `withPractice` save,
  fail-closed stop flag when the stored state was unreadable.
- Tests: `helpState.test.ts`, `policy.test.ts`, `streamGate.test.ts`, `toolLoop.test.ts`,
  `practice.test.ts`, new `pipeline/runner.practiceAnswerKey.test.ts`.
- Docs/content: ADR-0010, `practice@1.1.0.md`, `set@1.1.0.yaml`, seed, content snapshot.

### Deviations

- The skill event's payload is checked against the keys guarded before its own item, not its
  own key: the item's prompt was checked against its own key when it was made (`validateItem`),
  and a generated "What is 3 + 4?" would otherwise always drop its own event (see below).
- The generator ignores the exclude list: after the module's bank items are served, the same
  generated item (one per module and level) repeats. Fine for the pilot; noted for 5.11.
- "Where the item event went out" is implemented as "the checked tool output reached the model",
  a superset (an item is saved even if its skill event was then dropped). Safer: its key is held.

### Open question for the lead (needs a human answer; B-28 to add to `.claude/blockers.md`)

The answer matcher evaluates arithmetic, so a reply that restates a generated sum item ("What is
3 + 4?") counts as revealing "7". practice@1.1.0 says "show the item exactly as the tool returns
it", so for generated sum items the gate trips and the student gets the safe hint instead of the
reply (fail closed, no leak, but practice is unusable for generated items). Bank items worded as
equations ("Solve for x: ...") are not affected. Test: "a model that restates an arithmetic item
is held too (matcher false positive, fail closed)". Options: (a) pack wording before sign-off:
"the app shows the item; don't repeat it, invite an answer"; (b) a matcher follow-up (5.6b) that
ignores text equal to the issued item's own prompt; (c) both. Recommendation: (c). I could not
write `.claude/blockers.md` from the worktree, so the lead should add it as B-28.

## Decisions

Phase A and B decisions are the bullets under "Phase A decisions" and "Phase B decisions" above (all risk: low); copy them to the log with these.

### 20 Oct 2026 · 5.6 Practice items come only from practice.next_item; keys stay on the server (ADR-0010) · decided by lead (architect review accepted) · risk: high
Decided: ADR-0010 as written: the pack practice@1.1.0 routes every item through the tool, a new set@1.1.0 pins it (set@1.0.0 unchanged), the key is looked up on the server by item id and never reaches the model on the issuing turn or the client, it is saved in HelpState on every outcome, and a held practice key caps the ladder at the practice ceiling. No contracts change.
Why: a model-written item's answer cannot be protected; this is Decision 1 of the 5.6 plan, reviewed by the architect and accepted by the lead.

### 20 Oct 2026 · 5.6 New keys reach the stream gate mid-attempt through addKeys, not the decision · decided by tdd-guide
Decided: generate keeps a live list of guarded keys; an issued item's key is added to it and to the gate (`StreamGate.addKeys`), and postGuard gets the union from the runner. The decision that is composed and saved is unchanged.
Why: putting the key in the decision would put it in the model's prompt on the issuing turn (compose renders `mustNotReveal`).

### 20 Oct 2026 · 5.6 An item whose key can't be found fails the tool call closed · decided by tdd-guide
Decided: a new tool fail reason `no_answer_key`; the model sees only `failed` and the pack's "no item ready" path applies.
Why: the model must never see an item whose key the harness can't protect.

### 20 Oct 2026 · 5.6 The skill event is checked against earlier keys only · decided by tdd-guide
Decided: an item's own `skill` payload is checked against the keys guarded before it, not its own key.
Why: its prompt was already checked against its own key when made, and the arithmetic matcher would drop every generated sum item's event.

### 20 Oct 2026 · 5.6 Practice fields ride along like groundingAsks; served list capped at 20 · decided by tdd-guide
Decided: the runner carries the loaded practice fields onto every saved state (decide rebuilds the help state without them); the served list keeps the last 20 ids; a second call or a retry in the same turn serves a new item.
Why: same pattern as 4.7's groundingAsks; a bounded list keeps the blob small.

### 20 Oct 2026 · 5.6 Unreadable stored state plus an issued item saves the state stopped · decided by tdd-guide
Decided: when the stored help state couldn't be read but an item went out, the runner still saves the new state (with the key) and sets `lockedStopped: true`.
Why: the key must be saved; an unknown stored stop flag is treated as set (fail closed), as 4.6b does.

### 20 Oct 2026 · 5.6 Pending prompt packs load; reported, not changed · decided by tdd-guide
Decided: practice@1.1.0 and set@1.1.0 are committed with `reviewed_by: pending`; the loaders accept it and no validation fails. Nothing was changed in the loaders.
Why: no other pending pack exists to set a precedent; the sign-off is B-26 and the merge gate.
