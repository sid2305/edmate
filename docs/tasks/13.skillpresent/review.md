# 13.skillpresent review — APPROVE

Reviewers: code-reviewer, typescript-reviewer

Phase B (apps/web chat panel) was reviewed by the same two reviewers; its fix round was verified by both. Phase A (packages/harness only): Both reviewers (Sonnet, read-only on the branch) approved. `rolePlaySkillEvent` and `feedbackSkillEvent` are pure and fail closed: no event and no throw when the learner isn't entitled or the payload is too large. The active skill and role-play state go from policy through decide, the strict `DecideResultSchema` and the runner into generate, with nothing dropped along the way. `exactOptional` fields are never set to an explicit `undefined`. The harness still imports only contracts, zod, mathjs and its own modules. The integration test runs start → questions → pause → resume → stop → end through the real pipeline. All three lead answers are implemented: no registry tool, the `{ given: true }` marker, and the stop/end phases Phase B needs for its reset.

## Findings
- [LOW] [wontfix] packages/harness/src/pipeline/generate/skillProgress.test.ts:48 — an `as unknown as RolePlay` cast builds an oversized value; it is deliberate, the only way to test the fail-closed size branch, and limited to the test.
- [HIGH] [fixed] apps/web/src/chat/ChatView.tsx — a feedback turn persisted as activeSkill, tagging later Hint clicks; feedback is now one-shot and stopped/ended phases clear the skill (tests added).
- [MEDIUM] [fixed] apps/web/src/chat/MockInterviewControls.tsx — progress line now has role="status".
- [LOW] [fixed] apps/web/messages/en.json — debrief count uses an ICU plural.
