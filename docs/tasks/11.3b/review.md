# 11.3b review — APPROVE

Reviewers: typescript-reviewer (sonnet; also as code-reviewer), lead

The weekly insights job reports only the most recently finished week (pure UTC day math, never the current or a future week), calls only `computeAndSaveWeek`, and builds no payload of its own, so 11.3a's floor and fixed window stay the only way insights are written. The schedule reads its timezone from the US locale pack and fails closed the same way as the cost alarm. Per-teacher failures log only the teacher id, week and the shared `describeError` output; a test checks extra error fields never reach the log line. Tests use fakes only. The diff stays inside apps/worker plus the handoff.

## Findings
None.
