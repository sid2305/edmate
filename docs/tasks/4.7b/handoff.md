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

## Phase B

## Summary
Item 2: `invalidCitations` now also catches a spaced bracket (`"[ 3 ]"`), a full-width digit
(`"[３]"`) and the no-brackets `"source N"` wording, via a new `CITATION_VARIANT` pattern used
only there (`citedSources` keeps the exact `[n]` composer numbering, untouched).

Item 6: `postGuard.ts`'s `watched()` reads `r.result` directly — no cast. `r` is a `GuardRun`
(never `null`/`undefined` by its own type), and `GuardResult`'s union already narrows with
`'reason' in res` with no cast needed.

Item 7: `grounding.ts`'s `premiseUncorrected` now checks the reply's opening agreement (`agrees`)
*before* clearing a wrong premise on a correct same-expression restatement, so "Yes, 6 - 3 is 3.
Well done!" after "6 - 3 is 2, right?" stays uncorrected (the accept line's own example). The
symmetric case (a correct restatement with no opening agreement) still clears the premise, no
regression.

Item 8: a new `GROUNDING_JUDGE_UNAVAILABLE_REPLY` ("I'm having trouble checking that against your
material right now — let's come back to it in a moment.") replaces `ANSWER_LEAK_SAFE_HINT` as the
judge-outage fallback when `x.safeReply` is undefined; it is neutral, gives no answer and names no
helpline or contact. Added to grounding's own `fixed` list (idempotence pass).

## Decisions
### 4 Nov 2026 · 4.7b citation variant pattern scope (Q2) · decided by builder · risk: low
- Decided: `CITATION_VARIANT` matches exactly the three forms the plan named (spaced brackets, a
  full-width digit, `"source N"`), case-insensitive, with a `\b` word boundary so `"resource N"`
  is not matched.
- Why: a broader net (e.g. "ref N", "source #N") risks false positives on ordinary prose; the plan
  recommends the literal three examples and widening later if a real eval case needs it.
- Alternatives: a wider net now (rejected per Q2's recommendation).
- Reversible: yes, a regex change.

### 4 Nov 2026 · 4.7b postGuard watched() cast removed as a pure refactor · decided by builder · risk: low
- Decided: `const res: unknown = r.result;` replaces the `(r as {...} | null | undefined)?.result`
  cast; no new test scenario, the existing escalation-reason test
  (`postGuard.grounding.test.ts`'s "an ungrounded reply becomes the ask-teacher reply...") still
  passes unchanged, proving no regression.
- Why: `GuardRun.result` is required and typed as `GuardResult`, a union that already narrows with
  `'reason' in res`; `g.run()` always returns a `GuardRun` object, so `r` is never `null`/`undefined`
  by its own type — the cast hid nothing real and would have hidden a genuine type error if the
  field were ever renamed.
- Alternatives: keep the defensive cast (rejected: the plan's own point — it silently hides a real
  type error).
- Reversible: yes.

### 4 Nov 2026 · 4.7b premiseUncorrected checks agrees before the same-expression clear (item 7) · decided by builder · risk: low
- Decided: inside `premiseUncorrected`'s `wrong.some` callback, the same-expression correct-claim
  clear only fires when `!agrees`; `agrees` (or any wrong claim in the reply, checked earlier) wins
  over a later correct restatement.
- Why: the accept line's own example ("Yes, 6 - 3 is 3. Well done!" after "6 - 3 is 2, right?")
  opens by agreeing with the wrong claim before restating it correctly; the old order read the
  correct restatement first and never checked the opening "Yes" at all.
- Alternatives: none explored — the plan named the exact fix (check order, not a new signal).
- Reversible: yes, a one-line condition change.

### 4 Nov 2026 · 4.7b GROUNDING_JUDGE_UNAVAILABLE_REPLY replaces ANSWER_LEAK_SAFE_HINT on no safeReply (item 8) · decided by builder · risk: low
- Decided: `safe = x.safeReply ?? GROUNDING_JUDGE_UNAVAILABLE_REPLY` (was `?? ANSWER_LEAK_SAFE_HINT`);
  the new text is also added to grounding's `fixed` array alongside `ANSWER_LEAK_SAFE_HINT` (which
  stays there for the answer-key fallback path, item 8 does not touch that).
- Why: `ANSWER_LEAK_SAFE_HINT` ("let's work this out together rather than jump to the final
  answer") is answerLeak's wording for a leak about to happen, a non-sequitur on a judge outage
  with no answer-leak risk (e.g. an `explain` move). The new text is neutral, gives no answer and
  names no helpline or contact, per the brief's extra instruction for this item.
- Alternatives: a locale-supplied outage text (rejected: out of this phase's scope — the plan only
  asks for the fixed English fallback; a locale pack can still override via `x.safeReply`).
- Reversible: yes, a string constant change.

## Red -> green evidence
- `invalidCitations('See [ 4 ].', 3)`: before `CITATION_VARIANT`, returned `[]` (the tight
  `[(\d{1,3})]` pattern doesn't match the inner spaces); after, `[4]`. Same red→green confirmed for
  the full-width digit and `"source 4"` forms (manual trace against the old `CITATION` pattern,
  since it is still used unchanged by `citedSources`); green run: `citations.test.ts`, 16 tests
  passed (13 pre-existing + 3 new).
- `premiseUncorrected`/`grounding.ts`'s `run()`: reverted the order fix (temporarily restored the
  old `if (claims.some(...)) return false;` with no `!agrees` guard) and reran
  `grounding.test.ts` — the new accept-line test case (`'6 - 3 is 2, right?'` /
  `'Yes, 6 - 3 is 3. Well done!'`) went red (`expected ok:true, received the correction prompt`),
  62 passed / 1 failed; restored the fix — 63 passed, 0 failed.
- The watched() cast removal is a refactor, not a behaviour change (per the plan): no artificial
  red state forced; `postGuard.grounding.test.ts`'s existing escalation-reason test and
  `postGuard.test.ts` both still pass unchanged (51 tests, 2 files) with the cast gone.
- The judge-outage text change: `grounding.test.ts`'s outage test asserted
  `unavailable(ANSWER_LEAK_SAFE_HINT)` before this phase (green then, on the old behaviour); the
  assertion was updated to `unavailable(GROUNDING_JUDGE_UNAVAILABLE_REPLY)` to match the plan's
  intentional behaviour change (item 8), plus a new idempotence assertion for the new text — both
  confirmed green against the new code.
- Offline gate: `packages/evals/src/groundingFixtures.test.ts` — unaffected by Phase B's items (no
  fixture or SPECS-layer change); 46 tests passed, same as after Phase A.

## Gate
- `packages/harness`: `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness` —
  all 4 tasks successful (typecheck, lint, test, and the cached build). `src/guardrails/**` at
  100% lines/branches/functions/statements (vitest's coverage table; `guard.ts`/`index.ts` show
  0/0/0/0, type-only re-export files with no executable statements, same as every prior guardrails
  phase).
- `packages/harness/src/guardrails/grounding.test.ts`: 63 tests passed (was 62 after Phase A's
  file; +1 new case).
- `packages/harness/src/pipeline/generate/citations.test.ts`: 16 tests passed (was 13; +3 new).
- `packages/harness/src/pipeline/steps/postGuard.grounding.test.ts` +
  `postGuard.test.ts`: 51 tests passed, unchanged.
- `packages/evals/src/groundingFixtures.test.ts`: 46 tests passed, unchanged.
- `prettier --check` on the five touched files: clean (after one `--write` pass on
  `grounding.test.ts` and `citations.ts`).
- `python3 .githooks/secret-scan.py --all`: exit 0, clean.
- Note: the plan's exact gate command, `--filter=...@edmate/harness`, also runs `@edmate/queue`'s
  tests (a dependency), which failed on an unrelated flaky Redis timing assertion
  (`turnLimits.int.test.ts`, "slides: each take expires windowMs after it was made") — infra
  timing, nothing touched by this phase. `--filter=@edmate/harness` alone (no dependents) is green,
  same posture as Phase A's handoff note.

## Budget
Tool calls used: ~46 (plan budgeted 60 for Phase B).
