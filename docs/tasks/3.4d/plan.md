# 3.4d plan: 3.4c review LOWs — precedence test hardening, mergeByScore id tie-break, cast cleanup

**Id collision check:** `docs/tasks/3.4d/` held no files before this plan (no stray `handoff.md`/`review.md`
from an earlier task). Not a collision — proceeding.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Same-topic fix follow-ups (3.4c review LOWs): make the 'agent context alone would cover'
buildContext test really cover (combined query >= 0.5) so locked precedence is tested; give
mergeByScore the id tie-break the plan describes, or update the plan; replace the as-unknown-as
casts in sameTopic.test.ts with a typed helper; apps/cli sameTopic.test.ts 'three same-topic
allowed turns' flaked once in CI (turn ended in error, passed on re-run, PR #78, 20 Oct 2026):
find the cause"

Accept: "removing locked precedence fails the coverage test through the gate assertion, not only
through the module check; mergeByScore ties are ordered by id"

### How it is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| Precedence test really tests precedence | `buildContext.test.ts`'s "locked precedence" case: the agent-widened combined query's raw overlap score against the allowed chunk is now >= `DEFAULT_COVERAGE_THRESHOLD` (0.5), while the student's own words still hit the locked module. Mutation check (temporary, not committed): change `found = probe.hit ? own : mergeByScore(own, ctx, K)` to always `mergeByScore(own, ctx, K)` and confirm the test's `coverageGate(...).toBe('locked')` assertion (not only the "no chunk from mod_test_02" loop) now fails; paste the failing output, then revert. |
| mergeByScore tie-break | New case in `buildContext.test.ts`: two chunks with equal, defined scores from `own` and `ctx` respectively (own listed after ctx in insertion order, so a stable sort alone would *not* put them in id order) sort ascending by id. Existing "merges own and context searches..." case (distinct scores) stays green unchanged. |
| sameTopic.test.ts casts | Both `deps.sessionState as unknown as { saved: ... }` sites replaced by one typed helper using `MemorySessionStateStore` (already exported from `@edmate/harness/testing`); `pnpm turbo run typecheck --filter=@edmate/cli` is clean with no remaining `as unknown as` in this file. |
| CI flake finding | Handoff names the cause: 3.9b (done, `m3/3.9b-cli-chat-flake`) already fixed this exact symptom (a cold first turn's real-clock timeout on a loaded runner, PR #78) with `slackClock`/`STEP_BUDGET_SLACK` and the error-event-printing assertion pattern; `sameTopic.test.ts` already carries both (confirmed by reading the file before any edit). No further runtime change; the existing `expect(events.filter(e => e.type === 'error'), JSON.stringify(result.trace?.steps)).toEqual([])` assertions are the deterministic guard — any future error event fails loud with the trace instead of a silent timeout. |
| Gates | `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness --filter=@edmate/cli` green; locked suite (`packages/evals/src/lockedFixtures.test.ts`) unaffected (not touched); `python3 .githooks/secret-scan.py --all` clean. |

## Files

Modify only:
- `packages/harness/src/pipeline/steps/buildContext.ts` — `mergeByScore`'s sort comparator: after
  the existing undefined-score branches, add an explicit ascending-id tie-break for equal, defined
  scores (`a.score === b.score ? (a.id < b.id ? -1 : 1) : b.score - a.score`), so order no longer
  depends on `own`/`ctx` insertion order for ties. Update the function's header comment (currently
  says "keeping `own`'s rank order (stable sort)") to describe the id tie-break instead. No other
  line in this file changes — `found`, `candidates`, locked precedence and the rest of `buildContext`
  are untouched.
- `packages/harness/src/pipeline/steps/buildContext.test.ts`:
  - Edit the existing "locked precedence (3.4c)" case's student text and/or agent history text
    (`retrievalWorld()`'s `chk_world_03` text is fixed, so trim unmatched words from the student
    text and/or the agent reply) until the combined query's raw overlap score against
    `chk_world_03` is >= 0.5, confirmed by the mutation check above, while the student's own words
    alone still score > 0 against the locked `chk_world_04` chunk (`b.lockedHit` stays `true`).
    Keep the existing module-check loop (`for (const c of b.retrieved) expect(c.moduleId).not.toBe('mod_test_02')`).
  - Add one new case for the id tie-break, next to the existing merge case.
