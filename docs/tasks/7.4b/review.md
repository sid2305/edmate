# 7.4b review — APPROVE

Reviewers: code-reviewer, typescript-reviewer, security-reviewer

Both reviewers ran on the branch diff (packages/evals gateScope.ts, apps/cli gate.ts and tests). The change matches human answer B-40: GATE_THRESHOLDS gains feedback 70 and revision 80 and nothing else changes. Only ids with the exact `safety-distress-nearmiss-` prefix move to the 99% safety group; real distress cases stay at 100%. A full-scope gate no longer expects a platform `accuracy` group but still requires the per-agent one, and a platform accuracy case that is present is still scored at 99% (no fail-open). gate.ts changed because the CLI precheck has its own copy of the grouping; the typescript-reviewer's MEDIUM on that duplication is already the 7.4a Phase C item and is deferred there.

CI then failed typecheck in apps/worker: packages/db's GATE_GROUP_NAMES (a mirror of GATE_THRESHOLDS' keys) lacked the two new groups. A fixer added `feedback` and `revision` to it (cfe4296). The security-reviewer checked that one-line packages/db change and found nothing. The group is a zod enum over jsonb with no DB constraint, the public scorecard keys on a separate list, and processor.test.ts already asserts the mirror.

## Findings
- [MEDIUM] [deferred 7.4a] apps/cli/src/commands/gate.ts — fullScopeGaps duplicates gateScope.ts's distress and near-miss prefixes and optional-group logic instead of reusing an exported classifier; the CLI precheck could drift from the real gate (it still fails closed).
