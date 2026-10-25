# 9.3f review — APPROVE

Reviewers: security-reviewer, database-reviewer, code-reviewer, typescript-reviewer

Four Sonnet reviewers covered all three phases: the staff-only `findBySlugForStaff` read and `listUnavailableForStudent` in `packages/db`, the staff `lookup` route and console search box in `apps/web`, and the blame-free "unavailable" line on `/home`. `decide` and `list` are unchanged. The typescript-reviewer raised one HIGH, and the code-reviewer and database-reviewer flagged the same spot as MEDIUM: a malformed lookup slug came back as 403 instead of 400. A fresh Sonnet fixer mapped `invalid` to 400 like `decide` does and added an `it.each` test. The typescript-reviewer re-verified it as fixed with no new findings. One LOW is deferred.

## Findings
- [HIGH] [fixed] apps/web/app/api/staff/verifications/handlers.ts:117 — `lookup` mapped a malformed slug's `RepositoryError('invalid')` to 403 forbidden; it now returns 400 validation, and `scope`/`not_found` stay 403 (route.test.ts `it.each` over malformed slugs).
- [LOW] [deferred 9.3j] apps/web/src/chat/liveChats.ts:106 — `homeLinks` awaits `listUnavailableForStudent` after the owner lookups instead of alongside `listLiveForStudent`, adding one round trip per `/home` render.