- `apps/cli/src/commands/chat/sameTopic.test.ts` — add one small typed helper (e.g.
  `function savedHelpStates(deps: PipelineDeps): MemorySessionStateStore['saved']`, casting
  `deps.sessionState as MemorySessionStateStore` — a direct cast is enough since
  `MemorySessionStateStore extends SessionStateStore` and `PipelineDeps['sessionState']` is typed
  `SessionStateStore`, so `as unknown as` is not needed); import `type MemorySessionStateStore` from
  `@edmate/harness/testing`; use the helper at both current cast sites (`withHelpStateReload` and the
  "last saved help state" assertion). No behaviour change, no new test case needed for this part
  (existing assertions already exercise it).

Handoff only (no code beyond the above):
- Log the CI-flake finding (3.9b already fixes this; no further change) as a decision.

## Not in scope / don't touch

- `packages/harness/src/pipeline/steps/retrievalQuery.ts` / `.test.ts` — unchanged; 3.4d does not
  touch query shaping, only `mergeByScore`'s tie-break and one test's wording.
- `packages/harness/src/access/**`, `packages/harness/src/guardrails/**`,
  `packages/harness/src/pedagogy/**`, `packages/harness/src/testing/memoryRetrieval.ts`,
  `retrievalContract.ts` — scopedRetrieval, the probe scorer, coverageGate and the threshold are
  unchanged (same boundary 3.4c drew).
- `packages/db/**`, `packages/db/test/**`, `apps/web/app/staff/**`, `apps/web/app/api/staff/**` —
  other builders' files; not touched regardless of findings.
- `apps/cli/src/commands/chat/deps.ts` and other CLI sources — `slackClock`/`worldSessionStateStore`
  stay as 3.9b/5.8a left them; the cast fix is test-file-only.
- `packages/contracts/**`, `evals/suites/**`, `content/**` — untouched.
- If investigating the CI flake turns up a *new*, different cause from 3.9b's (unlikely, since the
  fix pattern is already present in this file) that needs a production source change outside
  `sameTopic.test.ts`, stop and hand back as PARTIAL rather than widening scope.

## Tests first (tdd-guide order)

1. Edit the "locked precedence" case's text; run `buildContext.test.ts` and confirm it still passes
   on current `main` code (it should — we're only tightening what it proves, not changing the
   assertion).
2. Do the mutation check (precedence code temporarily bypassed) and confirm the edited test now
   fails through `coverageGate`'s assertion; paste that failing output into the handoff; revert the
   mutation.
3. Add the id tie-break to `mergeByScore`; write the new tie-break test case first, watch it fail on
   unmodified `mergeByScore` (ties keep insertion order, not id order), then make it pass.
4. Add the `sameTopic.test.ts` typed helper; typecheck clean, existing test still green.
5. Full gate (below).

## Risky paths touched

Checked against `.claude/skills/merge-gate/risk-paths.txt`: `packages/harness/src/pipeline/steps/**`
and `apps/cli/src/commands/chat/sameTopic.test.ts` match no glob (not `access/**`, `guardrails/**`,
`pedagogy/**` or any other listed group). **None (checked against risk-paths.txt).** No required
reviewer group; `code-reviewer` and `typescript-reviewer` review as usual (every PR / TS-shaped
change), but no `risk: high` decision is required — this task hardens a test and adds a
deterministic tie-break; it does not change when a turn is judged `locked`, the probe, or the
coverage threshold.

Log in the handoff as a plain (not `risk: high`) decision: "mergeByScore's equal-score tie-break is
now explicit (ascending id) instead of relying on stable-sort insertion order; only ties can change
order, matching 3.4c's plan text."

## Gate

No harness export changes (`mergeByScore` stays unexported). Touches `@edmate/harness` and
`@edmate/cli` only:
```
corepack pnpm turbo run typecheck lint test --filter=@edmate/harness --filter=@edmate/cli
```
Plus `corepack pnpm exec prettier --check` on changed files and
`python3 .githooks/secret-scan.py --all`.

## Open questions

None blocking. If the mutation check shows the retargeted precedence test still can't be made to
fail without touching `retrievalWorld()`'s fixture text (out of scope here), stop and hand back
PARTIAL with the finding rather than editing `memoryRetrieval.ts`.

## Budget

Budget: 45 tool calls (1 phase, @edmate/harness + @edmate/cli)

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (tests, typecheck/lint, prettier --check, secret-scan, and
`git log`/`git show` read-only for the CI-flake check only)

## Exit conditions

Status: DONE when the retargeted precedence test is green and its mutation-check failure is
recorded in the handoff, the new tie-break test is green, `sameTopic.test.ts` has no remaining
`as unknown as`, the CI-flake finding is logged, and the gate above is clean. Status: PARTIAL past
~50 tool calls, or if closing any item needs a change outside the files listed above (for example a
`retrievalWorld()` fixture edit or a production CLI-source change) — stop and hand back with what
was found.
