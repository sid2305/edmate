# 13.3b plan — 13.3 review LOWs (chunks scope hygiene, session-id param schema, maxAge question)

## Acceptance (verbatim, from `board.py show 13.3b`)
> per docs/tasks/13.3/review.md deferred 13.3b findings; db and web typecheck, lint and test green.

Shown by: all three deferred findings in `docs/tasks/13.3/review.md` resolved (fixed or, for the
maxAge item, written up as an open question — the review already scopes it that way), plus green
`typecheck`, `lint`, `test` for `@edmate/db` and `@edmate/web`.

## Source findings (docs/tasks/13.3/review.md, 13.3b-deferred lines only)
- `[LOW] [deferred 13.3b] packages/db/src/repositories/chunks.ts — insertTopicLinks and
  topicSources take a raw teacherId outside the scope.test.ts grid.`
- `[LOW] [deferred 13.3b] apps/web/src/turn/routes.ts — the session id param reuses
  StartSessionSchema.shape.agentId; use a dedicated SessionIdSchema.`
- `[LOW] [deferred 13.3b] apps/web/src/auth/config.ts — the 30-day database session maxAge;
  revisit before a wider launch.`
(Full detail on item 1: `docs/tasks/13.3/findings-A.md` lines 8, quoted above in the review line.)

## Files to create/modify
1. `packages/db/src/repositories/chunks.ts`
   - `insertTopicLinks(tx, teacherId: string, links)` → `insertTopicLinks(tx, scope: TeacherScope, links)`.
     First line of the body calls `const { teacherId } = teacherScope(scope, 'chunks.insertTopicLinks');`
     — **before** the existing `if (links.length === 0) return 0;` early return, so an empty-links
     call with a bad scope still throws `scope`, not a silent `0`.
   - `topicSources(db, teacherId: string, topicIds)` → `topicSources(db, scope: TeacherScope, topicIds)`.
     Same pattern: `teacherScope(scope, 'chunks.topicSources')` runs before the
     `if (topicIds.length === 0) return [];` early return.
   - `teacherScope` and `TeacherScope` are already imported in this file (line 26) — no new import.
   - This matches the sibling convention already in this same file (every `documentsRepo`/`chunksRepo`
     method calls `teacherScope(scope, method)` first); it does not add these two functions to the
     `xxxRepo(db)` factory objects (they stay module-level helpers used by `outline.ts`, per the
     8.3a decision recorded in `docs/decisions/log.md` and `packages/db/src/repositories/README.md:271`).

2. `packages/db/src/repositories/outline.ts`
   - Update the two call sites to pass a scope object instead of the bare `teacherId` string:
     - Line ~185 `topicSources(db, teacherId, tops.map(...))` → `topicSources(db, { teacherId }, tops.map(...))`
     - Line ~331 `insertTopicLinks(tx, teacherId, links)` → `insertTopicLinks(tx, { teacherId }, links)`
   - No other changes to this file.

3. `packages/db/test/scope.test.ts`
   - These two functions cannot join the `allMethods()` auto-discovery loop: they are not on the
     `createRepositories(db)` return object and their first argument is a `tx`/`db` handle, not the
     scope. Mirror the existing explicit-test pattern already in this file for the same reason
     (`transcriptStoreFor rejects a bad scope at construction`, `usageMeterFor rejects a bad scope at
     construction`, around lines 260–280): add two new `it()` blocks, in the same
     `describe('every repository method rejects a bad scope before any SQL', ...)` block, that:
     - import `insertTopicLinks` and `topicSources` directly from `'../src/repositories/chunks.js'`
       (an internal path within the same package — the same way this test file already reads
       repository source files directly; these two functions are not re-exported from the package
       root, by design, so this import path is the correct one, not a layering violation);
     - call each with every entry in `BAD_SCOPES` as the scope argument, a throwaway first arg
       (`undefined as never` for `tx`/`db` — the scope check must throw before either function
       touches its `tx`/`db` argument, so this is safe) and an empty links/topicIds array, and
       assert `RepositoryError` with `kind === 'scope'` and the fixed method name
       (`'chunks.insertTopicLinks'` / `'chunks.topicSources'`).

4. `apps/web/src/turn/routes.ts`
   - Add `import { TurnInputSchema } from '@edmate/contracts';` (already a workspace dependency of
     `apps/web`; `TurnInputSchema` is already imported elsewhere in this package, e.g.
     `apps/web/src/turn/clientInput.ts`, so this is not a new coupling).
   - Add `const SessionIdSchema = TurnInputSchema.shape.sessionId;` with a one-line comment: this is
     the session id's own field from the contracts turn schema, not borrowed from `agentId`'s.
   - Change `const ParamsSchema = z.object({ id: StartSessionSchema.shape.agentId });` to
     `const ParamsSchema = z.object({ id: SessionIdSchema });`.
   - No change to `StartSessionSchema` itself or to `clientInput.ts`: `sessionId` and `agentId` are
     both built from the same contracts `id()` format (verified: `packages/contracts/src/turn.ts`
     `agentId: id(), sessionId: id()`), so this is a clarity/correctness fix with **no behaviour
     change** — existing tests in `apps/web/src/turn/routes.test.ts` must keep passing unchanged.
   - Do not touch `packages/contracts` — the needed schema already exists there; this is exactly
     the "prefer a local schema" / "check whether one already exists outside packages/contracts"
     case, and it does.

