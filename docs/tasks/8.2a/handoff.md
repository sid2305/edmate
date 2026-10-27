# Handoff: 8.2a

Status: PARTIAL (Phase A done; Phases B and C left)

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

## Decisions

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

## Budget

Phase A tool calls used: 32
