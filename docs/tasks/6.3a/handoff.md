# Handoff: 6.3a

Status: DONE (Phase A — `packages/db` — and Phase B — `apps/web` — both done, by separate builders)

## Summary

Phase A, on Postgres (`packages/db/test/mistake-proposals.int.test.ts`, new, plus an update to
`packages/db/test/profile-store.int.test.ts`):
1. `record` stores a teacher's proposed tags (aggregated by tag: `count` sums, `lastSeen` takes
   the later value), scoped so another teacher's `listPending` never sees them.
2. `listPending` returns only `status: 'pending'` rows for the scope's own teacher; approved/
   rejected rows never reappear.
3. `approve(scope, tag)` on a pending proposal whose teacher already has a saved style card:
   creates a new style-card version whose `mistakeTags` is the old version's tags plus the newly
   approved one (deduped), marks the proposal `approved`, returns that card — before `approve` the
   tag is absent from every style-card version's `mistakeTags`; after, present only in the new
   version (style cards are immutable, 8.4a).
4. A race test: two concurrent `approve` calls for the same (teacher, tag) — one wins
   (`approved: true`, one new version), the other no-ops (`approved: false`).
5. `reject` marks a pending proposal `rejected`, never touches `style_cards`.
6. Cap tests: a `record` patch over `MISTAKE_PROPOSAL_PATCH_MAX` is `invalid` before any row is
   touched; a teacher already at `MISTAKE_PROPOSALS_MAX` stored rows gets `limit` on a `record` that
   would add a new tag, no partial write.
7. Scope tests: `approve`/`reject`/`listPending` for another teacher is `not_found`/`scope`; also
   covers `approve`/`reject` against an *existing* non-teacher user (`scope`, not `not_found`), and
   `approve` against a teacher with no style card yet (`not_found`), and `reject` on an
   already-decided proposal (`{rejected: false}`, a no-op) — added to reach 100% branch coverage on
   `src/repositories/**`.
