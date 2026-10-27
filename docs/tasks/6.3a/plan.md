# Task 6.3a — Proposed mistake tags the teacher approves

Board: milestone M13 · dep `6.3` (done, merged) · branch `m6/6.3a-mistake-proposals` ·
**risky** (`packages/db/src/repositories/**`, Phase A only) · two phases, one builder each.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Proposed mistake tags the teacher approves (deferred from 6.3, MVP first): persist the
classifier's proposed tags per teacher and add a teacher approve/reject action that adds an
approved tag to the style card's `mistakeTags` (new style card version)"
Accept: "a proposed tag is stored, shown to its teacher only, and becomes taggable only after
approval."

### How it is shown (paste into handoff.md)

Phase A, on Postgres (`packages/db/test/mistake-proposals.int.test.ts`, new):
1. `record` stores a teacher's proposed tags (aggregated by tag: `count` sums, `lastSeen` takes
   the later value), scoped so another teacher's `listPending` never sees them (shown to its
   teacher only).
2. `listPending` returns only `status: 'pending'` rows for the scope's own teacher; a tag already
   `approved` or `rejected` never reappears.
3. `approve(scope, tag)` on a pending proposal whose teacher already has a saved style card:
   creates a new style-card version whose `mistakeTags` is the old version's tags plus the newly
   approved one (deduped), marks the proposal `approved`, and returns that card — the acceptance
   proof, "becomes taggable only after approval": before `approve`, the tag is absent from every
   style-card version's `mistakeTags`; after, it is present in the new version only, never
   retroactively added to old ones (style cards are immutable, 8.4a).
4. A race test: two concurrent `approve` calls for the same (teacher, tag) — one wins
   (`approved: true`, one new version), the other sees the already-`approved` status and no-ops
   (`approved: false`, no second version) — no double-version, no lost update. Same row-lock shape
   as 6.3's and 6.3b's own race tests in `learner.ts`.
5. `reject` marks a pending proposal `rejected` and never touches `style_cards`; re-`record`-ing
   the same tag after rejection is a caller decision (see Open questions Q3), not re-tested here
   beyond "a rejected or approved row is not mutated by a later `record` of the same tag" (one
   case).
6. Cap tests, mirroring 6.3b's own precedent on the sibling file: a `record` patch over
   `MISTAKE_PROPOSAL_PATCH_MAX` is `invalid` before any row is touched; a teacher whose stored
   proposal rows are already at `MISTAKE_PROPOSALS_MAX` gets `limit` on a `record` call that would
   add a new tag (not matched by an existing row), with no partial write.
7. Scope tests: `approve`/`reject`/`listPending` for another teacher's tag/scope is `not_found`/
   `scope` as appropriate; nothing is written cross-scope.
All gate on `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`.

Phase B, no database (`apps/web/src/studio/mistakeProposalRoutes.test.ts`,
`StyleCardView.test.tsx` extended): a teacher's GET of the proposals list returns only their own
pending tags; approving one removes it from the pending list client-side and shows the card's new
`mistakeTags`; rejecting removes it without changing the card. All gate on
`corepack pnpm turbo run typecheck lint test --filter=@edmate/web...`.

## State of the world (read, not assumed)

- `classifyMistakeTags` (`packages/harness/src/memory/mistakeTags.ts`, task 6.3) already computes
  a `proposed: {tag, count, lastSeen}[]` list but **returns it, never persists it** — 6.3's own
  plan named this exact gap and deferred it here (6.3's Open questions Q2, lead's 21 Oct answer).
  Nothing in `packages/harness` changes in this task; this task is the "store it" half 6.3 cut.
