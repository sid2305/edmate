# Task 6.3a — Proposed mistake tags the teacher approves

Board: milestone M13 · deps `6.3` (done), `6.3c` (done) · also needs `6.3d` (done) and, for a clean
`ports.ts` diff, `6.3e` (running — see Sequencing) merged first · branch `m13/6.3a-mistake-proposals`
· **risky** (`packages/db/src/repositories/**`, Phase A only) · two phases, one builder each.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Proposed mistake tags the teacher approves (deferred from 6.3, MVP first): persist the
classifier's proposed tags per teacher and add a teacher approve/reject action that adds an
approved tag to the style card's `mistakeTags` (new style card version)"
Accept: "a proposed tag is stored, shown to its teacher only, and becomes taggable only after
approval."

### How it is shown (paste into handoff.md)

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
7. Scope tests: `approve`/`reject`/`listPending` for another teacher is `not_found`/`scope`.
8. **New vs. the earlier version of this plan:** `packages/db/src/repositories/ports.ts`'s
   `profileStoreFor.recordProposedMistakes` — currently a documented no-op (6.3d) — now calls
   `repos.mistakeProposals.record(...)` for real. `profile-store.int.test.ts`'s existing case
   `'recordProposedMistakes is a documented no-op for the bound pair...'` (lines ~704–720) is
   replaced: the bound-pair call now persists a pending row the teacher's own `listPending` returns;
   the other-teacher call is still `scope`, and still writes nothing.
All gate on `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`.

Phase B, no database (`apps/web/src/studio/mistakeProposalRoutes.test.ts`,
`StyleCardView.test.tsx` extended): a teacher's GET of the proposals list returns only their own
pending tags; approving one removes it from the pending list client-side and shows the card's new
`mistakeTags`; rejecting removes it without changing the card. All gate on
`corepack pnpm turbo run typecheck lint test --filter=@edmate/web...`.

## State of the world (read on main, 27 Oct 2026 — corrects the earlier version of this plan)

- **Dropped from the earlier plan — already built by 6.3c/6.3d:** the `ProfileStore` port extension
  (`applyMistakes?`/`recordProposedMistakes?`, ADR-0017, `packages/contracts/src/ports.ts:96-120`)
  and the harness producer (`classifyMistakeTags` wired into `runner.ts`/`commit.ts` on a wrong
  practice answer) are merged. **No contracts change needed here** — the port signatures this task
  needs already exist exactly as ADR-0017 specified.