8. `packages/db/src/repositories/ports.ts`'s `profileStoreFor.recordProposedMistakes` — previously a
   documented no-op (6.3d) — now calls `repos.mistakeProposals.record({ teacherId: bound.teacherId
   }, proposed)` for real, and returns early (no-op) on an empty `proposed` array.
   `profile-store.int.test.ts`'s existing case `'recordProposedMistakes is a documented no-op for
   the bound pair...'` is replaced with `'recordProposedMistakes persists a pending proposal the
   bound teacher's own listPending returns, and is a scope error for another'`, plus a new
   empty-array no-op case and (per the Lead's Q-6.3e answer) a case asserting that a non-empty
   `proposed` array passed alongside a non-empty `known` array to `applyMistakes` is never written
   to the learner profile (only `recordProposedMistakes` persists proposed tags).

Red → green: wrote `packages/db/test/mistake-proposals.test.ts` (no-DB unit tests: malformed scope,
over-cap patch, bad tag/count/lastSeen, empty-patch no-op, well-formed-but-unreachable-DB `failed`)
and `packages/db/test/mistake-proposals.int.test.ts` (11 Postgres cases above) before
`mistakeProposalsRepo` existed — both failed with "Cannot find module"/type errors, then passed
once the repo, schema, migration and `ports.ts` wire-up landed. `corepack pnpm --filter @edmate/db
db:generate` reported "No schema changes, nothing to migrate" after every subsequent test-only
edit, confirming the schema and migration were written once, correctly, up front.

One extra fix round after the first full-gate run: `packages/db/test/helpers.ts`'s
`DATA_MODEL_TABLES` list didn't include the new `mistake_tag_proposals` table, failing
`migrate.int.test.ts` and `schema.test.ts`'s exhaustiveness checks — added it. A second full-gate
run then failed coverage (`src/repositories/**` requires 100%, `mistake-proposals.ts` was at
92.95%/77.27%, `ports.ts` at 99.27%) — added the extra scope/not_found/no-op test cases listed in
point 7 above and the empty-array case for `recordProposedMistakes`, which closed every gap.

**State after Phase A, for Phase B's builder:**
- Migration `0042_mistake_tag_proposals.sql` (table `mistake_tag_proposals`: `id`, `teacher_id`,
  `tag`, `count`, `last_seen`, `status` (`pending`/`approved`/`rejected`, default `pending`),
  `decided_at`, timestamps; unique on `(teacher_id, tag)`; partial index on `(teacher_id, status)
  where status = 'pending'`).
- `repos.mistakeProposals` (from `createRepositories`, `packages/db/src/repositories/index.ts`),
  four methods:
  - `record(scope: TeacherScope, proposed: ProposedMistakeTagInput[]): Promise<void>` —
    `ProposedMistakeTagInput = { tag: string; count: number; lastSeen: string }`.
  - `listPending(scope: TeacherScope): Promise<MistakeProposalRow[]>` —
    `MistakeProposalRow = { tag: string; count: number; lastSeen: string; status: 'pending' |
    'approved' | 'rejected' }`.
  - `approve(scope: TeacherScope, tag: string): Promise<{ approved: boolean; card: StyleCard |
    null }>`.
  - `reject(scope: TeacherScope, tag: string): Promise<{ rejected: boolean }>`.
  - Exported constants: `MISTAKE_PROPOSAL_PATCH_MAX = 50`, `MISTAKE_PROPOSALS_MAX = 100`,
    `MISTAKE_PROPOSALS_LIST_MAX = 50` (all from `packages/db`'s public barrel, `src/index.ts`).
- `styleCardsRepo`'s `insertNextVersion(tx, teacherId, draft, method)` is now a separate named
  export in `style-cards.ts` (not on the public barrel), shared by `create` and
  `mistakeProposals.approve` so a new style-card version and the approved proposal's status commit
  atomically.
- No contracts change; `ProfileStore` port signatures are unchanged from ADR-0017/6.3d.

## Decisions

### 27 Oct 2026 · 6.3a recordProposedMistakes now calls mistakeProposalsRepo.record, teacher-scoped only · decided by builder · risk: low
- Decided: `profileStoreFor.recordProposedMistakes(scope, proposed)` persists via the new repo,
  scoped by `{ teacherId: bound.teacherId }` (no `studentId` column on `mistake_tag_proposals`).
- Why: matches "shown to its teacher only" (acceptance) and `classifyMistakeTags`'s own per-teacher
  `allowedTags` input; aggregating by student would need a column and index this feature doesn't
  need.

### 27 Oct 2026 · 6.3a approve shares style-cards.ts's version-insert logic via an extracted helper · decided by builder · risk: low
- Decided: extracted `insertNextVersion(tx, teacherId, draft, method)` from `styleCardsRepo.create`'s
  transaction body; both `create` and `mistakeProposalsRepo.approve` call it from inside their own
  `db.transaction`, so the proposal-row update and the new style-card version commit or roll back
  together.
- Why: reuses the existing versioning path exactly, keeps one atomic write, avoids nesting
  `db.transaction` calls (no precedent for that in this codebase).

### 27 Oct 2026 · 6.3a no contracts change · decided by builder · risk: low
- Decided: `ProposedMistakeTagInput`/`MistakeProposalRow` stay `packages/db`-internal.
- Why: the `ProfileStore` port ADR-0017 already froze the right method signatures; nothing new
  needed.

### 27 Oct 2026 · 6.3a new table, repository and a ports.ts write-path change in packages/db · decided by builder · risk: high
- Decided: shipped `mistake_tag_proposals`, `mistakeProposalsRepo`, the `style-cards.ts`
  extraction, and the `recordProposedMistakes` wire-up, logged `risk: high` per the merge gate's
  rule for any `packages/db/src/repositories/**` change, reviewed by security-reviewer (required)
  and code-reviewer/typescript-reviewer (default); database-reviewer recommended.
- Why: the risk-paths group requires `risk: high` for this path regardless of change size, same as
  6.3d's own precedent for the same file.

## Gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db` → green: 8/8 tasks successful,
  94 test files / 1899 tests passed (4 skipped, unrelated), coverage 100% on `src/repositories/**`
  and `src/schema/**` (the two thresholds this task's files sit under).
- `corepack pnpm turbo run typecheck --filter=...@edmate/db` → green: 12/12 tasks successful
  (`@edmate/cli`, `@edmate/worker`, `@edmate/web` and the rest of the dependency graph still
  typecheck).
- `corepack pnpm --filter @edmate/db db:generate` → "No schema changes, nothing to migrate" (no
  drift between `src/schema` and the migrations directory) on every run after the schema/migration
  were first generated.
- `corepack pnpm exec prettier --check <changed files>` → found formatting issues in 5 files;
  `prettier --write` fixed them; re-ran the full gate (`typecheck lint test --filter=@edmate/db`)
  afterward → still green.
- `python3 .githooks/secret-scan.py --all` → clean (no output).

## Budget

Tool calls used: ~55 (this session continued from an earlier session's context; this count covers
only the coverage fix-round, gate re-runs, prettier/secret-scan and this handoff — the schema/
repo/test authoring itself happened in the prior context window, within the plan's ~65-call budget
for Phase A).

## Phase B

Built on Phase A commit `262932a4` ("6.3a Phase A: proposed mistake tags the teacher approves
(packages/db)"), merged with `origin/main` into `50bc339e` before Phase B started. State used, per
the Phase A handoff above: `repos.mistakeProposals.{record,listPending,approve,reject}` (scopes
`TeacherScope`), `MistakeProposalRow = { tag, count, lastSeen, status }`, `approve` returns
`{ approved, card: StyleCard | null }`, `reject` returns `{ rejected }`; `RepositoryErrorKind`
includes `limit` (code `limit_reached`).

### Summary

- **`apps/web/src/studio/mistakeProposalRoutes.ts` (new):** `createMistakeProposalHandlers` —
  `list` (`GET`, the session teacher's own pending rows) and `decide` (`{tag, action}` →
  `approve`/`reject`). **Deviation from the plan's Q2 recommendation:** the decide endpoint is
  `POST`, not `PATCH` — `src/auth/policy.ts`'s `ROUTE_POLICY` row for `/api/studio/**` only lists
  `GET, POST, PUT, DELETE`, and `route-coverage.test.ts` fails any method with no matching policy
  row; `apps/web/src/auth/**` is out of bounds for this builder (Phase B's own "Files out of
  bounds"), so `POST` (already allowed) was used instead of extending the policy table. One `POST`
  endpoint still carries both decisions, matching the plan's reasoning otherwise. `fromRepositoryError`
  maps `scope → 403 forbidden`, `not_found → 404 not_found`, `invalid`/`integrity → 400 validation`,
  `limit → 409 limit_reached` (Q5, as recommended), `failed → 500 provider_error`.
- **`apps/web/app/api/studio/mistake-proposals/route.ts` (new):** `GET`/`POST`, both
  `withRole(['teacher'], ...)`.
- **`apps/web/src/studio/index.ts` (modified):** wires `mistakeProposalHandlers` from
  `createMistakeProposalHandlers({ repos: () => serverDatabase().repos }, realHooks.log)`.
- **`apps/web/src/studio/styleCardClient.ts` (modified):** added `listMistakeProposals()` and
  `decideMistakeProposal({tag, action})`, reusing the file's `call`/`ApiResult`/`asJson` helpers;
  exported `MistakeProposalRow`.
- **`apps/web/app/teacher/style-card/page.tsx` (modified):** also reads
  `mistakeProposals.listPending({ teacherId: principal.userId })`, passed to `StyleCardView` as
  `initialProposals`.
- **`apps/web/app/teacher/style-card/StyleCardView.tsx` (modified):** a "Proposed tags" section
  above the interview (list of tag/count with Approve/Reject buttons). Approve replaces `card`
  (and the editable `text`/`tagsText` fields) with the new version and drops the tag from the
  pending list; Reject just drops it, leaving the card unchanged. A failed call shows the existing
  error banner (`ERROR_KEYS` extended with `limit_reached`) with **no optimistic removal** — the
  proposal list is only filtered after the API call actually resolves `ok: true`.
- **`apps/web/messages/en.json` (modified):** `styleCard.proposedTags.*` (title, hint, none,
  countLabel, approveButton, rejectButton) and `styleCard.errors.limit_reached`.

### Red → green

`mistakeProposalRoutes.test.ts` written first (list/decide over an in-memory `mistakeProposals`
repo fake): failed with "Cannot find module './mistakeProposalRoutes'" before the route file
existed, passed once `mistakeProposalRoutes.ts` was written (one fix round inside this: the test's
first draft constructed `new RepositoryError(method, kind)`; the real constructor is
`(kind, method)` — fixed in the test, not the source). `styleCardClient.test.ts` extended with
`listMistakeProposals`/`decideMistakeProposal` cases — red (no such export) then green.
`page.test.tsx` extended to mock and assert `repos.mistakeProposals.listPending` — red (prop/mock
shape didn't exist) then green. `StyleCardView.test.tsx` extended with a `proposed tags` describe
block (no tags, approve removes + shows new card, reject removes without changing the card, a
failed decision shows the error banner with the tag still listed) — red (no such UI) then green.

### State after Phase A note used

No change needed to `packages/db`; Phase B called only the four `mistakeProposals` methods and
constants the Phase A handoff documented, with no further db edits.

## Decisions (Phase B)

### 27 Oct 2026 · 6.3a decide uses POST, not PATCH (Q2) · decided by builder · risk: low
- Decided: the single decide endpoint (`{tag, action: 'approve'|'reject'}`) is `POST
  /api/studio/mistake-proposals`, not `PATCH` as the plan's Q2 recommended.
- Why: `src/auth/policy.ts`'s `ROUTE_POLICY` row for `/api/studio/**` allows only
  `GET, POST, PUT, DELETE`; `route-coverage.test.ts` fails any exported HTTP method with no
  matching policy row (deny by default). Extending that row to add `PATCH` would touch
  `apps/web/src/auth/**`, which this task's own "Files out of bounds" list reserves ("reuse
  requireRole/withRole as-is") and which this builder's brief also forbids touching. `POST` is
  already allowed for teachers on this path and carries the same body shape, so no behaviour is
  lost.

### 27 Oct 2026 · 6.3a no optimistic removal on decide (plan's own line, confirmed in the test) · decided by builder · risk: low
- Decided: `StyleCardView`'s proposed-tags list only drops a tag after `decideMistakeProposal`
  resolves `ok: true`; a failed call leaves the tag listed and shows the existing error banner.
- Why: matches the plan's acceptance line for Phase B ("approving one removes it from the pending
  list client-side ... rejecting removes it without changing the card") read together with the
  existing `onSave`/`onDraft` pattern in the same file, which never assumes success before the
  response is in.

## Gate (Phase B)

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web` → green: 10/10 tasks
  successful (one fix round: an unused `MistakeProposalBackend` type import in the new test file
  tripped `@typescript-eslint/no-unused-vars`; removed it, re-ran, green).
- `corepack pnpm exec prettier --check` on the changed Phase B files → 4 files needed `--write`
  (new/extended test and view files); re-checked clean afterward.
- `python3 .githooks/secret-scan.py --all` → clean (no output).

## Budget (Phase B)

Tool calls used: 47.

## Fix round 1

**Finding (typescript-reviewer, HIGH):** `StyleCardView.tsx`'s `decidingTag` was one shared
`string | null`. Clicking Approve/Reject on proposal A disabled A's buttons; starting a decision
on proposal B before A resolved overwrote `decidingTag` to B, re-enabling A's buttons while A's
own `decide` call was still in flight — a second click on A could fire a duplicate decide call.

**Change:** replaced `decidingTag: string | null` with `decidingTags: ReadonlySet<string>`,
added via a functional update before each `decide` call and removed (also functionally) in the
`finally` block; each row's Approve/Reject buttons now disable on `decidingTags.has(p.tag)`
instead of `decidingTag === p.tag`.

**Test:** added `'keeps a different tag disabled while its own decision is still in flight'` to
`StyleCardView.test.tsx` — two proposals (`units`, `spelling`); starts A's decide with an
unresolved promise, confirms A's button is disabled, starts B's decide with its own unresolved
promise, then asserts A's button is *still* disabled (red before the fix: A's button came back
enabled once B's `decidingTag` write landed); resolves both and confirms the list empties. Watched
it fail against the pre-fix code, then pass after the fix.

Gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/web` → green, 10/10 tasks.
`corepack pnpm exec prettier --check` on `StyleCardView.tsx`/`StyleCardView.test.tsx` → clean.
`python3 .githooks/secret-scan.py --all` → clean.

Tool calls used: 12.
