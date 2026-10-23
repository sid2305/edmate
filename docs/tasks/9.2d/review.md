# 9.2d review — APPROVE

Reviewers: security-reviewer, database-reviewer, code-reviewer, typescript-reviewer

The teacher's public display name moves from users.name to teacher_profiles.display_name (migration 0027), with discovery falling back to the slug and the onboarding form setting it. The security review found that the impersonation and phone checks could be bypassed with fullwidth letters and non-ASCII digits; the TypeScript review found the form did not resync after a save. One fix round closed all three, and the security and TypeScript reviewers re-verified (APPROVE). The database review found nothing; the code review's one LOW moves to 9.2g.

## Findings
- [HIGH] [fixed] packages/db/src/repositories/teacher-profiles.ts:68 — DisplayName did not NFKC-normalize before the impersonation check, so fullwidth "ＡＤＭＩＮ" passed; now normalized first, with fullwidth tests.
- [HIGH] [fixed] apps/web/app/teacher/onboarding/OnboardingForm.tsx:68 — after a save that kept the stored name, the input showed empty and hid the fallback notice; inputs now resync from the saved profile, with a test.
- [MEDIUM] [fixed] packages/db/src/repositories/teacher-profiles.ts:62 — the phone-shape check used \d; now \p{N} with the u flag, tested with Devanagari digits.
- [LOW] [deferred 9.2g] packages/db/test/repositories.int.test.ts:2478 — two mismatch cases use a 1-character displayName and may fail validation before the check they are named for.
