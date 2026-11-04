# Handoff: 4.4c — pre-guard follow-ups on a failed chain

Status: DONE

## Summary
When the pre-guard classifier chain fails entirely (`!pg.ok`), the runner now also runs the
pure, synchronous rule tables (`matchModeration`, `matchJailbreak`) against the raw text before
falling back to the generic `guard_blocked` error:
- A decisive `harm_to_others`/`threat`/`weapons` hit blocks with that code's own reply
  (`blockReplyFor`) and raises a `misuse`/`critical` `SafetyAlert`, the same shape as the
  already-working `pg.ok` block path.
- A decisive jailbreak hit blocks with its own override reply, no alert (matches the normal-chain
  jailbreak block behaviour).
- A decisive `self_harm` moderation hit folds into the existing distress-escalate branch (the rule
  table is a better detector than the plain keyword lists already checked there).
- Negative controls (plain text, a plain hard keyword) are unchanged.

Separately, when the router labels a turn `distress` and preGuard's own verdict is `block` with a
misuse alert attached, "escalate beats block" used to show the caring reply and silently drop
`pg.value.alert`. The runner now also reads that alert and threads it through `escalate()` →
`sendEscalation()` as a second alert to deliver (the caring reply still wins; both alerts reach
`AlertSink`, deduplicated by `id` so the same alert is never raised twice). The commit record's own
`alert` field keeps today's single-alert shape (the primary/distress alert only) — no
`packages/contracts` change.

`guardrails/moderationIn.ts`'s `preGuardAlert` now accepts
`Pick<PreGuardCtx, 'ids' | 'entitlement' | 'sessionId' | 'clock'>` instead of a full `PreGuardCtx`,
so the runner's failed-chain fallback can build a small compatible context object instead of a full
`PreGuardCtx`. This was already on the branch as a stalled builder's WIP commit; kept as-is.

## Decisions

### 4 Nov 2026 · 4.4c skip writing a safety_event in the rule-table fallback · decided by builder · risk: low
- Decided: the runner's new `!pg.ok` rule-table fallback does not write a `safety_event`
  (`ctx.safetyEvents.record`).
- Why: matches the lead's 30 Oct 2026 review answer to open question 1 and the narrow accept
  criterion ("still raises a misuse alert"); the alert still reaches the trust team through
  `AlertSink`, and the withheld commit record still counts toward strikes via `withheldCode`.
- Alternatives: write a `safety_event` from the fallback too, matching what the real
  `moderationIn`/`jailbreak` guards record on a decisive hit.
- Reversible: yes — a follow-up task can add the safety_event write if a future consumer (e.g. a
  staff dashboard) needs the failed-chain path represented there.

### 4 Nov 2026 · 4.4c kept test case 4 (self_harm rule-table gap exists) · decided by builder · risk: low
- Decided: kept test case 4 (a decisive `self_harm` moderation rule hit whose wording is not
  covered by the plain distress-keyword lists) rather than dropping it.
- Why: `moderationPatterns.ts`'s first `self_harm` decisive rule matches
  `(?:blade|...|gun)<gap> (?:on|against|to hurt|to harm|to cut) <SELF>` — "I'm pointing a gun
  against myself right now" is a decisive hit, but neither `distressKeywords.ts`'s HARD nor SOFT
  lists contain "gun" or "against" anywhere, so the gap the plan flagged as possibly-absent does
  exist.
- Alternatives: drop the case per the plan's fallback instruction if no gap is found (not taken,
  since a gap was found).
- Reversible: yes — a test case, easy to remove if the tables are later reconciled.