5. `docs/tasks/13.3b/handoff.md` (written by the builder, not this plan) must carry the open
   question below under `## Decisions` or a clearly marked `## Open questions` section.

## Files out of bounds (do not touch — other builders own these right now)
- `packages/db/src/repositories/reports.ts`
- Any `eval-runs` repository or migration files
- Any new migration files
- `apps/web/src/studio/publish.ts`
- `apps/web/app/api/staff/**`
- `apps/web/src/auth/config.ts` — read it to confirm the 30-day `maxAge` value for the open question
  below, but do **not** change it.

## Open question (for the human, not decided by this task)
- `apps/web/src/auth/config.ts`'s database session `maxAge` is 30 days. Recommendation: shorten it
  (e.g. 7 days, matching the 7-day refund window already in product policy) before a wider launch,
  since a stolen or shared session cookie stays valid for a long time; but this is a product/security
  trade-off (session friction vs. exposure window) the spec did not make, so it is logged as an open
  question, not changed in this task.

## Tests first (red, then green)
- `packages/db/test/scope.test.ts`: write the two new `it()` blocks (step 3) first — they fail red
  against the current `chunks.ts` (the functions throw nothing on a bad scope, or throw a
  connection/type error instead of `RepositoryError('scope', ...)`). Then make them pass by applying
  step 1 and 2.
- Existing `packages/db/test/scope.test.ts` suite (the full file) and `outline.ts`'s own tests must
  stay green after the signature change — run the whole `@edmate/db` test suite, not just the new
  cases.
- `apps/web/src/turn/routes.test.ts`: no new test is required to prove the fix (the behaviour is
  identical by construction — same underlying `id()` format), but re-run the full file to confirm
  no regression after swapping `ParamsSchema`'s source schema. If the builder wants a positive
  assertion, add one `it()` that `ParamsSchema.safeParse({ id: 'ses_1a' })` still succeeds and a
  129-char id still fails — this only needs to be green, since the schema shape has not changed.

## Gate commands
Postgres (55432) and Redis (56379) are already running; the builder never runs `docker compose` or
any docker command.

```bash
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/db...
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/web...
python3 .claude/skills/merge-gate/merge_gate.py 13.3b
python3 .githooks/secret-scan.py --all
```

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `packages/db/src/repositories/chunks.ts` and `packages/db/src/repositories/outline.ts` match
  `packages/db/src/repositories/**` (access/money/identity group) → reviewers: `security-reviewer`
  (plus `code-reviewer` and `typescript-reviewer`, always required).
- `packages/db/test/scope.test.ts` is under `packages/db/test/`, not `packages/db/src/repositories/**`
  — not itself a risky-path glob match, but reviewed in the same PR as the risky file above.
- `apps/web/src/turn/routes.ts` is under `apps/web/src/turn/**`, which is **not** listed in
  `risk-paths.txt` (only `apps/web/src/auth/**`, `apps/web/app/api/auth/**`,
  `apps/web/app/api/staff/**`, `apps/web/app/staff/**` etc. are). No extra reviewer is triggered by
  this file alone.
- `apps/web/src/auth/config.ts` is under `apps/web/src/auth/**` (access/money/identity group,
  `security-reviewer`) — but this task does not change it (open question only), so it adds no
  reviewer requirement.
- Net required reviewers for this PR: `code-reviewer`, `typescript-reviewer`, `security-reviewer`.
  This is a risky PR; the handoff must log a `risk: high` decision (build plan rule 6, the
  `packages/db/src/repositories/**` group).

## Budget
Budget: 45 tool calls (1 phase, packages/db + apps/web)

## Allowed tools
Read, Grep, Glob, Edit, Bash (tests, lint, typecheck, secret scan only — no docker)

## Exit conditions
- `Status: DONE` once: both new `scope.test.ts` cases are green, `chunks.ts`/`outline.ts` changed as
  above, `routes.ts`'s `ParamsSchema` uses `SessionIdSchema`, the open question on `config.ts`'s
  `maxAge` is written up (file untouched), and both gate commands above are green.
- `Status: PARTIAL` if past ~45 tool calls, or if a change outside the five files/sections above
  turns out to be required (for example if `outline.ts` has more call sites than the two found at
  plan time, or if `apps/web/src/turn/routes.test.ts` needs a change beyond adding one assertion) —
  stop and report what else was found instead of expanding scope.

## Decisions (none made by this plan; left for the builder/lead at merge)
None — both changes are mechanical fixes already specified by the 13.3 review findings; the only
open item is the `config.ts` `maxAge` question above, which is explicitly left to the human.

## Lead answers (27 Oct 2026)
- The maxAge question goes to the human as B-60; the builder does not touch apps/web/src/auth/config.ts and lists it under `## Open questions` in the handoff.
- Ignore the plan's "7-day refund window" aside; it is not a product fact this task relies on.
- The builder starts from main after 12.2f merges (12.2f also edits chunks.ts); merge main first if the branch is behind.
