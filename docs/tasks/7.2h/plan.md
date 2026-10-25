# 7.2h: decisive vapes-at-school moderation rule + near-miss guard + eval case

Deps: 7.2d (done). Board accept (verbatim): "harness guard test for the new rule; the safety
suite gains the vapes case; harness and evals green; safety-reviewer runs (guard change)."

How shown: the new rule and near-miss exemption live in `moderationPatterns.ts`; a true-positive
and (if the suite format allows, which it does — existing `*-nearmiss-*` files already sit inside
`evals/suites/safety/moderation/`) a near-miss case are added under
`evals/suites/safety/moderation/`; `moderationPatterns.test.ts` gains matching assertions; pinned
counts in `packages/evals/src` are bumped the same way 7.2d did it (see
`docs/tasks/7.2d/handoff.md`).

## Decision noted here (lead logs on merge)
Per the MVP-first rule, `safety-reviewer` does not run per PR until task 13.3's whole-system
review, even though this board task's `accept` line names it. The lead defers that reviewer to
13.3 and logs the deferral as a decision alongside this PR's required `risk: high` entry (same
pattern as every 7.2d/4.4-era guard change). `code-reviewer` and `typescript-reviewer` (always
required) are the reviewers for this PR.

## Files to create/modify
1. `packages/harness/src/guardrails/moderationPatterns.ts` — add one decisive rule: buying or
   selling vapes at school/class/campus (transaction verb: buy/get/sell/selling/resell/trade +
   "vape(s)"/"vaping" + a school-context word, mirroring the existing `sneak/smuggle ... into
   school` weapons rule's shape). Code it under `other_unsafe` (the code already used for the drug
   buy/sell precedent) unless the builder finds a closer fit while reading the file — note the
   choice in the handoff. Add a near-miss exemption (`unless`, same mechanism as the bomb-making
   `GAME` exemption) or simply rely on the transaction-verb requirement so a "vape-detector science
   project" or a "health-class essay on vaping risks" (no buy/sell verb) never matches — prove this
   with the near-miss assertions below, don't just assert it in a comment.
2. `packages/harness/src/guardrails/moderationPatterns.test.ts` — add one entry to
   `SEEDED_MODERATION` (the true positive, buy/sell vapes at school) and one entry to
   `SEEDED_NEAR_MISSES` (pick one of the two near-miss themes the board gave; add the second too if
   it's a one-line addition). Keep the existing loop/assertion shape; do not rewrite the file.
3. `evals/suites/safety/moderation/` — one new true-positive YAML (`must_block: true`, same shape
   as `safety-moderation-sneak-knife-school-en.yaml`: id, suite, package, reviewed_by: lead,
   source citing this task, turns/expect/judge). Read one existing `*-nearmiss-*` file in the same
   folder first (e.g. `safety-moderation-nearmiss-gun-game-unity-en.yaml`) for its exact
   `must_block`/`expect` shape before writing the matching near-miss YAML.
4. `packages/evals/src/suites.ts` — bump `SUITE_FLOORS.safety` by however many new case files land
   (1 if only the true positive, 2 if the near-miss YAML is added too).
5. `packages/evals/src/suites.test.ts` — bump the pinned `SUITE_FLOORS` expectation the same way.
6. `packages/evals/src/moderationJailbreak.test.ts` — bump the pinned `seededMod` count (and
   `seededNear` if a near-miss YAML is added) and its description string, mirroring 7.2d's edit to
   this file exactly (read that diff via `docs/tasks/7.2d/handoff.md` before touching it — this is
   the "red CI from a stale pinned count" lesson in `docs/lessons.md`).
7. `docs/tasks/7.2h/handoff.md` — written by the builder at the end.

## Files out of bounds
Everything else: no distress keyword tables, no other guard files, no other eval suites (leak,
pedagogy, locked, persona, advice, PII, jailbreak, distress), no `.claude/`, no `packages/contracts`
(this is not a contracts change — no ADR needed), no locale packs.

## Tests first
Write the two new assertions in `moderationPatterns.test.ts` (true positive hits decisively with
the chosen code; both near-miss strings hit nothing) before touching the regex table itself, same
TDD order as every prior rule addition in that file.

## Risky paths touched
- `packages/harness/src/guardrails/` — matches risk-paths.txt; reviewers: `code-reviewer`,
  `typescript-reviewer` (always required; `safety-reviewer` deferred to 13.3 per the decision
  above).
- `evals/suites/safety/` — matches risk-paths.txt; same reviewer set as above.
A `risk: high` decision is required on this PR's merge (guard-table change on a safety path).

## Open questions
None — the board task's scope, code path and near-miss themes are fully specified; 7.2d's left-to-do
note already flags this exact gap.

## Acceptance evidence (exact)
- `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/harness --filter=@edmate/evals`
  — all tasks green (this is the real package name pair; confirmed from both `package.json` files).
- `python3 .githooks/secret-scan.py --all` — clean.
- `moderationPatterns.test.ts`: the new `SEEDED_MODERATION` entry hits decisively with the chosen
  code; the new `SEEDED_NEAR_MISSES` entry(ies) hit nothing.
- `evals/suites/safety/moderation/` contains one new true-positive vapes case (`must_block: true`,
  `reviewed_by: lead`) and, if added, one new near-miss case in the same format as the existing
  `*-nearmiss-*` files there.
- `packages/evals/src/suites.ts`, `suites.test.ts` and `moderationJailbreak.test.ts` pinned counts
  match the new file count exactly (no stale snapshot — see the lessons-file CI warning above).
- Handoff logs a `risk: high` decision for this PR and the lead's deferral of `safety-reviewer` to
  13.3, per the note above.

## Budget
Budget: 30 tool calls (1 phase, packages/harness + packages/evals)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (typecheck/lint/test for @edmate/harness and @edmate/evals, and
the secret scan, only)

## Exit conditions
Status: DONE when the gate above is green, the new rule's true positive and both near-misses pass,
and pinned counts are updated with no stale snapshot. Status: PARTIAL past ~35 tool calls, or if a
file outside this list needs changes (e.g. a shared helper in `rulePhrases.ts` turns out to need a
new primitive) — stop and hand back rather than expanding scope.
