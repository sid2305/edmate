# 1.7 review — APPROVE (Phases A–C; Phase D moves to 1.7c)

Reviewers: security-reviewer (opus), database-reviewer (sonnet), typescript-reviewer (sonnet), code-reviewer (sonnet)

Phase A (db) was reviewed by database-reviewer, typescript-reviewer and security-reviewer. Phases B and C (content, web) were reviewed by typescript-reviewer, code-reviewer and security-reviewer.

The security-reviewer found one HIGH, an under-13 bypass: a blocked erase rolled everything back, so another device could re-answer as an adult. Fix round 1 (sonnet, 3ea074f) fixed it, and the security-reviewer confirmed the fix on re-check.

That fix round also changed the web build to `next build --webpack`. In that build the regex guard's worker can't load, so the IN locale pack is silently refused and India disappears from the age gate. It fails safe, since no unsafe pattern runs. Under the one-fix-round rule (human, 20 Oct 2026) it is deferred to 1.7b, which starts right after this merge and lands before 9.1.

CI ran the Postgres integration tests (identity.int.test.ts) green on 3ea074f.

## Findings
- [HIGH] [fixed] packages/db/src/identity/store.ts:456 — a blocked under-13 erase rolled back everything, leaving birth_year null so another device or sign-in could re-answer as an adult; now a savepoint deletes the users row, sign-in rows always go, `age_blocked_at` shuts the account out everywhere, plus a non-PII log line (security-reviewer).
- [HIGH] [deferred 1.7b] apps/web/package.json:9 — with `next build --webpack` the safe-regex worker is copied without its import and can't load, so IN.yaml's PII patterns time out, the IN pack is refused, and loadAgeContent drops it silently (fails safe; India disappears from the age gate) (security-reviewer re-check).
- [MEDIUM] [fixed] packages/db/src/identity/store.ts:428 — the under-13 erase wasn't wrapped in translateWrite; now wrapped, and a blocked erase is handled (database-reviewer).
- [MEDIUM] [fixed] packages/db/src/identity/store.ts:166 — noticeVersion was caller free text; the server sets it and the store rejects a mismatch (security-reviewer).
- [LOW] [fixed] packages/db/src/identity/age.ts:43 — no upper bound on minAge; ageStatus now throws on an implausible minAge (security-reviewer).
- [LOW] [fixed] apps/web/test/memory-identity.ts:174 — the fake always erased; it has a blockErase switch (security-reviewer).
- [LOW] [fixed] packages/db/src/identity/store.ts:455 — learnerStatus was not role-scoped; it is now scoped to students (security-reviewer).
- [LOW] [fixed] packages/db/src/identity/store.ts:425 — a pre-1.7 student with other rows answering under-13 failed the erase; now erase_blocked and age_blocked_at (security-reviewer).
- [LOW] [deferred 1.7c] packages/db/src/schema/users.ts:72 — unique (user, kind, version) blocks same-version re-consent after withdrawal; Phase D clears withdrawn_at (database-reviewer).
- [LOW] [deferred 1.7a] packages/db/migrations/0014_age_consent.sql:10 — CHECK constraints validate under ACCESS EXCLUSIVE; use NOT VALID then VALIDATE (database-reviewer).
- [LOW] [deferred 1.7a] packages/db/src/identity/age.ts:29 — overload narrowing is runtime-guaranteed, not type-proven; add a comment (typescript-reviewer).
- [LOW] [deferred 1.7a] packages/content/src/agePolicy.ts:36 — content validate should flag minAge outside 13–18 (security-reviewer).
- [LOW] [deferred 1.7a] apps/web/src/auth/age.ts:66 — the signed flag is unused; refuse an unsigned notice in production (security-reviewer; B-27 Q2).
- [LOW] [deferred 1.7a] apps/web/src/auth/guard.ts:529 — requireRole defaults to age clearance; default-deny for actions or a coverage test (security-reviewer).
- [LOW] [deferred 1.7a] apps/web/src/auth/age.ts — submitAgeAnswer and the deps.resolve catch blocks discard errors without logging, and ageGateView has no try/catch around resolve (typescript-reviewer).
- [LOW] [wontfix] apps/web/app/welcome/age/page.tsx:62 — real users would see the placeholder notice until it is signed; intentional (Phase B), gated by B-27 Q2 before launch (code-reviewer).
- [LOW] [wontfix] apps/web/test/memory-identity.ts:16 — a lazy import dodges a mock cycle; test-only (typescript-reviewer).
