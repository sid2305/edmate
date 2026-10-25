# 8.3d plan: 8.3b review follow-ups (outline Promise.all; reuse db's OutlineInputSchema)

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "8.3b review follow-ups: outline generate reads module chunks with Promise.all instead of
one by one; outline.ts reuses the db package's OutlineInputSchema instead of re-declaring it (drop
the cast)"
Accept: "the MEDIUM and LOW in docs/tasks/8.3b/review.md are fixed."

### How it is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| MEDIUM fixed | `apps/web/src/studio/outline.ts`'s `moduleInputs` reads every module's chunks with one `Promise.all` instead of a sequential `for`/`await` loop; same return shape (modules with zero chunks still skipped), existing `outline.test.ts` generate tests stay green (one of them already asserts `chunks.listForModule` is called for both `m1` and `m2` — add nothing new, just confirm order-independent assertions still pass). |
| LOW fixed | `apps/web/src/studio/outline.ts` imports `OutlineInputSchema` from `@edmate/db` (newly exported from `packages/db/src/repositories/outline.ts` and re-exported from `packages/db/src/repositories/index.ts`) instead of re-declaring `TitleSchema`/`OrderSchema`/`TopicInputSchema`/`ModuleInputSchema`/`PutSchema`/local `Id` locally; `put`'s `body as OutlineInput` cast is dropped because `parseBody(req, OutlineInputSchema)` already infers `OutlineInput`. |
| No behaviour change | `apps/web/src/studio/outline.test.ts` and `packages/db/test/outline.int.test.ts` pass unchanged (no new test files needed — this is a refactor of already-tested paths); `@edmate/db` and `@edmate/web` typecheck/lint/test gates green. |

## Design

1. `packages/db/src/repositories/outline.ts` — add `export` to the existing `OutlineInputSchema`
   const (currently only its inferred type `OutlineInput` is exported, per 8.3b review LOW finding).
   No change to the schema's shape, limits or refinements.
2. `packages/db/src/repositories/index.ts` — add `OutlineInputSchema` to the existing
   `export { ... } from './outline.js'` block (same block that already exports
   `DEFAULT_COURSE_TITLE`, `OUTLINE_MODULES_MAX`, `type OutlineInput`, etc., around line 227-235).
3. `apps/web/src/studio/outline.ts`:
   - Import `OutlineInputSchema` from `@edmate/db` alongside the existing named imports
     (`OUTLINE_MODULES_MAX`, `OUTLINE_TITLE_MAX_LENGTH`, `OUTLINE_TOPICS_MAX`, `RepositoryError`,
     `TOPIC_CHUNKS_MAX`).
   - Delete the locally re-declared `Id`, `TitleSchema`, `OrderSchema`, `unique`,
     `TopicInputSchema`, `ModuleInputSchema`, `PutSchema` (lines ~55-78) — check first whether
     `unique`/`TitleSchema`/`OrderSchema` are used anywhere else in the file (a quick grep); if any
     of the three is reused elsewhere, keep only that one and drop the rest.
   - Use the imported `OutlineInputSchema` wherever `PutSchema` was passed (the `put` handler's
     `parseBody(req, PutSchema)` call).
   - `put`'s `const result = await b.outline.replaceOutline(scope, body as OutlineInput);` →
     `const result = await b.outline.replaceOutline(scope, body);` (now that `body` is
     `z.infer<typeof OutlineInputSchema>`, i.e. `OutlineInput`, with no cast needed). Drop the
     `OutlineInput` type import too if it becomes unused (check with a grep across the file first —
     `toOutlineInput`'s return type annotation also uses it, so it likely stays imported).
   - `moduleInputs` (lines ~93-109): replace the `for (const m of outline.modules) { const chunks =
     await b.chunks.listForModule(scope, m.id); ... }` sequential loop with a `Promise.all` over
     `outline.modules.map(async (m) => ...)`, then filter out modules with zero chunks (e.g. map to
     `{ moduleId, title, chunks } | null` and `.filter((x) => x !== null)`, or map to chunk arrays
     first and zip). Preserve the exact existing behaviour: a module with 0 ready chunks is omitted
     from the returned `OutlineModuleInput[]`; order of the returned array does not need to match
     `outline.modules`' order (no test asserts output order, only that both `m1` and `m2` were
     called — confirm with a read of `outline.test.ts` before assuming, since changing order could
     break a snapshot-style assertion).
