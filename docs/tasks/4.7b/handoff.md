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

## Phase C

## Summary
Item 1: `grounding.ts`'s `fence()` now calls `breakFenceRuns` (reused from `pedagogy/modelRequest.ts`,
unmodified) instead of its own ASCII-only `<{3,}|>{3,}` regex, so a full-width (`＜＜＜`) or
HTML-entity (`&lt;&lt;&lt;`) run in a chunk, the student's message or the reply is also broken up,
not only a literal run of 3+ ASCII `<`/`>`.

`fence()` also takes an optional per-request `token`, appended right after `DATA_OPEN`/`DATA_CLOSE`
(`<<<groundingFence_7` ... `>>>groundingFence_7`); with no token, the markers are exactly
`DATA_OPEN`/`DATA_CLOSE` as before (no behaviour change for a caller that passes none).
`groundingJudgeRequest` takes this `token` as a plain optional string field and threads it into
every fence in the request (material, student message, reply), so all of one request's blocks
share one token and still nest the same way the un-tokened fence did.

`PostGuardCtx` gains `groundingFenceToken?: string` (not the raw `Ids` port — see Decisions);
`postGuard.ts` draws it once per step call via `env.deps.ids.next('groundingFence')` and passes it
down; `grounding.ts`'s `run()` reads `x.groundingFenceToken` and forwards it to
`groundingJudgeRequest`.

`testing/groundingJudge.ts`'s `BLOCK` regex (reads a fake judge's own request back apart, for
tests only) is widened from `/<<<\n([\s\S]*?)\n>>>/g` to `/<<<[^\n]*\n([\s\S]*?)\n>>>[^\n]*/g` so it
still finds exactly the same blocks whether or not a token is appended to the markers — see
Decisions (an edit outside the plan's named file list for this phase, not on the out-of-bounds
list, and needed for the feature to work with the existing fake-judge test tooling).

## Decisions
### 4 Nov 2026 · 4.7b fence() reuses breakFenceRuns, unmodified · decided by builder · risk: low
- Decided: `fence()` calls `breakFenceRuns` (imported from `pedagogy/modelRequest.js`) in place of
  its own regex; `breakFenceRuns` itself is untouched, so `pedagogy/modelRequest.test.ts`'s existing
  coverage of it (full-width, entities, zero-width padding, idempotence) is not re-proven here.
- Why: the plan's own item 1 names this exact reuse; `fence()`'s old regex only caught a literal
  ASCII run, missing full-width and entity-encoded look-alikes `breakFenceRuns` already handles.
- Alternatives: none — the plan named the exact fix.
- Reversible: yes.

### 4 Nov 2026 · 4.7b the token is drawn once per turn in postGuard.ts, not inside grounding.ts · decided by builder · risk: low
- Decided: `PostGuardCtx` gains `groundingFenceToken?: string` (a plain string), not `ids?: IdSource`
  as the plan's prose literally named. `postGuard.ts` calls `env.deps.ids.next('groundingFence')`
  once, when it builds `x` (the single `PostGuardCtx` object both passes of one turn's guard chain
  share); `grounding.ts` reads `x.groundingFenceToken` and never calls `.next()` itself.
