# 8.3 plan: Outline editor with source links; reorder, rename, merge, split

Board: milestone M8 · deps `1.3`, `5.1`, `5.2`, `5.11` (all done), `8.1` (done) · **not** dependent
on `8.2` (uploads) — this task works from whatever ready chunks already exist for a teacher's
modules, however they got there (CLI ingest, fixtures, or 8.2's upload centre). Packages touched:
`packages/db`, `apps/web` only. Three phases, one builder each, in order.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Outline editor with source links; reorder, rename, merge, split"
Accept: "outline for 20 files in < 10 minutes; edits versioned."

### How it is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| Source links persist | A new `topic_chunks` join table (teacher-scoped, FK to `topics` and `chunks`, both `ON DELETE CASCADE`) records which chunks back each topic. `GET /api/studio/outline` returns each topic's linked chunks as `{ chunkId, sourceTitle, locator }` (joined through `chunks`/`documents`, no raw chunk text). |
| Reorder, rename | `PUT /api/studio/outline` takes the whole tree (modules' `title`/`order`, each module's `topics[]` with `title`/`order`/`chunkIds`); the repository writes it atomically. Int test: reordering two topics and renaming a module round-trips. |
| Merge | Two topics are merged by sending one topic whose `chunkIds` is the union of both originals' and omitting the other's id; the repository drops the omitted topic (and its `topic_chunks` rows, by cascade) in the same transaction. Int test: merge leaves one topic with every chunk id the two originals had, in a fresh row (old id gone). |
| Split | One topic is split by sending it with a subset of its original `chunkIds` plus a second topic (no `id`) with the rest. Int test: split produces two topics whose `chunkIds` partition the original's. |
| Edits versioned | `courses.outlineVersion` (column already exists, migration from 1.1/1.3) increments by exactly 1 on every successful `PUT`/generate call, inside the same transaction as the write; one `audit_log` row (`action: 'outline.edit'`, `before`/`after: { outlineVersion, moduleCount, topicCount }`) is appended via the existing `insertAuditEntry`. Int test: two PUTs in a row give versions 2 and 3; a rejected PUT (bad chunk id) leaves the version and the audit log untouched. |
| Outline for 20 files | `POST /api/studio/outline/generate`: for each of the teacher's modules, reads its `ready` documents' chunks (new `chunks.listForModule`) and calls `@edmate/ingest`'s existing `draftOutline` (task 5.11, tier `small`, one `generateObject` call per module, run in parallel), then persists the result through the same write path as a manual `PUT`. A component/route test with a fixture of 20 chunks across 3 modules (scripted gateway, no real model call — rule 4) asserts the generated tree is returned and persisted; the **10-minute bar is a manual timed walkthrough** (see Phase C), not a CI assertion — same precedent as 9.1's Lighthouse run and 8.2's manual dev-stack step. |
| No contracts change | `git diff origin/main -- packages/contracts` empty. `OutlineDraft`/`TopicDraft` (5.11) stay local to `packages/ingest`; the persisted row shapes are local zod objects in `packages/db/src/repositories/map.ts`, same precedent as `TeacherProfileRow`/`DocumentRow` ("no contract type exists for it"). |
| No real model calls in tests | Every test uses the scripted/fake gateway (rule 4); the manual 10-minute walkthrough is the only place a real key may be used, and it is not CI-wired. |

## Scope decisions (MVP — logged on merge, not blockers)

1. **Modules are rename/reorder only; topics are the mergeable/splittable unit.** `documents.module_id`
   and `chunks.module_id` are `NOT NULL` foreign keys (8.2); deleting or recombining a module would
   require reassigning every document and chunk under it, which is a much bigger, riskier change
   this task does not need. Topics have no external dependents besides the new `topic_chunks` table,
   which this task fully owns, so topics can be freely created, merged, split and deleted inside one
   transaction with no FK fallout. "Outline editor... reorder, rename, merge, split" is read as
   applying module-level reorder/rename and topic-level reorder/rename/merge/split. Module-level
   merge/split (reassigning documents between modules) is out of scope; flagged below as an open
   question with a recommendation to defer it to a follow-up task if a teacher actually needs it.
2. **Source links are a new join table, not a column.** `topics` gains no new column; a new
   `topic_chunks` table (`id`, `teacher_id`, `topic_id` FK → `topics` `ON DELETE CASCADE`, `chunk_id`
   FK → `chunks` `ON DELETE CASCADE`, `order`, timestamps) records the link. Cascading on both FKs
   means: deleting a topic (merge/split rewrite) drops its links for free, and deleting a chunk
   (8.2's existing `documents.delete` transaction) drops any topic's link to it for free, with no
   new code in `chunks.ts`'s delete path. Trade-off, flagged below: a document delete can silently
   shrink a topic's source links without bumping `outlineVersion` (the topic *shape* didn't change,
   only what still backs it) — accepted for this slice.
3. **"Versioned" means the existing integer counter plus an audit row, not full history/rollback.**
   `courses.outlineVersion` already exists for exactly this purpose (data model table: "From the
   outline"). This task does not add a snapshot or undo feature; that is a possible follow-up, not
   named by the accept line.
4. **Generation is synchronous, not a queued job.** Unlike 8.2's ingest pipeline (BullMQ +
   `apps/worker`), the outline draft call is a direct `generateObject` request from the `apps/web`
   route handler, composed the same way `apps/web/src/turn/deps.ts` already composes a `ModelGateway`
   for chat turns (reusing `@edmate/gateway`'s `createRouter`/provider-key loading), scoped to the
   `small` tier only. This keeps the task inside two packages (`packages/db`, `apps/web`) with no
   `packages/queue`/`apps/worker` change. A handful of parallel per-module calls for a 20-file course
   (a few modules) fits one request; no polling UI is needed.
5. **A teacher with zero modules gets one bootstrapped on first GET.** Nothing in the repo today
   creates the first `courses`/`modules` row for a real teacher (confirmed: no repository method
   inserts into `courses` or `modules`; every existing insert is test-fixture-only, via
   `db.insert(s.courses)...` directly in `packages/db/test/*`). `GET /api/studio/outline` calls a new
   `coursesRepo.ensureDefault(scope)` (insert-if-missing, idempotent) which also inserts one default
   module ("Module 1") when the teacher has none, so the editor — and, incidentally, 8.2's already-
   shipped upload centre, which also needs at least one module id to show an upload control — both
   become usable for a brand-new teacher. This is a small, low-risk addition (two plain `INSERT`s,
   no delete, no README rule-7/8 conflict) logged as a decision, not sent to the human as a blocker.
   Flagged below as an open question in case the lead would rather this bootstrap live somewhere
   else (e.g. at teacher-profile creation, 8.1).

## Design

### Phase A — packages/db: schema, repositories (no dependency on Phase B/C)

1. `packages/db/src/schema/content.ts`: new `topicChunks` table (`id`, `teacherId`, `topicId` FK →
   `topics.id` `ON DELETE CASCADE`, `chunkId` FK → `chunks.id` `ON DELETE CASCADE`, `order` integer,
   timestamps); indexes on `(teacherId, topicId)` and `(chunkId)`.
2. `packages/db/src/schema/index.ts`: export `topicChunks`.
3. `pnpm --filter @edmate/db db:generate` → new migration + snapshot + journal (additive only:
   `CREATE TABLE`, `CREATE INDEX`, two `ADD CONSTRAINT ... FOREIGN KEY ... ON DELETE CASCADE`).
   Review the generated SQL by hand before committing (same convention as every prior migration).
4. New `packages/db/src/repositories/outline.ts`:
   - `coursesRepo(db)`: `ensureDefault(scope)` (insert the teacher's one course if none exists, with
     a fixed default title "My course"; insert one default module "Module 1" `order: 0` in the same
     transaction when the teacher has zero modules; both plain `INSERT`s, idempotent — a second call
     is a no-op that returns the existing row) and `get(scope)` (the scope's own course row or
     `null`, no insert).
   - `outlineRepo(db)`: `getOutline(scope)` — one read building `{ courseId, outlineVersion,
     modules: [{ id, title, order, topics: [{ id, title, order, chunkIds: [{ chunkId, sourceTitle,
     locator }] }] }] }`, joining `modules` → `topics` → `topic_chunks` → `chunks`/`documents` for
     the display fields, teacher-scoped throughout. `replaceOutline(scope, input)` — one transaction:
     (a) `FOR KEY SHARE` locks every module id named in `input` and checks they are all the scope's
     own (else `not_found`, nothing written — same "a set of ids must all be the teacher's" pattern
     README rule 3 already names for "modules, topics"); (b) updates each named module's `title`/
     `order`; (c) for each module, deletes its existing `topics` rows (teacher- and module-scoped
     `DELETE`, cascading to `topic_chunks`) and inserts the new topic set fresh, using
     `insertSelect`/`written` (`./insert.js`) so every cited `chunkId` is ownership-checked against
     the teacher's own `chunks` in the same statement (zero rows inserted for an unknown or foreign
     chunk id → `invalid`, nothing written, matching `draftOutline`'s own "never invent a chunk id"
     rule one layer down); (d) bumps `courses.outline_version` by 1; (e) calls `insertAuditEntry`
     (`./audit.js`) with `action: 'outline.edit'`, `before`/`after: { outlineVersion, moduleCount,
     topicCount }` (counts only, no titles or chunk text, per the audit log's existing "no personal
     details"/size-cap conventions). A topic may have zero `chunkIds` (a placeholder the teacher
     fills in later); an empty `modules` input is `invalid` before any SQL.
5. `packages/db/src/repositories/chunks.ts`: add `listForModule(scope, moduleId)` to `chunksRepo` —
   the scope's own `ready`-document chunks for one module (`id`, `locator`, `sourceTitle`), ordered
   by document then chunk order; empty array for an unknown/foreign module (no `not_found`, matching
   `documents.listForTeacher`'s own "no existence oracle" convention since an empty course is a
   normal state here).
6. `packages/db/src/repositories/map.ts`: local zod row schemas/mappers for the outline's nested
   read shape (`CourseRow`, `OutlineModuleRow`, `OutlineTopicRow`), following the existing
   `TeacherProfileRow`/`DocumentRow` precedent — no contracts import.
7. `packages/db/src/repositories/index.ts`: wire `courses: guardAll('courses', coursesRepo(db))` and
   `outline: guardAll('outline', outlineRepo(db))`; export new row types.
8. `packages/db/src/repositories/README.md`: add `topics` (teacher- and module-scoped `DELETE`,
   inside `outline.ts`'s `replaceOutline`) as a third named exception to rule 8, next to the two
   8.2 already added; note the two new cascading FKs under rule 7's ownership-column discussion (no
   ownership column is ever updated — only `title`/`order`/the row set change).
9. `packages/db/test/scope.test.ts`: extend the "no raw `delete from`, `.delete(` only in named
   places" guard to allow `outline.ts`'s one scoped `topics` delete.
10. Tests (write first):
    - `packages/db/test/schema.test.ts`: the new table, its two FKs and their `ON DELETE CASCADE`.
    - `packages/db/test/repositories.int.test.ts`: isolation `CASES` for `courses.ensureDefault`,
      `courses.get`, `outline.getOutline`, `outline.replaceOutline`, `chunks.listForModule`.
    - New `packages/db/test/outline.int.test.ts` (real Postgres): the acceptance-evidence cases
      above — reorder+rename round-trip, merge, split, version increments + audit row + a rejected
      PUT (foreign/unknown chunk id, or a module id not the teacher's) leaves everything unchanged,
      a document delete (seeded directly, not through 8.2) cascading to drop a topic's link without
      changing `outlineVersion`, and `ensureDefault` being idempotent (two calls, one course, one
      module).
11. Gate: `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`.

**Files:** create `packages/db/src/repositories/outline.ts`, `packages/db/test/outline.int.test.ts`,
migration files (generated). Modify `schema/content.ts`, `schema/index.ts`, `repositories/chunks.ts`,
`repositories/map.ts`, `repositories/index.ts`, `repositories/README.md`,
`test/repositories.int.test.ts`, `test/schema.test.ts`, `test/scope.test.ts`.

**State after this phase:** a teacher's outline can be read, generated-into and edited entirely
through `packages/db`; nothing calls it yet. Green gate; secret scan clean.

### Phase B — apps/web: studio outline API (depends on Phase A merged)

1. `apps/web/src/studio/outline.ts` (new) — `createOutlineHandlers(backend, log)`: `get` (calls
   `courses.ensureDefault` then `outline.getOutline`), `put` (validates the body with a strict zod
   schema mirroring Phase A's input, calls `outline.replaceOutline`, maps `invalid`/`not_found` to
   the usual `{ error: { code, message, retryable } }`), `generate` (lists the teacher's modules,
   `chunks.listForModule` per module, skips a module with zero ready chunks, builds
   `OutlineModuleInput[]`, calls `@edmate/ingest`'s `draftOutline`, maps the result's
   `TopicDraft.chunkIds` into the `replaceOutline` input, calls it, returns the fresh outline).
   Follows `apps/web/src/studio/routes.ts`'s existing `StudioBackend`-injection shape (no module-level
   singletons; the route files inject the real backend).
2. `apps/web/src/studio/runtime.ts` (edit) — extend `StudioBackend`/`StudioHooks` with `courses`,
   `outline` (the two new repos) and a `ModelGateway` built the same way `apps/web/src/turn/deps.ts`
   composes one (provider keys via `@edmate/gateway`'s existing loader; `small` tier only — no
   fallback/metering wiring beyond what the shared factory already gives for free). A missing
   provider key behaves like a missing `REDIS_URL` today: `StudioUnavailableError`, 503, logged by
   reason only.
3. `apps/web/app/api/studio/outline/route.ts` (new) — `GET`/`PUT`, `withRole(['teacher'])`. No
   `ROUTE_POLICY` change needed: `/api/studio/**` already allows `GET`/`POST`/`PUT`/`DELETE` for
   `teacher` (added across 1.3/8.2); confirm this with a `route-coverage.test.ts` entry, not a
   policy edit.
4. `apps/web/app/api/studio/outline/generate/route.ts` (new) — `POST`, `withRole(['teacher'])`.
5. Tests (write first, memory backend, no real DB/model/S3 — rule 4): `src/studio/outline.test.ts`
   (cross-teacher cases are not applicable the same way as documents — the acting teacher is always
   the session's own scope, never from the body/URL), the 20-chunk/3-module generate fixture named
   in the acceptance table above (a scripted `generateObject` double, not a real gateway), a
   malformed `PUT` body (missing `chunkIds`, an unknown chunk id) → 400/`invalid`, no write; route
   files' own thin tests; `src/auth/route-coverage.test.ts` picks up the two new files automatically.
6. Gate: `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/web...`.

**Files:** create `apps/web/src/studio/outline.ts`, `apps/web/src/studio/outline.test.ts`,
`apps/web/app/api/studio/outline/route.ts` (+ test), `apps/web/app/api/studio/outline/generate/route.ts`
(+ test). Modify `apps/web/src/studio/runtime.ts` (+ its test).

**State after this phase:** a teacher can `GET`/`PUT`/generate their outline entirely through the
API, no UI yet. Green gate; `route-coverage.test.ts` passes; no `apps/web/src/auth/**` file touched
(not a risky-path PR by itself); secret scan clean.

### Phase C — apps/web: the outline editor page (depends on Phase B merged)

1. `apps/web/app/teacher/outline/page.tsx` (new) — `requireRole(['teacher'])`, renders `<OutlineView>`
   inside `AppShell` (9.1), with the Studio/Uploads/Outline nav.
2. `apps/web/app/teacher/outline/OutlineView.tsx` (new, client) — fetches the outline on mount; per
   module: rename (text input), reorder (up/down buttons — no drag-and-drop in this slice, logged as
   a decision); per topic within a module: rename, reorder, a checkbox-based "merge selected" action
   (combines two selected topics' `chunkIds`, keeps the first topic's title, drops the second), a
   "split" action (a simple move-chunk-to-new-topic control: pick a subset of the topic's linked
   chunks to move into a new topic with a teacher-given title); each topic lists its linked chunks'
   `sourceTitle`/`locator` read-only; a "Generate from uploads" button (calls `generate`, replaces the
   whole visible tree, asks for confirmation first since it overwrites unsaved edits); a "Save"
   button (calls `PUT` with the current tree, shows the new `outlineVersion` on success); an empty
   state ("no modules yet — upload files first, or Generate once you have") for a bootstrapped
   course with no chunks anywhere.
3. `apps/web/app/teacher/outline/OutlineView.test.tsx` (new) — RTL + jest-axe, fetch stubbed with an
   in-memory outline API (same pattern as 8.2's `UploadsView.test.tsx`): initial render; rename
   persists in local state; reorder swaps two rows; merge combines two topics' chunk lists into one
   and removes the other from the visible tree; split produces two topics whose chunk lists partition
   the original; Save sends the exact edited tree and shows the returned version; Generate replaces
   the tree and warns before discarding unsaved edits; empty state renders with no modules; zero axe
   violations.
4. `apps/web/app/teacher/view.tsx` (edit) — add the "Outline" nav link, next to Studio/Uploads (8.2).
5. `apps/web/app/teacher/view.test.tsx` (edit) — the new nav link.
6. `apps/web/messages/en.json` (edit) — the outline-editor strings.
7. **Manual evidence (not CI-wired, same precedent as 9.1's Lighthouse run / 8.2's dev-stack run):**
   on the dev compose stack, seed or generate an outline over roughly 20 fixture chunks across 2-3
   modules, time a full edit pass (rename two things, reorder one, merge two topics, split one,
   save) end to end, and paste the timestamps into the handoff. This is the acceptance line's "< 10
   minutes" bar; it is a human-timed walkthrough, not an automated assertion (precedent: lessons.md
   "wall-clock bounds fail on shared CI runners" — the same reasoning applies to a human usability
   bar, which cannot be a CI assertion either way).

**Files:** create `apps/web/app/teacher/outline/page.tsx`, `OutlineView.tsx`,
`OutlineView.test.tsx`. Modify `apps/web/app/teacher/view.tsx` (+ test), `apps/web/messages/en.json`.

**State after this phase (task done):** a signed-in teacher generates and edits their outline end to
end, with source links visible, reorder/rename/merge/split all working, and the version bumping on
save. Secret scan clean; no real teacher material in any fixture.

## Files out of bounds

- `packages/contracts/**`, `docs/adr/**` — no contracts/ADR change (see "No contracts change" above).
- `apps/web/src/auth/**`, `apps/web/src/auth/policy.ts` — `ROUTE_POLICY`'s `/api/studio/**` row
  already allows every method this task needs; do not edit it. If a reviewer finds this wrong, stop
  and raise it rather than widening the risky-path diff unilaterally.
- `packages/queue/**`, `apps/worker/**` — generation is synchronous from `apps/web` (scope decision
  4); no queue/worker change.
- `packages/harness/src/memory/**` (6.1's `buildTopicMap`/`CourseOutlineInput`) — a converter from
  this task's persisted `courses`/`modules`/`topics` to 6.1's in-harness `TopicMap` (for BKT mastery)
  is 6.1's own open follow-up (Q2, logged 21 Oct 2026), not this task. The two stay separate: this
  task's tables are for the studio display and source links only.
- `packages/db/src/repositories/retrieval.ts` — unchanged; the outline groups chunks for display,
  it is not a new retrieval gate.
- `apps/web/app/teacher/uploads/**` (8.2) — not modified. The bootstrap in scope decision 5 only
  adds rows that 8.2's existing `modules.ids()` read will then also see; no 8.2 file changes.
- `apps/web/src/turn/**` — read for its gateway-composition pattern only, not modified.
- Module-level merge/split (reassigning `documents`/`chunks` between modules) — not built; see Open
  questions.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- Phase A — `packages/db/src/repositories/**` (new `outline.ts`, edits to `chunks.ts`, `map.ts`,
  `index.ts`, `README.md`). **Reviewers: security-reviewer** (the group covers "keeping each
  teacher's and student's data apart"; the new ownership-checked insert/delete transaction and the
  `FOR KEY SHARE`-locked module-set check are exactly its kind of logic). Recommend `database-
  reviewer` too (new table, two cascading FKs, a third named delete exception) as routine practice,
  though not gate-required (not a drop/delete-data migration — it is additive `CREATE TABLE`).
- Phase B, Phase C — no glob in `risk-paths.txt` matches (`apps/web/src/auth/**` is read, not
  edited; `apps/web/app/api/studio/**` is not itself a listed glob, same precedent 8.2's plan noted
  for its own new route files). Not gate-risky; `typescript-reviewer` and `code-reviewer` run as
  routine practice, not as a merge-gate requirement.
- Phase A's handoff logs a `risk: high` decision (CLAUDE.md non-negotiable 6, since the group is
  touched). Phases B and C do not need one on this basis alone.

## Open questions (each with a recommendation)

- **Q1. Who creates a teacher's first module, long-term?** Today nothing does, outside test
  fixtures (confirmed by searching `packages/db/src` and `scripts/`). Scope decision 5 has this
  task's `GET /api/studio/outline` bootstrap one on first visit, which also unblocks 8.2's upload
  centre (it needs a module id to show an upload control). Recommend: keep the bootstrap here for
  now; if the lead would rather it live in 8.1's onboarding flow (profile creation) or a small
  standalone fix to 8.2, say so and this task drops scope decision 5's `ensureDefault` module-insert
  half (keeping only the course bootstrap, or neither) — not a blocker either way, since the
  acceptance evidence's seeded int/route tests do not depend on which page bootstraps first.
- **Q2. Module-level merge/split.** Scope decision 1 limits merge/split to topics; a teacher who
  wants to combine two *modules*' material (not just topics within one module) cannot do it here.
  Recommend: ship this slice topic-only, and open a follow-up task once a real teacher asks for it,
  since it requires reassigning `documents.module_id`/`chunks.module_id` (a different, larger
  change) — not named by this task's accept line either way.
- **Q3. Document-delete cascading into topic links silently.** Scope decision 2's trade-off: deleting
  a file (8.2) can shrink a topic's source links with no version bump and no teacher-facing notice.
  Recommend: accept for this slice (the teacher who deletes a file already knows they changed their
  material); a "this topic's links shrank" banner is UI polish for a follow-up, not a correctness
  gap — flagging, not blocking.

## Budget

Budget: 360 tool calls (3 phases, packages/db + apps/web)

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (migrations via `db:generate`, tests, typecheck/lint/build,
secret scan).

## Exit conditions

Each phase's builder stops at `Status: DONE` once its own gate (`typecheck lint test` for the
packages it touches), its phase's tests above and the secret scan are all green, and hands off to
the next phase. A builder stops at `Status: PARTIAL` past roughly its phase's share of the 360-call
budget, or if it finds it needs to touch a file listed under "Files out of bounds" (e.g. `apps/web/
src/auth/policy.ts`, `packages/contracts/**`) — that goes back to the lead rather than being decided
mid-build.

## Status

READY.
