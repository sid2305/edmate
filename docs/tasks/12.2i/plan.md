# Plan: 12.2i — 12.2h review LOWs (import cycle + report category dedup)

## Goal

Title (board, verbatim): 12.2h review LOWs: (1) break the import cycle between
`packages/db/src/repositories/chunks.ts` and `takedowns.ts` (chunks.ts calls `notTakenDown` at
module load; importing `reports.ts` or `takedowns.ts` before the barrel throws "Cannot access
'qualified' before initialization"), e.g. move `qualified`/`notTakenDown` into a module with no
back-edge to chunks.ts, with a test that imports reports.ts first; (2) the report category list is
duplicated in apps/web (`app/api/sessions/[id]/reports/handlers.ts`, `app/staff/reports/client.ts`,
`src/chat/reportMessage.ts`) instead of using `REPORT_CATEGORIES` from `@edmate/db`, so a new
category added only in db does not fail typecheck there (security-reviewer, typescript-reviewer,
code-reviewer, silent-failure-hunter).

Acceptance (verbatim, board): "importing any repositories module directly, in any order, loads
without error; every report category list in apps/web derives from one source; db and web
typecheck, lint and test green".

How it will be shown: the gate commands below (full `test` run, not just the two new regression
tests) pass green for both `@edmate/db` and `apps/web`; the two new `packages/db/test` files fail
before the fix (red, reproducing the exact `ReferenceError` from 12.2h's review) and pass after;
for the web side, a deliberate, reverted one-line edit shows the new compile-time guard actually
catches a dropped category (typecheck red → green), described under "Tests first" below.

## Root cause (confirmed by tracing, not just the review's one-line note)

`chunks.ts` imports `notTakenDown` from `./takedowns.js` and calls it **eagerly at module-eval
time** inside the module-level `documentColumns` object (`chunks.ts:185-200`, specifically line
199: `` sql<boolean>`not ${notTakenDown(documents.id)}` ``). `takedowns.ts` imports `bumpRevision`
from `./chunks.js` on line 50, *before* its own `const qualified = ...` (line 84) — the const that
`notTakenDown`'s body reads.

- Importing `reports.ts` (which imports `notTakenDown` from `./takedowns.js`) or `takedowns.ts`
  directly requests `takedowns.ts` first. Node starts executing it, hits line 50's import of
  `chunks.js` *before* takedowns.ts has reached line 84, so it starts executing `chunks.ts`.
  `chunks.ts` reaches its own top-level `documentColumns` and calls `notTakenDown(documents.id)`.
  `notTakenDown` is a hoisted function (available), but its body reads `qualified`, which is a
  `const` in `takedowns.ts` not yet initialised (still paused at line 50) — TDZ, throws.
- `retrieval.ts` also imports `notTakenDown` from `./takedowns.js`, but its own import of
  `./chunks.js` (for `EmbeddingSchema`) comes *before* its import of `./takedowns.js`, so
  `chunks.ts` always finishes loading (and its own takedowns.js request completes takedowns.ts
  fully, cleanly) before retrieval.ts's own `notTakenDown` import is requested. Confirmed by
  reading the import order in `retrieval.ts:12,17` — this is why the review names only
  `reports.ts`/`takedowns.ts` as broken entry points, not `retrieval.ts`. No change needed there.
- `teacher-profiles.ts` imports `staffAction`/`takeDownAgentInTx` from `takedowns.ts` too, but is
  not named in the review and is fixed as a byproduct of the same root-cause fix (not separately
  tested — see Open questions).

Fix: give `chunks.ts`'s top-level, eager `notTakenDown` call a dependency that never itself
depends on `chunks.ts` — move `qualified` and `notTakenDown` to a new leaf module
(`takedown-predicate.ts`) whose only imports are `drizzle-orm` and the schema. `chunks.ts` imports
`notTakenDown` from there instead of from `takedowns.ts`; `takedowns.ts` re-exports it (same public
name, same path via the barrel) so no caller outside this file changes. This removes the cycle
entirely, regardless of which module is imported first.

## Files to create

- `packages/db/src/repositories/takedown-predicate.ts` — the `qualified` helper and `notTakenDown`,
  moved verbatim from `takedowns.ts` (same JSDoc, updated header comment explaining why it's a
  separate leaf module). Imports only `getTableName`, `sql`, `type SQL` from `drizzle-orm`,
  `type PgColumn` from `drizzle-orm/pg-core`, and `takedowns` from `../schema/index.js`. Imports
  nothing from `chunks.ts`, `takedowns.ts` or `reports.ts`, so it can never be part of a cycle with
  them. **Risk group: `packages/db/src/repositories/**` → reviewers: security-reviewer.**
- `packages/db/test/import-order-reports.test.ts` — statically imports
  `../src/repositories/reports.js` as its only top-level import (not the barrel), asserts it loads
  and its exports work. Not a risky path (`packages/db/test/**` is not in risk-paths.txt).
- `packages/db/test/import-order-takedowns.test.ts` — same, for
  `../src/repositories/takedowns.js`. Not a risky path.

## Files to modify

- `packages/db/src/repositories/chunks.ts` — line 27: `import { notTakenDown } from
  './takedowns.js';` → `import { notTakenDown } from './takedown-predicate.js';`. No other change;
  `documentColumns` (line 199) keeps calling `notTakenDown` the same way. **Risk group:
  `packages/db/src/repositories/**` → reviewers: security-reviewer.**
- `packages/db/src/repositories/takedowns.ts` — remove the `qualified` const and `notTakenDown`
  function (current lines 84-96); add `import { notTakenDown } from './takedown-predicate.js';`
  and add `notTakenDown` to the existing `export { TAKEDOWN_KINDS, ... }` re-export line (63) so
  the barrel's `export { notTakenDown, ... } from './takedowns.js'` (repositories/index.ts:328)
  needs no change. Drop the now-unused `getTableName` and `type PgColumn` from the drizzle-orm /
  drizzle-orm/pg-core imports (keep `and, desc, eq, or, sql, type SQL`, all still used elsewhere in
  the file, e.g. `staffAction`'s `extra: SQL` parameter). Update the file-header comment (lines
  1-33) where it says "`notTakenDown` below is the only place that writes the predicate" to say it
  now lives in `takedown-predicate.ts`. **Risk group:
  `packages/db/src/repositories/**` → reviewers: security-reviewer.**
- `packages/db/src/repositories/reports.ts` — line 38: `import { notTakenDown } from
  './takedowns.js';` → `import { notTakenDown } from './takedown-predicate.js';` (reports.ts only
  ever needed `notTakenDown`, not anything else from takedowns.ts; importing the leaf module
  directly is a one-line change and removes reports.ts's indirect dependency on takedowns.ts's own
  module-load order). **Risk group: `packages/db/src/repositories/**` → reviewers:
  security-reviewer.**
- `apps/web/app/api/sessions/[id]/reports/handlers.ts` — this file already imports
  `@edmate/db` at runtime (it's a server route handler, not client-bundled). Import
  `REPORT_CATEGORIES` and `type ReportCategory` from `@edmate/db` instead of the local
  `ReportBody.shape.category` enum (`z.enum(['harmful', ...])`, lines 35-37): change `ReportBody`'s
  `category` field to `z.enum(REPORT_CATEGORIES)` and drop the local `type ReportCategory =
  z.infer<...>` in favour of the imported type. `CATEGORY_EXCERPT` (lines 44-50) keeps its shape
  (`Record<ReportCategory, string>`) but now over the imported type, so a new db category fails
  `tsc` here with a clear "missing property" error. Not a risky path by glob (sessions routes
  aren't in risk-paths.txt's security-reviewer list), but still reviewed per the task's own named
  reviewer set.
- `apps/web/app/staff/reports/client.ts` — this is a `'use client'`-bundled module (imported by
  `app/staff/reports/view.tsx`) that deliberately avoids importing `@edmate/db` at runtime (comment,
  line 14: "mirrored here so this client never imports `@edmate/db`" — db pulls in `pg`/server-only
  code). Add `import type { ReportCategory as DbReportCategory } from '@edmate/db';` (type-only:
  erased by the compiler, zero runtime bundle cost) above the existing `REPORT_CATEGORIES` array
  (lines 15-22). Change the array declaration to `as const satisfies readonly DbReportCategory[]`
  (catches an extra/wrong category) and add a second, unused-at-runtime literal object checked
  against `Record<DbReportCategory, true>` (the codebase's existing exhaustiveness idiom — see
  `packages/harness/src/pipeline/results.ts`'s `POLICY_REASONS`) so a category *added* to db and
  missing here also fails `tsc`. `export type ReportCategory = (typeof
  REPORT_CATEGORIES)[number];` is unchanged. **Risk group: `apps/web/app/staff/**` → reviewers:
  security-reviewer.**
- `apps/web/src/chat/reportMessage.ts` — same pattern as client.ts (it's imported by
  `ReportButton.tsx`, a `'use client'` component, for the same "never pull `@edmate/db` into the
  client bundle" reason stated in its own comment, lines 9-11). Add the type-only import, the
  `satisfies readonly DbReportCategory[]` and the `Record<DbReportCategory, true>` exhaustiveness
  object. Not a risky path by glob (`apps/web/src/chat/**` isn't in risk-paths.txt).

No change to `packages/db/src/repositories/index.ts` or `packages/db/src/index.ts` (both read for
context only — confirmed every export path callers use stays the same) or to `retrieval.ts` /
`teacher-profiles.ts` (fixed as a byproduct; see Open questions for why no separate test).

## Files out of bounds (do not touch)

- `packages/db/src/repositories/learner.ts` (6.3b, in CI)
- `packages/db/src/schema/content.ts`, `packages/db/src/migrate.ts` (8.2p, in CI)
- `apps/web/src/auth/**` (1.4c, planning)
- Every `apps/web/src/chat/*` file except `reportMessage.ts` — in particular `ChatView.tsx`,
  `MessageBubble.tsx`, `sendTurn.ts`, `turnState.ts`, `sse.ts`, `loadChat.ts`,
  `liveChats.ts` and the rest: 6.4a (session end) is planning and may touch this directory; the
  lead should sequence 12.2i's `reportMessage.ts` edit against whatever 6.4a's plan claims there.
  `ReportButton.tsx` (which imports `reportMessage.ts`) is also not edited — its import of
  `REPORT_CATEGORIES`/`ReportCategory` keeps working unchanged.
- `packages/db/src/repositories/retrieval.ts`, `packages/db/src/repositories/teacher-profiles.ts` —
  not touched (see root-cause analysis: not broken entry points today); redirecting their imports
  to the new leaf module is optional cleanup, not required by the acceptance line, and out of scope
  for "smallest change".
- `packages/db/src/repositories/README.md` — documents `notTakenDown`'s *usage*, not its defining
  file; left unedited (see Open questions).

## Tests first (red then green)

**Phase A (db, the cycle):**
1. Write `packages/db/test/import-order-reports.test.ts` and
   `packages/db/test/import-order-takedowns.test.ts` (content: a single static top-level import of
   `../src/repositories/reports.js` / `../src/repositories/takedowns.js` respectively — nothing
   else of this package imported first — plus one `it` asserting an export works, e.g.
   `reportRowId(...)` matches `/^rp_/` and `notTakenDown(documents.id)` is defined). Vitest isolates
   each test file's module registry by default (`packages/db/vitest.config.ts` sets
   `fileParallelism: false` for Postgres contention reasons, but does **not** set `isolate: false`),
   so each file's first import is genuinely this package's first touch — reproducing 12.2h's bug
   exactly.
2. Run `corepack pnpm turbo run test --filter=@edmate/db -- import-order` (or the full db test
   command below) against the **unmodified** code: both new files must fail with
   `ReferenceError: Cannot access 'qualified' before initialization` (red — confirms the repro).
3. Apply the `chunks.ts` / `takedowns.ts` / new `takedown-predicate.ts` changes above.
4. Re-run: both new files pass (green), and the rest of the `@edmate/db` suite (`reports.test.ts`,
   `takedowns.test.ts`, `chunk-writer.test.ts`, the `.int.test.ts` files, `repositories.int.test.ts`)
   stays green — this is a pure refactor, no behaviour change, no new `RepositoryError` paths.

**Phase B (web, category dedup):** there is no new runtime behaviour to assert (the five
categories are unchanged), so "red then green" here is a compile-time check:
1. Before editing, confirm the three web test files are green (`route.test.ts`, `client.test.ts`,
   `reportMessage.test.ts`) — baseline.
2. Make the edits (type-only import + `satisfies` + `Record<DbReportCategory, true>` guard in
   `client.ts` and `reportMessage.ts`; direct `REPORT_CATEGORIES` import in `handlers.ts`).
3. As a one-off local check (not committed): temporarily delete one entry from `client.ts`'s (or
   `reportMessage.ts`'s) `REPORT_CATEGORIES` array and confirm `corepack pnpm turbo run typecheck
   --filter=apps/web` fails on the `Record<DbReportCategory, true>` literal (missing property) —
   proving the guard actually catches a dropped/added category. Revert the temporary deletion.
4. Re-run the three web test files (unchanged behaviour, still green) and the typecheck/lint gate
   for real.

## Gate commands

```bash
source ~/.nvm/nvm.sh && corepack pnpm install
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=...@edmate/db
python3 .githooks/secret-scan.py --all
```

(`--filter=...@edmate/db` — leading `...` — runs `@edmate/db` and everything that depends on it,
including `apps/web`, per the brief; this is the one command that proves both halves of the
acceptance line together.)

## Risky paths touched

- `packages/db/src/repositories/**` (chunks.ts, takedowns.ts, reports.ts, new
  takedown-predicate.ts) → reviewers: **security-reviewer**.
- `apps/web/app/staff/**` (client.ts) → reviewers: **security-reviewer**.
- Combined with the task's own named reviewer set (security-reviewer, typescript-reviewer,
  code-reviewer, silent-failure-hunter), the PR needs all four; `review.md`'s `Reviewers:` line
  must name all four, and the handoff logs a `risk: high` decision (rule 6).
- Not risky by path: `apps/web/app/api/sessions/[id]/reports/handlers.ts`,
  `apps/web/src/chat/reportMessage.ts`, `packages/db/test/**` — still covered by code-reviewer
  (every PR) and the task's named reviewers.
- No ADR needed: no change to `packages/contracts`, the tech stack, or prompt-pack behaviour; this
  is an internal module-boundary fix and an import-source dedup.

## Open questions (with recommendation)

1. **New module's name/location** — `packages/db/src/repositories/takedown-predicate.ts` vs.
   something else (e.g. `takedowns-sql.ts`). *Recommendation:* use
   `takedown-predicate.ts` — names what it is (the one predicate), matches the file's existing
   singular-concept naming (`role-lock.ts`, `question-similarity.ts`), and keeps `notTakenDown`
   re-exported from `takedowns.ts` unchanged.
2. **Should `reports.ts` import `notTakenDown` from the new leaf module directly, or keep going
   through `takedowns.ts`'s re-export?** *Recommendation:* import directly — it's a one-line
   change, removes a layer of indirection, and reduces the chance a future edit to `takedowns.ts`
   reintroduces a similar eager-call hazard for this particular caller. `retrieval.ts` is left as
   re-exported-through-takedowns.ts since it isn't broken today and touching it isn't required.
3. **Should `retrieval.ts` and `teacher-profiles.ts` also get dedicated import-order regression
   tests**, since they also consume `takedowns.ts`'s exports? *Recommendation:* no — traced their
   own import order above and confirmed they are not currently broken entry points (the review
   named only `reports.ts`/`takedowns.ts`); adding tests for every consumer broadens this LOW-risk
   cycle fix beyond "smallest change." If a reviewer disagrees, it's a cheap follow-up, not a
   blocker.
4. **Should `packages/db/src/repositories/README.md` be updated** to name `takedown-predicate.ts`
   as `notTakenDown`'s new home? *Recommendation:* skip for this PR — the README describes usage
   (where the predicate is applied), not its defining file, and isn't wrong after the move; not
   required by the acceptance line.
5. **Is a type-only import of `@edmate/db` into two `'use client'`-bundled files
   (`client.ts`, `reportMessage.ts`) actually zero-runtime-cost**, given no `isolatedModules` /
   `verbatimModuleSyntax` setting was found in `apps/web/tsconfig.json`? *Recommendation:* yes —
   `import type { X } from '...'` is erased by TypeScript's emit regardless of those flags (they
   only affect ambiguous *value* imports that happen to only use types); 76 other `apps/web/src`
   files already import `@edmate/db` at runtime without issue, confirming the package resolves
   fine from this app, and a type-only import carries none of that runtime weight. If a reviewer
   wants extra assurance, grep the built client chunk for `@edmate/db`/`pg` after `pnpm build` —
   not proposed as a blocking step here.

## Budget

Budget: 90 tool calls (2 phases, packages/db + apps/web)

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (typecheck/lint/test gate commands, secret scan — no git push
or merge; the lead handles merge once the gate passes)

## Exit conditions

- **Phase A (packages/db) — Status: DONE** when `takedown-predicate.ts` exists, `chunks.ts` /
  `takedowns.ts` / `reports.ts` import it as described, the two new `import-order-*.test.ts` files
  are red before the fix and green after, and `corepack pnpm turbo run typecheck lint test
  --filter=@edmate/db` is green. **PARTIAL** if past ~55 tool calls, or if fixing the cycle turns
  out to require touching `retrieval.ts`/`teacher-profiles.ts` (contradicting the traced root
  cause above) — stop and hand back with what was found.
- **Phase B (apps/web) — Status: DONE** when all three named files derive their category list from
  `@edmate/db` (directly for `handlers.ts`, via a type-only import + exhaustiveness guard for the
  two client-bundled files), the existing web tests for all three stay green, and
  `corepack pnpm turbo run typecheck lint test --filter=...@edmate/db` (which includes `apps/web`)
  is green. **PARTIAL** if past ~35 tool calls, or if a fourth apps/web file turns out to duplicate
  the category list (not found in this planning pass) — stop and hand back.

## Lead answers (27 Oct 2026)

- **Q1–Q5:** as recommended (`takedown-predicate.ts`; reports.ts imports it directly; no extra import-order tests; README untouched; type-only imports in the client-bundled files).
- Phases run as separate builders on one branch, `m13/12.2i-takedown-cycle`: Phase A (packages/db) now, Phase B (apps/web) after Phase A is pushed. Never rebase; `git merge --no-edit origin/main` if needed.
- Keep every exported name from `@edmate/db` unchanged; the barrel re-exports must still resolve.
- Reviewers: security-reviewer, typescript-reviewer, code-reviewer, silent-failure-hunter.
