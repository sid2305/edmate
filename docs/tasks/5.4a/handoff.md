# Handoff: 5.4a

Status: DONE (Phase A)

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

### 27 Oct 2026 · 5.4a nested source schema also needs a non-strict view · decided by builder · risk: low
- Decided: `ChunkFields` nests a non-strict `z.object(SourceRefSchema.shape)` for the `source`
  field, not `ChunkSchema.shape.source` (the strict `SourceRefSchema`) directly.
- Why: `SourceRefSchema` is `z.strictObject` too; using it as-is inside the otherwise non-strict
  `ChunkFields` would turn an index's extra key under `source` (e.g. `textLeakingRetrieval`'s
  `leak` field, exercised by the existing "extra keys an index adds are dropped" test) into a
  parse failure instead of a silently-dropped key, breaking a review-approved passing test. The
  plan's Q2 answer (non-strict, `z.object(ChunkSchema.shape)`) only covers the top level; this is
  the one-level-deeper extension the plan's Design section didn't spell out.

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

Phase A tool calls used: 29
