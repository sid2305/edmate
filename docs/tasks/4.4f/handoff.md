# Handoff: 4.4f — moderation rule table: first-person threat and weapon-acquisition shapes

Status: DONE

## Summary
Added two new `moderationPatterns.ts` rule rows per the lead's 4 Nov 2026 review: a first-person
future-tense threat shape (`harm_to_others`) and a weapon-acquisition question shape (`weapons`,
knives dropped, no "without a licence" loophole). Also applied the two remaining conflict-free
LOWs from the 4.4 review: `moderationIn.ts` now builds the misuse/distress alert before awaiting
`ctx.safetyEvents.record(...)`, and `jailbreak.ts`'s `block()` has an explicit `Promise<GuardRun>`
return type. No file outside `packages/harness/src/guardrails/` was touched.

## Decisions

### 4 Nov 2026 · 4.4f first-person threat coded `harm_to_others` · decided by builder · risk: low
- Decided: the new first-person future-tense threat shape ("I will stab him") is coded
  `harm_to_others`, not `threat`.
- Why: the plan's open question 3 and the lead review both recommend/accept this; the classifier's
  own description of `harm_to_others` is "wants to hurt a person", and the existing `threat` rows
  are all about threat *messages* someone wants to write, not a direct first-person statement.
- Alternatives: code it `threat` — rejected, wrong fit with the existing table's split.
- Reversible: yes — a one-line code change plus a test update.

### 4 Nov 2026 · 4.4f licence/permit exemption is a noun-adjacent lookahead, not a global `unless` · decided by builder · risk: low
- Decided: the weapon-acquisition rule exempts a licence/permit request with a negative lookahead
  immediately after the weapon noun (e.g. "...a gun license"), not the table's usual `unless`
  field (which tests the whole message).
- Why: the lead review's HIGH requires the exemption to apply only when the licence/permit is
  itself the thing asked for; a global `unless` would also exempt "...a gun without a license" and
  "...without a background check", which the review explicitly disallows.
- Alternatives: a global `unless` listing license/permit, as the original plan text had — rejected
  per lead review HIGH 1.
- Reversible: yes — localised to one rule row.

### 4 Nov 2026 · 4.4f three LOWs move to 4.4g · decided by builder (per lead review) · risk: low
- Decided: the three deferred LOWs from the original 4.4 review — `runner.ts:748` /
  `types.ts:385` narrowing `withheldCode`/`code`, `runner.block.test.ts:46` indentation, and
  `queues.ts:239` (`packages/queue`, tied to the db `safety-events.ts` enum) — stay open and move
  to a new board task 4.4g, which the lead adds once 4.3b (owns `runner.ts`/`types.ts`) merges.
- Why: lead review item 4, Q1: fixing them now risks a merge conflict with in-flight 4.3b/4.7b
  work on the same lines; `queues.ts` is outside `packages/harness` entirely.
- Alternatives: fix them in this task anyway — rejected, matches the plan's explicit scope
  decision and the lead review's acceptance of it.
- Reversible: yes — 4.4g is a new, independent task.

### 4 Nov 2026 · 4.4f first-person threat and weapon-acquisition rules, merged · decided by lead · risk: high
- Decided: merge two new decisive rows in `packages/harness/src/guardrails/moderationPatterns.ts`.
  - **Threat row.** A first-person future-tense threat ("I will stab him", "I'm going to shoot him") scores `harm_to_others`. `shoot` counts only in this row, and "shoot him a text" or "shoot her portrait" right after the person word is not a threat.
  - **Weapon row.** A weapon-acquisition question ("how do I get a gun", "where can I buy a pistol") scores `weapons`. A gun licence or permit asked for as the thing itself stays clean, and "without a license" still hits. Knives are left out.
  - **Shared fixes.** Both rows use the narrow `GAME_TITLE` list for their game exemption, not the shared `GAME` list. Two of the six 4.4 LOWs are also fixed: the alert is built before the event is recorded in `moderationIn.ts`, and `block()` in `jailbreak.ts` has an explicit return type. The other three LOWs move to 4.4g.
