# Handoff: 6.4d

Status: DONE

## Summary
Added one case to the "runner: evidenceFor records its skip reason (6.4c)" describe block in
`packages/harness/src/pipeline/runner.evidence.test.ts`: a graded practice turn whose loaded help
state's `practiceTopicId` is `'bad topic!'` (fails the `/^[A-Za-z0-9_-]{1,128}$/` shape check, but
is still a valid non-empty string under the help-state schema's `min(1).max(200)` bound, so it
loads without rejection). The test asserts the trace's guards array contains
`{ name: 'evidenceSkip', ok: false, action: 'bad_topic_id' }` and that `commit.evidence` is
`undefined`.

Red-then-green: temporarily removed the `this.trace.addGuards([{ name: 'evidenceSkip', ok: false,
action: 'bad_topic_id' }])` line in `runner.ts`'s `evidenceFor` (restoring the `return undefined`
with no guard). Ran the single test file — the new case failed (`received: []`-style guards array
missing the expected object; 9 passed, 1 failed). Restored the line unchanged (confirmed via
`git diff --stat` showing only the test file touched); re-ran the file — all 10 tests passed.

## Decisions
None.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness` — 4/4 tasks successful (typecheck, lint, test for harness and its deps).
- `corepack pnpm exec prettier --check packages/harness/src/pipeline/runner.evidence.test.ts` — all matched files use Prettier code style.
- `python3 .githooks/secret-scan.py --all` — clean (no output, exit 0).

## Budget
Tool calls used: 15
