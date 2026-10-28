# Plan: 7.2w (stale persona citations)

Status: READY (lead plan, low risk, evals data only)

## Problem
The guardrail table in docs/edmate-harness-build-plan.md moved by 55 lines. Persona cases still cite the old lines: "line 427 (personaBoundary ...)", "line 427-428 (personaBoundary, tone)" and "line 428 (tone guard)". Lines 427 and 428 now hold a blank line and the "Ask the teacher" heading. The rows now sit at line 482 (`personaBoundary`) and line 483 (`tone`). On main, 12 persona files cite 427, 427-428 or 428 (7.2u adds 4 more citing 428). The 7.2u Phase O review found this.

## Change
1. In every evals/suites/persona/*.yaml, re-point build-plan citations: 427 → 482, 427-428 → 482-483, 428 → 483. Keep the words in the brackets.
2. Script a check over every persona case's build-plan `line N` citation. Each cited line must contain the term in its brackets (personaBoundary, tone, or what the case names). List any other citation that fails, and re-point it to the line that says it.
3. Change nothing else: no turns, expectations, ids or file names.

## Files
evals/suites/persona/*.yaml (`source:` lines only), docs/tasks/7.2w/handoff.md.

## Risk paths
None. Persona evals are not on risk-paths.txt.

## Tests
`corepack pnpm turbo run typecheck lint test --filter=@edmate/evals` stays green; the secret scan is clean.

## Budget
About 20 tool calls.
