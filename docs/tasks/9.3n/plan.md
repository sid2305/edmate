# 9.3n plan: 9.3m review LOWs (subject-history key, enrich error tests)

Written by the lead (26 Oct 2026): two small, fully specified items, so no planner run.

## Acceptance (board)
> Both items done, with tests.

## Files
1. `apps/web/app/staff/verification-row.tsx` (line ~84): the subject-history `<li>` uses `key={i}`.
   Key it on the change itself: `` key={`${change.ts}|${change.from}|${change.to}`} ``. If two changes can share all three
   (the same edit audited twice in one millisecond), keep the key unique by adding the index as a
   suffix only then; say in the handoff which one you chose and why.
   Test: in the existing staff view test file that renders a queue row (`apps/web/app/staff/view.test.tsx`,
   or wherever verification-row is already rendered in a test), render a row with two subject
   changes and assert both lines show in order. Don't add a new test framework or helper.
2. `apps/web/app/api/staff/verifications/route.test.ts`: new cases where `enrichQueueRows` throws
   part-way, for **both** `list` and `lookup`:
   - `audit.findSubjectHistoryForStaff` rejects with `RepositoryError('scope', …)` → 403 with the
     route's forbidden message (list: `listForbidden`; lookup: `lookupForbidden`);
   - `audit.findLastVerifyForStaff` rejects with `RepositoryError('scope', …)` → 403, same messages;
   - either one rejects with a plain `Error('boom')` (or `RepositoryError('failed', …)`) → 500, the
     generic failed message, and the body/log carries no teacher id or error text beyond what the
     existing failure tests already allow.
   Use `mockRejectedValueOnce` on the existing mocks; don't change their default behaviour.
   **No change to `handlers.ts`.** If a test shows the handler maps a case wrongly, stop and report
   it (that is a new finding for the lead), don't fix it here.

## Risky paths
- `apps/web/app/api/staff/**` (route.test.ts only) → reviewers: security-reviewer (risk group), plus
  code-reviewer and typescript-reviewer. The handoff logs a `risk: high` decision for the merge.

## Gate
```
corepack pnpm turbo run typecheck lint test --filter=@edmate/web
```
Plus `corepack pnpm exec prettier --check` on the changed files and `python3 .githooks/secret-scan.py --all`.

## Budget
Budget: 25 tool calls (1 phase, @edmate/web only). Past 35, commit and push, then stop with PARTIAL.

## Exit
Status: DONE when both items have tests and the gate is green.