- Why: TDD caught a real regression from the plan's literal reading (`x.ids.next('groundingFence')`
  called inside `grounding.ts`'s `run()`): the guard chain calls `run()` once per pass (1, then the
  verification pass), so a token drawn inside `run()` differs pass 1 vs. pass 2 even when the text
  judged is identical — `postGuard.ts`'s `judgeFor` memoises a judge call by the rendered request
  text, so a differing token on an unchanged reply forced a second real judge call on the
  verification pass every time, breaking the documented invariant
  (`postGuard.grounding.test.ts`'s "a premise correction or a number fix is replaced but never
  escalated": `fix.judged` went from `1` to `2`). Drawing the token once per `postGuard.ts` step
  call (shared by both passes, since `x` is built once and passed by reference) keeps that
  invariant: the judge-call cache still dedupes an unchanged reply on pass 2, while a fresh token
  is still drawn every turn (so two different turns' requests still differ, matching the plan's
  accept-line intent and this phase's own red/green test). Still uses the `Ids` port, never
  `Math.random`/`crypto`, per the brief's rule.
- Alternatives: memoise the token per `IdSource` instance in a `WeakMap` inside `grounding.ts`
  (rejected: `apps/worker/src/gate/agent.ts`'s `createGateAgent` builds one long-lived `ids` and
  reuses it across every turn an agent serves, so a per-instance cache would hand out the *same*
  token forever for that agent, not a fresh one per turn — defeats the whole point). Keep the
  literal `ids: IdSource` field and accept the extra judge call on every verification pass
  (rejected: a real cost/latency regression with no stated benefit — the plan's test list for this
  item never asked for it, and 4.7's idempotence rule is a design invariant, not just one item's
  test).
- Reversible: yes, a field-shape and call-site change; no port or contracts change.

### 4 Nov 2026 · 4.7b testing/groundingJudge.ts's BLOCK regex widened to tolerate a token · decided by builder · risk: low
- Decided: `BLOCK` (`testing/groundingJudge.ts`, the fake judge's own request-reader, test support
  code only) changed from `/<<<\n([\s\S]*?)\n>>>/g` to `/<<<[^\n]*\n([\s\S]*?)\n>>>[^\n]*/g`.
- Why: with a token appended straight after the markers (`<<<groundingFence_1`), the old regex
  (which needed `<<<` immediately followed by a newline) no longer matched at all, so the fake
  `overlapJudge` read every block as empty and mis-graded replies (caught by the existing
  `postGuard.grounding.test.ts` test "the overlap judge ... passes material-backed replies and
  catches invented ones", which started failing). The widened pattern still matches the bare,
  untokened form exactly as before (no token: `[^\n]*` matches zero characters).
- Alternatives: put the token on its own line inside the block instead of on the marker line
  (rejected: it would then be captured as block *content*, polluting `overlapJudge`'s word-overlap
  reading of the material/reply with an extra token word in every block). Leave the token out of
  the marker text entirely and mix it in elsewhere (rejected: defeats the point — the marker text
  itself must be the thing a chunk or the student's message cannot pre-stage).
- Reversible: yes, a one-line regex change in a test-support file; not a product file, not on the
  plan's named-file or out-of-bounds lists for this phase.

## Red -> green evidence
- `breakFenceRuns` reuse: before the fix, `groundingJudgeRequest({ reply: 'See ＜＜＜ here.',
  chunks: [chunk('Entities: &lt;&lt;&lt; too.', ...)] })` left both runs intact in `req.user` (the
  old regex only matched ASCII `<{3,}`/`>{3,}`); after, both are broken to `< < <` and neither raw
  form (`＜＜＜`, `&lt;&lt;&lt;`) survives.
- Per-request token: before, two `groundingJudgeRequest` calls with the same or different
  `sequentialIds()`-drawn tokens produced the exact same `<<<`/`>>>` text; after, each call's fence
  carries its own token (`<<<groundingFence_1` vs. `<<<groundingFence_2`), so the two requests
  differ; with no token passed, the request is byte-identical to the pre-Phase-C text (regression
  check, same assertion as Phase A/B's own unmodified "no student text" case).
- Pass 1/pass 2 cache regression (not in the plan's own test list, found by running the full gate
  after the first implementation): `postGuard.grounding.test.ts`'s "a premise correction or a
  number fix is replaced but never escalated" went from green to `fix.judged` length `2` (expected
  `1`) under the plan's literal `ids: IdSource` design; green again after moving the token draw to
  `postGuard.ts` (once per step call, shared by both passes).
- `testing/groundingJudge.ts`'s fake judge regression (also found by the full gate, not anticipated
  by the plan's test list): "the overlap judge (non-circular fake) passes material-backed replies
  and catches invented ones" went from `{ result: 'replace', escalateToTeacher: true }` to
  `{ result: 'ok' }` (the fake misread an unterminated-looking block as ungrounded-proof instead of
  reading the reply at all) under the tokened marker; green again after widening `BLOCK`'s regex.

## Gate
- `packages/harness`: `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness` — all
  4 tasks successful (typecheck, lint, test, build). `src/guardrails/**` at 100%
  lines/branches/functions/statements (vitest's coverage table; `guard.ts`/`index.ts` show 0/0/0/0,
  type-only re-export files with no executable statements, same as every prior guardrails phase).
- `packages/harness/src/guardrails/grounding.test.ts`: 66 tests passed (was 63 after Phase B; +3 new).
- `packages/harness/src/pipeline/steps/postGuard.grounding.test.ts`: 17 tests passed, unchanged
  count (one test's internal assertions were exercised by this phase's own fix, no new test added
  here — the regression was caught and fixed, not newly tested, since it was an existing case).
- `packages/harness/src/pedagogy/modelRequest.test.ts`: unchanged, passing (confirms `breakFenceRuns`
  itself was not touched).
- `prettier --check` on the six touched files: clean (after one `--write` pass on `grounding.ts`
  and `grounding.test.ts`).
- `python3 .githooks/secret-scan.py --all`: exit 0, clean.
- Note: the plan's exact gate command, `--filter=...@edmate/harness` (dependency direction), also
  ran `@edmate/content`'s tests, which failed on an unrelated flaky timing-probe test
  (`safeRegex.test.ts`, a 5-second timeout on a regex-timing assertion) — infra timing, nothing
  touched by this phase. `--filter=@edmate/harness` alone (no dependents) is green, same posture as
  Phases A and B's own handoff notes.

## Budget
Tool calls used: ~55 (plan budgeted 50 for Phase C; the extra calls traced and fixed the two
regressions above, neither anticipated by the plan's own test list).

## Fix round 1

## Findings
1. **[HIGH]** `packages/harness/src/pipeline/generate/citations.ts:26` — `CITATION_VARIANT`'s
   bare `"source N"` form matched ordinary prose (`invalidCitations("The light source 2 meters
   away heats the plate.", 1)` returned `[2]`), so `grounding.ts` escalated a reply that never
   attempted a citation.
2. **[HIGH]** `packages/harness/src/pipeline/generate/numbers.ts:579-581` — `CLAIM_BEFORE` fired
   on ordinary `"<N> for <expr> <noun>"` word-problem phrasing (`arithmeticClaims("Split 20 for
   5 * 2 friends.")` and `arithmeticClaims("Pay 15 for 3 + 4 tickets.")` each produced a false
   `correct:false` claim), so `premiseUncorrected` (Rule C) issued a spurious premise correction.

## Red -> green evidence
- `citations.test.ts`, new test `'fix round 1 (4.7b): bare "source N" needs citation context,
  not just the word'`: before the fix, `invalidCitations('The light source 2 meters away heats
  the plate.', 1)` returned `[2]` (red, confirmed against the reviewer's exact sentence);
  `CITATION_VARIANT`'s bare-form alternative now requires citation context (inside `[...]`/`(...)`
  or right after `see`/`per`/`cite`/`cited in`/`according to`) — after the fix, `[]` (green). The
  sibling test for the bracket/cue forms (`'[source 4]'`, `'(source 4)'`, `'per source 4'`,
  `'cite source 4'`, `'cited in source 4'`, `'according to source 4'`) stayed green throughout
  (never red — added alongside the regression test as the positive half of the same fix).
- `numbers.claims.test.ts`, new test `'fix round 1 (4.7b): an ordinary "N for expr noun" word
  problem is not a reversed claim'`: before the fix, `arithmeticClaims('Split 20 for 5 * 2
  friends.')` returned one claim (`computed: 10, correct: false`, matching the reviewer's
  reproduction); `CLAIM_BEFORE`'s match now also requires a claim cue (`got`/`get`/`gets`/`is`/
  `was`/`equals`/`=`/`answer is`/`i think`/`i said`, or nothing — the number opening its own
  clause) directly before the number, and when the connector is `"for"`, the expression must end
  its clause (no trailing noun). After the fix, both reviewer sentences give `[]` (green).
- Confirmed no existing assertion was edited: `grounding-falsepremise-reversed-en`
  (`packages/evals/src/groundingFixtures.test.ts`) and the plan's own `'I got 4 for 7 // 2'` case
  (`numbers.claims.test.ts`) still pass unchanged — `got` directly precedes the number, and the
  expression ends at end-of-text, so both new conditions hold for that case.

## Gate
- `corepack pnpm install --frozen-lockfile`: clean.
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness`: `citations.test.ts`
  (16 -> 18 tests) and `numbers.claims.test.ts` (+1 test) both green;
  `packages/evals/src/groundingFixtures.test.ts` 46 tests passed, unchanged. Two unrelated
  failures appeared, both confirmed pre-existing/flaky by rerunning in isolation (green alone):
  `apps/cli`'s `chatDbRetrieval.int.test.ts` (dev Postgres is broken locally, per the brief — CI
  runs it) and, as collateral from that same broken connection, `apps/cli`'s `gate.test.ts` one
  timeout (19/19 green run alone); `packages/queue`'s `turnLimits.int.test.ts` sliding-window
  timing assertion (104/104 green run alone); `packages/harness`'s `distressKeywords.test.ts` and
  `preGuard.test.ts` each one 5s-timeout flake under load (282/282 green run alone).
- `src/guardrails/**` coverage: 100% lines/branches/functions/statements (full `@edmate/harness`
  `vitest run --coverage`, exit 0, no threshold `ERROR` lines).
- `prettier --write` then `--check` on `numbers.ts` (one reformat), `citations.ts`,
  `citations.test.ts`, `numbers.claims.test.ts`: clean.
- `python3 .githooks/secret-scan.py --all`: exit 0, clean.

### Decisions
### 4 Nov 2026 · 4.7b citation bare "source N" needs citation context · decided by builder · risk: low
- Decided: `CITATION_VARIANT`'s no-brackets `"source N"` alternative now only matches inside
  `[...]`/`(...)` or directly after a citation cue (`see`, `per`, `cite`, `cited in`,
  `according to`); the bracketed-number form (`"[ 3 ]"`, full-width digits) is unchanged.
- Why: the reviewer's scratch test showed the old, unconditional bare form matching ordinary
  science prose ("the light source 2 meters away"), turning a normal reply into a false
  escalation.
- Alternatives: drop the bare `"source N"` form entirely (rejected: it was added in Phase B to
  close a real dodge, `"See source 4."` with no brackets; the lead's fix shape asks for
  citation-context scoping, not removal).
- Reversible: yes, a regex change.

### 4 Nov 2026 · 4.7b CLAIM_BEFORE needs a cue word and a clause-ending "for" · decided by builder · risk: low
- Decided: `CLAIM_BEFORE`'s number only counts as a reversed claim when (a) a claim cue
  (`got`/`get`/`gets`/`is`/`was`/`equals`/`=`/`answer is`/`i think`/`i said`) sits directly before
  it, or nothing does, and (b) when the connector matched is `"for"`, the expression ends its
  clause (end of text, `.`, `,`, `?`, `!`, no trailing noun).
- Why: the reviewer's scratch test showed the old pattern reading an ordinary word-problem's own
  number ("Split 20 for 5 * 2 friends.") as a reversed claim about the expression, since `"for"`
  was added as a connector in Phase A for exactly this direction but without a cue requirement.
- Alternatives: drop `"for"` from `CONNECTOR_BEFORE` entirely (rejected: the plan's own
  red/green case, "I got 4 for 7 // 2", needs it). Require the clause-ending check for every
  connector, not only `"for"` (considered, not needed: the cue-word requirement alone already
  excludes both reviewer sentences, since "Split"/"Pay" are not cue words; the clause-ending
  check is additive safety for a cued `"for"` case the reviewer did not test, e.g. "I got 20 for
  5 * 2 friends.").
- Reversible: yes, two added checks around the existing regex match.
