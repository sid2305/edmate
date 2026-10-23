# 9.4a review — APPROVE

Reviewers: code-reviewer, typescript-reviewer, security-reviewer, database-reviewer

All four reviewed the whole branch (Phases A–D) at 894b3786, read-only. No CRITICAL or HIGH findings. The per-student session-start limit is keyed by the signed-in principal and fails closed with 503; a subscription resolve takes the student's market from identity and returns no access when it is missing; /home lists only the signed-in student's own live subscriptions. MEDIUM and LOW findings are deferred to 9.4d (product-facing MEDIUMs, do first) and 9.4e.

## Findings

- [MEDIUM] [deferred 9.4d] packages/db/src/repositories/ports.ts:283 — a subscription resolve with no studentMarket returns a silent null (no_access) instead of failing loudly.
- [MEDIUM] [deferred 9.4d] apps/web/app/api/live-classes/[id]/questions/handlers.ts:123 — the questions route still gates on EDMATE_CHAT_AGENTS, so /home can show a live class whose ask POST 404s.
- [MEDIUM] [deferred 9.4d] apps/web/src/turn/routes.ts:226 — the limits Redis client has no commandTimeout, so an unresponsive Redis hangs POST /api/sessions instead of returning 503.
- [LOW] [deferred 9.4e] packages/db/src/repositories/ports.ts:284 — users.market is read twice per subscription resolve.
- [LOW] [deferred 9.4e] packages/db/src/repositories/README.md:433 — the listLiveForStudent bare-id exception is not documented.
- [LOW] [deferred 9.4e] packages/db/test/repositories.int.test.ts:2021 — the listLiveForStudent grid case depends on CASES order.
- [LOW] [deferred 9.4e] apps/web/src/chat/liveChats.ts:22 — LiveChat.status is a plain string; duplicate ended filter at :82.
- [LOW] [deferred 9.4e] apps/web/src/turn/routes.ts:231 — the 429 has no Retry-After header.
- [LOW] [deferred 9.4e] apps/web/test/turn-backend.ts:82 — the sleep clamp passes NaN through.
- [LOW] [wontfix] apps/web/src/turn/routes.ts:228 — starts for unknown or unentitled agents count against the student's own window; see the lead decision on unentitled starts.
- [LOW] [deferred 9.4e] docs/tasks/9.4a/handoff.md — Phase D item 4 (devModel schema copies kept) and the left-to-do follow-ups go to the board as 9.4e.
