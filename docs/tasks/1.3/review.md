# 1.3 review — APPROVE
Reviewers: security-reviewer (opus), database-reviewer (sonnet), typescript-reviewer (sonnet)

security-reviewer confirmed next-auth 5.0.0-beta.32 (with @auth/core 0.41.3) is the first patched release for the July 2026 advisories; HttpOnly and SameSite=Lax cookies; callbackUrl pinned to the AUTH_URL origin; roles hard-coded to student at creation and read fresh every request; sign-out deletes the session; no tokens or photos stored; deny-by-default guards on both routes; it re-verified every fix at 7b9bf46. typescript-reviewer confirmed the branded-guard pattern plus a route-coverage test makes a missing check fail the build, and the sign-in flow is tested against a mocked Google. database-reviewer confirmed migration 0004 is additive and matches the Auth.js adapter. Web 132 tests, db 333.

## Findings
- [MEDIUM] [fixed] packages/db/src/schema/auth.ts:21 — on a shared device, a second Google account could be silently linked to a signed-in student. signIn refuses linking when a session exists for another identity; unique (user_id, provider). Re-verified by security-reviewer.
- [MEDIUM] [fixed] packages/db/src/identity/store.ts:239 — role grants were filed in audit_log under the granted user's id as teacherId. Grants go to a new platform_audit_log; audit_log is untouched. Re-verified by security-reviewer.
- [MEDIUM] [fixed] packages/db/src/schema/auth.ts:37 — no index on auth_sessions.expires_at. Added.
- [LOW] [fixed] apps/web/src/auth/config.ts:24 — cookie used `__Secure-`; now `__Host-` when secure. Re-verified by security-reviewer.
- [LOW] [fixed] packages/db/src/identity/store.ts:249 — `--by` wasn't checked. Must be `operator` or a current staff user; the real actor role is recorded. Re-verified by security-reviewer.
- [LOW] [fixed] apps/web/src/auth/config.ts:97 — `as unknown as Session` replaced by a Session type augmentation.
