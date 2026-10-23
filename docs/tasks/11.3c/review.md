# 11.3c review — APPROVE

Reviewers: security-reviewer

Every insights read (weeklyTopQuestions, stickingTopics, unhelpfulAnswerCount, getWeek) and computeAndSaveWeek now refuse a week whose end is after the server's own clock, so a teacher can no longer read the current week twice and difference out one student. Week starts are forced to a UTC Monday, so there is no time-zone or partial-week bypass, and the caller cannot steer the clock. The only caller, the weekly insights worker, always asks for the last finished week, so it cannot fail at a week boundary. The error message names only the method and kind. Tests cover the current, next and a far-future week (refused, nothing written) and closed weeks (normal). security-reviewer also checked the TypeScript; no findings.

## Findings
None.
