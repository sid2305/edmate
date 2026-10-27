# Handoff: 8.2a

Status: DONE

## Phase A

Production storage fail-closed and sign-before-write, plus the deploy-docs line.

- `apps/worker/src/storage/roundtrip.ts` — `storageConfigFromEnv` now throws a new
  `StorageConfigError` (a `code` only, never a value) under `NODE_ENV=production` when
  `S3_ENDPOINT`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`/`S3_BUCKET` is missing, blank, or equal
  to its own `DEV_DEFAULTS` entry, and when the endpoint is plain http unless
  `S3_ALLOW_HTTP==='true'`. `NODE_ENV=development|test` keep the old dev-default fallback.
  Red: ran the new production test cases against the unmodified file first — `storageConfigFromEnv`
  never threw for a missing production value (it silently substituted the MinIO default). Green:
  after the edit, `apps/worker/src/storage/roundtrip.test.ts` (33 tests) passes.
- `apps/web/src/storage/presign.ts` — `storageConfigFromEnv`'s existing production check (already
  refused a missing/blank value) now also refuses each of the four `REQUIRED_IN_PRODUCTION`
  settings when it equals its own `DEV_DEFAULTS` value (code `${name}_placeholder`), closing the
  "copy-pasted docker/env.example into a production deploy" gap. Green: `presign.test.ts` (new
  `it.each` case) passes; the existing missing/blank and https-only cases are unchanged.
- `apps/web/src/studio/routes.ts` — `create`'s moduleId/liveClassId ownership check happens inside
  `documents.create` itself (a foreign-key-shaped check, not a separate read), unlike `replace`
  whose ownership check is a plain `get`. So `create` keeps the write first (existing tests for a
  foreign `moduleId`/`liveClassId` require `storage.createUploadUrl` never called and nothing
  written) and now wraps the signing call in a try/catch: on a signing failure it deletes the
  just-written row (best effort, logged on its own failure) before rethrowing, so no `uploading`
  row survives the request. Red: added
  `it('a signing failure commits nothing: the row is cleaned up, no orphan upload row survives')`
  against the unmodified route — failed (row was left behind). Green: after the edit,
  `routes.test.ts` (81 tests) passes, including the two pre-existing foreign-id tests.
- `docker/env.example` — added a line next to the existing `S3_ALLOW_HTTP` note (same shape as the
  `AGE_NOTICE_ALLOW_UNSIGNED` precedent two lines below it): a real deployment never sets
  `S3_ALLOW_HTTP`, and the four required settings must never be left at their dev placeholder
  values.

**State after this phase**: a production worker or web process with a missing, blank or
dev-default S3 setting throws/refuses to build its storage config, naming only a code; `create`
never leaves an orphan `uploading` row after a signing failure (by cleanup rather than by
reordering, see Decisions). Phases B (UploadsView unmount guard) and C (module names in the
picker) are untouched.

## Phase B

UploadsView unmount guard (item 5).

- `apps/web/app/teacher/uploads/UploadsView.tsx` — added a `mounted` ref set in a `useEffect`
  cleanup, checked before every `setDocs`/`setBanner`/`patch` call that follows an `await` in
  `refresh`, `send`, `finish` and `onDelete` (`patch` itself also guards, as a second layer for any
  caller). After an unmount, a late response from `listDocuments`, `completeDocument`,
  `deleteDocument` or `putFile`'s `onProgress` callback is a no-op instead of touching state.
- `apps/web/app/teacher/uploads/UploadsView.test.tsx` — new case: start an upload, let it reach the
  in-flight `completeDocument` ("complete") request, unmount, then resolve that request. Red:
  against the unmodified component, `finish`'s post-completion `refresh()` still fired after
  unmount, adding one more `GET /api/studio/documents` fetch call (5 calls where 4 were expected);
  confirmed by temporarily stashing just the component file (`git stash push -u` scoped to that one
  path, `git stash apply`, then `git stash drop`) and re-running the test, which failed with
  "expected 5 to be 4". (React 19 no longer warns on a post-unmount `setState`, so the test asserts
  no extra fetch call fires rather than spying on `console.error` for a warning that no longer
  exists; a `console.error` spy is kept in the test as a belt-and-suspenders check, asserting it is
  never called for any other reason.) Green: after restoring the guarded component, the same test
  passes (`UploadsView.test.tsx`, 21 tests).

**State after this phase**: no `UploadsView` async handler (`refresh`, `send`, `finish`,
`onDelete`) touches state or fires a follow-up fetch after the component unmounts. Phase C (module
names in the picker) is untouched.

## Phase C

Module names in the picker (item 6).

- `packages/db/src/repositories/modules.ts` — new `list(scope)` method, same `teacherScope` guard
  and `orderBy(asc(modules.id))` as the existing `ids`, returning `{ id, title }[]` (exported as
  `ModuleListItem`). `ids` is unchanged (still used nowhere else in this diff, left in place for
  any other caller).
- `packages/db/src/repositories/index.ts` — exports `ModuleListItem` alongside the package's other
  repository row types.
- `packages/db/test/repositories.int.test.ts` — new `'modules.list'` case in the cross-teacher
  isolation table (same shape as the existing `'modules.ids'` case: untargeted read, owner derived
  from the id's teacher-letter suffix), required by `RepositoryMethod`'s union type (a new
  repository method with no isolation case fails `tsc`). Green: `test/repositories.int.test.ts`
  (192 tests, against the shared dev Postgres) passes, including the new case's cross-teacher
  isolation check (another teacher's modules never appear).
- `apps/web/app/teacher/uploads/page.tsx` — reads `repos.modules.list(...)` instead of `.ids(...)`
  and passes the result as `UploadsView`'s new `modules` prop.
- `apps/web/app/teacher/uploads/UploadsView.tsx` — `UploadsViewProps.moduleIds: string[]` replaced
  with `modules: readonly ModuleOption[]` (`{ id, title }`, exported); the picker's `<option>` now
  renders `m.title`, falling back to the existing `t('moduleOption', { n: i + 1 })` placeholder
  only when a module's title is blank.
- `apps/web/app/teacher/uploads/UploadsView.test.tsx` and `page.test.tsx` — every
  `moduleIds={[...]}` call site updated to the new `modules` prop (a `mods(ids)` test helper gives
  each synthetic id its own synthetic title); two new cases: the picker renders each module's real
  title and never the word "Module 1" when titles are set, and falls back to the numbered
  placeholder when a title is blank. Red: ran the new/updated tests against the unmodified
  `UploadsView.tsx` (temporarily stashed just that one file with `git stash push -u` scoped to the
  path, `git stash apply`, `git stash drop`) — every test in the file failed with a `TypeError`
  (`moduleIds[0]` on `undefined`, since the old component still destructured `moduleIds`). Green:
  after restoring the Phase C component, `UploadsView.test.tsx` (23 tests) and `page.test.tsx` (2
  tests) pass.
- `apps/web/messages/en.json` — unchanged; `uploads.moduleOption` is kept as the fallback string
  for a module with a blank title, per the plan.

**State after this phase**: the upload centre's module picker shows each module's real title; a
module with no title falls back to the existing numbered placeholder rather than breaking. All
three phases are complete.

## Decisions

### 27 Oct 2026 · 8.2a unmount test asserts no extra fetch call, not just no console warning · decided by builder · risk: low
- Decided: the Phase B unmount test's primary assertion is that no extra `fetch` call fires after
  unmount (checked by comparing the call count before and after the late response resolves), with
  a `console.error` spy kept as a secondary check.
- Why: the plan's test sketch (spy `console.error` for "state update on an unmounted component")
  no longer applies under React 19 — React removed that warning because a post-unmount `setState`
  is a silent no-op, not a bug to warn about. A console.error-only assertion would pass even
  against the unfixed component (confirmed: it did), so it would not be red before the fix. The
  extra-fetch-call assertion is red against the unmodified component (5 calls instead of 4,
  verified by stashing just the component file) and green after the guard, which is what the plan's
  exit condition ("the unmount-guard test is red-then-green") requires.

### 27 Oct 2026 · 8.2a packages/db/src/repositories/modules.ts gains a list() read method · decided by builder · risk: high
- Decided: `modules.ts` (under the risky `packages/db/src/repositories/**` glob) gains a `list()`
  method returning each of the scope's modules as `{ id, title }`, alongside the existing `ids()`.
- Why: the upload centre's module picker needs a real title, not a bare id, and the title column
  (`modules.title`, `packages/db/src/schema/content.ts`) already exists -- no migration. The new
  method adds no write, no new table or column, and uses the exact same `teacherScope` guard and
  `orderBy(asc(modules.id))` as `ids()`, so it opens no new access path; it is flagged `risk: high`
  only because it falls under the risky repositories glob, per this repo's merge-gate rule (any
  risky-path file makes the whole PR's decision `risk: high`), and needs security-reviewer plus
  database-reviewer (this repo's standing convention for `packages/db` changes) before merge.

### 27 Oct 2026 · 8.2a create keeps write-before-sign, cleans up on signing failure · decided by builder · risk: low
- Decided: `create` does not reorder to "sign then write" the way `replace` does. It keeps
  `documents.create` first, then signs, and on a signing failure deletes the row it just wrote
  (best-effort, logged) before rethrowing.
- Why: unlike `replace`'s ownership check (a plain `get`, cheap to run before signing),
  `create`'s moduleId/liveClassId ownership check is embedded in `documents.create`'s write itself
  (a foreign-key-shaped check against another teacher's module or live class). Two existing tests
  depend on this: a foreign `moduleId` or `liveClassId` must be `not_found` with
  `storage.createUploadUrl` never called. Reordering to sign-first would either break those tests
  or require a new separate ownership-read repository method, which is outside Phase A's file list
  (`apps/worker/src/storage/roundtrip.ts`, `apps/web/src/storage/presign.ts`,
  `apps/web/src/studio/routes.ts`, `docker/env.example`) and risks the scope creep the plan's exit
  conditions warn against. The net effect for the accept line is the same either way: a signing
  failure leaves no visible `uploading` row.

## Gate

- `export PATH=$HOME/.nvm/versions/node/v22.22.3/bin:$PATH && corepack pnpm turbo run typecheck lint test --filter=...@edmate/worker --filter=@edmate/web...`
  → one unrelated failure: `@edmate/db test/discovery.int.test.ts > ... never falls back to a
  sequential scan of teacher_profiles` (a Postgres query-planner statistics flake on the shared
  dev database, not touched by this phase — packages/db is not in Phase A's file list). Re-ran
  that single test alone (`vitest run test/discovery.int.test.ts -t "never falls back"`): passed,
  confirming the flake. Every other package/test in the filtered run, including
  `@edmate/worker` and `@edmate/web`, passed.
- `corepack pnpm --filter @edmate/web exec vitest run --coverage` → 168 test files passed, 2684
  tests passed, no coverage-threshold error (statements 94.76%, branches 91.38%, functions
  91.77%, lines 96.08%).
- `corepack pnpm exec prettier --check` on the five code files changed (`apps/worker/src/storage/roundtrip.ts`,
  `apps/worker/src/storage/roundtrip.test.ts`, `apps/web/src/storage/presign.ts`,
  `apps/web/src/storage/presign.test.ts`, `apps/web/src/studio/routes.ts`,
  `apps/web/src/studio/routes.test.ts`) → all use Prettier style. (`docker/env.example` has no
  Prettier parser for this extension, same as before this change; skipped.)
- `python3 .githooks/secret-scan.py --all` → clean, no output.

### Phase B gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` → 34/34 tasks successful
  (31 cached).
- `corepack pnpm --filter @edmate/web exec vitest run app/teacher/uploads/UploadsView.test.tsx` →
  21/21 passed (run standalone; the full-suite coverage run from Phase A already covered this
  package, re-run once more below for Phase B's own changed file).
- `corepack pnpm exec prettier --check` on the two changed files → `UploadsView.test.tsx` needed
  `--write` once (new test's formatting), then checked clean; `UploadsView.tsx` was already clean.
- `python3 .githooks/secret-scan.py --all` → clean, no output.

### Phase C gate

- `corepack pnpm --filter @edmate/db exec tsc --noEmit -p .` → clean.
- `corepack pnpm --filter @edmate/db exec vitest run test/repositories.int.test.ts` → 192/192
  passed (against the shared dev Postgres; includes the new `modules.list` cross-teacher isolation
  case).
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/db --filter=@edmate/web...` →
  36/41 tasks ran (28 cached), 2 known flakes under machine load (both named in this task's brief):
  `@edmate/web`'s `src/auth/route-coverage.test.ts > /api/sessions/x/reports` timed out, and
  `@edmate/cli`'s `test/chatDbRetrieval.int.test.ts` hit a 10 s `beforeAll` hook timeout
  (`createDatabase`/`migrateDatabase` under load). Re-ran each file alone once:
  `vitest run src/auth/route-coverage.test.ts` → 45/45 passed; `vitest run
  test/chatDbRetrieval.int.test.ts` (filtered to `@edmate/cli`) → 1 passed, 1 skipped. Every other
  package/test in the filtered run passed first time.
- `corepack pnpm --filter @edmate/web exec vitest run --coverage` → no coverage-threshold error
  (statements 94.68%, branches 91.25%, functions 91.78%, lines 96.08%).
- `corepack pnpm exec prettier --check` on every Phase C file (`UploadsView.tsx`,
  `UploadsView.test.tsx`, `page.tsx`, `page.test.tsx`, `modules.ts`,
  `packages/db/src/repositories/index.ts`, `repositories.int.test.ts`) → all clean, no `--write`
  needed.
- `python3 .githooks/secret-scan.py --all` → clean, no output.

## Budget

Phase A tool calls used: 32
Phase B tool calls used: 19
Phase C tool calls used: 42
