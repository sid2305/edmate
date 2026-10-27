# Review: 6.3a — APPROVE

Reviewers: security-reviewer (sonnet), database-reviewer (sonnet), code-reviewer (sonnet), typescript-reviewer (sonnet)

Phase A (packages/db) was reviewed by security-reviewer, database-reviewer and code-reviewer. Phase B (apps/web) was reviewed by code-reviewer, typescript-reviewer and security-reviewer; typescript-reviewer re-checked fix round 1 and reported it fixed.

## Findings
- [HIGH] [fixed] apps/web/app/teacher/style-card/StyleCardView.tsx:75 — one shared `decidingTag` re-enabled an in-flight tag's buttons once another tag was decided, so a second click could send a duplicate decide call. Fix round 1 tracks in-flight tags in a per-tag set, cleared in `finally`, with an interleaved-decision test.
- [MEDIUM] [deferred 6.3f] packages/db/src/repositories/mistake-proposals.ts:220 — `approve` does not check the merged mistakeTags against STYLE_CARD_LIMITS.tagsMax (20), so approving at 20 tags writes a 21-tag style card.
- [MEDIUM] [deferred 6.3f] packages/db/src/repositories/mistake-proposals.ts:112 — `record` has no teacher-role check (lockRole), unlike approve and reject.
- [MEDIUM] [deferred 6.3f] packages/db/src/repositories/mistake-proposals.ts:117 — two concurrent `record` calls can both pass the MISTAKE_PROPOSALS_MAX check (no per-teacher advisory lock).
- [LOW] [deferred 6.3f] packages/db/src/repositories/mistake-proposals.ts:70 — `lastSeen` is `z.string()`, not the contracts `timestamp()` schema.
- [LOW] [deferred 6.3f] apps/web/src/studio/mistakeProposalRoutes.ts:27 — the route's Tag schema hardcodes 60 instead of importing the repository's tag max length.
- [LOW] [deferred 6.3f] apps/web/src/studio/mistakeProposalRoutes.ts — no rate limit on approve and reject beyond the repository's row cap.
- [LOW] [wontfix] packages/db/src/schema/content.ts — the partial pending index leaves out `last_seen`, so `listPending` sorts in memory; at most 100 rows per teacher (lead decision).
- [LOW] [wontfix] apps/web/src/studio/mistakeProposalRoutes.ts — the `_log` parameter is unused on purpose; nothing in a RepositoryError is worth logging (lead decision).
- [LOW] [wontfix] apps/web/app/teacher/style-card/page.tsx:16 — two independent reads are awaited one after the other; one extra round trip on a server page (lead decision).

## Notes
- security-reviewer verified: both route methods are wrapped in `withRole(['teacher'])`, teacherId comes only from the session, the body is a zod strictObject, and error messages are fixed and generic.
- POST instead of the plan's PATCH is accepted: ROUTE_POLICY's `/api/studio/**` row has no PATCH and apps/web/src/auth is out of bounds for this task.
- A race-loser approve (`approved: false`) removes the tag client-side, which is correct because the row is no longer pending.
