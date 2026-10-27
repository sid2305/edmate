# 13.4g plan: export dedupe tie-break, parseConsentRow error contract

Lead-written plan (small, fully specified task; 26 Oct 2026). Closes the two findings deferred from docs/tasks/13.4f/review.md.

## Acceptance (verbatim)
> on an exact periodEnd tie the export keeps the non-ended subscription, shown by a test; parseConsentRow's error contract is documented or wrapped.

## Files
- `apps/web/src/export/accountExport.ts` (~line 89): the dedupe replaces the strict `pair.periodEnd > existing.periodEnd` test with a small local comparator `newer(a, b)`:
  1. the later `periodEnd` wins;
  2. on an exact `periodEnd` tie, a row whose `status` is not `'ended'` beats an `'ended'` row;
  3. if both still tie, the smaller `${status}` string wins (a stable key, so the result doesn't depend on the order `listAllForStudent` returns rows).
  Update the comment above the loop to say so. No change to `SubscriptionPair`, the cap or the backend.
- `apps/web/src/export/accountExport.test.ts`: new cases:
  1. two rows for one `(teacherId, agentId)` with the same `periodEnd`, the `'ended'` row listed first and the `'active'` row second → the one `teachers` entry is the active one;
  2. the same two rows in the opposite order → still the active one.
- `packages/db/src/identity/store.ts` (~line 242, the doc-comment on `parseConsentRow`): document the error contract: it throws a raw `ZodError` on a bad `grantedBy`; inside the store it only runs behind `guarded` (via `guardAll`), which scrubs it; any other caller must do the same or treat the throw as a programming error. Comment-only; no code change in this file.

## Not in scope
- No change to `packages/db/src/repositories/subscriptions.ts` (ordering stays as is; the comparator makes order irrelevant).
- No `packages/contracts` change.

## Tests first
Write the two cases, watch case 1 fail on the current strict `>`, then add the comparator.

## Risky paths
- `packages/db/src/identity/**` (store.ts, comment only) → reviewer: `security-reviewer`. Also run `code-reviewer` and `typescript-reviewer`. The handoff logs a `risk: high` decision for the identity path (comment-only change).

## Gate
```
export TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate
corepack pnpm turbo run typecheck lint test --filter=@edmate/db --filter=@edmate/web
```
Plus `corepack pnpm exec prettier --check` on changed files and `python3 .githooks/secret-scan.py --all`.

## Budget
Budget: 20 tool calls (1 phase).

## Exit conditions
Status: DONE when both new cases and the existing suites are green and the gate is clean. Status: PARTIAL past ~28 tool calls, or if the fix needs any file outside this list.