4. No schema shape, validation message, or route behaviour changes — this is purely de-duplication
   and parallelization, matching the review's own description of both findings.

## Files to create/modify

- Modify: `packages/db/src/repositories/outline.ts` (add `export` keyword to `OutlineInputSchema`).
- Modify: `packages/db/src/repositories/index.ts` (add `OutlineInputSchema` to the existing
  `outline.js` export block).
- Modify: `apps/web/src/studio/outline.ts` (reuse the schema, drop local duplicates and the cast;
  `moduleInputs` uses `Promise.all`).
- No new files. No test files need to be created — existing `packages/db` and `apps/web` test
  suites already cover `OutlineInput` validation and `generate`'s per-module chunk reads; this task
  only needs those suites to stay green (review them to confirm, don't skip the gate).

## Files out of bounds

- `apps/web/app/staff/**` — a different in-flight task (per lead's instruction).
- `packages/db/src/repositories/audit.ts` — a different in-flight task.
- `packages/db/src/cli.ts` — a different in-flight task.
- Everything else under `docs/tasks/8.3/plan.md`'s "Files out of bounds" still applies by
  inheritance (no contracts/ADR change, no `apps/web/src/auth/**` edit, no queue/worker change,
  no module-level merge/split) — this task is strictly smaller than any of those concerns.
- `packages/db/src/repositories/chunks.ts`, `map.ts`, `scope.ts` — not touched; `listForModule`'s
  signature and return shape are unchanged, only the caller's control flow changes.

## Tests first

1. Before touching code, run the existing gates once to capture a clean baseline:
   `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`
   and `--filter=@edmate/web...`.
2. After each change, re-run the same two gates. The acceptance bar for this task is "the MEDIUM
   and LOW are fixed" with no regression — not new test cases — so no new test file is required.
   If, while reading `outline.test.ts`'s generate-fixture test more closely, the builder finds the
   `Promise.all` change could plausibly change observable order (e.g. a test asserts the returned
   outline's module order rather than just which modules were drafted), add one small assertion or
   note there instead of changing behaviour to fit the existing test.
3. `packages/db/test/outline.int.test.ts` needs no change (the schema's shape is identical; only
   its export visibility changed).

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- `packages/db/src/repositories/outline.ts`, `packages/db/src/repositories/index.ts` both match
  `packages/db/src/repositories/**`. **Reviewers: security-reviewer** (per the risk-paths.txt group
  covering "keeping each teacher's and student's data apart" — even though this diff is an export
  visibility change with no logic change, the glob match is path-based, not diff-based, so the gate
  requires it). Recommend `typescript-reviewer` too, as routine practice (an export-surface change).
- `apps/web/src/studio/outline.ts` — no glob in `risk-paths.txt` matches `apps/web/src/studio/**`
  (same precedent as 8.3's own plan noted for Phases B/C). Not gate-risky.
- This task's handoff logs a `risk: high` decision (CLAUDE.md non-negotiable 6, since the
  `packages/db/src/repositories/**` group is touched), even though the change is narrow.

## Open questions

- None. Both fixes are fully specified by the 8.3b review findings and the existing code; no
  design choice is left open.

## Budget

Budget: 30 tool calls (1 phase, packages/db + apps/web)

## Allowed tools

Read, Grep, Glob, Edit, Bash (typecheck/lint/test gates, secret scan).

## Exit conditions

Builder stops at `Status: DONE` once `@edmate/db` and `@edmate/web`'s `typecheck lint test` gates
are green with the export added and the two call sites fixed, and the secret scan is clean. Stops
at `Status: PARTIAL` past roughly 30 tool calls, or if fixing either finding turns out to need a
change outside `packages/db/src/repositories/outline.ts`, `index.ts` or
`apps/web/src/studio/outline.ts` (e.g. if `Promise.all`'s reordering breaks an existing assertion
in a way that needs the test file itself edited beyond a one-line order fix) — goes back to the
lead rather than being decided mid-build.

## Status

READY

## Lead answers (25 Oct 2026)
No questions. Reviewers: security-reviewer, code-reviewer, typescript-reviewer. The handoff logs the repositories `risk: high` decision. Budget 30; stop at 40 and return PARTIAL. 9.3h is running on packages/db/src/repositories/audit.ts and apps/web/app/staff: don't touch those.
