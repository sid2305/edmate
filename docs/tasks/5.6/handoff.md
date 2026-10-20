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

### Phase A notes (logged under Decisions)

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

### Phase B notes (logged under Decisions)

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
  served list so a second call or a retry leaves out items already issued. (Corrected in the
  review fix round: as first built, the generator ignored that list, so once the bank items were
  served a second call got the same generated item, which then failed `answer_key`. See "Fix
  round (review)".)
- `pipeline/runner.ts`: issued-item collection, postGuard keys, `withPractice` save,
  fail-closed stop flag when the stored state was unreadable.
- Tests: `helpState.test.ts`, `policy.test.ts`, `streamGate.test.ts`, `toolLoop.test.ts`,
  `practice.test.ts`, new `pipeline/runner.practiceAnswerKey.test.ts`.
- Docs/content: ADR-0010, `practice@1.1.0.md`, `set@1.1.0.yaml`, seed, content snapshot.

### Deviations

- The skill event's payload is checked against the keys guarded before its own item, not its
  own key: the item's prompt was checked against its own key when it was made (`validateItem`),
  and a generated "What is 3 + 4?" would otherwise always drop its own event (see below).
- The generator ignored the exclude list: after the module's bank items were served, the same
  generated item (one per module and level) repeated. Fixed in the review fix round.
- "Where the item event went out" is implemented as "the checked tool output reached the model",
  a superset (an item is saved even if its skill event was then dropped). Safer: its key is held.

### Open question for the lead (answered)

Answered by the lead: (c). The pack wording is done in fed7d54 ("the app shows the item; don't
repeat it"); the matcher ignoring the issued item's own prompt, and its hint false positives, go
to follow-up task 5.6b.

Original question:

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

### 20 Oct 2026 · 5.6 An item's own prompt is checked with a narrow whole-word key check · decided by tdd-guide
Decided: `validateItem` uses `keyInPrompt` (practiceItems.ts), a boundary-aware "is this key a whole word or number in the prompt" check, not the shared `revealsAnswerKey` matcher, whose arithmetic grounding flags "What is 2 + 2?" against "4". Blank keys are rejected first. `chooseTopic` takes a non-empty tuple, and the unreachable try/catch around `evaluateExpression` was removed.
Why: the shared matcher would reject every generated sum item; the full-turn leak checks still use the shared matcher.
risk: low

### 20 Oct 2026 · 5.6 answerKeyFor reads the module id back from the generated item id; the registry takes an optional bank · decided by tdd-guide
Decided: `answerKeyFor` recovers the module id from the `<moduleId>:practice` id shape rather than a new export; `defaultToolRegistry` gets optional `bank` and `practiceOpts` defaulting to `demoPracticeBank()`, so existing callers are unchanged.
Why: read-only parsing of a tested id convention, kept in Phase B's file list; additive change to a shared seam (5.7 and 5.8 will touch it). The duplicated id regex is deferred to 5.6c.
risk: low

### 20 Oct 2026 · 5.6 Practice items come only from practice.next_item; keys stay on the server (ADR-0010) · decided by lead (architect review accepted) · risk: high
Decided: ADR-0010 as written: the pack practice@1.1.0 routes every item through the tool, a new set@1.1.0 pins it (set@1.0.0 unchanged), the key is looked up on the server by item id and never reaches the model on the issuing turn or the client, it is saved in HelpState on every outcome, and a held practice key caps the ladder at the practice ceiling. No contracts change.
Why: a model-written item's answer cannot be protected; this is Decision 1 of the 5.6 plan, reviewed by the architect and accepted by the lead.
risk: high

### 20 Oct 2026 · 5.6 New keys reach the stream gate mid-attempt through addKeys, not the decision · decided by tdd-guide
Decided: generate keeps a live list of guarded keys; an issued item's key is added to it and to the gate (`StreamGate.addKeys`), and postGuard gets the union from the runner. The decision that is composed and saved is unchanged.
Why: putting the key in the decision would put it in the model's prompt on the issuing turn (compose renders `mustNotReveal`).
risk: high

### 20 Oct 2026 · 5.6 An item whose key can't be found fails the tool call closed · decided by tdd-guide
Decided: a new tool fail reason `no_answer_key`; the model sees only `failed` and the pack's "no item ready" path applies.
Why: the model must never see an item whose key the harness can't protect.
risk: low

### 20 Oct 2026 · 5.6 The skill event is checked against earlier keys only · decided by tdd-guide
Decided: an item's own `skill` payload is checked against the keys guarded before it, not its own key.
Why: its prompt was already checked against its own key when made, and the arithmetic matcher would drop every generated sum item's event.
risk: high

### 20 Oct 2026 · 5.6 Practice fields ride along like groundingAsks; served list capped at 20 · decided by tdd-guide
Decided: the runner carries the loaded practice fields onto every saved state (decide rebuilds the help state without them); the served list keeps the last 20 ids; a second call or a retry in the same turn leaves out items already issued (corrected in the review fix round: the generator now honours that list).
Why: same pattern as 4.7's groundingAsks; a bounded list keeps the blob small.
risk: low

### 20 Oct 2026 · 5.6 Unreadable stored state plus an issued item saves the state stopped · decided by tdd-guide
Decided: when the stored help state couldn't be read but an item went out, the runner still saves the new state (with the key) and sets `lockedStopped: true`.
Why: the key must be saved; an unknown stored stop flag is treated as set (fail closed), as 4.6b does.
risk: low

### 20 Oct 2026 · 5.6 Pending prompt packs load; reported, not changed · decided by tdd-guide
Decided: practice@1.1.0 and set@1.1.0 are committed with `reviewed_by: pending`; the loaders accept it and no validation fails. Nothing was changed in the loaders.
Why: no other pending pack exists to set a precedent; the sign-off is B-26 and the merge gate.
risk: medium

## Fix round (review)

Review findings fixed (architect and security-reviewer, 20 Oct 2026). The other LOW and MEDIUM
items (teacherId scope, the key in compose.ts's prompt, test LOWs, the GEN_ID comment,
runner.ts:1135) are deferred by the lead. No `packages/contracts` change; the harness imports
only contracts, zod, mathjs and its own modules.

1. [HIGH] Items are validated at runtime. `pickItem` serves a bank item only if it is a servable
   kind (no mcq or code_output), inside the scope, its id is at most `PRACTICE_ID_MAX`, it is not
   excluded, it passes `validateItem` and the caller accepts it; otherwise it asks the bank again
   (at most 20 times), then the generator, and fails closed if nothing is valid. Tests
   (`practiceItems.test.ts`, "pickItem validates every item at runtime"): "never serves a bank
   item whose prompt holds its own key; the generator steps in", "never serves an mcq (or
   code_output) item, even from a bank that offers one", "fails closed when nothing is valid".
2. [HIGH] CI: the content snapshot is regenerated after the practice@1.1.0 rewording (fed7d54);
   only the practice pack's three lines changed. The pack itself is untouched.
3. [MEDIUM] Practice no longer gets stuck. An item tool's output and its skill payload are
   checked against earlier keys on the item's shown text only (prompt and options, `IssuedItem
   .shown`), not the JSON, so `"level":1` or the id never matches a held key "1". The generator
   honours the exclude list (up to 64 deterministic operand variants; variant 0 is unchanged) and
   the tool skips any item whose prompt or options show a key held this attempt (`heldKeys`, read
   live). Tests: `runner.practiceAnswerKey.test.ts` "three items in a row at level 1 are all
   served, with a held key "1"" and "three turns in a row at level 1 each serve a new item";
   `toolLoop.test.ts` "an item tool is key-checked on its shown text only"; `skillEvent.test.ts`
   "an item payload is key-checked on its shown text only"; `practice.test.ts` "forSession
   heldKeys: never serves an item whose prompt shows a held key".
4. [MEDIUM] No fail-open when the gate has no `addKeys`: once an item is issued, generate shows
   nothing more for the attempt and reports it `withheld`, so postGuard puts the safe hint in its
   place. Test: `generate.test.ts` "holds the rest of the attempt and reports it withheld".
5. [MEDIUM] Id and key bounds. The output schema caps `id` at `PRACTICE_ID_MAX`; the generator
   never makes a longer id (fails closed); `issuedItem` fails closed when the module id is over
   the limit or the turn's key union would pass `PRACTICE_KEYS_MAX_JSON` (2,048), which keeps a
   full state under `LIMITS.helpStateMaxJsonLength`. Tests: `practice.test.ts` "the output schema
   caps the item id at PRACTICE_ID_MAX", "issuedItem: a module id over PRACTICE_ID_MAX fails
   closed", "issuedItem: fails closed when the key union would push HelpState over its limit";
   `helpState.test.ts` "a state at every practice limit still serialises".
6. [MEDIUM] postGuard's keys are the union of the runner's issued items and
   `gen.practiceAnswerKey`. Test: "a key only in gen.practiceAnswerKey still makes postGuard hold
   a reply that shows it". The generate.ts header comment now says so.
7. [MEDIUM] `issuedItem` no longer casts `find(...) as string`: no single allowed module resolving
   the id returns undefined (fail closed). Test: "issuedItem: fails closed when no single allowed
   module resolves the id".
8. Docs: ADR-0010 no longer says "the client never sees the key" (the raw key is in the later
   turns' do-not-say prompt and the matcher can miss spelled or roman forms; follow-up task to
   come); the handoff's "serves a new item" claim is corrected and the open question is marked
   answered.

Evidence: `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...
--filter=@edmate/content... --force --concurrency=1` → 14 successful, 14 total; harness 106
files / 4728 tests passed with coverage thresholds met; content 19 files / 313 tests; lint 0
errors (1 pre-existing warning, `route.accuracy.test.ts`). The repo secret scan (`--all`) is
clean.

### 20 Oct 2026 · 5.6 Item tools are key-checked on the text they show, not their JSON · decided by tdd-guide
Decided: for a tool with `issuedItem`, the do-not-say check on its output and on its skill payload reads only the item's prompt and options (`IssuedItem.shown`); the locked check still reads every leaf. Other tools keep the whole-JSON check.
Why: the JSON's `"level":1` and the id matched a held key "1", so after one item every later item failed and practice got stuck; the id and level are server-made and never hold an answer the prompt doesn't show.
risk: high

### 20 Oct 2026 · 5.6 The generator varies operands to honour the exclude list and held keys · decided by tdd-guide
Decided: `generateItem` tries up to 64 deterministic variants (variant 0 is the old item) and serves the first that is not excluded, passes `validateItem` and shows no held key; none valid fails closed. The bank is asked at most 20 times before the generator.
Why: a fixed item per module and level repeated and then failed; bounded loops keep it deterministic and fail closed.
risk: low

### 20 Oct 2026 · 5.6 An issued item with a gate that can't take keys holds the rest of the attempt · decided by tdd-guide
Decided: `addKeys` stays optional on `StreamGate`; when an item is issued and the gate has none, generate shows no more text and returns `withheld: true`, so postGuard replaces the reply with the safe hint.
Why: fail closed without forcing every test gate to implement `addKeys`; production's answer-leak gate has it.
risk: high

### 20 Oct 2026 · 5.6 Practice keys per turn are capped at 2,048 characters of JSON · decided by tdd-guide
Decided: `PRACTICE_KEYS_MAX_JSON = 2048`; `issuedItem` fails closed when the turn's key union would pass it, or the module id is over `PRACTICE_ID_MAX`.
Why: with 20 served ids of 200 characters it keeps the saved state under the 8 KB limit, so `serializeSessionHelp` never throws and drops a key.
risk: low

## Lead decisions (merge)

### 20 Oct 2026 · 5.6 Practice merges with practice@1.1.0 unsigned; matcher false positives go to 5.6b · decided by lead
Decided: PR #73 merges with practice@1.1.0 and set@1.1.0 at `reviewed_by: pending`; the human signs them through B-26. The pack now says the app shows the item and the model must not repeat it (fed7d54); the code-output rule's last sentence ("Text that the item itself shows may be shown as given") still conflicts with that and is left for the human's sign-off. The arithmetic false positives (the item's own prompt, and later hints that quote the sum) fail closed and go to 5.6b. Review MEDIUM and LOW items go to 5.6c (before any real practice bank). The fix round's two risk: high decisions (shown-text-only key check, hold the rest without addKeys) were re-checked by the architect and accepted.
Why: MVP first (human, 20 Oct 2026); every remaining gap fails closed, and none lets a key reach the client.
risk: high