- `packages/db/src/repositories/ports.ts`'s `profileStoreFor` (6.3d) already implements
  `applyMistakes` for real (resolves the style card's `mistakeTags` allow-list via
  `sessions.get` → `agentVersions.get` → `styleCards.get`, throws `integrity` on a broken chain,
  calls `repos.learnerProfiles.applyMistakes`). `recordProposedMistakes` (lines 161–164) is still
  exactly the documented no-op 6.3d left it as:
  ```ts
  async recordProposedMistakes(mistakeScope) {
    const method = 'profileStoreFor.recordProposedMistakes';
    checkPair(mistakeScope.studentId, mistakeScope.teacherId, method);
  },
  ```
  **This task's job, not previously planned:** make it call the new `mistakeProposalsRepo.record`
  with a teacher-only scope (the table has no `studentId` column — proposals aggregate per teacher
  across all their students, matching "shown to its teacher only" and `classifyMistakeTags`'s own
  per-teacher `allowedTags` input). Update the doc comment (lines ~108–109, "stays a documented
  no-op until 6.3a lands...") to say it now does.
- **Sequencing with 6.3e (running now, branch `m13/6.3e-proposed-param`):** 6.3e renames
  `applyMistakes`'s unused third parameter to `_proposed` in this same file
  (`packages/db/src/repositories/ports.ts`) and adds one profile-store int test case. **Do not plan
  around that line** — the brief's instruction. This task's own edits are to a different method
  (`recordProposedMistakes`, a few lines below) and a different test case, so the two diffs should
  not textually collide, but they are the same file: **this task's builder should start from `main`
  only after 6.3e has merged** (pull latest before Phase A starts), rather than racing it. Flag as
  Open question Q0.
- Style-card versioning (`packages/db/src/repositories/style-cards.ts`, current main, 125 lines):
  unchanged since the earlier plan — `styleCardsRepo.create` is the only write path for a new
  version (role lock, per-teacher advisory lock `VERSION_LOCK_NAMESPACE = 8401`, `max(version)+1`,
  insert, `checked` return). The extraction design below is unchanged.
- `StyleCardSchema.mistakeTags: z.array(z.string())` (`@edmate/contracts`) unchanged — no contracts
  change to add one more string to it.
- Teacher studio style-card surface (`apps/web/src/studio/styleCardRoutes.ts`,
  `apps/web/src/studio/styleCardClient.ts`, `apps/web/app/teacher/style-card/{page.tsx,
  StyleCardView.tsx,page.test.tsx,StyleCardView.test.tsx}`) — confirmed present, unchanged shape.
  `GET/PUT /api/studio/style-card` and `StyleCardView` already exist; this task adds a sibling
  read/write surface alongside them.
- `apps/web/src/studio/**` and `apps/web/app/api/studio/**` are confirmed still **not** on
  `.claude/skills/merge-gate/risk-paths.txt` (only `apps/web/src/auth/**`, `app/api/auth/**`,
  `app/api/staff/**`, `app/staff/**`, `app/api/webhooks/**` are, under security-reviewer).
- Next free migration number is **`0042`** (`packages/db/migrations/0041_documents_list_index_...`
  is the latest on main; confirm again just before generating, another task may land first).

## Design

### Phase A — `packages/db`: a new table, a new repo, a small `style-cards.ts` refactor, and the `ports.ts` wire-up

**New table** `mistake_tag_proposals` (`packages/db/src/schema/content.ts`, after `styleCards` at
line 247):
```ts
export const mistakeTagProposals = pgTable(
  'mistake_tag_proposals',
  {
    id: id(),
    teacherId: teacherId(),
    tag: text('tag').notNull(),
    count: integer('count').notNull(),
    lastSeen: tstz('last_seen').notNull(),
    status: text('status').notNull().default('pending'),
    decidedAt: tstz('decided_at'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('mistake_tag_proposals_teacher_id_tag_key').on(t.teacherId, t.tag),
    index('mistake_tag_proposals_teacher_id_status_idx')
      .on(t.teacherId, t.status)
      .where(sql`${t.status} = 'pending'`),
    check(
      'mistake_tag_proposals_status_check',
      sql`${t.status} in ('pending', 'approved', 'rejected')`,
    ),
  ],
);
```
`check`/`uniqueIndex`/`index`/`id`/`teacherId`/`timestamps`/`tstz`/`sql` are already imported in
`content.ts` (confirmed: `check` and `tstz` are imported from `./_shared.js` — add `check` to that
import line if not already there; `uniqueIndex`/`index`/`integer`/`text` are already imported from
`drizzle-orm/pg-core`). Export `mistakeTagProposals` from `packages/db/src/schema/index.ts` next to
`styleCards`.

**Migration:** run `corepack pnpm --filter @edmate/db db:generate` after the schema edit. Confirm
the next free number by re-listing `packages/db/migrations/*.sql` right before generating (expect
`0042`, but another task may have landed `0042` first — use whatever is actually free). Review the
generated SQL: a new table only, no `ALTER`, no backfill, no `CONCURRENTLY` needed.

**`packages/db/src/repositories/style-cards.ts` (modify) — extract `insertNextVersion`.** Pull the
advisory-lock-and-insert body of `create` (after the role check, inside its `db.transaction`) into:
```ts
export async function insertNextVersion(
  tx: Db,
  teacherId: string,
  draft: { text: string; mistakeTags: string[] },
  method: string,
): Promise<StyleCard> { /* the existing advisory-lock + max(version)+1 + insert + checked body */ }
```
`create` becomes: role check, then `return insertNextVersion(tx, teacherId, d, method);` — pure
extraction, no behaviour change; `style-cards.int.test.ts`'s existing tests must pass unmodified.
`insertNextVersion` is a named export, not re-exported from `repositories/index.ts`'s public barrel
(same "internal to the package" status `applyMastery`/`rebuildMastery` have).

**`packages/db/src/repositories/mistake-proposals.ts` (new).** Unchanged from the earlier version
of this plan:
```ts
export const MISTAKE_PROPOSAL_PATCH_MAX = 50;
export const MISTAKE_PROPOSALS_MAX = 100;
export const MISTAKE_PROPOSALS_LIST_MAX = 50;

export interface ProposedMistakeTagInput { tag: string; count: number; lastSeen: string }
export interface MistakeProposalRow {
  tag: string; count: number; lastSeen: string; status: 'pending' | 'approved' | 'rejected';
}

export function mistakeProposalsRepo(db: Db) {
  return {
    async record(scope: TeacherScope, proposed: ProposedMistakeTagInput[]): Promise<void> { ... },
    async listPending(scope: TeacherScope): Promise<MistakeProposalRow[]> { ... },
    async approve(scope: TeacherScope, tag: string): Promise<{ approved: boolean; card: StyleCard | null }> { ... },
    async reject(scope: TeacherScope, tag: string): Promise<{ rejected: boolean }> { ... },
  };
}
```
- `record`: upserts `proposed` by (teacher, tag) — new tag inserts `pending`; existing `pending` row
  merges count (sum) / lastSeen (later wins); existing `approved`/`rejected` row untouched. `invalid`
  if `proposed.length > MISTAKE_PROPOSAL_PATCH_MAX`; `limit` (no partial write) if it would push the
  teacher's stored row count past `MISTAKE_PROPOSALS_MAX`. Empty `proposed` is a no-op.
- `listPending`: the scope's teacher's own pending rows only, newest `lastSeen` first, capped at
  `MISTAKE_PROPOSALS_LIST_MAX`.
- `approve`: locks the teacher's role and the proposal row (`FOR UPDATE`), re-checks `pending` (else
  `{approved: false, card: null}` no-op), reads the teacher's current latest style card (`not_found`
  if none), calls `insertNextVersion` with that card's `mistakeTags` plus the newly approved tag
  (deduped) **inside the same transaction**, marks the proposal `approved`/`decided_at`, returns the
  new card.
