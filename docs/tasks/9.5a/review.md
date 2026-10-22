# 9.5a review — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet), lead

## Findings

- [HIGH] [fixed] apps/web/src/chat/ChatView.tsx — `activeSkill` was never cleared, so every plain Composer message after a practice item was tagged `skill: 'practice'`. It now resets after a final turn with no skill cards and carries only onto hint_request and check_answer (typescript-reviewer re-verified commit c63f27b).
- [HIGH] [fixed] apps/web/src/chat/ChatView.tsx — `asPracticeCard` cast an unknown payload and did not check that the options are strings. It now uses a local zod schema with safeParse; non-string options fall back to the generic SkillCard (re-verified in c63f27b).
