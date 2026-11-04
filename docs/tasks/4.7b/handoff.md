## Phase A

## Summary
Item 3: `arithmeticClaims` now also reads the reversed numeric premise form ("I got 4 for 7 // 2")
via a new `CLAIM_BEFORE` pattern, merged with the existing `CLAIM_AFTER`. `CLAIM_BEFORE` only
searches the free text since the previous arithmetic expression (not the whole prefix), so an
earlier expression's own operand is never read as a claim about a later one. The worded form
("seven over two is four") is left to the judge, per the lead's Q1 answer.

Item 4: `wordMentions`' `emit()` no longer casts `canonicalNumber(num) as string`; when
`canonicalNumber` returns `undefined` (a spoken-number run past 1e15), no `NumberMention` is
pushed, matching the other three call sites.

Confirmed via `packages/evals/src/groundingFixtures.test.ts` (offline, not modified by the plan's
"files out of bounds" rule for the yaml, but its `SPECS` layer annotation for
`grounding-falsepremise-reversed-en` was updated — see Decisions) that the pending fixture now
passes via Rule C's existing `premiseUncorrected`, not only the judge.

## Decisions
### 4 Nov 2026 · 4.7b CLAIM_BEFORE connector adds "for" · decided by builder · risk: low
- Decided: `CLAIM_BEFORE` reuses `CONNECTOR` (shared with `CLAIM_AFTER`) plus "for", in a
  separate `CONNECTOR_BEFORE` constant used only for the reversed form.
- Why: the plan's own red/green example, "I got 4 for 7 // 2", needs "for" as a connector; it is
  only natural in this direction ("N for expr"), so adding it to the shared `CONNECTOR` risked a
  false match after an expression ("7 // 2 for homework is due").
- Alternatives: add "for" to the shared `CONNECTOR` (rejected: risks forward false positives).
- Reversible: yes, a one-line constant change.

### 4 Nov 2026 · 4.7b CLAIM_BEFORE windowed to the previous expression · decided by builder · risk: low
- Decided: `CLAIM_BEFORE` searches only `s.slice(prevExpressionEnd, span.start)`, not
  `s.slice(0, span.start)`.
- Why: TDD caught a regression — without the window, "7 // 2 is 4 - 1" (already-covered, loose
  claim case) matched the operand "2" of the first expression as a reversed claim for the second
  expression "4 - 1", via the connector "is" between them.
- Alternatives: a no-arithmetic-digit lookbehind (rejected: harder to reason about and still
  would not stop a connector bridging two expressions).
- Reversible: yes.

### 4 Nov 2026 · 4.7b worded premise form deferred to the judge (Q1) · decided by builder · risk: low
- Decided: only the reversed numeric form is parsed; "seven over two is four" (number words as
  operands) is left to the judge, as the lead's Q1 answer and the plan's scope note direct.
- Why: parsing number words as arithmetic operands needs `arithmeticSpans`/`TOKEN` changes well
  beyond this phase's budget.
- Alternatives: none explored (out of scope per plan).
- Reversible: n/a (residual, already tracked by 4.7's own documented residuals per the lead).

### 4 Nov 2026 · 4.7b groundingFixtures.test.ts SPECS layer updated · decided by builder · risk: low
- Decided: `grounding-falsepremise-reversed-en`'s `layer` in `packages/evals/src/groundingFixtures.test.ts`
  changed from `'judge'` to `'number'` (comment updated); the yaml fixture itself is untouched.
- Why: with `CLAIM_BEFORE`, Rule C now catches this case without the judge (confirmed by running
  the suite); the "judge always grounded" mutation test asserts exactly the judge-only cases fail,
  so it broke without this update. The plan's item 3 anticipated this ("confirms the existing
  pending case now passes via Rule C too, not only the judge").
- Alternatives: leave the SPECS layer as `'judge'` and widen the mutation test's exemption list
  (rejected: less accurate, and the plan's own "update the handoff table" note already flagged
  that something about this case's record needed to change).
- Reversible: yes.

## Red -> green evidence
- `arithmeticClaims('I got 4 for 7 // 2')`: before `CLAIM_BEFORE` existed, returned `[]`; after,
  one claim (`computedText: '3'`, `correct: false`).
- Regression caught by TDD: after adding the naive (unwindowed) `CLAIM_BEFORE`, the pre-existing
  test `'leaves loose or unpaired claims to the judge'` (`'7 // 2 is 4 - 1'` -> `[]`) went red
  (wrongly matched "2" as a reversed claim for "4 - 1"); windowing to the previous expression's
  end fixed it, test green again.
- `wordMentions`/`canonicalNumber`: reverted the `emit()` fix, ran the new
  `numbers.test.ts` case ("a spoken-number run past 1e15 is not emitted...") — red
  (`expected false to be true`, a `NumberMention` with a non-string `value` was pushed);
  restored the fix — green.
- Offline gate: `packages/evals/src/groundingFixtures.test.ts` — before the `SPECS` update, the
  "judge always grounded" mutation test failed (25 cases failed, expected 24 — the reversed-premise
  case was no longer judge-only); after the `SPECS` update, all 46 tests pass.

## Gate
- `packages/harness`: `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness` —
  green (cached FULL TURBO after a clean run: 131 test files, 6048 tests passed, 0 failed).
  `src/guardrails/**` at 100% lines/branches/functions/statements (vitest's own coverage
  thresholds, no `ERROR` lines in the coverage run).
- `packages/evals/src/groundingFixtures.test.ts`: 46 tests passed (was 1 failed before the
  `SPECS` update).
- `prettier --check` on the four touched files: clean.
- `python3 .githooks/secret-scan.py --all`: exit 0, clean.
- Note: `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness` (dependency
  direction, matching the plan's exact gate command) also ran `@edmate/cli`'s tests, which failed
  on an unrelated Postgres connection drop in `test/chatDbRetrieval.int.test.ts` (DB integration
  test infra, nothing touched by this phase). The harness package itself (`--filter=@edmate/harness`,
  no cli) is green.

## Budget
Tool calls used: ~48 (plan budgeted 40 for Phase A).