- Why: the 4.4c review found that these everyday threat and acquisition phrasings scored nothing when the classifier was down.
  - Code review found that "I'm going to shoot him" was missed; fix round 1 fixed it.
  - The lead's own probe then found that the exemptions are tested against the whole message (`rulePhrases.ts`). The shared `GAME` list holds school words (class, level, object, player), so "I will stab him after class" and "how do I get a gun to bring to class" passed clean. Fix round 2 fixed that, and the lead re-ran 18 probe sentences: every hit and every no-hit came out right.
  - Fix round 1's decision "message/photo exemption keyed to adjacency" is superseded by fix round 2's lookahead.
- Alternatives:
  - Add `shoot` to the shared HARM_VERB. Rejected: other rows would then block "shoot him a text".
  - Keep the shared `GAME` exemption. Rejected: it hides threats made at school.
  - Wait for a safety-reviewer. Rejected: there is no safety-reviewer per PR until the pilot gate (MVP first).
- Reversible: yes. These are two table rows with their tests.

### 4 Nov 2026 · 4.4f build over budget · decided by lead · risk: low
- Decided: accept 133 tool calls against a plan of 45 (about 3x). The build took 46, fix round 1 took 39 and fix round 2 took 48 (harness counts).
- Why: the overrun is the two fix rounds, and each one closed a real missed threat.
- Alternatives: none. The fixes were needed before merge.
- Reversible: n/a.

## Red -> green evidence
Added `describe('matchModeration: 4.4f rule follow-ups (first-person threat, weapon acquisition)')`
in `moderationPatterns.test.ts` (8 cases plus the 3 lead-review additions: game exemption on the
threat rule, the "without a licence" HIGH, and the knife drop). Before the rule rows were added,
4 of the new `it` blocks failed red (the rest passed trivially, e.g. "I will kill this exam" was
already null):
```
FAIL ... first-person future-tense threat hits harm_to_others
FAIL ... the game exemption keeps a first-person threat clean in a game context
FAIL ... weapon-acquisition question hits weapons
FAIL ... the lead review HIGH: no "without a licence" loophole
Test Files  1 failed (1)
     Tests  4 failed | 131 passed (135)
```
After adding the two rule rows, the same file: `Test Files 1 passed (1)` / `Tests 135 passed (135)`.

## Gate
- `corepack pnpm install --frozen-lockfile`: clean.
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness`: `@edmate/harness`
  typecheck, lint and test all pass (205 tests across `moderationIn.test.ts`, `jailbreak.test.ts`,
  `moderationPatterns.test.ts`: 39 + 31 + 135). `src/guardrails` coverage: 100/100/100/100 (all
  four metrics). The only failure in the full run is `@edmate/cli#test` ->
  `test/chatDbRetrieval.int.test.ts` (dev Postgres broken locally) — ignored per the brief; CI runs
  it. `@edmate/content#test`'s `safeRegex.test.ts` timing-probe flake (unrelated package, unrelated
  to this task's files) was seen on one run; not in `@edmate/harness`'s dependency/filter output.
- `prettier --check` on the four touched files: clean after one `--write` on `moderationIn.ts`
  (reorder changed indentation only).
- `python3 .githooks/secret-scan.py --all`: clean (exit 0).

## Budget
Tool calls used (harness counts): build 46, fix round 1 39, fix round 2 48; total 133 against a plan of 45. See the lead budget decision.

## Left to do
None — all three new-shape tests, the lead review's HIGH and two MEDIUMs, and the two safe LOWs
are green. The three deferred LOWs move to 4.4g as described in Decisions above.

## Fix round 1

**Finding ([HIGH] `packages/harness/src/guardrails/moderationPatterns.ts`, HARM_VERB).**
`matchModeration("I'm going to shoot him")` returned null: a clear first-person threat got no
block, no safety event and no alert. HARM_VERB had no "shoot".

### Red -> green
Added `fix round 1` tests to the `4.4f rule follow-ups` describe block. Confirmed red first (ran
with the pre-fix row, "shoot" not in the verb group): `fix round 1: a first-person "shoot" threat
hits harm_to_others` failed, expected `{ code: 'harm_to_others', decisive: true }`, got `null`,
for `"I'm going to shoot him"`. After the fix, both new tests (hit and no-hit cases) pass; the
full file is green at 137/137 tests.

