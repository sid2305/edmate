# 9.6a review — APPROVE

Reviewers: security-reviewer (sonnet), database-reviewer (sonnet), typescript-reviewer (sonnet, also as code-reviewer), lead

## Findings

- [MEDIUM] [deferred 9.6f] packages/db/src/repositories/messages.ts — listForStudent has no index that covers the pair filter and the (created_at, id) order, so each page sorts the pair's whole message history. database-reviewer rated it HIGH; the lead re-rated it MEDIUM for the closed pilot (see the handoff decision): correctness and isolation are fine, a pilot pair has a few thousand messages at most, and the plan rules out a migration in this phase.
- [MEDIUM] [deferred 9.6f] packages/db/src/repositories/sessions.ts — the same missing index for sessions.listForStudent, with a smaller effect.
- [LOW] [deferred 9.6f] packages/db/test/repositories.int.test.ts — the messages.listForStudent tests lack the malformed-cursor, exact-boundary and key-set cases that the sessions test has.
- [LOW] [deferred 9.6f] packages/db/src/repositories/sessions.ts — ExportCursorSchema accepts only Z datetimes, unlike sibling schemas; it needs a comment.
