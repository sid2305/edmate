# 11.3a review — APPROVE

Reviewers: security-reviewer (opus; also as typescript-reviewer and code-reviewer), lead

The first review asked for changes: 1 HIGH, 3 MEDIUM, 4 LOW. One fix round (opus) applied the lead's decisions, and the same reviewer re-checked and approved. For each fix, it deleted the fix line in a scratch copy and confirmed a test went red. The insights and isolation suites passed 163/163 against its own Postgres. The floor counts distinct students, and the isolation grid covers all six public methods. One new MEDIUM goes to 11.3c: Phase B reports only finished weeks, so it is not reachable as planned.

## Findings
- [HIGH] [fixed] packages/db/src/repositories/insights.ts — teacher preview chats (student id = teacher id) counted as one of the 5 students; now excluded from all four reads, with a 4-real-students-plus-preview test for each.
- [MEDIUM] [fixed] packages/db/src/repositories/insights.ts — the stored sample was one student's exact words and survived an erase; sample and oldestAt are dropped, so groups carry only ids and counts.
- [MEDIUM] [fixed] packages/db/src/repositories/insights.ts — a caller-chosen since with no upper bound allowed differencing nested windows; reads now take a Monday weekStart with a fixed [00:00Z, +7d) window, and computeAndSaveWeek is the only write.
- [MEDIUM] [fixed] packages/db/src/repositories/insights.ts — left() code points vs zod UTF-16 length mismatch (moot: sample dropped).
- [MEDIUM] [deferred 11.3c] packages/db/src/repositories/insights.ts — the current or a future week is still accepted, so reading this week twice can difference out one student; refuse weekStart + 7d after now.
- [LOW] [wontfix] packages/db/src/repositories/insights.ts — openQuestionGroups is cumulative, so week-over-week counts can differ by one student; accepted (lead decision: the teacher already sees each question in the 8.8 inbox).
- [LOW] [fixed] packages/db/src/repositories/insights.ts — oldestAt was one student's exact question time; dropped.
- [LOW] [fixed] packages/db/src/repositories/insights.ts — array_agg built every question text to keep one (moot: sample dropped).
- [LOW] [fixed] packages/db/test/repositories.int.test.ts — unrelated Prettier churn in shared files reverted; additions only.
