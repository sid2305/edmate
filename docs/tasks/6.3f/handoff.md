# Handoff: 6.3f

Status: DONE

## Summary

Shipped all five fixes from the plan plus the lead's Q2 add-on, each with a failing-then-passing
test:

1. **`mistakeProposalsRepo.approve` enforces `STYLE_CARD_LIMITS.tagsMax` (20)** before calling
   `insertNextVersion`: if the merged tag list would exceed 20, it throws
   `RepositoryError('limit', method)` (lead's Q3 answer) and leaves the proposal `pending` and the
   style card untouched. Test: `approve refuses a 21st tag past STYLE_CARD_LIMITS.tagsMax; no new
   style-card version` — red (a 21-tag card was written) before, green after.
2. **`record` now checks the actor is still a teacher** via `lockRole`, same two branches
   `approve`/`reject` already use (`null` → `not_found`, non-teacher → `scope`). Test: `record for
   an existing non-teacher user is scope, not a silent write` — red (the call silently wrote a row
   for a student id) before, green after. Driving this fix to 100% branch coverage also needed a
   second new case, `record for a teacherId with no such user is not_found, not a silent write`
   (the `role === null` branch), which the plan's "How it is shown" list didn't name but the
   `@edmate/db` coverage gate requires for `src/repositories/**`.
3. **`record` takes a per-teacher advisory lock** (`MISTAKE_PROPOSAL_LOCK_NAMESPACE = 8402`,
   distinct from `style-cards.ts`'s `8401`) before its count-then-insert sequence, inside the same
   transaction as fix 2. Test: `concurrent record calls for the same teacher never push the stored
   row count over MISTAKE_PROPOSALS_MAX` — fired three concurrent 40-tag batches (120 total) for a
   *fresh* teacher (zero existing rows); red (ended at 120 rows, over the 100 cap) before, capped
   at 80 after (two batches fit, the third correctly refused, no partial write). See "plan guesses
   that were wrong" below for why the scenario needed a fresh teacher, not a near-cap one.
4. **`lastSeen` uses an offset-bearing ISO datetime schema** instead of a bare `z.string()`. Test:
   `record with a lastSeen that is not a valid offset-bearing ISO datetime is invalid; no row
   written` — red (`'not-a-date'` reached `new Date()` and surfaced as `kind: 'failed'`, not
   `'invalid'`) before, green after.
5. **`mistakeProposalRoutes.ts`'s `Tag` schema imports `STYLE_CARD_LIMITS.tagMaxChars`** instead of
   a hardcoded `.max(60)`. `mistakeProposalRoutes.test.ts` stays green unchanged (same effective
   cap, 60); the existing test at line 142 already exercises `approve` throwing `RepositoryError
   ('limit', ...)` through the route to a 409 `limit_reached`, satisfying the lead's "test this
   through the route as well as the repository" instruction with no new test needed.
6. **Q2: `styleCardRoutes.ts`'s identical `Candidate = z.string().max(60)`** now imports the same
   `STYLE_CARD_LIMITS.tagMaxChars`. `styleCardRoutes.test.ts` stays green unchanged.

### Plan guesses that were wrong

- **`timestamp` is not importable from `@edmate/contracts`.** The plan's fix 4 design assumed
  `timestamp` (from `contracts/src/formats.ts`) was part of the public API; `formats.ts`'s own
  header comment says the opposite ("Not part of the public API") and it is not re-exported from
  `contracts/src/index.ts`. Exporting it would be a `packages/contracts` change needing an ADR
  (rule 2), out of bounds for this task. Fixed by defining the identical `z.iso.datetime({ offset:
  true })` call locally in `mistake-proposals.ts` (a one-line duplicate, not a re-implementation),
  with a comment explaining why it isn't imported.
- **The concurrency test needed a *fresh* teacher, not one "already near" the cap.** The plan's
  "How it is shown" §3 described firing concurrent calls against a teacher already near
  `MISTAKE_PROPOSALS_MAX`. Tracing the actual code: `record`'s existing `SELECT ... FOR UPDATE`
  on the teacher's *existing* rows already row-locks and so serialises concurrent calls the moment
  there is at least one pre-existing row to contend on — the real gap is only exploitable when the
  teacher has **zero** stored rows (nothing to lock), so two or more concurrent calls can each read
  a stale zero-count before either writes. Verified empirically: a near-cap pre-fill scenario
  passed even against the unfixed code (not red), so I used a fresh teacher with three concurrent
  40-tag batches instead, which reproduced the real race (red at 120 rows, fixed at 80).
- `mistake-proposals.ts` otherwise matched the plan closely (`Tag` already imported
  `STYLE_CARD_LIMITS.tagMaxChars`, `lockRole`/`RepositoryError` imports already present, `approve`'s
  existing no-op shape for the race case was `{ approved: false, card: null }` as guessed).

## Decisions

### 27 Oct 2026 · 6.3f risk: high — a `packages/db/src/repositories/**` fix · decided by builder · risk: high
- Decided: ship the four `mistake-proposals.ts` fixes (tag cap on approve, role check and advisory
  lock on record, `lastSeen` format) in one PR, same file 6.3a itself logged `risk: high` for.
- Why: `risk-paths.txt` lines 29-41 (`packages/db/src/repositories/**`) require security-reviewer;
  the board task itself already carries `risk: high`.

### 27 Oct 2026 · 6.3f optional rate limit deferred (Q1, lead-decided) · decided by builder · risk: low
- Decided: no per-teacher rate limit on approve/reject in this task, and no follow-up task opened.
- Why: the lead's answer treats this as a wontfix — approve/reject are teacher-only, signed-in,
  same-origin and already bounded by the 100-row proposal cap.

### 27 Oct 2026 · 6.3f `timestamp()` duplicated locally instead of exported from contracts · decided by builder · risk: low
- Decided: `mistake-proposals.ts` defines its own `z.iso.datetime({ offset: true })` constant
  rather than importing `timestamp` from `@edmate/contracts` (not exported, see "plan guesses that
  were wrong" above) or adding it to the contracts' public exports.
- Why: exporting a new symbol from `packages/contracts` needs an ADR (rule 2); this task's scope
  and budget don't include one, and the duplicate is a single, well-commented line with identical
  behaviour.

## Gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db` → 8/8 tasks successful;
  `@edmate/db:test` 94 files, 1911 tests (1907 passed, 4 skipped), coverage 100% statements/
  branches/functions/lines on `src/repositories/**` (required threshold).
- `corepack pnpm turbo run typecheck --filter=...@edmate/db` → 12/12 tasks successful (`@edmate/cli`,
  `@edmate/db`, `@edmate/web`, `@edmate/worker` all typecheck clean against the changed exports).
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web` → 10/10 tasks successful.
- `corepack pnpm --filter @edmate/db run db:generate` → "No schema changes, nothing to migrate" —
  no drift, no new migration (this task touches no schema).
- `corepack pnpm exec prettier --check` on the four changed files → "All matched files use Prettier
  code style!"
- `python3 .githooks/secret-scan.py --all` → clean, no output.

## Budget

Tool calls used: 44
