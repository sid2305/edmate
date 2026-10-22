# 12.4b review — APPROVE

Reviewers: security-reviewer (sonnet), database-reviewer (sonnet), lead

The security-reviewer checked that startRun and goLive refuse a flagged, unapproved regulated subject under the agent FOR UPDATE lock and before any write, that goLive refuses when the cut version's subject no longer matches the staff column (flag, revoke, change or clear mid-run), that the version's subject now comes only from the staff column and cannot be smuggled in through startRun input, and that the refusal reuses the fixed `invalid` message with a `regulated_unapproved` reason. The database-reviewer confirmed the lock order is unchanged (advisory, profile FOR SHARE, agent FOR UPDATE, run FOR UPDATE) and matches 12.4a's, and that the new unlocked read of the immutable agent version is safe. The lead checked the diff stays in publish.ts, its integration test and one worker test case.

## Findings
None.