- No live caller computes or passes `proposed` tags today: 6.3's plan also noted "no
  scoring/grading tool exists yet that would call this from a live turn" — still true (that tool
  is `packages/harness/src/tools/**`, out of bounds here, see below). So, like 6.3's
  `classifyMistakeTags` itself, this task's `record` method is exercised by tests with direct
  fixtures, not wired into a live pipeline call site. **This task does not wire a real
  `applyMistakes`/`classifyMistakeTags` caller either** — that still needs the not-yet-built
  scoring tool (`tools/practice.ts` is explicitly 6.4a Phase A's, out of bounds for this plan). The
  brief's question "does 6.3a wire a real `applyMistakes` caller's `allowedTags`?" — **no**: there
  is still no live caller to wire. 6.3a instead reads the teacher's current style card's
  `mistakeTags` directly inside `approve` (see Design), which is the one place in this task that
  actually needs "the teacher's list" at runtime, and it already has DB access to fetch it fresh —
  no `allowedTags` parameter threading needed here.
- Style-card versioning (`packages/db/src/repositories/style-cards.ts`, task 8.4a, capped 6.4a?
  no — 8.4a): `styleCardsRepo.create(scope, draft)` is the only write path for a new version: locks
  the teacher's role row, takes a per-teacher advisory lock (`VERSION_LOCK_NAMESPACE = 8401`),
  computes `max(version) + 1`, inserts, returns the checked row. `latest(scope)` reads the newest.
  Both already guard scope (student scope → `scope`; unknown teacher → `not_found`); `DraftInput`
  already caps text/tags (`STYLE_CARD_LIMITS`). This task's `approve` needs to do exactly what
  `create` does (lock, compute next version, insert) but from *inside its own transaction*, after
  first locking and checking the proposal row — so the two writes (mark proposal approved, add a
  style-card version) commit or roll back together. Design (below): extract the version-insert
  body of `create` into a small transaction-scoped helper both methods call, rather than nesting
  `db.transaction` calls (untested in this codebase) or duplicating the locking logic.
- `StyleCardSchema.mistakeTags: z.array(z.string())` (`@edmate/contracts`'s `teacher.ts`) is
  unchanged by this task — a new version's `mistakeTags` is still just a `string[]`; no contracts
  change needed to add one more string to it.
- Teacher studio style-card surface (`apps/web/src/studio/styleCardRoutes.ts`,
  `styleCardClient.ts`, `apps/web/app/teacher/style-card/{page.tsx,StyleCardView.tsx}`, task 8.4a/
  8.4b): `GET/PUT /api/studio/style-card` and the `StyleCardView` editor already exist; the page
  loads `card = await serverDatabase().repos.styleCards.latest(scope)` server-side and passes it
  as `initialCard`. This task adds a sibling read (pending proposals) alongside that, and a small
  approve/reject surface in the same view — reusing the same auth (`requireRole(['teacher'])`,
  `withRole(['teacher'], ...)`) and the same `ApiResult<T>`/`call()` client helpers already in
  `styleCardClient.ts`, not inventing new ones.
- `apps/web/src/studio/**` and `apps/web/app/api/studio/**` (other than `api/auth`, `api/staff`,
  `app/staff`) are **not** on `.claude/skills/merge-gate/risk-paths.txt` — only
  `apps/web/src/auth/**`, `app/api/auth/**`, `app/api/staff/**`, `app/staff/**` and
  `app/api/webhooks/**` are, under the security-reviewer group. Phase B touches none of those.

## Design

### Phase A — `packages/db`: a new table, a new repo, a small `style-cards.ts` refactor

**New table** `mistake_tag_proposals` (`packages/db/src/schema/content.ts`, next to `styleCards`):
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
One row per (teacher, tag) — the same aggregate-by-tag shape `classifyMistakeTags`'s own
`proposed` output already uses, so `record`'s merge is a straight upsert, not a read-then-write.
`tstz`/`check`/`uniqueIndex`/`index`/`id`/`teacherId`/`timestamps` are all already imported or
available in `content.ts` (see `styleCards`, `safetyAlerts` for the same helpers). Export
`mistakeTagProposals` from `packages/db/src/schema/index.ts` next to `styleCards`.

**Migration:** run `corepack pnpm --filter @edmate/db db:generate` after the schema edit — the
next free migration number is `0041` (confirm by listing `packages/db/migrations/*.sql` first,
same check 6.3b's plan made for `index.ts`'s export line). Review the generated SQL before
committing (a new table only — no `ALTER` on an existing table, no backfill, no `CONCURRENTLY`
needed per `database-migrations` skill's own checklist, since nothing existing is touched).

**`packages/db/src/repositories/style-cards.ts` (modify) — extract the version-insert body.**
Pull the advisory-lock-and-insert body of `create` (the four statements inside its
`db.transaction(async (tx) => {...})`, after the role check) into:
```ts
/** Locks the teacher's next version and inserts it; caller's own transaction, caller's own role
 * check (task 6.3a: shared by `create` and `mistakeProposalsRepo.approve`, which adds one tag to
 * the teacher's current card as a new version from inside its own transaction). */
export async function insertNextVersion(
  tx: Db,
  teacherId: string,
  draft: { text: string; mistakeTags: string[] },
  method: string,
): Promise<StyleCard> { /* the existing advisory-lock + max(version)+1 + insert + checked body */ }
```
`create` becomes: role check, then `return insertNextVersion(tx, teacherId, d, method);`. No
behaviour change to `create` — this is a pure extraction; `style-cards.int.test.ts`'s existing
tests (versions 1/2/3, concurrent-create race, trims/dedupes tags, scope/not_found) must still
pass unmodified, confirming the refactor is behaviour-preserving before any new code is added.
`insertNextVersion` is a named export of the module (for `mistake-proposals.ts` to import
directly), **not** re-exported from `repositories/index.ts`'s public barrel — same "internal to
the package, not part of the public port" status `applyMastery`/`rebuildMastery` already have.

**`packages/db/src/repositories/mistake-proposals.ts` (new).**
```ts
export const MISTAKE_PROPOSAL_PATCH_MAX = 50;   // one record() call's patch
export const MISTAKE_PROPOSALS_MAX = 100;        // a teacher's stored proposal rows, any status
export const MISTAKE_PROPOSALS_LIST_MAX = 50;    // listPending's page

export interface ProposedMistakeTagInput { tag: string; count: number; lastSeen: string }
export interface MistakeProposalRow {
  tag: string; count: number; lastSeen: string; status: 'pending' | 'approved' | 'rejected';
}

export function mistakeProposalsRepo(db: Db) {
  return {
    /** Upserts `proposed` into the scope's teacher's pending proposals: a new tag inserts
     * `pending`; an existing `pending` row's count/lastSeen merge (sum / later-wins, same as
     * `classifyMistakeTags`'s own aggregation and `applyMistakes`'s merge); an existing
     * `approved`/`rejected` row is left untouched (already decided). Rejects the whole call
     * (`invalid`) if `proposed.length > MISTAKE_PROPOSAL_PATCH_MAX`, or (`limit`, no partial
     * write) if it would add enough new tags to push the teacher's stored row count past
     * `MISTAKE_PROPOSALS_MAX`. An empty `proposed` is a no-op. */
    async record(scope: TeacherScope, proposed: ProposedMistakeTagInput[]): Promise<void> { ... },

    /** The scope's teacher's own pending proposals only (shown to its teacher only — the
     * acceptance line), newest `lastSeen` first, at most `MISTAKE_PROPOSALS_LIST_MAX`. */
    async listPending(scope: TeacherScope): Promise<MistakeProposalRow[]> { ... },

    /** Approves one pending tag: locks the teacher's role and the proposal row (FOR UPDATE,
     * serialising concurrent decisions on the same tag), re-checks it is still `pending` (else
     * `{approved: false, card: null}`, no-op — same shape as `safetyAlerts.acknowledge`'s
     * already-acknowledged case), reads the teacher's current latest style card (`not_found` if
     * the teacher has never saved one — approving needs an existing card to add the tag to),
     * calls `insertNextVersion` with that card's `mistakeTags` plus the newly approved tag
     * (deduped) inside the *same* transaction, marks the proposal `approved`, `decided_at = now()`,
     * and returns the new card. One commit, both writes land or neither does. */
    async approve(scope: TeacherScope, tag: string): Promise<{ approved: boolean; card: StyleCard | null }> { ... },

    /** Rejects one pending tag (locks role + proposal row, `pending` → `rejected`); an already-
     * decided proposal is `{rejected: false}`, no-op. Never touches `style_cards`. */
    async reject(scope: TeacherScope, tag: string): Promise<{ rejected: boolean }> { ... },
  };
}
```
`tag` arguments are validated with `z.string().trim().min(1).max(STYLE_CARD_LIMITS.tagMaxChars)`
(imported from `style-cards.ts`, already exported) — the same cap a style card's own tags carry,
so an approved tag can never be longer than `create`'s `DraftInput` would itself accept.

**`packages/db/src/repositories/index.ts` (modify):** import `mistakeProposalsRepo`; add
`mistakeProposals: guardAll('mistakeProposals', mistakeProposalsRepo(db))` to
`createRepositories`; export `MISTAKE_PROPOSAL_PATCH_MAX, MISTAKE_PROPOSALS_MAX,
MISTAKE_PROPOSALS_LIST_MAX, type ProposedMistakeTagInput, type MistakeProposalRow` next to the
`STYLE_CARD_LIMITS` export line (same "add to the nearest related export line" style 6.3b used for
`EVIDENCE_LIST_MAX`'s line — no 8.2i-style conflict risk here, this is a fresh line next to
`style-cards.js`'s existing one).

### No contracts change, no change to `applyMistakes`/`classifyMistakeTags`

`git diff origin/main -- packages/contracts` must stay empty — nothing here needs a schema type:
`StyleCard.mistakeTags` is already `string[]`; the proposal row's shape is a `packages/db`-internal
type (`ProposedMistakeTagInput`/`MistakeProposalRow`), same "no contracts type for an internal repo
method" precedent `EvidenceEventEntry`/`TeacherEvalCaseRow` etc. already set. `packages/harness`
is untouched — `classifyMistakeTags` still just returns `proposed`; nothing calls `record` from a
live turn yet (see State of the world).

### Phase B — `apps/web`: list + approve/reject on the studio's style-card page

**`apps/web/src/studio/mistakeProposalRoutes.ts` (new)** — same shape as `styleCardRoutes.ts`:
```
GET   /api/studio/mistake-proposals  -> { proposals: MistakeProposalRow[] }   (scope's own, pending only)
PATCH /api/studio/mistake-proposals  -> { approved: boolean; card: StyleCard | null } | { rejected: boolean }
                                         body: { tag: string; action: 'approve' | 'reject' }
```
One `PATCH` endpoint for both decisions (not two dynamic-segment routes) — smallest surface, no new
Next.js dynamic-route encoding question for a teacher-typed tag string. `scopeOf(ctx)` is the same
helper already in `styleCardRoutes.ts` (duplicated here as a one-liner, or imported — builder's
call; importing is fine, it's a pure function, not state). Backend interface:
```ts
export interface MistakeProposalBackend {
  repos(): Pick<Repositories, 'mistakeProposals'>;
}
```
Errors map through the same `fromRepositoryError`-shaped switch `styleCardRoutes.ts` already has
(`scope → 403`, `not_found → 404`, `invalid/integrity → 400`, `limit → ` a fixed 409/400, builder's
call on the exact status — no precedent for `limit` in a studio route yet, pick one and say why in
the handoff).

**`apps/web/app/api/studio/mistake-proposals/route.ts` (new):** `export const GET =
withRole(['teacher'], mistakeProposalHandlers.list);` and `export const PATCH =
withRole(['teacher'], mistakeProposalHandlers.decide);` — same pattern as every other
`app/api/studio/**/route.ts` file.

**`apps/web/src/studio/index.ts` (modify):** build `mistakeProposalHandlers` from
`createMistakeProposalHandlers({ repos: () => serverDatabase().repos }, realHooks.log)` (or fold
into the existing style-card runtime if the builder finds that cleaner — no new env/gateway
dependency needed here, unlike the drafter).

**`apps/web/src/studio/styleCardClient.ts` (modify):** add `listMistakeProposals(): Promise<ApiResult<MistakeProposalView[]>>`
and `decideMistakeProposal(input: { tag: string; action: 'approve' | 'reject' }):
Promise<ApiResult<{ approved?: boolean; rejected?: boolean; card?: StyleCardView | null }>>`,
reusing the file's existing `call`/`ApiResult`/`asJson` helpers — no new client-side module.

**`apps/web/app/teacher/style-card/page.tsx` (modify):** also read
`proposals = await serverDatabase().repos.mistakeProposals.listPending({ teacherId:
principal.userId })` and pass as a new `initialProposals` prop to `StyleCardView`.

**`apps/web/app/teacher/style-card/StyleCardView.tsx` (modify):** a new section, "Proposed tags"
(or whatever `messages/en.json`'s `styleCard.proposedTags.*` strings say — the builder adds that
key, English-only pilot, no locale work): lists `proposals` with an Approve/Reject button each; on
approve success, replace `card` with the returned one (the new version) and drop the tag from the
pending list; on reject success, just drop it from the pending list; errors reuse the existing
`error`/`ERROR_KEYS` state already in the component (extend `ERROR_KEYS` only if a genuinely new
code can occur — `limit` from Phase A's `MISTAKE_PROPOSALS_MAX` cap is the one new case worth a
message).

## Files

### Phase A
- **Modify:** `packages/db/src/schema/content.ts` — `mistakeTagProposals` table.
- **Modify:** `packages/db/src/schema/index.ts` — export it.
- **Create:** `packages/db/migrations/0041_mistake_tag_proposals.sql` (generated, reviewed).
- **Modify:** `packages/db/src/repositories/style-cards.ts` — extract `insertNextVersion`.
- **Create:** `packages/db/src/repositories/mistake-proposals.ts` — the new repo.
- **Modify:** `packages/db/src/repositories/index.ts` — wire the repo, export its constants/types.
- **Create:** `packages/db/test/mistake-proposals.test.ts` — pre-SQL validation (no DB; `noDb`
  Proxy pattern, mirrors `style-cards.test.ts`).
- **Create:** `packages/db/test/mistake-proposals.int.test.ts` — the "How it is shown" cases.
- **Modify:** `packages/db/test/style-cards.int.test.ts` — confirm unmodified (existing assertions
  still pass after the `insertNextVersion` extraction); only touch this file if the extraction
  needs it, which it shouldn't.
- **Modify:** `packages/db/test/repositories.int.test.ts` — four isolation-grid entries
  (`mistakeProposals.record`, `.listPending`, `.approve`, `.reject`), following `styleCards.*`'s
  own entries immediately above as the template.
- **Modify:** `packages/db/test/isolation-seed.ts` — seed one pending proposal row per teacher
  (a fixed tag, e.g. `'seed-tag'`) so `.approve`/`.reject`'s isolation cases have a targeted row to
  act on, the same way `ids.styleCard(t)` already seeds a style card per teacher.
- **Modify:** `docs/tasks/6.3a/handoff.md` (end of Phase A, by the builder).

### Phase B
- **Create:** `apps/web/src/studio/mistakeProposalRoutes.ts` — the two handlers.
- **Create:** `apps/web/src/studio/mistakeProposalRoutes.test.ts`.
- **Create:** `apps/web/app/api/studio/mistake-proposals/route.ts`.
- **Modify:** `apps/web/src/studio/index.ts` — wire `mistakeProposalHandlers`.
- **Modify:** `apps/web/src/studio/styleCardClient.ts` — two new client functions.
- **Modify:** `apps/web/src/studio/styleCardClient.test.ts` (if one exists covering the client
  functions — extend it; else a short new test block in the same file).
- **Modify:** `apps/web/app/teacher/style-card/page.tsx` — also load `initialProposals`.
- **Modify:** `apps/web/app/teacher/style-card/page.test.tsx` — cover the new read.
- **Modify:** `apps/web/app/teacher/style-card/StyleCardView.tsx` — the proposed-tags section.
- **Modify:** `apps/web/app/teacher/style-card/StyleCardView.test.tsx` — approve/reject flows.
- **Modify:** `apps/web/messages/en.json` — `styleCard.proposedTags.*` strings.
- **Modify:** `docs/tasks/6.3a/handoff.md` (end of Phase B, by its builder — append, don't
  overwrite Phase A's entry).

## Files out of bounds

- `packages/contracts/**`, `docs/adr/**` — no contracts change (Design, above).
- `packages/harness/**` (including `mistakeTags.ts`, `tools/practice.ts`, `pedagogy/helpState.ts`,
  `pipeline/**`) — this task does not wire a live caller of `classifyMistakeTags`/`applyMistakes`;
  that needs a scoring/mistake-detecting tool that is 6.4a Phase A's scope (and still doesn't
  exist), not this task's.
- `apps/web/src/chat/**`, `apps/web/src/turn/**`, `apps/web/app/api/sessions/**` — 6.4a Phase B's
  and 12.2i Phase B's; no turn-time or session wiring here.
- `apps/web/src/auth/**`, `packages/db/src/identity/**` — 1.4c's; this task's routes reuse
  `requireRole`/`withRole`/`serverDatabase` as-is, never modifies them.
- `packages/db/src/repositories/{chunks,takedowns,reports}.ts`, any new `takedown-predicate.ts` —
  12.2i's; untouched.
- `packages/db/src/repositories/learner.ts` — 6.3/6.3b's `applyMistakes`/`classifyMistakeTags`
  pairing is unchanged; this task's `mistakeProposalsRepo` is a new, separate file.
- `content/**`, `packages/content/**` — no content change.

## Tests first

### Phase A
1. `packages/db/test/mistake-proposals.test.ts` (no DB): scope checks (malformed/extra-key
   teacherId → `scope`) for all four methods before any SQL; `record` with a patch over
   `MISTAKE_PROPOSAL_PATCH_MAX` → `invalid`; `approve`/`reject` with an empty/overlong tag →
   `invalid`. Red until each method's `parseArg`/`teacherScope` calls exist.
2. `packages/db/test/mistake-proposals.int.test.ts` — on Postgres, write each case from "How it is
   shown" above as its own `it(...)`, red until the matching repo logic lands:
   - `record` then `listPending` round-trips count/lastSeen merges, scoped per teacher.
   - `approve` on a teacher with an existing style card adds the tag as a new version; `listPending`
     no longer shows it; a second `approve` of the same tag is a no-op (`approved: false`).
   - `approve` with no existing style card is `not_found`, nothing written to either table.
   - Race: `Promise.all` of two `approve(scope, 'race-tag')` calls on a seeded pending row — exactly
     one new style-card version, one `{approved: true}`, one `{approved: false}`.
   - `reject` flips `pending` → `rejected`, never inserts into `style_cards`; a rejected tag's
     `listPending` omits it.
   - Cap tests for `MISTAKE_PROPOSAL_PATCH_MAX` (`invalid`) and `MISTAKE_PROPOSALS_MAX` (`limit`,
     no partial write, mirroring 6.3b's own cap-test shape in `profile-store.int.test.ts`).
   - Cross-teacher: teacher B can't `approve`/`reject`/see teacher A's proposal (`not_found`).
3. `packages/db/test/style-cards.int.test.ts` — run unchanged, green, confirming the
   `insertNextVersion` extraction changed no behaviour.
4. `packages/db/test/repositories.int.test.ts` — the four new isolation-grid entries pass under
   the existing grid's own scope/ownership assertions.
- **Gate:** `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` (Postgres up via
  `docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres`).

### Phase B
1. `apps/web/src/studio/mistakeProposalRoutes.test.ts` — an in-memory `mistakeProposals` repo (same
   `memoryRepo()` pattern as `styleCardRoutes.test.ts`): `GET` returns only the scope teacher's
   pending rows; `PATCH {action:'approve'}` calls `repo.approve` and returns its result; `PATCH
   {action:'reject'}` calls `repo.reject`; a malformed body (`action` not in the enum, missing
   `tag`) is `validation`/400 before the repo is touched; a `RepositoryError` maps to the same
   fixed status codes `styleCardRoutes.ts`'s own `fromRepositoryError` already uses, plus the new
   `limit` case.
2. `apps/web/app/teacher/style-card/page.test.tsx` — the page reads `mistakeProposals.listPending`
   with the signed-in teacher's scope and passes the result to `StyleCardView` as
   `initialProposals`, same assertion shape as the existing `initialCard` case.
3. `apps/web/app/teacher/style-card/StyleCardView.test.tsx` — renders proposed tags from
   `initialProposals`; clicking Approve calls the client function, replaces `card` with the
   response's new version, removes the tag from the list; clicking Reject removes it without
   touching `card`; a failed approve/reject shows the existing error banner and leaves the list
   unchanged (no optimistic removal before the response).
- **Gate:** `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...`.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- **Phase A:** `packages/db/src/repositories/**` (`mistake-proposals.ts` new, `style-cards.ts` and
  `index.ts` modified) matches the security-reviewer group (risk-paths.txt lines 29–41: "...keeping
  each teacher's and student's data apart"). **Reviewers for this PR: security-reviewer** (required
  by the group) **plus the default code-reviewer/typescript-reviewer on every PR**; recommend also
  **database-reviewer** given the new table and the cross-table transaction in `approve` (not
  strictly required by risk-paths.txt — this migration only creates a table, doesn't drop/delete
  data, so the "migrations that drop data need database-reviewer" clause doesn't itself trigger —
  but the lead may still want one, matching 6.3b's own precedent of adding it for a `learner.ts`
  change). `packages/db/src/schema/**` and `packages/db/migrations/**` are not separately listed in
  risk-paths.txt; they travel with the repositories-layer reviewer requirement above because the
  same PR touches both.
- **Phase B:** `apps/web/src/studio/**` and `apps/web/app/api/studio/**` are **not** on
  risk-paths.txt (only `apps/web/src/auth/**`, `app/api/auth/**`, `app/api/staff/**`,
  `app/staff/**`, `app/api/webhooks/**` are, under security-reviewer). Phase B is not risky: default
  code-reviewer/typescript-reviewer only.
- No `packages/contracts/**`, `docs/adr/**`, `.claude/**` touched in either phase.
- Per CLAUDE.md rule 6, Phase A's handoff must log a `risk: high` decision for the
  repositories-layer touch (draft below); Phase B does not need one.

## Open questions (each with a recommendation)

- **Q1. Does this task wire a real caller of `classifyMistakeTags`/`applyMistakes` so
  `record`/`approve` actually run from a live turn?** Recommend: no — no scoring/mistake-detecting
  tool exists yet to produce real candidate tags from a turn (same gap 6.3's own plan found); that
  tool is out of this task's bounds (6.4a Phase A's `tools/practice.ts`, explicitly listed as out
  of bounds in the brief). This task ships `record`/`listPending`/`approve`/`reject`, exercised by
  tests with direct fixtures, same scope-cut precedent 6.3 itself used for `classifyMistakeTags`.
  `approve` reads the teacher's current style card's `mistakeTags` straight from the DB (not via a
  passed-in `allowedTags` argument), so no caller needs to thread one through — the question in the
  brief about "where a real `applyMistakes` caller gets `allowedTags`" stays unanswered on purpose:
  there is still no real caller.
- **Q2. One `PATCH` endpoint for approve/reject, or two separate dynamic-segment routes
  (`/[tag]/approve`, `/[tag]/reject`)?** Recommend: one `PATCH` with `{tag, action}` in the body —
  avoids URL-encoding a teacher-typed tag string in a path segment and is a smaller diff; the
  existing studio routes use dynamic segments only for opaque ids (`documents/[id]/...`), not
  free-text strings.
- **Q3. Should a later `record` of a tag the teacher already `rejected` revive it to `pending`, or
  stay `rejected` forever?** Recommend: stay `rejected` — a teacher who dismissed a tag once
  shouldn't see it resurface every time a future scoring tool re-proposes it; if the lead wants a
  "re-propose after N occurrences" policy later, that is a follow-up, not this task (no live
  caller exists yet to make the distinction matter today).
- **Q4. Exact cap values for `MISTAKE_PROPOSAL_PATCH_MAX` (50) and `MISTAKE_PROPOSALS_MAX`
  (100)?** Recommend: ship these — same order of magnitude as 6.3b's `MAX_MISTAKES_PATCH_LENGTH`
  (50) and half its `MAX_MISTAKES_ENTRIES` (200, since proposals are a subset awaiting review, not
  a permanent record); one-line change later if wrong, no migration needed to adjust either.
- **Q5. `limit`'s HTTP status in the new studio route (Phase B)?** Recommend: 409 (Conflict) — no
  existing studio route has hit a `limit`-kind error yet to set a precedent; 409 reads better than
  400 for "you're at a fixed cap" versus "your input was malformed." Low-stakes, one-line change
  either way.

## Decisions (draft for the handoff)

### `approve` shares `style-cards.ts`'s version-insert logic via an extracted helper, not a nested transaction or a duplicated insert
Decided: extract `insertNextVersion(tx, teacherId, draft, method)` from `styleCardsRepo.create`'s
transaction body; both `create` and `mistakeProposalsRepo.approve` call it from inside their own
`db.transaction`, so `approve`'s proposal-row update and its new style-card version commit or roll
back together.
Why: reuses the existing versioning path exactly (brief's instruction), keeps one atomic write
instead of two separate transactions that could partially succeed, and avoids nesting
`db.transaction` calls (no precedent for that in this codebase).
risk: low

### No contracts change; proposal rows are a `packages/db`-internal type
Decided: `ProposedMistakeTagInput`/`MistakeProposalRow` are defined in
`packages/db/src/repositories/mistake-proposals.ts`, not `packages/contracts`.
Why: matches `EvidenceEventEntry`'s own precedent for an internal repo-method shape; no schema
needs to change to add a status-tracked proposal row.
risk: low

### This task does not wire a live caller of `classifyMistakeTags`/`applyMistakes`
Decided: `record` is exercised by tests with direct fixtures only (Open questions Q1); the
scoring/mistake-detecting tool that would call it from a real turn is out of this task's and the
brief's bounds.
Why: that tool doesn't exist yet (6.3's own plan found the same gap); building it here would
silently expand scope into 6.4a Phase A's territory.
risk: low

### `risk: high` — new table and repository in `packages/db` (risky path, Phase A)
Decided: ship `mistake_tag_proposals` and `mistakeProposalsRepo`
(`record`/`listPending`/`approve`/`reject`), plus the `style-cards.ts` extraction, logged
`risk: high` per the merge gate's rule for any `packages/db/src/repositories/**` change, reviewed
by security-reviewer (required) and code-reviewer/typescript-reviewer (default); database-reviewer
recommended but not required by risk-paths.txt for this change.
Why: the risk-paths group requires `risk: high` for this path regardless of the change's actual
size, same as 6.3's and 6.3b's own precedent for the sibling file.
risk: high

## Budget

Budget: 115 tool calls (2 phases, packages/db and apps/web)
- Phase A (packages/db): 60 tool calls.
- Phase B (apps/web): 55 tool calls.

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (typecheck/lint/test, `docker compose ... up -d postgres`, and
`corepack pnpm --filter @edmate/db db:generate` only; no network, no payment or model calls).

## Exit conditions

- **Phase A** Status: DONE once all four new/extended Phase A test files pass, `style-cards.int.test.ts`
  is unchanged and green, the gate command above is green, `git diff origin/main --
  packages/contracts` is empty, and the handoff logs the `risk: high` decision above. Status:
  PARTIAL if past ~60 tool calls, or if the lead's answer to Q1/Q3/Q4 changes this task's scope —
  stop and flag rather than silently expanding scope. Hand off to Phase B's builder with a short
  "state after Phase A" note (new repo's exact method signatures, the migration number used).
- **Phase B** Status: DONE once all three new/extended Phase B test files pass, the gate command
  above is green, and the handoff (appended, not overwritten) names the Phase A state it built on.
  Status: PARTIAL if past ~55 tool calls, if Phase A has not yet merged to `main` (the builder
  stops rather than building against an unmerged repo API), or if the lead's answer to Q2/Q5
  changes this task's scope.

## Lead answers

(none yet — plan returned READY; Q1–Q5 above are recommendations only, none block the start of
either phase per this task's own reasoning, same "none block the start of the build" framing
6.3b's plan used.)
