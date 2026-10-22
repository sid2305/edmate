# 9.7a review — APPROVE

Reviewers: security-reviewer (sonnet), code-reviewer (sonnet), lead

## Findings

- [HIGH] [fixed] apps/web/e2e/full-flow.spec.ts — sendMessageUntil retried the whole fill, click and assert, so a slow render could send a second turn POST. Fix 400ecdd: postOnce retries an action only until its POST leaves the browser, and outcomes are awaited separately; code-reviewer re-verified.
- [MEDIUM] [fixed] apps/web/e2e/full-flow.spec.ts — clickUntil could re-click the package Start button inside the retry loop; replaced by postOnce in the same fix.
- [MEDIUM] [deferred 9.7c] apps/web/e2e/global-setup.ts — verifyDemoTeacher writes to TEST_DATABASE_URL (staff role, verification) with no local-only guard, unlike e2e/stack/mail.ts.
- [LOW] [deferred 9.7c] apps/web/e2e/full-flow.spec.ts — a failed local run leaves its seeded question open, so the next local run fails strict mode; CI starts fresh.
