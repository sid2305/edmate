Status: DONE

## Summary
B-50 (and its lead amendment): threats to hurt others and weapons-to-school now raise a critical
misuse alert in the 12.5 inbox, same as `harm_to_others`, alongside the calm refusal.

- `packages/harness/src/guardrails/moderationIn.ts` — `preGuardAlert()` now sets `level: 'critical'`
  for `kind: 'misuse'` (distress stays `'alert'`); `verdict()` raises that alert for
  `harm_to_others`, `threat` and `weapons` (new `MISUSE_CODES` list), not `harm_to_others` alone.
  File-top comment updated.
- `packages/harness/src/guardrails/preGuardCtx.ts` — `PreGuardBlock` doc comment updated to name
  `threat` and `weapons` alongside `harm_to_others`.
- `packages/harness/src/guardrails/moderationIn.test.ts` — new decisive-rule tests for `threat` and
  `weapons` asserting `{ kind: 'misuse', level: 'critical' }`; new classifier-category tests for
  `threat` and `weapons` mirroring the existing `harm_to_others` one; the existing ambiguous→
  classifier `threat` test now also asserts the alert; the existing `harm_to_others` rule test now
  expects `level: 'critical'` (was `'alert'`); two near-miss cases added to the `it.each` "everyday
  text" list (history-essay school-shooting prompt, game-villain-threat prompt), both still
  `{ ok: true }`.
- `packages/harness/src/pipeline/runner.block.test.ts` — two new tests (`threat`, `weapons`)
  mirroring "harm to others: the bullying reply, a misuse alert delivered", asserting
  `t.alerts.raised[0]` is `{ kind: 'misuse', level: 'critical' }` and the calm refusal
  (`BLOCK_REPLIES.threat` / `BLOCK_REPLIES.weapons`) with no safety event; the existing
  `harm_to_others` test now expects `level: 'critical'`. File-top comment updated.
- `evals/suites/safety/moderation/safety-moderation-nearmiss-school-shooting-essay-en.yaml` and
  `safety-moderation-nearmiss-game-villain-threat-en.yaml` — new English-only near-miss cases
  (`must_block: false`), same shape as the existing `-nearmiss-threat-model-en.yaml`.
- `packages/harness/src/pipeline/steps/preGuard.test.ts` — not in the plan's file list, but needed:
  its existing harm_to_others block test asserted `level: 'alert'`; updated to `'critical'`.
- `packages/evals/src/moderationJailbreak.test.ts` — not in the plan's file list, but needed: this
  test hard-codes seeded-case counts and an alert-kind assumption that the new near-miss files and
  the critical-misuse change broke. Updated the near-miss count (16 → 18, matching the two new
  files) and the `alertKinds` assertion (was `ev.code === 'harm_to_others' ? ['misuse'] : []`; now
  checks the same `harm_to_others`/`threat`/`weapons` list as moderationIn.ts).

No `moderationPatterns.ts`, `packages/contracts`, `packages/db` or `apps/worker/src/alerts/**`
source change (confirmed as the plan expected — `matchModeration` rules, contracts and db schema
already allowed this; the worker's alert pipeline is already generic over `level`).

## Decisions

### 26 Oct 2026 · 7.2m preGuard.test.ts and evals moderationJailbreak.test.ts also needed updating · decided by builder · risk: low
- Decided: fixed `packages/harness/src/pipeline/steps/preGuard.test.ts` (one assertion,
  `level: 'alert'` → `'critical'`) and `packages/evals/src/moderationJailbreak.test.ts` (the seeded
  near-miss count and the misuse-alert-kind check), both outside the plan's named file list, to
  keep the harness and evals gates green.
- Why: the plan's files-to-modify list was written before the lead amendment broadened the
  critical-alert scope to `threat`/`weapons` and before counting the two new near-miss eval cases
  against this test's hard-coded totals; without these two fixes the gate in the plan's own "Gate
  commands" section fails. Both are test-only changes with no behaviour change beyond what the
  plan and its lead amendment already decided.

## Gate
- `pnpm --filter @edmate/harness exec vitest run` → 127 files / 5643 tests passed.
- `pnpm turbo run typecheck lint test --filter=...@edmate/worker` → 11/11 tasks successful.
- `pnpm turbo run test --filter=...@edmate/evals` (then isolated `pnpm --filter @edmate/evals exec
  vitest run`) → 31 files / 1453 tests passed, including the eval-validation suite
  (`moderationJailbreak.test.ts`): "moderation 46/46 blocked... near-miss 32/32 not blocked by a
  verdict (seeded 18)" in both the `none` and `throws` classifier modes.
- `pnpm turbo run typecheck lint test --filter=...@edmate/harness` (full run including apps/web,
  apps/worker, apps/cli, packages/content): one unrelated failure,
  `apps/web/src/chat/ReportButton.test.tsx` ("opens the category form, a11y clean closed and open")
  timed out at 5000ms under full-workspace load; re-run alone
  (`pnpm --filter @edmate/web exec vitest run src/chat/ReportButton.test.tsx --testTimeout=20000`)
  passed (7/7). Not touched by this task; pre-existing flake under load, not a regression.
- `pnpm exec prettier --check` on every file this task touched (code + the two new YAML files) →
  clean (ran `--write` first on 5 files that needed reformatting).
- `python3 .githooks/secret-scan.py --all` → clean, no output.

## Risk
`risk: high` (board already marks 7.2m `risk: high`; per rule 6, logged here even though only
`code-reviewer` is required pre-pilot-gate per the plan's own risk-paths reading).

## Budget
Tool calls used: 44
