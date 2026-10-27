# 3.9f handoff

Status: DONE

Built across two builders: a prior builder wrote most of the implementation and the lead
committed its work-in-progress as `34b0446a`; this builder reviewed that work against the plan,
fixed one typecheck error, fixed formatting, ran the full gate (including the new integration
test against a real local Postgres), and pushed.

## Summary

`edmate chat` now switches `deps.retrieval` from the in-memory lexical index to the production
db-backed `RetrievalIndex` when `env.DATABASE_URL` is set, with no `packages/db` change (every
piece used is already public API).

- `apps/cli/src/commands/chat/dbRetrieval.ts` (new) — `dbConfigured(env)`, `buildDbRetrieval(env,
  teacherId, content)` (opens `openDatabase`, auto-seeds chunks once if none exist, returns
  `retrievalIndexFor(repos)` + `close`), `seedChatChunks(repos, content, teacherId)` (the
  `parseMarkdown`/`indexDocument` chunk-writing loop, exported for test reuse). Exported functions
  the switch uses: `openDatabase`, `retrievalIndexFor` from `@edmate/db`; `parseMarkdown`,
  `indexDocument` from `@edmate/ingest` (`chunkDocument` is not called directly — `indexDocument`
  does the chunking internally when given `source: { kind: 'parsed', ... }`, so importing it
  separately was an unused import; removed, see Deviations).
- `apps/cli/src/commands/chat/deps.ts` — `buildChatDeps` picks `buildDbRetrieval` over
  `buildChatRetrieval` when `dbConfigured(opts.env)`; `ChatSetup` gained `close?: () =>
  Promise<void>`.
- `apps/cli/src/commands/chat.ts` — calls `await setup.close?.()` after the chat loop, before
  `rl.close()`, on every clean exit path (exit, Ctrl+D, Ctrl+C alike).
- `apps/cli/src/commands/chat/deps.test.ts` — added the no-`DATABASE_URL` regression test (in-memory
  path unchanged, `setup.close` undefined).
- `apps/cli/test/chatDbRetrieval.int.test.ts` (new) — throwaway Postgres database, seeds a teacher/
  course/module rows + real chunks via `seedChatChunks`, runs the three `sameTopic.test.ts`
  same-topic turns through `buildChatDeps`/`runTurn` on the scripted gateway only, asserts no
  `error`/`locked` events and the saved help rung climbs above 0.
- `apps/cli/package.json` — added `@edmate/db`, `@edmate/ingest` (dependencies), `pg`, `@types/pg`
  (devDependencies, pinned to `apps/worker`'s versions).
- `apps/cli/eslint.config.js` — switched to `@edmate/config/eslint/app` (copied from
  `apps/worker/eslint.config.js`), with `no-restricted-imports` off for `test/**` so the new
  integration test can import `@edmate/db/internal`.
- `pnpm-lock.yaml` — regenerated for the new `package.json` deps (no unrelated churn; `pnpm install
  --frozen-lockfile` passed unmodified, confirming the lockfile already matched).

This builder's changes on top of the inherited WIP: removed the unused `chunkDocument` import in
`dbRetrieval.ts` (typecheck error), and ran `prettier --write` on the new integration test file
(one formatting issue).

## Decisions

### 26 Oct 2026 · 3.9f unused chunkDocument import · decided by builder · risk: low
- Decided: removed the `chunkDocument` import from `dbRetrieval.ts` instead of wiring it in.
- Why: `indexDocument({ writer, scope, documentId, source: { kind: 'parsed', document, headings:
  true } })` already chunks internally (same call shape `recall.int.test.ts` uses); importing
  `chunkDocument` separately was dead code and failed `tsc`'s `noUnusedLocals`. No behaviour
  change — `seedChatChunks` was already correct without it.

### 26 Oct 2026 · 3.9f chat.ts close-on-error path · decided by builder · risk: low
- Decided: no change needed to the pre-existing `catch (e)` around `buildChatDeps` (line ~205 in
  `chat.ts`).
- Why: per the plan's instruction to confirm rather than assume — `setup` is only assigned after
  `buildChatDeps` returns successfully, and `setup.close` only exists on a `ChatSetup` once
  `buildDbRetrieval` itself returned successfully (it opens the pool and returns the handle
  together, never partially). A thrown error inside `buildChatDeps`/`buildDbRetrieval` therefore
  never reaches a point where a pool handle exists but is unreachable from the catch; the
  catch path cannot leak a pool. Confirmed by reading `chat.ts`'s catch block and
  `buildDbRetrieval`'s body: no deviation, no fix needed.

## Gate

```
corepack pnpm install --frozen-lockfile   # passed, no lockfile change needed
corepack pnpm turbo run typecheck lint test --filter=@edmate/cli... --force --concurrency=1
```
Result: 34/34 tasks successful (after fixing the unused-import typecheck error). Full `@edmate/cli`
test run: `Test Files 14 passed (14)`, `Tests 159 passed | 1 skipped (160)`.

`chatDbRetrieval.int.test.ts` run directly against the real local Postgres
(`TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate`, the shared dev instance,
not started/stopped by this builder):
```
Test Files  1 passed (1)
     Tests  1 passed | 1 skipped (2)
```
(the "1 skipped" entry is the `describe.skipIf(up)` reachable-fallback block's own `it.skip`,
expected when Postgres is up.)

```
corepack pnpm exec prettier --check <changed files>
```
Found one issue (`chatDbRetrieval.int.test.ts`), fixed with `prettier --write`; re-checked clean.

```
python3 .githooks/secret-scan.py --all
```
Clean (no output).

## Budget

Tool calls used: 34
