# 11.1a review — APPROVE

Reviewers: security-reviewer (sonnet), database-reviewer (sonnet; also as typescript-reviewer and code-reviewer), lead

Every method takes the teacher or student id from the parsed scope, never from input. `create()` checks under a key-share lock that every package id belongs to the scope's own teacher, and writes nothing otherwise (`not_found`). A student sees only upcoming classes attached to packages they hold a trial or active subscription to. The meeting link refuses anything but http(s), so `javascript:` and `data:` links are rejected. Errors go through the shared scrubbed error path. Both list reads use the existing `(teacher_id, starts_at)` index, there is no migration, and `create()` takes only one kind of lock, so the lock-order lesson doesn't apply. The int tests run against real Postgres, and all three methods are in the isolation grid.

## Findings

- [MEDIUM] [deferred 11.1d] packages/db/src/repositories/live-classes.ts — the meeting link has no length cap in CreateInputSchema (only the title is capped), and http links are accepted; cap it and decide whether the link must be https.
- [LOW] [deferred 11.1d] packages/db/src/repositories/live-classes.ts — listUpcomingForStudent can return the same class twice when a student holds two qualifying subscriptions whose packages both carry it; return each class once.
- [LOW] [deferred 11.1d] packages/db/src/repositories/live-classes.ts — neither list read has a LIMIT; fine at pilot scale.
