# 12.1b review — APPROVE

Reviewers: security-reviewer (opus), typescript-reviewer (sonnet, also as code-reviewer), lead

The staff id comes only from the session (`withRole` on the routes, `requireRole` on the page). Signed-out users get 401; students, teachers and cross-site POSTs get 403 before the handler runs. The POST body is a strict zod object with the repository's 500-character reason cap. Every write goes through `setVerification`, which refuses a staff user's own profile and writes the `teacher.verify` audit row. Repository errors map to fixed codes, only the error name is logged, and every response is `no-store`. The GET payload carries only teacherId, slug, subject, name and email (plan Q2). The page follows the "trust neither, reset everything" lesson: client calls never reject, every server payload goes through `safeParse` with a fallback, and the busy flag resets in `finally`; jest-axe covers the list, fallback and empty states. The one risk-paths.txt line sits under the security-reviewer group and is the only `.claude/` change.

## Findings

- [LOW] [deferred 12.1c] apps/web/app/api/staff/verifications/handlers.ts — POST accepts any teacher, not only a pending one, so a hand-made request can turn a verified teacher into rejected or the reverse (staff-only and audited); decide whether revoking is allowed and test it.
- [LOW] [deferred 12.1c] apps/web/app/staff/page.tsx — the page's staff check and its name/email read sit outside the new risk glob; add apps/web/app/staff/** to the security-reviewer group.
- [LOW] [deferred 12.1c] apps/web/app/api/staff/verifications/route.int.test.ts — the real-Postgres test leaves a staff user behind in CI's shared database; clean it up.
- [LOW] [deferred 12.1c] apps/web/app/staff/verification-row.tsx — MAX_REASON_CHARS is defined again instead of coming from one shared constant.
- [LOW] [deferred 12.1c] apps/web/app/api/staff/verifications/handlers.ts — list() has no explicit branch for the integrity error kind (it falls through to 500).
