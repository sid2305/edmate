# 9.6c review — APPROVE

Reviewers: security-reviewer (opus), database-reviewer (sonnet), typescript-reviewer (sonnet; also as code-reviewer), lead

No CRITICAL or HIGH findings. Access and isolation hold: lockLive scopes by subscription, student and teacher with FOR UPDATE, so another student or teacher gets not_found. The change only accepts a live version of a live agent from the same teacher. Every writer locks the subscription row first, with no deadlock order. Audit rows are written in the same transaction, and a real concurrent-pause test proves one success, one invalid and one audit row. Security re-ran the db suite (1155 passed) and probed each MEDIUM. None is reachable through today's app code in a way that costs money before payments. All of them go to 9.6h (M9), which is fixed before the pilot.

## Findings
- [MEDIUM] [deferred 9.6h] packages/db/src/repositories/subscriptions.ts:520 — cancel on a cost-alarm-paused subscription, then start, gives a fresh free row, which gets round the Q6 rule that an alarm pause stays.
- [MEDIUM] [deferred 9.6h] packages/db/src/repositories/subscriptions.ts:479 — resume trusts any latest pause_student audit row without checking that this student wrote it.
- [MEDIUM] [deferred 9.6h] packages/db/src/repositories/subscriptions.ts:378 — changePackage doesn't require a verified teacher, unlike start (9.3c).
- [LOW] [deferred 9.6h] packages/db/src/repositories/subscriptions.ts:520 — cancel then start resets the trial.
- [LOW] [deferred 9.6h] packages/db/src/repositories/subscriptions.ts:350 — changePackage keeps status trial on a package with no trial.
- [LOW] [deferred 9.6h] packages/db/src/repositories/subscriptions.ts:477 — resume orders audit rows by transaction start time.
- [LOW] [deferred 9.6h] packages/db/src/repositories/subscriptions.ts:378 — the live-version check isn't locked against a concurrent publish (same gap as start).
- [LOW] [deferred 9.6f] packages/db/src/repositories/subscriptions.ts — pause and cancel use SELECT FOR UPDATE then UPDATE (safe, one extra round trip), and resume's tie-break on id isn't covered by the (target, ts) index.
- [LOW] [deferred 9.6f] packages/db/src/repositories/subscriptions.ts — a repeated `as` cast for LIVE_FOR_STUDENT_WRITE.includes (use a type guard), and StatusSnapshot is deliberately non-strict (say so in a comment).
