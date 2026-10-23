# 11.1d review — APPROVE

Reviewers: security-reviewer, database-reviewer, code-reviewer, typescript-reviewer

Phase A (packages/db live-class status, update and cancel). security-reviewer raised one HIGH: `status` became required on `TeacherLiveClassRow` and `UpcomingLiveClass` while four apps/web fixtures and one optimistic row lacked it, so the web typecheck would break on merge. The fix round added `status: 'scheduled'` to them, and security-reviewer re-verified it (no new findings). The vacuous selectDistinct dedup claim (code-reviewer MEDIUM) was reworded as defence in depth, and the random migration tag was renamed. The LOWs go to 11.1e.

## Findings
- [HIGH] [fixed] packages/db/src/repositories/live-classes.ts:119 — `status` required on the row types; apps/web literals lacked it (web typecheck break). Fixed in apps/web tests and LiveClassesView.tsx.
- [MEDIUM] [fixed] packages/db/test/live-classes.int.test.ts:312 — the selectDistinct "dedup" test claimed a case the one-live-subscription index makes unreachable; reworded as defence in depth (test and README).
- [LOW] [fixed] packages/db/migrations/0026_military_power_man.sql — random drizzle tag renamed to a descriptive one (journal updated).
- [LOW] [deferred 11.1e] packages/db/src/repositories/live-classes.ts:353 — the live_class.update audit omits link before/after, and after.startsAt is not normalised with iso().
- [LOW] [deferred 11.1e] packages/db/src/repositories/live-classes.ts:307 — listUpcomingForStudent returns the link on a cancelled row (Phase C's view hides it).
- [LOW] [deferred 11.1e] packages/db/src/repositories/live-classes.ts:218 — listForTeacher orders ASC then LIMIT 500, dropping the newest classes past the cap.
- [LOW] [deferred 11.1e] packages/db/src/repositories/live-classes.ts:223 — `r.status as LiveClassStatus` is an unchecked cast.
- [LOW] [deferred 11.1e] packages/db/src/repositories/live-classes.ts:62 — the "max before regex fails fast" comment is wrong for zod v4.
- [LOW] [deferred 11.1e] packages/db/test/live-classes.int.test.ts:241 — update test does not assert startsAt moved or exactly one audit row; over-length link on update untested.
- [LOW] [deferred 11.1e] packages/db/test/repositories.int.test.ts:3657 — liveClasses.update/cancel verify does not read back.
- [LOW] [deferred 11.1e] packages/db/src/repositories/live-classes.ts:343 — update/cancel collapse "already cancelled" and "already started" into one bare invalid.
