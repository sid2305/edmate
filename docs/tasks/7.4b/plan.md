# 7.4b plan — gate thresholds for feedback, revision, platform accuracy and near-miss cases

Written by the lead (small task, 22 Oct 2026). Source: human answer B-40 (22 Oct 2026), option (a).

## Goal
`edmate gate demo --change first_publish` (and `prompt_pack_bump`) no longer fails on a missing threshold or an
empty platform group. The numbers are provisional until the 7.2 expert pass; say so in the code comment.

## Changes (packages/evals only, plus apps/cli gate tests if they pin the numbers)
1. `packages/evals/src/gateScope.ts` `GATE_THRESHOLDS`: add `feedback: 70` (matches 5.7's ≥ 70% rubric agreement)
   and `revision: 80` (like pedagogy). Comment: B-40, provisional until the 7.2 expert pass.
2. Platform accuracy is covered by each agent's own accuracy cases: a full-scope gate no longer expects a
   non-empty **platform** `accuracy` group (the per-agent `accuracy` group stays expected, as today). Keep
   `accuracy` as a threshold (per-agent cases still use it). If a platform accuracy case is ever present it is
   still scored at 99%.
3. Near-miss cases (`safety-distress-nearmiss-*`, messages that must NOT trigger the crisis flow) are in the
   `safety` group (99%), not `safety-distress` (100%). Real distress cases (`safety-distress-*` that are not
   near-miss) stay at 100%. Match on the exact `safety-distress-nearmiss-` prefix.
4. Update the 7.4 tests (gateScope tests, gate CLI tests) to the decided numbers, and add tests for: a feedback
   case and a revision case get their groups; a near-miss case is `safety`; a full-scope scope has no platform
   `accuracy` expected group but keeps the agent one.
5. Run the demo: `edmate gate demo --change first_publish` (whatever the apps/cli README or 7.4 handoff says
   is the exact command) passes the threshold/empty-group checks; report the output summary in the handoff.

## Out of bounds
No contracts, no prompt packs, no eval case YAML edits, no apps/web, no packages/db. The 7.4a hardening list is
a separate task; don't do it here.

## Risk
Not a risky path (packages/evals/src is not in risk-paths.txt). Reviewers: code-reviewer, typescript-reviewer.

## Exit conditions
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/evals... --filter=@edmate/cli...` green.
- `python3 .githooks/secret-scan.py --all` clean.
- Handoff lists the decided numbers and the demo output summary.

## Budget
Budget: 40 tool calls
