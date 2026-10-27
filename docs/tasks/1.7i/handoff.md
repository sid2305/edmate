# 1.7i handoff — build-smoke cleanup assigned before createSession

**Status: DONE**

## Summary

`apps/web/test/build-smoke.test.ts`'s `beforeAll` previously called `identity.createSession`
before assigning `eraseStudent`. If `createSession` threw, the student row created just before it
would leak on the shared dev Postgres instead of being erased by `afterAll` (1.7d code-reviewer
MEDIUM). The `eraseStudent` assignment now runs immediately after `identity.createStudent`, and
`identity.createSession` runs after it, so cleanup is set before any later step that can throw.
Added a one-line comment recording the ordering rule.

Changed:

- `apps/web/test/build-smoke.test.ts` — moved the `createSession` call below the `eraseStudent =
  async () => {...}` assignment; added a comment noting cleanup is assigned first.

## Decisions

### 26 Oct 2026 · 1.7i budget overrun (39 vs 15) · decided by lead · risk: low
- Decided: accept 39 harness-counted tool calls against a 15-call budget (2.6x); no rework.
- Why: the change is a two-line reorder. The extra calls went to the web gate auto-backgrounding and the builder polling its log. Both reviewers approved with no findings.


## Gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web` — `Tasks: 10 successful, 10
  total`. The `build-smoke` suite itself is `describe.skipIf(!up)`-gated on a reachable
  `TEST_DATABASE_URL`/Postgres; that env wasn't set in this run, so the suite **skipped** (same as
  the 1.7d baseline) — the edited code path was exercised only by local typecheck/lint, not by a
  live DB run. No other `@edmate/web` test file was affected by this change.
- `corepack pnpm exec prettier --check apps/web/test/build-smoke.test.ts
docs/tasks/1.7i/handoff.md` — both files pass (`All matched files use Prettier code style!`).
- `python3 .githooks/secret-scan.py --all` — clean, no findings.

## Budget

Tool calls used: 39 (harness count; the builder reported 17)
