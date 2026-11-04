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
Tool calls used: 28 (plan: 45; one phase, packages/harness only).

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