### 4 Nov 2026 · 4.4c dedup delivered alerts by id · decided by builder · risk: low
- Decided: `sendEscalation()` now raises a de-duplicated set of alerts (primary/distress alert plus
  the optional misuse alert carried over from preGuard's own block verdict), comparing by
  `SafetyAlert.id`, instead of assuming the two are always distinct.
- Why: the lead's review explicitly asked to guard against the same alert being raised twice and
  to test that it is raised exactly once; the two alert sources (`pg.value.result === 'escalate'`
  vs `pg.value.result === 'block'`) are mutually exclusive by the discriminated union today, but
  the dedup is a cheap defensive measure against a future code path that could set both.
- Alternatives: assume the two alerts are always distinct and raise both unconditionally.
- Reversible: yes — a small, local change inside `sendEscalation()`.

### 4 Nov 2026 · 4.4c jailbreak fallback uses only the student's own package name · decided by builder · risk: low
- Decided: the runner's failed-chain jailbreak check calls `matchJailbreak(text, { packageNames:
  [e.pkg.name], currentPackageName: e.pkg.name })` — the student's own package name only, not a
  full teacher-wide package list.
- Why: matches the plan's instruction ("own package name only ... no new async read, keeps this
  fallback synchronous and in-budget"); a full list would need an extra read inside an already
  degraded (classifier-down) path.
- Alternatives: read the teacher's full package list for a more complete jailbreak check.
- Reversible: yes — a local call-site change if a cheap synchronous source for the full list
  becomes available later.

## Red -> green evidence
Before the fix (sanity-checked via a temporary `git stash` of `runner.ts` only, then restored):
running `vitest run src/pipeline/runner.test.ts src/pipeline/runner.block.test.ts` with only the
new test cases added (no implementation change) produced 5 genuine failures — the 4 new
`runner.test.ts` cases (harm_to_others, threat/weapons, jailbreak-only, self_harm-rule-table) and
the 1 new `runner.block.test.ts` case (router distress label dropping the misuse alert) — all
failing on the pre-fix behaviour (`guard_blocked` with no alert, or the alert silently dropped).

After the implementation (`runner.ts`'s new `ruleTableFallback()`/`ruleFallbackAlertCtx()` methods,
the `extraAlert` threading through `escalate()`/`sendEscalation()`, and the dedup-by-id alert
delivery): the same two files pass in full — `vitest run src/pipeline/runner.test.ts
src/pipeline/runner.block.test.ts` → 2 files, 65 tests, all passing.

## Gate
`corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness`:
- typecheck: pass (`@edmate/harness:typecheck` + `@edmate/contracts:build` succeed).
- lint: pass, no errors.
- test: two turbo runs through the full monorepo graph hit unrelated flakes under parallel load —
  a timing test in `@edmate/content`'s `safeRegex.test.ts` timed out once, and two 5000ms-timeout
  tests in `@edmate/harness` (`distressKeywords.test.ts`, `preGuard.test.ts`) timed out once under
  the same contention; none of these are files this task touches, and both of the harness ones
  pass cleanly (282/282) when re-run in isolation (`vitest run
  src/guardrails/distressKeywords.test.ts src/pipeline/steps/preGuard.test.ts`).
- Confirmed with a dedicated, isolated full run of the harness package (`vitest run --coverage`
  inside `packages/harness`, no turbo/cross-package contention): **131 test files, 6039 tests, all
  passing**; coverage summary `Statements 99% / Branches 97.25% / Functions 98.65% / Lines 99.5%`
  overall, with `src/guardrails/**` at 100% (the coverage reporter's `skipFull` hides fully-covered
  folders from the table; no threshold error was raised, and `vitest.config.ts` enforces a hard
  100% threshold specifically for `src/guardrails/**`, so a shortfall there would have failed the
  run).
- `prettier --check` on the three touched files: ran, found formatting drift introduced by my
  edits, fixed with `prettier --write`, re-ran tests (65/65 still pass) and `prettier --check`
  again: clean.
- `python3 .githooks/secret-scan.py --all`: clean, no findings.

Test counts for this task's own new/changed cases: 9 planned test cases, all 9 present and passing
(case 4's gap was found to exist, so it was kept rather than dropped) — 4 new cases in
`runner.test.ts`, 1 new case in `runner.block.test.ts`, plus the existing negative-control cases
(5, 6, 8, 9) all still passing unchanged.

## Budget
Tool calls used: approximately 40 in this continuation session (gate re-runs, prettier fix,
secret scan, this handoff) on top of the prior session's work before the compaction/stall. Plan
budget was 85 tool calls; this session picked up from a stalled continuation rather than tracking
a single running count, so the total across both sessions is estimated at ~95-110 tool calls,
modestly over budget due to the lint-fix round and the flaky-test investigation requiring extra
gate re-runs.
