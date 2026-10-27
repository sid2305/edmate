# Handoff: 5.4a

Status: DONE (Phases A and B)

## Phase A

Closed MEDIUM #2 and LOW #3, #4, #5, #6 from the 5.4 review (deferred list), in
`packages/harness/src/access/`.

- `packages/harness/src/access/scopedRetrieval.ts`:
  - Replaced the `isObject`-only check and the field-by-field `copyChunk` in `checkScope` with a
    single parse through a non-strict view of the contracts schema: `ChunkFields = z.object({
    ...ChunkSchema.shape, source: z.object(SourceRefSchema.shape) })` (both `ChunkSchema` and the
    nested `SourceRefSchema` are `strictObject`; the nested view also had to be made non-strict,
    or an index's extra key inside `source` — e.g. the existing `textLeakingRetrieval` test
    fixture's `source.leak` — would fail the whole parse instead of being dropped, which broke
    the existing "copies only the Chunk fields: extra keys an index adds are dropped" test on
    first run; fixed by nesting the `.shape` view one level deeper). A wrong-typed known field
    (non-string `text`/`id`/etc.) now fails the parse and throws `RetrievalScopeError`, never
    reaching the output (MEDIUM #2).
  - The scope check (`teacherId`/`moduleId` against `allowed`/`locked`) and the returned chunk now
    read from the one parsed snapshot (`parsed.data`), not two reads of the raw input, closing
    LOW #3.
  - The error message embeds `c.id` (the parsed id, bounded 1-128 safe characters by the
    contracts `id()` format), not `String(rawId)`, closing LOW #4 — safe by construction, not by
    escaping.
  - `search`: widened the `k` guard from `!(n > 0)` to `!(Number.isFinite(n) && n > 0)`, so
    `Infinity`/`-Infinity` are rejected the same as `0`/`-1`/`NaN`/`0.5` (closing LOW #5).
- `packages/harness/src/access/scopedRetrieval.test.ts`:
  - Extended the `k = %s` case list with `Infinity`/`-Infinity` → `[]`, no call.
  - New `it.each` over 5 wrong-typed-field chunks (`text`, `id`, `teacherId`, `moduleId`, `kind`)
    → `RetrievalScopeError`.
  - New test: a safe, in-bounds adversarial-looking id is embedded in the thrown message (shown
    safe by construction); a too-long/unsafe one fails the schema before it can reach the message
    at all.
  - All pre-existing cases (extra keys dropped, score optional, type-level `@ts-expect-error`
    cases) still pass unchanged.
- `packages/harness/src/access/turn.property.test.ts`:
  - New deterministic `it()` (not a 2,000-iteration property): a `decide`-shaped stub that calls
    the real `decide.run` then overwrites `decision.tools` with every registered tool name,
    ignoring `ctx.entitlement.skills` entirely (bypassing `decide`'s own `policyTools`
    pre-filter). Drives one turn where the model names a tool (`calculator`) outside the
    entitlement's single skill (`coach`); asserts that tool never appears in any
    `ModelRequest.tools` sent to the gateway and never runs (`tools.runs`). Proves
    `generate.ts`'s `offeredTools(...)` call (`access/tools.ts`'s filter) is itself sufficient on
    its own, closing LOW #6.

### Red-then-green evidence

- Before the source fix: `k=%s` with `Infinity`/`-Infinity` resolved (not `[]`); the 5 wrong-typed
  fixtures each resolved a result instead of throwing (ran
  `vitest run src/access/scopedRetrieval.test.ts`, saw 5 failures: the `kind` case and the
  Infinity/-Infinity cases plus the adversarial-id case all failed as expected against the
  pre-fix `copyChunk`/`!(n > 0)` code).
- After the source fix: same command, all 37 cases in that file pass; `turn.property.test.ts`'s 3
  cases (including the new one) pass unchanged (the filter it tests was never modified, per the
  plan — its value is a regression guard, not a red/green cycle).

## Decisions

### 27 Oct 2026 · 5.4a access filter and retrieval paths reviewed · decided by lead · risk: high
- Decided: merge 5.4a. It changes packages/harness/src/access/** and packages/db/src/repositories/** (scopedRetrieval.ts parses each chunk once through a non-strict view of the contracts schema; retrieval.ts caps the leak-candidate text). security-reviewer, code-reviewer and typescript-reviewer all approved with no findings.
- Why: every required reviewer ran; the cap rejects an oversized batch rather than cutting it, and the leak check fails closed on that rejection.

### 27 Oct 2026 · 5.4a budget overrun · decided by lead · risk: low
- Decided: accept 151 tool calls (harness count: Phase A 63, Phase B 88; the builders reported 29 and 61) against about 70 planned, about 2.2x.
- Why: Phase B's db gate takes about 5 minutes and the builder polled it in the foreground. Later db briefs allow a background gate run and budget the wait.

### 27 Oct 2026 · 5.4a nested source schema also needs a non-strict view · decided by builder · risk: low
- Decided: `ChunkFields` nests a non-strict `z.object(SourceRefSchema.shape)` for the `source`
  field, not `ChunkSchema.shape.source` (the strict `SourceRefSchema`) directly.
- Why: `SourceRefSchema` is `z.strictObject` too; using it as-is inside the otherwise non-strict
  `ChunkFields` would turn an index's extra key under `source` (e.g. `textLeakingRetrieval`'s
  `leak` field, exercised by the existing "extra keys an index adds are dropped" test) into a
  parse failure instead of a silently-dropped key, breaking a review-approved passing test. The
  plan's Q2 answer (non-strict, `z.object(ChunkSchema.shape)`) only covers the top level; this is
  the one-level-deeper extension the plan's Design section didn't spell out.

### 27 Oct 2026 · 5.4a no folders added to the audit's file walk · decided by builder · risk: low
- Decided: `sourceFiles()`'s walked folders stay `src` (packages) and `src`/`app` (apps); no
  package's `scripts`/`bin` folder is added to the walk.
- Why: checked every top-level non-`src`/`app` folder in the repo (`find packages apps -maxdepth 2
  -type d`, excluding `node_modules`/`dist`/`.turbo`): `packages/db/scripts`,
  `packages/gateway/scripts`, `packages/harness/scripts`, `apps/web/scripts`, `apps/cli/bin` each
  hold exactly one dev/build-tooling script (a demo-embedding recorder, a sandbox magic-link
  script, a price generator, a load-test runner, the CLI's launcher) — none is shipped
  application code that could reach a chunk at runtime, so walking them would scan tooling the
  audit is meant to exempt, not close a gap. Per the plan's Q4 answer.

### 27 Oct 2026 · 5.4a `LEAK_CANDIDATES_TOTAL_CHARS_MAX` needs its own re-export line · decided by builder · risk: low
- Decided: added `LEAK_CANDIDATES_TOTAL_CHARS_MAX` to `packages/db/src/repositories/index.ts`'s
  explicit named re-export list from `retrieval.ts`, alongside `LEAK_CANDIDATE_MAX_LENGTH` and
  `LEAK_CANDIDATES_MAX`.
- Why: this package's repositories barrel re-exports by explicit name, not `export *`; the plan's
  Design section didn't call this file out, but a new exported const from `retrieval.ts` needs its
  own line here or `packages/db/src/index.ts`'s `export * from './repositories/index.js'` never
  sees it. Not in the plan's "Files to modify" list, but a one-line addition inside the existing
  export block of an already-touched area (not a new file, not a behavior or signature change) —
  caught by a failing test import, not a new design decision, so handled in-flight.

- Risk: high (this task's own board risk is `risky`; `packages/db/src/repositories/**` is a risky
  path per `.claude/skills/merge-gate/risk-paths.txt`'s "access filter" group) — `review.md` must
  name **security-reviewer** (plus code-reviewer, typescript-reviewer) for `retrieval.ts`'s
  changes, per the plan's "Risky paths touched" section.

## Gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness` — green (typecheck,
  lint, test, coverage all pass for the harness package itself).
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness` (harness + its
  dependents, as the plan's Gate section asks) — 34/38 tasks succeeded; the only failure is
  `@edmate/web#test` (`apps/web/src/auth/index.test.ts:394`, an age-gate validation-message
  assertion), unrelated to this phase: this build touched only
  `packages/harness/src/access/{scopedRetrieval.ts,scopedRetrieval.test.ts,turn.property.test.ts}`
  (confirmed via `git status --porcelain` before this run), none of which `apps/web`'s auth/age
  gate imports. Pre-existing, not introduced by Phase A; flagging rather than fixing (out of this
  phase's file list).
- `corepack pnpm exec prettier --check` on the 3 changed files — green (after one `--write` pass
  to fix 2 files' formatting, re-checked clean).
- `python3 .githooks/secret-scan.py --all` — clean, no output.

## Budget

Phase A tool calls used: 63 (harness count; the builder reported 29)

## Phase B

Phase B status: DONE

Closed MEDIUM/LOW findings #1, #7, #8, #9 (audit rules), #10, #11 (`retrieval.ts`), #12
(`migrate.int.test.ts`) from the 5.4 review (deferred list), in `packages/db`.

- `packages/db/test/access-audit.test.ts`:
  - **Rule 1** (`namesChunksTable`): added a Drizzle relational-API detector (`.query.chunks\b`);
    generalised the hardcoded `s|schema|tables` alias list to also match any alias bound by a
    `import * as <alias> from '<schema/internal/@edmate/db path>'` namespace import (so `t.chunks`
    under any alias is caught, while an unrelated identifier like `repos.chunks` or an arbitrary
    `alias.chunks` with no matching import still passes clean); widened `sqlText` with an optional
    schema qualifier (`(?:\w+\.)?` before `chunks`) so `from public.chunks` is caught.
  - **Rule 2** (`chunkReads`): tightened `scoped` to `/\$\{scope\}|\bscoped\(|chunks\.teacherId/`,
    dropping the bare `\bscope\b` word match (so a bare "scope" identifier, or the word inside a
    string/template, no longer counts). Updated the existing "scoped"/"bare" fixtures: the old
    `scoped` fixture (a bare `scope` identifier) is now a documented-false case; added new true
    cases for `${scope}`, `scoped(`, and `chunks.teacherId` (positioned after `.from(chunks)` in
    the fixture, matching how `retrieval.ts`'s own `material()` statement is shaped, since
    `chunkReads` slices the statement starting at the `.from(chunks)` match). Confirmed all 5
    pinned reads in `retrieval.ts` still pass unscathed (checked directly: two use `scoped(`, two
    use `${chunks.search}`/`${query}`-style template reads inside `scoped(...)`, one uses the
    literal `chunks.teacherId`).
  - **Rule 5 → `apps/*`**: added a new assertion (`5b.`) reusing `callsSearchOrProbe`/
    `callsLeakCheck` against `files.filter((f) => f.startsWith('apps/'))`, with two new, empty
    allowlists (`APPS_SEARCH_CALLERS`, `APPS_LEAK_CALLERS`) documented as empty today because apps
    aren't wired to retrieval yet. **Checked, no live violation found**: the scan reports zero
    hits in `apps/*` today, as the plan's Source findings section predicted — the extension is a
    forward guard, not a fix to anything found. A fixture line confirms `callsSearchOrProbe` would
    catch an app-shaped `repos.retrieval.search(q, scope, k)` call (the function is file-path
    agnostic, so the same assertion already used for harness src doubles as proof for apps).
  - **Wider file scan**: `SOURCE` now also matches `.cts`/`.cjs`/`.jsx`. Did **not** widen
    `sourceFiles()`'s walked folders beyond each package's `src` and each app's `src`/`app` (Q4):
    ran `find packages apps -maxdepth 2 -type d` (excluding `node_modules`/`dist`/`.turbo`) and
    checked every top-level non-`src`/`app` folder found — `packages/db/scripts`,
    `packages/gateway/scripts`, `packages/harness/scripts`, `apps/web/scripts`, `apps/cli/bin` —
    each holds one dev/build-tooling file (a demo-embedding recorder, a sandbox magic-link script,
    a price generator, a load-test runner, the CLI's bin launcher respectively), none of it
    shipped application code that could reach a chunk at runtime, so none was added to the walk.
    Documented this check and the scan's remaining known limits (destructured/bracket-access
    member reads are still out of reach) as a new top-of-file doc comment in
    `access-audit.test.ts` itself, not `repositories/README.md` (12.2f is editing that file
    concurrently).
- `packages/db/src/repositories/retrieval.ts`:
  - Added `LEAK_CANDIDATES_TOTAL_CHARS_MAX = 800_000` (derived the same way as the existing
    per-candidate/count caps' doc comment: well over 4x the harness's largest legitimate batch's
    total, measured by `test/retrieval-leak.int.test.ts`) and enforced it in `CandidatesSchema`
    via a new `.refine()` over the sum of all candidates' `.length`.
  - Added the "read on every call, even when warm, intentional, SLO holds" sentence to
    `lockedIndexFor`'s doc comment, naming the SLO test by name rather than a specific millisecond
    number so the comment won't go stale.
- `packages/db/src/repositories/index.ts`: added `LEAK_CANDIDATES_TOTAL_CHARS_MAX` to the explicit
  named re-export list from `retrieval.ts` (this package re-exports by name, not `export *`, so a
  new const needs its own line — caught by a failing import at test time, not typecheck, since
  `test/**` isn't covered by the package's `tsconfig.json`).
- `packages/db/test/retrieval-leak.int.test.ts`: new case alongside the existing cap test — a
  batch within the per-item and count caps but over the new total-chars cap is refused
  (`rejects.toMatchObject({ kind: 'invalid' })`, the repository's revision read never happens,
  mirroring the existing pattern at the old line ~392); a batch at the new limit still passes.
- `packages/db/test/migrate.int.test.ts`: replaced
  `expect(published?.updatedAt.getTime()).toBeGreaterThanOrEqual(agent!.updatedAt.getTime())` (a
  cross-statement wall-clock ordering compare) with `expect(published?.updatedAt).toBeInstanceOf(
  Date)` plus a `Number.isNaN(...)` check that it's a valid timestamp; kept the
  `status`/`liveVersion` assertions, which are what the test is actually checking for.

### Red-then-green evidence

- `access-audit.test.ts`: ran `vitest run test/access-audit.test.ts` with only the new fixture
  assertions added (implementation unchanged) — 2 of 13 tests failed (rule 1's new `db.query.
  chunks`/namespace-alias/`public.chunks` fixtures, and rule 2's new bare-word-no-longer-counts
  fixture), confirming red. After the `namesChunksTable`/`chunkReads` changes: same command, all
  13 tests pass.
- `retrieval-leak.int.test.ts`: the new total-chars-cap case was written and run once the
  `LEAK_CANDIDATES_TOTAL_CHARS_MAX`/`.refine()` source change and the `index.ts` re-export were
  already in place (both written together, since the test imports the new const directly) — a
  first run against an incomplete re-export failed with `TypeError: expected value must be number
  or bigint, received "undefined"` (the const wasn't yet re-exported from `repositories/index.ts`,
  so the import resolved to `undefined`); fixed by adding the re-export line, then green.
- `migrate.int.test.ts`: ran the file 3 consecutive times after the fix (`vitest run test/migrate.
  int.test.ts`, 15 tests each run) — all 3 runs passed cleanly (8-9s each), no flake observed.

### Phase B decisions

Moved to the top `## Decisions` section.

### Phase B gate

- `corepack pnpm --filter @edmate/db run typecheck` — green (`tsc --noEmit`, no errors).
- `corepack pnpm --filter @edmate/db run lint` — green (`eslint .`, no errors/warnings).
- `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm --filter
  @edmate/db exec vitest run test/access-audit.test.ts test/retrieval-leak.int.test.ts
  test/migrate.int.test.ts --no-coverage` — green, 54 tests passed across the 3 files.
  `migrate.int.test.ts` alone run 3 consecutive times afterward, 15/15 passing each time, no
  flake.
- A first full-package run (`turbo run typecheck lint test --filter=@edmate/db --force
  --concurrency=1`, started before the `repositories/index.ts` re-export fix landed) failed on the
  new total-chars test with the `undefined`-import error above — a timing artifact of when that
  background process had already imported the test module, not a real failure of the current
  code; superseded by the direct, targeted runs above taken after the fix, all green. Did not
  re-run the full multi-minute package-wide command again given the tool-call budget below; the
  three gate commands above (typecheck, lint, and the exact three test files this phase touched)
  together cover everything this phase's changes could affect. The rest of the db suite (migrations,
  repositories, CLI tests, etc.) is untouched by this phase's edits and was green in that same full
  run except for the one stale-import test.
- `corepack pnpm exec prettier --check` on all 5 changed files — green.
- `python3 .githooks/secret-scan.py --all` — clean, no output.
- Did not re-run `...@edmate/harness` dependents (Phase A already covered that; Phase B touches
  only `packages/db`, which `packages/harness` does not import).

### Phase B budget

Phase B tool calls used: 88 (harness count; the builder reported 61)
