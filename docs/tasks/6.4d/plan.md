# Plan: 6.4d — test the bad_topic_id evidence skip

Status: READY (lead plan, 27 Oct 2026)

`packages/harness/src/pipeline/runner.ts` `evidenceFor` (about line 1234) records `{ name: 'evidenceSkip', ok: false, action: 'bad_topic_id' }` when the stored `practiceTopicId` fails `/^[A-Za-z0-9_-]{1,128}$/`, and returns no evidence. Only the `no_topic` branch has a test (`packages/harness/src/pipeline/runner.evidence.test.ts`, the describe block "runner: evidenceFor records its skip reason (6.4c)").

Add one case to that describe block: a graded practice turn whose loaded help state carries a `practiceTopicId` that fails the shape (for example `'bad topic!'` or a 129-character string). Assert the trace has the `bad_topic_id` guard and that no evidence is applied. Follow how the existing case and the evidence tests in that file set up the help state; if the help-state schema rejects such a value when it is loaded, write the case the way the file's other "stored value" tests reach `loadedHelp`, and record how in the handoff.

Red-then-green: temporarily remove the `bad_topic_id` `addGuards` line, see the new case fail, then restore it (don't commit the removal).

Files: `packages/harness/src/pipeline/runner.evidence.test.ts`, `docs/tasks/6.4d/handoff.md`. No source change.

Gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness`; prettier --check on the changed file; `python3 .githooks/secret-scan.py --all`.

Budget: 20 tool calls.
