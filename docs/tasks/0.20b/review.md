# 0.20b review — APPROVE

Reviewers: code-reviewer, typescript-reviewer

Both approve. Each fix removes the cause of its flake rather than raising a timeout:
- **Auth test:** a `beforeAll` warms the transform cache, so the first test takes about 60 ms instead of about 1.9 s, and the 20 s bound stays as it was.
- **expectLinear:** it now takes the median of 5 samples instead of the best of 3. A new self-test, run on a faked clock, proves the check still fails on quadratic code.

Both reviewers re-ran the two files three times, green every time.

## Findings
- [LOW] [fixed] docs/tasks/0.20b/handoff.md — budget overrun (58 calls by the harness count, against 30) was not logged; the lead logged it.
- [LOW] [deferred 0.20c] packages/harness/src/pipeline/generate/streamGate.sentence.test.ts — this file and packages/harness/src/pipeline/runner.test.ts timed out under full local parallel load; out of scope, so a board task follows them up.
- [LOW] [wontfix] packages/harness/src/pedagogy/modelRequest.test.ts — a redundant `as number` cast after sort; harmless.