- `reject`: locks role + proposal row, `pending` → `rejected`; already-decided is `{rejected: false}`
  no-op. Never touches `style_cards`.
- `tag` arguments validated with `z.string().trim().min(1).max(STYLE_CARD_LIMITS.tagMaxChars)`
  (imported from `style-cards.ts`, already exported).

**`packages/db/src/repositories/index.ts` (modify):** import `mistakeProposalsRepo`; add
`mistakeProposals: guardAll('mistakeProposals', mistakeProposalsRepo(db))` to `createRepositories`
(next to the other `guardAll(...)` lines, e.g. after `regulatedSubjects` at line 89); export
`MISTAKE_PROPOSAL_PATCH_MAX, MISTAKE_PROPOSALS_MAX, MISTAKE_PROPOSALS_LIST_MAX, type
ProposedMistakeTagInput, type MistakeProposalRow` next to the `STYLE_CARD_LIMITS` export line
(currently line 107).

**`packages/db/src/repositories/ports.ts` (modify — new vs. the earlier plan).**
`profileStoreFor.recordProposedMistakes` (lines 161–164) becomes:
```ts
async recordProposedMistakes(mistakeScope, proposed) {
  const method = 'profileStoreFor.recordProposedMistakes';
  checkPair(mistakeScope.studentId, mistakeScope.teacherId, method);
  if (proposed.length === 0) return;
  await repos.mistakeProposals.record({ teacherId: bound.teacherId }, proposed);
},
```
Update the function's doc comment (lines ~93–109): drop "`recordProposedMistakes` stays a
documented no-op until 6.3a lands the real persistence of proposed tags for teacher review" and
replace with a line naming that it now calls `mistakeProposalsRepo.record`, scoped to the teacher
only (no `studentId` on the table — proposals aggregate per teacher across students, matching
`classifyMistakeTags`'s own per-teacher `allowedTags` input and the acceptance line "shown to its
teacher only"). **Do not touch `applyMistakes`'s parameter list** (6.3e's line, a few lines above).

**`packages/db/test/profile-store.int.test.ts` (modify):** replace the existing case
`'recordProposedMistakes is a documented no-op for the bound pair, and a scope error for another'`
(lines ~704–720) with two assertions: (a) the bound-pair call now persists — follow it with
`repos.mistakeProposals.listPending({ teacherId: scope.teacherId })` and assert the tag is there,
`status: 'pending'`; (b) the other-teacher call is still `scope`, and `listPending` for the real
teacher shows nothing added by it.

### No contracts change

`git diff origin/main -- packages/contracts` must stay empty — the port signatures already exist
(ADR-0017, merged by 6.3c). `ProposedMistakeTagInput`/`MistakeProposalRow` are
`packages/db`-internal types, same precedent `EvidenceEventEntry` set.

### Phase B — `apps/web`: list + approve/reject on the studio's style-card page

Unchanged from the earlier version of this plan (files confirmed present on main, same shape):

- **`apps/web/src/studio/mistakeProposalRoutes.ts` (new)** — `GET /api/studio/mistake-proposals`
  (scope's own pending rows), `PATCH /api/studio/mistake-proposals` with body
  `{ tag: string; action: 'approve' | 'reject' }` → `{ approved, card } | { rejected }`. One `PATCH`
  endpoint for both decisions (Open question Q2). Backend interface:
  ```ts
  export interface MistakeProposalBackend {
    repos(): Pick<Repositories, 'mistakeProposals'>;
  }
  ```
  Errors map through the same `fromRepositoryError`-shaped switch `styleCardRoutes.ts` already has,
  plus a `limit` case (Open question Q5).
- **`apps/web/app/api/studio/mistake-proposals/route.ts` (new):** `export const GET =
  withRole(['teacher'], mistakeProposalHandlers.list);` / `PATCH = withRole(['teacher'],
  mistakeProposalHandlers.decide);`.
- **`apps/web/src/studio/index.ts` (modify):** wire `mistakeProposalHandlers` from
  `createMistakeProposalHandlers({ repos: () => serverDatabase().repos }, realHooks.log)`.
- **`apps/web/src/studio/styleCardClient.ts` (modify):** add `listMistakeProposals()` and
  `decideMistakeProposal(input)`, reusing the file's existing `call`/`ApiResult`/`asJson` helpers.
- **`apps/web/app/teacher/style-card/page.tsx` (modify):** also read
  `mistakeProposals.listPending({ teacherId: principal.userId })`, pass as `initialProposals`.
- **`apps/web/app/teacher/style-card/StyleCardView.tsx` (modify):** a "Proposed tags" section
  (`messages/en.json`'s `styleCard.proposedTags.*`, English-only pilot); Approve replaces `card` with
  the new version and drops the tag; Reject just drops it; errors reuse `ERROR_KEYS`, extended only
  for `limit`.

## Files

### Phase A
- **Modify:** `packages/db/src/schema/content.ts` — `mistakeTagProposals` table (after line 247).
- **Modify:** `packages/db/src/schema/index.ts` — export it.
- **Create:** `packages/db/migrations/00NN_mistake_tag_proposals.sql` (generated, reviewed; confirm
  NN at build time).
- **Modify:** `packages/db/src/repositories/style-cards.ts` — extract `insertNextVersion`.
- **Create:** `packages/db/src/repositories/mistake-proposals.ts` — the new repo.
- **Modify:** `packages/db/src/repositories/index.ts` — wire the repo, export its constants/types.
- **Modify:** `packages/db/src/repositories/ports.ts` — `recordProposedMistakes` calls
  `mistakeProposalsRepo.record` for real; doc comment updated. **Do not touch `applyMistakes`'s
  parameter list** (6.3e's line).
- **Create:** `packages/db/test/mistake-proposals.test.ts` — pre-SQL validation (no DB).
- **Create:** `packages/db/test/mistake-proposals.int.test.ts` — the "How it is shown" cases 1–7.
- **Modify:** `packages/db/test/profile-store.int.test.ts` — replace the no-op
  `recordProposedMistakes` case (lines ~704–720) with the real-persistence case (item 8 above).
- **Modify:** `packages/db/test/style-cards.int.test.ts` — confirm unmodified/still green.
- **Modify:** `packages/db/test/repositories.int.test.ts` — four isolation-grid entries
  (`mistakeProposals.{record,listPending,approve,reject}`).
- **Modify:** `packages/db/test/isolation-seed.ts` — seed one pending proposal row per teacher.
- **Modify:** `docs/tasks/6.3a/handoff.md` (end of Phase A, by the builder).

### Phase B
- **Create:** `apps/web/src/studio/mistakeProposalRoutes.ts`, `mistakeProposalRoutes.test.ts`.
- **Create:** `apps/web/app/api/studio/mistake-proposals/route.ts`.
- **Modify:** `apps/web/src/studio/index.ts`, `styleCardClient.ts` (+ its test file, if any).
- **Modify:** `apps/web/app/teacher/style-card/page.tsx`, `page.test.tsx`.
- **Modify:** `apps/web/app/teacher/style-card/StyleCardView.tsx`, `StyleCardView.test.tsx`.
- **Modify:** `apps/web/messages/en.json` — `styleCard.proposedTags.*` strings.
- **Modify:** `docs/tasks/6.3a/handoff.md` (end of Phase B, appended).

## Files out of bounds

- `packages/contracts/**`, `docs/adr/**` — no contracts change; ADR-0017 already covers this port.
- `packages/harness/**` — 6.3c already wired the producer (`classifyMistakeTags` → `commit.ts`).
- `apps/web/src/chat/**`, `apps/web/src/turn/**`, `apps/web/app/api/sessions/**` — untouched.
- `apps/web/src/auth/**`, `packages/db/src/identity/**` — reuse `requireRole`/`withRole` as-is.
- `packages/db/src/repositories/{chunks,takedowns,reports,learner}.ts` — untouched; `learner.ts`'s
  own `applyMistakes` (6.3b) is called by `ports.ts`, not modified here.
- `packages/db/src/repositories/ports.ts`'s `applyMistakes` parameter list — 6.3e's line, see above.
- `content/**`, `packages/content/**` — no content change.

## Tests first

### Phase A
1. `packages/db/test/mistake-proposals.test.ts` (no DB): scope checks for all four methods;
   `record` over `MISTAKE_PROPOSAL_PATCH_MAX` → `invalid`; `approve`/`reject` empty/overlong tag →
   `invalid`.
2. `packages/db/test/mistake-proposals.int.test.ts` — on Postgres, each "How it is shown" case 1–7
   as its own `it(...)`.
3. `packages/db/test/profile-store.int.test.ts` — the updated `recordProposedMistakes` case (item 8)
   red until `ports.ts`'s wire-up lands.
4. `packages/db/test/style-cards.int.test.ts` — unchanged, green, confirming the extraction.
5. `packages/db/test/repositories.int.test.ts` — four new isolation-grid entries pass.
- **Gate:** `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` (Postgres up via
  `docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres`).

### Phase B
1. `apps/web/src/studio/mistakeProposalRoutes.test.ts` — in-memory `mistakeProposals` repo; `GET`
   scoped; `PATCH approve/reject` call the right repo method; malformed body is `validation`/400
   before the repo is touched; `RepositoryError` maps through the same fixed-status switch plus
   `limit`.
2. `apps/web/app/teacher/style-card/page.test.tsx` — reads `mistakeProposals.listPending` with the
   signed-in teacher's scope, passes as `initialProposals`.
3. `apps/web/app/teacher/style-card/StyleCardView.test.tsx` — renders proposed tags; Approve/Reject
   flows; a failed call shows the existing error banner, no optimistic removal.
- **Gate:** `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...`.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- **Phase A:** `packages/db/src/repositories/**` (`mistake-proposals.ts` new; `style-cards.ts`,
  `index.ts`, **`ports.ts`** modified) matches risk-paths.txt's `packages/db/src/repositories/**`
  line (lines 29–41, "...keeping each teacher's and student's data apart"), group
  **reviewers: security-reviewer** (required). Default code-reviewer/typescript-reviewer apply to
  every PR. Recommend also **database-reviewer** (new table, cross-table transaction in `approve`,
  and the `ports.ts` write-path change) — not strictly required by risk-paths.txt (this migration
  only creates a table) but matches 6.3d's own precedent for the sibling file. `packages/db/src/
  schema/**` and `packages/db/migrations/**` travel with this requirement since the same PR touches
  both.
- **Phase B:** `apps/web/src/studio/**` and `apps/web/app/api/studio/**` confirmed **not** on
  risk-paths.txt. Default code-reviewer/typescript-reviewer only.
- No `packages/contracts/**`, `docs/adr/**`, `.claude/**` touched in either phase.
- Per CLAUDE.md rule 6, Phase A's handoff must log a `risk: high` decision for the
  repositories-layer touch; Phase B does not need one.

## Open questions (each with a recommendation)

- **Q0 (new). Should Phase A's builder wait for 6.3e to merge before starting, given both touch
  `packages/db/src/repositories/ports.ts`?** Recommend: yes — pull `main` fresh immediately before
  starting Phase A; if 6.3e is still unmerged when the builder is ready, it should rebase/merge
  `main` once 6.3e lands rather than editing against a stale copy, to avoid a conflict on an
  adjacent line in the same file. Low-stakes either way (different methods), but cheap to avoid.
- **Q1. Does this task wire a real caller of `classifyMistakeTags`/`applyMistakes` so
  `record`/`approve` run from a live turn?** Already answered by 6.3c/6.3d: yes for `applyMistakes`
  (6.3d's real adapter); this task makes `recordProposedMistakes` real too, so a live wrong-practice-
  answer turn with an out-of-list tag now lands a pending proposal row. No further wiring needed.
- **Q2. One `PATCH` endpoint for approve/reject, or two dynamic-segment routes?** Recommend: one
  `PATCH` with `{tag, action}` in the body — avoids URL-encoding a teacher-typed tag string in a path
  segment.
- **Q3. Should a later `record` of a tag the teacher already `rejected` revive it to `pending`?**
  Recommend: stay `rejected` — a dismissed tag shouldn't resurface every time a future turn
  re-proposes it; a "re-propose after N occurrences" policy is a follow-up, not this task.
- **Q4. Exact cap values (`MISTAKE_PROPOSAL_PATCH_MAX=50`, `MISTAKE_PROPOSALS_MAX=100`)?**
  Recommend: ship these — same order of magnitude as 6.3b's own caps; one-line change later if wrong.
- **Q5. `limit`'s HTTP status in the new studio route (Phase B)?** Recommend: 409 (Conflict).

## Decisions (draft for the handoff)

### `recordProposedMistakes` now calls `mistakeProposalsRepo.record`, teacher-scoped only
Decided: `profileStoreFor.recordProposedMistakes(scope, proposed)` persists via the new repo, scoped
by `{ teacherId: bound.teacherId }` (no `studentId` column on `mistake_tag_proposals`).
Why: matches "shown to its teacher only" (acceptance) and `classifyMistakeTags`'s own per-teacher
`allowedTags` input; aggregating by student would need a column and index this feature doesn't need.
risk: low

### `approve` shares `style-cards.ts`'s version-insert logic via an extracted helper
Decided: extract `insertNextVersion(tx, teacherId, draft, method)` from `styleCardsRepo.create`'s
transaction body; both `create` and `mistakeProposalsRepo.approve` call it from inside their own
`db.transaction`, so the proposal-row update and the new style-card version commit or roll back
together.
Why: reuses the existing versioning path exactly, keeps one atomic write, avoids nesting
`db.transaction` calls (no precedent for that in this codebase).
risk: low

### No contracts change
Decided: `ProposedMistakeTagInput`/`MistakeProposalRow` stay `packages/db`-internal.
Why: the `ProfileStore` port ADR-0017 already froze the right method signatures; nothing new needed.
risk: low

### `risk: high` — new table, repository and a `ports.ts` write-path change in `packages/db`
Decided: ship `mistake_tag_proposals`, `mistakeProposalsRepo`, the `style-cards.ts` extraction, and
the `recordProposedMistakes` wire-up, logged `risk: high` per the merge gate's rule for any
`packages/db/src/repositories/**` change, reviewed by security-reviewer (required) and code-
reviewer/typescript-reviewer (default); database-reviewer recommended.
Why: the risk-paths group requires `risk: high` for this path regardless of change size, same as
6.3d's own precedent for the same file.
risk: high

## Budget

Budget: 120 tool calls (2 phases, packages/db and apps/web)
- Phase A (packages/db): 65 tool calls (was 60 in the earlier plan; +5 for the `ports.ts` wire-up
  and updating the existing `profile-store.int.test.ts` case).
- Phase B (apps/web): 55 tool calls.

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (typecheck/lint/test, `docker compose ... up -d postgres`, and
`corepack pnpm --filter @edmate/db db:generate` only; no network, no payment or model calls).

## Exit conditions

- **Phase A** Status: DONE once all new/extended Phase A test files pass, `style-cards.int.test.ts`
  is unchanged and green, the gate command above is green, `git diff origin/main --
  packages/contracts` is empty, `main` was pulled fresh after 6.3e merged (Q0), and the handoff logs
  the `risk: high` decision. Status: PARTIAL if past ~65 tool calls, if 6.3e has not yet merged when
  the builder starts (stop and flag rather than race it), or if the lead's answer to Q0/Q1/Q3/Q4
  changes this task's scope. Hand off to Phase B's builder with a short "state after Phase A" note
  (new repo's exact method signatures, the migration number used).
- **Phase B** Status: DONE once all new/extended Phase B test files pass, the gate command above is
  green, and the handoff (appended, not overwritten) names the Phase A state it built on. Status:
  PARTIAL if past ~55 tool calls, if Phase A has not yet merged to `main`, or if the lead's answer to
  Q2/Q5 changes this task's scope.

## Lead answers

(none yet — plan returned READY; Q0–Q5 above are recommendations only, none block the start of
either phase per this task's own reasoning.)

## Lead answers (27 Oct 2026)
- Q0: Yes. Phase A starts only after 6.3e merges, on a branch cut from main after that merge. Both touch ports.ts; 6.3e is small.
- Q-6.3e (27 Oct 2026): 6.3e's review deferred one MEDIUM here. Phase A adds an int-test case that calls `applyMistakes` with a non-empty `known` plus proposed tags and asserts the proposed tags are not written to the learner profile (only `recordProposedMistakes` persists them).
