# Handoff: 12.2i

Status: PARTIAL (Phase A done; Phase B to do)

## Phase A

Broke the import cycle between `packages/db/src/repositories/chunks.ts` and `takedowns.ts` by
moving the takedown predicate to a new leaf module with no back-edge to either file.

- **Created** `packages/db/src/repositories/takedown-predicate.ts` — `qualified` and
  `notTakenDown`, moved verbatim from `takedowns.ts` (same JSDoc). Imports only `getTableName`,
  `sql`, `type SQL` from `drizzle-orm`, `type PgColumn` from `drizzle-orm/pg-core`, and
  `takedowns` from `../schema/index.js`; imports nothing from `chunks.ts`, `takedowns.ts` or
  `reports.ts`, so it can never be part of a cycle with them regardless of import order.
- **Modified** `packages/db/src/repositories/chunks.ts` — line 27: imports `notTakenDown` from
  `./takedown-predicate.js` instead of `./takedowns.js`. No other change.
- **Modified** `packages/db/src/repositories/takedowns.ts` — removed the `qualified` const and
  `notTakenDown` function; added `import { notTakenDown } from './takedown-predicate.js';` and
  added `notTakenDown` to the existing `export { ... }` re-export line, so the barrel's
  `export { notTakenDown, ... } from './takedowns.js'` (`repositories/index.ts:328`) needed no
  change. Dropped the now-unused `getTableName` and `type PgColumn` imports. Updated the
  file-header comment to point at the predicate's new home.
- **Modified** `packages/db/src/repositories/reports.ts` — line 38: imports `notTakenDown` from
  `./takedown-predicate.js` directly instead of `./takedowns.js` (per the plan's Q2
  recommendation).
- **Created** `packages/db/test/import-order-reports.test.ts` and
  `packages/db/test/import-order-takedowns.test.ts` — each statically imports only
  `../src/repositories/reports.js` / `../src/repositories/takedowns.js` as its top-level import
  (not the barrel) and asserts one export works.

**Red then green evidence:**

Before the fix, both new test files failed with the exact `ReferenceError` from 12.2h's review:

```
 FAIL  test/import-order-reports.test.ts [ test/import-order-reports.test.ts ]
 FAIL  test/import-order-takedowns.test.ts [ test/import-order-takedowns.test.ts ]
ReferenceError: Cannot access 'qualified' before initialization
 ❯ notTakenDown src/repositories/takedowns.ts:93:91
 ❯ src/repositories/chunks.ts:199:33
 ❯ src/repositories/takedowns.ts:50:1
```

After the fix, both pass, and the rest of the `@edmate/db` suite stays green:

```
 ✓ test/import-order-reports.test.ts (1 test)
 ✓ test/import-order-takedowns.test.ts (1 test)
 Test Files  89 passed (89)
      Tests  1830 passed | 4 skipped (1834)
```

(`notTakenDown` and `takedown-predicate.ts` both show 100% statement/branch/function/line
coverage in the full run's v8 report.)

## Decisions

### 27 Oct 2026 · 12.2i packages/db/src/repositories changes · decided by builder · risk: high
- Decided: the cycle fix touches `packages/db/src/repositories/**` (chunks.ts, takedowns.ts,
  reports.ts, new takedown-predicate.ts), a risky path per `risk-paths.txt`; this PR needs
  security-reviewer (named group) plus the task's own named reviewer set (typescript-reviewer,
  code-reviewer, silent-failure-hunter), per rule 6.
- Why: the plan names this risk group explicitly and it is unchanged in Phase A; logging it here
  so the merge gate can require all four reviewers and `review.md` names them.

No other decision beyond what the plan already made (Q1/Q2 followed as recommended: module name
`takedown-predicate.ts`; `reports.ts` imports it directly rather than through `takedowns.ts`'s
re-export).

## Gate

```
$ corepack pnpm turbo run typecheck lint test --filter=...@edmate/db
Tasks:    20 successful, 20 total
Cached:    7 cached, 20 total
Time:    17m49.948s
```
(`@edmate/db`: 89 test files, 1830 passed | 4 skipped; apps/web and other dependents included via
the `...` filter all typechecked, linted and tested green.)

```
$ corepack pnpm exec prettier --check <Phase A files>
All matched files use Prettier code style!
```

```
$ python3 .githooks/secret-scan.py --all
(no output — clean)
```

## Budget

Phase A tool calls used: 26
