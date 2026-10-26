# 3.9e plan (lead-written)

Status: READY

## Goal
The two 3.9c review LOWs: a matcher that throws during guard warm-up leaves a trace, and the web
instrumentation has a failure-path test for the guard warm-up.

## Steps
1. `packages/harness/src/guardrails/warmup.ts` (test first, in `warmup.test.ts`):
   `warmPreGuardPatterns()` returns the names of the matchers that threw, de-duplicated, as
   `readonly ('distress' | 'moderation' | 'jailbreak')[]` (empty when all succeeded). It still
   never throws, never logs (harness stays pure) and never includes the sample text or the error.
   Tests: all-succeed returns `[]`; with `vi.spyOn` (or `vi.mock` on the matcher module) making
   one matcher throw, the result is exactly that name once even though it threw for every sample,
   and the other matchers still ran. Keep 100% branch coverage on `src/guardrails/**`. Update the
   file's header comment ("swallows and does nothing") to match.
2. `apps/worker/src/index.ts` (around line 58): if the returned list is non-empty, log
   `{ level: 'error', event: 'guard_warmup.matcher_failed', matchers: [...] }` with the names only.
   Add or extend the worker test that covers the warm-up call, if one exists; otherwise a small
   unit test of the branch.
3. `apps/web/instrumentation.ts` (`warmGuardPatterns`, around line 52): if the list is non-empty,
   `console.error('[instrumentation] guard warm-up matcher failed: ' + names.join(','))`.
4. `apps/web/instrumentation.test.ts`: two new cases in the existing describe, following the
   warmPool failure tests: (a) the harness import's `warmPreGuardPatterns` throws → `console.error`
   logs the error name and `register()` does not throw; (b) it returns `['moderation']` →
   `console.error` logs the matcher name.

## Risky paths
`packages/harness/src/guardrails/**` (reviewers: code-reviewer). apps/web/instrumentation.ts and
apps/worker are not risky paths.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness --filter=@edmate/web... --filter=@edmate/worker...`
- `corepack pnpm exec prettier --check` on the changed files
- `python3 .githooks/secret-scan.py --all`

## Budget
About 35 tool calls.
