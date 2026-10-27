# 9.3n handoff

Status: DONE

## Summary
Two review LOWs from 9.3m, both with tests:

1. `apps/web/app/staff/verification-row.tsx`: the subject-history `<li>` no longer keys on the
   array index alone. It now keys on
   `` `${change.ts}|${change.from}|${change.to}|${i}` `` -- see Decisions below for why the index
   suffix is always included. `apps/web/app/staff/view.test.tsx`'s existing two-change test
   ("shows the subject-change history on a queue row (9.3m, B-58)") now asserts the two lines
   render **in order** (reads the `listitem`s and compares an ordered array), not just that both
   are present.
2. `apps/web/app/api/staff/verifications/route.test.ts`: added six new cases, three for `list`
   and three for `lookup`:
   - `audit.findSubjectHistoryForStaff` rejects with `RepositoryError('scope', ...)` -> 403,
     `listForbidden` / `lookupForbidden`.
   - `audit.findLastVerifyForStaff` rejects with `RepositoryError('scope', ...)` -> 403, same
     messages.
   - a plain `Error('boom tch_a')` -> 500, the generic failed message, body/log carries no
     teacher id or raw error text.
   `handlers.ts` was not touched; all six passed against the existing `enrichQueueRows` /
   `list` / `lookup` error handling with no code change needed.

## Decisions

### 26 Oct 2026 · 9.3n subject-history key always suffixes the index · decided by builder · risk: low
- Decided: the key is `` `${change.ts}|${change.from}|${change.to}|${i}` `` -- the index suffix is
  always present, not only added when a collision is possible.
- Why: the plan allowed adding the index "only then" (when two changes can share all three
  fields), but detecting that case would need a second pass over the array just to decide the key
  shape. Always including `i` is simpler, still gives React a stable identity across renders of
  the same list (the index is a tiebreaker, not the only key), and costs nothing since
  `subjectHistory` is never reordered in place.

### 26 Oct 2026 · 9.3n merge touches apps/web/app/api/staff (tests only) · decided by builder · risk: high
- Decided: this PR's only change under `apps/web/app/api/staff/**` is to
  `route.test.ts` (new test cases); `handlers.ts` is byte-for-byte unchanged.
- Why: that path is in the risk-paths list, so the merge gate needs the risk-high decision logged
  even though the change is test-only and found no new finding against the handler.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web` -> all 10 tasks green
  (typecheck, lint, test), full suite passing, coverage report produced.
- `corepack pnpm exec prettier --check` on `apps/web/app/staff/verification-row.tsx`,
  `apps/web/app/staff/view.test.tsx`, `apps/web/app/api/staff/verifications/route.test.ts` ->
  "All matched files use Prettier code style!"
- `python3 .githooks/secret-scan.py --all` -> clean, no output.

## Budget
Tool calls used: 24
