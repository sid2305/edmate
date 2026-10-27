# 9.4e handoff

## Phase A

Status: PHASE A DONE

Summary: exported the harness's internal classifier/verdict schemas so `apps/web`'s
`devModel.test.ts` no longer hand-copies them; no behaviour change.

- `packages/harness/src/guardrails/grounding.ts` — renamed the local `const VerdictSchema` to
  `export const GroundingVerdictSchema`, kept `const VerdictSchema = GroundingVerdictSchema;` so
  every existing internal reference is unchanged.
- `packages/harness/src/guardrails/adviceGuard.ts` — same pattern: `export const
  AdviceVerdictSchema`, `const VerdictSchema = AdviceVerdictSchema;`.
- `packages/harness/src/guardrails/index.ts` — re-exports `GroundingVerdictSchema` and
  `AdviceVerdictSchema` alongside each module's existing exports (risky path: guardrails group).
- `packages/harness/src/pipeline/index.ts` — `export { DecideResultSchema, RouteFallbackSchema }
  from './results.js';` (`RouteFallbackSchema` was already exported from `results.ts`, just not
  re-exported at the pipeline barrel).
- `packages/harness/src/memory/sessionSummary.ts` — added `export` to `SessionSummarySchema`
  (`memory/index.ts`'s `export *` already re-exports it).
- `packages/harness/src/index.ts` — added `export { RouteIntentVerdictSchema } from
  './routing/modelFallback.js';` (already exported from `routing/index.ts`, which the top-level
  barrel does not re-export, so added directly from the source module instead of widening the
  top-level surface with a whole new `export *`).
- `apps/web/src/turn/devModel.test.ts` — dropped the five hand-copied schemas
  (`GroundingVerdictSchema`, `AdviceVerdictSchema`, `RouteIntentVerdictSchema`,
  `RouteFallbackSchema`, `SessionSummarySchema`) for the real `@edmate/harness` imports; removed
  the now-unused `AttemptSchema`/`IntentSchema` imports from `@edmate/contracts` and the stale
  "out of bounds for 9.4a" comment block. Test assertions and expected values are unchanged.

Did not touch `moderationPatterns.ts`, `moderationIn.ts`, any `packages/db` file, or
`packages/harness/src/guardrails/moderation*`.

## Decisions

None — every change is the additive export the plan named; no new decision was needed.

## Gate

- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness` — green except one
  pre-existing, unrelated flaky test: `packages/harness/src/pedagogy/modelRequest.test.ts >
  forged teacher-note marker (3.11d) > runs in linear time on long hostile input` fails
  intermittently on timing ratio (`expected ~73-77 to be less than 64`) under machine load; that
  file is untouched by this task. Re-ran it alone twice and it passed both times:
  `corepack pnpm --filter @edmate/harness exec vitest run src/pedagogy/modelRequest.test.ts` →
  `Test Files 1 passed (1)`, `Tests 86 passed (86)`. All other packages (`@edmate/web`,
  `@edmate/worker`, `@edmate/evals`, `@edmate/content`, `@edmate/db`) passed typecheck, lint and
  test. Also ran the touched test files directly:
  `corepack pnpm --filter @edmate/harness exec vitest run src/guardrails src/memory` → `Test Files
  26 passed (26)`, `Tests 1429 passed (1429)`; `corepack pnpm --filter @edmate/web exec vitest run
  src/turn/devModel.test.ts` → `Test Files 1 passed (1)`, `Tests 21 passed (21)`.
- `corepack pnpm exec prettier --check` on the changed files — initially flagged 3 files
  (`grounding.ts`, `sessionSummary.ts`, `devModel.test.ts`); ran `--write` on those three, then
  `--check` on all 7 changed files → `All matched files use Prettier code style!`.
- `python3 .githooks/secret-scan.py --all` — clean, no findings.

## Budget

Tool calls used: 24
