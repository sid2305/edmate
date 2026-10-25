# 8.4c review — APPROVE
Reviewers: code-reviewer, typescript-reviewer

Studio drafting now writes teacher-scoped usage rows, saved style cards have override and
role-play phrases stripped before validation, and a stale draft that resolves after a save is
discarded. code-reviewer raised two HIGHs on over-broad sanitize patterns; both were fixed (the
second needed a short second round) and code-reviewer verified the final version.
typescript-reviewer's cast finding was fixed in round one and verified.

## Findings
- [HIGH] [fixed] apps/web/src/studio/styleCardSanitize.ts — "act as ..." open tail deleted ordinary text; replaced with a closed jailbreak-target list.
- [HIGH] [fixed] apps/web/src/studio/styleCardSanitize.ts — "no rules" matched "no rules of thumb" and similar; both patterns now exclude of/for/about after "no rules" (round 2 fixed the "(you have|there are|with) no rules" form).
- [MEDIUM] [fixed] apps/web/src/studio/styleCardSanitize.ts — "pretend ..." open tail, same class; uses the same closed list.
- [MEDIUM] [fixed] apps/web/src/studio/styleCardSanitize.test.ts — added false-positive and full positive-case blocks.
- [MEDIUM] [fixed] apps/web/src/studio/styleCardRoutes.ts — three repeated Record casts replaced by one guard variable.
