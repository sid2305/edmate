# 8.1a review — APPROVE
Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet)

No risky paths. code-reviewer approved and checked the security properties: scope from the session, the body cannot set teacherId, userId or verificationStatus, the 16 KB body cap, fixed error text, and the teacher-only policy row. typescript-reviewer asked for changes (one HIGH); fixed in bf633b7, and the lead read the fix diff.

## Findings
- [HIGH] [fixed] apps/web/app/teacher/onboarding/OnboardingForm.tsx:46 — submit had try/finally with no catch; a network failure or bad success JSON became an unhandled rejection with no error shown. Now a catch shows a fixed generic error; two tests added.
- [MEDIUM] [fixed] apps/web/app/teacher/onboarding/OnboardingForm.tsx:54 — the fallback error text was the "Saving…" label; now onboarding.errors.generic.
- [LOW] [fixed] apps/web/app/teacher/onboarding/OnboardingForm.tsx:57 — success-path res.json() unguarded; covered by the new catch.