### The fix
- "shoot" was added only to the existing first-person future-tense threat row, through a local
  verb group `(?:${HARM_VERB}|shoot)` — the shared `HARM_VERB` constant is unchanged, since other
  rows reuse it and "shoot him a text" is everyday English there.
- Added a `MESSAGE_OR_PHOTO` noun group and extended that row's `unless` to
  `${GAME}|${OTHER_PERSON} ${MESSAGE_OR_PHOTO}`, exempting a person word directly followed by an
  optional article/"quick" and a message or photo noun (message, text, msg, email, dm, note, line,
  reply, question, photo(s), picture(s), portrait, headshot(s), video). The existing `GAME`
  exemption is unchanged.

### Gate results
- `corepack pnpm install --frozen-lockfile`: clean.
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness`: harness typecheck,
  lint and test all green (137/137 in `moderationPatterns.test.ts`, 100% coverage on
  `src/guardrails/**`). The gated run also reran `@edmate/content#test`, which failed once on a
  timing-probe test (`checkSafeRegex > the timing probe ... catches \`a?\` x25 then \`a\` x25`,
  5000ms timeout) unrelated to this change; re-run in isolation (`vitest run
  src/safeRegex.test.ts`) passed 56/56 — a pre-existing timing flake under load, not a regression
  from this fix. The local `@edmate/cli` `chatDbRetrieval` integration test was not re-checked
  (dev Postgres broken locally per the brief; CI covers it).
- `prettier --check` on both touched files: pass.
- `python3 .githooks/secret-scan.py --all`: clean.

### Decisions

### 4 Nov 2026 · 4.4f fix round 1: "shoot" scoped to one row, not shared HARM_VERB · decided by builder · risk: low
- Decided: "shoot" joins only the first-person future-tense threat row (`(?:${HARM_VERB}|shoot)`
  local to that row), not the shared `HARM_VERB` constant used by other rows.
- Why: the lead's fix-round brief requires this scoping — other `harm_to_others` rows reuse
  `HARM_VERB` for lead-ins like "how do I ... him" and "teach me how to ... him", and "shoot" in
  those shapes is far more likely to be a game or photography question than in the direct
  first-person statement shape.
- Alternatives: add "shoot" to shared `HARM_VERB` — rejected per the lead's explicit instruction
  and because it would widen every other row that reuses `HARM_VERB`.
- Reversible: yes — a one-line regex change.

### 4 Nov 2026 · 4.4f fix round 1: message/photo exemption keyed to adjacency with the person word · decided by builder · risk: low
- Decided: the message/photo exemption is a phrase on the whole normalised text,
  `${OTHER_PERSON} ${MESSAGE_OR_PHOTO}`, requiring the noun to sit directly after the person word
  (with an optional article or "quick" in between), not a bare word-anywhere `unless`.
- Why: the brief specifies the exemption only when the person word is "directly followed by" the
  message/photo noun; a bare `unless` on "message" or "photo" anywhere in the text would also
  clear unrelated threats that happen to mention a photo elsewhere in the same message.
- Alternatives: a lookahead directly after `${HARM_VERB}|shoot}${gap(1)} ${OTHER_PERSON}` in the
  main pattern — rejected as harder to read next to the existing `GAME` `unless`; the table's
  `unless` field already supports a multi-alternative string and is the row's existing idiom.
- Reversible: yes — a one-line regex change.

## Fix round 2

### Finding (lead, verified with a scratch test run)
**[HIGH] `moderationPatterns.ts`, the two new 4.4f rows.** `unless` is tested against the whole
message (`rulePhrases.ts:58`), so both fix-round-1 exemptions were far too wide: the threat row's
`unless: ${GAME}|${OTHER_PERSON} ${MESSAGE_OR_PHOTO}` used the shared `GAME` list, which holds
school words (`class`, `level`, `object`, `player`, `asset`, ...), and the message/photo phrase
could sit anywhere in the text, not just next to the person word; the weapon-acquisition row's
`unless: GAME` had the same school-word problem.

### Fix
1. Added `GAME_TITLE`, a narrower game-title/hobby list, used only by the two 4.4f rows; the
   shared `GAME` constant and every row that already used it are unchanged.
2. Both 4.4f rows now use `unless: GAME_TITLE`.
3. The message/photo exemption moved out of `unless` into the threat pattern itself, as a negative
   lookahead directly after `OTHER_PERSON`: `${OTHER_PERSON}(?! ${MESSAGE_OR_PHOTO}(?![\p{L}]))`.
   Only "shoot him a text" right next to the threat is now exempt.

### Red → green evidence
- Added the seven hit sentences from the finding, plus two exemption-still-holds checks, to the
  `4.4f rule follow-ups` describe block in `moderationPatterns.test.ts` (3 new `it` blocks, never
  editing an existing assertion).
- Red: with the fix reverted (via a scoped `git stash` of only `moderationPatterns.ts`), `vitest
  run src/guardrails/moderationPatterns.test.ts` failed 2/140 (both new `it` blocks, each on its
  first assertion, before the test runner moved on) — "I will stab him after class" and
  "I'm going to stab him and then send her a photo" both returned `null` instead of
  `harm_to_others`; the stash-apply restored the fix immediately after capturing this.
- Green: after restoring the fix, `vitest run src/guardrails/moderationPatterns.test.ts` → 140/140
  passed.

### Gate results
- `corepack pnpm install --frozen-lockfile`: clean.
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness`: typecheck and lint
  pass; `vitest run --coverage` on `@edmate/harness` alone (outside the turbo pipeline, to rule out
  machine load) → 131 files, 6063/6063 tests passed, no coverage-threshold errors
  (`src/guardrails/**` at 100%). Inside the turbo run, two unrelated tests
  (`warmup.coldStart.test.ts`'s CPU-load test, `preGuard.test.ts`'s "every classifier says no → ok")
  timed out under parallel load; both pass standalone (29/29) and are pre-existing timing flakes,
  not a regression from this fix. The local `@edmate/cli` `chatDbRetrieval` integration test was
  not re-checked (dev Postgres broken locally per the brief; CI covers it).
- `prettier --check` on both touched files: pass (test file needed `--write` once, for the new
  `it` blocks' formatting).
- `python3 .githooks/secret-scan.py --all`: clean.

### Decisions

### 4 Nov 2026 · 4.4f GAME_TITLE added as a narrower, 4.4f-only game exemption · decided by builder · risk: low
- Decided: a new constant `GAME_TITLE` (game/gaming/a short list of named titles) replaces the
  shared `GAME` constant in the `unless` of the two 4.4f rows only; `GAME` itself and every
  existing row that uses it are unchanged.
- Why: the lead's fix-round-2 brief specifies this exact shape and list; `GAME` holds school words
  (`class`, `level`, `object`, `player`, `asset`, ...) that made the 4.4f exemptions wrongly clear
  real threats and weapon-acquisition questions mentioning school.
- Alternatives: narrow `GAME` itself — rejected, would risk widening or narrowing the weapon-build
  row's existing `unless` that also reuses `GAME`, outside this fix's scope.
- Reversible: yes — a one-line regex change plus reverting the two `unless` fields to `GAME`.

### 4 Nov 2026 · 4.4f message/photo exemption moved from `unless` to a lookahead on the person word · decided by builder · risk: low
- Decided: the message/photo exemption is now `${OTHER_PERSON}(?! ${MESSAGE_OR_PHOTO}(?![\p{L}]))`
  inside the threat pattern itself, not a separate `unless` alternative.
- Why: `unless` is tested against the whole message, so the fix-round-1 version exempted any
  message/photo mention anywhere in the text (e.g. "I'm going to stab him and then send her a
  photo"), not just one sitting directly after the person word as fix round 1 intended; a
  lookahead at the match position is the only way to keep the adjacency.
- Alternatives: keep it in `unless` with tighter wording — rejected, `unless` has no way to anchor
  to a specific position in the message, only to whether a pattern matches anywhere in it.
- Reversible: yes — a one-line regex change plus moving the clause back into `unless`.
