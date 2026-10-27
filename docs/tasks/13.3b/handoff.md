# Handoff: 13.3b

Status: DONE

## Summary

Resolved the three 13.3b-deferred LOWs from `docs/tasks/13.3/review.md`:

1. `packages/db/src/repositories/chunks.ts` — `insertTopicLinks` and `topicSources` took a raw
   `teacherId: string` outside the `scope.test.ts` grid. Both now take a `TeacherScope` and call
   `teacherScope(scope, '<method>')` as the first statement in the body, before their respective
   empty-array early returns, so a bad scope throws `RepositoryError('scope', ...)` even on an
   empty `links`/`topicIds` call instead of silently returning `0`/`[]`.
2. `packages/db/src/repositories/outline.ts` — the two call sites updated to pass `{ teacherId }`
   instead of the bare string (`topicSources(db, { teacherId }, ...)` at the line that builds a
   module's outline sources, `insertTopicLinks(tx, { teacherId }, links)` in the publish
   transaction). No other change to this file.
3. `apps/web/src/turn/routes.ts` — the session-id route param no longer reuses
   `StartSessionSchema.shape.agentId`. Added `import { TurnInputSchema, ... } from '@edmate/contracts'`
   (merged into the existing contracts import), `const SessionIdSchema = TurnInputSchema.shape.sessionId;`
   with a one-line comment, and `ParamsSchema` now reads `z.object({ id: SessionIdSchema })`. No
   behaviour change (both ids are the same contracts `id()` format) and no change to
   `StartSessionSchema` or `clientInput.ts`.

## Tests (red, then green)

- `packages/db/test/scope.test.ts`: added two new `it()` blocks inside the existing
  `describe('every repository method rejects a bad scope before any SQL', ...)` block —
  `insertTopicLinks rejects a bad scope before any SQL (not on createRepositories, 13.3b)` and
  `topicSources rejects a bad scope ...`. Each imports the two functions directly from
  `../src/repositories/chunks.js`, iterates `BAD_SCOPES`, calls with a throwaway `undefined as
  never` tx/db and an empty links/topicIds array, and asserts `RepositoryError` with
  `kind === 'scope'` and the fixed method name. Because both functions are `async`, the assertion
  follows the existing async pattern already used in this file for
  `subscriptions.listAllForStudent` (`.then(() => new Error('resolved'), (e) => e)`), not the
  sync `expectScopeError` helper used for the construction-time checks (`transcriptStoreFor`,
  `usageMeterFor`), since an `async function`'s synchronous throw becomes a promise rejection, not
  a thrown value `expectScopeError`'s `try { fn() }` would catch.
  - Red: before the `chunks.ts` change, both new tests failed —
    `AssertionError: expected Error: resolved to be an instance of RepositoryError` (the empty-array
    early return resolved instead of throwing).
  - Green: after the `chunks.ts`/`outline.ts` change, `vitest run test/scope.test.ts` passes
    159/159.
- `apps/web/src/turn/routes.test.ts`: no new test added (per the plan, the fix is behaviour-identical
  by construction — same underlying contracts `id()` format on both `agentId` and `sessionId`).
  Re-ran the full file after the `ParamsSchema` swap: 38/38 pass, unchanged.

## Open questions

- `apps/web/src/auth/config.ts`'s database session `maxAge` (30 days) was read to confirm the
  value but is untouched, per the plan and the lead's answer. This is tracked as human blocker
  **B-60**: recommend shortening it (e.g. 7 days) before a wider launch, since a stolen or shared
  session cookie otherwise stays valid for 30 days; this is a product/security trade-off the spec
  did not decide, so it stays open for the human.

## Decisions

None — both code changes are the mechanical fixes already specified by the 13.3 review findings;
the only open item is the `config.ts` `maxAge` question above, which is explicitly left to the
human as B-60 rather than decided here.

## Gate

```
corepack pnpm turbo run typecheck lint test --filter=@edmate/db...
```
→ 26/26 tasks successful (typecheck, lint, test across @edmate/db and its deps). `test/scope.test.ts`
159/159 passing.

```
corepack pnpm turbo run typecheck lint test --filter=@edmate/web...
```
→ 34/34 tasks successful. (One transient run hit a 5000ms import timeout in
`src/auth/route-coverage.test.ts` for two routes under full-suite parallel load; re-run of that
file alone and of the full gate both passed clean — a pre-existing flake unrelated to this change,
not caused by any file this task touched.)

```
corepack pnpm exec prettier --check <changed files>
```
→ `apps/web/src/turn/routes.ts` needed `--write` (import wrapping only, no content change);
re-checked clean after.

```
python3 .githooks/secret-scan.py --all
```
→ clean, no output.

## Budget

Tool calls used: 29
