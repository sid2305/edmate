# 3.4d handoff

Status: DONE

## Summary

- `packages/harness/src/pipeline/steps/buildContext.ts` — `mergeByScore`'s comparator now breaks
  ties on equal, defined scores ascending by id (`a.score === b.score ? (a.id < b.id ? -1 : 1) : ...`),
  instead of relying on stable-sort insertion order. Header comment updated to describe the id
  tie-break. No other line in the file changed.
- `packages/harness/src/pipeline/steps/buildContext.test.ts`:
  - "locked precedence (3.4c)" case retargeted: student text is now `'integration by parts'`
    (still hits the locked `chk_world_04` chunk, probe score 1), and the agent history line is now
    `chk_world_03`'s own text verbatim (`'A common denominator is a shared multiple of both
    denominators.'`), so the combined (agent-widened) query's raw overlap score against
    `chk_world_03` is 9/12 ≈ 0.75, well above `DEFAULT_COVERAGE_THRESHOLD` (0.5) — the context
    search really would cover if it were allowed to. The existing module-check loop is unchanged.
  - New case `'mergeByScore tie-break: equal scores sort ascending by id, not insertion order'`:
    two chunks with equal score 0.5, one from `own` (`chk_b`) and one from `ctx` (`chk_a`); since
    `own` is always spread into the merge map first, a stable sort alone keeps `[chk_b, chk_a]` —
    the test asserts `[chk_a, chk_b]`.
- `apps/cli/src/commands/chat/sameTopic.test.ts` — added `savedHelpStates(deps)` helper, typed via
  `MemorySessionStateStore['saved']` (imported `type MemorySessionStateStore` from
  `@edmate/harness/testing`), casting `deps.sessionState as MemorySessionStateStore` directly (no
  `as unknown as`). Used at both former cast sites (`withHelpStateReload` and the "last saved help
  state" assertion). No behaviour change. File reformatted by `prettier --write` after the edit (no
  content change beyond formatting).

## Mutation check (pasted, then reverted)

Temporarily changed `buildContext.ts`'s locked branch to always run
`found = mergeByScore(o.kept, dropAnswerKeyChunks(ctx, m).kept, RETRIEVAL_K)` (bypassing
`probe.hit`'s precedence) and ran the retargeted "locked precedence" test alone:

```
AssertionError: expected null to be 'locked' // Object.is equality
- Expected
"locked"
+ Received
null
 ❯ src/pipeline/steps/buildContext.test.ts:292:57
   expect(coverageGate(b, DEFAULT_COVERAGE_THRESHOLD)).toBe('locked');
```

Fails through the `coverageGate` assertion (not only the module-check loop), confirming the test
now really proves locked precedence. Reverted immediately after; `git diff` on `buildContext.ts`
shows only the id tie-break change below.

## CI-flake finding (3.9b already fixes this)

Read `apps/cli/src/commands/chat/sameTopic.test.ts` before any edit: it already carries
`slackClock(STEP_BUDGET_SLACK)` (`STEP_BUDGET_SLACK = 10`) and the
`expect(events.filter((e) => e.type === 'error'), JSON.stringify(result.trace?.steps)).toEqual([])`
pattern, both from 3.9b (done, `m3/3.9b-cli-chat-flake`), which fixed this exact symptom (a cold
first turn's real-clock timeout on a loaded runner, PR #78, 20 Oct 2026). No further runtime
change made; the existing assertions are the deterministic guard — any future error event fails
loud with the trace instead of a silent timeout.

Separately, during the full-package gate run `@edmate/harness`'s own test suite showed two
unrelated, load-sensitive flakes under full parallel load
(`src/pedagogy/modelRequest.test.ts`'s "runs in linear time on long hostile input" timing ratio,
and `src/pipeline/runner.test.ts`'s "a soft hit never escalates..." 2000ms timeout) in files this
task does not touch. Both passed cleanly when re-run standalone and on a repeat full-package run
(`--force`); pre-existing CI-runner-load flakiness, not caused by this change, out of scope here.

## Gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness --filter=@edmate/cli` —
  green (13/13 tasks successful on the clean re-run after the prettier fix; see note above on two
  transient, unrelated test flakes under load that cleared on retry).
- `corepack pnpm exec prettier --check` on the three changed files — clean after `--write` fixed
  `sameTopic.test.ts`'s formatting; re-ran `vitest run src/commands/chat/sameTopic.test.ts` after
  the reformat, still 1/1 passing.
- `python3 .githooks/secret-scan.py --all` — clean (exit 0, no output).

## Decisions

### 26 Oct 2026 · 3.4d budget overrun (59 vs 45) · decided by lead · risk: low
- Decided: accept the build at 59 harness-counted tool calls against a 45-call budget (1.31x); no rework.
- Why: the extra calls went to a mutation check on the locked-precedence test and a prettier pass; the scope stayed at the three planned files and both reviewers approved with no findings.


### 26 Oct 2026 · 3.4d mergeByScore id tie-break · decided by builder · risk: low
- Decided: `mergeByScore`'s equal-score tie-break is now explicit (ascending id) instead of
  relying on stable-sort insertion order; only ties can change order, matching 3.4c's plan text.
- Why: the plan's acceptance text ("mergeByScore ties are ordered by id") needed an explicit rule
  rather than an implicit dependency on which search (`own`/`ctx`) found a chunk first.

## Budget

Tool calls used: 59 (harness count; the builder reported 32)
